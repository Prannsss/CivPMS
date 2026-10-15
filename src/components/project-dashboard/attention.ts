/**
 * "Needs attention" for the project dashboard (spec §9.4, §5.3, §5.4, §10.5): what is late,
 * over budget or not planned yet, loudest first. Pure: the dashboard renders the items.
 */
import { budgetAllocation, diffDays, formatDate, formatPeso, formatPercent, pluralize, type ISODate } from "@/lib/domain";
import type { DashboardActivity, MissingField, WorkSummary } from "./work-summary";

export type AttentionTone = "danger" | "warning" | "neutral" | "primary";

export type AttentionKind =
  | "project_overdue"
  | "projected_late"
  | "budget_exceeded"
  | "budget_near"
  | "delayed_activity"
  | "delayed_more"
  | "unscheduled_activity"
  | "unscheduled_more"
  | "empty_wbs";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  tone: AttentionTone;
  title: string;
  detail: string;
  /** Where to fix it (WBS row, settings), or null when there's nothing to click. */
  href: string | null;
  /** WBS code shown before the title for activity items. */
  wbsCode?: string;
}

export interface AttentionProject {
  id: string;
  status: string;
  endDate: ISODate;
  budget: number;
  allocated: number;
  nearBudgetThreshold: number;
  isDelayed: boolean;
}

export const MAX_ACTIVITY_ITEMS = 4;

/** The WBS screen, optionally focused on one activity (`?activity=<id>`). */
export function wbsHref(projectId: string, activityId?: string): string {
  return activityId ? `/projects/${projectId}/wbs?activity=${activityId}` : `/projects/${projectId}/wbs`;
}

const MISSING_LABELS: Record<MissingField, string> = { start: "start date", duration: "duration", cost: "cost" };

function joinList(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Missing start date and cost." */
export function missingText(missing: ReadonlyArray<MissingField>): string {
  const words = missing.map((field) => MISSING_LABELS[field]);
  const text = joinList(words);
  return text ? `Missing ${text}.` : "";
}

/** "Planned end passed 13 days ago" / "Planned start passed 2 days ago, not started yet" / "Reported as delayed". */
export function delayText(activity: Pick<DashboardActivity, "derived" | "reportedDelayed" | "endDate" | "startDate">): string {
  const parts: string[] = [];
  if (activity.derived?.reason === "END_PASSED") {
    parts.push(`Planned end (${formatDate(activity.endDate)}) passed ${pluralize(activity.derived.days, "day")} ago`);
  } else if (activity.derived?.reason === "START_PASSED") {
    parts.push(`Should have started ${pluralize(activity.derived.days, "day")} ago (${formatDate(activity.startDate)})`);
  }
  if (activity.reportedDelayed) parts.push(parts.length ? "also reported as delayed" : "Reported as delayed");
  return parts.length ? `${parts.join(", ")}.` : "Running late.";
}

export function buildAttentionItems(input: {
  project: AttentionProject;
  work: WorkSummary;
  canManage: boolean;
}): AttentionItem[] {
  const { project, work, canManage } = input;
  const items: AttentionItem[] = [];
  const settingsHref = canManage ? `/projects/${project.id}/settings` : null;
  const closed = project.status === "completed" || project.status === "cancelled";

  if (project.isDelayed) {
    const days = Math.max(1, diffDays(work.today, project.endDate));
    items.push({
      id: "project-overdue",
      kind: "project_overdue",
      tone: "danger",
      title: `${pluralize(days, "day")} past the planned end date`,
      detail: `The project was planned to finish on ${formatDate(project.endDate)}. ${
        canManage ? "Complete the remaining work, or move the end date if the plan changed." : "Ask a PM whether the plan changed."
      }`,
      href: settingsHref,
    });
  }

  if (!closed && work.scheduleEnd && work.scheduleEnd > project.endDate) {
    const days = diffDays(work.scheduleEnd, project.endDate);
    items.push({
      id: "projected-late",
      kind: "projected_late",
      tone: "warning",
      title: `Scheduled work ends ${pluralize(days, "day")} after the project end date`,
      detail: `The last work package ends on ${formatDate(work.scheduleEnd)}; the project ends on ${formatDate(project.endDate)}.`,
      href: wbsHref(project.id),
    });
  }

  const budget = budgetAllocation(project.budget, project.allocated, project.nearBudgetThreshold);
  if (budget.state === "exceeded") {
    items.push({
      id: "budget-exceeded",
      kind: "budget_exceeded",
      tone: "danger",
      title: `Over budget by ${formatPeso(-budget.remaining)}`,
      detail: `Work packages add up to ${formatPeso(budget.allocated)} against a budget of ${formatPeso(budget.budget)}. Reduce costs or raise the budget.`,
      href: settingsHref ?? wbsHref(project.id),
    });
  } else if (budget.state === "near") {
    items.push({
      id: "budget-near",
      kind: "budget_near",
      tone: "warning",
      title: `${formatPercent(budget.ratio * 100)} of the budget is allocated`,
      detail: `${formatPeso(budget.remaining)} left before the budget of ${formatPeso(budget.budget)} is used up.`,
      href: wbsHref(project.id),
    });
  }

  for (const activity of work.delayed.slice(0, MAX_ACTIVITY_ITEMS)) {
    items.push({
      id: `delayed-${activity.id}`,
      kind: "delayed_activity",
      tone: "danger",
      wbsCode: activity.wbsCode,
      title: activity.name,
      detail: delayText(activity),
      href: wbsHref(project.id, activity.id),
    });
  }
  if (work.delayed.length > MAX_ACTIVITY_ITEMS) {
    const more = work.delayed.length - MAX_ACTIVITY_ITEMS;
    items.push({
      id: "delayed-more",
      kind: "delayed_more",
      tone: "danger",
      title: `${pluralize(more, "more delayed work package", "more delayed work packages")}`,
      detail: "Open the work breakdown and filter by Delayed to see them all.",
      href: wbsHref(project.id),
    });
  }

  if (work.activityCount === 0) {
    items.push({
      id: "empty-wbs",
      kind: "empty_wbs",
      tone: "primary",
      title: "No work breakdown yet",
      detail: canManage
        ? "Add deliverables and work packages with dates and costs. Progress, budget and delays are tracked from them."
        : "A PM hasn't added the work breakdown yet. Progress and delays appear here once they do.",
      href: wbsHref(project.id),
    });
  } else if (!closed) {
    const shown = work.unscheduled.length > MAX_ACTIVITY_ITEMS ? MAX_ACTIVITY_ITEMS - 1 : work.unscheduled.length;
    for (const activity of work.unscheduled.slice(0, shown)) {
      items.push({
        id: `unscheduled-${activity.id}`,
        kind: "unscheduled_activity",
        tone: "neutral",
        wbsCode: activity.wbsCode,
        title: activity.name,
        detail: missingText(activity.missing),
        href: wbsHref(project.id, activity.id),
      });
    }
    if (work.unscheduled.length > shown) {
      const more = work.unscheduled.length - shown;
      items.push({
        id: "unscheduled-more",
        kind: "unscheduled_more",
        tone: "neutral",
        title: `${pluralize(more, "more work package", "more work packages")} without dates or cost`,
        detail: "Unscheduled work doesn't count toward the schedule or the budget yet.",
        href: wbsHref(project.id),
      });
    }
  }

  return items;
}
