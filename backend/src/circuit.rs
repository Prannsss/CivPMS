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

    /// Asks permission for one call. The returned [`Permit`] must be resolved with
    /// [`Permit::success`], [`Permit::failure`] or [`Permit::healthy`]; dropping it unresolved
    /// (the caller was cancelled) releases the slot without judging the upstream, so a
    /// cancelled half-open probe can never wedge the circuit open.
    pub fn acquire(&self) -> Result<Permit<'_>, CircuitOpen> {
        let mut inner = self.inner.lock();
        match inner.state {
            BreakerState::Closed => {}
            BreakerState::Open => {
                let now = self.clock.now_ms();
                if now.saturating_sub(inner.opened_at_ms) < self.cooldown.as_millis() as u64 {
                    return Err(CircuitOpen);
                }
                inner.state = BreakerState::HalfOpen;
                inner.probe_in_flight = true;
                tracing::info!(breaker = self.name, "circuit half-open; probing upstream");
            }
            BreakerState::HalfOpen => {
                if inner.probe_in_flight {
                    return Err(CircuitOpen);
                }
                inner.probe_in_flight = true;
            }
        }
        Ok(Permit {
            breaker: self,
            resolved: false,
        })
    }

    fn record_success(&self) {
        let mut inner = self.inner.lock();
        if inner.state != BreakerState::Closed {
            tracing::info!(breaker = self.name, "circuit closed; upstream recovered");
        }
        inner.state = BreakerState::Closed;
        inner.consecutive_failures = 0;
        inner.probe_in_flight = false;
    }

    fn record_failure(&self) {
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

    fn release(&self) {
        self.inner.lock().probe_in_flight = false;
    }
}

/// Permission for one upstream call (see [`CircuitBreaker::acquire`]).
#[derive(Debug)]
#[must_use = "resolve the permit with success(), failure() or healthy()"]
pub struct Permit<'a> {
    breaker: &'a CircuitBreaker,
    resolved: bool,
}

impl Permit<'_> {
    /// The call succeeded.
    pub fn success(mut self) {
        self.resolved = true;
        self.breaker.record_success();
    }

    /// The call failed in a way that says the upstream is unhealthy (timeout, 5xx, …).
    pub fn failure(mut self) {
        self.resolved = true;
        self.breaker.record_failure();
    }

    /// The upstream answered definitively (e.g. 401/404): it is healthy even though the call
    /// did not succeed.
    pub fn healthy(self) {
        self.success();
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        if !self.resolved {
            self.breaker.release();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;

    fn breaker() -> (CircuitBreaker, std::sync::Arc<ManualClock>) {
        let clock = ManualClock::new(0);
        (
            CircuitBreaker::new("test", 3, Duration::from_secs(10), clock.clone()),
            clock,
        )
    }

    fn fail(b: &CircuitBreaker, times: usize) {
        for _ in 0..times {
            b.acquire().unwrap().failure();
        }
    }

    #[test]
    fn opens_after_threshold_and_fails_fast() {
        let (b, _) = breaker();
        fail(&b, 2);
        assert_eq!(b.state(), BreakerState::Closed);
        fail(&b, 1);
        assert_eq!(b.state(), BreakerState::Open);
        assert_eq!(b.acquire().unwrap_err(), CircuitOpen);
    }

    #[test]
    fn success_and_definitive_answers_reset_the_failure_count() {
        let (b, _) = breaker();
        fail(&b, 2);
        b.acquire().unwrap().success();
        fail(&b, 2);
        b.acquire().unwrap().healthy();
        fail(&b, 2);
        assert_eq!(b.state(), BreakerState::Closed);
    }

    #[test]
    fn half_open_allows_one_probe() {
        let (b, clock) = breaker();
        fail(&b, 3);
        clock.advance(Duration::from_secs(10));
        let probe = b.acquire().unwrap();
        assert_eq!(b.state(), BreakerState::HalfOpen);
        assert_eq!(
            b.acquire().unwrap_err(),
            CircuitOpen,
            "only one probe at a time"
        );

        // Failed probe: open again for a full cool-down.
        probe.failure();
        assert_eq!(b.state(), BreakerState::Open);
        clock.advance(Duration::from_secs(5));
        assert_eq!(b.acquire().unwrap_err(), CircuitOpen);

        // Successful probe closes it.
        clock.advance(Duration::from_secs(5));
        b.acquire().unwrap().success();
        assert_eq!(b.state(), BreakerState::Closed);
        b.acquire().unwrap().success();
    }

    #[test]
    fn cancelled_probe_does_not_wedge_the_circuit() {
        let (b, clock) = breaker();
        fail(&b, 3);
        clock.advance(Duration::from_secs(10));
        drop(b.acquire().unwrap()); // e.g. the request was cancelled mid-probe
        assert_eq!(b.state(), BreakerState::HalfOpen);
        let probe = b.acquire().expect("a new probe is allowed");
        probe.success();
        assert_eq!(b.state(), BreakerState::Closed);
    }
}
