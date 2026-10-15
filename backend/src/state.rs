//! Shared application state (cheap to clone: one `Arc`).

use std::ops::Deref;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::auth::Verifier;
use crate::auth::jwks::JwksCache;
use crate::cache::Cache;
use crate::circuit::CircuitBreaker;
use crate::clock::{self, SharedClock};
use crate::config::Config;
use crate::idempotency::IdempotencyStore;
use crate::keepalive::ActivityTracker;
use crate::media::MediaProcessor;
use crate::ratelimit::RateLimiter;
use crate::redis_client::RedisHandle;
use crate::supabase::Supabase;

/// Errors that prevent the service from starting.
#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    #[error(transparent)]
    Config(#[from] crate::config::ConfigError),
    #[error("could not build the HTTP client: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid REDIS_URL: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("could not bind the listening socket: {0}")]
    Bind(std::io::Error),
    #[error("server error: {0}")]
    Serve(std::io::Error),
}

#[derive(Debug)]
pub struct Inner {
    pub config: Config,
    pub clock: SharedClock,
    pub http: reqwest::Client,
    pub redis: Arc<RedisHandle>,
    pub cache: Arc<Cache>,
    pub limiter: RateLimiter,
    pub idempotency: Arc<IdempotencyStore>,
    pub supabase: Supabase,
    pub jwks: Arc<JwksCache>,
    pub verifier: Verifier,
    pub media: MediaProcessor,
    pub activity: Arc<ActivityTracker>,
    pub started_at: Instant,
}

#[derive(Debug, Clone)]
pub struct AppState(Arc<Inner>);

impl Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    /// Builds every component. Does no network I/O (Redis connects lazily, the JWKS and ffmpeg
    /// capabilities are loaded by [`AppState::warm_up`]).
    pub fn new(config: Config) -> Result<Self, StartupError> {
        Self::with_clock(config, clock::system())
    }

    pub fn with_clock(config: Config, clock: SharedClock) -> Result<Self, StartupError> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("civpms-media/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(3))
            .pool_idle_timeout(Duration::from_secs(60))
            // Never follow redirects: they could carry the user's token to another host.
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let redis = Arc::new(match &config.redis_url {
            Some(url) => RedisHandle::connect_lazy(url, Duration::from_millis(300), clock.clone())?,
            None => RedisHandle::disabled(clock.clone()),
        });
        let cache = Arc::new(Cache::new(Arc::clone(&redis), config.cache.memory_capacity, clock.clone()));
        let limiter = RateLimiter::new(Arc::clone(&redis), config.rate_limits, clock.clone());
        let idempotency = Arc::new(IdempotencyStore::new(Arc::clone(&redis), clock.clone()));
        let breaker = CircuitBreaker::new("supabase-read", 5, Duration::from_secs(15), clock.clone());
        let supabase = Supabase::new(&config, http.clone(), breaker);
        let jwks = Arc::new(JwksCache::new(
            format!("{}/auth/v1/.well-known/jwks.json", config.supabase_url),
            http.clone(),
            Arc::clone(&redis),
            clock.clone(),
        ));
        let verifier = Verifier::new(config.jwt_issuer(), Arc::clone(&jwks));
        let media = MediaProcessor::new(&config);
        let activity = Arc::new(ActivityTracker::new(clock.clone()));
        Ok(Self(Arc::new(Inner {
            config,
            clock,
            http,
            redis,
            cache,
            limiter,
            idempotency,
            supabase,
            jwks,
            verifier,
            media,
            activity,
            started_at: Instant::now(),
        })))
    }

    /// Loads ffmpeg capabilities (+ self-test) and the JWKS. Failures are logged and reported
    /// by `/readyz`; requests retry the JWKS on demand.
    pub async fn warm_up(&self) {
        let (_, jwks) = tokio::join!(self.media.initialize(), self.jwks.refresh(false));
        if let Err(e) = jwks {
            tracing::warn!(error = %e, "JWKS not loaded at startup; will retry on first request");
        }
    }
}
