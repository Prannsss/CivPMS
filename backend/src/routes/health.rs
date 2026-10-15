//! Liveness and readiness probes.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::IntoResponse;
use serde_json::{Value, json};

use crate::media::SelfTest;
use crate::redis_client::RedisUnavailable;
use crate::state::AppState;

/// `GET /healthz`: the process is up. No dependencies are checked, so a Redis or Supabase
/// outage never makes Render restart a healthy instance.
pub async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "civpms-media",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_secs": state.started_at.elapsed().as_secs(),
    }))
}

/// `GET /readyz`: can this instance do its job? 503 with details when not.
pub async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    let mut ready = true;

    let redis = if state.redis.is_configured() {
        match state.redis.ping().await {
            Ok(rtt) => json!({ "status": "up", "latency_ms": rtt.as_secs_f64() * 1000.0 }),
            Err(e) => {
                ready = false;
                let reason = match e {
                    RedisUnavailable::Timeout => "timeout".to_owned(),
                    other => other.to_string(),
                };
                json!({ "status": "down", "error": reason, "fallback": "in-memory cache and rate limits" })
            }
        }
    } else {
        json!({ "status": "not_configured", "fallback": "in-memory cache and rate limits" })
    };

    let caps = state.media.capabilities();
    let selftest = state.media.selftest();
    let media_ok = caps.ready() && selftest != SelfTest::Failed;
    ready &= media_ok;
    let media = json!({
        "status": if media_ok { "ok" } else { "unavailable" },
        "ffmpeg_version": caps.ffmpeg_version,
        "ffprobe": caps.ffprobe,
        "webp_encoder": caps.webp_encoder,
        "formats": caps.formats,
        "orientation_selftest": selftest,
    });

    let jwks_loaded = state.jwks.is_loaded();
    ready &= jwks_loaded;
    let jwks = json!({
        "status": if jwks_loaded { "loaded" } else { "missing" },
        "keys": state.jwks.key_count(),
    });

    let body: Value = json!({
        "status": if ready { "ready" } else { "not_ready" },
        "checks": {
            "redis": redis,
            "media": media,
            "jwks": jwks,
            "supabase_reads_circuit": format!("{:?}", state.supabase.breaker().state()).to_lowercase(),
        },
    });
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    // Not an error envelope on purpose: probes want the details, and 503 here is expected.
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.extensions_mut().insert(crate::error::PassThrough);
    response
}
