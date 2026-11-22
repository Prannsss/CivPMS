import "server-only";

/**
 * Baseline reads (spec §8.4; Stage A). Baselines are frozen copies of the plan: v1 is captured when
 * a project is activated. Read through RLS (anyone who can view the project).
 */
import { cache } from "react";
import type { ISODate } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface BaselineSummary {
  id: string;
  version: number;
  reason: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface BaselineActivity {
  /** Null when the activity was deleted after the baseline was captured. */
  activityId: string | null;
  isLeaf: boolean;
  level: number;
  wbsCode: string;
  name: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  hours: number;
  cost: number;
  weight: number;
}

function throwRead(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

function toNumber(value: number | string | null): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Every baseline of a project, newest version first. */
export const getBaselines = cache(async (projectId: string): Promise<BaselineSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("baselines")
    .select("id, version_no, reason, is_active, created_at")
    .eq("project_id", projectId)
    .order("version_no", { ascending: false });
  if (error) throwRead(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    version: row.version_no,
    reason: row.reason,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
});

/** The frozen rows of one baseline (parents and leaves). */
export const getBaselineActivities = cache(async (projectId: string, baselineId: string): Promise<BaselineActivity[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("baseline_activities")
    .select("activity_id, is_leaf, level, wbs_code, name, start_date, end_date, hours, cost, weight")
    .eq("project_id", projectId)
    .eq("baseline_id", baselineId)
    .limit(10000);
  if (error) throwRead(error);
  return (data ?? []).map((row) => ({
    activityId: row.activity_id,
    isLeaf: row.is_leaf,
    level: row.level,
    wbsCode: row.wbs_code,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    hours: toNumber(row.hours),
    cost: toNumber(row.cost),
    weight: toNumber(row.weight),
  }));
});
