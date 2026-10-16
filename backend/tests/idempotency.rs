//! Idempotency records against a real `redis-server` whose writes fail for a moment
//! (`maxmemory 1` + `noeviction` makes every write answer `OOM` while reads keep working).
//!
//! Regression (review finding): Redis and the in-memory fallback could disagree. A reservation
//! that only existed in Redis was invisible to a duplicate arriving during a Redis hiccup (two
//! uploads), and a result whose Redis write failed stayed hidden behind the old pending marker
//! once Redis answered again (409s for two minutes, then a second upload).

#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: failing loudly is the point

mod common;

use std::sync::Arc;
use std::time::Duration;

use civpms_media::clock::ManualClock;
use civpms_media::idempotency::{Begin, IdempotencyStore, MIN_PENDING_TTL};
use civpms_media::redis_client::RedisHandle;
use common::RedisServer;
use serde_json::json;
use uuid::Uuid;

/// One service instance: its own memory, the shared Redis.
fn instance(redis: &RedisServer, clock: &Arc<ManualClock>) -> Arc<IdempotencyStore> {
    let handle =
        RedisHandle::connect_lazy(&redis.url(), Duration::from_millis(300), clock.clone())
            .unwrap();
    Arc::new(IdempotencyStore::new(
        Arc::new(handle),
        clock.clone(),
        MIN_PENDING_TTL,
    ))
}

fn writes_fail(redis: &RedisServer, fail: bool) {
    assert_eq!(
        redis.cli(&["CONFIG", "SET", "maxmemory-policy", "noeviction"]),
        "OK"
    );
    let limit = if fail { "1" } else { "0" };
    assert_eq!(redis.cli(&["CONFIG", "SET", "maxmemory", limit]), "OK");
}

/// Past the Redis handle's 5 s back-off after a failed operation.
fn after_backoff(clock: &ManualClock) {
    clock.advance(Duration::from_secs(6));
}

fn key(user: Uuid, client_id: &str) -> String {
    format!("idem:v1:images:{user}:{client_id}")
}

fn stored_in_redis(redis: &RedisServer, key: &str) -> String {
    redis.cli(&["GET", key])
}

async fn wait_for_redis_value(redis: &RedisServer, key: &str, prefix: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    loop {
        let value = stored_in_redis(redis, key);
        if value.starts_with(prefix) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Redis never got the {prefix} record; it holds {value:?}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn a_duplicate_during_a_redis_hiccup_sees_the_reservation() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let clock = ManualClock::new(1_000_000);
    let store = instance(&redis, &clock);
    let user = Uuid::new_v4();

    let Begin::Started(first) = store.begin("images", user, "client-0001").await else {
        panic!("expected Started");
    };
    assert!(stored_in_redis(&redis, &key(user, "client-0001")).starts_with("P:"));

    // Redis refuses writes: the duplicate must not get its own reservation in memory.
    writes_fail(&redis, true);
    assert!(matches!(
        store.begin("images", user, "client-0001").await,
        Begin::InProgress
    ));

    writes_fail(&redis, false);
    after_backoff(&clock);
    first.commit(&json!({"path": "a"})).await;
    assert!(stored_in_redis(&redis, &key(user, "client-0001")).starts_with("D:"));
    // Another instance (empty memory) replays it from Redis.
    match instance(&redis, &clock)
        .begin("images", user, "client-0001")
        .await
    {
        Begin::Replay(value) => assert_eq!(value, json!({"path": "a"})),
        other => panic!("expected Replay, got {other:?}"),
    }
}

#[tokio::test]
async fn a_result_whose_redis_write_failed_is_replayed_and_reaches_redis_later() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let clock = ManualClock::new(1_000_000);
    let store = instance(&redis, &clock);
    let user = Uuid::new_v4();
    let key = key(user, "client-0002");

    let Begin::Started(first) = store.begin("images", user, "client-0002").await else {
        panic!("expected Started");
    };
    writes_fail(&redis, true);
    first.commit(&json!({"path": "b"})).await;
    assert!(
        stored_in_redis(&redis, &key).starts_with("P:"),
        "the Redis write failed"
    );

    // Redis answers again, still holding the old pending marker: the retry is replayed from
    // this instance's memory instead of waiting for the marker to expire.
    writes_fail(&redis, false);
    after_backoff(&clock);
    match store.begin("images", user, "client-0002").await {
        Begin::Replay(value) => assert_eq!(value, json!({"path": "b"})),
        other => panic!("expected Replay, got {other:?}"),
    }

    // The background retry writes the result to Redis, so other instances replay it too.
    wait_for_redis_value(&redis, &key, "D:").await;
    match instance(&redis, &clock)
        .begin("images", user, "client-0002")
        .await
    {
        Begin::Replay(value) => assert_eq!(value, json!({"path": "b"})),
        other => panic!("expected Replay, got {other:?}"),
    }
}

#[tokio::test]
async fn a_late_commit_never_overwrites_another_requests_reservation() {
    let Some(redis) = RedisServer::start() else {
        return;
    };
    let clock = ManualClock::new(1_000_000);
    let (one, two) = (instance(&redis, &clock), instance(&redis, &clock));
    let user = Uuid::new_v4();
    let first_key = key(user, "client-0003");

    let Begin::Started(slow) = one.begin("images", user, "client-0003").await else {
        panic!("expected Started");
    };
    // Its marker expires (e.g. the process stalled) and another instance takes over.
    redis.cli(&["DEL", &first_key]);
    let Begin::Started(takeover) = two.begin("images", user, "client-0003").await else {
        panic!("expected Started");
    };
    let takeover_marker = stored_in_redis(&redis, &first_key);
    slow.commit(&json!({"path": "slow"})).await;
    assert_eq!(
        stored_in_redis(&redis, &first_key),
        takeover_marker,
        "the late commit left the other reservation alone"
    );
    takeover.commit(&json!({"path": "takeover"})).await;
    assert!(stored_in_redis(&redis, &first_key).contains("takeover"));

    // A commit whose marker expired with nobody else around is still stored.
    let Begin::Started(lonely) = one.begin("images", user, "client-0004").await else {
        panic!("expected Started");
    };
    let lonely_key = key(user, "client-0004");
    redis.cli(&["DEL", &lonely_key]);
    lonely.commit(&json!({"path": "lonely"})).await;
    assert!(stored_in_redis(&redis, &lonely_key).starts_with("D:"));
}
