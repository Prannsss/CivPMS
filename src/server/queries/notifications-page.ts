import "server-only";

/**
 * The full notifications list (spec §14), read as the signed-in user (RLS: own rows with
 * `in_app = true`). Newest first with keyset pagination on (created_at, id), so pages never skip
 * or repeat rows while new notifications arrive. Filters: unread only, one project.
 */
import { cache } from "react";
import { AppException, toAppError } from "@/lib/errors";
import { NOTIFICATION_COLUMNS, toNotificationRecord, type NotificationRecord } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/server/context";

export const NOTIFICATIONS_PAGE_SIZE = 20;

export type NotificationsFilter = { unread: boolean; projectId: string | null };

export interface NotificationsPage {
  items: NotificationRecord[];
  /** Pass back to load the next (older) page; null when there is nothing older. */
  nextCursor: string | null;
}

export interface NotificationsOverview {
  unreadCount: number;
  totalCount: number;
  /** Projects to filter by: the ones you can see, plus names from past notifications. */
  projects: { id: string; name: string }[];
}

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

/** Opaque cursor from the last row of a page (raw timestamp keeps microseconds). */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor || cursor.length > 200) return null;
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [createdAt, id, extra] = raw.split("|");
  if (extra !== undefined || !id || !isUuid(id) || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9T:.+\- Z]+$/.test(createdAt)) return null;
  return { createdAt, id };
}

/** Normalizes URL/search input into a filter (invalid project ids are ignored). */
export function parseNotificationsFilter(input: { filter?: unknown; project?: unknown }): NotificationsFilter {
  return {
    unread: input.filter === "unread",
    projectId: isUuid(input.project) ? input.project : null,
  };
}

export async function getNotificationsPage(filter: NotificationsFilter, cursor: string | null = null): Promise<NotificationsPage> {
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("in_app", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(NOTIFICATIONS_PAGE_SIZE + 1);
  if (filter.unread) query = query.is("read_at", null);
  if (filter.projectId) query = query.eq("project_id", filter.projectId);
  const after = decodeCursor(cursor);
  if (after) {
    query = query.or(`created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`);
  }
  const { data, error } = await query;
  if (error) throwReadFailure(error);
  const rows = data ?? [];
  const page = rows.slice(0, NOTIFICATIONS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toNotificationRecord),
    nextCursor: rows.length > NOTIFICATIONS_PAGE_SIZE && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export const getNotificationsOverview = cache(async (): Promise<NotificationsOverview> => {
  const supabase = await createClient();
  const [unread, total, visible, mentioned] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("in_app", true).is("read_at", null),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("in_app", true),
    supabase.from("project_overview").select("id, name").order("name").limit(500),
    supabase
      .from("notifications")
      .select("project_id, payload")
      .eq("in_app", true)
      .not("project_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (unread.error) throwReadFailure(unread.error);
  if (total.error) throwReadFailure(total.error);
  if (visible.error) throwReadFailure(visible.error);
  if (mentioned.error) throwReadFailure(mentioned.error);

  const names = new Map<string, string>();
  for (const row of visible.data ?? []) if (row.id && row.name) names.set(row.id, row.name);
  const withNotifications = new Set<string>();
  for (const row of mentioned.data ?? []) {
    if (!row.project_id) continue;
    withNotifications.add(row.project_id);
    if (!names.has(row.project_id)) {
      const payload = row.payload;
      const name =
        typeof payload === "object" && payload !== null && !Array.isArray(payload) && typeof payload.project_name === "string"
          ? payload.project_name
          : null;
      if (name) names.set(row.project_id, name);
    }
  }
  // Only projects that actually have notifications are useful filters.
  const projects = [...names]
    .filter(([id]) => withNotifications.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { unreadCount: unread.count ?? 0, totalCount: total.count ?? 0, projects };
});
