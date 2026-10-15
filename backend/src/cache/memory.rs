//! Bounded in-memory LRU with per-entry expiry: the fallback when Redis is unavailable, and a
//! mirror of recent writes so stale-on-error still works during a Redis outage.

use std::num::NonZeroUsize;
use std::sync::Arc;

use lru::LruCache;
use parking_lot::Mutex;

#[derive(Debug, Clone)]
struct Slot {
    expires_at_ms: u64,
    bytes: Arc<[u8]>,
}

#[derive(Debug)]
pub struct MemoryStore {
    entries: Mutex<LruCache<String, Slot>>,
}

impl MemoryStore {
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity.max(1)).unwrap_or(NonZeroUsize::MIN);
        Self {
            entries: Mutex::new(LruCache::new(capacity)),
        }
    }

    pub fn get(&self, key: &str, now_ms: u64) -> Option<Arc<[u8]>> {
        let mut entries = self.entries.lock();
        match entries.get(key) {
            Some(slot) if slot.expires_at_ms > now_ms => Some(Arc::clone(&slot.bytes)),
            Some(_) => {
                entries.pop(key);
                None
            }
            None => None,
        }
    }

    pub fn set(&self, key: &str, bytes: Arc<[u8]>, ttl_ms: u64, now_ms: u64) {
        self.entries.lock().put(
            key.to_owned(),
            Slot {
                expires_at_ms: now_ms.saturating_add(ttl_ms),
                bytes,
            },
        );
    }

    /// Stores only when no live entry exists. Returns true when stored.
    pub fn set_nx(&self, key: &str, bytes: Arc<[u8]>, ttl_ms: u64, now_ms: u64) -> bool {
        let mut entries = self.entries.lock();
        if entries
            .get(key)
            .is_some_and(|slot| slot.expires_at_ms > now_ms)
        {
            return false;
        }
        entries.put(
            key.to_owned(),
            Slot {
                expires_at_ms: now_ms.saturating_add(ttl_ms),
                bytes,
            },
        );
        true
    }

    /// Removes the entry only if it still holds `expected` (compare-and-delete).
    pub fn delete_if(&self, key: &str, expected: &[u8]) -> bool {
        let mut entries = self.entries.lock();
        if entries
            .peek(key)
            .is_some_and(|slot| &*slot.bytes == expected)
        {
            entries.pop(key);
            return true;
        }
        false
    }

    pub fn len(&self) -> usize {
        self.entries.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(s: &str) -> Arc<[u8]> {
        Arc::from(s.as_bytes())
    }

    #[test]
    fn expires_entries() {
        let store = MemoryStore::new(10);
        store.set("a", bytes("1"), 1_000, 0);
        assert_eq!(store.get("a", 999).as_deref(), Some(&b"1"[..]));
        assert!(store.get("a", 1_000).is_none());
        assert!(store.is_empty(), "expired entry is evicted on read");
    }

    #[test]
    fn evicts_least_recently_used() {
        let store = MemoryStore::new(2);
        store.set("a", bytes("1"), 10_000, 0);
        store.set("b", bytes("2"), 10_000, 0);
        let _ = store.get("a", 1);
        store.set("c", bytes("3"), 10_000, 0);
        assert!(store.get("b", 1).is_none());
        assert!(store.get("a", 1).is_some());
        assert_eq!(store.len(), 2);
    }

    #[test]
    fn set_nx_and_compare_delete() {
        let store = MemoryStore::new(10);
        assert!(store.set_nx("k", bytes("p1"), 1_000, 0));
        assert!(!store.set_nx("k", bytes("p2"), 1_000, 10));
        assert!(!store.delete_if("k", b"p2"));
        assert!(store.delete_if("k", b"p1"));
        assert!(store.set_nx("k", bytes("p3"), 1_000, 20));
        // An expired entry does not block set_nx.
        assert!(store.set_nx("k", bytes("p4"), 1_000, 5_000));
    }
}
