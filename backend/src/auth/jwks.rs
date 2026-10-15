//! Supabase Auth signing keys (JWKS), cached in memory and in Redis.
//!
//! * Loaded at startup and refreshed when older than [`JWKS_TTL`] (10 minutes).
//! * A token with an unknown `kid` (key rotation) triggers one refresh, at most once per
//!   [`UNKNOWN_KID_REFRESH_INTERVAL`], shared by all concurrent requests (single-flight).
//! * If Supabase is unreachable, the copy in Redis (written by any instance) is used, then
//!   the in-memory copy for up to [`JWKS_MAX_STALE`]; after that verification fails closed.
//! * Only asymmetric signing keys are accepted: EC P-256 (`ES256`) and RSA (`RS256`).
//!   Symmetric (`oct`/HS256) keys are ignored even if published.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use jsonwebtoken::jwk::{AlgorithmParameters, EllipticCurve, JwkSet, KeyAlgorithm, PublicKeyUse};
use jsonwebtoken::{Algorithm, DecodingKey};
use parking_lot::RwLock;

use crate::clock::SharedClock;
use crate::redis_client::RedisHandle;

pub const JWKS_TTL: Duration = Duration::from_secs(600);
pub const JWKS_MAX_STALE: Duration = Duration::from_secs(6 * 3600);
pub const UNKNOWN_KID_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const REDIS_KEY: &str = "jwks:v1";
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// One usable verification key.
#[derive(Clone)]
pub struct VerifyingKey {
    pub alg: Algorithm,
    pub key: DecodingKey,
}

impl std::fmt::Debug for VerifyingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerifyingKey").field("alg", &self.alg).finish_non_exhaustive()
    }
}

#[derive(Debug, Default)]
struct KeySet {
    keys: HashMap<String, VerifyingKey>,
    fetched_at_ms: u64,
}

/// Why a key could not be produced.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KeyLookupError {
    /// The JWKS is current and has no such key: the token was not issued by this project.
    #[error("unknown signing key")]
    UnknownKid,
    /// No usable JWKS (Supabase unreachable and nothing cached).
    #[error("signing keys unavailable")]
    Unavailable,
}

/// Parses a JWKS document into usable keys. Unusable entries are skipped, not fatal.
pub fn parse_jwks(body: &[u8]) -> Result<HashMap<String, VerifyingKey>, String> {
    let set: JwkSet = serde_json::from_slice(body).map_err(|e| format!("invalid JWKS JSON: {e}"))?;
    let mut keys = HashMap::new();
    for jwk in &set.keys {
        let Some(kid) = jwk.common.key_id.clone() else { continue };
        if matches!(&jwk.common.public_key_use, Some(u) if *u != PublicKeyUse::Signature) {
            continue;
        }
        let alg = match &jwk.algorithm {
            AlgorithmParameters::EllipticCurve(ec) if ec.curve == EllipticCurve::P256 => {
                match jwk.common.key_algorithm {
                    None | Some(KeyAlgorithm::ES256) => Algorithm::ES256,
                    Some(_) => continue,
                }
            }
            AlgorithmParameters::RSA(_) => match jwk.common.key_algorithm {
                None | Some(KeyAlgorithm::RS256) => Algorithm::RS256,
                Some(_) => continue,
            },
            _ => continue,
        };
        match DecodingKey::from_jwk(jwk) {
            Ok(key) => {
                keys.insert(kid, VerifyingKey { alg, key });
            }
            Err(e) => tracing::warn!(%kid, error = %e, "skipping unusable JWK"),
        }
    }
    if keys.is_empty() {
        return Err("JWKS contains no usable ES256/RS256 signing keys".into());
    }
    Ok(keys)
}

pub struct JwksCache {
    url: String,
    http: reqwest::Client,
    redis: Arc<RedisHandle>,
    clock: SharedClock,
    current: RwLock<Arc<KeySet>>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_attempt_ms: AtomicU64,
}

impl std::fmt::Debug for JwksCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JwksCache")
            .field("url", &self.url)
            .field("keys", &self.key_count())
            .finish_non_exhaustive()
    }
}

impl JwksCache {
    pub fn new(url: String, http: reqwest::Client, redis: Arc<RedisHandle>, clock: SharedClock) -> Self {
        Self {
            url,
            http,
            redis,
            clock,
            current: RwLock::new(Arc::new(KeySet::default())),
            refresh_lock: tokio::sync::Mutex::new(()),
            last_attempt_ms: AtomicU64::new(0),
        }
    }

    pub fn key_count(&self) -> usize {
        self.current.read().keys.len()
    }

    /// True when keys are loaded and not older than [`JWKS_MAX_STALE`].
    pub fn is_loaded(&self) -> bool {
        let set = self.current.read();
        !set.keys.is_empty()
            && self.clock.now_ms().saturating_sub(set.fetched_at_ms) < JWKS_MAX_STALE.as_millis() as u64
    }

    /// Finds the key for `kid`, refreshing the set when it is old or the kid is unknown.
    pub async fn key_for(&self, kid: &str) -> Result<VerifyingKey, KeyLookupError> {
        let now = self.clock.now_ms();
        let set = Arc::clone(&self.current.read());
        let age = now.saturating_sub(set.fetched_at_ms);
        if set.keys.is_empty() || age >= JWKS_TTL.as_millis() as u64 {
            // Best effort: on failure the current keys stay in use until JWKS_MAX_STALE.
            let _ = self.refresh(false).await;
        }

        if let Some(found) = self.lookup(kid) {
            return Ok(found);
        }
        let recently = now.saturating_sub(self.last_attempt_ms.load(Ordering::Relaxed))
            < UNKNOWN_KID_REFRESH_INTERVAL.as_millis() as u64;
        let refreshed = if recently { self.is_loaded() } else { self.refresh(true).await.is_ok() };
        match self.lookup(kid) {
            Some(found) => Ok(found),
            None if refreshed || self.is_loaded() => Err(KeyLookupError::UnknownKid),
            None => Err(KeyLookupError::Unavailable),
        }
    }

    fn lookup(&self, kid: &str) -> Option<VerifyingKey> {
        let set = self.current.read();
        let fresh_enough = self.clock.now_ms().saturating_sub(set.fetched_at_ms)
            < JWKS_MAX_STALE.as_millis() as u64;
        if fresh_enough { set.keys.get(kid).cloned() } else { None }
    }

    /// Fetches the JWKS (Supabase first, then the Redis copy). Concurrent callers share one
    /// fetch; `force` skips the "someone just refreshed" shortcut.
    pub async fn refresh(&self, force: bool) -> Result<usize, String> {
        let requested_at = self.clock.now_ms();
        let _guard = self.refresh_lock.lock().await;
        {
            let set = self.current.read();
            let refreshed_meanwhile = set.fetched_at_ms >= requested_at && !set.keys.is_empty();
            let fresh = self.clock.now_ms().saturating_sub(set.fetched_at_ms) < JWKS_TTL.as_millis() as u64;
            if refreshed_meanwhile || (!force && fresh && !set.keys.is_empty()) {
                return Ok(set.keys.len());
            }
        }
        self.last_attempt_ms.store(self.clock.now_ms(), Ordering::Relaxed);

        match self.fetch_upstream().await {
            Ok(body) => match parse_jwks(&body) {
                Ok(keys) => {
                    let count = keys.len();
                    self.install(keys, self.clock.now_ms());
                    self.store_in_redis(&body).await;
                    tracing::info!(keys = count, "JWKS loaded from Supabase");
                    return Ok(count);
                }
                Err(e) => tracing::error!(error = %e, "Supabase returned an unusable JWKS"),
            },
            Err(e) => tracing::warn!(error = %e, "could not fetch JWKS from Supabase"),
        }

        // Fall back to the copy another instance (or an earlier run) stored in Redis.
        if let Some((body, stored_at_ms)) = self.load_from_redis().await {
            if let Ok(keys) = parse_jwks(&body) {
                if stored_at_ms > self.current.read().fetched_at_ms {
                    let count = keys.len();
                    self.install(keys, stored_at_ms);
                    tracing::info!(keys = count, "JWKS loaded from Redis copy");
                    return Ok(count);
                }
            }
        }
        Err("JWKS unavailable".into())
    }

    fn install(&self, keys: HashMap<String, VerifyingKey>, fetched_at_ms: u64) {
        *self.current.write() = Arc::new(KeySet { keys, fetched_at_ms });
    }

    async fn fetch_upstream(&self) -> Result<Vec<u8>, String> {
        let response = self
            .http
            .get(&self.url)
            .timeout(FETCH_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("status {}", response.status()));
        }
        let body = response.bytes().await.map_err(|e| format!("body: {e}"))?;
        if body.len() > 64 * 1024 {
            return Err("JWKS response too large".into());
        }
        Ok(body.to_vec())
    }

    async fn store_in_redis(&self, body: &[u8]) {
        let payload = format!("{}|{}", self.clock.now_ms(), String::from_utf8_lossy(body));
        let ttl_ms = JWKS_MAX_STALE.as_millis() as u64;
        let _ = self
            .redis
            .run("jwks_set", |mut conn| async move {
                redis::cmd("SET")
                    .arg(REDIS_KEY)
                    .arg(payload)
                    .arg("PX")
                    .arg(ttl_ms)
                    .query_async::<()>(&mut conn)
                    .await
            })
            .await;
    }

    async fn load_from_redis(&self) -> Option<(Vec<u8>, u64)> {
        let stored = self
            .redis
            .run("jwks_get", |mut conn| async move {
                redis::cmd("GET").arg(REDIS_KEY).query_async::<Option<String>>(&mut conn).await
            })
            .await
            .ok()??;
        let (stamp, body) = stored.split_once('|')?;
        Some((body.as_bytes().to_vec(), stamp.parse().ok()?))
    }

    /// Installs keys directly (tests and tools).
    pub fn install_static(&self, jwks_json: &[u8]) -> Result<usize, String> {
        let keys = parse_jwks(jwks_json)?;
        let count = keys.len();
        self.install(keys, self.clock.now_ms());
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real (public) JWKS of the CivPMS Supabase project, captured 2026-10-14.
    const SUPABASE_JWKS: &str = r#"{"keys":[{"alg":"ES256","crv":"P-256","ext":true,"key_ops":["verify"],"kid":"c80f7771-f021-47ae-b0ad-a9c9cb2da656","kty":"EC","use":"sig","x":"AuIozl2lOk1nBbNN0w47cGKKhVdrcRpdvO4m8qe1VFA","y":"9A_L7rN6IdaCdc7nZf75WM7p6VM28E52CC5Uup4sV9w"}]}"#;

    #[test]
    fn parses_the_supabase_jwks() {
        let keys = parse_jwks(SUPABASE_JWKS.as_bytes()).unwrap();
        let key = &keys["c80f7771-f021-47ae-b0ad-a9c9cb2da656"];
        assert_eq!(key.alg, Algorithm::ES256);
    }

    #[test]
    fn ignores_symmetric_encryption_and_kidless_keys() {
        let jwks = r#"{"keys":[
            {"kty":"oct","kid":"hs","k":"c2VjcmV0","alg":"HS256"},
            {"kty":"EC","crv":"P-256","x":"AuIozl2lOk1nBbNN0w47cGKKhVdrcRpdvO4m8qe1VFA","y":"9A_L7rN6IdaCdc7nZf75WM7p6VM28E52CC5Uup4sV9w","use":"enc","kid":"enc"},
            {"kty":"EC","crv":"P-256","x":"AuIozl2lOk1nBbNN0w47cGKKhVdrcRpdvO4m8qe1VFA","y":"9A_L7rN6IdaCdc7nZf75WM7p6VM28E52CC5Uup4sV9w"}
        ]}"#;
        assert!(parse_jwks(jwks.as_bytes()).unwrap_err().contains("no usable"));
        assert!(parse_jwks(b"not json").is_err());
    }
}
