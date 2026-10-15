//! Logging, request ids and log hygiene helpers.
//!
//! Logs are JSON lines (one per event) with the request id, method, matched route template,
//! status, latency and a short hash of the user id. Tokens, cookies and file bytes are never
//! logged: `Authorization`/`Cookie` are marked sensitive before the trace layer sees them.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use http::HeaderValue;
use sha2::{Digest, Sha256};
use tracing::Span;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::config::LogFormat;

pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// Installs the global tracing subscriber. Safe to call once; later calls are ignored.
pub fn init(format: LogFormat) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,hyper=warn,reqwest=warn"));
    let registry = tracing_subscriber::registry().with(filter);
    let result = match format {
        LogFormat::Json => registry
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .flatten_event(true)
                    .with_current_span(true)
                    .with_span_list(false)
                    .with_target(true),
            )
            .try_init(),
        LogFormat::Pretty => registry.with(tracing_subscriber::fmt::layer().compact()).try_init(),
    };
    if result.is_err() {
        tracing::debug!("tracing subscriber already installed");
    }
}

/// Short, non-reversible identifier for a user id, so logs can be correlated without
/// storing the raw id next to request details.
pub fn user_hash(user_id: &uuid::Uuid) -> String {
    let digest = Sha256::digest(user_id.as_bytes());
    hex::encode(&digest[..6])
}

/// Builds the per-request span. Fields filled later: `status`, `latency_ms`, `user`.
pub fn make_span(request: &Request) -> Span {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map_or("<unmatched>", MatchedPath::as_str);
    let request_id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-");
    tracing::info_span!(
        "request",
        request_id = %request_id,
        method = %request.method(),
        route = %route,
        user = tracing::field::Empty,
        status = tracing::field::Empty,
        latency_ms = tracing::field::Empty,
    )
}

/// Records status + latency on the request span and logs one line per response.
pub fn on_response(response: &Response, latency: Duration, span: &Span) {
    span.record("status", response.status().as_u16());
    span.record("latency_ms", latency.as_millis() as u64);
    let cache = response.headers().get("x-cache").and_then(|v| v.to_str().ok()).unwrap_or("-");
    if response.status().is_server_error() {
        tracing::warn!(cache, "request finished");
    } else {
        tracing::info!(cache, "request finished");
    }
}

/// Drops client-supplied `x-request-id` values that are not short, plain tokens, so ids in
/// logs cannot be used for log injection. A fresh UUID is generated downstream instead.
pub async fn sanitize_request_id(mut request: Request, next: Next) -> Response {
    let valid = request.headers().get(REQUEST_ID_HEADER).is_none_or(is_valid_request_id);
    if !valid {
        request.headers_mut().remove(REQUEST_ID_HEADER);
    }
    next.run(request).await
}

fn is_valid_request_id(value: &HeaderValue) -> bool {
    let bytes = value.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes.iter().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

/// Logs at most once per `interval` (e.g. "Redis is down" while it stays down).
#[derive(Debug)]
pub struct LogThrottle {
    interval_ms: u64,
    last_ms: AtomicU64,
}

impl LogThrottle {
    pub const fn new(interval: Duration) -> Self {
        Self { interval_ms: interval.as_millis() as u64, last_ms: AtomicU64::new(0) }
    }

    /// Returns true when the caller should log now (`now_ms` is any monotonic-enough clock).
    pub fn should_log(&self, now_ms: u64) -> bool {
        let last = self.last_ms.load(Ordering::Relaxed);
        if last != 0 && now_ms.saturating_sub(last) < self.interval_ms {
            return false;
        }
        self.last_ms
            .compare_exchange(last, now_ms.max(1), Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_hash_is_stable_and_short() {
        let id = uuid::Uuid::nil();
        assert_eq!(user_hash(&id), user_hash(&id));
        assert_eq!(user_hash(&id).len(), 12);
        assert_ne!(user_hash(&id), user_hash(&uuid::Uuid::max()));
    }

    #[test]
    fn request_id_validation() {
        assert!(is_valid_request_id(&HeaderValue::from_static("0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11")));
        assert!(!is_valid_request_id(&HeaderValue::from_static("bad id\" injected")));
        assert!(!is_valid_request_id(&HeaderValue::from_str(&"a".repeat(129)).unwrap()));
    }

    #[test]
    fn throttle_logs_once_per_interval() {
        let throttle = LogThrottle::new(Duration::from_secs(60));
        assert!(throttle.should_log(1_000));
        assert!(!throttle.should_log(30_000));
        assert!(throttle.should_log(61_001));
        assert!(!throttle.should_log(61_002));
    }
}
