//! Supabase Auth signing keys (JWKS), cached in memory and in Redis.
//!
//! * Loaded at startup. Keys older than [`JWKS_TTL`] (10 minutes) stay in use while **one
//!   background task** refreshes them; requests never wait for that fetch, and a failed
//!   refresh is retried at most once per [`STALE_REFRESH_INTERVAL`]. This matters exactly
//!   when Supabase Auth is slow: without it every request would queue behind a fetch.
//! * A token with an unknown `kid` (key rotation) triggers one blocking refresh, at most once
//!   per [`UNKNOWN_KID_REFRESH_INTERVAL`]; concurrent requests wait for that one fetch.
//!   (The kid is read before the signature is checked, so this path must stay cheap.)
//! * Only when no usable keys exist does a request wait for a fetch; concurrent requests
//!   share it, and after a failure the next attempt waits [`MISSING_KEYS_RETRY_INTERVAL`].
//! * Every decision to fetch is taken while holding the refresh lock, so callers queued
//!   behind an attempt see its outcome instead of starting another one.
//! * If Supabase is unreachable, the copy in Redis (written by any instance) is used, then
//!   the in-memory copy for up to [`JWKS_MAX_STALE`]; after that verification fails closed.
//! * Only asymmetric signing keys are accepted: EC P-256 (`ES256`) and RSA (`RS256`).
//!   Symmetric (`oct`/HS256) keys are ignored even if published.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use jsonwebtoken::jwk::{AlgorithmParameters, EllipticCurve, JwkSet, KeyAlgorithm, PublicKeyUse};
use jsonwebtoken::{Algorithm, DecodingKey};
use parking_lot::RwLock;

use crate::clock::SharedClock;
use crate::redis_client::RedisHandle;

pub const JWKS_TTL: Duration = Duration::from_mins(10);
pub const JWKS_MAX_STALE: Duration = Duration::from_hours(6);
/// Minimum time between two refreshes triggered by an unknown `kid`.
pub const UNKNOWN_KID_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
/// Minimum time between two background refreshes of keys older than [`JWKS_TTL`].
pub const STALE_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
/// Minimum time between two blocking attempts while no usable keys exist.
pub const MISSING_KEYS_RETRY_INTERVAL: Duration = Duration::from_secs(5);
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
        f.debug_struct("VerifyingKey")
            .field("alg", &self.alg)
            .finish_non_exhaustive()
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
    let set: JwkSet =
        serde_json::from_slice(body).map_err(|e| format!("invalid JWKS JSON: {e}"))?;
    let mut keys = HashMap::new();
    for jwk in &set.keys {
        let Some(kid) = jwk.common.key_id.clone() else {
            continue;
        };
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
    fetch_timeout: Duration,
    current: RwLock<Arc<KeySet>>,
    /// Held for the whole of one fetch attempt (and while deciding whether one is due).
    refresh_lock: tokio::sync::Mutex<()>,
    /// Start of the latest fetch attempt (unix ms, `0` = never); written under `refresh_lock`.
    last_attempt_ms: AtomicU64,
    /// A background refresh task is scheduled or running.
    background: AtomicBool,
}

impl std::fmt::Debug for JwksCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JwksCache")
            .field("url", &self.url)
            .field("keys", &self.key_count())
            .finish_non_exhaustive()
    }
}

/// Clears [`JwksCache::background`] when the background task ends, however it ends.
struct BackgroundSlot(Arc<JwksCache>);

impl Drop for BackgroundSlot {
    fn drop(&mut self) {
        self.0.background.store(false, Ordering::Release);
    }
}

impl JwksCache {
    pub fn new(
        url: String,
        http: reqwest::Client,
        redis: Arc<RedisHandle>,
        clock: SharedClock,
    ) -> Self {
        Self {
            url,
            http,
            redis,
            clock,
            fetch_timeout: FETCH_TIMEOUT,
            current: RwLock::new(Arc::new(KeySet::default())),
            refresh_lock: tokio::sync::Mutex::new(()),
            last_attempt_ms: AtomicU64::new(0),
            background: AtomicBool::new(false),
        }
    }

    /// Overrides the per-fetch timeout (tests).
    #[must_use]
    pub fn with_fetch_timeout(mut self, timeout: Duration) -> Self {
        self.fetch_timeout = timeout;
        self
    }

    pub fn key_count(&self) -> usize {
        self.current.read().keys.len()
    }

    /// Time since the installed keys were fetched (from Supabase, or by whoever wrote the
    /// Redis copy).
    pub fn age(&self) -> Duration {
        let fetched_at = self.current.read().fetched_at_ms;
        Duration::from_millis(self.clock.now_ms().saturating_sub(fetched_at))
    }

    /// True when keys are loaded and not older than [`JWKS_MAX_STALE`].
    pub fn is_loaded(&self) -> bool {
        let set = self.current.read();
        !set.keys.is_empty()
            && self.clock.now_ms().saturating_sub(set.fetched_at_ms)
                < JWKS_MAX_STALE.as_millis() as u64
    }

    /// Finds the key for `kid`. Never waits for a fetch while usable keys exist, unless the
    /// kid is unknown (rotation).
    pub async fn key_for(self: &Arc<Self>, kid: &str) -> Result<VerifyingKey, KeyLookupError> {
        if self.is_loaded() {
            if self.age() >= JWKS_TTL {
                self.refresh_in_background();
            }
        } else {
            // Nothing usable: this request has to wait (or share an attempt in flight).
            let _ = self
                .refresh_if_due(MISSING_KEYS_RETRY_INTERVAL, false)
                .await;
        }
        if let Some(found) = self.lookup(kid) {
            return Ok(found);
        }

        // Unknown kid: the signing keys may have been rotated.
        let refreshed = self
            .refresh_if_due(UNKNOWN_KID_REFRESH_INTERVAL, true)
            .await
            .is_ok();
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
        if fresh_enough {
            set.keys.get(kid).cloned()
        } else {
            None
        }
    }

    fn attempted_within(&self, interval: Duration, now: u64) -> bool {
        let last = self.last_attempt_ms.load(Ordering::Acquire);
        last != 0 && now.saturating_sub(last) < interval.as_millis() as u64
    }

    /// Schedules one background refresh of stale (but still usable) keys, unless one is
    /// already scheduled or an attempt ran within [`STALE_REFRESH_INTERVAL`].
    fn refresh_in_background(self: &Arc<Self>) {
        if self.attempted_within(STALE_REFRESH_INTERVAL, self.clock.now_ms())
            || self.background.swap(true, Ordering::AcqRel)
        {
            return;
        }
        let slot = BackgroundSlot(Arc::clone(self));
        tokio::spawn(async move {
            // Best effort: on failure the current keys stay in use until JWKS_MAX_STALE.
            let _ = slot.0.refresh_if_due(STALE_REFRESH_INTERVAL, false).await;
            drop(slot);
        });
    }

    /// Fetches the JWKS now (Supabase first, then the Redis copy), unless the keys are fresh
    /// and `force` is false. Used at startup.
    pub async fn refresh(&self, force: bool) -> Result<usize, String> {
        self.refresh_if_due(Duration::ZERO, force).await
    }

    /// Runs one fetch attempt unless the keys are fresh (and `force` is false) or an attempt
    /// started less than `min_interval` ago; in those cases the current state is reported.
    async fn refresh_if_due(&self, min_interval: Duration, force: bool) -> Result<usize, String> {
        let _guard = self.refresh_lock.lock().await;
        let now = self.clock.now_ms();
        {
            let set = self.current.read();
            let fresh = !set.keys.is_empty()
                && now.saturating_sub(set.fetched_at_ms) < JWKS_TTL.as_millis() as u64;
            if fresh && !force {
                return Ok(set.keys.len());
            }
        }
        if !min_interval.is_zero() && self.attempted_within(min_interval, now) {
            // An attempt ran moments ago (possibly the one this caller queued behind).
            return if self.is_loaded() {
                Ok(self.key_count())
            } else {
                Err("JWKS unavailable; retrying shortly".into())
            };
        }
        self.last_attempt_ms.store(now.max(1), Ordering::Release);

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
        if let Some((body, stored_at_ms)) = self.load_from_redis().await
            && let Ok(keys) = parse_jwks(&body)
            && stored_at_ms > self.current.read().fetched_at_ms
        {
            let count = keys.len();
            self.install(keys, stored_at_ms);
            tracing::info!(keys = count, "JWKS loaded from Redis copy");
            return Ok(count);
        }
        Err("JWKS unavailable".into())
    }

    fn install(&self, keys: HashMap<String, VerifyingKey>, fetched_at_ms: u64) {
        *self.current.write() = Arc::new(KeySet {
            keys,
            fetched_at_ms,
        });
    }

    async fn fetch_upstream(&self) -> Result<Vec<u8>, String> {
        let response = self
            .http
            .get(&self.url)
            .timeout(self.fetch_timeout)
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
                redis::cmd("GET")
                    .arg(REDIS_KEY)
                    .query_async::<Option<String>>(&mut conn)
                    .await
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
        assert!(
            parse_jwks(jwks.as_bytes())
                .unwrap_err()
                .contains("no usable")
        );
        assert!(parse_jwks(b"not json").is_err());
    }

    const KID: &str = "c80f7771-f021-47ae-b0ad-a9c9cb2da656";
    const FAST_TIMEOUT: Duration = Duration::from_millis(300);

    /// A cache whose JWKS endpoint is `server` (wiremock), with a manual clock.
    fn cache_against(
        server: &wiremock::MockServer,
    ) -> (Arc<JwksCache>, Arc<crate::clock::ManualClock>) {
        let clock = crate::clock::ManualClock::new(1_000_000_000);
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let cache = JwksCache::new(
            format!("{}/auth/v1/.well-known/jwks.json", server.uri()),
            http,
            redis,
            clock.clone(),
        )
        .with_fetch_timeout(FAST_TIMEOUT);
        (Arc::new(cache), clock)
    }

    async fn mount(server: &wiremock::MockServer, template: wiremock::ResponseTemplate) {
        server.reset().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(template)
            .mount(server)
            .await;
    }

    async fn upstream_calls(server: &wiremock::MockServer) -> usize {
        server.received_requests().await.unwrap_or_default().len()
    }

    fn hanging() -> wiremock::ResponseTemplate {
        wiremock::ResponseTemplate::new(200)
            .set_body_string(SUPABASE_JWKS)
            .set_delay(Duration::from_mins(1))
    }

    /// Regression (review finding): once the keys were older than `JWKS_TTL`, every request
    /// ran its own 5 s fetch, one after another, while Supabase Auth hung.
    #[tokio::test]
    async fn stale_keys_are_served_at_once_while_one_background_refresh_runs() {
        let server = wiremock::MockServer::start().await;
        let (cache, clock) = cache_against(&server);
        cache.install_static(SUPABASE_JWKS.as_bytes()).unwrap();
        mount(&server, hanging()).await;
        clock.advance(JWKS_TTL + Duration::from_mins(1));

        let started = std::time::Instant::now();
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let cache = Arc::clone(&cache);
            tasks.push(tokio::spawn(async move { cache.key_for(KID).await }));
        }
        for task in tasks {
            let key = tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .expect("served without waiting for the upstream")
                .unwrap();
            assert!(key.is_ok());
        }
        for _ in 0..4 {
            assert!(cache.key_for(KID).await.is_ok());
        }
        assert!(
            started.elapsed() < FAST_TIMEOUT,
            "nobody waited for the fetch"
        );

        // Let the background attempt time out.
        tokio::time::sleep(FAST_TIMEOUT + Duration::from_millis(200)).await;
        assert_eq!(upstream_calls(&server).await, 1, "one refresh attempt");

        // The failed attempt is not retried by every request, only after the interval.
        clock.advance(STALE_REFRESH_INTERVAL.saturating_sub(Duration::from_secs(1)));
        for _ in 0..5 {
            assert!(cache.key_for(KID).await.is_ok());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(upstream_calls(&server).await, 1);

        // Supabase recovers: the next attempt (in the background) installs fresh keys.
        mount(
            &server,
            wiremock::ResponseTemplate::new(200).set_body_string(SUPABASE_JWKS),
        )
        .await;
        clock.advance(Duration::from_secs(2));
        assert!(cache.key_for(KID).await.is_ok());
        for _ in 0..50 {
            if cache.age() < JWKS_TTL {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(cache.age() < JWKS_TTL, "refreshed in the background");
    }

    /// Without usable keys a request has to wait, but concurrent callers share one attempt
    /// and a failed attempt is not repeated for every following request.
    #[tokio::test]
    async fn missing_keys_share_one_attempt_and_failures_are_throttled() {
        let server = wiremock::MockServer::start().await;
        let (cache, clock) = cache_against(&server);
        mount(&server, wiremock::ResponseTemplate::new(503)).await;

        let mut tasks = Vec::new();
        for _ in 0..3 {
            let cache = Arc::clone(&cache);
            tasks.push(tokio::spawn(async move { cache.key_for(KID).await }));
        }
        for task in tasks {
            assert_eq!(
                task.await.unwrap().unwrap_err(),
                KeyLookupError::Unavailable
            );
        }
        assert_eq!(upstream_calls(&server).await, 1, "shared attempt");
        assert_eq!(
            cache.key_for(KID).await.unwrap_err(),
            KeyLookupError::Unavailable
        );
        assert_eq!(upstream_calls(&server).await, 1, "failure is throttled");

        mount(
            &server,
            wiremock::ResponseTemplate::new(200).set_body_string(SUPABASE_JWKS),
        )
        .await;
        clock.advance(MISSING_KEYS_RETRY_INTERVAL);
        assert!(cache.key_for(KID).await.is_ok());
        assert_eq!(upstream_calls(&server).await, 1);
    }

    /// A forged token with an unknown kid costs at most one upstream call per interval, and
    /// concurrent ones share it.
    #[tokio::test]
    async fn unknown_kids_trigger_at_most_one_refresh_per_interval() {
        let server = wiremock::MockServer::start().await;
        let (cache, clock) = cache_against(&server);
        cache.install_static(SUPABASE_JWKS.as_bytes()).unwrap();
        mount(
            &server,
            wiremock::ResponseTemplate::new(200).set_body_string(SUPABASE_JWKS),
        )
        .await;
        let mut tasks = Vec::new();
        for i in 0..5 {
            let cache = Arc::clone(&cache);
            tasks.push(tokio::spawn(async move {
                cache.key_for(&format!("forged-{i}")).await
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap().unwrap_err(), KeyLookupError::UnknownKid);
        }
        assert_eq!(upstream_calls(&server).await, 1);
        clock.advance(UNKNOWN_KID_REFRESH_INTERVAL);
        assert_eq!(
            cache.key_for("forged-again").await.unwrap_err(),
            KeyLookupError::UnknownKid
        );
        assert_eq!(upstream_calls(&server).await, 2);
    }
}
