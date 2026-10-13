import "server-only";

/**
 * Request-scoped session and project access, memoised per request with React `cache()`.
 *
 * - `getSessionContext()`: who is signed in, their profile and company membership.
 * - `requireUser()` / `requireOnboarded()`: redirect to /login or /onboarding when needed.
 * - `getProjectAccess(projectId)`: the project's overview row plus the caller's roles and UI
 *   permission flags, or `notFound()` when it does not exist or is not visible to them.
 *
 * Reads run as the signed-in user, so RLS decides what is visible. Permission flags only drive
 * the UI; the database enforces access (CLAUDE.md data-access rule 4).
 */
import { redirect, notFound } from "next/navigation";
import { cache } from "react";
import {
  projectPermissions,
  type CompanyRole,
  type ProjectPermissions,
  type ProjectRole,
} from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { LOGIN_PATH, ONBOARDING_PATH } from "@/lib/auth-routes";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type PublicSchema = Database["public"];
export type Profile = PublicSchema["Tables"]["profiles"]["Row"];
type OverviewRow = PublicSchema["Views"]["project_overview"]["Row"];

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface CompanyMembership {
  companyId: string;
  companyName: string;
  role: CompanyRole;
}

export interface SessionContext {
  user: SessionUser | null;
  profile: Profile | null;
  membership: CompanyMembership | null;
  /** Signed in but onboarding is not finished (`profiles.onboarded_at` is null). */
  needsOnboarding: boolean;
}

export interface AuthedContext extends SessionContext {
  user: SessionUser;
}

export interface OnboardedContext extends SessionContext {
  user: SessionUser;
  profile: Profile;
  needsOnboarding: false;
}

/**
 * Throws a read failure to the nearest error boundary as an `AppException` with a safe message:
 * NETWORK when Supabase is unreachable, otherwise UNEXPECTED (logged with a reference id).
 */
function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

const EMPTY_CONTEXT: SessionContext = { user: null, profile: null, membership: null, needsOnboarding: false };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * The signed-in user (verified JWT claims), their profile and company membership. Never throws
 * for "not signed in"; database failures throw an `AppException` for the error boundary.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsError ? null : claimsData?.claims;
  const userId = typeof claims?.sub === "string" && claims.sub ? claims.sub : null;
  if (!userId) return EMPTY_CONTEXT;

  const user: SessionUser = {
    id: userId,
    email: typeof claims?.email === "string" && claims.email ? claims.email : null,
  };

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase
      .from("company_members")
      .select("company_id, role, companies(name)")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profileResult.error) throwReadFailure(profileResult.error);
  if (membershipResult.error) throwReadFailure(membershipResult.error);

  const profile = profileResult.data;
  const member = membershipResult.data;
  const membership: CompanyMembership | null = member
    ? {
        companyId: member.company_id,
        companyName: member.companies?.name ?? "",
        role: member.role,
      }
    : null;

  return {
    user,
    profile,
    membership,
    needsOnboarding: !profile || profile.onboarded_at === null,
  };
});

/** The session context with a user, or a redirect to /login. */
export async function requireUser(): Promise<AuthedContext> {
  const context = await getSessionContext();
  if (!context.user) redirect(LOGIN_PATH);
  return { ...context, user: context.user };
}

/** The session context of an onboarded user; redirects to /login or /onboarding otherwise. */
export async function requireOnboarded(): Promise<OnboardedContext> {
  const context = await requireUser();
  if (context.needsOnboarding || !context.profile) redirect(ONBOARDING_PATH);
  return { ...context, profile: context.profile, needsOnboarding: false };
}

// ---------------------------------------------------------------------------
// Project access
// ---------------------------------------------------------------------------

type NonNullFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };

/** Columns of `project_overview` that are NOT NULL in the underlying tables/aggregates. */
type RequiredOverviewColumn =
  | "id"
  | "company_id"
  | "name"
  | "start_date"
  | "end_date"
  | "budget"
  | "status"
  | "is_archived"
  | "weighting"
  | "near_budget_threshold"
  | "color"
  | "version"
  | "created_at"
  | "updated_at"
  | "allocated"
  | "remaining"
  | "leaf_count"
  | "activity_count"
  | "completed_count"
  | "percent_complete"
  | "is_delayed"
  | "unscheduled_count";

export type BudgetState = "ok" | "near" | "exceeded";

/** A `project_overview` row with the view's nullable typing narrowed to the real constraints. */
export type ProjectOverview = NonNullFields<OverviewRow, RequiredOverviewColumn> & {
  budget_state: BudgetState;
};

const REQUIRED_OVERVIEW_COLUMNS: RequiredOverviewColumn[] = [
  "id",
  "company_id",
  "name",
  "start_date",
  "end_date",
  "budget",
  "status",
  "is_archived",
  "weighting",
  "near_budget_threshold",
  "color",
  "version",
  "created_at",
  "updated_at",
  "allocated",
  "remaining",
  "leaf_count",
  "activity_count",
  "completed_count",
  "percent_complete",
  "is_delayed",
  "unscheduled_count",
];

function isBudgetState(value: unknown): value is BudgetState {
  return value === "ok" || value === "near" || value === "exceeded";
}

/**
 * Narrows a `project_overview` row. Returns null if a column that can never be null is missing
 * (e.g. the select did not include it). Reusable by `src/server/queries/*`.
 */
export function toProjectOverview(row: OverviewRow | null | undefined): ProjectOverview | null {
  if (!row) return null;
  for (const column of REQUIRED_OVERVIEW_COLUMNS) {
    if (row[column] === null || row[column] === undefined) return null;
  }
  if (!isBudgetState(row.budget_state)) return null;
  return row as ProjectOverview;
}

export interface ProjectAccess {
  project: ProjectOverview;
  companyRole: CompanyRole | null;
  projectRole: ProjectRole | null;
  permissions: ProjectPermissions;
}

/**
 * The project (from `project_overview`) and what the caller may do with it. Calls `notFound()`
 * for invalid ids and for projects that do not exist, were deleted, or are not visible to the
 * caller (RLS hides them). Redirects to /login without a session.
 */
export const getProjectAccess = cache(async (projectId: string): Promise<ProjectAccess> => {
  if (!isUuid(projectId)) notFound();
  await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase.from("project_overview").select("*").eq("id", projectId).maybeSingle();
  if (error) throwReadFailure(error);

  const project = toProjectOverview(data);
  if (!project) notFound();

  const companyRole = project.my_company_role;
  const projectRole = project.my_project_role;
  return {
    project,
    companyRole,
    projectRole,
    permissions: projectPermissions({ companyRole, projectRole }),
  };
});
