//! Request coalescing: concurrent calls for the same key share one execution.
//!
//! A burst of identical cache misses causes one upstream call; everyone gets a clone of its
//! result. If the leading caller is cancelled (client disconnected), one of the waiters takes
//! over (`tokio::sync::OnceCell` semantics), so followers never hang.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::OnceCell;

#[derive(Debug)]
pub struct SingleFlight<T> {
    inflight: Mutex<HashMap<String, Arc<OnceCell<T>>>>,
}

impl<T> Default for SingleFlight<T> {
    fn default() -> Self {
        Self { inflight: Mutex::new(HashMap::new()) }
    }
}

impl<T: Clone + Send + Sync> SingleFlight<T> {
    /// Runs `work` unless a call for `key` is already in flight, in which case its result is
    /// awaited instead. Returns the value and whether this call executed `work`.
    pub async fn run<F, Fut>(&self, key: &str, work: F) -> (T, bool)
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        let cell = {
            let mut map = self.inflight.lock();
            Arc::clone(map.entry(key.to_owned()).or_insert_with(|| Arc::new(OnceCell::new())))
        };
        let mut leader = false;
        let value = cell
            .get_or_init(|| {
                leader = true;
                work()
            })
            .await
            .clone();
        {
            let mut map = self.inflight.lock();
            if map.get(key).is_some_and(|current| Arc::ptr_eq(current, &cell)) {
                map.remove(key);
            }
        }
        (value, leader)
    }

    /// Number of keys currently in flight (diagnostics/tests).
    pub fn in_flight(&self) -> usize {
        self.inflight.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn concurrent_calls_share_one_execution() {
        let flights = Arc::new(SingleFlight::<u32>::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..20 {
            let flights = Arc::clone(&flights);
            let calls = Arc::clone(&calls);
            handles.push(tokio::spawn(async move {
                flights
                    .run("k", || async {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        42
                    })
                    .await
            }));
        }
        let mut leaders = 0;
        for handle in handles {
            let (value, leader) = handle.await.unwrap();
            assert_eq!(value, 42);
            leaders += usize::from(leader);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(leaders, 1);
        assert_eq!(flights.in_flight(), 0, "entry removed after completion");
    }

    #[tokio::test]
    async fn sequential_calls_run_again() {
        let flights = SingleFlight::<u32>::default();
        let (a, _) = flights.run("k", || async { 1 }).await;
        let (b, leader) = flights.run("k", || async { 2 }).await;
        assert_eq!((a, b, leader), (1, 2, true));
    }

    #[tokio::test]
    async fn cancelled_leader_hands_over_to_a_follower() {
        let flights = Arc::new(SingleFlight::<u32>::default());
        let f1 = Arc::clone(&flights);
        let leader = tokio::spawn(async move {
            f1.run("k", || async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                1
            })
            .await
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        let f2 = Arc::clone(&flights);
        let follower = tokio::spawn(async move { f2.run("k", || async { 2 }).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        leader.abort();
        let (value, took_over) =
            tokio::time::timeout(Duration::from_secs(2), follower).await.unwrap().unwrap();
        assert_eq!((value, took_over), (2, true));
    }
}
