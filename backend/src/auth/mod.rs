//! Authentication: Supabase Auth access tokens (JWT) verified locally against the project's
//! JWKS.
//!
//! The verified token is kept (never logged) and forwarded to Supabase on every upstream
//! call, so Postgres RLS and Storage policies apply exactly as they do for the web app. This
//! service holds no secret key and cannot act beyond what the caller may do.

pub mod jwks;

use std::fmt;
use std::sync::Arc;

use axum::extract::FromRequestParts;
use http::header::AUTHORIZATION;
use http::request::Parts;
use jsonwebtoken::{Validation, decode, decode_header};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;
use crate::telemetry::user_hash;

use jwks::{JwksCache, KeyLookupError};

/// Seconds of clock skew tolerated for `exp`/`nbf`.
pub const LEEWAY_SECS: u64 = 30;
const MAX_TOKEN_BYTES: usize = 8 * 1024;
const AUDIENCE: &str = "authenticated";

/// The signed-in caller.
#[derive(Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    token: Arc<str>,
}

impl AuthUser {
    /// The raw access token, for forwarding to Supabase only.
    pub fn token(&self) -> &str {
        &self.token
    }
}

impl fmt::Debug for AuthUser {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthUser")
            .field("id", &self.id)
            .field("token", &"<redacted>")
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    role: Option<String>,
    email: Option<String>,
    #[serde(default)]
    is_anonymous: bool,
}

/// Why a token was rejected (logged at debug level; clients get a generic message).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AuthError {
    #[error("missing bearer token")]
    Missing,
    #[error("malformed token: {0}")]
    Malformed(String),
    #[error("token has no key id")]
    NoKid,
    #[error("algorithm {0} is not accepted")]
    Algorithm(String),
    #[error("unknown signing key")]
    UnknownKey,
    #[error("signing keys unavailable")]
    KeysUnavailable,
    #[error("invalid token: {0}")]
    Invalid(String),
    #[error("token role is not 'authenticated'")]
    Role,
    #[error("anonymous sessions are not allowed")]
    Anonymous,
}

impl From<AuthError> for AppError {
    fn from(error: AuthError) -> Self {
        tracing::debug!(reason = %error, "authentication failed");
        match error {
            AuthError::Missing => AppError::unauthenticated("Sign in to continue."),
            AuthError::KeysUnavailable => AppError::upstream_unavailable(),
            AuthError::Anonymous => AppError::forbidden("Create an account to upload files."),
            _ => {
                AppError::unauthenticated("Your session is invalid or has expired. Sign in again.")
            }
        }
    }
}

/// Verifies Supabase access tokens.
#[derive(Debug)]
pub struct Verifier {
    issuer: String,
    jwks: Arc<JwksCache>,
}

impl Verifier {
    pub fn new(issuer: String, jwks: Arc<JwksCache>) -> Self {
        Self { issuer, jwks }
    }

    pub async fn verify(&self, token: &str) -> Result<AuthUser, AuthError> {
        if token.is_empty() {
            return Err(AuthError::Missing);
        }
        if token.len() > MAX_TOKEN_BYTES {
            return Err(AuthError::Malformed("too long".into()));
        }
        let header = decode_header(token).map_err(|e| AuthError::Malformed(e.to_string()))?;
        let kid = header.kid.ok_or(AuthError::NoKid)?;
        let key = self.jwks.key_for(&kid).await.map_err(|e| match e {
            KeyLookupError::UnknownKid => AuthError::UnknownKey,
            KeyLookupError::Unavailable => AuthError::KeysUnavailable,
        })?;
        if header.alg != key.alg {
            return Err(AuthError::Algorithm(format!("{:?}", header.alg)));
        }

        let mut validation = Validation::new(key.alg);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[AUDIENCE]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.leeway = LEEWAY_SECS;
        validation.validate_nbf = true;

        let data = decode::<Claims>(token, &key.key, &validation)
            .map_err(|e| AuthError::Invalid(format!("{:?}", e.kind())))?;
        let claims = data.claims;
        if claims.role.as_deref() != Some(AUDIENCE) {
            return Err(AuthError::Role);
        }
        if claims.is_anonymous {
            return Err(AuthError::Anonymous);
        }
        let id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AuthError::Invalid("sub is not a uuid".into()))?;
        Ok(AuthUser {
            id,
            email: claims.email,
            token: Arc::from(token),
        })
    }
}

/// Extracts `Authorization: Bearer <token>`.
pub fn bearer_token(parts: &Parts) -> Result<&str, AuthError> {
    let value = parts.headers.get(AUTHORIZATION).ok_or(AuthError::Missing)?;
    let value = value
        .to_str()
        .map_err(|_| AuthError::Malformed("non-ASCII header".into()))?;
    let (scheme, token) = value.split_once(' ').ok_or(AuthError::Missing)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return Err(AuthError::Missing);
    }
    Ok(token.trim())
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(user) = parts.extensions.get::<Self>() {
            return Ok(user.clone());
        }
        let token = bearer_token(parts)?;
        let user = state.verifier.verify(token).await?;
        tracing::Span::current().record("user", user_hash(&user.id).as_str());
        parts.extensions.insert(user.clone());
        Ok(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{self, Clock};
    use crate::redis_client::RedisHandle;
    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
    use p256::pkcs8::EncodePrivateKey;
    use serde_json::{Value, json};

    const ISSUER: &str = "https://abc.supabase.co/auth/v1";
    const KID: &str = "test-key-1";

    /// A fixed P-256 key (tests only) and its JWKS.
    fn signing_key() -> (EncodingKey, String) {
        let secret = p256::SecretKey::from_slice(&[0x42; 32]).unwrap();
        let der = secret.to_pkcs8_der().unwrap();
        let point = secret.public_key().to_sec1_bytes();
        assert_eq!(point.len(), 65, "uncompressed point");
        let jwks = json!({"keys": [{
            "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": KID,
            "x": URL_SAFE_NO_PAD.encode(&point[1..33]),
            "y": URL_SAFE_NO_PAD.encode(&point[33..65]),
        }]});
        (EncodingKey::from_ec_der(der.as_bytes()), jwks.to_string())
    }

    fn verifier() -> Verifier {
        let clock = clock::system();
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        // Port 9 (discard) refuses connections, so refreshes fail fast without network.
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let jwks = Arc::new(JwksCache::new(
            "http://127.0.0.1:9/jwks.json".into(),
            http,
            redis,
            clock,
        ));
        jwks.install_static(signing_key().1.as_bytes()).unwrap();
        Verifier::new(ISSUER.into(), jwks)
    }

    fn now() -> i64 {
        i64::try_from(clock::SystemClock.now_secs()).unwrap()
    }

    fn claims() -> Value {
        json!({
            "iss": ISSUER, "aud": "authenticated", "role": "authenticated",
            "sub": "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60", "email": "owner@example.com",
            "iat": now(), "exp": now() + 3600, "is_anonymous": false,
        })
    }

    fn sign(claims: &Value) -> String {
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(KID.into());
        encode(&header, claims, &signing_key().0).unwrap()
    }

    fn with(field: &str, value: Value) -> String {
        let mut c = claims();
        c[field] = value;
        sign(&c)
    }

    #[tokio::test]
    async fn accepts_a_valid_supabase_token() {
        let user = verifier().verify(&sign(&claims())).await.unwrap();
        assert_eq!(user.id.to_string(), "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60");
        assert_eq!(user.email.as_deref(), Some("owner@example.com"));
        assert!(
            !format!("{user:?}").contains(user.token()),
            "Debug never prints the token"
        );
    }

    #[tokio::test]
    async fn rejects_wrong_issuer_audience_role_and_subject() {
        let v = verifier();
        let cases = [
            ("iss", json!("https://evil.supabase.co/auth/v1")),
            ("aud", json!("anon")),
            ("sub", json!("not-a-uuid")),
        ];
        for (field, value) in cases {
            let err = v.verify(&with(field, value)).await.unwrap_err();
            assert!(matches!(err, AuthError::Invalid(_)), "{field}: {err:?}");
        }
        assert_eq!(
            v.verify(&with("role", json!("anon"))).await.unwrap_err(),
            AuthError::Role
        );
        assert_eq!(
            v.verify(&with("role", json!("service_role")))
                .await
                .unwrap_err(),
            AuthError::Role
        );
        assert_eq!(
            v.verify(&with("is_anonymous", json!(true)))
                .await
                .unwrap_err(),
            AuthError::Anonymous
        );
    }

    #[tokio::test]
    async fn enforces_exp_and_nbf_with_leeway() {
        let v = verifier();
        let expired = with("exp", json!(now() - 120));
        assert!(matches!(
            v.verify(&expired).await.unwrap_err(),
            AuthError::Invalid(_)
        ));
        // Within the leeway it still passes (clock skew between hosts).
        assert!(v.verify(&with("exp", json!(now() - 5))).await.is_ok());
        let not_yet = with("nbf", json!(now() + 600));
        assert!(matches!(
            v.verify(&not_yet).await.unwrap_err(),
            AuthError::Invalid(_)
        ));
        let mut no_exp = claims();
        no_exp.as_object_mut().unwrap().remove("exp");
        assert!(matches!(
            v.verify(&sign(&no_exp)).await.unwrap_err(),
            AuthError::Invalid(_)
        ));
    }

    #[tokio::test]
    async fn rejects_unknown_kid_alg_none_and_algorithm_confusion() {
        let v = verifier();
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some("rotated-away".into());
        let unknown = encode(&header, &claims(), &signing_key().0).unwrap();
        assert_eq!(v.verify(&unknown).await.unwrap_err(), AuthError::UnknownKey);

        // alg "none": unsigned token with an empty signature.
        let none_header =
            URL_SAFE_NO_PAD.encode(format!(r#"{{"alg":"none","typ":"JWT","kid":"{KID}"}}"#));
        let payload = URL_SAFE_NO_PAD.encode(claims().to_string());
        let unsigned = format!("{none_header}.{payload}.");
        assert!(matches!(
            v.verify(&unsigned).await.unwrap_err(),
            AuthError::Malformed(_)
        ));

        // HS256 signed with the public key bytes, claiming the EC key's kid.
        let mut hs = Header::new(Algorithm::HS256);
        hs.kid = Some(KID.into());
        let confused = encode(
            &hs,
            &claims(),
            &EncodingKey::from_secret(b"public-key-bytes"),
        )
        .unwrap();
        assert!(matches!(
            v.verify(&confused).await.unwrap_err(),
            AuthError::Algorithm(_)
        ));

        // Tampered payload, original signature.
        let token = sign(&claims());
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged =
            URL_SAFE_NO_PAD.encode(with_sub("00000000-0000-0000-0000-000000000001").to_string());
        parts[1] = &forged;
        assert!(matches!(
            v.verify(&parts.join(".")).await.unwrap_err(),
            AuthError::Invalid(_)
        ));

        assert_eq!(v.verify("").await.unwrap_err(), AuthError::Missing);
        assert!(matches!(
            v.verify("garbage").await.unwrap_err(),
            AuthError::Malformed(_)
        ));
        assert!(matches!(
            v.verify(&"a".repeat(9000)).await.unwrap_err(),
            AuthError::Malformed(_)
        ));
    }

    fn with_sub(sub: &str) -> Value {
        let mut c = claims();
        c["sub"] = json!(sub);
        c
    }

    #[test]
    fn bearer_header_parsing() {
        let parts = |value: &str| {
            let request = http::Request::builder()
                .header(AUTHORIZATION, value)
                .body(())
                .unwrap();
            request.into_parts().0
        };
        assert_eq!(
            bearer_token(&parts("Bearer abc.def.ghi")).unwrap(),
            "abc.def.ghi"
        );
        assert_eq!(bearer_token(&parts("bearer  abc ")).unwrap(), "abc");
        assert_eq!(
            bearer_token(&parts("Basic dXNlcjpwYXNz")).unwrap_err(),
            AuthError::Missing
        );
        let none = http::Request::builder().body(()).unwrap().into_parts().0;
        assert_eq!(bearer_token(&none).unwrap_err(), AuthError::Missing);
    }

    #[test]
    fn errors_map_to_safe_client_messages() {
        let err = AppError::from(AuthError::Invalid("InvalidIssuer".into()));
        assert_eq!(err.code, crate::error::ErrorCode::Unauthenticated);
        assert!(
            !err.message.contains("Issuer"),
            "reason is logged, not returned"
        );
        assert_eq!(
            AppError::from(AuthError::KeysUnavailable).code,
            crate::error::ErrorCode::UpstreamUnavailable
        );
    }
}
