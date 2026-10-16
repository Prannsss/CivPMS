//! Upload endpoints and signed URLs.
//!
//! Flow for every upload: authenticate → rate-limit → admission (one upload per user, a cap
//! on uploads in progress; see `uploads.rs`) → stream the multipart file to a private temp dir
//! (size-capped) → validate fields → process with ffmpeg (the time spent holding an ffmpeg
//! slot is charged to the user's upload budget) → upload to Storage **with the caller's
//! token** (Storage RLS decides) → respond. Object names are generated here; nothing from the
//! client ends up in a storage path except a validated project UUID.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::multipart::{Multipart, MultipartError, MultipartRejection};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use http::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::offset;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::cache::{CacheResult, CacheStatus, FetchError};
use crate::error::{AppError, ErrorCode};
use crate::idempotency::{Begin, Reservation, valid_client_id};
use crate::media::transcode::Preset;
use crate::ratelimit::RateClass;
use crate::routes::reads::cached_response;
use crate::state::AppState;
use crate::uploads::processing_charge;

const WEBP: &str = "image/webp";
/// Objects are immutable (unique names), so browsers and CDNs may cache them for a year.
const IMMUTABLE_CACHE_SECS: u64 = 31_536_000;
const MAX_FIELDS: usize = 8;
const MAX_TEXT_FIELD: usize = 256;
const IN_PROGRESS_WAIT: Duration = Duration::from_secs(10);

struct UploadForm {
    file: Option<(PathBuf, u64)>,
    project_id: Option<String>,
    client_id: Option<String>,
    kind: Option<String>,
}

/// True when a body-size limit (ours or axum's) cut the stream, however deeply the
/// `LengthLimitError` is wrapped.
fn hit_length_limit(error: &MultipartError) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if current.is::<http_body_util::LengthLimitError>() {
            return true;
        }
        source = current.source();
    }
    false
}

fn multipart_error(error: &MultipartError) -> AppError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE || hit_length_limit(error) {
        AppError::new(ErrorCode::PayloadTooLarge, "The upload is too large.")
    } else {
        tracing::debug!(error = %error.body_text(), "invalid multipart body");
        AppError::validation("The upload could not be read. Send it as multipart/form-data.")
    }
}

fn too_large(max_bytes: u64) -> AppError {
    AppError::new(
        ErrorCode::PayloadTooLarge,
        format!(
            "The file is larger than {} MB. Choose a smaller photo.",
            max_bytes / (1024 * 1024)
        ),
    )
}

/// Streams the form into `dir`, never holding the whole file in memory.
async fn read_form(
    multipart: Result<Multipart, MultipartRejection>,
    dir: &Path,
    max_bytes: u64,
    text_fields: &[&str],
) -> Result<UploadForm, AppError> {
    let mut multipart = multipart.map_err(|rejection| {
        tracing::debug!(error = %rejection.body_text(), "multipart rejected");
        AppError::validation("Send the image as multipart/form-data in a field named \"file\".")
    })?;
    let mut form = UploadForm {
        file: None,
        project_id: None,
        client_id: None,
        kind: None,
    };
    let mut fields = 0;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| multipart_error(&e))?
    {
        fields += 1;
        if fields > MAX_FIELDS {
            return Err(AppError::validation("The form has too many fields."));
        }
        let name = field.name().unwrap_or_default().to_owned();
        if name == "file" {
            if form.file.is_some() {
                return Err(AppError::validation("Send exactly one file per request."));
            }
            let path = dir.join("input");
            let mut out = tokio::fs::File::create(&path)
                .await
                .map_err(AppError::internal)?;
            let mut size: u64 = 0;
            while let Some(chunk) = field.chunk().await.map_err(|e| multipart_error(&e))? {
                size += chunk.len() as u64;
                if size > max_bytes {
                    return Err(too_large(max_bytes));
                }
                out.write_all(&chunk).await.map_err(AppError::internal)?;
            }
            out.flush().await.map_err(AppError::internal)?;
            if size == 0 {
                return Err(AppError::validation("The file is empty."));
            }
            form.file = Some((path, size));
        } else if text_fields.contains(&name.as_str()) {
            let mut value = Vec::new();
            while let Some(chunk) = field.chunk().await.map_err(|e| multipart_error(&e))? {
                value.extend_from_slice(&chunk);
                if value.len() > MAX_TEXT_FIELD {
                    return Err(AppError::validation(format!(
                        "The {name} field is too long."
                    )));
                }
            }
            let value = String::from_utf8(value)
                .map_err(|_| AppError::validation(format!("The {name} field must be text.")))?
                .trim()
                .to_owned();
            match name.as_str() {
                "project_id" => form.project_id = Some(value),
                "client_id" => form.client_id = Some(value),
                "kind" => form.kind = Some(value),
                _ => {}
            }
        } else {
            return Err(AppError::validation(
                "Unexpected form field. Send \"file\" (and for project images \"project_id\", optional \"client_id\" and \"kind\").",
            ));
        }
    }
    Ok(form)
}

fn temp_dir() -> Result<tempfile::TempDir, AppError> {
    tempfile::Builder::new()
        .prefix("civpms-upload-")
        .tempdir()
        .map_err(AppError::internal)
}

fn missing_file() -> AppError {
    AppError::validation("Add the image in a form field named \"file\".")
}

#[derive(Debug, Serialize)]
pub struct AvatarResponse {
    pub url: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
    pub content_type: &'static str,
}

/// `POST /v1/media/avatar`: square 256×256 WebP in the public `avatars` bucket under
/// `<uid>/<uuid>.webp`. The client then saves `url` with `update_profile`.
pub async fn upload_avatar(
    State(state): State<AppState>,
    user: AuthUser,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<Response, AppError> {
    state.limiter.check(RateClass::Upload, user.id).await?;
    let _admitted = state.uploads.admit(user.id).await?;
    let dir = temp_dir()?;
    let form = read_form(multipart, dir.path(), state.config.max_upload_bytes, &[]).await?;
    let (input, input_bytes) = form.file.ok_or_else(missing_file)?;

    let mut slot_held = Duration::ZERO;
    let processed = state
        .media
        .process_metered(&input, dir.path(), Preset::AVATAR, &mut slot_held)
        .await;
    charge_processing(&state, &user, slot_held).await;
    let processed = processed?;
    let path = format!("{}/{}.webp", user.id, Uuid::new_v4());
    let bucket = &state.config.avatar_bucket;
    state
        .supabase
        .upload(
            user.token(),
            bucket,
            &path,
            processed.main.bytes.clone(),
            WEBP,
            IMMUTABLE_CACHE_SECS,
        )
        .await?;
    tracing::info!(
        kind = processed.source_kind.label(),
        input_bytes,
        output_bytes = processed.main.bytes.len(),
        source = %format!("{}x{}", processed.source_width, processed.source_height),
        processing_ms = processed.elapsed.as_millis() as u64,
        "avatar stored"
    );
    let body = AvatarResponse {
        url: state.supabase.public_url(bucket, &path),
        path,
        width: processed.main.width,
        height: processed.main.height,
        bytes: processed.main.bytes.len(),
        content_type: WEBP,
    };
    Ok((StatusCode::CREATED, Json(body)).into_response())
}

/// What is stored for idempotent replays (signed URLs are re-issued on every response).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredImage {
    project_id: Uuid,
    path: String,
    thumb_path: String,
    width: u32,
    height: u32,
    bytes: usize,
    thumb_width: u32,
    thumb_height: u32,
    thumb_bytes: usize,
    content_type: String,
    kind: Option<String>,
    client_id: Option<String>,
    captured_at: String,
}

fn valid_kind(kind: &str) -> bool {
    (1..=32).contains(&kind.len())
        && kind.as_bytes()[0].is_ascii_lowercase()
        && kind
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn client_id_from(form: Option<String>, headers: &HeaderMap) -> Result<Option<String>, AppError> {
    let header = ["idempotency-key", "x-client-id"]
        .iter()
        .find_map(|name| headers.get(*name))
        .map(|v| {
            v.to_str()
                .map(str::to_owned)
                .map_err(|_| AppError::validation("Invalid idempotency key."))
        })
        .transpose()?;
    let id = form.filter(|s| !s.is_empty()).or(header);
    match id {
        Some(id) if !valid_client_id(&id) => Err(AppError::validation(
            "client_id must be 8–128 characters of letters, digits, '-', '_', '.' or ':' (a UUID works).",
        )),
        other => Ok(other),
    }
}

/// `POST /v1/media/images`: project photo (≤1600 px) + thumbnail (≤400 px), private bucket.
pub async fn upload_image(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<Response, AppError> {
    state.limiter.check(RateClass::Upload, user.id).await?;
    let _admitted = state.uploads.admit(user.id).await?;
    let dir = temp_dir()?;
    let form = read_form(
        multipart,
        dir.path(),
        state.config.max_upload_bytes,
        &["project_id", "client_id", "kind"],
    )
    .await?;

    let project_id = form
        .project_id
        .as_deref()
        .ok_or_else(|| AppError::validation("Add the project_id field."))
        .and_then(|raw| {
            Uuid::parse_str(raw).map_err(|_| AppError::validation("project_id must be a UUID."))
        })?;
    let kind = form.kind.filter(|k| !k.is_empty());
    if kind.as_deref().is_some_and(|k| !valid_kind(k)) {
        return Err(AppError::validation(
            "kind must be a short lowercase word such as \"progress\".",
        ));
    }
    let client_id = client_id_from(form.client_id, &headers)?;
    let (input, input_bytes) = form.file.ok_or_else(missing_file)?;

    let reservation = match &client_id {
        None => None,
        Some(id) => match reserve(&state, &user, project_id, id).await? {
            Reserved::Fresh(reservation) => Some(reservation),
            Reserved::Replayed(response) => return Ok(response),
        },
    };

    let mut slot_held = Duration::ZERO;
    let result = store_image(
        &state,
        &user,
        project_id,
        kind,
        client_id,
        (&input, input_bytes),
        dir.path(),
        &mut slot_held,
    )
    .await;
    charge_processing(&state, &user, slot_held).await;
    match (result, reservation) {
        (Ok(stored), Some(reservation)) => {
            let value = serde_json::to_value(&stored).map_err(AppError::internal)?;
            reservation.commit(&value).await;
            respond_with_urls(&state, &user, &stored, StatusCode::CREATED, false).await
        }
        (Ok(stored), None) => {
            respond_with_urls(&state, &user, &stored, StatusCode::CREATED, false).await
        }
        (Err(error), reservation) => {
            if let Some(reservation) = reservation {
                Reservation::release(reservation).await;
            }
            Err(error)
        }
    }
}

/// Charges the time an upload held an ffmpeg slot to the user's upload budget.
async fn charge_processing(state: &AppState, user: &AuthUser, slot_held: Duration) {
    let units = processing_charge(slot_held);
    if units > 0 {
        tracing::debug!(units, "upload budget charged for processing time");
        state.limiter.charge(RateClass::Upload, user.id, units).await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn store_image(
    state: &AppState,
    user: &AuthUser,
    project_id: Uuid,
    kind: Option<String>,
    client_id: Option<String>,
    (input, input_bytes): (&Path, u64),
    work_dir: &Path,
    slot_held: &mut Duration,
) -> Result<StoredImage, AppError> {
    ensure_project_visible(state, user, project_id).await?;
    let processed = state
        .media
        .process_metered(input, work_dir, Preset::PHOTO, slot_held)
        .await?;
    let thumb = processed
        .thumb
        .clone()
        .ok_or_else(|| AppError::internal("thumbnail missing"))?;

    let now =
        OffsetDateTime::from_unix_timestamp_nanos(i128::from(state.clock.now_ms()) * 1_000_000)
            .map_err(AppError::internal)?;
    let manila = now.to_offset(offset!(+8));
    let base = format!(
        "{project_id}/{:04}/{:02}/{}",
        manila.year(),
        u8::from(manila.month()),
        Uuid::new_v4()
    );
    let path = format!("{base}.webp");
    let thumb_path = format!("{base}_thumb.webp");
    let bucket = &state.config.media_bucket;

    let main_upload = state.supabase.upload(
        user.token(),
        bucket,
        &path,
        processed.main.bytes.clone(),
        WEBP,
        IMMUTABLE_CACHE_SECS,
    );
    let thumb_upload = state.supabase.upload(
        user.token(),
        bucket,
        &thumb_path,
        thumb.bytes.clone(),
        WEBP,
        IMMUTABLE_CACHE_SECS,
    );
    let (main_result, thumb_result) = tokio::join!(main_upload, thumb_upload);
    if let Err(error) = main_result.as_ref().and(thumb_result.as_ref()) {
        // Best-effort cleanup of the half that succeeded (Storage RLS lets only project
        // managers delete; other users' orphans are tiny and swept with the project later).
        let stored: Vec<String> = [
            (main_result.is_ok(), &path),
            (thumb_result.is_ok(), &thumb_path),
        ]
        .into_iter()
        .filter(|(ok, _)| *ok)
        .map(|(_, p)| p.clone())
        .collect();
        if !stored.is_empty()
            && let Err(e) = state.supabase.remove(user.token(), bucket, &stored).await
        {
            tracing::warn!(error = %e, "could not remove partial upload");
        }
        return Err(error.clone());
    }

    tracing::info!(
        %project_id,
        kind = processed.source_kind.label(),
        input_bytes,
        output_bytes = processed.main.bytes.len(),
        thumb_bytes = thumb.bytes.len(),
        source = %format!("{}x{}", processed.source_width, processed.source_height),
        orientation = processed.orientation.unwrap_or(1),
        processing_ms = processed.elapsed.as_millis() as u64,
        "project image stored"
    );
    Ok(StoredImage {
        project_id,
        path,
        thumb_path,
        width: processed.main.width,
        height: processed.main.height,
        bytes: processed.main.bytes.len(),
        thumb_width: thumb.width,
        thumb_height: thumb.height,
        thumb_bytes: thumb.bytes.len(),
        content_type: WEBP.to_owned(),
        kind,
        client_id,
        captured_at: now.format(&Rfc3339).map_err(AppError::internal)?,
    })
}

/// 404 unless the caller can see the project (RLS on `project_overview`).
async fn ensure_project_visible(
    state: &AppState,
    user: &AuthUser,
    project_id: Uuid,
) -> Result<(), AppError> {
    let rows = state
        .supabase
        .rest_get(
            user.token(),
            &format!("/rest/v1/project_overview?select=id&id=eq.{project_id}&limit=1"),
            tokio::time::Instant::now() + state.config.upstream_read_budget,
        )
        .await
        .map_err(|e| match e {
            FetchError::Rejected(error) => error,
            FetchError::Unavailable(reason) => {
                tracing::warn!(%reason, "project visibility check failed");
                AppError::upstream_unavailable()
            }
        })?;
    match rows {
        Value::Array(items) if !items.is_empty() => Ok(()),
        _ => Err(AppError::not_found(
            "This project does not exist or you no longer have access to it.",
        )),
    }
}

async fn replay(
    state: &AppState,
    user: &AuthUser,
    project_id: Uuid,
    stored: Value,
) -> Result<Response, AppError> {
    let stored: StoredImage = serde_json::from_value(stored).map_err(AppError::internal)?;
    if stored.project_id != project_id {
        return Err(AppError::new(
            ErrorCode::Conflict,
            "This client_id was already used for an image in another project. Use a new client_id.",
        ));
    }
    respond_with_urls(state, user, &stored, StatusCode::OK, true).await
}

enum Reserved {
    /// This request owns the key: do the work, then commit.
    Fresh(Reservation),
    /// An earlier request with the same key finished: its result, replayed.
    Replayed(Response),
}

/// Reserves `client_id` for this request. A duplicate that arrives while the first attempt
/// is still running waits for it (up to [`IN_PROGRESS_WAIT`]) and then replays its result;
/// if the first attempt fails and releases the key, the waiting duplicate takes over.
async fn reserve(
    state: &AppState,
    user: &AuthUser,
    project_id: Uuid,
    client_id: &str,
) -> Result<Reserved, AppError> {
    let deadline = tokio::time::Instant::now() + IN_PROGRESS_WAIT;
    loop {
        match state.idempotency.begin("images", user.id, client_id).await {
            Begin::Started(reservation) => return Ok(Reserved::Fresh(reservation)),
            Begin::Replay(stored) => {
                return replay(state, user, project_id, stored)
                    .await
                    .map(Reserved::Replayed);
            }
            Begin::InProgress if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            Begin::InProgress => {
                return Err(AppError::new(
                    ErrorCode::Conflict,
                    "This upload is still being processed. Try again in a moment.",
                )
                .with_retry_after(2));
            }
        }
    }
}

async fn respond_with_urls(
    state: &AppState,
    user: &AuthUser,
    stored: &StoredImage,
    status: StatusCode,
    replayed: bool,
) -> Result<Response, AppError> {
    let ttl = state.config.signed_url_ttl;
    let signed = state
        .supabase
        .sign(
            user.token(),
            &state.config.media_bucket,
            &[&stored.path, &stored.thumb_path],
            ttl,
        )
        .await;
    let (signed_url, thumb_signed_url, expires_at) = match signed {
        Ok(urls) if urls.len() == 2 => {
            let expires = expiry_rfc3339(state, ttl);
            (Some(urls[0].clone()), Some(urls[1].clone()), expires)
        }
        Ok(_) | Err(_) => {
            // The image is stored; the client can fetch URLs later via /v1/media/signed-url.
            tracing::warn!("could not sign URLs for a stored image");
            (None, None, None)
        }
    };
    let mut body = serde_json::to_value(stored).map_err(AppError::internal)?;
    if let Value::Object(map) = &mut body {
        map.insert("signed_url".into(), json!(signed_url));
        map.insert("thumb_signed_url".into(), json!(thumb_signed_url));
        map.insert("signed_url_expires_at".into(), json!(expires_at));
    }
    let mut response = (status, Json(body)).into_response();
    if replayed {
        response
            .headers_mut()
            .insert("idempotent-replayed", HeaderValue::from_static("true"));
    }
    Ok(response)
}

fn expiry_rfc3339(state: &AppState, ttl: Duration) -> Option<String> {
    let at_ms = state.clock.now_ms() + ttl.as_millis() as u64;
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(at_ms) * 1_000_000)
        .ok()?
        .format(&Rfc3339)
        .ok()
}

/// Accepts only object names this service generates: `<uuid>/<yyyy>/<mm>/<uuid>[_thumb].webp`.
pub fn valid_media_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let [project, year, month, file] = parts.as_slice() else {
        return false;
    };
    let Some(stem) = file.strip_suffix(".webp") else {
        return false;
    };
    let stem = stem.strip_suffix("_thumb").unwrap_or(stem);
    let is_uuid = |s: &str| s.len() == 36 && Uuid::parse_str(s).is_ok();
    is_uuid(project)
        && is_uuid(stem)
        && year.len() == 4
        && year.bytes().all(|b| b.is_ascii_digit())
        && month.len() == 2
        && month.parse::<u8>().is_ok_and(|m| (1..=12).contains(&m))
}

#[derive(Debug, Deserialize)]
pub struct SignedUrlQuery {
    path: Option<String>,
}

/// `GET /v1/media/signed-url?path=…`: a fresh short-lived URL for a project image.
pub async fn signed_url(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<SignedUrlQuery>,
) -> Result<Response, AppError> {
    let path = query.path.unwrap_or_default();
    if !valid_media_path(&path) {
        return Err(AppError::validation(
            "path must be an image path returned by /v1/media/images.",
        ));
    }
    state.limiter.check(RateClass::Read, user.id).await?;

    let key = format!("c:v1:sign:{}:{path}", user.id);
    let now_ms = state.clock.now_ms();
    if let Some(cached) = state.cache.get_raw(&key).await {
        let still_valid = cached
            .get("expires_at_ms")
            .and_then(Value::as_u64)
            .is_some_and(|exp| exp > now_ms + 60_000);
        if still_valid {
            return Ok(signed_body(&cached, CacheStatus::Hit));
        }
    }

    let ttl = state.config.signed_url_ttl;
    let urls = state
        .supabase
        .sign(
            user.token(),
            &state.config.media_bucket,
            &[path.as_str()],
            ttl,
        )
        .await?;
    let url = urls
        .into_iter()
        .next()
        .ok_or_else(|| AppError::internal("empty sign response"))?;
    let expires_at_ms = now_ms + ttl.as_millis() as u64;
    let value = json!({
        "path": path,
        "signed_url": url,
        "expires_at_ms": expires_at_ms,
        "expires_at": expiry_rfc3339(&state, ttl),
    });
    // Reuse the URL until a minute before it expires.
    state
        .cache
        .put(&key, &value, ttl.saturating_sub(Duration::from_mins(1)))
        .await;
    Ok(signed_body(&value, CacheStatus::Miss))
}

fn signed_body(value: &Value, status: CacheStatus) -> Response {
    let mut public = value.clone();
    if let Value::Object(map) = &mut public {
        map.remove("expires_at_ms");
    }
    cached_response(&CacheResult {
        value: Arc::new(public),
        status,
        age: Duration::ZERO,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_paths_are_strictly_validated() {
        let p = "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60/2026/10/0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11.webp";
        assert!(valid_media_path(p));
        assert!(valid_media_path(&p.replace(".webp", "_thumb.webp")));
        for bad in [
            "",
            "../avatars/x.webp",
            "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60/2026/13/0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11.webp",
            "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60/2026/10/0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11.jpg",
            "3f1c1a7e-2b1d-4c1a-9a8e-1d2c3b4a5f60/2026/10/../0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11.webp",
            "3f1c1a7e2b1d4c1a9a8e1d2c3b4a5f60/2026/10/0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11.webp",
        ] {
            assert!(!valid_media_path(bad), "{bad}");
        }
    }

    #[test]
    fn kinds_and_client_ids() {
        assert!(valid_kind("progress"));
        assert!(valid_kind("inspection_2"));
        assert!(!valid_kind("Progress"));
        assert!(!valid_kind("../x"));
        let mut headers = HeaderMap::new();
        headers.insert(
            "idempotency-key",
            HeaderValue::from_static("0b6c2c1e-3f4f-4d8e"),
        );
        assert_eq!(
            client_id_from(None, &headers).unwrap().as_deref(),
            Some("0b6c2c1e-3f4f-4d8e")
        );
        assert_eq!(
            client_id_from(Some("form-value-123".into()), &headers)
                .unwrap()
                .as_deref(),
            Some("form-value-123")
        );
        assert!(client_id_from(Some("bad id".into()), &HeaderMap::new()).is_err());
        assert_eq!(client_id_from(None, &HeaderMap::new()).unwrap(), None);
    }
}
