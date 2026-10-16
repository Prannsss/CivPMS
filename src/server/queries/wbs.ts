import "server-only";

/**
 * Work breakdown reads (spec §6, §9.3). Activities come through RLS (soft-deleted rows are hidden
 * from everyone); the trash comes from `activity_trash()`, which only managers may call.
 */
import { cache } from "react";
import type { ActivityRecord } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"];

/** An activity as the WBS screens use it: the domain record plus its stored code and level. */
export interface WbsActivity extends ActivityRecord {
  description: string | null;
  wbsCode: string;
  level: number;
}

export interface TrashItem {
  batchId: string;
  activityId: string;
  wbsCode: string;
  name: string;
  level: number;
  total: number;
  subDeliverables: number;
  workPackages: number;
  deletedAt: string;
  deletedByName: string | null;
  restoreUntil: string;
  parentDeleted: boolean;
}

export const ACTIVITY_COLUMNS =
  "id, parent_id, sort_order, name, description, start_date, duration_hours, end_date, est_cost, status, percent, delayed_reported, version, wbs_code, level" as const;

type ActivitySelect = Pick<
  ActivityRow,
  | "id"
  | "parent_id"
  | "sort_order"
  | "name"
  | "description"
  | "start_date"
  | "duration_hours"
  | "end_date"
  | "est_cost"
  | "status"
  | "percent"
  | "delayed_reported"
  | "version"
  | "wbs_code"
  | "level"
>;

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toWbsActivity(row: ActivitySelect): WbsActivity {
  return {
    id: row.id,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    durationHours: toNumberOrNull(row.duration_hours),
    endDate: row.end_date,
    estCost: toNumberOrNull(row.est_cost),
    status: row.status,
    percent: Number(row.percent) || 0,
    delayedReported: row.delayed_reported,
    version: row.version,
    wbsCode: row.wbs_code,
    level: row.level,
  };
}

function throwRead(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

/** Non-deleted activities of a project in WBS order. */
export async function fetchActivities(supabase: ServerSupabaseClient, projectId: string): Promise<WbsActivity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("level", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(5000);
  if (error) throwRead(error);
  return (data ?? []).map(toWbsActivity);
}

export const getWbsActivities = cache(async (projectId: string): Promise<WbsActivity[]> => {
  const supabase = await createClient();
  return fetchActivities(supabase, projectId);
});

/** "Recently deleted" (≤ 30 days). Managers only: callers without manage rights get an empty list. */
export const getActivityTrash = cache(async (projectId: string): Promise<TrashItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activity_trash", { p_project_id: projectId });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "FORBIDDEN" || appError.code === "NOT_FOUND") return [];
    throw new AppException(appError.code, appError.message, { cause: error });
  }
  return (data ?? []).map((row) => ({
    batchId: row.batch_id,
    activityId: row.activity_id,
    wbsCode: row.wbs_code,
    name: row.name,
    level: row.level,
    total: row.total,
    subDeliverables: row.sub_deliverables,
    workPackages: row.work_packages,
    deletedAt: row.deleted_at,
    deletedByName: row.deleted_by_name,
    restoreUntil: row.restore_until,
    parentDeleted: row.parent_deleted,
  }));
});

/**
 * Why a project's plan (WBS + calendar) can't change right now, or null when it can.
 * The database allows WBS and calendar edits on closed projects (CLAUDE.md pitfalls), so every
 * WBS / calendar Server Action checks this before calling an RPC.
 */
export type PlanLock =
  | { code: "NOT_FOUND"; message: string }
  | { code: "FORBIDDEN"; message: string };

export async function planLockFor(supabase: ServerSupabaseClient, projectId: string): Promise<PlanLock | null> {
  const { data, error } = await supabase.from("projects").select("status").eq("id", projectId).maybeSingle();
  if (error) throwRead(error);
  if (!data) {
    return { code: "NOT_FOUND", message: "We couldn't find this project. It may have been deleted, or you may no longer have access." };
  }
  if (data.status === "completed") {
    return {
      code: "FORBIDDEN",
      message: "This project is completed, so its plan is locked. Reopen it from Project settings to make changes.",
    };
  }
  if (data.status === "cancelled") {
    return { code: "FORBIDDEN", message: "This project is cancelled, so its plan can't be changed." };
  }
  return null;
}

/** True when the (non-deleted) activity belongs to the project. */
export async function activityInProject(
  supabase: ServerSupabaseClient,
  projectId: string,
  activityId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("activities")
    .select("id")
    .eq("id", activityId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throwRead(error);
  return data !== null;
}
