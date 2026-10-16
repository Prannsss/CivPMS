//! The keep-alive task end to end: pings the configured URL once the service is idle, keeps
//! quiet while there is traffic, survives a failing target and stops on shutdown.

#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: failing loudly is the point

use std::sync::Arc;
use std::time::Duration;

use civpms_media::clock;
use civpms_media::config::KeepaliveConfig;
use civpms_media::keepalive::{self, ActivityTracker};
use tokio_util::sync::CancellationToken;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn config(url: Option<String>, enabled: bool) -> KeepaliveConfig {
    KeepaliveConfig {
        enabled,
        url,
        idle: Duration::from_secs(1),
        check_interval: Duration::from_secs(1),
    }
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn pings_when_idle_and_stops_on_shutdown() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/healthz"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let clock = clock::system();
    let tracker = Arc::new(ActivityTracker::new(clock.clone()));
    let shutdown = CancellationToken::new();
    let task = tokio::spawn(keepalive::run(
        config(Some(format!("{}/healthz", server.uri())), true),
        Arc::clone(&tracker),
        clock,
        http(),
        shutdown.clone(),
    ));

    tokio::time::sleep(Duration::from_millis(2_600)).await;
    let pings = server.received_requests().await.unwrap().len();
    assert!(pings >= 1, "expected a ping after 1 s idle, got {pings}");
    assert!(pings <= 3, "at most one ping per idle period, got {pings}");

    shutdown.cancel();
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .expect("task stops promptly on shutdown")
        .expect("task never panics");
}

#[tokio::test]
async fn traffic_suppresses_pings() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let clock = clock::system();
    let tracker = Arc::new(ActivityTracker::new(clock.clone()));
    let shutdown = CancellationToken::new();
    let task = tokio::spawn(keepalive::run(
        config(Some(format!("{}/healthz", server.uri())), true),
        Arc::clone(&tracker),
        clock,
        http(),
        shutdown.clone(),
    ));
    // Simulated inbound requests every 300 ms for 2.4 s: never idle for a full second.
    for _ in 0..8 {
        tracker.touch();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        0,
        "no ping while busy"
    );
    shutdown.cancel();
    task.await.unwrap();
}

#[tokio::test]
async fn failing_target_is_logged_not_fatal() {
    // Connection refused on every ping.
    let dead = format!("http://127.0.0.1:{}/healthz", {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    });
    let clock = clock::system();
    let tracker = Arc::new(ActivityTracker::new(clock.clone()));
    let shutdown = CancellationToken::new();
    let task = tokio::spawn(keepalive::run(
        config(Some(dead), true),
        tracker,
        clock,
        http(),
        shutdown.clone(),
    ));
    tokio::time::sleep(Duration::from_millis(2_300)).await;
    assert!(!task.is_finished(), "keeps running after failed pings");
    shutdown.cancel();
    task.await.unwrap();
}

#[tokio::test]
async fn disabled_task_returns_immediately() {
    let clock = clock::system();
    let tracker = Arc::new(ActivityTracker::new(clock.clone()));
    let task = keepalive::run(
        config(Some("https://example.invalid/healthz".into()), false),
        tracker,
        clock,
        http(),
        CancellationToken::new(),
    );
    tokio::time::timeout(Duration::from_millis(100), task)
        .await
        .expect("returns at once when disabled");
}
