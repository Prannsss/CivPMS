import "server-only";

/**
 * Project dashboard reads (spec §9.4): the WBS rolled up with the domain module (D23) so the
 * dashboard shows the same %, dates and Delayed flags as the WBS screen, plus what needs attention.
 * Also used by Project Settings to explain why "Complete project" is blocked (§5.2).
 */
import { cache } from "react";
import { summarizeWork, type WorkSummary } from "@/components/project-dashboard/work-summary";
import { todayInManila, type ActivityRecord, type ProgressWeighting } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type { DashboardActivity, MissingField, WorkSummary } from "@/components/project-dashboard/work-summary";

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

function num(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The project's WBS summarised for the dashboard and the status panel. */
export const getWorkSummary = cache(async (projectId: string, weighting: ProgressWeighting): Promise<WorkSummary> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, parent_id, sort_order, name, start_date, duration_hours, end_date, est_cost, status, percent, delayed_reported, version, wbs_code, level",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .limit(10_000);
  if (error) throwReadFailure(error);

  const records: ActivityRecord[] = (data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    name: row.name,
    startDate: row.start_date,
    durationHours: num(row.duration_hours),
    endDate: row.end_date,
    estCost: num(row.est_cost),
    status: row.status,
    percent: num(row.percent) ?? 0,
    delayedReported: row.delayed_reported,
    version: row.version,
    wbsCode: row.wbs_code,
    level: row.level,
  }));
  return summarizeWork(records, weighting, todayInManila());
});
