//! Test harness: a fake Supabase (wiremock: JWKS, PostgREST, Storage), a real local
//! `redis-server` on a random port, real images generated with ffmpeg, and helpers to drive
//! the full router (`build_app`) in-process.

#![allow(dead_code, clippy::missing_panics_doc)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::Body;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use civpms_media::config::Config;
use civpms_media::{AppState, build_app};
use http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use p256::pkcs8::EncodePrivateKey;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path, path_regex, query_param};
use wiremock::{Mock, MockServer, Request as MockRequest, Respond, ResponseTemplate};

pub const ORIGIN: &str = "https://app.civpms.test";
pub const KID: &str = "test-signing-key";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

fn secret_key(seed: u8) -> p256::SecretKey {
    p256::SecretKey::from_slice(&[seed; 32]).expect("valid scalar")
}

/// JWKS document for the test signing key (seed 0x42).
pub fn jwks_json() -> Value {
    let point = secret_key(0x42).public_key().to_sec1_bytes();
    json!({"keys": [{
        "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": KID,
        "x": URL_SAFE_NO_PAD.encode(&point[1..33]),
        "y": URL_SAFE_NO_PAD.encode(&point[33..65]),
    }]})
}

fn now_secs() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap()
}

/// Mints a Supabase-style access token. `seed` 0x42 is the published key; any other seed
/// signs with a key the JWKS does not contain.
pub fn mint(issuer: &str, user: Uuid, exp_offset: i64, seed: u8, kid: &str) -> String {
    let der = secret_key(seed).to_pkcs8_der().unwrap();
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.into());
    let claims = json!({
        "iss": issuer, "aud": "authenticated", "role": "authenticated", "sub": user.to_string(),
        "email": "tester@civpms.test", "iat": now_secs(), "exp": now_secs() + exp_offset,
        "is_anonymous": false,
    });
    encode(&header, &claims, &EncodingKey::from_ec_der(der.as_bytes())).unwrap()
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

/// A throwaway `redis-server` (no persistence) killed on drop.
pub struct RedisServer {
    child: Child,
    pub port: u16,
}

impl RedisServer {
    /// Starts one, or returns `None` (with a message) when `redis-server` is not installed.
    pub fn start() -> Option<Self> {
        let port = free_port();
        let child = Command::new("redis-server")
            .args([
                "--port",
                &port.to_string(),
                "--bind",
                "127.0.0.1",
                "--save",
                "",
            ])
            .args(["--appendonly", "no", "--loglevel", "warning"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let Ok(child) = child else {
            eprintln!("SKIPPED (redis part): redis-server is not installed");
            return None;
        };
        let server = Self { child, port };
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if server.ping() {
                return Some(server);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("redis-server did not start on port {port}");
    }

    pub fn url(&self) -> String {
        format!("redis://127.0.0.1:{}", self.port)
    }

    fn ping(&self) -> bool {
        let Ok(mut stream) = TcpStream::connect(("127.0.0.1", self.port)) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
        if stream.write_all(b"PING\r\n").is_err() {
            return false;
        }
        let mut buf = [0u8; 16];
        matches!(stream.read(&mut buf), Ok(n) if buf[..n].starts_with(b"+PONG"))
    }

    /// Runs a raw command through `redis-cli` (inspection in tests).
    pub fn cli(&self, args: &[&str]) -> String {
        let out = Command::new("redis-cli")
            .args(["-p", &self.port.to_string()])
            .args(args)
            .output()
            .expect("redis-cli");
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for RedisServer {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

/// Echoes Storage's batch-sign response for the requested paths.
struct SignResponder {
    bucket: String,
}

impl Respond for SignResponder {
    fn respond(&self, request: &MockRequest) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or_default();
        let entries: Vec<Value> = body["paths"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                let p = p.as_str().unwrap_or_default().to_owned();
                json!({
                    "error": null,
                    "path": p,
                    "signedURL": format!("/object/sign/{}/{p}?token=signed-{}", self.bucket, Uuid::new_v4()),
                })
            })
            .collect();
        ResponseTemplate::new(200).set_body_json(entries)
    }
}

pub struct FakeSupabase {
    pub server: MockServer,
    /// Projects visible through `project_overview` (any caller).
    pub projects: Arc<Mutex<Vec<Uuid>>>,
}

impl FakeSupabase {
    pub async fn start() -> Self {
        let server = MockServer::start().await;
        let fake = Self {
            server,
            projects: Arc::new(Mutex::new(Vec::new())),
        };
        fake.mount_defaults().await;
        fake
    }

    pub fn url(&self) -> String {
        self.server.uri()
    }

    pub fn issuer(&self) -> String {
        format!("{}/auth/v1", self.url())
    }

    pub async fn mount_defaults(&self) {
        Mock::given(method("GET"))
            .and(path("/auth/v1/.well-known/jwks.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(jwks_json()))
            .mount(&self.server)
            .await;
        for bucket in ["avatars", "project-media"] {
            Mock::given(method("POST"))
                .and(path_regex(format!("^/storage/v1/object/{bucket}/.+")))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({"Key": "ok"})))
                .mount(&self.server)
                .await;
            Mock::given(method("POST"))
                .and(path(format!("/storage/v1/object/sign/{bucket}")))
                .respond_with(SignResponder {
                    bucket: bucket.to_owned(),
                })
                .mount(&self.server)
                .await;
            Mock::given(method("DELETE"))
                .and(path(format!("/storage/v1/object/{bucket}")))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
                .mount(&self.server)
                .await;
        }
        Mock::given(method("GET"))
            .and(path("/rest/v1/ph_holidays"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"date": "2026-12-25", "name": "Christmas Day", "type": "regular"}
            ])))
            .mount(&self.server)
            .await;
        Mock::given(method("GET"))
            .and(path("/rest/v1/project_overview"))
            .and(query_param("order", "updated_at.desc"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": "11111111-1111-4111-8111-111111111111", "name": "Cebu Coastal Road Widening"}
            ])))
            .mount(&self.server)
            .await;
    }

    /// Makes `project_overview?id=eq.<id>` return a row for `id`.
    pub async fn add_project(&self, id: Uuid) {
        self.projects.lock().unwrap().push(id);
        Mock::given(method("GET"))
            .and(path("/rest/v1/project_overview"))
            .and(query_param("id", format!("eq.{id}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": id.to_string(), "name": "Test project", "progress_pct": 12.5}
            ])))
            .with_priority(2) // below the outage simulations (priority 1)
            .mount(&self.server)
            .await;
    }

    /// Unknown projects: empty result (RLS hides them).
    pub async fn hide_other_projects(&self) {
        Mock::given(method("GET"))
            .and(path("/rest/v1/project_overview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .with_priority(10)
            .mount(&self.server)
            .await;
    }

    /// Makes the Auth JWKS endpoint hang for `delay` before answering.
    pub async fn slow_jwks(&self, delay: Duration) {
        Mock::given(method("GET"))
            .and(path("/auth/v1/.well-known/jwks.json"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(jwks_json())
                    .set_delay(delay),
            )
            .with_priority(1)
            .mount(&self.server)
            .await;
    }

    /// Makes every PostgREST read hang for `delay` before answering (a slow Supabase).
    pub async fn slow_rest(&self, delay: Duration) {
        Mock::given(method("GET"))
            .and(path_regex("^/rest/v1/.*"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([]))
                    .set_delay(delay),
            )
            .with_priority(1)
            .mount(&self.server)
            .await;
    }

    /// Simulates an outage of PostgREST (Storage and Auth keep working).
    pub async fn break_rest(&self) {
        self.server.reset().await;
        Mock::given(method("GET"))
            .and(path_regex("^/rest/v1/.*"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&self.server)
            .await;
    }

    /// Storage uploads received so far: (object path, headers, body).
    pub async fn uploads(&self, bucket: &str) -> Vec<(String, HeaderMap, Vec<u8>)> {
        let prefix = format!("/storage/v1/object/{bucket}/");
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|r| r.method.as_str() == "POST" && r.url.path().starts_with(&prefix))
            .map(|r| {
                let mut headers = HeaderMap::new();
                for (name, value) in &r.headers {
                    headers.insert(name.clone(), value.clone());
                }
                (
                    r.url.path()[prefix.len()..].to_owned(),
                    headers,
                    r.body.clone(),
                )
            })
            .collect()
    }

    pub async fn count(&self, http_method: &str, path_prefix: &str) -> usize {
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.method.as_str() == http_method && r.url.path().starts_with(path_prefix))
            .count()
    }
}

// ---------------------------------------------------------------------------
// The app under test
// ---------------------------------------------------------------------------

pub struct TestApp {
    pub router: Router,
    pub state: AppState,
    pub supabase: FakeSupabase,
    pub user: Uuid,
    pub token: String,
}

/// Base environment; `extra` overrides or adds variables.
pub fn env(
    supabase_url: &str,
    redis_url: Option<&str>,
    extra: &[(&str, &str)],
) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = [
        ("SUPABASE_URL", supabase_url),
        (
            "SUPABASE_PUBLISHABLE_KEY",
            "sb_publishable_test_key_0123456789",
        ),
        ("APP_ORIGINS", ORIGIN),
        ("FFMPEG_CONCURRENCY", "2"),
        ("LOG_FORMAT", "pretty"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    if let Some(url) = redis_url {
        env.insert("REDIS_URL".into(), url.into());
    }
    for (k, v) in extra {
        env.insert((*k).to_owned(), (*v).to_owned());
    }
    env
}

impl TestApp {
    pub async fn start(redis_url: Option<&str>, extra: &[(&str, &str)]) -> Self {
        let supabase = FakeSupabase::start().await;
        Self::with_supabase(supabase, redis_url, extra).await
    }

    pub async fn with_supabase(
        supabase: FakeSupabase,
        redis_url: Option<&str>,
        extra: &[(&str, &str)],
    ) -> Self {
        Self::with_clock(supabase, redis_url, extra, civpms_media::clock::system()).await
    }

    /// Like [`TestApp::with_supabase`], with an injectable clock (cache ages, JWKS age, rate
    /// windows, breaker cool-downs). Token `exp` is still checked against the real time.
    pub async fn with_clock(
        supabase: FakeSupabase,
        redis_url: Option<&str>,
        extra: &[(&str, &str)],
        clock: civpms_media::clock::SharedClock,
    ) -> Self {
        let vars = env(&supabase.url(), redis_url, extra);
        let config = Config::from_lookup(|k| vars.get(k).cloned()).expect("valid test config");
        let state = AppState::with_clock(config, clock).expect("state");
        state.warm_up().await;
        let user = Uuid::new_v4();
        let token = mint(&supabase.issuer(), user, 3600, 0x42, KID);
        Self {
            router: build_app(state.clone()),
            state,
            supabase,
            user,
            token,
        }
    }

    /// Another signed-in user of the same deployment.
    pub fn other_user(&self) -> (Uuid, String) {
        let user = Uuid::new_v4();
        (user, mint(&self.supabase.issuer(), user, 3600, 0x42, KID))
    }

    pub async fn send(&self, request: Request<Body>) -> TestResponse {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible");
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes()
            .to_vec();
        TestResponse {
            status,
            headers,
            bytes,
        }
    }

    pub async fn get(&self, uri: &str) -> TestResponse {
        self.send(self.authed("GET", uri).body(Body::empty()).unwrap())
            .await
    }

    pub fn authed(&self, method: &str, uri: &str) -> http::request::Builder {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", format!("Bearer {}", self.token))
    }

    pub async fn upload(&self, uri: &str, form: &Multipart) -> TestResponse {
        self.upload_as(&self.token, uri, form, &[]).await
    }

    pub async fn upload_as(
        &self,
        token: &str,
        uri: &str,
        form: &Multipart,
        headers: &[(&str, &str)],
    ) -> TestResponse {
        let mut builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", form.content_type());
        for (k, v) in headers {
            builder = builder.header(*k, *v);
        }
        self.send(builder.body(Body::from(form.body())).unwrap())
            .await
    }
}

#[derive(Debug)]
pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub bytes: Vec<u8>,
}

impl TestResponse {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes)
            .unwrap_or_else(|e| panic!("not JSON ({e}): {}", String::from_utf8_lossy(&self.bytes)))
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    pub fn error_code(&self) -> String {
        self.json()["error"]["code"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }
}

// ---------------------------------------------------------------------------
// Multipart bodies
// ---------------------------------------------------------------------------

pub struct Multipart {
    boundary: String,
    parts: Vec<(String, Option<String>, Vec<u8>)>,
}

impl Multipart {
    pub fn new() -> Self {
        Self {
            boundary: format!("civpms-test-{}", Uuid::new_v4().simple()),
            parts: Vec::new(),
        }
    }

    pub fn file(mut self, name: &str, filename: &str, bytes: Vec<u8>) -> Self {
        self.parts.push((name.into(), Some(filename.into()), bytes));
        self
    }

    pub fn text(mut self, name: &str, value: &str) -> Self {
        self.parts
            .push((name.into(), None, value.as_bytes().to_vec()));
        self
    }

    pub fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    pub fn body(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (name, filename, bytes) in &self.parts {
            out.extend_from_slice(format!("--{}\r\n", self.boundary).as_bytes());
            match filename {
                Some(f) => out.extend_from_slice(
                    format!(
                        "Content-Disposition: form-data; name=\"{name}\"; filename=\"{f}\"\r\nContent-Type: image/jpeg\r\n\r\n"
                    )
                    .as_bytes(),
                ),
                None => out.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
                ),
            }
            out.extend_from_slice(bytes);
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(format!("--{}--\r\n", self.boundary).as_bytes());
        out
    }
}

// ---------------------------------------------------------------------------
// Images (generated with the local ffmpeg)
// ---------------------------------------------------------------------------

/// Generates an image with ffmpeg's test pattern. `ext` picks the format (jpg/png/webp/gif).
pub fn image(width: u32, height: u32, ext: &str) -> Vec<u8> {
    image_with(width, height, ext, "")
}

/// Like [`image`], with an explicit output pixel format (e.g. `rgba64be` for a 16-bit PNG).
pub fn image_with(width: u32, height: u32, ext: &str, pix_fmt: &str) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join(format!("img.{ext}"));
    let status = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
        ])
        .arg(format!("testsrc2=size={width}x{height}:rate=1"))
        .args(["-frames:v", "1"])
        .args(if ext == "avif" {
            &["-c:v", "libaom-av1", "-still-picture", "1"][..]
        } else {
            &[]
        })
        .args(if pix_fmt.is_empty() {
            Vec::new()
        } else {
            vec!["-pix_fmt", pix_fmt]
        })
        .arg(&out)
        .status()
        .expect("ffmpeg is installed");
    assert!(status.success(), "ffmpeg could not generate a {ext}");
    std::fs::read(&out).unwrap()
}

/// Rewrites the first JPEG SOF header to claim `width`×`height` (decompression-bomb probe).
pub fn jpeg_with_fake_dimensions(jpeg: &[u8], width: u16, height: u16) -> Vec<u8> {
    let mut out = jpeg.to_vec();
    let mut i = 2;
    while i + 9 < out.len() {
        assert_eq!(out[i], 0xFF, "malformed JPEG in test");
        let marker = out[i + 1];
        let len = usize::from(u16::from_be_bytes([out[i + 2], out[i + 3]]));
        if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
            out[i + 5..i + 7].copy_from_slice(&height.to_be_bytes());
            out[i + 7..i + 9].copy_from_slice(&width.to_be_bytes());
            return out;
        }
        i += 2 + len;
    }
    panic!("no SOF marker");
}

/// A PNG that is valid up to its header and claims `width`×`height`.
pub fn png_header_only(width: u32, height: u32) -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    png.extend_from_slice(&width.to_be_bytes());
    png.extend_from_slice(&height.to_be_bytes());
    png.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
    png.extend_from_slice(&[0u8; 64]);
    png
}

/// `ffprobe` of a stored object: (codec, width, height, all tags found).
pub fn probe(bytes: &[u8]) -> (String, u32, u32, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let file: PathBuf = dir.path().join("probe.webp");
    std::fs::write(&file, bytes).unwrap();
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,width,height:stream_tags:format_tags",
        ])
        .args(["-of", "json"])
        .arg(&file)
        .output()
        .expect("ffprobe is installed");
    let json: Value = serde_json::from_slice(&out.stdout).unwrap();
    let stream = &json["streams"][0];
    let mut tags = Vec::new();
    for source in [&stream["tags"], &json["format"]["tags"]] {
        if let Some(map) = source.as_object() {
            tags.extend(map.keys().cloned());
        }
    }
    (
        stream["codec_name"].as_str().unwrap_or_default().to_owned(),
        u32::try_from(stream["width"].as_u64().unwrap_or_default()).unwrap(),
        u32::try_from(stream["height"].as_u64().unwrap_or_default()).unwrap(),
        tags,
    )
}

pub fn is_object_path(path: &str, prefix: &str) -> bool {
    path.starts_with(prefix) && Path::new(path).extension().is_some_and(|e| e == "webp")
}
