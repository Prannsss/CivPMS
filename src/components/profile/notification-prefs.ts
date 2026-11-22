/**
 * Notification preferences model for the profile page (spec §14). The database stores one entry
 * per notification type (`notification_catalog()`): `{"<type>": {"in_app": bool, "email": bool}}`
 * plus the top-level `email_digest` ("off" | "daily", migration 20261014090000). Missing entries
 * use the catalog defaults, exactly like `private.notify`.
 *
 * Rows are grouped by the spec's event families (`NOTIFICATION_EVENT_TYPES`). Families whose
 * features arrive in later phases (inspections, progress escalations, offline sync) have no
 * database types yet and are listed as "coming".
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_DIGEST_OPTIONS,
  type NotificationEventType,
} from "@/lib/domain/schemas";

export type EmailDigest = (typeof EMAIL_DIGEST_OPTIONS)[number];

export interface CatalogEntry {
  type: string;
  label: string;
  description: string;
  inAppDefault: boolean;
  emailDefault: boolean;
}

export interface PrefRow {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

export interface PrefGroup {
  key: NotificationEventType;
  title: string;
  rows: PrefRow[];
}

export interface ResolvedPrefs {
  groups: PrefGroup[];
  emailDigest: EmailDigest;
  /** Spec families that have no notifications yet (later phases). */
  upcoming: string[];
}

/** Which spec family each database notification type belongs to. */
export const TYPE_FAMILY: Record<string, NotificationEventType> = {
  invitation_received: "invitations",
  invitation_accepted: "invitations",
  invitation_declined: "invitations",
  member_joined: "invitations",
  added_to_project: "invitations",
  project_budget_exceeded: "project_alerts",
  project_delayed: "project_alerts",
  project_status_changed: "project_alerts",
  removed_from_project: "membership_removed",
  removed_from_company: "membership_removed",
};

export const FAMILY_TITLES: Record<NotificationEventType, string> = {
  invitations: "Invitations and team",
  inspection_proposed: "Inspection proposed",
  inspection_decided: "Inspection approved, rejected or rescheduled",
  inspection_reschedule_requested: "Reschedule requested",
  inspection_reminder: "Inspection reminders",
  activity_escalated: "Activity Delayed or On-Hold",
  activity_completed: "Activity completed",
  project_alerts: "Project alerts",
  membership_removed: "Access changes",
  sync_conflicts: "Offline sync conflicts",
};

const FAMILY_ORDER: NotificationEventType[] = ["project_alerts", "invitations", "membership_removed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readEmailDigest(stored: unknown): EmailDigest {
  const value = isRecord(stored) ? stored.email_digest : undefined;
  return (EMAIL_DIGEST_OPTIONS as readonly unknown[]).includes(value) ? (value as EmailDigest) : DEFAULT_NOTIFICATION_PREFS.emailDigest;
}

/** Stored preferences + catalog → grouped rows with the effective on/off values. */
export function resolvePrefs(stored: unknown, catalog: readonly CatalogEntry[]): ResolvedPrefs {
  const prefs = isRecord(stored) ? stored : {};
  const byFamily = new Map<NotificationEventType, PrefRow[]>();
  for (const entry of catalog) {
    const family = TYPE_FAMILY[entry.type] ?? "project_alerts";
    const own = isRecord(prefs[entry.type]) ? (prefs[entry.type] as Record<string, unknown>) : {};
    const row: PrefRow = {
      type: entry.type,
      label: entry.label,
      description: entry.description,
      inApp: bool(own.in_app, entry.inAppDefault),
      email: bool(own.email, entry.emailDefault),
    };
    byFamily.set(family, [...(byFamily.get(family) ?? []), row]);
  }
  const used = new Set(byFamily.keys());
  const order = [...FAMILY_ORDER, ...[...used].filter((key) => !FAMILY_ORDER.includes(key))];
  const groups = order
    .filter((key) => byFamily.has(key))
    .map((key) => ({ key, title: FAMILY_TITLES[key], rows: byFamily.get(key) ?? [] }));
  const upcoming = (Object.keys(FAMILY_TITLES) as NotificationEventType[])
    .filter((key) => !used.has(key) && !Object.values(TYPE_FAMILY).includes(key))
    .map((key) => FAMILY_TITLES[key]);
  return { groups, emailDigest: readEmailDigest(stored), upcoming };
}

/** The `update_notification_prefs` payload for one changed row. */
export function prefPatch(type: string, channels: { inApp: boolean; email: boolean }): Record<string, { in_app: boolean; email: boolean }> {
  return { [type]: { in_app: channels.inApp, email: channels.email } };
}
