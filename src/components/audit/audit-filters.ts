/**
 * Audit Trail filters (spec §10.6): person, type, date range, escalations only and text search.
 * Pure (no React, no Supabase): the page, the "Load more" action, the CSV export route and the
 * client filter bar all parse and serialise the URL the same way.
 */
import { isValidISODate, type ISODate } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";

/** Filter groups. Entity groups and two action groups (status changes, deletions). */
export const AUDIT_TYPES = ["project", "activity", "calendar", "team", "status", "deletion"] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  project: "Project details",
  activity: "Work breakdown",
  calendar: "Calendar",
  team: "Team & invitations",
  status: "Status changes",
  deletion: "Deletions & restores",
};

/** Columns each type matches (entity types or actions). */
export const AUDIT_TYPE_MATCH: Record<AuditType, { entityTypes?: string[]; actions?: string[] }> = {
  project: { entityTypes: ["project"] },
  activity: { entityTypes: ["activity"] },
  calendar: { entityTypes: ["calendar", "calendar_date"] },
  team: { entityTypes: ["project_member", "invitation", "invite_code"] },
  status: { actions: ["status_change", "delayed"] },
  deletion: { actions: ["delete", "restore", "purge"] },
};

/** `person=system` selects entries written by the system (daily job, no actor). */
export const SYSTEM_ACTOR = "system";

export const AUDIT_SEARCH_MAX = 100;
export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  /** A user id, `system`, or null for everyone. */
  person: string | null;
  type: AuditType | null;
  /** Inclusive Manila calendar dates. */
  from: ISODate | null;
  to: ISODate | null;
  escalations: boolean;
  q: string | null;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  person: null,
  type: null,
  from: null,
  to: null,
  escalations: false,
  q: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string | null {
  if (source instanceof URLSearchParams) return source.get(key);
  const value = source[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isAuditType(value: string | null): value is AuditType {
  return value !== null && (AUDIT_TYPES as readonly string[]).includes(value);
}

/** Text search as typed, trimmed and capped; characters that would break the query are dropped. */
export function cleanSearch(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/["\\%*_(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AUDIT_SEARCH_MAX)
    .trim();
  return cleaned === "" ? null : cleaned;
}

/** Reads filters from URL search params. Unknown or invalid values are ignored, never trusted. */
export function parseAuditFilters(source: ParamSource): AuditFilters {
  const person = read(source, "person");
  const type = read(source, "type");
  let from = read(source, "from");
  let to = read(source, "to");
  if (!isValidISODate(from)) from = null;
  if (!isValidISODate(to)) to = null;
  if (from && to && from > to) [from, to] = [to, from];
  const escalations = read(source, "escalations");
  return {
    person: person === SYSTEM_ACTOR || (person !== null && UUID.test(person)) ? person.toLowerCase() : null,
    type: isAuditType(type) ? type : null,
    from,
    to,
    escalations: escalations === "1" || escalations === "true",
    q: cleanSearch(read(source, "q")),
  };
}

/** The URL query for a set of filters (only the active ones, in a stable order). */
export function auditFiltersToSearchParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.person) params.set("person", filters.person);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.escalations) params.set("escalations", "1");
  return params;
}

export function activeFilterCount(filters: AuditFilters): number {
  return (
    (filters.q ? 1 : 0) +
    (filters.person ? 1 : 0) +
    (filters.type ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.escalations ? 1 : 0)
  );
}

export function hasActiveFilters(filters: AuditFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Start of a Manila calendar day as an absolute timestamp (Manila is UTC+8, no DST). */
export function manilaDayStart(day: ISODate): string {
  return `${day}T00:00:00+08:00`;
}

/** Plain-language summary for the CSV header and empty states, e.g. "Escalations only · From 1 Oct 2026". */
export function describeAuditFilters(filters: AuditFilters, personName?: string | null): string {
  const parts: string[] = [];
  if (filters.person) parts.push(`Person: ${personName ?? (filters.person === SYSTEM_ACTOR ? "System" : "selected person")}`);
  if (filters.type) parts.push(`Type: ${AUDIT_TYPE_LABELS[filters.type]}`);
  if (filters.from && filters.to) parts.push(`${formatDate(filters.from)} – ${formatDate(filters.to)}`);
  else if (filters.from) parts.push(`From ${formatDate(filters.from)}`);
  else if (filters.to) parts.push(`Until ${formatDate(filters.to)}`);
  if (filters.escalations) parts.push("Escalations only");
  if (filters.q) parts.push(`Search: "${filters.q}"`);
  return parts.length > 0 ? parts.join(" · ") : "All entries";
}

// ---------------------------------------------------------------------------
// Keyset cursor: entries are ordered by (recorded_at desc, id desc).
// ---------------------------------------------------------------------------

export interface AuditCursor {
  recordedAt: string;
  id: number;
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return `${cursor.id}_${cursor.recordedAt}`;
}

export function decodeAuditCursor(value: string | null | undefined): AuditCursor | null {
  if (!value) return null;
  const match = /^(\d{1,18})_(\d{4}-\d{2}-\d{2}T[0-9:.+\-Z ]{8,40})$/.exec(value);
  if (!match) return null;
  const id = Number(match[1]);
  const recordedAt = match[2]!;
  if (!Number.isSafeInteger(id) || Number.isNaN(new Date(recordedAt).getTime())) return null;
  return { id, recordedAt };
}
