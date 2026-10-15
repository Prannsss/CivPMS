//! Injectable wall clock, so time-based logic (cache freshness, rate-limit windows, circuit
//! breaker cool-downs, keep-alive) is unit-testable without sleeping.

use std::fmt::Debug;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch.
pub trait Clock: Send + Sync + Debug + 'static {
    fn now_ms(&self) -> u64;

    fn now_secs(&self) -> u64 {
        self.now_ms() / 1000
    }
}

pub type SharedClock = Arc<dyn Clock>;

/// The real clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64)
    }
}

/// A clock that only moves when told to (tests).
#[derive(Debug)]
pub struct ManualClock(AtomicU64);

impl ManualClock {
    pub fn new(start_ms: u64) -> Arc<Self> {
        Arc::new(Self(AtomicU64::new(start_ms)))
    }

    pub fn advance(&self, by: Duration) {
        self.0.fetch_add(by.as_millis() as u64, Ordering::SeqCst);
    }

    pub fn set_ms(&self, ms: u64) {
        self.0.store(ms, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

pub fn system() -> SharedClock {
    Arc::new(SystemClock)
}
