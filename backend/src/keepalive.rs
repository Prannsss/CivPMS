//! Keep-alive self-ping for Render's free plan (**opt-in**: `KEEPALIVE_ENABLED=true`).
//!
//! Render spins a free web service down after 15 minutes without inbound traffic, and the
//! next request then waits for a cold start. While enabled, this task GETs the service's own
//! public URL (`KEEPALIVE_URL`, default `${RENDER_EXTERNAL_URL}/healthz`) whenever there has
//! been no inbound request for `KEEPALIVE_IDLE_SECS` (default 14 minutes). The ping travels
//! through Render's public edge, so it counts as inbound traffic.
//!
//! Notes:
//! * Probe paths (`/healthz`, `/readyz`) do not count as activity: Render's own health checks
//!   hit them from inside its network and do **not** keep a free service awake, so counting
//!   them would suppress the pings that do.
//! * A free service that never sleeps uses ~744 of the 750 free instance-hours per month
//!   (shared by all free services in the workspace), so only one service can do this. The
//!   paid Starter plan never sleeps and needs no pinger.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;
use tokio_util::sync::CancellationToken;

use crate::clock::SharedClock;
use crate::config::KeepaliveConfig;

/// Paths that never count as activity.
pub const PROBE_PATHS: [&str; 2] = ["/healthz", "/readyz"];

/// Last inbound (non-probe) request time, in unix ms.
#[derive(Debug)]
pub struct ActivityTracker {
    last_ms: AtomicU64,
    clock: SharedClock,
}

impl ActivityTracker {
    pub fn new(clock: SharedClock) -> Self {
        let now = clock.now_ms();
        Self {
            last_ms: AtomicU64::new(now),
            clock,
        }
    }

    pub fn touch(&self) {
        self.last_ms
            .fetch_max(self.clock.now_ms(), Ordering::Relaxed);
    }

    pub fn last_ms(&self) -> u64 {
        self.last_ms.load(Ordering::Relaxed)
    }
}

/// Middleware: records inbound activity (except probes).
pub async fn track_activity(
    State(tracker): State<Arc<ActivityTracker>>,
    request: Request,
    next: Next,
) -> Response {
    if !PROBE_PATHS.contains(&request.uri().path()) {
        tracker.touch();
    }
    next.run(request).await
}

/// What the loop should do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Ping,
    Sleep(Duration),
}

/// Pure decision: ping once idle (since the last request *or* the last ping) reaches `idle`;
/// otherwise sleep until that moment, but never longer than `check_interval`.
pub fn next_action(
    now_ms: u64,
    last_activity_ms: u64,
    last_ping_ms: u64,
    idle: Duration,
    check_interval: Duration,
) -> Action {
    let idle_ms = idle.as_millis() as u64;
    let since = now_ms.saturating_sub(last_activity_ms.max(last_ping_ms));
    if since >= idle_ms {
        return Action::Ping;
    }
    let until_due = Duration::from_millis(idle_ms - since);
    Action::Sleep(until_due.min(check_interval).max(Duration::from_secs(1)))
}

/// Runs until `shutdown` is cancelled. Never panics; failures are logged and retried at the
/// next idle deadline.
pub async fn run(
    config: KeepaliveConfig,
    tracker: Arc<ActivityTracker>,
    clock: SharedClock,
    http: reqwest::Client,
    shutdown: CancellationToken,
) {
    let Some(url) = config.url.clone().filter(|_| config.enabled) else {
        tracing::info!("keep-alive disabled");
        return;
    };
    tracing::info!(%url, idle_secs = config.idle.as_secs(), "keep-alive enabled");
    // Jitter (up to 5 % of the idle period, at most 20 s, always earlier) so several replicas
    // don't ping in lock-step and the ping lands comfortably before Render's 15-minute mark.
    let jitter_cap_ms = (config.idle.as_millis() as u64 / 20).clamp(1, 20_000);
    let idle = config
        .idle
        .saturating_sub(Duration::from_millis(fastrand::u64(0..jitter_cap_ms)));
    let mut last_ping_ms = 0;
    loop {
        let action = next_action(
            clock.now_ms(),
            tracker.last_ms(),
            last_ping_ms,
            idle,
            config.check_interval,
        );
        match action {
            Action::Sleep(duration) => {
                tokio::select! {
                    () = shutdown.cancelled() => break,
                    () = tokio::time::sleep(duration) => {}
                }
            }
            Action::Ping => {
                last_ping_ms = clock.now_ms();
                let request = http.get(&url).timeout(Duration::from_secs(10)).send();
                tokio::select! {
                    () = shutdown.cancelled() => break,
                    result = request => match result {
                        Ok(response) if response.status().is_success() => {
                            tracing::info!(status = response.status().as_u16(), "keep-alive ping");
                        }
                        Ok(response) => {
                            tracing::warn!(status = response.status().as_u16(), "keep-alive ping got an error status");
                        }
                        Err(error) => tracing::warn!(error = %error, "keep-alive ping failed"),
                    },
                }
            }
        }
    }
    tracing::info!("keep-alive stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Clock, ManualClock};

    const IDLE: Duration = Duration::from_mins(14);
    const CHECK: Duration = Duration::from_mins(1);

    #[test]
    fn pings_only_after_the_idle_period() {
        let start = 1_000_000;
        assert_eq!(
            next_action(start, start, 0, IDLE, CHECK),
            Action::Sleep(CHECK)
        );
        // 13.5 minutes idle: sleep exactly until the deadline (30 s), not a full check interval.
        let now = start + 810_000;
        assert_eq!(
            next_action(now, start, 0, IDLE, CHECK),
            Action::Sleep(Duration::from_secs(30))
        );
        assert_eq!(
            next_action(start + 840_000, start, 0, IDLE, CHECK),
            Action::Ping
        );
    }

    #[test]
    fn last_ping_restarts_the_idle_period() {
        let start = 1_000_000;
        let pinged = start + 840_000;
        assert_eq!(
            next_action(pinged + 1_000, start, pinged, IDLE, CHECK),
            Action::Sleep(CHECK)
        );
        assert_eq!(
            next_action(pinged + 840_000, start, pinged, IDLE, CHECK),
            Action::Ping
        );
    }

    #[test]
    fn traffic_postpones_the_ping() {
        let start = 1_000_000;
        let request_at = start + 600_000;
        assert_eq!(
            next_action(start + 840_000, request_at, 0, IDLE, CHECK),
            Action::Sleep(CHECK),
            "a request 4 minutes ago means 10 more minutes of grace"
        );
    }

    #[test]
    fn tracker_ignores_clock_going_backwards() {
        let clock = ManualClock::new(5_000);
        let tracker = ActivityTracker::new(clock.clone());
        clock.set_ms(4_000);
        tracker.touch();
        assert_eq!(tracker.last_ms(), 5_000);
        clock.set_ms(9_000);
        tracker.touch();
        assert_eq!(tracker.last_ms(), clock.now_ms());
    }
}
