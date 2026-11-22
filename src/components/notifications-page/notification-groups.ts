/**
 * Groups notifications by business day (Asia/Manila) for the notifications page: "Today",
 * "Yesterday", then the date ("12 Oct 2026"). Pure; the reference time is injected.
 */
import { diffDays, todayInManila } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import type { NotificationRecord } from "@/lib/notifications";

export interface NotificationDayGroup {
  key: string;
  label: string;
  items: NotificationRecord[];
}

export function dayLabel(day: string, today: string): string {
  const days = diffDays(today, day);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatDate(day);
}

/** Keeps the input order (newest first) and starts a new group whenever the day changes. */
export function groupByDay(items: readonly NotificationRecord[], now: Date): NotificationDayGroup[] {
  const today = todayInManila(now);
  const groups: NotificationDayGroup[] = [];
  for (const item of items) {
    const day = todayInManila(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.key === day) last.items.push(item);
    else groups.push({ key: day, label: dayLabel(day, today), items: [item] });
  }
  return groups;
}

/** Merges the server's first page with older pages loaded on the client (no duplicates). */
export function mergePages(first: readonly NotificationRecord[], older: readonly NotificationRecord[]): NotificationRecord[] {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...older.filter((item) => !seen.has(item.id))];
}

/** Notifications URL for a filter combination. */
export function notificationsHref(filter: { unread: boolean; projectId: string | null }): string {
  const params = new URLSearchParams();
  if (filter.unread) params.set("filter", "unread");
  if (filter.projectId) params.set("project", filter.projectId);
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}
