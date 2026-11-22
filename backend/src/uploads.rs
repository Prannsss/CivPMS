//! Admission control for uploads, applied before a request body is read.
//!
//! * **One upload per user at a time.** A user's next upload waits (up to
//!   `FFMPEG_QUEUE_TIMEOUT_SECS`) for the previous one to finish, so one account can never
//!   occupy more than one place in the ffmpeg queue, however many requests it sends. The
//!   ffmpeg queue is first-come, first-served, so other users' uploads get their turn between
//!   two of that account's jobs. Waiting (instead of refusing) keeps concurrent idempotent
//!   duplicates working: the second one proceeds once the first has stored its result, and
//!   replays it.
//! * **A global cap on uploads in progress** (`MAX_CONCURRENT_UPLOADS`): beyond it, requests
//!   get `503 BUSY` at once, before anything is written to the temp directory, so temp-disk
//!   use is bounded by `cap × MAX_UPLOAD_MB`. Requests waiting for their own previous upload
//!   do not hold a place; a client sending its body slowly does (until the request timeout).
//!
//! Processing time is charged to the per-user upload budget separately (see
//! [`processing_charge`]). Both limits are per instance (the free plan runs one); the request
//! budget itself is shared through Redis.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};

/// Idle per-user entries are swept when the map grows beyond this.
const SWEEP_AT: usize = 10_000;

#[derive(Debug)]
pub struct UploadGate {
    per_user: Mutex<HashMap<Uuid, Arc<Semaphore>>>,
    in_progress: Arc<Semaphore>,
    capacity: usize,
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
    /// `capacity`: uploads that may be in progress at once on this instance. `user_wait`: how
    /// long a user's next upload waits for their previous one.
    pub fn new(capacity: usize, user_wait: Duration) -> Self {
        let capacity = capacity.max(1);
        Self {
            per_user: Mutex::new(HashMap::new()),
            in_progress: Arc::new(Semaphore::new(capacity)),
            capacity,
            user_wait,
        }
    }

    /// Admits one upload for `user`, waiting for the user's previous upload if needed.
    ///
    /// Errors: `429 RATE_LIMITED` when the previous upload is still running after the wait,
    /// `503 BUSY` (immediately) when the instance already has `capacity` uploads in progress.
    pub async fn admit(self: &Arc<Self>, user: Uuid) -> Result<UploadPermit, AppError> {
        let slot = {
            let mut map = self.per_user.lock();
            if map.len() >= SWEEP_AT {
                // Only the map holds an idle entry's semaphore.
                map.retain(|_, s| Arc::strong_count(s) > 1);
            }
            Arc::clone(
                map.entry(user)
                    .or_insert_with(|| Arc::new(Semaphore::new(1))),
            )
        };
        let waited = tokio::time::timeout(self.user_wait, slot.acquire_owned()).await;
        let Ok(Ok(user_slot)) = waited else {
            self.forget_if_idle(user);
            return Err(AppError::new(
                ErrorCode::RateLimited,
                "Your previous upload is still being processed. Wait for it to finish, then try again.",
            )
            .with_retry_after(5));
        };
        let Ok(in_progress) = Arc::clone(&self.in_progress).try_acquire_owned() else {
            drop(user_slot);
            self.forget_if_idle(user);
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

    /// Uploads currently admitted on this instance.
    pub fn in_progress(&self) -> usize {
        self.capacity
            .saturating_sub(self.in_progress.available_permits())
    }

    pub const fn capacity(&self) -> usize {
        self.capacity
    }

    /// Removes the user's entry when nobody holds or waits for it any more.
    fn forget_if_idle(&self, user: Uuid) {
        let mut map = self.per_user.lock();
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
        // Release the slot first: its permit holds a reference to the user's semaphore.
        drop(self.user_slot.take());
        self.gate.forget_if_idle(self.user);
    }
}

/// Extra upload-budget units charged for the time a job held an ffmpeg slot: one per full
/// second (jobs under a second cost only their request). Charged on failure too, so a user
/// who keeps the queue busy with slow images (up to `FFMPEG_TIMEOUT_SECS` each) runs out of
/// budget in proportion to the processing time they take, however few requests they send.
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
        assert_eq!(gate.in_progress(), 1, "a waiting upload holds no place");
        // Other users are not affected.
        let other = gate.admit(Uuid::new_v4()).await.unwrap();
        assert_eq!(gate.in_progress(), 2);
        drop(first);
        let second = second.await.unwrap().unwrap();
        drop((second, other));
        assert_eq!(gate.in_progress(), 0);
        assert_eq!(gate.tracked_users(), 0, "idle users are forgotten");
    }

    #[tokio::test]
    async fn waiting_too_long_is_429() {
        let gate = gate(8, 50);
        let user = Uuid::new_v4();
        let first = gate.admit(user).await.unwrap();
        let err = gate.admit(user).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RateLimited);
        assert!(err.retry_after.is_some());
        drop(first);
        assert_eq!(gate.tracked_users(), 0);
    }

    #[tokio::test]
    async fn global_cap_is_busy_at_once_and_frees_the_user_slot() {
        let gate = gate(1, 2_000);
        assert_eq!(gate.capacity(), 1);
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let held = gate.admit(a).await.unwrap();
        assert_eq!(gate.in_progress(), 1);
        let started = std::time::Instant::now();
        let err = gate.admit(b).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Busy);
        assert!(started.elapsed() < Duration::from_millis(500), "no waiting");
        assert_eq!(
            gate.tracked_users(),
            1,
            "b's refused attempt left nothing behind"
        );
        drop(held);
        assert_eq!(gate.in_progress(), 0);
        // b's own slot was released with the refusal.
        let _ok = gate.admit(b).await.unwrap();
    }

    #[tokio::test]
    async fn a_burst_from_one_user_is_served_one_at_a_time_in_order() {
        let gate = gate(8, 5_000);
        let user = Uuid::new_v4();
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let (gate, active) = (Arc::clone(&gate), Arc::clone(&active));
            tasks.push(tokio::spawn(async move {
                let _permit = gate.admit(user).await.unwrap();
                let now = active.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                tokio::time::sleep(Duration::from_millis(20)).await;
                active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                now
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap(), 1, "never two at once for one user");
        }
    }

    #[test]
    fn charge_is_whole_seconds_of_processing() {
        assert_eq!(processing_charge(Duration::from_millis(900)), 0);
        assert_eq!(processing_charge(Duration::from_millis(7_400)), 7);
        assert_eq!(processing_charge(Duration::from_secs(30)), 30);
    }
}
