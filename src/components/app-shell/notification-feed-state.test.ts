import { describe, expect, it } from "vitest";
import type { NotificationRecord } from "@/lib/notifications";
import { FEED_MAX_ITEMS, feedFromSnapshot, feedReducer, newestCreatedAt, unreadIds } from "./notification-feed-state";

function record(id: string, createdAt: string, readAt: string | null = null): NotificationRecord {
  return {
    id,
    type: "project_status_changed",
    title: `Notification ${id}`,
    body: null,
    link: null,
    projectId: null,
    projectName: null,
    statusTo: null,
    readAt,
    createdAt,
  };
}

const T1 = "2026-10-13T01:00:00.000Z";
const T2 = "2026-10-13T02:00:00.000Z";
const T3 = "2026-10-13T03:00:00.000Z";
const T4 = "2026-10-13T04:00:00.000Z";
const READ = "2026-10-13T05:00:00.000Z";

describe("feedFromSnapshot", () => {
  it("keeps the snapshot and never reports a negative unread count", () => {
    const state = feedFromSnapshot({ items: [record("b", T2), record("a", T1)], unreadCount: -3 });
    expect(state.items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(state.unreadCount).toBe(0);
  });

  it("caps the number of items kept in memory", () => {
    const items = Array.from({ length: FEED_MAX_ITEMS + 5 }, (_, i) => record(`n${i}`, T1));
    expect(feedFromSnapshot({ items, unreadCount: 0 }).items).toHaveLength(FEED_MAX_ITEMS);
  });
});

describe("feedReducer", () => {
  const base = feedFromSnapshot({ items: [record("b", T2), record("a", T1, READ)], unreadCount: 7 });

  it("adds a live notification on top and counts it as unread", () => {
    const next = feedReducer(base, { type: "insert", record: record("c", T3) });
    expect(next.items.map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(next.unreadCount).toBe(8);
  });

  it("ignores a notification it already has (Realtime + catch-up)", () => {
    const once = feedReducer(base, { type: "insert", record: record("c", T3) });
    expect(feedReducer(once, { type: "insert", record: record("c", T3) })).toBe(once);
  });

  it("does not count an already-read insert as unread", () => {
    expect(feedReducer(base, { type: "insert", record: record("c", T3, READ) }).unreadCount).toBe(7);
  });

  it("marks only unread items read, and is a no-op when nothing changes", () => {
    const next = feedReducer(base, { type: "markRead", ids: ["a", "b", "zzz"], at: READ });
    expect(next.items.find((item) => item.id === "b")?.readAt).toBe(READ);
    expect(next.unreadCount).toBe(6);
    expect(feedReducer(next, { type: "markRead", ids: ["a", "b"], at: READ })).toBe(next);
  });

  it("marks everything read", () => {
    const next = feedReducer(base, { type: "markAllRead", at: READ });
    expect(next.unreadCount).toBe(0);
    expect(unreadIds(next)).toEqual([]);
    expect(feedReducer(next, { type: "markAllRead", at: READ })).toBe(next);
  });

  it("reverts an optimistic mark that the server refused", () => {
    const marked = feedReducer(base, { type: "markRead", ids: ["b"], at: READ });
    const reverted = feedReducer(marked, { type: "revert", ids: ["b"], unreadCount: 7 });
    expect(reverted.items.find((item) => item.id === "b")?.readAt).toBeNull();
    expect(reverted.unreadCount).toBe(7);
  });

  it("adopts a new server snapshot", () => {
    const next = feedReducer(base, { type: "reset", feed: { items: [record("b", T2, READ)], unreadCount: 2 } });
    expect(next.items.map((item) => item.id)).toEqual(["b"]);
    expect(next.unreadCount).toBe(2);
  });

  it("keeps live notifications newer than a snapshot the server read before they arrived", () => {
    const live = feedReducer(
      feedReducer(base, { type: "insert", record: record("c", T3) }),
      { type: "insert", record: record("d", T4) },
    );
    // The refresh after "c" was rendered before "d" existed.
    const next = feedReducer(live, {
      type: "reset",
      feed: { items: [record("c", T3), record("b", T2), record("a", T1, READ)], unreadCount: 8 },
    });
    expect(next.items.map((item) => item.id)).toEqual(["d", "c", "b", "a"]);
    expect(next.unreadCount).toBe(9);
  });
});

describe("newestCreatedAt", () => {
  it("returns the newest timestamp, or null for an empty feed", () => {
    expect(newestCreatedAt({ items: [record("a", T1), record("c", T3), record("b", T2)] })).toBe(T3);
    expect(newestCreatedAt({ items: [] })).toBeNull();
  });
});
