//! CivPMS media + cache service.
//!
//! * `POST /v1/media/avatar`, `POST /v1/media/images`: image uploads compressed with ffmpeg
//!   and stored in Supabase Storage with the caller's token.
//! * `GET /v1/projects`, `/v1/projects/{id}/summary`, `/v1/holidays`: Redis-cached reads that
//!   keep answering (stale) while Supabase is slow or down.
//! * A keep-alive self-ping so Render's free plan does not put the service to sleep.
//!
//! See `README.md` for the architecture and operations guide.

pub mod auth;
pub mod cache;
pub mod circuit;
pub mod clock;
pub mod config;
pub mod error;
pub mod idempotency;
pub mod keepalive;
pub mod media;
pub mod ratelimit;
pub mod redis_client;
pub mod routes;
pub mod state;
pub mod supabase;
pub mod telemetry;

use std::any::Any;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tokio_util::sync::CancellationToken;
use tower::ServiceBuilder;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::sensitive_headers::SetSensitiveRequestHeadersLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::error::{AppError, ErrorCode};
pub use crate::state::{AppState, StartupError};

/// Extra room for multipart boundaries and the small text fields.
const MULTIPART_OVERHEAD: usize = 64 * 1024;

fn cors_layer(config: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .app_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::CACHE_CONTROL,
            HeaderName::from_static("idempotency-key"),
            HeaderName::from_static("x-client-id"),
            HeaderName::from_static("x-request-id"),
        ])
        .expose_headers([
            HeaderName::from_static("x-cache"),
            HeaderName::from_static("x-request-id"),
            HeaderName::from_static("idempotent-replayed"),
            header::RETRY_AFTER,
            header::AGE,
        ])
        .max_age(Duration::from_mins(10))
}

#[allow(clippy::needless_pass_by_value)] // signature required by `CatchPanicLayer::custom`
fn handle_panic(panic: Box<dyn Any + Send + 'static>) -> Response {
    let detail = panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_owned());
    tracing::error!(panic = %detail, "handler panicked");
    AppError::new(
        ErrorCode::Internal,
        "Something went wrong on our side. Try again.",
    )
    .into_response()
}

/// Builds the full router (all middleware included). Tests call this directly.
pub fn build_app(state: AppState) -> Router {
    let config = &state.config;
    let upload_limit =
        usize::try_from(config.max_upload_bytes).unwrap_or(usize::MAX) + MULTIPART_OVERHEAD;

    let uploads = Router::new()
        .route("/v1/media/avatar", post(routes::media::upload_avatar))
        .route("/v1/media/images", post(routes::media::upload_image))
        .layer(
            ServiceBuilder::new()
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::GATEWAY_TIMEOUT,
                    config.upload_request_timeout,
                ))
                .layer(RequestBodyLimitLayer::new(upload_limit))
                .layer(DefaultBodyLimit::max(upload_limit)),
        );
    let reads = Router::new()
        .route("/v1/media/signed-url", get(routes::media::signed_url))
        .route("/v1/projects", get(routes::reads::list_projects))
        .route(
            "/v1/projects/{id}/summary",
            get(routes::reads::project_summary),
        )
        .route("/v1/holidays", get(routes::reads::holidays))
        .layer(
            ServiceBuilder::new()
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::GATEWAY_TIMEOUT,
                    config.read_request_timeout,
                ))
                .layer(DefaultBodyLimit::max(16 * 1024)),
        );
    let api = uploads
        .merge(reads)
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        ));
    let probes = Router::new()
        .route("/healthz", get(routes::health::healthz))
        .route("/readyz", get(routes::health::readyz));

    let activity = state.activity.clone();
    Router::new()
        .merge(api)
        .merge(probes)
        .fallback(error::not_found_fallback)
        .layer(
            ServiceBuilder::new()
                .layer(SetSensitiveRequestHeadersLayer::new([
                    header::AUTHORIZATION,
                    header::COOKIE,
                ]))
                .layer(axum::middleware::from_fn(telemetry::sanitize_request_id))
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(telemetry::make_span)
                        .on_request(())
                        .on_response(telemetry::on_response)
                        .on_failure(()),
                )
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(cors_layer(config))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::X_CONTENT_TYPE_OPTIONS,
                    HeaderValue::from_static("nosniff"),
                ))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::REFERRER_POLICY,
                    HeaderValue::from_static("no-referrer"),
                ))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::X_FRAME_OPTIONS,
                    HeaderValue::from_static("DENY"),
                ))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::CONTENT_SECURITY_POLICY,
                    HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
                ))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::STRICT_TRANSPORT_SECURITY,
                    HeaderValue::from_static("max-age=63072000"),
                ))
                .layer(axum::middleware::from_fn(error::error_envelope))
                .layer(axum::middleware::from_fn_with_state(
                    activity,
                    keepalive::track_activity,
                ))
                .layer(CatchPanicLayer::custom(handle_panic)),
        )
        .with_state(state)
}

async fn wait_for_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %e, "cannot listen for Ctrl+C");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                tracing::error!(error = %e, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => tracing::info!("SIGINT received; shutting down"),
        () = terminate => tracing::info!("SIGTERM received; shutting down"),
    }
}

/// Runs the service until SIGTERM/SIGINT, then drains in-flight requests (up to
/// `SHUTDOWN_GRACE_SECS`).
pub async fn run(config: Config) -> Result<(), StartupError> {
    let grace = config.shutdown_grace;
    let port = config.port;
    let keepalive_config = config.keepalive.clone();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        config = %config.summary(),
        "civpms-media starting"
    );
    if config.keepalive.enabled && config.keepalive.idle >= Duration::from_mins(15) {
        tracing::warn!(
            "KEEPALIVE_IDLE_SECS >= 900: Render's free plan sleeps after 15 minutes idle"
        );
    }
    let state = AppState::new(config)?;
    state.warm_up().await;

    let shutdown = CancellationToken::new();
    let keepalive = tokio::spawn(keepalive::run(
        keepalive_config,
        state.activity.clone(),
        state.clock.clone(),
        state.http.clone(),
        shutdown.clone(),
    ));

    let app = build_app(state);
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(StartupError::Bind)?;
    tracing::info!(%address, "listening");

    let signal_token = shutdown.clone();
    tokio::spawn(async move {
        wait_for_signal().await;
        signal_token.cancel();
    });

    let server =
        axum::serve(listener, app).with_graceful_shutdown(shutdown.clone().cancelled_owned());
    let drain_deadline = async {
        shutdown.cancelled().await;
        tokio::time::sleep(grace).await;
    };
    tokio::select! {
        result = server => result.map_err(StartupError::Serve)?,
        () = drain_deadline => tracing::warn!(grace_secs = grace.as_secs(), "drain deadline reached; exiting with requests in flight"),
    }
    shutdown.cancel();
    let _ = keepalive.await;
    tracing::info!("stopped");
    Ok(())
}
