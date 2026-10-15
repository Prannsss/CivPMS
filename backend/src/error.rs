//! API errors and the JSON error envelope.
//!
//! Every error response has the shape
//! `{"error": {"code": "NOT_FOUND", "message": "…", "request_id": "…"}}`.
//! Handlers return [`AppError`]; the [`error_envelope`] middleware adds the request id and
//! also converts framework-generated errors (404 routes, 405, 413 from the body limit,
//! timeouts, panics) into the same shape so clients only ever parse one format.

use std::borrow::Cow;
use std::fmt;

use axum::Json;
use axum::extract::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http::header::{CONTENT_TYPE, RETRY_AFTER};
use http::{HeaderValue, StatusCode};
use serde::Serialize;

use crate::telemetry::REQUEST_ID_HEADER;

/// Stable, documented error codes. Clients switch on these, never on messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Unauthenticated,
    Forbidden,
    NotFound,
    MethodNotAllowed,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
    ImageTooLarge,
    ProcessingFailed,
    RateLimited,
    UpstreamUnavailable,
    Busy,
    Timeout,
    Validation,
    Internal,
}

impl ErrorCode {
    pub const fn status(self) -> StatusCode {
        match self {
            Self::Unauthenticated => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            Self::Conflict => StatusCode::CONFLICT,
            Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ImageTooLarge | Self::ProcessingFailed | Self::Validation => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::UpstreamUnavailable | Self::Busy => StatusCode::SERVICE_UNAVAILABLE,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "NOT_FOUND",
            Self::MethodNotAllowed => "METHOD_NOT_ALLOWED",
            Self::Conflict => "CONFLICT",
            Self::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            Self::UnsupportedMediaType => "UNSUPPORTED_MEDIA_TYPE",
            Self::ImageTooLarge => "IMAGE_TOO_LARGE",
            Self::ProcessingFailed => "PROCESSING_FAILED",
            Self::RateLimited => "RATE_LIMITED",
            Self::UpstreamUnavailable => "UPSTREAM_UNAVAILABLE",
            Self::Busy => "BUSY",
            Self::Timeout => "TIMEOUT",
            Self::Validation => "VALIDATION",
            Self::Internal => "INTERNAL",
        }
    }

    /// Default plain-language message for framework-generated errors.
    const fn default_message(self) -> &'static str {
        match self {
            Self::Unauthenticated => "Sign in again: your session is missing or has expired.",
            Self::Forbidden => "You don't have permission to do this.",
            Self::NotFound => "There is nothing at this address.",
            Self::MethodNotAllowed => "This endpoint does not support that HTTP method.",
            Self::Conflict => "This request conflicts with another one in progress.",
            Self::PayloadTooLarge => "The upload is too large.",
            Self::UnsupportedMediaType => "This file type is not supported.",
            Self::ImageTooLarge => "The image dimensions are too large.",
            Self::ProcessingFailed => "The image could not be processed.",
            Self::RateLimited => "Too many requests. Wait a moment and try again.",
            Self::UpstreamUnavailable => {
                "The data service is unavailable right now. Try again shortly."
            }
            Self::Busy => "The server is busy processing other images. Try again shortly.",
            Self::Timeout => "The request took too long. Try again.",
            Self::Validation => "The request is not valid.",
            Self::Internal => "Something went wrong on our side. Try again.",
        }
    }

    fn from_status(status: StatusCode) -> Self {
        match status {
            StatusCode::UNAUTHORIZED => Self::Unauthenticated,
            StatusCode::FORBIDDEN => Self::Forbidden,
            StatusCode::NOT_FOUND => Self::NotFound,
            StatusCode::METHOD_NOT_ALLOWED => Self::MethodNotAllowed,
            StatusCode::CONFLICT => Self::Conflict,
            StatusCode::PAYLOAD_TOO_LARGE | StatusCode::LENGTH_REQUIRED => Self::PayloadTooLarge,
            StatusCode::UNSUPPORTED_MEDIA_TYPE => Self::UnsupportedMediaType,
            StatusCode::TOO_MANY_REQUESTS => Self::RateLimited,
            StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => Self::Timeout,
            StatusCode::SERVICE_UNAVAILABLE | StatusCode::BAD_GATEWAY => Self::UpstreamUnavailable,
            s if s.is_client_error() => Self::Validation,
            _ => Self::Internal,
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An error that is safe to show to the client. Internal details are logged, never returned.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: Cow<'static, str>,
    /// Seconds for the `Retry-After` header (429/503).
    pub retry_after: Option<u64>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<Cow<'static, str>>) -> Self {
        Self { code, message: message.into(), retry_after: None }
    }

    #[must_use]
    pub fn with_retry_after(mut self, secs: u64) -> Self {
        self.retry_after = Some(secs.max(1));
        self
    }

    pub fn unauthenticated(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(ErrorCode::Unauthenticated, message)
    }

    pub fn forbidden(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(ErrorCode::Forbidden, message)
    }

    pub fn not_found(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn validation(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn upstream_unavailable() -> Self {
        Self::new(ErrorCode::UpstreamUnavailable, ErrorCode::UpstreamUnavailable.default_message())
            .with_retry_after(5)
    }

    /// Logs `detail` (correlated by the request id in the span) and returns a generic
    /// `INTERNAL` error; the client can quote the `request_id` from the envelope.
    pub fn internal(detail: impl fmt::Display) -> Self {
        tracing::error!(error = %detail, "internal error");
        Self::new(ErrorCode::Internal, ErrorCode::Internal.default_message())
    }
}

/// Marker for 4xx/5xx responses whose body must be left alone (e.g. `/readyz` details).
#[derive(Debug, Clone, Copy)]
pub struct PassThrough;

/// Marker stored in error responses so [`error_envelope`] can render the final body.
#[derive(Debug, Clone)]
struct ErrorInfo {
    code: ErrorCode,
    message: Cow<'static, str>,
}

#[derive(Serialize)]
struct Envelope<'a> {
    error: EnvelopeBody<'a>,
}

#[derive(Serialize)]
struct EnvelopeBody<'a> {
    code: ErrorCode,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<&'a str>,
}

fn render<'a>(code: ErrorCode, message: &'a str, request_id: Option<&'a str>) -> Json<Envelope<'a>> {
    Json(Envelope { error: EnvelopeBody { code, message, request_id } })
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.code.status();
        let mut response = (status, render(self.code, &self.message, None)).into_response();
        if let Some(secs) = self.retry_after {
            response.headers_mut().insert(RETRY_AFTER, HeaderValue::from(secs));
        }
        response.extensions_mut().insert(ErrorInfo { code: self.code, message: self.message });
        response
    }
}

/// Middleware: adds `request_id` to every error body and normalizes framework errors.
pub async fn error_envelope(request: Request, next: Next) -> Response {
    let request_id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let response = next.run(request).await;
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error())
        || response.extensions().get::<PassThrough>().is_some()
    {
        return response;
    }

    let (mut parts, body) = response.into_parts();
    let (code, message) = match parts.extensions.remove::<ErrorInfo>() {
        Some(info) => (info.code, info.message),
        None => {
            let code = ErrorCode::from_status(status);
            if status.is_server_error() {
                tracing::warn!(%status, "framework error response normalized");
            }
            (code, Cow::Borrowed(code.default_message()))
        }
    };
    drop(body);
    parts.headers.remove(CONTENT_TYPE);
    parts.headers.remove(http::header::CONTENT_LENGTH);
    let rendered = render(code, &message, request_id.as_deref()).into_response();
    let (rendered_parts, rendered_body) = rendered.into_parts();
    for (name, value) in &rendered_parts.headers {
        parts.headers.insert(name.clone(), value.clone());
    }
    Response::from_parts(parts, rendered_body)
}

/// Fallback for unknown routes.
pub async fn not_found_fallback() -> AppError {
    AppError::not_found(ErrorCode::NotFound.default_message())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_map_to_statuses() {
        assert_eq!(ErrorCode::Unauthenticated.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(ErrorCode::ImageTooLarge.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(ErrorCode::RateLimited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(ErrorCode::UpstreamUnavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::to_string(&ErrorCode::UnsupportedMediaType).unwrap(),
            "\"UNSUPPORTED_MEDIA_TYPE\""
        );
        assert_eq!(ErrorCode::from_status(StatusCode::PAYLOAD_TOO_LARGE), ErrorCode::PayloadTooLarge);
        assert_eq!(ErrorCode::from_status(StatusCode::IM_A_TEAPOT), ErrorCode::Validation);
        assert_eq!(ErrorCode::from_status(StatusCode::BAD_GATEWAY), ErrorCode::UpstreamUnavailable);
    }

    #[test]
    fn retry_after_is_set() {
        let response = AppError::new(ErrorCode::RateLimited, "slow down").with_retry_after(7).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[RETRY_AFTER], "7");
    }
}
