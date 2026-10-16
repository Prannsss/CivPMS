//! Idempotent uploads (spec §13: every queued offline item carries a `client_id`).
//!
//! The first request for `(user, client_id)` reserves the key with a short-lived "pending"
//! marker, does the work and then stores the result for 24 hours. A retry within that time
//! gets the stored result instead of a second upload; a retry while the first attempt is
//! still running waits for it (and takes over if it fails). If the work fails (or the
//! request is cancelled) the reservation is released so the client can try again.

use std::sync::Arc;
use std::time::Duration;

use redis::Script;
use serde_json::Value;
use uuid::Uuid;

use crate::cache::memory::MemoryStore;
use crate::clock::SharedClock;
use crate::redis_client::RedisHandle;

/// How long a stored result is replayed.
pub const RESULT_TTL: Duration = Duration::from_hours(24);
/// How long a reservation blocks duplicates if the worker dies without releasing it.
pub const PENDING_TTL: Duration = Duration::from_mins(2);

const DONE_PREFIX: &str = "D:";
const PENDING_PREFIX: &str = "P:";

const RELEASE_SCRIPT: &str = r"
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
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
    release_script: Script,
}

/// Validates a client-supplied idempotency key: 8–128 characters of `[A-Za-z0-9_.:-]`.
pub fn valid_client_id(raw: &str) -> bool {
    (8..=128).contains(&raw.len())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

impl IdempotencyStore {
    pub fn new(redis: Arc<RedisHandle>, clock: SharedClock) -> Self {
        Self {
            redis,
            memory: MemoryStore::new(10_000),
            clock,
            release_script: Script::new(RELEASE_SCRIPT),
        }
    }

    fn key(scope: &str, user: Uuid, client_id: &str) -> String {
        format!("idem:v1:{scope}:{user}:{client_id}")
    }

    /// Tries to reserve `(scope, user, client_id)`.
    pub async fn begin(self: &Arc<Self>, scope: &str, user: Uuid, client_id: &str) -> Begin {
        let key = Self::key(scope, user, client_id);
        let token = format!("{PENDING_PREFIX}{}", Uuid::new_v4());
        for _ in 0..2 {
            if self.set_nx(&key, &token, PENDING_TTL).await {
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

    async fn set_nx(&self, key: &str, value: &str, ttl: Duration) -> bool {
        let ttl_ms = ttl.as_millis() as u64;
        let redis_result = self
            .redis
            .run("idem_set_nx", |mut conn| async move {
                redis::cmd("SET")
                    .arg(key)
                    .arg(value)
                    .arg("NX")
                    .arg("PX")
                    .arg(ttl_ms)
                    .query_async::<Option<String>>(&mut conn)
                    .await
            })
            .await;
        match redis_result {
            Ok(reply) => reply.is_some(),
            Err(_) => self.memory.set_nx(
                key,
                Arc::from(value.as_bytes()),
                ttl_ms,
                self.clock.now_ms(),
            ),
        }
    }

    async fn set(&self, key: &str, value: &str, ttl: Duration) {
        let ttl_ms = ttl.as_millis() as u64;
        self.memory.set(
            key,
            Arc::from(value.as_bytes()),
            ttl_ms,
            self.clock.now_ms(),
        );
        let _ = self
            .redis
            .run("idem_set", |mut conn| async move {
                redis::cmd("SET")
                    .arg(key)
                    .arg(value)
                    .arg("PX")
                    .arg(ttl_ms)
                    .query_async::<()>(&mut conn)
                    .await
            })
            .await;
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
            Ok(None) | Err(_) => self
                .memory
                .get(key, self.clock.now_ms())
                .and_then(|bytes| String::from_utf8(bytes.to_vec()).ok()),
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
        self.store.set(&self.key, &stored, RESULT_TTL).await;
        self.finished = true;
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
        (Arc::new(IdempotencyStore::new(redis, clock.clone())), clock)
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
