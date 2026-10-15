//! Minimal Supabase REST (PostgREST) and Storage client.
//!
//! Every call carries the publishable key (`apikey`) and the **caller's** access token
//! (`Authorization: Bearer …`), so RLS and Storage policies decide what is visible or
//! writable. Reads (idempotent GETs) get a per-attempt timeout, up to two retries with full
//! jitter on transient failures, and a circuit breaker; writes are not retried.

use std::time::Duration;

use bytes::Bytes;
use http::StatusCode;
use reqwest::{Method, RequestBuilder, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::cache::FetchError;
use crate::circuit::CircuitBreaker;
use crate::config::Config;
use crate::error::{AppError, ErrorCode};

const READ_RETRIES: u32 = 2;
const RETRY_BASE: Duration = Duration::from_millis(150);
const MAX_READ_BODY: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub struct Supabase {
    http: reqwest::Client,
    base: String,
    apikey: String,
    read_timeout: Duration,
    write_timeout: Duration,
    breaker: CircuitBreaker,
}

/// One object to sign in a batch.
#[derive(Debug, Clone, Deserialize)]
struct SignedEntry {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(rename = "signedURL", default)]
    signed_url: Option<String>,
}

impl Supabase {
    pub fn new(config: &Config, http: reqwest::Client, breaker: CircuitBreaker) -> Self {
        Self {
            http,
            base: config.supabase_url.clone(),
            apikey: config.supabase_publishable_key.clone(),
            read_timeout: config.upstream_read_timeout,
            write_timeout: config.upstream_write_timeout,
            breaker,
        }
    }

    pub fn breaker(&self) -> &CircuitBreaker {
        &self.breaker
    }

    fn request(&self, method: Method, path: &str, token: &str) -> RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.base))
            .header("apikey", &self.apikey)
            .bearer_auth(token)
    }

    /// GETs a PostgREST resource as JSON, with retries and the circuit breaker.
    /// `path_and_query` starts with `/rest/v1/`.
    pub async fn rest_get(&self, token: &str, path_and_query: &str) -> Result<Value, FetchError> {
        let Ok(permit) = self.breaker.acquire() else {
            return Err(FetchError::Unavailable("circuit open".into()));
        };
        let mut attempt = 0;
        loop {
            match self.rest_get_once(token, path_and_query).await {
                Ok(value) => {
                    permit.success();
                    return Ok(value);
                }
                Err(FetchError::Rejected(error)) => {
                    // A definitive 4xx answer: the upstream is healthy.
                    permit.healthy();
                    return Err(FetchError::Rejected(error));
                }
                Err(FetchError::Unavailable(reason)) if attempt < READ_RETRIES => {
                    attempt += 1;
                    // Full jitter: 0..=150 ms, then 0..=300 ms.
                    let cap = RETRY_BASE.as_millis() as u64 * (1 << (attempt - 1));
                    let delay = Duration::from_millis(fastrand::u64(0..=cap));
                    tracing::debug!(%reason, attempt, ?delay, "retrying upstream read");
                    tokio::time::sleep(delay).await;
                }
                Err(FetchError::Unavailable(reason)) => {
                    permit.failure();
                    return Err(FetchError::Unavailable(reason));
                }
            }
        }
    }

    async fn rest_get_once(&self, token: &str, path_and_query: &str) -> Result<Value, FetchError> {
        let response = self
            .request(Method::GET, path_and_query, token)
            .header("accept", "application/json")
            .timeout(self.read_timeout)
            .send()
            .await
            .map_err(|e| FetchError::Unavailable(describe_reqwest(&e)))?;
        let status = response.status();
        if status.is_success() {
            let body = read_limited(response, MAX_READ_BODY)
                .await
                .map_err(FetchError::Unavailable)?;
            return serde_json::from_slice(&body)
                .map_err(|e| FetchError::Unavailable(format!("invalid JSON from upstream: {e}")));
        }
        if is_transient(status) {
            return Err(FetchError::Unavailable(format!("upstream status {status}")));
        }
        let body = read_limited(response, 16 * 1024).await.unwrap_or_default();
        Err(FetchError::Rejected(map_rest_error(status, &body)))
    }

    /// Uploads one object to Storage as the caller. Never overwrites (`x-upsert: false`).
    pub async fn upload(
        &self,
        token: &str,
        bucket: &str,
        object: &str,
        body: Bytes,
        content_type: &str,
        cache_control_secs: u64,
    ) -> Result<(), AppError> {
        let response = self
            .request(
                Method::POST,
                &format!("/storage/v1/object/{bucket}/{object}"),
                token,
            )
            .header("content-type", content_type)
            .header("cache-control", format!("max-age={cache_control_secs}"))
            .header("x-upsert", "false")
            .timeout(self.write_timeout)
            .body(body)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!(error = %describe_reqwest(&e), "storage upload failed");
                AppError::upstream_unavailable()
            })?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = read_limited(response, 16 * 1024).await.unwrap_or_default();
        Err(map_storage_error(status, &body))
    }

    /// Deletes objects as the caller (best effort cleanup after a partial failure).
    pub async fn remove(
        &self,
        token: &str,
        bucket: &str,
        objects: &[String],
    ) -> Result<(), AppError> {
        let response = self
            .request(
                Method::DELETE,
                &format!("/storage/v1/object/{bucket}"),
                token,
            )
            .json(&json!({ "prefixes": objects }))
            .timeout(self.write_timeout)
            .send()
            .await
            .map_err(|_| AppError::upstream_unavailable())?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = read_limited(response, 16 * 1024).await.unwrap_or_default();
        Err(map_storage_error(status, &body))
    }

    /// Creates short-lived signed URLs for objects the caller can read (one request).
    /// Returns absolute URLs in the order of `objects`.
    pub async fn sign(
        &self,
        token: &str,
        bucket: &str,
        objects: &[&str],
        expires_in: Duration,
    ) -> Result<Vec<String>, AppError> {
        let response = self
            .request(
                Method::POST,
                &format!("/storage/v1/object/sign/{bucket}"),
                token,
            )
            .json(&json!({ "expiresIn": expires_in.as_secs(), "paths": objects }))
            .timeout(self.read_timeout)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!(error = %describe_reqwest(&e), "storage sign failed");
                AppError::upstream_unavailable()
            })?;
        let status = response.status();
        let body = read_limited(response, 256 * 1024).await.unwrap_or_default();
        if !status.is_success() {
            return Err(map_storage_error(status, &body));
        }
        let entries: Vec<SignedEntry> = serde_json::from_slice(&body)
            .map_err(|e| AppError::internal(format!("unexpected sign response: {e}")))?;
        let mut urls = Vec::with_capacity(objects.len());
        for object in objects {
            let entry = entries
                .iter()
                .find(|e| e.path.as_deref() == Some(object))
                .ok_or_else(|| {
                    AppError::not_found("That file does not exist or you can't open it.")
                })?;
            match (&entry.signed_url, &entry.error) {
                (Some(url), None) => urls.push(self.absolute_storage_url(url)),
                _ => {
                    return Err(AppError::not_found(
                        "That file does not exist or you can't open it.",
                    ));
                }
            }
        }
        Ok(urls)
    }

    /// Public URL of an object in a public bucket.
    pub fn public_url(&self, bucket: &str, object: &str) -> String {
        format!("{}/storage/v1/object/public/{bucket}/{object}", self.base)
    }

    fn absolute_storage_url(&self, relative: &str) -> String {
        if relative.starts_with("http://") || relative.starts_with("https://") {
            relative.to_owned()
        } else {
            format!("{}/storage/v1{}", self.base, relative)
        }
    }
}

fn is_transient(status: StatusCode) -> bool {
    status.is_server_error()
        || status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::REQUEST_TIMEOUT
}

fn describe_reqwest(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout".into()
    } else if error.is_connect() {
        "connection failed".into()
    } else {
        // Without the URL: it contains nothing secret, but keep logs compact.
        error.to_string()
    }
}

async fn read_limited(response: Response, limit: usize) -> Result<Bytes, String> {
    if response
        .content_length()
        .is_some_and(|len| len as usize > limit)
    {
        return Err("upstream response too large".into());
    }
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("reading upstream body: {}", describe_reqwest(&e)))?;
    if body.len() > limit {
        return Err("upstream response too large".into());
    }
    Ok(body)
}

/// Maps a PostgREST error to a client error without leaking its message.
fn map_rest_error(status: StatusCode, body: &[u8]) -> AppError {
    let detail = String::from_utf8_lossy(&body[..body.len().min(300)]).into_owned();
    match status {
        StatusCode::UNAUTHORIZED => {
            AppError::unauthenticated("Your session has expired. Sign in again.")
        }
        StatusCode::FORBIDDEN => AppError::forbidden("You don't have access to this."),
        StatusCode::NOT_FOUND | StatusCode::NOT_ACCEPTABLE => AppError::not_found("Not found."),
        _ => {
            tracing::warn!(%status, %detail, "unexpected PostgREST error");
            AppError::validation("The request could not be completed.")
        }
    }
}

/// Supabase Storage reports some errors as HTTP 400 with the real code in the JSON body
/// (`{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}`).
fn map_storage_error(status: StatusCode, body: &[u8]) -> AppError {
    #[derive(Deserialize)]
    struct StorageError {
        #[serde(rename = "statusCode", default)]
        status_code: Option<Value>,
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        message: Option<String>,
    }
    let parsed: Option<StorageError> = serde_json::from_slice(body).ok();
    let inner = parsed
        .as_ref()
        .and_then(|e| e.status_code.as_ref())
        .and_then(|v| {
            v.as_str()
                .map(str::to_owned)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        })
        .and_then(|s| s.parse::<u16>().ok())
        .and_then(|n| StatusCode::from_u16(n).ok());
    let effective = inner.unwrap_or(status);
    let message = parsed
        .as_ref()
        .and_then(|e| e.message.clone())
        .unwrap_or_default();
    let error = parsed
        .as_ref()
        .and_then(|e| e.error.clone())
        .unwrap_or_default();
    match effective {
        StatusCode::UNAUTHORIZED => {
            AppError::unauthenticated("Your session has expired. Sign in again.")
        }
        StatusCode::FORBIDDEN => {
            AppError::forbidden("You don't have permission to store files here.")
        }
        StatusCode::NOT_FOUND => {
            AppError::not_found("That file does not exist or you can't open it.")
        }
        StatusCode::CONFLICT => {
            AppError::new(ErrorCode::Conflict, "A file with this name already exists.")
        }
        StatusCode::PAYLOAD_TOO_LARGE => AppError::new(
            ErrorCode::PayloadTooLarge,
            "The processed file exceeds the storage limit.",
        ),
        s if s.is_server_error() || s == StatusCode::TOO_MANY_REQUESTS => {
            tracing::warn!(status = %s, %error, %message, "storage unavailable");
            AppError::upstream_unavailable()
        }
        s => {
            tracing::warn!(status = %s, %error, %message, "unexpected storage error");
            if message.contains("mime type") {
                AppError::new(
                    ErrorCode::UnsupportedMediaType,
                    "Storage rejected the file type.",
                )
            } else {
                AppError::validation("Storage rejected the upload.")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_errors_use_the_inner_status_code() {
        let rls = br#"{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}"#;
        assert_eq!(
            map_storage_error(StatusCode::BAD_REQUEST, rls).code,
            ErrorCode::Forbidden
        );
        let missing = br#"{"statusCode":"404","error":"not_found","message":"Object not found"}"#;
        assert_eq!(
            map_storage_error(StatusCode::BAD_REQUEST, missing).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            map_storage_error(StatusCode::CONFLICT, b"{}").code,
            ErrorCode::Conflict
        );
        assert_eq!(
            map_storage_error(StatusCode::BAD_GATEWAY, b"oops").code,
            ErrorCode::UpstreamUnavailable
        );
        let numeric = br#"{"statusCode":413,"message":"too big"}"#;
        assert_eq!(
            map_storage_error(StatusCode::BAD_REQUEST, numeric).code,
            ErrorCode::PayloadTooLarge
        );
    }

    #[test]
    fn rest_errors_do_not_leak_messages() {
        let err = map_rest_error(
            StatusCode::BAD_REQUEST,
            br#"{"message":"column secret does not exist"}"#,
        );
        assert_eq!(err.code, ErrorCode::Validation);
        assert!(!err.message.contains("secret"));
        assert_eq!(
            map_rest_error(StatusCode::UNAUTHORIZED, b"").code,
            ErrorCode::Unauthenticated
        );
    }

    #[test]
    fn transient_statuses() {
        assert!(is_transient(StatusCode::BAD_GATEWAY));
        assert!(is_transient(StatusCode::TOO_MANY_REQUESTS));
        assert!(!is_transient(StatusCode::NOT_FOUND));
    }
}
