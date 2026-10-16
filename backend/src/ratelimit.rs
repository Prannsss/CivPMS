//! Per-user rate limiting with a sliding-window approximation.
//!
//! Each (class, user) pair keeps a counter for the current and the previous fixed window; the
//! estimate is `previous × (unelapsed share of the window) + current`. This smooths the burst
//! a plain fixed window allows at window boundaries, and needs only two integers per user.
//! Counters live in Redis so limits hold across instances and restarts; while Redis is
//! unavailable an in-memory limiter with the same algorithm takes over.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use redis::Script;
use uuid::Uuid;

use crate::clock::SharedClock;
use crate::config::RateLimitConfig;
use crate::error::{AppError, ErrorCode};
use crate::redis_client::RedisHandle;

const WINDOW_MS: u64 = 60_000;
const MEMORY_MAX_KEYS: usize = 50_000;

/// Which budget a request draws from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RateClass {
    Upload,
    Read,
}

impl RateClass {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Read => "read",
        }
    }
}

/// Outcome of one check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    pub allowed: bool,
    pub limit: u32,
    pub remaining: u32,
    /// Seconds until the current window ends (used for `Retry-After`).
    pub reset_secs: u64,
}

/// Pure decision function (unit-tested).
pub fn decide(limit: u32, now_ms: u64, current: u64, previous: u64) -> Decision {
    let elapsed = now_ms % WINDOW_MS;
    let weight = (WINDOW_MS - elapsed) as f64 / WINDOW_MS as f64;
    let estimate = (previous as f64).mul_add(weight, current as f64);
    let allowed = estimate <= f64::from(limit);
    let remaining = (f64::from(limit) - estimate).floor().max(0.0) as u32;
    Decision {
        allowed,
        limit,
        remaining,
        reset_secs: (WINDOW_MS - elapsed).div_ceil(1000).max(1),
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct Counter {
    window: u64,
    current: u64,
    previous: u64,
}

const SCRIPT: &str = r"
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
return {current, previous}
";

#[derive(Debug)]
pub struct RateLimiter {
    redis: Arc<RedisHandle>,
    memory: Mutex<HashMap<(RateClass, Uuid), Counter>>,
    limits: RateLimitConfig,
    clock: SharedClock,
    script: Script,
}

impl RateLimiter {
    pub fn new(redis: Arc<RedisHandle>, limits: RateLimitConfig, clock: SharedClock) -> Self {
        Self {
            redis,
            memory: Mutex::new(HashMap::new()),
            limits,
            clock,
            script: Script::new(SCRIPT),
        }
    }

    const fn limit(&self, class: RateClass) -> u32 {
        match class {
            RateClass::Upload => self.limits.uploads_per_minute,
            RateClass::Read => self.limits.reads_per_minute,
        }
    }

    /// Counts one request and returns `429 RATE_LIMITED` when the budget is exhausted.
    pub async fn check(&self, class: RateClass, user: Uuid) -> Result<Decision, AppError> {
        let now = self.clock.now_ms();
        let window = now / WINDOW_MS;
        let counts = self.count_in_redis(class, user, window).await;
        let (current, previous) = match counts {
            Some(counts) => counts,
            None => self.count_in_memory(class, user, window),
        };
        let decision = decide(self.limit(class), now, current, previous);
        if decision.allowed {
            Ok(decision)
        } else {
            Err(AppError::new(
                ErrorCode::RateLimited,
                "Too many requests. Wait a moment and try again.",
            )
            .with_retry_after(decision.reset_secs))
        }
    }

    async fn count_in_redis(
        &self,
        class: RateClass,
        user: Uuid,
        window: u64,
    ) -> Option<(u64, u64)> {
        let current_key = format!("rl:v1:{}:{user}:{window}", class.as_str());
        let previous_key = format!(
            "rl:v1:{}:{user}:{}",
            class.as_str(),
            window.saturating_sub(1)
        );
        let script = &self.script;
        self.redis
            .run("rate_limit", |mut conn| async move {
                script
                    .key(&current_key)
                    .key(&previous_key)
                    .arg(WINDOW_MS * 2)
                    .invoke_async::<(u64, u64)>(&mut conn)
                    .await
            })
            .await
            .ok()
    }

    fn count_in_memory(&self, class: RateClass, user: Uuid, window: u64) -> (u64, u64) {
        let mut map = self.memory.lock();
        if map.len() >= MEMORY_MAX_KEYS {
            map.retain(|_, c| c.window + 1 >= window);
        }
        let counter = map.entry((class, user)).or_default();
        if counter.window == window {
            counter.current += 1;
        } else if counter.window + 1 == window {
            *counter = Counter {
                window,
                current: 1,
                previous: counter.current,
            };
        } else {
            *counter = Counter {
                window,
                current: 1,
                previous: 0,
            };
        }
        (counter.current, counter.previous)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;
    use std::time::Duration;

    #[test]
    fn decide_allows_up_to_the_limit_in_one_window() {
        assert!(decide(30, 0, 30, 0).allowed);
        assert!(!decide(30, 0, 31, 0).allowed);
        assert_eq!(decide(30, 0, 10, 0).remaining, 20);
    }

    #[test]
    fn decide_weights_the_previous_window() {
        // Half-way through the window, half of the previous window still counts.
        let half = WINDOW_MS / 2;
        assert!(decide(30, half, 15, 30).allowed); // 15 + 15 = 30
        assert!(!decide(30, half, 16, 30).allowed); // 16 + 15 = 31
        assert_eq!(decide(30, half, 1, 0).reset_secs, 30);
    }

    #[tokio::test]
    async fn memory_limiter_blocks_then_recovers() {
        let clock = ManualClock::new(10 * WINDOW_MS);
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        let limiter = RateLimiter::new(
            redis,
            RateLimitConfig {
                uploads_per_minute: 3,
                reads_per_minute: 100,
            },
            clock.clone(),
        );
        let user = Uuid::new_v4();
        for _ in 0..3 {
            limiter.check(RateClass::Upload, user).await.unwrap();
        }
        let err = limiter.check(RateClass::Upload, user).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RateLimited);
        assert_eq!(err.retry_after, Some(60));

        // Other users and other classes have their own budgets.
        limiter
            .check(RateClass::Upload, Uuid::new_v4())
            .await
            .unwrap();
        limiter.check(RateClass::Read, user).await.unwrap();

        // Two windows later the budget is back.
        clock.advance(Duration::from_millis(2 * WINDOW_MS));
        limiter.check(RateClass::Upload, user).await.unwrap();
    }
}
