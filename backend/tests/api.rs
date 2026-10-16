//! End-to-end tests of the HTTP API against a fake Supabase (wiremock), a real local
//! `redis-server` and the real ffmpeg/ffprobe. No network access is needed.
//!
//! Tests that need Redis print `SKIPPED (redis part)` and fall back to the in-memory path when
//! `redis-server` is not installed.

#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: failing loudly is the point

mod common;

use std::time::Duration;

use axum::body::Body;
use civpms_media::media::exif::jpeg_with_orientation;
use civpms_media::media::sniff::webp_chunks;
use common::{
    KID, Multipart, ORIGIN, RedisServer, TestApp, free_port, image, jpeg_with_fake_dimensions,
    mint, png_header_only, probe,
};
use http::{Request, StatusCode};
use uuid::Uuid;

const UUID_RE_LEN: usize = 36;

fn assert_uuid_webp(name: &str) {
    let stem = name
        .strip_suffix(".webp")
        .unwrap_or_else(|| panic!("not .webp: {name}"));
    let stem = stem.strip_suffix("_thumb").unwrap_or(stem);
    assert_eq!(stem.len(), UUID_RE_LEN, "{name}");
    Uuid::parse_str(stem).unwrap_or_else(|_| panic!("not a uuid: {name}"));
}

// ---------------------------------------------------------------------------
// Probes, envelope, headers, CORS
// ---------------------------------------------------------------------------

#[tokio::test]
async fn healthz_is_dependency_free_and_hardened() {
    let app = TestApp::start(None, &[]).await;
    let response = app
        .send(Request::get("/healthz").body(Body::empty()).unwrap())
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.json()["status"], "ok");
    assert_eq!(response.header("x-content-type-options"), Some("nosniff"));
    assert!(
        response
            .header("x-request-id")
            .is_some_and(|id| id.len() >= 32)
    );
}

#[tokio::test]
async fn readyz_reports_redis_ffmpeg_and_jwks() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let app = TestApp::start(Some(&redis.url()), &[]).await;
    let ready = app.get("/readyz").await;
    let body = ready.json();
    assert_eq!(ready.status, StatusCode::OK, "{body}");
    assert_eq!(body["checks"]["redis"]["status"], "up");
    assert_eq!(body["checks"]["jwks"]["status"], "loaded");
    assert_eq!(body["checks"]["media"]["webp_encoder"], true);
    assert_eq!(body["checks"]["media"]["formats"]["jpeg"], true);
    assert!(
        body["checks"]["media"]["formats"].get("heic").is_some(),
        "HEIC capability reported"
    );
    assert!(
        body["checks"]["media"]["formats"].get("avif").is_some(),
        "AVIF capability reported"
    );
    assert_eq!(body["checks"]["media"]["orientation_selftest"], "passed");
}

#[tokio::test]
async fn readyz_is_503_with_details_when_redis_is_down_but_requests_still_work() {
    // Nothing listens on this port: Redis is configured but down.
    let dead_redis = format!("redis://127.0.0.1:{}", free_port());
    let app = TestApp::start(Some(&dead_redis), &[]).await;
    let ready = app.get("/readyz").await;
    assert_eq!(ready.status, StatusCode::SERVICE_UNAVAILABLE);
    let body = ready.json();
    assert_eq!(body["status"], "not_ready");
    assert_eq!(body["checks"]["redis"]["status"], "down");
    assert_eq!(body["checks"]["jwks"]["status"], "loaded");

    // Degraded mode: in-memory cache and rate limits keep the API answering.
    let first = app.get("/v1/projects").await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(first.header("x-cache"), Some("MISS"));
    let second = app.get("/v1/projects").await;
    assert_eq!(second.header("x-cache"), Some("HIT"));
    assert_eq!(app.get("/healthz").await.status, StatusCode::OK);
}

#[tokio::test]
async fn unknown_routes_and_methods_use_the_error_envelope() {
    let app = TestApp::start(None, &[]).await;
    let missing = app.get("/nope").await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert_eq!(missing.error_code(), "NOT_FOUND");
    let request_id = missing.json()["error"]["request_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(missing.header("x-request-id"), Some(request_id.as_str()));

    let wrong_method = app
        .send(
            app.authed("DELETE", "/v1/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(wrong_method.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(wrong_method.error_code(), "METHOD_NOT_ALLOWED");

    // A client request id is propagated when it is a plain token, replaced when it is not.
    let mut request = app.authed("GET", "/nope").body(Body::empty()).unwrap();
    request
        .headers_mut()
        .insert("x-request-id", "client-req-123".parse().unwrap());
    assert_eq!(
        app.send(request).await.header("x-request-id"),
        Some("client-req-123")
    );
    let mut request = app.authed("GET", "/nope").body(Body::empty()).unwrap();
    request
        .headers_mut()
        .insert("x-request-id", "evil\tid".parse().unwrap());
    assert_ne!(
        app.send(request).await.header("x-request-id"),
        Some("evil\tid")
    );
}

#[tokio::test]
async fn cors_allows_only_listed_origins() {
    let app = TestApp::start(None, &[]).await;
    let preflight = |origin: &str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/media/avatar")
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                "authorization,content-type,idempotency-key",
            )
            .body(Body::empty())
            .unwrap()
    };
    let allowed = app.send(preflight(ORIGIN)).await;
    assert!(allowed.status.is_success(), "{allowed:?}");
    assert_eq!(allowed.header("access-control-allow-origin"), Some(ORIGIN));
    let methods = allowed
        .header("access-control-allow-methods")
        .unwrap()
        .to_ascii_uppercase();
    assert!(methods.contains("POST") && methods.contains("GET") && !methods.contains("DELETE"));
    let headers = allowed
        .header("access-control-allow-headers")
        .unwrap()
        .to_ascii_lowercase();
    assert!(headers.contains("authorization") && headers.contains("idempotency-key"));

    let denied = app.send(preflight("https://evil.example.com")).await;
    assert!(denied.header("access-control-allow-origin").is_none());
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rejects_missing_invalid_expired_and_foreign_tokens() {
    let app = TestApp::start(None, &[]).await;
    let anonymous = app
        .send(Request::get("/v1/projects").body(Body::empty()).unwrap())
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    assert_eq!(anonymous.error_code(), "UNAUTHENTICATED");
    assert!(anonymous.json()["error"]["request_id"].is_string());

    let issuer = app.supabase.issuer();
    let user = Uuid::new_v4();
    let cases = [
        ("garbage", "not.a.jwt".to_owned()),
        ("expired", mint(&issuer, user, -3600, 0x42, KID)),
        ("unknown signing key", mint(&issuer, user, 3600, 0x43, KID)),
        ("unknown kid", mint(&issuer, user, 3600, 0x42, "rotated")),
        (
            "other project",
            mint("https://other.supabase.co/auth/v1", user, 3600, 0x42, KID),
        ),
    ];
    for (label, token) in cases {
        let request = Request::get("/v1/projects")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let response = app.send(request).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{label}");
        assert!(
            !String::from_utf8_lossy(&response.bytes).contains(&token),
            "{label}: token echoed"
        );
    }
    // Responses to authenticated routes are never cacheable by shared caches.
    assert_eq!(
        app.get("/v1/projects").await.header("cache-control"),
        Some("private, no-store")
    );
}

/// Regression (review finding): after `JWKS_TTL` every authenticated request waited for its
/// own 5 s JWKS fetch, one after another, while Supabase Auth was slow.
#[tokio::test]
async fn slow_supabase_auth_does_not_delay_requests_once_the_jwks_is_stale() {
    let clock = civpms_media::clock::ManualClock::new(now_ms());
    let supabase = common::FakeSupabase::start().await;
    let app = TestApp::with_clock(supabase, None, &[], clock.clone()).await;
    assert_eq!(
        app.get("/v1/holidays?year=2026").await.status,
        StatusCode::OK
    );

    app.supabase.slow_jwks(Duration::from_secs(8)).await;
    clock.advance(civpms_media::auth::jwks::JWKS_TTL + Duration::from_mins(1));
    let started = std::time::Instant::now();
    let (a, b, c) = tokio::join!(
        app.get("/v1/holidays?year=2026"),
        app.get("/v1/holidays?year=2026"),
        app.get("/v1/holidays?year=2026"),
    );
    for response in [a, b, c] {
        assert_eq!(response.status, StatusCode::OK);
    }
    for _ in 0..3 {
        assert_eq!(
            app.get("/v1/holidays?year=2026").await.status,
            StatusCode::OK
        );
    }
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "requests waited for the JWKS fetch: {:?}",
        started.elapsed()
    );
    tokio::time::sleep(Duration::from_millis(300)).await; // let the background task connect
    assert_eq!(
        app.supabase
            .count("GET", "/auth/v1/.well-known/jwks.json")
            .await,
        2,
        "startup fetch + one background refresh"
    );
}

fn now_ms() -> u64 {
    u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

#[tokio::test]
async fn avatar_upload_produces_a_256px_webp_stored_with_the_users_token() {
    let app = TestApp::start(None, &[]).await;
    let jpeg = image(1200, 800, "jpg");
    let form = Multipart::new().file("file", "me.jpg", jpeg.clone());
    let response = app.upload("/v1/media/avatar", &form).await;
    assert_eq!(
        response.status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&response.bytes)
    );
    let body = response.json();
    assert_eq!(
        (body["width"].as_u64(), body["height"].as_u64()),
        (Some(256), Some(256))
    );
    assert_eq!(body["content_type"], "image/webp");
    let path = body["path"].as_str().unwrap();
    let (folder, name) = path.split_once('/').unwrap();
    assert_eq!(folder, app.user.to_string());
    assert_uuid_webp(name);
    assert_eq!(
        body["url"],
        format!(
            "{}/storage/v1/object/public/avatars/{path}",
            app.supabase.url()
        )
    );

    let uploads = app.supabase.uploads("avatars").await;
    assert_eq!(uploads.len(), 1);
    let (stored_path, headers, bytes) = &uploads[0];
    assert_eq!(stored_path, path);
    assert_eq!(
        headers["authorization"],
        format!("Bearer {}", app.token),
        "user JWT forwarded"
    );
    assert_eq!(headers["apikey"], "sb_publishable_test_key_0123456789");
    assert_eq!(headers["content-type"], "image/webp");
    assert_eq!(headers["x-upsert"], "false");
    assert_eq!(bytes.len() as u64, body["bytes"].as_u64().unwrap());
    let (codec, width, height, tags) = probe(bytes);
    assert_eq!((codec.as_str(), width, height), ("webp", 256, 256));
    assert!(tags.is_empty(), "metadata left in the avatar: {tags:?}");
    assert!(
        bytes.len() < jpeg.len(),
        "compressed: {} -> {}",
        jpeg.len(),
        bytes.len()
    );
}

#[tokio::test]
async fn rejects_non_images_bombs_and_oversized_files() {
    let app = TestApp::start(
        None,
        &[("MAX_UPLOAD_MB", "1"), ("MAX_IMAGE_PIXELS", "4000000")],
    )
    .await;

    // A text file renamed .jpg.
    let fake = Multipart::new().file(
        "file",
        "photo.jpg",
        b"definitely not an image, just text".repeat(10),
    );
    let response = app.upload("/v1/media/avatar", &fake).await;
    assert_eq!(response.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(response.error_code(), "UNSUPPORTED_MEDIA_TYPE");

    // SVG (scriptable) is not accepted either.
    let svg = Multipart::new().file(
        "file",
        "x.png",
        b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
    );
    assert_eq!(
        app.upload("/v1/media/avatar", &svg).await.status,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    // Decompression bombs: headers claiming huge dimensions are refused before decoding.
    let bomb_png = Multipart::new().file("file", "bomb.png", png_header_only(100_000, 80_000));
    let response = app.upload("/v1/media/avatar", &bomb_png).await;
    assert_eq!(response.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(response.error_code(), "IMAGE_TOO_LARGE");
    let bomb_jpeg = jpeg_with_fake_dimensions(&image(64, 64, "jpg"), 60_000, 60_000);
    let response = app
        .upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "b.jpg", bomb_jpeg),
        )
        .await;
    assert_eq!(response.error_code(), "IMAGE_TOO_LARGE");
    // Just over the configured 4 MP limit, with a real (small) file.
    let big = jpeg_with_fake_dimensions(&image(64, 64, "jpg"), 2001, 2000);
    assert_eq!(
        app.upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "b.jpg", big)
        )
        .await
        .error_code(),
        "IMAGE_TOO_LARGE"
    );

    // Corrupt image: valid PNG header, then cut off. (A cut-off JPEG is decoded with error
    // concealment, like browsers do, so PNG is the deterministic case.)
    let png = image(640, 480, "png");
    let truncated = Multipart::new().file("file", "cut.png", png[..png.len() / 3].to_vec());
    let response = app.upload("/v1/media/avatar", &truncated).await;
    assert_eq!(
        response.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        String::from_utf8_lossy(&response.bytes)
    );
    assert_eq!(response.error_code(), "PROCESSING_FAILED");

    // Over MAX_UPLOAD_MB.
    let mut huge = image(64, 64, "jpg");
    huge.resize(1_300_000, 0);
    let response = app
        .upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "big.jpg", huge),
        )
        .await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.error_code(), "PAYLOAD_TOO_LARGE");

    // Missing file / unexpected fields.
    let response = app
        .upload("/v1/media/avatar", &Multipart::new().text("note", "hi"))
        .await;
    assert_eq!(response.error_code(), "VALIDATION");
    let response = app.upload("/v1/media/avatar", &Multipart::new()).await;
    assert_eq!(response.error_code(), "VALIDATION");

    assert!(
        app.supabase.uploads("avatars").await.is_empty(),
        "nothing stored"
    );
}

/// Regression (review finding): a failed orientation self-test only logged an error while
/// uploads went on storing rotated photos sideways (and Render checks `/healthz` only).
/// Simulated with an ffmpeg wrapper that drops `-noautorotate`, so JPEGs rotate twice.
#[tokio::test]
async fn failed_orientation_selftest_refuses_uploads_and_startup() {
    let dir = tempfile::tempdir().unwrap();
    let wrapper = dir.path().join("ffmpeg");
    let real = which("ffmpeg");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nfor a in \"$@\"; do shift; [ \"$a\" = \"-noautorotate\" ] || set -- \"$@\" \"$a\"; done\nexec {} \"$@\"\n",
            real.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let app = TestApp::start(None, &[("FFMPEG_PATH", wrapper.to_str().unwrap())]).await;
    assert_eq!(
        app.state.media.selftest(),
        civpms_media::media::SelfTest::Failed
    );
    assert!(matches!(
        app.state.startup_check(),
        Err(civpms_media::StartupError::MediaSelfTest)
    ));
    let ready = app.get("/readyz").await;
    assert_eq!(ready.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        ready.json()["checks"]["media"]["orientation_selftest"],
        "failed"
    );

    let form = Multipart::new().file("file", "me.jpg", image(320, 240, "jpg"));
    let response = app.upload("/v1/media/avatar", &form).await;
    assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.error_code(), "MEDIA_UNAVAILABLE");
    assert!(app.supabase.uploads("avatars").await.is_empty());
}

fn which(tool: &str) -> std::path::PathBuf {
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join(tool))
                .find(|candidate| candidate.is_file())
        })
        .unwrap_or_else(|| panic!("{tool} not on PATH"))
}

/// Regression (review finding): the pixel cap ignored bit depth, so a small 16-bit PNG could
/// need several hundred MB to decode. The decoder-memory estimate refuses it before ffprobe
/// runs, while the same picture in 8-bit is fine.
#[tokio::test]
async fn decode_memory_limit_refuses_high_bit_depth_sources() {
    let app = TestApp::start(None, &[("MAX_DECODE_MB", "32")]).await;
    // 2100 × 2100: 35 MB as 16-bit RGBA (over 32 MiB), 17.6 MB as 8-bit RGBA.
    let deep = common::image_with(2100, 2100, "png", "rgba64be");
    let response = app
        .upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "deep.png", deep),
        )
        .await;
    assert_eq!(response.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(response.error_code(), "IMAGE_TOO_LARGE");
    assert!(
        response.json()["error"]["message"]
            .as_str()
            .unwrap()
            .contains("too much memory")
    );

    let normal = common::image_with(2100, 2100, "png", "rgba");
    let response = app
        .upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "normal.png", normal),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED);
    assert_eq!(app.supabase.uploads("avatars").await.len(), 1);
}

#[tokio::test]
async fn accepts_webp_gif_and_avif_sources() {
    let app = TestApp::start(None, &[]).await;
    let avif_supported = app
        .state
        .media
        .capabilities()
        .supports(civpms_media::media::sniff::ImageKind::Avif);
    for ext in ["webp", "gif", "png", "avif"] {
        if ext == "avif" && !avif_supported {
            eprintln!("SKIPPED (avif part): this ffmpeg cannot decode AVIF");
            continue;
        }
        let form = Multipart::new().file("file", &format!("in.{ext}"), image(500, 300, ext));
        let response = app.upload("/v1/media/avatar", &form).await;
        assert_eq!(
            response.status,
            StatusCode::CREATED,
            "{ext}: {}",
            String::from_utf8_lossy(&response.bytes)
        );
        assert_eq!(response.json()["width"], 256, "{ext}");
    }
    let stored = app.supabase.uploads("avatars").await;
    assert!(stored.iter().all(|(_, _, bytes)| probe(bytes).0 == "webp"));
}

// ---------------------------------------------------------------------------
// Project images
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_image_is_resized_with_thumbnail_and_signed_urls() {
    let app = TestApp::start(None, &[]).await;
    let project = Uuid::new_v4();
    app.supabase.add_project(project).await;
    let png = image(3000, 2000, "png");
    let form = Multipart::new()
        .text("project_id", &project.to_string())
        .text("kind", "progress")
        .file("file", "site.png", png.clone());
    let response = app.upload("/v1/media/images", &form).await;
    assert_eq!(
        response.status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&response.bytes)
    );
    let body = response.json();
    assert_eq!(
        (body["width"].as_u64(), body["height"].as_u64()),
        (Some(1600), Some(1067))
    );
    assert_eq!(
        (body["thumb_width"].as_u64(), body["thumb_height"].as_u64()),
        (Some(400), Some(267))
    );
    assert_eq!(body["kind"], "progress");
    assert_eq!(body["content_type"], "image/webp");
    assert!(body["captured_at"].as_str().unwrap().ends_with('Z'));
    let path = body["path"].as_str().unwrap();
    let thumb_path = body["thumb_path"].as_str().unwrap();
    let parts: Vec<&str> = path.split('/').collect();
    assert_eq!(parts.len(), 4, "{path}");
    assert_eq!(parts[0], project.to_string());
    assert!(parts[1].len() == 4 && parts[2].len() == 2);
    assert_uuid_webp(parts[3]);
    assert_eq!(thumb_path, path.replace(".webp", "_thumb.webp"));
    for key in ["signed_url", "thumb_signed_url"] {
        let url = body[key].as_str().unwrap();
        assert!(
            url.starts_with(&format!(
                "{}/storage/v1/object/sign/project-media/",
                app.supabase.url()
            )),
            "{url}"
        );
    }
    assert!(body["signed_url_expires_at"].is_string());

    let uploads = app.supabase.uploads("project-media").await;
    assert_eq!(uploads.len(), 2);
    for (stored, _, bytes) in &uploads {
        let (codec, w, h, tags) = probe(bytes);
        assert_eq!(codec, "webp");
        assert!(tags.is_empty(), "{tags:?}");
        if stored == path {
            assert_eq!((w, h), (1600, 1067));
            assert_eq!(bytes.len() as u64, body["bytes"].as_u64().unwrap());
        } else {
            assert_eq!(stored, thumb_path);
            assert_eq!((w, h), (400, 267));
            assert_eq!(bytes.len() as u64, body["thumb_bytes"].as_u64().unwrap());
        }
        assert!(bytes.len() < 3 * 1024 * 1024, "fits the bucket limit");
    }
}

#[tokio::test]
async fn exif_rotation_is_applied_and_metadata_stripped() {
    let app = TestApp::start(None, &[]).await;
    let project = Uuid::new_v4();
    app.supabase.add_project(project).await;
    // Landscape pixels tagged "rotate 90° clockwise" (orientation 6) + a fake GPS marker.
    let rotated = jpeg_with_orientation(&image(800, 400, "jpg"), 6).unwrap();
    assert!(rotated.windows(17).any(|w| w == b"CIVPMS-SECRET-GPS"));
    let form = Multipart::new()
        .text("project_id", &project.to_string())
        .file("file", "r.jpg", rotated);
    let response = app.upload("/v1/media/images", &form).await;
    assert_eq!(
        response.status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&response.bytes)
    );
    let body = response.json();
    assert_eq!(
        (body["width"].as_u64(), body["height"].as_u64()),
        (Some(400), Some(800)),
        "upright portrait"
    );

    for (_, _, bytes) in app.supabase.uploads("project-media").await {
        let chunks = webp_chunks(&bytes).unwrap();
        for forbidden in [*b"EXIF", *b"XMP ", *b"ICCP"] {
            assert!(
                !chunks.contains(&forbidden),
                "metadata chunk left: {chunks:?}"
            );
        }
        assert!(
            !bytes.windows(17).any(|w| w == b"CIVPMS-SECRET-GPS"),
            "GPS marker leaked"
        );
        assert!(probe(&bytes).3.is_empty());
    }

    // Avatars honour the orientation too (square crop of the upright image).
    let avatar = jpeg_with_orientation(&image(800, 400, "jpg"), 8).unwrap();
    let response = app
        .upload(
            "/v1/media/avatar",
            &Multipart::new().file("file", "a.jpg", avatar),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED);
}

#[tokio::test]
async fn invisible_projects_are_404_and_nothing_is_stored() {
    let app = TestApp::start(None, &[]).await;
    app.supabase.hide_other_projects().await;
    let form = Multipart::new()
        .text("project_id", &Uuid::new_v4().to_string())
        .file("file", "x.jpg", image(320, 240, "jpg"));
    let response = app.upload("/v1/media/images", &form).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.error_code(), "NOT_FOUND");
    assert!(app.supabase.uploads("project-media").await.is_empty());

    // Validation of the other fields.
    let bad_id = Multipart::new().text("project_id", "../avatars").file(
        "file",
        "x.jpg",
        image(32, 32, "jpg"),
    );
    assert_eq!(
        app.upload("/v1/media/images", &bad_id).await.error_code(),
        "VALIDATION"
    );
    let bad_kind = Multipart::new()
        .text("project_id", &Uuid::new_v4().to_string())
        .text("kind", "../../etc")
        .file("file", "x.jpg", image(32, 32, "jpg"));
    assert_eq!(
        app.upload("/v1/media/images", &bad_kind).await.error_code(),
        "VALIDATION"
    );
    let bad_client = Multipart::new()
        .text("project_id", &Uuid::new_v4().to_string())
        .text("client_id", "no spaces allowed")
        .file("file", "x.jpg", image(32, 32, "jpg"));
    assert_eq!(
        app.upload("/v1/media/images", &bad_client)
            .await
            .error_code(),
        "VALIDATION"
    );
}

async fn idempotency_scenario(app: &TestApp) {
    let project = Uuid::new_v4();
    app.supabase.add_project(project).await;
    let client_id = Uuid::new_v4().to_string();
    let form = Multipart::new()
        .text("project_id", &project.to_string())
        .text("client_id", &client_id)
        .file("file", "x.jpg", image(1024, 768, "jpg"));

    let first = app.upload("/v1/media/images", &form).await;
    assert_eq!(first.status, StatusCode::CREATED);
    let replay = app.upload("/v1/media/images", &form).await;
    assert_eq!(replay.status, StatusCode::OK);
    assert_eq!(replay.header("idempotent-replayed"), Some("true"));
    assert_eq!(replay.json()["path"], first.json()["path"]);
    assert_eq!(replay.json()["client_id"], client_id.as_str());
    assert!(
        replay.json()["signed_url"].is_string(),
        "fresh signed URLs on replay"
    );
    assert_eq!(
        app.supabase.uploads("project-media").await.len(),
        2,
        "stored once (main + thumb)"
    );

    // The same key via the Idempotency-Key header.
    let header_form = Multipart::new()
        .text("project_id", &project.to_string())
        .file("file", "x.jpg", image(64, 64, "jpg"));
    let via_header = app
        .upload_as(
            &app.token,
            "/v1/media/images",
            &header_form,
            &[("idempotency-key", &client_id)],
        )
        .await;
    assert_eq!(via_header.status, StatusCode::OK);
    assert_eq!(via_header.json()["path"], first.json()["path"]);

    // Reusing a key for another project is a conflict, not a silent replay.
    let other = Uuid::new_v4();
    app.supabase.add_project(other).await;
    let conflicting = Multipart::new()
        .text("project_id", &other.to_string())
        .text("client_id", &client_id)
        .file("file", "x.jpg", image(64, 64, "jpg"));
    assert_eq!(
        app.upload("/v1/media/images", &conflicting).await.status,
        StatusCode::CONFLICT
    );

    // Keys are per user: another user with the same client_id gets their own upload.
    let (_, other_token) = app.other_user();
    let theirs = app
        .upload_as(&other_token, "/v1/media/images", &form, &[])
        .await;
    assert_eq!(theirs.status, StatusCode::CREATED);
    assert_ne!(theirs.json()["path"], first.json()["path"]);

    // Concurrent duplicates: both get the same stored image, uploaded once.
    let concurrent_id = Uuid::new_v4().to_string();
    let form = Multipart::new()
        .text("project_id", &project.to_string())
        .text("client_id", &concurrent_id)
        .file("file", "x.jpg", image(1600, 1200, "jpg"));
    let before = app.supabase.uploads("project-media").await.len();
    let (a, b) = tokio::join!(
        app.upload("/v1/media/images", &form),
        app.upload("/v1/media/images", &form)
    );
    let mut statuses = [a.status.as_u16(), b.status.as_u16()];
    statuses.sort_unstable();
    assert_eq!(statuses, [200, 201]);
    assert_eq!(a.json()["path"], b.json()["path"]);
    assert_eq!(
        app.supabase.uploads("project-media").await.len() - before,
        2
    );
}

#[tokio::test]
async fn idempotent_uploads_with_redis() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let app = TestApp::start(Some(&redis.url()), &[]).await;
    idempotency_scenario(&app).await;
    let keys = redis.cli(&["--scan", "--pattern", "idem:v1:*"]);
    assert!(keys.lines().count() >= 3, "results stored in Redis: {keys}");
    let ttl: i64 = redis
        .cli(&["TTL", keys.lines().next().unwrap()])
        .parse()
        .unwrap();
    assert!(
        ttl > 23 * 3600 && ttl <= 24 * 3600,
        "24 h retention, got {ttl}"
    );
}

#[tokio::test]
async fn idempotent_uploads_without_redis() {
    let app = TestApp::start(None, &[]).await;
    idempotency_scenario(&app).await;
}

#[tokio::test]
async fn ffmpeg_queue_full_returns_503_busy() {
    let app = TestApp::start(
        None,
        &[
            ("FFMPEG_CONCURRENCY", "1"),
            ("FFMPEG_QUEUE_TIMEOUT_SECS", "1"),
            ("MAX_CONCURRENT_UPLOADS", "16"),
        ],
    )
    .await;
    let project = Uuid::new_v4();
    app.supabase.add_project(project).await;
    let big = image(4000, 3000, "png");
    let form = || {
        Multipart::new()
            .text("project_id", &project.to_string())
            .file("file", "x.png", big.clone())
    };
    // Six different users (one user's uploads are admitted one at a time).
    let forms: Vec<Multipart> = (0..6).map(|_| form()).collect();
    let tokens: Vec<String> = (0..6).map(|_| app.other_user().1).collect();
    let responses = join_all(
        forms
            .iter()
            .zip(&tokens)
            .map(|(f, token)| app.upload_as(token, "/v1/media/images", f, &[]))
            .collect(),
    )
    .await;
    let busy: Vec<_> = responses
        .iter()
        .filter(|r| r.status == StatusCode::SERVICE_UNAVAILABLE)
        .collect();
    let created = responses
        .iter()
        .filter(|r| r.status == StatusCode::CREATED)
        .count();
    assert!(created >= 1, "at least one went through");
    for response in &busy {
        assert_eq!(response.error_code(), "BUSY");
        assert!(response.header("retry-after").is_some());
    }
    assert_eq!(
        created + busy.len(),
        6,
        "{:?}",
        responses.iter().map(|r| r.status).collect::<Vec<_>>()
    );
}

/// An ffmpeg wrapper that sleeps `delay_secs` before each real encode (the runs that write
/// `main.webp`) and appends `overlap` to `<dir>/log` when two encodes run at the same time.
fn slow_ffmpeg(dir: &std::path::Path, delay_secs: f32) -> std::path::PathBuf {
    let running = dir.join("running");
    std::fs::create_dir_all(&running).unwrap();
    let wrapper = dir.join("ffmpeg");
    std::fs::write(
        &wrapper,
        format!(
            r#"#!/bin/sh
case "$*" in
  *main.webp*)
    if [ -n "$(ls -A {running})" ]; then echo overlap >> {log}; fi
    touch {running}/$$
    sleep {delay_secs}
    {real} "$@"; rc=$?
    rm -f {running}/$$
    exit $rc ;;
  *) exec {real} "$@" ;;
esac
"#,
            running = running.display(),
            log = dir.join("log").display(),
            real = which("ffmpeg").display(),
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    wrapper
}

/// Regression (review finding): any account could keep the single ffmpeg slot busy by sending
/// many slow uploads at once. Now one user's uploads are admitted one at a time (the others
/// wait their turn, and other users' uploads run in between), and an instance-wide cap refuses
/// extra uploads with 503 before their bodies are written to disk.
#[tokio::test]
async fn uploads_are_admitted_one_per_user_with_a_global_cap() {
    let dir = tempfile::tempdir().unwrap();
    let wrapper = slow_ffmpeg(dir.path(), 1.0);
    let app = TestApp::start(
        None,
        &[
            ("FFMPEG_PATH", wrapper.to_str().unwrap()),
            ("FFMPEG_CONCURRENCY", "4"),
            ("MAX_CONCURRENT_UPLOADS", "2"),
        ],
    )
    .await;
    let _ = std::fs::remove_file(dir.path().join("log")); // the startup self-test
    let form = Multipart::new().file("file", "me.jpg", image(320, 240, "jpg"));

    // One user, three uploads at once: all succeed, but their encodes never overlap even
    // though four ffmpeg slots are free.
    let started = std::time::Instant::now();
    let (a, b, c) = tokio::join!(
        app.upload("/v1/media/avatar", &form),
        app.upload("/v1/media/avatar", &form),
        app.upload("/v1/media/avatar", &form),
    );
    for response in [&a, &b, &c] {
        assert_eq!(response.status, StatusCode::CREATED, "{:?}", response.json());
    }
    assert!(started.elapsed() >= Duration::from_secs(3), "ran one at a time");
    assert!(
        !dir.path().join("log").exists(),
        "one user's encodes overlapped"
    );
    assert_eq!(app.state.uploads.in_progress(), 0);

    // Global cap (2): with two uploads in progress, a third user is refused at once.
    let (_, t1) = app.other_user();
    let (_, t2) = app.other_user();
    let (_, t3) = app.other_user();
    let third = async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let at = std::time::Instant::now();
        let response = app.upload_as(&t3, "/v1/media/avatar", &form, &[]).await;
        (response, at.elapsed())
    };
    let (r1, r2, (r3, took)) = tokio::join!(
        app.upload_as(&t1, "/v1/media/avatar", &form, &[]),
        app.upload_as(&t2, "/v1/media/avatar", &form, &[]),
        third,
    );
    assert_eq!(r1.status, StatusCode::CREATED);
    assert_eq!(r2.status, StatusCode::CREATED);
    assert_eq!(r3.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(r3.error_code(), "BUSY");
    assert!(r3.header("retry-after").is_some());
    assert!(took < Duration::from_millis(500), "refused without waiting: {took:?}");
    // Once the others are done, the third user gets through.
    assert_eq!(
        app.upload_as(&t3, "/v1/media/avatar", &form, &[]).await.status,
        StatusCode::CREATED
    );
}

/// A user whose previous upload is still processing after `FFMPEG_QUEUE_TIMEOUT_SECS` gets
/// 429 with Retry-After (and costs nobody else anything).
#[tokio::test]
async fn a_users_queued_upload_gives_up_with_429() {
    let dir = tempfile::tempdir().unwrap();
    let wrapper = slow_ffmpeg(dir.path(), 2.5);
    let app = TestApp::start(
        None,
        &[
            ("FFMPEG_PATH", wrapper.to_str().unwrap()),
            ("FFMPEG_QUEUE_TIMEOUT_SECS", "1"),
        ],
    )
    .await;
    let form = Multipart::new().file("file", "me.jpg", image(320, 240, "jpg"));
    let (_, other) = app.other_user();
    let second = async {
        tokio::time::sleep(Duration::from_millis(300)).await;
        app.upload("/v1/media/avatar", &form).await
    };
    let theirs = async {
        tokio::time::sleep(Duration::from_millis(300)).await;
        app.upload_as(&other, "/v1/media/avatar", &form, &[]).await
    };
    let (first, second, theirs) =
        tokio::join!(app.upload("/v1/media/avatar", &form), second, theirs);
    assert_eq!(first.status, StatusCode::CREATED);
    assert_eq!(second.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(second.error_code(), "RATE_LIMITED");
    assert!(second.header("retry-after").is_some());
    assert_eq!(theirs.status, StatusCode::CREATED, "other users are unaffected");
}

/// Regression (review finding): the upload budget counted requests, not processing time, so
/// a few slow images per minute kept the free instance's only ffmpeg slot busy. Every second
/// an upload holds the slot now costs one more unit of the user's budget.
#[tokio::test]
async fn processing_time_is_charged_to_the_upload_budget() {
    let dir = tempfile::tempdir().unwrap();
    let wrapper = slow_ffmpeg(dir.path(), 2.2);
    let clock = civpms_media::clock::ManualClock::new(now_ms() / 60_000 * 60_000 + 1_000);
    let supabase = common::FakeSupabase::start().await;
    let app = TestApp::with_clock(
        supabase,
        None,
        &[
            ("FFMPEG_PATH", wrapper.to_str().unwrap()),
            ("RATE_LIMIT_UPLOADS_PER_MIN", "4"),
        ],
        clock,
    )
    .await;
    let form = Multipart::new().file("file", "me.jpg", image(320, 240, "jpg"));
    // 1 (request) + 2 (seconds) = 3, then 4 + 2 = 6: the third request is over budget,
    // although a plain request count (3) would still be under 4.
    assert_eq!(
        app.upload("/v1/media/avatar", &form).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        app.upload("/v1/media/avatar", &form).await.status,
        StatusCode::CREATED
    );
    let limited = app.upload("/v1/media/avatar", &form).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.error_code(), "RATE_LIMITED");
    // Another user's budget is untouched.
    let (_, other) = app.other_user();
    assert_eq!(
        app.upload_as(&other, "/v1/media/avatar", &form, &[])
            .await
            .status,
        StatusCode::CREATED
    );
}

/// Polls every future concurrently on the current task (no extra dependency needed).
async fn join_all<F: Future>(futures: Vec<F>) -> Vec<F::Output> {
    let mut pinned: Vec<std::pin::Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    let mut outputs: Vec<Option<F::Output>> = pinned.iter().map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (future, output) in pinned.iter_mut().zip(outputs.iter_mut()) {
            if output.is_none() {
                match future.as_mut().poll(cx) {
                    std::task::Poll::Ready(value) => *output = Some(value),
                    std::task::Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            std::task::Poll::Pending
        } else {
            std::task::Poll::Ready(())
        }
    })
    .await;
    outputs.into_iter().map(Option::unwrap).collect()
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

#[tokio::test]
async fn signed_urls_are_cached_per_user_and_paths_validated() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let app = TestApp::start(Some(&redis.url()), &[]).await;
    let path = format!("{}/2026/10/{}.webp", Uuid::new_v4(), Uuid::new_v4());
    let first = app.get(&format!("/v1/media/signed-url?path={path}")).await;
    assert_eq!(
        first.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&first.bytes)
    );
    assert_eq!(first.header("x-cache"), Some("MISS"));
    let second = app.get(&format!("/v1/media/signed-url?path={path}")).await;
    assert_eq!(second.header("x-cache"), Some("HIT"));
    assert_eq!(second.json()["signed_url"], first.json()["signed_url"]);
    assert!(second.json().get("expires_at_ms").is_none());
    assert_eq!(
        app.supabase.count("POST", "/storage/v1/object/sign/").await,
        1
    );

    for bad in [
        "../avatars/x.webp",
        "x",
        "a/2026/10/b.webp",
        &path.replace(".webp", ".png"),
    ] {
        let response = app.get(&format!("/v1/media/signed-url?path={bad}")).await;
        assert_eq!(response.error_code(), "VALIDATION", "{bad}");
    }
}

// ---------------------------------------------------------------------------
// Cached reads
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reads_are_cached_per_user_with_stale_on_error() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let app = TestApp::start(Some(&redis.url()), &[("CACHE_PROJECTS_TTL_SECS", "1")]).await;
    let project = Uuid::new_v4();
    app.supabase.add_project(project).await;

    let miss = app.get("/v1/projects").await;
    assert_eq!(miss.status, StatusCode::OK);
    assert_eq!(miss.header("x-cache"), Some("MISS"));
    assert_eq!(miss.json()[0]["name"], "Cebu Coastal Road Widening");
    assert_eq!(app.get("/v1/projects").await.header("x-cache"), Some("HIT"));
    let summary = app.get(&format!("/v1/projects/{project}/summary")).await;
    assert_eq!(summary.json()["id"], project.to_string());

    // Per-user keys: another user does not get this user's cached rows.
    let (_, other_token) = app.other_user();
    let request = Request::get("/v1/projects")
        .header("authorization", format!("Bearer {other_token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.send(request).await.header("x-cache"), Some("MISS"));

    // Explicit bypass still refreshes.
    let request = app
        .authed("GET", "/v1/projects")
        .header("cache-control", "no-cache")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.send(request).await.header("x-cache"), Some("BYPASS"));

    // Supabase goes down; after the TTL (and the stale-while-revalidate window) the last good
    // value is served as STALE instead of an error.
    app.supabase.break_rest().await;
    tokio::time::sleep(Duration::from_millis(2_200)).await;
    let stale = app.get("/v1/projects").await;
    assert_eq!(stale.status, StatusCode::OK);
    assert_eq!(stale.header("x-cache"), Some("STALE"));
    assert_eq!(stale.json()[0]["name"], "Cebu Coastal Road Widening");
    assert!(stale.header("age").unwrap().parse::<u64>().unwrap() >= 2);
    let stale_summary = app.get(&format!("/v1/projects/{project}/summary")).await;
    assert_eq!(stale_summary.header("x-cache"), Some("STALE"));

    // Nothing cached + upstream down: 503 with Retry-After.
    let never_seen = app
        .get(&format!("/v1/projects/{}/summary", Uuid::new_v4()))
        .await;
    assert_eq!(never_seen.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(never_seen.error_code(), "UPSTREAM_UNAVAILABLE");
    assert!(never_seen.header("retry-after").is_some());

    // Repeated failures open the circuit breaker (reported by /readyz).
    for _ in 0..5 {
        let _ = app
            .get(&format!("/v1/projects/{}/summary", Uuid::new_v4()))
            .await;
    }
    assert_eq!(
        app.get("/readyz").await.json()["checks"]["supabase_reads_circuit"],
        "open"
    );

    // Entries live in Redis with a bounded lifetime.
    let keys = redis.cli(&["--scan", "--pattern", "c:v1:projects:*"]);
    assert_eq!(keys.lines().count(), 2, "{keys}");
}

/// Regression (review finding): with the default timeouts a hanging PostgREST made every
/// read end in `504` (3 attempts × 4 s > the 10 s request timeout), stale entries were never
/// served and the circuit breaker never opened.
#[tokio::test]
async fn hanging_supabase_reads_serve_stale_before_the_timeout_and_open_the_circuit() {
    let clock = civpms_media::clock::ManualClock::new(now_ms());
    let supabase = common::FakeSupabase::start().await;
    let app = TestApp::with_clock(
        supabase,
        None,
        &[("CACHE_PROJECTS_TTL_SECS", "1")],
        clock.clone(),
    )
    .await;
    let mut uris = vec!["/v1/projects".to_owned()];
    for _ in 0..5 {
        let project = Uuid::new_v4();
        app.supabase.add_project(project).await;
        uris.push(format!("/v1/projects/{project}/summary"));
    }
    for uri in &uris {
        assert_eq!(app.get(uri).await.header("x-cache"), Some("MISS"), "{uri}");
    }

    app.supabase.slow_rest(Duration::from_mins(1)).await;
    clock.advance(Duration::from_secs(3)); // past ttl + swr, well inside stale_max
    let started = std::time::Instant::now();
    let responses = join_all(uris.iter().map(|uri| app.get(uri)).collect()).await;
    let elapsed = started.elapsed();
    for (uri, response) in uris.iter().zip(&responses) {
        assert_eq!(response.status, StatusCode::OK, "{uri}: {response:?}");
        assert_eq!(response.header("x-cache"), Some("STALE"), "{uri}");
    }
    assert!(elapsed < Duration::from_secs(10), "{elapsed:?}");
    assert_eq!(
        app.get("/readyz").await.json()["checks"]["supabase_reads_circuit"],
        "open",
        "timeouts count as failures"
    );

    // Circuit open: stale data at once, no upstream call.
    let before = app.supabase.count("GET", "/rest/v1/").await;
    let started = std::time::Instant::now();
    let fast = app.get("/v1/projects").await;
    assert_eq!(fast.header("x-cache"), Some("STALE"));
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(app.supabase.count("GET", "/rest/v1/").await, before);
}

#[tokio::test]
async fn holidays_are_shared_across_users_and_validated() {
    let app = TestApp::start(None, &[]).await;
    let first = app.get("/v1/holidays?year=2026").await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(first.header("x-cache"), Some("MISS"));
    assert_eq!(first.json()[0]["name"], "Christmas Day");
    let (_, other_token) = app.other_user();
    let request = Request::get("/v1/holidays?year=2026")
        .header("authorization", format!("Bearer {other_token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.send(request).await.header("x-cache"),
        Some("HIT"),
        "shared entry"
    );
    assert_eq!(app.get("/v1/holidays").await.error_code(), "VALIDATION");
    assert_eq!(
        app.get("/v1/holidays?year=1999").await.error_code(),
        "VALIDATION"
    );
    assert_eq!(
        app.get("/v1/projects/not-a-uuid/summary")
            .await
            .error_code(),
        "VALIDATION"
    );
}

#[tokio::test]
async fn rate_limits_return_429_with_retry_after() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let app = TestApp::start(Some(&redis.url()), &[("RATE_LIMIT_READS_PER_MIN", "3")]).await;
    for _ in 0..3 {
        assert_eq!(app.get("/v1/projects").await.status, StatusCode::OK);
    }
    let limited = app.get("/v1/projects").await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.error_code(), "RATE_LIMITED");
    let retry_after: u64 = limited.header("retry-after").unwrap().parse().unwrap();
    assert!((1..=60).contains(&retry_after));
    // Counters live in Redis, so every instance shares them.
    assert!(
        !redis
            .cli(&["--scan", "--pattern", "rl:v1:read:*"])
            .is_empty()
    );
    // Another user has their own budget.
    let (_, other_token) = app.other_user();
    let request = Request::get("/v1/projects")
        .header("authorization", format!("Bearer {other_token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.send(request).await.status, StatusCode::OK);
}
