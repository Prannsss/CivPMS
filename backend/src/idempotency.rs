//! Idempotent uploads (spec §13: every queued offline item carries a `client_id`).
//!
//! The first request for `(user, client_id)` reserves the key with a short-lived "pending"
//! marker, does the work and then stores the result for 24 hours. A retry within that time
//! gets the stored result instead of a second upload; a retry while the first attempt is
//! still running waits for it (and takes over if it fails). If the work fails (or the
//! request is cancelled) the reservation is released so the client can try again.
//!
//! Redis (shared by every instance) and the in-memory store (this instance) must never
//! disagree in a way that allows a second upload:
//! * every reservation and result is also written to memory, and memory is consulted
//!   **first**, so a Redis hiccup between two requests can neither hide this instance's
//!   reservation nor its stored result behind an older Redis entry;
//! * a result that could not be written to Redis is retried in the background (until about
//!   a minute has passed), so other instances see it once Redis answers again;
//! * results are written with compare-and-set on the reservation token, so a late commit
//!   never overwrites another request's reservation or result;
//! * the pending marker outlives the upload request timeout ([`pending_ttl_for`]), so a
//!   duplicate cannot take over while the first attempt may still be running.

use std::sync::Arc;
use std::time::Duration;

use redis::Script;
use serde_json::Value;
use uuid::Uuid;

use crate::cache::memory::MemoryStore;
use crate::clock::SharedClock;
use crate::redis_client::{RedisHandle, RedisUnavailable};

/// How long a stored result is replayed.
pub const RESULT_TTL: Duration = Duration::from_hours(24);
/// Shortest time a reservation blocks duplicates if the worker dies without releasing it.
pub const MIN_PENDING_TTL: Duration = Duration::from_mins(2);
/// Margin between the upload request timeout and the pending marker's expiry.
const PENDING_MARGIN: Duration = Duration::from_secs(30);
/// Delays between background retries of a result that could not be written to Redis.
const COMMIT_RETRY_DELAYS: [Duration; 6] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(16),
    Duration::from_secs(32),
];

/// How long a pending marker lives: longer than any request can run (a request that times
/// out is cancelled and releases its reservation), and at least [`MIN_PENDING_TTL`].
pub fn pending_ttl_for(upload_request_timeout: Duration) -> Duration {
    (upload_request_timeout + PENDING_MARGIN).max(MIN_PENDING_TTL)
}

const DONE_PREFIX: &str = "D:";
const PENDING_PREFIX: &str = "P:";

const RELEASE_SCRIPT: &str = r"
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
";

/// Stores the result if the key still holds our reservation token (or nothing, e.g. it
/// expired); never overwrites another request's reservation or result. Returns 1 if stored.
const COMMIT_SCRIPT: &str = r"
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0
";

/// Result of trying to start an idempotent operation.
#[derive(Debug)]
pub enum Begin {
    /// No previous attempt: do the work, then [`Reservation::commit`].
    Started(Reservation),
    /// A previous attempt finished; here is its stored result.
    Replay(Value),
    /// A previous attempt is still running.
    InProgress,
}

#[derive(Debug)]
pub struct IdempotencyStore {
    redis: Arc<RedisHandle>,
    memory: MemoryStore,
    clock: SharedClock,
    pending_ttl: Duration,
    release_script: Script,
    commit_script: Script,
}

/// Validates a client-supplied idempotency key: 8–128 characters of `[A-Za-z0-9_.:-]`.
pub fn valid_client_id(raw: &str) -> bool {
    (8..=128).contains(&raw.len())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

impl IdempotencyStore {
    /// `pending_ttl`: see [`pending_ttl_for`].
    pub fn new(redis: Arc<RedisHandle>, clock: SharedClock, pending_ttl: Duration) -> Self {
        Self {
            redis,
            memory: MemoryStore::new(10_000),
            clock,
            pending_ttl: pending_ttl.max(MIN_PENDING_TTL),
            release_script: Script::new(RELEASE_SCRIPT),
            commit_script: Script::new(COMMIT_SCRIPT),
        }
    }

    fn key(scope: &str, user: Uuid, client_id: &str) -> String {
        format!("idem:v1:{scope}:{user}:{client_id}")
    }

    /// Tries to reserve `(scope, user, client_id)`.
    pub async fn begin(self: &Arc<Self>, scope: &str, user: Uuid, client_id: &str) -> Begin {
        let key = Self::key(scope, user, client_id);
        // This instance's own record wins: Redis may lag behind it (a result whose Redis
        // write failed) or have missed it entirely (a reservation made during an outage).
        if let Some(local) = self.memory_get(&key) {
            return Self::interpret(&local);
        }
        let token = format!("{PENDING_PREFIX}{}", Uuid::new_v4());
        for _ in 0..2 {
            if self.set_nx(&key, &token).await {
                return Begin::Started(Reservation {
                    store: Arc::clone(self),
                    key,
                    token,
                    finished: false,
                });
            }
            // `None`: the key expired between the two calls, so try to reserve it again.
            if let Some(stored) = self.get(&key).await {
                return Self::interpret(&stored);
            }
        }
        Begin::InProgress
    }

    fn memory_get(&self, key: &str) -> Option<String> {
        self.memory
            .get(key, self.clock.now_ms())
            .and_then(|bytes| String::from_utf8(bytes.to_vec()).ok())
    }

    fn interpret(stored: &str) -> Begin {
        if let Some(json) = stored.strip_prefix(DONE_PREFIX) {
            match serde_json::from_str(json) {
                Ok(value) => Begin::Replay(value),
                Err(_) => Begin::InProgress,
            }
        } else {
            Begin::InProgress
        }
    }

    /// Reserves `key` with `token` in Redis (mirrored into memory), or in memory alone while
    /// Redis is unavailable.
    async fn set_nx(&self, key: &str, token: &str) -> bool {
        let ttl_ms = self.pending_ttl.as_millis() as u64;
        let redis_result = self
            .redis
            .run("idem_set_nx", |mut conn| async move {
                redis::cmd("SET")
                    .arg(key)
                    .arg(token)
                    .arg("NX")
                    .arg("PX")
                    .arg(ttl_ms)
                    .query_async::<Option<String>>(&mut conn)
                    .await
            })
            .await;
        let now = self.clock.now_ms();
        match redis_result {
            Ok(Some(_)) => {
                self.memory
                    .set(key, Arc::from(token.as_bytes()), ttl_ms, now);
                true
            }
            Ok(None) => false,
            Err(_) => self
                .memory
                .set_nx(key, Arc::from(token.as_bytes()), ttl_ms, now),
        }
    }

    /// Stores the result in memory, then in Redis (compare-and-set on `token`); a failed
    /// Redis write is retried in the background.
    async fn commit(self: &Arc<Self>, key: String, token: String, stored: String) {
        let ttl_ms = RESULT_TTL.as_millis() as u64;
        self.memory.set(
            &key,
            Arc::from(stored.as_bytes()),
            ttl_ms,
            self.clock.now_ms(),
        );
        match self.commit_in_redis(&key, &token, &stored).await {
            Ok(_) | Err(RedisUnavailable::NotConfigured) => {}
            Err(_) => {
                let store = Arc::clone(self);
                tokio::spawn(async move {
                    for delay in COMMIT_RETRY_DELAYS {
                        tokio::time::sleep(delay).await;
                        match store.commit_in_redis(&key, &token, &stored).await {
                            Ok(_) | Err(RedisUnavailable::NotConfigured) => return,
                            Err(_) => {}
                        }
                    }
                    tracing::warn!(
                        "idempotency result kept in memory only (Redis unavailable); a retry on another instance may upload again"
                    );
                });
            }
        }
    }

    /// `Ok(true)`: stored; `Ok(false)`: the key holds another request's reservation or a
    /// result already (nothing to do).
    async fn commit_in_redis(
        &self,
        key: &str,
        token: &str,
        stored: &str,
    ) -> Result<bool, RedisUnavailable> {
        let ttl_ms = RESULT_TTL.as_millis() as u64;
        let script = &self.commit_script;
        self.redis
            .run("idem_commit", |mut conn| async move {
                script
                    .key(key)
                    .arg(token)
                    .arg(stored)
                    .arg(ttl_ms)
                    .invoke_async::<i64>(&mut conn)
                    .await
            })
            .await
            .map(|stored| stored == 1)
    }

    async fn get(&self, key: &str) -> Option<String> {
        let redis_result = self
            .redis
            .run("idem_get", |mut conn| async move {
                redis::cmd("GET")
                    .arg(key)
                    .query_async::<Option<String>>(&mut conn)
                    .await
            })
            .await;
        match redis_result {
            Ok(Some(value)) => Some(value),
            Ok(None) | Err(_) => self.memory_get(key),
        }
    }

    async fn release(&self, key: &str, token: &str) {
        self.memory.delete_if(key, token.as_bytes());
        let script = &self.release_script;
        let _ = self
            .redis
            .run("idem_release", |mut conn| async move {
                script
                    .key(key)
                    .arg(token)
                    .invoke_async::<i64>(&mut conn)
                    .await
            })
            .await;
    }
}

/// A reserved idempotency key. Dropping it without [`Reservation::commit`] releases it.
#[derive(Debug)]
pub struct Reservation {
    store: Arc<IdempotencyStore>,
    key: String,
    token: String,
    finished: bool,
}

impl Reservation {
    /// Stores the result for replay.
    pub async fn commit(mut self, result: &Value) {
        let stored = format!("{DONE_PREFIX}{result}");
        self.finished = true;
        let key = std::mem::take(&mut self.key);
        let token = std::mem::take(&mut self.token);
        Arc::clone(&self.store).commit(key, token, stored).await;
    }

    /// Releases the key now (the operation failed and may be retried).
    pub async fn release(mut self) {
        self.store.release(&self.key, &self.token).await;
        self.finished = true;
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        // Cancelled mid-way (client disconnected, timeout): release in the background.
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let store = Arc::clone(&self.store);
            let key = std::mem::take(&mut self.key);
            let token = std::mem::take(&mut self.token);
            handle.spawn(async move { store.release(&key, &token).await });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;
    use serde_json::json;

    fn store() -> (Arc<IdempotencyStore>, Arc<ManualClock>) {
        let clock = ManualClock::new(1_000);
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        (
            Arc::new(IdempotencyStore::new(redis, clock.clone(), MIN_PENDING_TTL)),
            clock,
        )
    }

    #[test]
    fn pending_markers_outlive_the_upload_timeout() {
        assert_eq!(pending_ttl_for(Duration::from_mins(1)), MIN_PENDING_TTL);
        assert_eq!(
            pending_ttl_for(Duration::from_mins(10)),
            Duration::from_secs(630)
        );
    }

    #[tokio::test]
    async fn a_reservation_blocks_duplicates_until_the_pending_ttl() {
        let clock = ManualClock::new(1_000);
        let redis = Arc::new(RedisHandle::disabled(clock.clone()));
        let ttl = pending_ttl_for(Duration::from_mins(10));
        let store = Arc::new(IdempotencyStore::new(redis, clock.clone(), ttl));
        let user = Uuid::new_v4();
        let Begin::Started(first) = store.begin("images", user, "client-0004").await else {
            panic!("expected Started");
        };
        clock.advance(Duration::from_secs(590)); // the request may still be running
        assert!(matches!(
            store.begin("images", user, "client-0004").await,
            Begin::InProgress
        ));
        clock.advance(Duration::from_mins(1));
        assert!(matches!(
            store.begin("images", user, "client-0004").await,
            Begin::Started(_)
        ));
        drop(first);
    }

    #[test]
    fn client_id_validation() {
        assert!(valid_client_id("0b6c2c1e-3f4f-4d8e-9b39-2d1f4f4b0a11"));
        assert!(!valid_client_id("short"));
        assert!(!valid_client_id("has space in it"));
        assert!(!valid_client_id(&"x".repeat(129)));
    }

    #[tokio::test]
    async fn replays_committed_results() {
        let (store, _) = store();
        let user = Uuid::new_v4();
        let Begin::Started(reservation) = store.begin("images", user, "client-0001").await else {
            panic!("expected Started");
        };
        assert!(matches!(
            store.begin("images", user, "client-0001").await,
            Begin::InProgress
        ));
        reservation.commit(&json!({"path": "p"})).await;
        match store.begin("images", user, "client-0001").await {
            Begin::Replay(value) => assert_eq!(value, json!({"path": "p"})),
            other => panic!("expected Replay, got {other:?}"),
        }
        // Keys are per user.
        assert!(matches!(
            store.begin("images", Uuid::new_v4(), "client-0001").await,
            Begin::Started(_)
        ));
    }

    #[tokio::test]
    async fn released_and_dropped_reservations_can_be_retried() {
        let (store, _) = store();
        let user = Uuid::new_v4();
        let Begin::Started(r) = store.begin("images", user, "client-0002").await else {
            panic!()
        };
        r.release().await;
        let Begin::Started(r) = store.begin("images", user, "client-0002").await else {
            panic!()
        };
        drop(r);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(matches!(
            store.begin("images", user, "client-0002").await,
            Begin::Started(_)
        ));
    }

    #[tokio::test]
    async fn results_expire() {
        let (store, clock) = store();
        let user = Uuid::new_v4();
        let Begin::Started(r) = store.begin("images", user, "client-0003").await else {
            panic!()
        };
        r.commit(&json!(1)).await;
        clock.advance(RESULT_TTL + Duration::from_secs(1));
        assert!(matches!(
            store.begin("images", user, "client-0003").await,
            Begin::Started(_)
        ));
    }
}
