import "server-only";

/**
 * Reads for the projects home ("/", mockups 6–7, spec §4.2–4.3, §5.1–5.3). Everything runs as the
 * signed-in user, so RLS on `project_overview` decides which projects are visible (Owner PM: every
 * company project; PMs and inspectors: only the projects they are on) and `project_trash()` returns
 * rows to the Owner PM only.
 */
import { cache } from "react";
import { PROJECT_COLOR_KEYS, type ProjectColorKey } from "@/lib/constants";
import type { CompanyRole, ProjectRole } from "@/lib/domain/permissions";
import type { BudgetState, ProjectStatus } from "@/lib/domain/project";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/** One card on the projects home. Serializable (passed to client components). */
export interface HomeProject {
  id: string;
  name: string;
  color: ProjectColorKey;
  status: ProjectStatus;
  siteName: string | null;
  startDate: string;
  endDate: string;
  /** Weighted % complete over leaf activities (0 without activities). */
  percentComplete: number;
  leafCount: number;
  budget: number;
  allocated: number;
  isDelayed: boolean;
  budgetState: BudgetState;
  isArchived: boolean;
  updatedAt: string;
  myCompanyRole: CompanyRole | null;
  myProjectRole: ProjectRole | null;
}

/** A soft-deleted project in the Owner PM's "Recently deleted" list (restorable for 30 days). */
export interface TrashedProject {
  id: string;
  name: string;
  color: ProjectColorKey;
  status: ProjectStatus;
  deletedAt: string;
  deletedByName: string | null;
  restoreUntil: string;
  /** Another live project already uses this name: restoring would fail with PROJECT_NAME_TAKEN. */
  nameConflict: boolean;
}

/** Upper bound for one company's visible projects on the home grid. */
export const HOME_PROJECT_LIMIT = 500;

const HOME_COLUMNS =
  "id, name, color, status, site_name, start_date, end_date, percent_complete, leaf_count, budget, allocated, is_delayed, budget_state, is_archived, updated_at, my_company_role, my_project_role";

function readFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

export function toColorKey(value: unknown): ProjectColorKey {
  return typeof value === "string" && (PROJECT_COLOR_KEYS as readonly string[]).includes(value)
    ? (value as ProjectColorKey)
    : "blue";
}

function toBudgetState(value: unknown): BudgetState {
  return value === "near" || value === "exceeded" ? value : "ok";
}

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Every visible, non-deleted project (archived ones included, the page filters them), most
 * recently updated first.
 */
export const getHomeProjects = cache(async (): Promise<HomeProject[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_overview")
    .select(HOME_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(HOME_PROJECT_LIMIT);
  if (error) readFailure(error);

  const projects: HomeProject[] = [];
  for (const row of data ?? []) {
    if (!row.id || !row.name || !row.status || !row.start_date || !row.end_date) continue;
    projects.push({
      id: row.id,
      name: row.name,
      color: toColorKey(row.color),
      status: row.status,
      siteName: row.site_name,
      startDate: row.start_date,
      endDate: row.end_date,
      percentComplete: toNumber(row.percent_complete),
      leafCount: toNumber(row.leaf_count),
      budget: toNumber(row.budget),
      allocated: toNumber(row.allocated),
      isDelayed: row.is_delayed === true,
      budgetState: toBudgetState(row.budget_state),
      isArchived: row.is_archived === true,
      updatedAt: row.updated_at ?? "",
      myCompanyRole: row.my_company_role,
      myProjectRole: row.my_project_role,
    });
  }
  return projects;
});

/** The Owner PM's trash (deleted ≤ 30 days ago). Other roles get an empty list from the RPC. */
export const getProjectTrash = cache(async (): Promise<TrashedProject[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_trash");
  if (error) readFailure(error);
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      color: toColorKey(row.color),
      status: row.status,
      deletedAt: row.deleted_at,
      deletedByName: row.deleted_by_name || null,
      restoreUntil: row.restore_until,
      nameConflict: row.name_conflict === true,
    }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
});
