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
            AuthError::Anonymous => {
                AppError::forbidden("Create an account to upload files.")
            }
            _ => AppError::unauthenticated("Your session is invalid or has expired. Sign in again."),
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
        let id = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::Invalid("sub is not a uuid".into()))?;
        Ok(AuthUser { id, email: claims.email, token: Arc::from(token) })
    }
}

/// Extracts `Authorization: Bearer <token>`.
pub fn bearer_token(parts: &Parts) -> Result<&str, AuthError> {
    let value = parts.headers.get(AUTHORIZATION).ok_or(AuthError::Missing)?;
    let value = value.to_str().map_err(|_| AuthError::Malformed("non-ASCII header".into()))?;
    let (scheme, token) = value.split_once(' ').ok_or(AuthError::Missing)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return Err(AuthError::Missing);
    }
    Ok(token.trim())
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
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
