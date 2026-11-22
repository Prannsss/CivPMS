//! Read-through cache (cache-aside) with stale-while-revalidate and stale-on-error.
//!
//! Lookup order: Redis, then the in-memory mirror (used while Redis is down). An entry's age
//! decides what happens:
//!
//! | age                        | behaviour                                                    |
//! |----------------------------|--------------------------------------------------------------|
//! | `< ttl`                    | served (`HIT`)                                               |
//! | `< ttl + swr`              | served (`HIT`) and refreshed in the background               |
//! | older, or missing          | fetched (`MISS`); concurrent misses share one fetch          |
//! | fetch fails (5xx/timeout/  | the last good value is served (`STALE`) while its age is     |
//! | circuit open/deadline)     | `< ttl + stale_max`; otherwise `503 UPSTREAM_UNAVAILABLE`    |
//!
//! Definitive upstream answers (401, 404, …) are never masked by stale data.
//!
//! A request waits for the upstream only until its `deadline` (set before the request
//! timeout, see `Config::upstream_read_budget`). The fetch itself runs in its own task, so a
//! caller that stops waiting (deadline, client disconnect) never cancels it: its outcome is
//! still recorded by the circuit breaker and a late success still refreshes the cache.

pub mod memory;
pub mod singleflight;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::Instant;

use crate::clock::SharedClock;
use crate::error::AppError;
use crate::redis_client::RedisHandle;

use memory::MemoryStore;
use singleflight::SingleFlight;

/// Entries larger than this are served but not cached.
const MAX_ENTRY_BYTES: usize = 1024 * 1024;
/// Extra wait past the deadline, so a fetch that gives up exactly at the deadline (and has
/// recorded its failure) is preferred over this safety net.
const DEADLINE_GRACE: Duration = Duration::from_millis(500);

/// How a response was produced (`x-cache` header).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    Hit,
    Miss,
    Stale,
    Bypass,
}

impl CacheStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Hit => "HIT",
            Self::Miss => "MISS",
            Self::Stale => "STALE",
            Self::Bypass => "BYPASS",
        }
    }
}

/// Freshness rules for one kind of data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CachePolicy {
    pub ttl: Duration,
    /// Extra time during which a value is still served while a background refresh runs.
    pub swr: Duration,
    /// Extra time during which a value may be served when the upstream fails.
    pub stale_max: Duration,
}

impl CachePolicy {
    fn retention_ms(&self) -> u64 {
        (self.ttl + self.swr.max(self.stale_max)).as_millis() as u64
    }
}

/// Why a fetch failed.
#[derive(Debug, Clone, thiserror::Error)]
pub enum FetchError {
    /// Transient: timeouts, 5xx, connection errors, open circuit. Stale data may be served.
    #[error("upstream unavailable: {0}")]
    Unavailable(String),
    /// A definitive answer to pass through unchanged (e.g. 401, 404, 400).
    #[error(transparent)]
    Rejected(AppError),
}

#[derive(Debug, Clone)]
pub struct CacheResult {
    pub value: Arc<Value>,
    pub status: CacheStatus,
    pub age: Duration,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    /// Stored at (unix ms).
    t: u64,
    v: Value,
}

type FlightResult = Result<Arc<Value>, FetchError>;

#[derive(Debug)]
pub struct Cache {
    redis: Arc<RedisHandle>,
    memory: MemoryStore,
    flights: SingleFlight<FlightResult>,
    clock: SharedClock,
}

impl Cache {
    pub fn new(redis: Arc<RedisHandle>, memory_capacity: usize, clock: SharedClock) -> Self {
        Self {
            redis,
            memory: MemoryStore::new(memory_capacity),
            flights: SingleFlight::default(),
            clock,
        }
    }

    /// Returns the cached value for `key`, fetching it with `fetch` when needed.
    /// `bypass` (client sent `Cache-Control: no-cache`) skips serving cached values but still
    /// stores the fresh one and still falls back to stale data on upstream failure.
    /// The caller waits for `fetch` until `deadline` (plus a short grace); after that it is
    /// treated as an upstream failure.
    pub async fn get_or_fetch<F, Fut>(
        self: &Arc<Self>,
        key: String,
        policy: CachePolicy,
        bypass: bool,
        deadline: Instant,
        fetch: F,
    ) -> Result<CacheResult, AppError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value, FetchError>> + Send + 'static,
    {
        let now = self.clock.now_ms();
        let cached = self.read(&key, now).await;
        let ttl_ms = policy.ttl.as_millis() as u64;

        if let Some(entry) = &cached {
            let age_ms = now.saturating_sub(entry.t);
            if !bypass && age_ms < ttl_ms {
                return Ok(Self::result(entry, CacheStatus::Hit, age_ms));
            }
            if !bypass && age_ms < ttl_ms + policy.swr.as_millis() as u64 {
                let this = Arc::clone(self);
                let refresh_key = key.clone();
                tokio::spawn(async move {
                    if let Err(e) = this.fetch_and_store(&refresh_key, policy, fetch).await {
                        tracing::debug!(error = %e, "background refresh failed");
                    }
                });
                return Ok(Self::result(entry, CacheStatus::Hit, age_ms));
            }
        }

        let this = Arc::clone(self);
        let flight_key = key.clone();
        let flight =
            tokio::spawn(async move { this.fetch_and_store(&flight_key, policy, fetch).await });
        let fetched = match tokio::time::timeout_at(deadline + DEADLINE_GRACE, flight).await {
            Ok(Ok(result)) => result,
            Ok(Err(join_error)) => {
                tracing::error!(error = %join_error, "cache fetch task failed");
                Err(FetchError::Unavailable("fetch task failed".into()))
            }
            Err(_) => Err(FetchError::Unavailable(
                "upstream did not answer before the deadline".into(),
            )),
        };
        match fetched {
            Ok(value) => Ok(CacheResult {
                value,
                status: if bypass {
                    CacheStatus::Bypass
                } else {
                    CacheStatus::Miss
                },
                age: Duration::ZERO,
            }),
            Err(FetchError::Rejected(error)) => Err(error),
            Err(FetchError::Unavailable(reason)) => {
                let limit_ms = ttl_ms + policy.stale_max.as_millis() as u64;
                match cached {
                    Some(entry) if now.saturating_sub(entry.t) < limit_ms => {
                        tracing::warn!(%reason, "upstream unavailable; serving stale cache entry");
                        Ok(Self::result(
                            &entry,
                            CacheStatus::Stale,
                            now.saturating_sub(entry.t),
                        ))
                    }
                    _ => {
                        tracing::warn!(%reason, "upstream unavailable and no usable cache entry");
                        Err(AppError::upstream_unavailable())
                    }
                }
            }
        }
    }

    /// Reads a value written with [`Cache::put`] (no freshness logic). Used for small
    /// independent caches such as signed URLs.
    pub async fn get_raw(&self, key: &str) -> Option<Value> {
        self.read(key, self.clock.now_ms()).await.map(|e| e.v)
    }

    /// Stores a value with a fixed time-to-live.
    pub async fn put(&self, key: &str, value: &Value, ttl: Duration) {
        let entry = Entry {
            t: self.clock.now_ms(),
            v: value.clone(),
        };
        self.write(key, &entry, ttl.as_millis() as u64).await;
    }

    fn result(entry: &Entry, status: CacheStatus, age_ms: u64) -> CacheResult {
        CacheResult {
            value: Arc::new(entry.v.clone()),
            status,
            age: Duration::from_millis(age_ms),
        }
    }

    async fn fetch_and_store<F, Fut>(
        &self,
        key: &str,
        policy: CachePolicy,
        fetch: F,
    ) -> FlightResult
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Value, FetchError>>,
    {
        let (result, _leader) = self
            .flights
            .run(key, || async {
                let value = fetch().await?;
                let entry = Entry {
                    t: self.clock.now_ms(),
                    v: value,
                };
                self.write(key, &entry, policy.retention_ms()).await;
                Ok(Arc::new(entry.v))
            })
            .await;
        result
    }

    async fn read(&self, key: &str, now: u64) -> Option<Entry> {
        let from_redis = self
            .redis
            .run("cache_get", |mut conn| async move {
                redis::cmd("GET")
                    .arg(key)
                    .query_async::<Option<Vec<u8>>>(&mut conn)
                    .await
            })
            .await;
        let bytes: Option<Arc<[u8]>> = match from_redis {
            Ok(Some(bytes)) => Some(Arc::from(bytes)),
            Ok(None) | Err(_) => self.memory.get(key, now),
        };
        bytes.and_then(|b| serde_json::from_slice::<Entry>(&b).ok())
    }

    async fn write(&self, key: &str, entry: &Entry, retention_ms: u64) {
        let Ok(bytes) = serde_json::to_vec(entry) else {
            return;
        };
        if bytes.len() > MAX_ENTRY_BYTES {
            tracing::debug!(len = bytes.len(), "cache entry too large; not cached");
            return;
        }
        let bytes: Arc<[u8]> = Arc::from(bytes);
        self.memory
            .set(key, Arc::clone(&bytes), retention_ms, self.clock.now_ms());
        let _ = self
            .redis
            .run("cache_set", |mut conn| {
                let bytes = Arc::clone(&bytes);
                async move {
                    redis::cmd("SET")
                        .arg(key)
                        .arg(&*bytes)
                        .arg("PX")
                        .arg(retention_ms.max(1))
                        .query_async::<()>(&mut conn)
                        .await
                }
            })
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;
    use crate::error::ErrorCode;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const POLICY: CachePolicy = CachePolicy {
        ttl: Duration::from_secs(30),
        swr: Duration::from_secs(30),
        stale_max: Duration::from_mins(10),
    };

    fn far() -> Instant {
        Instant::now() + Duration::from_mins(1)
    }

    fn cache() -> (Arc<Cache>, Arc<ManualClock>) {
        let clock = ManualClock::new(1_000_000);
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        (Arc::new(Cache::new(redis, 100, clock.clone())), clock)
    }

    async fn ok(cache: &Arc<Cache>, value: Value) -> CacheResult {
        cache
            .get_or_fetch("k".into(), POLICY, false, far(), move || async move {
                Ok(value)
            })
            .await
            .unwrap()
    }

    async fn failing(cache: &Arc<Cache>) -> Result<CacheResult, AppError> {
        cache
            .get_or_fetch("k".into(), POLICY, false, far(), || async {
                Err(FetchError::Unavailable("timeout".into()))
            })
            .await
    }

    #[tokio::test]
    async fn miss_then_hit() {
        let (cache, clock) = cache();
        assert_eq!(ok(&cache, json!(1)).await.status, CacheStatus::Miss);
        clock.advance(Duration::from_secs(10));
        let hit = ok(&cache, json!(2)).await;
        assert_eq!((hit.status, &*hit.value), (CacheStatus::Hit, &json!(1)));
        assert_eq!(hit.age, Duration::from_secs(10));
    }

    #[tokio::test]
    async fn serves_stale_on_upstream_error_until_stale_max() {
        let (cache, clock) = cache();
        ok(&cache, json!({"v": 1})).await;
        clock.advance(Duration::from_mins(2)); // past ttl + swr
        let stale = failing(&cache).await.unwrap();
        assert_eq!(stale.status, CacheStatus::Stale);
        assert_eq!(*stale.value, json!({"v": 1}));

        clock.advance(Duration::from_mins(10)); // now past ttl + stale_max
        let err = failing(&cache).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::UpstreamUnavailable);
        assert!(err.retry_after.is_some());
    }

    #[tokio::test]
    async fn no_entry_and_upstream_down_is_503() {
        let (cache, _) = cache();
        assert_eq!(
            failing(&cache).await.unwrap_err().code,
            ErrorCode::UpstreamUnavailable
        );
    }

    #[tokio::test]
    async fn rejections_are_never_masked_by_stale_data() {
        let (cache, clock) = cache();
        ok(&cache, json!(1)).await;
        clock.advance(Duration::from_mins(2));
        let err = cache
            .get_or_fetch("k".into(), POLICY, false, far(), || async {
                Err(FetchError::Rejected(AppError::not_found("gone")))
            })
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[tokio::test]
    async fn stale_while_revalidate_refreshes_in_background() {
        let (cache, clock) = cache();
        ok(&cache, json!(1)).await;
        clock.advance(Duration::from_secs(40)); // inside the swr window
        let served = ok(&cache, json!(2)).await;
        assert_eq!(
            (served.status, &*served.value),
            (CacheStatus::Hit, &json!(1))
        );
        // Let the background refresh finish, then the new value is a fresh hit.
        for _ in 0..50 {
            tokio::task::yield_now().await;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        let refreshed = ok(&cache, json!(3)).await;
        assert_eq!(
            (refreshed.status, &*refreshed.value),
            (CacheStatus::Hit, &json!(2))
        );
    }

    #[tokio::test]
    async fn bypass_fetches_fresh_but_keeps_stale_fallback() {
        let (cache, _) = cache();
        ok(&cache, json!(1)).await;
        let fresh = cache
            .get_or_fetch("k".into(), POLICY, true, far(), || async { Ok(json!(2)) })
            .await
            .unwrap();
        assert_eq!(
            (fresh.status, &*fresh.value),
            (CacheStatus::Bypass, &json!(2))
        );
        let fallback = cache
            .get_or_fetch("k".into(), POLICY, true, far(), || async {
                Err(FetchError::Unavailable("down".into()))
            })
            .await
            .unwrap();
        assert_eq!(
            (fallback.status, &*fallback.value),
            (CacheStatus::Stale, &json!(2))
        );
    }

    #[tokio::test]
    async fn burst_of_misses_makes_one_upstream_call() {
        let (cache, _) = cache();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..25 {
            let cache = Arc::clone(&cache);
            let calls = Arc::clone(&calls);
            tasks.push(tokio::spawn(async move {
                cache
                    .get_or_fetch("burst".into(), POLICY, false, far(), move || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok(json!("v"))
                    })
                    .await
                    .unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(*task.await.unwrap().value, json!("v"));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    /// Regression (review finding): a hanging upstream must not hold the request past its
    /// deadline; the stale value is served and the fetch keeps running on its own.
    #[tokio::test]
    async fn deadline_serves_stale_and_a_late_answer_still_refreshes_the_cache() {
        let (cache, clock) = cache();
        ok(&cache, json!("old")).await;
        clock.advance(Duration::from_mins(2)); // past ttl + swr
        let started = std::time::Instant::now();
        let deadline = Instant::now() + Duration::from_millis(100);
        let stale = cache
            .get_or_fetch("k".into(), POLICY, false, deadline, || async {
                tokio::time::sleep(Duration::from_millis(1_500)).await;
                Ok(json!("new"))
            })
            .await
            .unwrap();
        assert_eq!(
            (stale.status, &*stale.value),
            (CacheStatus::Stale, &json!("old"))
        );
        assert!(started.elapsed() < Duration::from_secs(1));

        tokio::time::sleep(Duration::from_millis(1_200)).await;
        let fresh = ok(&cache, json!("unused")).await;
        assert_eq!(
            (fresh.status, &*fresh.value),
            (CacheStatus::Hit, &json!("new"))
        );
    }

    #[tokio::test]
    async fn deadline_without_a_stale_entry_is_503() {
        let (cache, _) = cache();
        let deadline = Instant::now() + Duration::from_millis(50);
        let err = cache
            .get_or_fetch("k".into(), POLICY, false, deadline, || async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Ok(json!(1))
            })
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::UpstreamUnavailable);
    }

    #[tokio::test]
    async fn put_and_get_raw() {
        let (cache, clock) = cache();
        cache
            .put("sig", &json!("url"), Duration::from_secs(5))
            .await;
        assert_eq!(cache.get_raw("sig").await, Some(json!("url")));
        clock.advance(Duration::from_secs(6));
        assert_eq!(cache.get_raw("sig").await, None);
    }
}
