/**
 * In-app notification records shared by the server query (`src/server/queries/notifications.ts`)
 * and the browser (Realtime inserts in the connected top bar). Framework-free and serializable.
 */
import type { Database } from "@/lib/supabase/database.types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

/** Columns the bell needs (keep in sync with `NOTIFICATION_COLUMNS`). */
export type NotificationRowSubset = Pick<
  NotificationRow,
  "id" | "type" | "title" | "body" | "link" | "project_id" | "payload" | "read_at" | "created_at"
>;

export const NOTIFICATION_COLUMNS = "id, type, title, body, link, project_id, payload, read_at, created_at";

/** Notification types written by `private.notify` (see docs/DATABASE.md → Notifications). */
export const NOTIFICATION_TYPES = [
  "invitation_received",
  "invitation_accepted",
  "invitation_declined",
  "member_joined",
  "added_to_project",
  "removed_from_project",
  "removed_from_company",
  "project_budget_exceeded",
  "project_delayed",
  "project_status_changed",
] as const;
export type KnownNotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRecord {
  id: string;
  /** A `KnownNotificationType`, or a newer type this build does not know yet. */
  type: string;
  title: string;
  body: string | null;
  /** App path to open (e.g. `/projects/<id>`), or null. */
  link: string | null;
  projectId: string | null;
  /** Snapshot from the payload (names survive renames/deletes). */
  projectName: string | null;
  /** `project_status_changed`: the new status. */
  statusTo: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  /** Newest first. */
  items: NotificationRecord[];
  /** All unread in-app notifications (can exceed `items.length`). */
  unreadCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Only same-app absolute paths are followed (never `//host` or `https://…`). */
export function safeNotificationLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  if (!link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) return null;
  return link;
}

/**
 * ISO 8601 in UTC with milliseconds (`2026-10-13T06:30:02.560Z`). PostgREST and Realtime format
 * `timestamptz` slightly differently; normalizing keeps string comparison and sorting reliable.
 */
export function normalizeTimestamp(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

/** Maps a `notifications` row (PostgREST select or a Realtime payload) to a `NotificationRecord`. */
export function toNotificationRecord(row: NotificationRowSubset): NotificationRecord {
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: stringOrNull(row.body),
    link: safeNotificationLink(row.link),
    projectId: row.project_id ?? stringOrNull(payload.project_id),
    projectName: stringOrNull(payload.project_name),
    statusTo: stringOrNull(payload.to),
    readAt: row.read_at ? normalizeTimestamp(row.read_at) : null,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

/** True when the value looks like a Realtime `new` record for the notifications table. */
export function isNotificationRow(value: unknown): value is NotificationRowSubset & { in_app?: boolean } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.created_at === "string"
  );
}
