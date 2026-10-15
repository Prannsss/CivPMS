//! Thin wrapper around a lazily-connected Redis `ConnectionManager`.
//!
//! Redis is optional: when it is not configured, or down, every caller falls back to an
//! in-memory equivalent. To keep a dead Redis from adding latency to every request, a failed
//! operation opens a short back-off window during which calls fail fast. Outages are logged
//! once per minute, recoveries once.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use redis::aio::{ConnectionManager, ConnectionManagerConfig};

use crate::clock::SharedClock;
use crate::telemetry::LogThrottle;

/// Why a Redis call did not happen or did not succeed.
#[derive(Debug, thiserror::Error)]
pub enum RedisUnavailable {
    #[error("redis is not configured")]
    NotConfigured,
    #[error("redis is in back-off after a recent failure")]
    Backoff,
    #[error("redis timed out")]
    Timeout,
    #[error("redis error: {0}")]
    Failed(#[from] redis::RedisError),
}

const BACKOFF: Duration = Duration::from_secs(5);

pub struct RedisHandle {
    manager: Option<ConnectionManager>,
    op_timeout: Duration,
    skip_until_ms: AtomicU64,
    degraded: AtomicBool,
    throttle: LogThrottle,
    clock: SharedClock,
}

impl std::fmt::Debug for RedisHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RedisHandle")
            .field("configured", &self.manager.is_some())
            .field("degraded", &self.degraded.load(Ordering::Relaxed))
            .finish_non_exhaustive()
    }
}

impl RedisHandle {
    /// A handle that always reports `NotConfigured` (Redis disabled).
    pub fn disabled(clock: SharedClock) -> Self {
        Self::build(None, Duration::from_millis(250), clock)
    }

    /// Creates the manager without connecting; the first command connects.
    pub fn connect_lazy(url: &str, op_timeout: Duration, clock: SharedClock) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        let config = ConnectionManagerConfig::new()
            .set_connection_timeout(Some(Duration::from_secs(1)))
            .set_response_timeout(Some(op_timeout))
            .set_number_of_retries(1)
            .set_max_delay(Duration::from_secs(2));
        let manager = ConnectionManager::new_lazy_with_config(client, config)?;
        Ok(Self::build(Some(manager), op_timeout, clock))
    }

    fn build(manager: Option<ConnectionManager>, op_timeout: Duration, clock: SharedClock) -> Self {
        Self {
            manager,
            op_timeout,
            skip_until_ms: AtomicU64::new(0),
            degraded: AtomicBool::new(false),
            throttle: LogThrottle::new(Duration::from_secs(60)),
            clock,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.manager.is_some()
    }

    /// True while the last operation failed (callers use their in-memory fallbacks).
    pub fn is_degraded(&self) -> bool {
        self.degraded.load(Ordering::Relaxed)
    }

    /// Runs one operation with a timeout, unless Redis is unconfigured or in back-off.
    pub async fn run<T, F, Fut>(&self, op: &'static str, f: F) -> Result<T, RedisUnavailable>
    where
        F: FnOnce(ConnectionManager) -> Fut,
        Fut: Future<Output = redis::RedisResult<T>>,
    {
        let Some(manager) = &self.manager else {
            return Err(RedisUnavailable::NotConfigured);
        };
        if self.clock.now_ms() < self.skip_until_ms.load(Ordering::Relaxed) {
            return Err(RedisUnavailable::Backoff);
        }
        let result = match tokio::time::timeout(self.op_timeout, f(manager.clone())).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(e)) => Err(RedisUnavailable::Failed(e)),
            Err(_) => Err(RedisUnavailable::Timeout),
        };
        match &result {
            Ok(_) => self.mark_ok(),
            Err(e) => self.mark_failed(op, e),
        }
        result
    }

    /// Readiness probe: pings even during back-off and reports the round-trip time.
    pub async fn ping(&self) -> Result<Duration, RedisUnavailable> {
        let Some(manager) = &self.manager else {
            return Err(RedisUnavailable::NotConfigured);
        };
        let started = Instant::now();
        let mut conn = manager.clone();
        let result = tokio::time::timeout(self.op_timeout, async move {
            redis::cmd("PING").query_async::<String>(&mut conn).await
        })
        .await;
        match result {
            Ok(Ok(_)) => {
                self.mark_ok();
                Ok(started.elapsed())
            }
            Ok(Err(e)) => {
                let err = RedisUnavailable::Failed(e);
                self.mark_failed("ping", &err);
                Err(err)
            }
            Err(_) => {
                self.mark_failed("ping", &RedisUnavailable::Timeout);
                Err(RedisUnavailable::Timeout)
            }
        }
    }

    fn mark_ok(&self) {
        if self.degraded.swap(false, Ordering::Relaxed) {
            tracing::info!("redis recovered; using it again");
        }
    }

    fn mark_failed(&self, op: &'static str, error: &RedisUnavailable) {
        let now = self.clock.now_ms();
        self.skip_until_ms.store(now + BACKOFF.as_millis() as u64, Ordering::Relaxed);
        self.degraded.store(true, Ordering::Relaxed);
        if self.throttle.should_log(now) {
            tracing::warn!(op, error = %error, "redis unavailable; serving from in-memory fallbacks");
        }
    }
}
