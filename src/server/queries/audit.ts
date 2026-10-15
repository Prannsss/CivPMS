import "server-only";

/**
 * Audit Trail reads (spec §10.6): the project's append-only activity log, newest first, with the
 * page filters and keyset pagination on (recorded_at desc, id desc). RLS decides visibility:
 * project-scoped rows are readable by everyone who can view the project.
 */
import { cache } from "react";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_TYPE_MATCH,
  SYSTEM_ACTOR,
  manilaDayStart,
  type AuditCursor,
  type AuditFilters,
} from "@/components/audit/audit-filters";
import { nextDay } from "@/components/audit/audit-format";
import { AppException, toAppError } from "@/lib/errors";
import type { Json } from "@/lib/supabase/database.types";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";

export interface AuditEntry {
  id: number;
  recordedAt: string;
  observedAt: string | null;
  actorId: string | null;
  actorName: string;
  actorAvatarUrl: string | null;
  entityType: string;
  action: string;
  field: string | null;
  summary: string;
  note: string | null;
  via: string;
  wbsCode: string | null;
  activityName: string | null;
  activityId: string | null;
  isEscalation: boolean;
  oldValue: Json | null;
  newValue: Json | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass back to load the next page; null when this is the last page. */
  nextCursor: AuditCursor | null;
  /** Total matching entries (first page only). */
  total: number | null;
}

export interface AuditActor {
  /** User id, or `system`. */
  id: string;
  name: string;
}

export const AUDIT_COLUMNS =
  "id, recorded_at, observed_at, actor_id, actor_name, entity_type, action, field, summary, note, via, wbs_code, activity_name, activity_id, is_escalation, old_value, new_value, actor:profiles!activity_logs_actor_id_fkey(avatar_url, full_name)";

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

type AuditRow = {
  id: number;
  recorded_at: string;
  observed_at: string | null;
  actor_id: string | null;
  actor_name: string | null;
  entity_type: string;
  action: string;
  field: string | null;
  summary: string | null;
  note: string | null;
  via: string;
  wbs_code: string | null;
  activity_name: string | null;
  activity_id: string | null;
  is_escalation: boolean;
  old_value: Json | null;
  new_value: Json | null;
  actor: { avatar_url: string | null; full_name: string | null } | null;
};

export function toAuditEntry(row: AuditRow): AuditEntry {
  const actorName = row.actor_name?.trim() || row.actor?.full_name?.trim() || (row.actor_id ? "Former member" : "System");
  return {
    id: row.id,
    recordedAt: row.recorded_at,
    observedAt: row.observed_at,
    actorId: row.actor_id,
    actorName,
    actorAvatarUrl: row.actor?.avatar_url ?? null,
    entityType: row.entity_type,
    action: row.action,
    field: row.field,
    summary: row.summary?.trim() || "Change recorded",
    note: row.note,
    via: row.via,
    wbsCode: row.wbs_code,
    activityName: row.activity_name,
    activityId: row.activity_id,
    isEscalation: row.is_escalation,
    oldValue: row.old_value,
    newValue: row.new_value,
  };
}

/** Quotes a value for PostgREST's `or=(…)` grammar (commas, parentheses and colons stay literal). */
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}

/**
 * One page of entries. Shared by the page, the "Load more" action and the CSV export.
 * `limit` rows are returned; one extra is read to know whether more exist.
 */
export async function fetchAuditEntries(
  supabase: ServerSupabaseClient,
  projectId: string,
  filters: AuditFilters,
  options: { cursor?: AuditCursor | null; limit?: number; withCount?: boolean } = {},
): Promise<AuditPage> {
  const limit = Math.max(1, Math.min(options.limit ?? AUDIT_PAGE_SIZE, 1000));
  let query = supabase
    .from("activity_logs")
    .select(AUDIT_COLUMNS, options.withCount ? { count: "exact" } : undefined)
    .eq("project_id", projectId);

  if (filters.person === SYSTEM_ACTOR) query = query.is("actor_id", null);
  else if (filters.person) query = query.eq("actor_id", filters.person);

  if (filters.type) {
    const match = AUDIT_TYPE_MATCH[filters.type];
    if (match.entityTypes) query = query.in("entity_type", match.entityTypes);
    if (match.actions) query = query.in("action", match.actions);
  }
  if (filters.from) query = query.gte("recorded_at", manilaDayStart(filters.from));
  if (filters.to) query = query.lt("recorded_at", manilaDayStart(nextDay(filters.to)));
  if (filters.escalations) query = query.eq("is_escalation", true);
  if (filters.q) {
    const like = quoted(`*${filters.q}*`);
    query = query.or(
      [
        `summary.ilike.${like}`,
        `activity_name.ilike.${like}`,
        `wbs_code.ilike.${quoted(`${filters.q}*`)}`,
        `actor_name.ilike.${like}`,
        `note.ilike.${like}`,
      ].join(","),
    );
  }
  if (options.cursor) {
    const ts = quoted(options.cursor.recordedAt);
    query = query.or(`recorded_at.lt.${ts},and(recorded_at.eq.${ts},id.lt.${options.cursor.id})`);
  }

  const { data, error, count } = await query
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throwReadFailure(error);

  const rows = (data ?? []) as unknown as AuditRow[];
  const entries = rows.slice(0, limit).map(toAuditEntry);
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: rows.length > limit && last ? { recordedAt: last.recordedAt, id: last.id } : null,
    total: options.withCount ? (count ?? null) : null,
  };
}

/** First page for the Audit Trail page (with the total count). */
export const getAuditPage = cache(async (projectId: string, filters: AuditFilters): Promise<AuditPage> => {
  const supabase = await createClient();
  return fetchAuditEntries(supabase, projectId, filters, { withCount: true });
});

/** People who appear in the log (for the person filter), most recent first, plus System. */
export const getAuditActors = cache(async (projectId: string): Promise<AuditActor[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_logs")
    .select("actor_id, actor_name")
    .eq("project_id", projectId)
    .order("recorded_at", { ascending: false })
    .limit(2000);
  if (error) throwReadFailure(error);

  const seen = new Map<string, AuditActor>();
  for (const row of data ?? []) {
    const id = row.actor_id ?? SYSTEM_ACTOR;
    if (seen.has(id)) continue;
    seen.set(id, { id, name: row.actor_id ? row.actor_name?.trim() || "Former member" : "System" });
  }
  return [...seen.values()].sort((a, b) => {
    if (a.id === SYSTEM_ACTOR) return 1;
    if (b.id === SYSTEM_ACTOR) return -1;
    return a.name.localeCompare(b.name, "en");
  });
});

/** The most recent entries (dashboard "Recent activity"). */
export const getRecentProjectActivity = cache(async (projectId: string, limit = 8): Promise<AuditEntry[]> => {
  const supabase = await createClient();
  const page = await fetchAuditEntries(supabase, projectId, {
    person: null,
    type: null,
    from: null,
    to: null,
    escalations: false,
    q: null,
  }, { limit });
  return page.entries;
});
