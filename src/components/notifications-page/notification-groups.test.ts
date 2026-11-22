import { describe, expect, it } from "vitest";
import type { NotificationRecord } from "@/lib/notifications";
import { dayLabel, groupByDay, mergePages, notificationsHref } from "./notification-groups";

function record(id: string, createdAt: string): NotificationRecord {
  return { id, type: "project_delayed", title: id, body: null, link: null, projectId: null, projectName: null, statusTo: null, readAt: null, createdAt };
}

describe("groupByDay", () => {
  it("groups by Manila day with Today / Yesterday labels", () => {
    const now = new Date("2026-10-15T03:00:00Z"); // 11:00 Manila, 15 Oct
    const groups = groupByDay(
      [
        record("a", "2026-10-15T01:00:00Z"),
        record("b", "2026-10-14T17:00:00Z"), // 01:00 Manila on the 15th
        record("c", "2026-10-14T15:00:00Z"), // 23:00 Manila on the 14th
        record("d", "2026-10-10T02:00:00Z"),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["10 Oct 2026", ["d"]],
    ]);
  });

  it("labels days", () => {
    expect(dayLabel("2026-10-15", "2026-10-15")).toBe("Today");
    expect(dayLabel("2026-10-14", "2026-10-15")).toBe("Yesterday");
    expect(dayLabel("2025-12-31", "2026-10-15")).toBe("31 Dec 2025");
  });
});

describe("mergePages", () => {
  it("appends older pages without duplicates", () => {
    const first = [record("a", "2026-10-15T01:00:00Z"), record("b", "2026-10-15T00:00:00Z")];
    const older = [record("b", "2026-10-15T00:00:00Z"), record("c", "2026-10-14T00:00:00Z")];
    expect(mergePages(first, older).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("notificationsHref", () => {
  it("builds deep links for filters", () => {
    expect(notificationsHref({ unread: false, projectId: null })).toBe("/notifications");
    expect(notificationsHref({ unread: true, projectId: null })).toBe("/notifications?filter=unread");
    expect(notificationsHref({ unread: true, projectId: "p1" })).toBe("/notifications?filter=unread&project=p1");
  });
});
