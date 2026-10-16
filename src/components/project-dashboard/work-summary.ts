/**
 * The project's WBS summarised for the dashboard and the status panel (spec §9.4, §5.2): rollups
 * from the domain module (D23), delayed leaves (§10.5) and leaves still missing values. Pure.
 */
import {
  buildTree,
  derivedDelayed,
  projectRollup,
  rollupTree,
  type ActivityNode,
  type ActivityRecord,
  type DerivedDelayReason,
  type ISODate,
  type ProgressWeighting,
} from "@/lib/domain";

export type MissingField = "start" | "duration" | "cost";

export interface DashboardActivity {
  id: string;
  wbsCode: string;
  name: string;
  level: number;
  startDate: ISODate | null;
  endDate: ISODate | null;
  status: ActivityRecord["status"];
  /** Manually reported Delayed (status or flag). */
  reportedDelayed: boolean;
  /** Derived Delayed (§10.5), null when not derived-late. */
  derived: { reason: DerivedDelayReason; days: number } | null;
  /** Leaves only: the values still missing for scheduling and budgeting. */
  missing: MissingField[];
}

export interface WorkSummary {
  today: ISODate;
  /** Weighted % complete over all leaves (0–100, unrounded). */
  percent: number;
  activityCount: number;
  leafCount: number;
  completedLeafCount: number;
  incompleteCount: number;
  /** First 10 incomplete activities in WBS order (for "Complete these first"). */
  incomplete: { id: string; wbsCode: string; name: string }[];
  scheduleStart: ISODate | null;
  scheduleEnd: ISODate | null;
  usedFallbackWeight: boolean;
  /** Delayed leaves (reported or derived), most overdue first. */
  delayed: DashboardActivity[];
  /** Leaves missing a start date, duration or cost. */
  unscheduled: DashboardActivity[];
}

/** Tree + rollups + attention lists from the flat activity rows. */
export function summarizeWork(records: ReadonlyArray<ActivityRecord>, weighting: ProgressWeighting, today: ISODate): WorkSummary {
  const { roots } = buildTree(records);
  const totals = projectRollup(roots, { weighting, today });
  const perNode = rollupTree(roots, { weighting, today });

  const delayed: DashboardActivity[] = [];
  const unscheduled: DashboardActivity[] = [];
  const byId = new Map<string, ActivityNode>();
  let completedLeafCount = 0;

  const walk = (nodes: ReadonlyArray<ActivityNode>): void => {
    for (const node of nodes) {
      byId.set(node.id, node);
      if (node.children.length > 0) {
        walk(node.children);
        continue;
      }
      if (node.status === "completed") completedLeafCount += 1;
      const missing: MissingField[] = [];
      if (!node.startDate) missing.push("start");
      if (node.durationHours === null) missing.push("duration");
      if (node.estCost === null) missing.push("cost");
      const derived = derivedDelayed({ status: node.status, startDate: node.startDate, endDate: node.endDate, today });
      const reportedDelayed = node.status === "delayed" || node.delayedReported;
      const item: DashboardActivity = {
        id: node.id,
        wbsCode: node.wbsCode,
        name: node.name,
        level: node.level,
        startDate: node.startDate,
        endDate: node.endDate,
        status: node.status,
        reportedDelayed,
        derived: derived.delayed && derived.reason ? { reason: derived.reason, days: derived.days } : null,
        missing,
      };
      if (perNode.get(node.id)?.hasDelayed) delayed.push(item);
      if (missing.length > 0) unscheduled.push(item);
    }
  };
  walk(roots);

  delayed.sort((a, b) => (b.derived?.days ?? 0) - (a.derived?.days ?? 0) || a.wbsCode.localeCompare(b.wbsCode, "en", { numeric: true }));

  return {
    today,
    percent: totals.percent,
    activityCount: totals.activityCount,
    leafCount: totals.leafCount,
    completedLeafCount,
    incompleteCount: totals.incompleteCount,
    incomplete: totals.incompleteIds.slice(0, 10).flatMap((id) => {
      const node = byId.get(id);
      return node ? [{ id, wbsCode: node.wbsCode, name: node.name }] : [];
    }),
    scheduleStart: totals.startDate,
    scheduleEnd: totals.endDate,
    usedFallbackWeight: totals.usedFallbackWeight,
    delayed,
    unscheduled,
  };
}
