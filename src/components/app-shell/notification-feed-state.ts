/**
 * Pure state for the connected bell: the server snapshot, live inserts (Realtime) and optimistic
 * read marks. Kept free of React so it can be unit-tested.
 */
import type { NotificationFeed, NotificationRecord } from "@/lib/notifications";

export interface FeedState {
  /** Newest first, unique by id. */
  items: NotificationRecord[];
  /** Unread in-app notifications overall (may exceed the unread items loaded here). */
  unreadCount: number;
}

export type FeedAction =
  /**
   * A fresh server snapshot (initial render or router refresh). Live items newer than the
   * snapshot's newest item are kept: they arrived after the server read it.
   */
  | { type: "reset"; feed: NotificationFeed }
  /** A notification arrived live. Duplicates are ignored. */
  | { type: "insert"; record: NotificationRecord }
  /** Mark these ids read (optimistically or from a Realtime UPDATE). */
  | { type: "markRead"; ids: readonly string[]; at: string }
  /** Mark everything read ("Mark all as read"). */
  | { type: "markAllRead"; at: string }
  /** Undo an optimistic mark that the server rejected. */
  | { type: "revert"; ids: readonly string[]; unreadCount: number };

/** Live inserts beyond this many are dropped from memory (the full list is on /notifications). */
export const FEED_MAX_ITEMS = 50;

/** Newest first; ties broken by id (descending), like the server query. */
function byNewest(a: NotificationRecord, b: NotificationRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** `created_at` of the newest loaded notification, or null when the feed is empty. */
export function newestCreatedAt(state: Pick<FeedState, "items">): string | null {
  let newest: string | null = null;
  for (const item of state.items) if (newest === null || item.createdAt > newest) newest = item.createdAt;
  return newest;
}

export function feedFromSnapshot(feed: NotificationFeed): FeedState {
  return {
    items: feed.items.slice(0, FEED_MAX_ITEMS),
    unreadCount: Math.max(0, feed.unreadCount),
  };
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "reset": {
      const next = feedFromSnapshot(action.feed);
      const newest = newestCreatedAt(next);
      const known = new Set(next.items.map((item) => item.id));
      const later = state.items.filter((item) => !known.has(item.id) && (newest === null || item.createdAt > newest));
      if (later.length === 0) return next;
      return {
        items: [...later, ...next.items].sort(byNewest).slice(0, FEED_MAX_ITEMS),
        unreadCount: next.unreadCount + later.filter((item) => item.readAt === null).length,
      };
    }
    case "insert": {
      if (state.items.some((item) => item.id === action.record.id)) return state;
      const items = [action.record, ...state.items].sort(byNewest).slice(0, FEED_MAX_ITEMS);
      return {
        items,
        unreadCount: state.unreadCount + (action.record.readAt === null ? 1 : 0),
      };
    }
    case "markRead": {
      const ids = new Set(action.ids);
      let flipped = 0;
      const items = state.items.map((item) => {
        if (!ids.has(item.id) || item.readAt !== null) return item;
        flipped += 1;
        return { ...item, readAt: action.at };
      });
      if (flipped === 0) return state;
      return { items, unreadCount: Math.max(0, state.unreadCount - flipped) };
    }
    case "markAllRead": {
      if (state.unreadCount === 0 && state.items.every((item) => item.readAt !== null)) return state;
      return {
        items: state.items.map((item) => (item.readAt === null ? { ...item, readAt: action.at } : item)),
        unreadCount: 0,
      };
    }
    case "revert": {
      const ids = new Set(action.ids);
      return {
        items: state.items.map((item) => (ids.has(item.id) ? { ...item, readAt: null } : item)),
        unreadCount: Math.max(0, action.unreadCount),
      };
    }
  }
}

/** Ids of the loaded notifications that are still unread. */
export function unreadIds(state: FeedState): string[] {
  return state.items.filter((item) => item.readAt === null).map((item) => item.id);
}
