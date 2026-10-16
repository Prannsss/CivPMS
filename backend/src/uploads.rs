//! Admission control for uploads, applied before a request body is read.
//!
//! * **One upload per user at a time.** A user's next upload waits (up to
//!   `FFMPEG_QUEUE_TIMEOUT_SECS`) for the previous one to finish, so one account can never
//!   occupy more than one place in the ffmpeg queue, however many requests it sends. Waiting
//!   (instead of refusing) keeps concurrent idempotent duplicates working: the second one
//!   proceeds once the first has stored its result, and replays it.
//! * **A global cap on uploads in progress** (`MAX_CONCURRENT_UPLOADS`): beyond it, requests
//!   get `503 BUSY` at once, before anything is written to the temp directory, so disk use is
//!   bounded by `cap × MAX_UPLOAD_MB`.
//!
//! Processing time is charged to the per-user upload budget separately (see
//! [`processing_charge`]). All of this is per instance; the request budget itself is shared
//! through Redis.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};

/// Per-user slot map entries are swept when the map grows beyond this.
const SWEEP_AT: usize = 10_000;

#[derive(Debug)]
pub struct UploadGate {
    per_user: Mutex<HashMap<Uuid, Arc<Semaphore>>>,
    in_progress: Arc<Semaphore>,
    user_wait: Duration,
}

/// Held for the whole upload; dropping it frees the user's slot and the global place.
#[derive(Debug)]
pub struct UploadPermit {
    gate: Arc<UploadGate>,
    user: Uuid,
    user_slot: Option<OwnedSemaphorePermit>,
    _in_progress: OwnedSemaphorePermit,
}

impl UploadGate {
    pub fn new(max_in_progress: usize, user_wait: Duration) -> Self {
        Self {
            per_user: Mutex::new(HashMap::new()),
            in_progress: Arc::new(Semaphore::new(max_in_progress.max(1))),
            user_wait,
        }
    }

    /// Admits one upload for `user`, waiting for the user's previous upload if needed.
    pub async fn admit(self: &Arc<Self>, user: Uuid) -> Result<UploadPermit, AppError> {
        let slot = {
            let mut map = self.per_user.lock();
            if map.len() >= SWEEP_AT {
                map.retain(|_, s| Arc::strong_count(s) > 1);
            }
            Arc::clone(
                map.entry(user)
                    .or_insert_with(|| Arc::new(Semaphore::new(1))),
            )
        };
        let Ok(Ok(user_slot)) = tokio::time::timeout(self.user_wait, slot.acquire_owned()).await
        else {
            return Err(AppError::new(
                ErrorCode::RateLimited,
                "Your previous upload is still being processed. Wait for it to finish, then try again.",
            )
            .with_retry_after(5));
        };
        let Ok(in_progress) = Arc::clone(&self.in_progress).try_acquire_owned() else {
            return Err(AppError::new(
                ErrorCode::Busy,
                "The server is busy processing other uploads. Try again shortly.",
            )
            .with_retry_after(5));
        };
        Ok(UploadPermit {
            gate: Arc::clone(self),
            user,
            user_slot: Some(user_slot),
            _in_progress: in_progress,
        })
    }

    /// Uploads currently admitted (diagnostics/tests).
    pub fn in_progress(&self, capacity: usize) -> usize {
        capacity.saturating_sub(self.in_progress.available_permits())
    }

    fn release_user(&self, user: Uuid, permit: OwnedSemaphorePermit) {
        let mut map = self.per_user.lock();
        drop(permit);
        // Only the map holds the semaphore now: nobody is uploading or waiting.
        if map.get(&user).is_some_and(|s| Arc::strong_count(s) == 1) {
            map.remove(&user);
        }
    }

    #[cfg(test)]
    fn tracked_users(&self) -> usize {
        self.per_user.lock().len()
    }
}

impl Drop for UploadPermit {
    fn drop(&mut self) {
        if let Some(permit) = self.user_slot.take() {
            self.gate.release_user(self.user, permit);
        }
    }
}

/// Extra upload-budget units charged for the time a job held an ffmpeg slot: one per full
/// second (jobs under a second cost only their request). A user who keeps the queue busy with
/// slow images runs out of budget proportionally, however few requests they send.
pub fn processing_charge(slot_held: Duration) -> u32 {
    u32::try_from(slot_held.as_secs()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(cap: usize, wait_ms: u64) -> Arc<UploadGate> {
        Arc::new(UploadGate::new(cap, Duration::from_millis(wait_ms)))
    }

    #[tokio::test]
    async fn one_upload_per_user_the_next_one_waits() {
        let gate = gate(8, 2_000);
        let user = Uuid::new_v4();
        let first = gate.admit(user).await.unwrap();
        let gate2 = Arc::clone(&gate);
        let second = tokio::spawn(async move { gate2.admit(user).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!second.is_finished(), "waits for the first upload");
        // Other users are not affected.
        let other = gate.admit(Uuid::new_v4()).await.unwrap();
        drop(first);
        let second = second.await.unwrap().unwrap();
        drop((second, other));
        assert_eq!(gate.tracked_users(), 0, "idle users are forgotten");
    }

    #[tokio::test]
    async fn waiting_too_long_is_429() {
        let gate = gate(8, 50);
        let user = Uuid::new_v4();
        let _first = gate.admit(user).await.unwrap();
        let err = gate.admit(user).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RateLimited);
        assert!(err.retry_after.is_some());
    }

    #[tokio::test]
    async fn global_cap_is_busy_at_once_and_frees_the_user_slot() {
        let gate = gate(1, 2_000);
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let held = gate.admit(a).await.unwrap();
        assert_eq!(gate.in_progress(1), 1);
        let started = std::time::Instant::now();
        let err = gate.admit(b).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Busy);
        assert!(started.elapsed() < Duration::from_millis(500));
        drop(held);
        assert_eq!(gate.in_progress(1), 0);
        // b's own slot was released with the refusal.
        let _ok = gate.admit(b).await.unwrap();
    }

    #[test]
    fn charge_is_whole_seconds_of_processing() {
        assert_eq!(processing_charge(Duration::from_millis(900)), 0);
        assert_eq!(processing_charge(Duration::from_millis(7_400)), 7);
        assert_eq!(processing_charge(Duration::from_secs(30)), 30);
    }
}
