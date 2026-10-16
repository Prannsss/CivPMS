//! Service configuration, read once at startup from environment variables (12-factor).
//!
//! Every problem is collected and reported together so a misconfigured deploy fails
//! fast with one readable message instead of one error per restart.

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::Url;

/// Log output format (`LOG_FORMAT`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// One JSON object per line (default; what Render's log viewer and drains expect).
    Json,
    /// Human-readable, for local development.
    Pretty,
}

/// Keep-alive self-ping settings (see `keepalive.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepaliveConfig {
    pub enabled: bool,
    /// Absolute URL that is fetched when the service has been idle (normally the public `/healthz`).
    pub url: Option<String>,
    /// Ping once the service has had no inbound traffic for this long.
    pub idle: Duration,
    /// Upper bound between two idle checks.
    pub check_interval: Duration,
}

/// Read-cache policy knobs (see `cache/mod.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheConfig {
    /// Freshness of per-user project rows.
    pub projects_ttl: Duration,
    /// Freshness of the shared holiday list.
    pub holidays_ttl: Duration,
    /// How long past its TTL an entry may still be served when the upstream is down.
    pub stale_max: Duration,
    /// Capacity of the in-memory fallback cache (entries).
    pub memory_capacity: usize,
}

/// Per-user request budgets (per minute).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitConfig {
    pub uploads_per_minute: u32,
    pub reads_per_minute: u32,
}

/// Validated configuration.
#[derive(Clone)]
pub struct Config {
    pub port: u16,
    /// Supabase project URL without a trailing slash, e.g. `https://<ref>.supabase.co`.
    pub supabase_url: String,
    /// Publishable (formerly "anon") API key. Safe for browsers, but still not logged in full.
    pub supabase_publishable_key: String,
    /// Optional Redis URL. Without it the service runs with in-memory fallbacks only.
    pub redis_url: Option<String>,
    /// Exact origins allowed by CORS.
    pub app_origins: Vec<String>,
    pub max_upload_bytes: u64,
    pub max_image_pixels: u64,
    /// Estimated decoder memory an image may need (see `media::sniff::HeaderInfo`).
    pub max_decode_bytes: u64,
    pub ffmpeg_path: PathBuf,
    pub ffprobe_path: PathBuf,
    pub ffmpeg_concurrency: usize,
    pub ffmpeg_timeout: Duration,
    /// How long an upload may wait for a free ffmpeg slot before getting `503 BUSY`.
    pub ffmpeg_queue_timeout: Duration,
    pub avatar_bucket: String,
    pub media_bucket: String,
    pub signed_url_ttl: Duration,
    pub upload_request_timeout: Duration,
    pub read_request_timeout: Duration,
    /// Timeout of one upstream (Supabase) attempt for reads.
    pub upstream_read_timeout: Duration,
    /// Overall deadline of one upstream read, retries included: `READ_REQUEST_TIMEOUT_SECS`
    /// minus [`READ_DEADLINE_MARGIN`], so a failed read still leaves time to serve stale data
    /// (and to count the failure) before the request itself times out.
    pub upstream_read_budget: Duration,
    /// Timeout of one upstream (Supabase Storage) upload.
    pub upstream_write_timeout: Duration,
    pub shutdown_grace: Duration,
    pub keepalive: KeepaliveConfig,
    pub cache: CacheConfig,
    pub rate_limits: RateLimitConfig,
    pub log_format: LogFormat,
    /// `RENDER_EXTERNAL_URL`, set by Render on every web service.
    pub render_external_url: Option<String>,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("port", &self.port)
            .field("supabase_url", &self.supabase_url)
            .field(
                "supabase_publishable_key",
                &redact_key(&self.supabase_publishable_key),
            )
            .field("redis_url", &self.redis_url.as_deref().map(redact_url))
            .field("app_origins", &self.app_origins)
            .field("max_upload_bytes", &self.max_upload_bytes)
            .field("max_image_pixels", &self.max_image_pixels)
            .field("max_decode_bytes", &self.max_decode_bytes)
            .field("ffmpeg_path", &self.ffmpeg_path)
            .field("ffprobe_path", &self.ffprobe_path)
            .field("ffmpeg_concurrency", &self.ffmpeg_concurrency)
            .field("ffmpeg_timeout", &self.ffmpeg_timeout)
            .field("avatar_bucket", &self.avatar_bucket)
            .field("media_bucket", &self.media_bucket)
            .field("keepalive", &self.keepalive)
            .field("cache", &self.cache)
            .field("rate_limits", &self.rate_limits)
            .finish_non_exhaustive()
    }
}

/// All configuration problems found, reported together.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid configuration:\n  - {}", .problems.join("\n  - "))]
pub struct ConfigError {
    pub problems: Vec<String>,
}

const MIB: u64 = 1024 * 1024;

/// Time kept free at the end of a read request for the stale fallback and the response.
pub const READ_DEADLINE_MARGIN: Duration = Duration::from_secs(2);

impl Config {
    /// Reads the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Builds the configuration from any key/value source (tests pass a map).
    pub fn from_lookup<F>(lookup: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let mut p = Parser {
            lookup: &lookup,
            problems: Vec::new(),
        };

        let port = p.number::<u16>("PORT", 8080, 1, u16::MAX);
        let supabase_url = p
            .required("SUPABASE_URL")
            .and_then(|v| p.base_url("SUPABASE_URL", &v));
        let supabase_publishable_key = p.required("SUPABASE_PUBLISHABLE_KEY");
        if supabase_publishable_key
            .as_deref()
            .is_some_and(is_privileged_key)
        {
            p.problem(
                "SUPABASE_PUBLISHABLE_KEY is a secret/service-role key; this service must only get the publishable (or legacy anon) key",
            );
        }
        let redis_url = p.optional("REDIS_URL").and_then(|v| p.redis_url(&v));
        let app_origins = p
            .required("APP_ORIGINS")
            .map(|v| p.origins(&v))
            .unwrap_or_default();

        let max_upload_mb = p.number::<u64>("MAX_UPLOAD_MB", 15, 1, 100);
        let max_image_pixels =
            p.number::<u64>("MAX_IMAGE_PIXELS", 50_000_000, 1_000_000, 200_000_000);
        // 200 MB keeps one ffmpeg run under ~280 MB RSS (fits Render's 512 MB free plan).
        let max_decode_mb = p.number::<u64>("MAX_DECODE_MB", 200, 32, 4096);
        let ffmpeg_path =
            PathBuf::from(p.optional("FFMPEG_PATH").unwrap_or_else(|| "ffmpeg".into()));
        let ffprobe_path = PathBuf::from(
            p.optional("FFPROBE_PATH")
                .unwrap_or_else(|| "ffprobe".into()),
        );
        let cores = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
        let ffmpeg_concurrency = p.number::<usize>("FFMPEG_CONCURRENCY", cores.max(1), 1, 64);
        let ffmpeg_timeout = p.secs("FFMPEG_TIMEOUT_SECS", 30, 1, 300);
        let ffmpeg_queue_timeout = p.secs("FFMPEG_QUEUE_TIMEOUT_SECS", 20, 1, 120);

        let avatar_bucket = p.bucket("AVATAR_BUCKET", "avatars");
        let media_bucket = p.bucket("MEDIA_BUCKET", "project-media");
        let signed_url_ttl = p.secs("SIGNED_URL_TTL_SECS", 600, 60, 3600);

        let upload_request_timeout = p.secs("UPLOAD_REQUEST_TIMEOUT_SECS", 60, 5, 600);
        let read_request_timeout = p.secs("READ_REQUEST_TIMEOUT_SECS", 10, 1, 120);
        let upstream_read_timeout = p.secs("UPSTREAM_READ_TIMEOUT_SECS", 4, 1, 60);
        let upstream_write_timeout = p.secs("UPSTREAM_WRITE_TIMEOUT_SECS", 20, 1, 300);
        if read_request_timeout < upstream_read_timeout + READ_DEADLINE_MARGIN {
            p.problem(format!(
                "READ_REQUEST_TIMEOUT_SECS ({}) must be at least UPSTREAM_READ_TIMEOUT_SECS ({}) + {}, so stale data can be served before a read request times out",
                read_request_timeout.as_secs(),
                upstream_read_timeout.as_secs(),
                READ_DEADLINE_MARGIN.as_secs()
            ));
        }
        let upstream_read_budget = read_request_timeout.saturating_sub(READ_DEADLINE_MARGIN);
        let shutdown_grace = p.secs("SHUTDOWN_GRACE_SECS", 25, 1, 300);

        let render_external_url = p
            .optional("RENDER_EXTERNAL_URL")
            .and_then(|v| p.base_url("RENDER_EXTERNAL_URL", &v));
        let keepalive_url = p
            .optional("KEEPALIVE_URL")
            .and_then(|v| p.absolute_url("KEEPALIVE_URL", &v))
            .or_else(|| {
                render_external_url
                    .as_ref()
                    .map(|base| format!("{base}/healthz"))
            });
        // Opt-in: a free Render service that never sleeps burns ~744 of the workspace's 750
        // free instance-hours per month (see README → Keep-alive).
        let keepalive_enabled = p.boolean("KEEPALIVE_ENABLED", false);
        if keepalive_enabled && keepalive_url.is_none() {
            p.problem("KEEPALIVE_ENABLED=true needs KEEPALIVE_URL or RENDER_EXTERNAL_URL");
        }
        let keepalive = KeepaliveConfig {
            enabled: keepalive_enabled,
            url: keepalive_url,
            idle: p.secs("KEEPALIVE_IDLE_SECS", 840, 30, 86_400),
            check_interval: p.secs("KEEPALIVE_CHECK_SECS", 60, 5, 600),
        };

        let cache = CacheConfig {
            projects_ttl: p.secs("CACHE_PROJECTS_TTL_SECS", 30, 1, 3600),
            holidays_ttl: p.secs("CACHE_HOLIDAYS_TTL_SECS", 86_400, 60, 604_800),
            stale_max: p.secs("CACHE_STALE_MAX_SECS", 600, 0, 86_400),
            memory_capacity: p.number::<usize>("CACHE_MEMORY_ENTRIES", 10_000, 100, 1_000_000),
        };
        let rate_limits = RateLimitConfig {
            uploads_per_minute: p.number::<u32>("RATE_LIMIT_UPLOADS_PER_MIN", 30, 1, 10_000),
            reads_per_minute: p.number::<u32>("RATE_LIMIT_READS_PER_MIN", 120, 1, 100_000),
        };
        let log_format = match p.optional("LOG_FORMAT").as_deref() {
            None | Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(other) => {
                p.problem(format!("LOG_FORMAT must be json or pretty (got {other:?})"));
                LogFormat::Json
            }
        };

        if !p.problems.is_empty() {
            return Err(ConfigError {
                problems: p.problems,
            });
        }
        // The `unwrap_or_default`s below are unreachable: a missing required value adds a problem.
        Ok(Config {
            port,
            supabase_url: supabase_url.unwrap_or_default(),
            supabase_publishable_key: supabase_publishable_key.unwrap_or_default(),
            redis_url,
            app_origins,
            max_upload_bytes: max_upload_mb * MIB,
            max_image_pixels,
            max_decode_bytes: max_decode_mb * MIB,
            ffmpeg_path,
            ffprobe_path,
            ffmpeg_concurrency,
            ffmpeg_timeout,
            ffmpeg_queue_timeout,
            avatar_bucket,
            media_bucket,
            signed_url_ttl,
            upload_request_timeout,
            read_request_timeout,
            upstream_read_timeout,
            upstream_read_budget,
            upstream_write_timeout,
            shutdown_grace,
            keepalive,
            cache,
            rate_limits,
            log_format,
            render_external_url,
        })
    }

    /// The JWT issuer Supabase Auth writes into access tokens.
    pub fn jwt_issuer(&self) -> String {
        format!("{}/auth/v1", self.supabase_url)
    }

    /// One-line, secret-free summary for the startup banner.
    pub fn summary(&self) -> String {
        format!(
            "port={} supabase={} redis={} origins={} max_upload={}MiB max_pixels={} max_decode={}MiB ffmpeg_concurrency={} ffmpeg_timeout={}s buckets=({}, {}) keepalive={} idle={}s",
            self.port,
            self.supabase_url,
            self.redis_url
                .as_deref()
                .map_or_else(|| "off".to_owned(), redact_url),
            self.app_origins.join(","),
            self.max_upload_bytes / MIB,
            self.max_image_pixels,
            self.max_decode_bytes / MIB,
            self.ffmpeg_concurrency,
            self.ffmpeg_timeout.as_secs(),
            self.avatar_bucket,
            self.media_bucket,
            if self.keepalive.enabled {
                self.keepalive.url.as_deref().unwrap_or("?")
            } else {
                "off"
            },
            self.keepalive.idle.as_secs(),
        )
    }
}

/// True for keys that bypass RLS: new-style `sb_secret_…` keys and legacy JWT keys whose
/// `role` claim is `service_role`. The signature is irrelevant here: the claim alone tells
/// what the key was minted for.
fn is_privileged_key(key: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct LegacyClaims {
        role: Option<String>,
    }
    if key.starts_with("sb_secret_") {
        return true;
    }
    key.starts_with("eyJ")
        && jsonwebtoken::dangerous::insecure_decode_claims::<LegacyClaims>(key)
            .is_ok_and(|claims| claims.role.as_deref() == Some("service_role"))
}

/// Shows only a short prefix of an API key.
pub fn redact_key(key: &str) -> String {
    let prefix: String = key.chars().take(16).collect();
    format!("{prefix}…")
}

/// Removes userinfo (passwords) from a URL for logging.
pub fn redact_url(raw: &str) -> String {
    match Url::parse(raw) {
        Ok(mut url) => {
            if !url.username().is_empty() || url.password().is_some() {
                let _ = url.set_username("");
                let _ = url.set_password(None);
                let host = url.host_str().unwrap_or_default().to_owned();
                format!(
                    "{}://***@{host}{}",
                    url.scheme(),
                    url.port().map(|p| format!(":{p}")).unwrap_or_default()
                )
            } else {
                url.to_string()
            }
        }
        Err(_) => "<invalid url>".to_owned(),
    }
}

struct Parser<'a, F: Fn(&str) -> Option<String>> {
    lookup: &'a F,
    problems: Vec<String>,
}

impl<F: Fn(&str) -> Option<String>> Parser<'_, F> {
    fn problem(&mut self, message: impl Into<String>) {
        self.problems.push(message.into());
    }

    fn optional(&self, key: &str) -> Option<String> {
        (self.lookup)(key)
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    }

    fn required(&mut self, key: &str) -> Option<String> {
        let value = self.optional(key);
        if value.is_none() {
            self.problem(format!("{key} is required"));
        }
        value
    }

    fn number<T>(&mut self, key: &str, default: T, min: T, max: T) -> T
    where
        T: std::str::FromStr + PartialOrd + Copy + fmt::Display,
    {
        let Some(raw) = self.optional(key) else {
            return default;
        };
        let cleaned = raw.replace('_', "");
        match cleaned.parse::<T>() {
            Ok(v) if v >= min && v <= max => v,
            Ok(_) => {
                self.problem(format!("{key} must be between {min} and {max} (got {raw})"));
                default
            }
            Err(_) => {
                self.problem(format!("{key} must be a whole number (got {raw:?})"));
                default
            }
        }
    }

    fn secs(&mut self, key: &str, default: u64, min: u64, max: u64) -> Duration {
        Duration::from_secs(self.number(key, default, min, max))
    }

    fn boolean(&mut self, key: &str, default: bool) -> bool {
        match self
            .optional(key)
            .map(|v| v.to_ascii_lowercase())
            .as_deref()
        {
            None => default,
            Some("1" | "true" | "yes" | "on") => true,
            Some("0" | "false" | "no" | "off") => false,
            Some(other) => {
                self.problem(format!("{key} must be true or false (got {other:?})"));
                default
            }
        }
    }

    /// An `https://host[:port]` base URL (plain http only for loopback, used by tests).
    fn base_url(&mut self, key: &str, raw: &str) -> Option<String> {
        let url = self.absolute_url(key, raw)?;
        let parsed = Url::parse(&url).ok()?;
        if parsed.query().is_some() || parsed.fragment().is_some() {
            self.problem(format!("{key} must not contain a query or fragment"));
            return None;
        }
        Some(url.trim_end_matches('/').to_owned())
    }

    fn absolute_url(&mut self, key: &str, raw: &str) -> Option<String> {
        let Ok(url) = Url::parse(raw) else {
            self.problem(format!("{key} must be an absolute URL (got {raw:?})"));
            return None;
        };
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        match url.scheme() {
            "https" => {}
            "http" if loopback => {}
            _ => {
                self.problem(format!("{key} must use https (got {raw:?})"));
                return None;
            }
        }
        if url.host_str().is_none() {
            self.problem(format!("{key} has no host"));
            return None;
        }
        Some(raw.to_owned())
    }

    fn redis_url(&mut self, raw: &str) -> Option<String> {
        match Url::parse(raw) {
            Ok(url) if url.scheme() == "redis" && url.host_str().is_some() => Some(raw.to_owned()),
            Ok(url) if url.scheme() == "rediss" => {
                self.problem(
                    "REDIS_URL uses TLS (rediss://), which this build does not support; use the internal redis:// URL of the Render Key Value instance",
                );
                None
            }
            _ => {
                self.problem("REDIS_URL must look like redis://[user:password@]host:port");
                None
            }
        }
    }

    fn origins(&mut self, raw: &str) -> Vec<String> {
        let mut out = Vec::new();
        for item in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if item == "*" || item.contains('*') {
                self.problem("APP_ORIGINS must list exact origins; wildcards are not allowed");
                continue;
            }
            match Url::parse(item) {
                Ok(url)
                    if matches!(url.scheme(), "http" | "https")
                        && url.host_str().is_some()
                        && url.path() == "/"
                        && url.query().is_none()
                        && !item.ends_with('/') =>
                {
                    out.push(url.origin().ascii_serialization());
                }
                _ => self.problem(format!(
                    "APP_ORIGINS entry {item:?} is not an origin like https://app.example.com (no path, no trailing slash)"
                )),
            }
        }
        if out.is_empty() && !self.problems.iter().any(|p| p.starts_with("APP_ORIGINS")) {
            self.problem("APP_ORIGINS must contain at least one origin");
        }
        out
    }

    fn bucket(&mut self, key: &str, default: &str) -> String {
        let value = self.optional(key).unwrap_or_else(|| default.to_owned());
        let valid = (3..=63).contains(&value.len())
            && value
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
            && value.as_bytes()[0].is_ascii_alphanumeric();
        if !valid {
            self.problem(format!(
                "{key} must be a bucket id like project-media (got {value:?})"
            ));
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn base() -> HashMap<&'static str, &'static str> {
        HashMap::from([
            ("SUPABASE_URL", "https://abc.supabase.co/"),
            ("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_123456789"),
            (
                "APP_ORIGINS",
                "https://civpms.vercel.app, http://localhost:3000",
            ),
        ])
    }

    fn parse(map: &HashMap<&str, &str>) -> Result<Config, ConfigError> {
        Config::from_lookup(|k| map.get(k).map(|v| (*v).to_owned()))
    }

    #[test]
    fn defaults_apply() {
        let cfg = parse(&base()).unwrap();
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.supabase_url, "https://abc.supabase.co");
        assert_eq!(cfg.jwt_issuer(), "https://abc.supabase.co/auth/v1");
        assert_eq!(
            cfg.app_origins,
            vec!["https://civpms.vercel.app", "http://localhost:3000"]
        );
        assert_eq!(cfg.max_upload_bytes, 15 * MIB);
        assert_eq!(cfg.max_image_pixels, 50_000_000);
        assert_eq!(cfg.max_decode_bytes, 200 * MIB);
        assert_eq!(cfg.avatar_bucket, "avatars");
        assert_eq!(cfg.media_bucket, "project-media");
        assert_eq!(cfg.redis_url, None);
        assert!(!cfg.keepalive.enabled, "keep-alive is opt-in");
        assert_eq!(cfg.keepalive.idle, Duration::from_mins(14));
        assert!(cfg.ffmpeg_concurrency >= 1);
        assert_eq!(
            cfg.rate_limits,
            RateLimitConfig {
                uploads_per_minute: 30,
                reads_per_minute: 120
            }
        );
    }

    #[test]
    fn keepalive_stays_off_on_render_unless_opted_in() {
        let mut env = base();
        env.insert("RENDER_EXTERNAL_URL", "https://civpms-media.onrender.com");
        env.insert("PORT", "10000");
        env.insert("REDIS_URL", "redis://red-abc:6379");
        let cfg = parse(&env).unwrap();
        assert!(!cfg.keepalive.enabled, "default is off even on Render");
        assert_eq!(
            cfg.keepalive.url.as_deref(),
            Some("https://civpms-media.onrender.com/healthz")
        );
        assert_eq!(cfg.port, 10000);
        assert_eq!(cfg.redis_url.as_deref(), Some("redis://red-abc:6379"));

        env.insert("KEEPALIVE_ENABLED", "true");
        let cfg = parse(&env).unwrap();
        assert!(cfg.keepalive.enabled);
        assert_eq!(cfg.keepalive.idle, Duration::from_mins(14));

        env.insert("KEEPALIVE_URL", "https://media.example.com/healthz");
        assert_eq!(
            parse(&env).unwrap().keepalive.url.as_deref(),
            Some("https://media.example.com/healthz")
        );

        env.insert("KEEPALIVE_ENABLED", "false");
        assert!(!parse(&env).unwrap().keepalive.enabled);
    }

    #[test]
    fn reports_every_problem_at_once() {
        let env = HashMap::from([
            ("PORT", "eighty"),
            ("APP_ORIGINS", "*"),
            ("MAX_UPLOAD_MB", "0"),
            ("REDIS_URL", "rediss://secure:6380"),
            ("KEEPALIVE_ENABLED", "true"),
            ("AVATAR_BUCKET", "../etc"),
        ]);
        let err = parse(&env).unwrap_err();
        let text = err.to_string();
        for needle in [
            "PORT must be a whole number",
            "SUPABASE_URL is required",
            "SUPABASE_PUBLISHABLE_KEY is required",
            "wildcards are not allowed",
            "MAX_UPLOAD_MB must be between 1 and 100",
            "rediss://",
            "KEEPALIVE_ENABLED=true needs",
            "AVATAR_BUCKET must be a bucket id",
        ] {
            assert!(text.contains(needle), "missing {needle:?} in:\n{text}");
        }
    }

    #[test]
    fn rejects_insecure_or_malformed_urls_and_origins() {
        let mut env = base();
        env.insert("SUPABASE_URL", "http://abc.supabase.co");
        env.insert("APP_ORIGINS", "https://civpms.vercel.app/path");
        let text = parse(&env).unwrap_err().to_string();
        assert!(text.contains("SUPABASE_URL must use https"));
        assert!(text.contains("is not an origin"));

        // Loopback http is allowed (local Supabase / tests).
        let mut env = base();
        env.insert("SUPABASE_URL", "http://127.0.0.1:54321");
        assert_eq!(parse(&env).unwrap().supabase_url, "http://127.0.0.1:54321");
    }

    #[test]
    fn refuses_secret_keys() {
        let mut env = base();
        env.insert("SUPABASE_PUBLISHABLE_KEY", "sb_secret_abc");
        assert!(
            parse(&env)
                .unwrap_err()
                .to_string()
                .contains("secret/service-role key")
        );

        // Legacy JWT keys: {"alg":"HS256","typ":"JWT"} . {"iss":"supabase","role":"…"} . sig
        let service_role = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.c2ln";
        let anon =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.c2ln";
        env.insert("SUPABASE_PUBLISHABLE_KEY", service_role);
        assert!(parse(&env).is_err(), "legacy service_role key refused");
        env.insert("SUPABASE_PUBLISHABLE_KEY", anon);
        assert!(parse(&env).is_ok(), "legacy anon key accepted");
    }

    #[test]
    fn debug_and_summary_redact_credentials() {
        let mut env = base();
        env.insert("REDIS_URL", "redis://default:hunter2@red-abc:6379");
        let cfg = parse(&env).unwrap();
        let debug = format!("{cfg:?}");
        let summary = cfg.summary();
        for text in [&debug, &summary] {
            assert!(!text.contains("hunter2"), "password leaked: {text}");
            assert!(
                !text.contains("sb_publishable_test_123456789"),
                "key leaked: {text}"
            );
        }
        assert!(summary.contains("redis://***@red-abc:6379"));
    }

    #[test]
    fn read_timeouts_leave_room_for_the_stale_fallback() {
        let cfg = parse(&base()).unwrap();
        assert_eq!(cfg.upstream_read_budget, Duration::from_secs(8));
        let mut env = base();
        env.insert("READ_REQUEST_TIMEOUT_SECS", "5");
        env.insert("UPSTREAM_READ_TIMEOUT_SECS", "4");
        let text = parse(&env).unwrap_err().to_string();
        assert!(
            text.contains("READ_REQUEST_TIMEOUT_SECS (5) must be at least"),
            "{text}"
        );
        env.insert("READ_REQUEST_TIMEOUT_SECS", "6");
        assert_eq!(
            parse(&env).unwrap().upstream_read_budget,
            Duration::from_secs(4)
        );
    }

    #[test]
    fn numbers_accept_underscores() {
        let mut env = base();
        env.insert("MAX_IMAGE_PIXELS", "40_000_000");
        assert_eq!(parse(&env).unwrap().max_image_pixels, 40_000_000);
    }
}
