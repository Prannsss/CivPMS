//! A small circuit breaker for upstream (Supabase) reads.
//!
//! * **Closed**: calls pass; `threshold` consecutive failures open the circuit.
//! * **Open**: calls fail immediately (the cache then serves stale data) until `cooldown`
//!   has passed.
//! * **Half-open**: exactly one probe call is let through; success closes the circuit,
//!   failure re-opens it for another cool-down.

use std::time::Duration;

use parking_lot::Mutex;

use crate::clock::SharedClock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug)]
struct Inner {
    state: BreakerState,
    consecutive_failures: u32,
    opened_at_ms: u64,
    probe_in_flight: bool,
}

#[derive(Debug)]
pub struct CircuitBreaker {
    name: &'static str,
    threshold: u32,
    cooldown: Duration,
    clock: SharedClock,
    inner: Mutex<Inner>,
}

/// Returned when the circuit refuses a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("circuit open")]
pub struct CircuitOpen;

impl CircuitBreaker {
    pub fn new(name: &'static str, threshold: u32, cooldown: Duration, clock: SharedClock) -> Self {
        Self {
            name,
            threshold: threshold.max(1),
            cooldown,
            clock,
            inner: Mutex::new(Inner {
                state: BreakerState::Closed,
                consecutive_failures: 0,
                opened_at_ms: 0,
                probe_in_flight: false,
            }),
        }
    }

    pub fn state(&self) -> BreakerState {
        self.inner.lock().state
    }

    /// Asks permission for one call. Every `Ok` must be followed by exactly one
    /// [`CircuitBreaker::record_success`] or [`CircuitBreaker::record_failure`].
    pub fn acquire(&self) -> Result<(), CircuitOpen> {
        let mut inner = self.inner.lock();
        match inner.state {
            BreakerState::Closed => Ok(()),
            BreakerState::Open => {
                let now = self.clock.now_ms();
                if now.saturating_sub(inner.opened_at_ms) >= self.cooldown.as_millis() as u64 {
                    inner.state = BreakerState::HalfOpen;
                    inner.probe_in_flight = true;
                    tracing::info!(breaker = self.name, "circuit half-open; probing upstream");
                    Ok(())
                } else {
                    Err(CircuitOpen)
                }
            }
            BreakerState::HalfOpen => {
                if inner.probe_in_flight {
                    Err(CircuitOpen)
                } else {
                    inner.probe_in_flight = true;
                    Ok(())
                }
            }
        }
    }

    pub fn record_success(&self) {
        let mut inner = self.inner.lock();
        if inner.state != BreakerState::Closed {
            tracing::info!(breaker = self.name, "circuit closed; upstream recovered");
        }
        inner.state = BreakerState::Closed;
        inner.consecutive_failures = 0;
        inner.probe_in_flight = false;
    }

    pub fn record_failure(&self) {
        let mut inner = self.inner.lock();
        inner.probe_in_flight = false;
        match inner.state {
            BreakerState::HalfOpen => {
                inner.state = BreakerState::Open;
                inner.opened_at_ms = self.clock.now_ms();
                tracing::warn!(breaker = self.name, "probe failed; circuit re-opened");
            }
            BreakerState::Closed => {
                inner.consecutive_failures += 1;
                if inner.consecutive_failures >= self.threshold {
                    inner.state = BreakerState::Open;
                    inner.opened_at_ms = self.clock.now_ms();
                    tracing::warn!(
                        breaker = self.name,
                        failures = inner.consecutive_failures,
                        "circuit opened; failing fast"
                    );
                }
            }
            BreakerState::Open => {}
        }
    }

    /// Releases a permit without judging the upstream (e.g. the caller was cancelled or the
    /// upstream gave a definitive 4xx answer, which means it is healthy).
    pub fn record_neutral(&self) {
        self.record_success();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;

    fn breaker() -> (CircuitBreaker, std::sync::Arc<ManualClock>) {
        let clock = ManualClock::new(0);
        (CircuitBreaker::new("test", 3, Duration::from_secs(10), clock.clone()), clock)
    }

    #[test]
    fn opens_after_threshold_and_fails_fast() {
        let (b, _) = breaker();
        for _ in 0..2 {
            b.acquire().unwrap();
            b.record_failure();
        }
        assert_eq!(b.state(), BreakerState::Closed);
        b.acquire().unwrap();
        b.record_failure();
        assert_eq!(b.state(), BreakerState::Open);
        assert_eq!(b.acquire(), Err(CircuitOpen));
    }

    #[test]
    fn success_resets_the_failure_count() {
        let (b, _) = breaker();
        for _ in 0..2 {
            b.acquire().unwrap();
            b.record_failure();
        }
        b.acquire().unwrap();
        b.record_success();
        for _ in 0..2 {
            b.acquire().unwrap();
            b.record_failure();
        }
        assert_eq!(b.state(), BreakerState::Closed);
    }

    #[test]
    fn half_open_allows_one_probe() {
        let (b, clock) = breaker();
        for _ in 0..3 {
            b.acquire().unwrap();
            b.record_failure();
        }
        clock.advance(Duration::from_secs(10));
        b.acquire().unwrap();
        assert_eq!(b.state(), BreakerState::HalfOpen);
        assert_eq!(b.acquire(), Err(CircuitOpen), "only one probe at a time");

        // Failed probe: open again for a full cool-down.
        b.record_failure();
        assert_eq!(b.state(), BreakerState::Open);
        clock.advance(Duration::from_secs(5));
        assert_eq!(b.acquire(), Err(CircuitOpen));

        // Successful probe closes it.
        clock.advance(Duration::from_secs(5));
        b.acquire().unwrap();
        b.record_success();
        assert_eq!(b.state(), BreakerState::Closed);
        b.acquire().unwrap();
    }
}
