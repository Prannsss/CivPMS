/**
 * Display helpers for activity-log entries (spec §10.6). Pure: shared by the Audit Trail page,
 * the dashboard's "Recent activity" feed and the CSV export.
 */
import { addDays, diffDays, isValidISODate, parseISODate, todayInManila, type ISODate } from "@/lib/domain/dates";
import { formatDate, formatPeso } from "@/lib/domain/format";

const VIA_LABELS: Record<string, string> = {
  direct: "Direct update",
  invitation: "Email invitation",
  invite_code: "Invite code",
  company_removal: "Company removal",
  schedule: "Schedule change",
  calendar: "Calendar change",
  system: "System",
  cascade: "Cascade",
  inspection: "Inspection",
  offline_sync: "Offline sync",
  import: "Import",
};

/** "Direct update", "Invite code", … ; unknown values are shown cleaned. */
export function viaLabel(via: string | null | undefined): string {
  if (!via) return VIA_LABELS.direct!;
  return VIA_LABELS[via] ?? humanize(via);
}

const ENTITY_LABELS: Record<string, string> = {
  project: "Project",
  activity: "Activity",
  calendar: "Calendar",
  calendar_date: "Calendar date",
  project_member: "Team",
  invitation: "Invitation",
  invite_code: "Invite code",
  company: "Company",
  company_member: "Company member",
};

export function entityLabel(entityType: string | null | undefined): string {
  if (!entityType) return "Entry";
  return ENTITY_LABELS[entityType] ?? humanize(entityType);
}

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  rename: "Renamed",
  status_change: "Status changed",
  archive: "Archived",
  unarchive: "Unarchived",
  delete: "Deleted",
  restore: "Restored",
  move: "Moved",
  invite: "Invited",
  resend: "Invitation resent",
  accept: "Invitation accepted",
  decline: "Invitation declined",
  revoke: "Revoked",
  expire: "Expired",
  join: "Joined",
  remove: "Removed",
  delayed: "Became delayed",
  purge: "Purged",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "Change";
  return ACTION_LABELS[action] ?? humanize(action);
}

function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

export type EntryTone = "neutral" | "primary" | "success" | "warning" | "orange" | "danger" | "info";

/** Icon tone of an entry: escalations orange, deletions red, creations green, the rest neutral. */
export function entryTone(entry: { action: string; isEscalation: boolean }): EntryTone {
  if (entry.isEscalation) return "orange";
  if (entry.action === "delete" || entry.action === "remove" || entry.action === "revoke" || entry.action === "purge") {
    return "danger";
  }
  if (entry.action === "create" || entry.action === "join" || entry.action === "accept" || entry.action === "restore") {
    return "success";
  }
  if (entry.action === "status_change") return "primary";
  return "neutral";
}

/** Manila calendar day of a timestamp (`2026-10-12`). */
export function manilaDay(timestamp: string): ISODate {
  return todayInManila(new Date(timestamp));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Group heading: "Today", "Yesterday", or "Monday, 5 Oct 2026". */
export function dayHeading(day: ISODate, today: ISODate): string {
  if (!isValidISODate(day)) return "—";
  const delta = diffDays(today, day);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  return `${WEEKDAYS[parseISODate(day).getUTCDay()]}, ${formatDate(day)}`;
}

/** Groups items (already newest first) by Manila day, keeping the order. */
export function groupByDay<T extends { recordedAt: string }>(items: ReadonlyArray<T>): { day: ISODate; items: T[] }[] {
  const groups: { day: ISODate; items: T[] }[] = [];
  for (const item of items) {
    const day = manilaDay(item.recordedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** True when the observed time (offline capture) differs from the recorded time by a minute or more. */
export function observedDiffers(recordedAt: string, observedAt: string | null | undefined): boolean {
  if (!observedAt) return false;
  const a = new Date(recordedAt).getTime();
  const b = new Date(observedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) >= 60_000;
}

const MONEY_FIELDS = new Set(["budget", "est_cost", "cost", "allocated"]);
const DATE_FIELD = /(^|_)date$/;

/**
 * A logged old/new value as plain text for the CSV: pesos for money fields, `10 Oct 2026` for
 * dates, `85%` for percent, objects as `key: value` pairs.
 */
export function formatLogValue(field: string | null | undefined, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (field && MONEY_FIELDS.has(field)) return formatPeso(value);
    if (field === "percent") return `${value}%`;
    if (field === "near_budget_threshold") return `${Math.round(value * 100)}%`;
    return String(value);
  }
  if (typeof value === "string") {
    if (field && DATE_FIELD.test(field) && isValidISODate(value)) return formatDate(value);
    if (field && MONEY_FIELDS.has(field) && value.trim() !== "" && Number.isFinite(Number(value))) {
      return formatPeso(Number(value));
    }
    return value;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => formatLogValue(field, item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([key, v]) => `${humanize(key)}: ${formatLogValue(key, v)}`)
      .join("; ");
  }
  return String(value);
}

/** Next calendar day (exclusive upper bound of a date filter). */
export function nextDay(day: ISODate): ISODate {
  return addDays(day, 1);
}
