/**
 * Project status machine (spec §5.2), derived badges (§5.3, §5.4) and budget allocation (§6.4).
 */
import { NEAR_BUDGET_THRESHOLD } from "@/lib/constants";
import { diffDays, type ISODate } from "./dates";
import { pluralize } from "./format";
import { roundMoney, toCents } from "./money";
import { projectPermissions, type CompanyRole, type ProjectRole } from "./permissions";

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On-Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status];
}

/** Planning, Active and On-Hold are "open"; Completed and Cancelled are closed (archivable, A8). */
export function isOpenProjectStatus(status: ProjectStatus): boolean {
  return status === "planning" || status === "active" || status === "on_hold";
}

/** Archive is a flag available on Completed/Cancelled projects only (§5.2, A8). */
export function canArchiveProjectStatus(status: ProjectStatus): boolean {
  return !isOpenProjectStatus(status);
}

/** Statuses that need a reason when entered (§5.2). */
export function projectStatusRequiresReason(to: ProjectStatus): boolean {
  return to === "on_hold" || to === "cancelled";
}

export interface ProjectTransitionContext {
  companyRole: CompanyRole | null | undefined;
  projectRole: ProjectRole | null | undefined;
  /** Activities at all levels (not deleted). */
  activityCount: number;
  /** Activities at all levels that are not Completed. */
  incompleteCount: number;
}

export interface ProjectTransition {
  to: ProjectStatus;
  allowed: boolean;
  requiresReason: boolean;
  /** Cancelling asks for confirmation (§5.2). */
  requiresConfirmation: boolean;
  /** Planning → Active captures Baseline v1 (§8.4). */
  capturesBaseline: boolean;
  /** Plain-language explanation when not allowed. */
  blockedReason?: string;
}

/** The status graph of §5.2, independent of who is asking. */
const TARGETS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "completed", "cancelled"],
  completed: ["active"],
  cancelled: [],
};

/**
 * Every transition out of `from` per §5.2, each marked allowed or blocked with a reason:
 * PMs (project PM or Owner PM) change status; only the Owner PM cancels; Completed needs ≥ 1
 * activity and none incomplete; Completed → Active reopens.
 */
export function projectTransitions(from: ProjectStatus, ctx: ProjectTransitionContext): ProjectTransition[] {
  const perms = projectPermissions({ companyRole: ctx.companyRole, projectRole: ctx.projectRole });
  return TARGETS[from].map((to) => {
    const transition: ProjectTransition = {
      to,
      allowed: true,
      requiresReason: projectStatusRequiresReason(to),
      requiresConfirmation: to === "cancelled",
      capturesBaseline: from === "planning" && to === "active",
    };
    const blockedReason = blockReason(to, ctx, perms.canChangeStatus, perms.canCancel);
    if (blockedReason) {
      transition.allowed = false;
      transition.blockedReason = blockedReason;
    }
    return transition;
  });
}

function blockReason(
  to: ProjectStatus,
  ctx: ProjectTransitionContext,
  canChangeStatus: boolean,
  canCancel: boolean,
): string | null {
  if (to === "cancelled") {
    return canCancel ? null : "Only the Owner PM can cancel a project.";
  }
  if (!canChangeStatus) return "Only project managers on this project can change its status.";
  if (to === "completed") {
    if (ctx.activityCount < 1) return "Add at least one activity before completing the project.";
    if (ctx.incompleteCount > 0) {
      const verb = ctx.incompleteCount === 1 ? "is" : "are";
      return `${pluralize(ctx.incompleteCount, "activity", "activities")} ${verb} not completed yet. Complete them before completing the project.`;
    }
  }
  return null;
}

/** The transition from `from` to `to`, or null when the status graph has no such edge. */
export function findProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  ctx: ProjectTransitionContext,
): ProjectTransition | null {
  return projectTransitions(from, ctx).find((t) => t.to === to) ?? null;
}

export type BudgetState = "ok" | "near" | "exceeded";

export interface BudgetAllocation {
  budget: number;
  allocated: number;
  /** budget − allocated (negative when exceeded). */
  remaining: number;
  /** allocated ÷ budget; Infinity when the budget is 0 and something is allocated. */
  ratio: number;
  state: BudgetState;
}

/**
 * Allocation bar data (§6.4) and budget state (§5.3): 'near' when allocated ≥ threshold × budget
 * and ≤ budget; 'exceeded' when allocated > budget; otherwise 'ok'. Compared in centavos.
 */
export function budgetAllocation(
  budget: number,
  allocated: number,
  threshold: number = NEAR_BUDGET_THRESHOLD,
): BudgetAllocation {
  const budgetCents = toCents(budget);
  const allocatedCents = toCents(allocated);
  const remaining = roundMoney((budgetCents - allocatedCents) / 100);
  let ratio: number;
  if (budgetCents > 0) ratio = allocatedCents / budgetCents;
  else ratio = allocatedCents > 0 ? Number.POSITIVE_INFINITY : 0;

  let state: BudgetState = "ok";
  if (allocatedCents > budgetCents) state = "exceeded";
  else if (budgetCents > 0 && allocatedCents >= threshold * budgetCents - 1e-6) state = "near";

  return { budget: budgetCents / 100, allocated: allocatedCents / 100, remaining, ratio, state };
}

/** Delayed project (§5.3): today (Asia/Manila) is after the end date and status is not Completed/Cancelled. */
export function isProjectDelayed(input: {
  status: ProjectStatus;
  endDate: ISODate | null | undefined;
  today: ISODate;
}): boolean {
  const { status, endDate, today } = input;
  if (status === "completed" || status === "cancelled" || !endDate) return false;
  return today > endDate;
}

export interface ProjectBadges {
  delayed: boolean;
  budgetState: BudgetState;
  /** Days past the end date while Delayed; 0 otherwise. */
  overdueDays: number;
}

/** All derived badges for a project card/header (§5.3, §5.4). */
export function projectBadges(input: {
  status: ProjectStatus;
  endDate: ISODate | null | undefined;
  budget: number;
  allocated: number;
  today: ISODate;
  threshold?: number;
}): ProjectBadges {
  const delayed = isProjectDelayed(input);
  return {
    delayed,
    budgetState: budgetAllocation(input.budget, input.allocated, input.threshold).state,
    overdueDays: delayed && input.endDate ? diffDays(input.today, input.endDate) : 0,
  };
}
