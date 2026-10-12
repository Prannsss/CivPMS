/**
 * Parent rollups (spec §6.2, §6.5, §10.4; docs/DECISIONS.md D21, D23).
 * Leaves hold the real values; every parent derives its dates, hours, cost, weighted %,
 * status and Delayed indicator from its descendant leaves. A parent's own stored values are ignored.
 */
import { maxISO, minISO, type ISODate } from "./dates";
import { sumMoney } from "./money";
import { derivedDelayed, type ActivityStatus } from "./status";
import type { ActivityNode, ActivityRecord } from "./wbs";

export type ProgressWeighting = "cost" | "hours";

export interface RollupOptions {
  /** Progress weighting basis (project setting, default cost). */
  weighting: ProgressWeighting;
  /** Ids already known to be derived-Delayed (spec §10.5). */
  delayedIds?: ReadonlySet<string>;
  /** When given, derived Delayed is also computed for each leaf against this date (Asia/Manila today). */
  today?: ISODate;
}

export interface Rollup {
  isLeaf: boolean;
  startDate: ISODate | null;
  endDate: ISODate | null;
  hours: number;
  cost: number;
  /** Weighted % complete, 0–100 (not rounded; format for display). */
  percent: number;
  /** Leaf: its own status. Parent: derived per §10.4 (never 'delayed'; see `hasDelayed`). */
  status: ActivityStatus;
  /** Leaf: delayed itself (manual, reported, or derived). Parent: any descendant leaf delayed. */
  hasDelayed: boolean;
  leafCount: number;
  /** Sum of the leaf weights used for the % (after fallbacks). */
  weight: number;
  /** True when any leaf in the subtree fell back to the other basis or to equal weight 1 (§6.5). */
  usedFallbackWeight: boolean;
}

export interface LeafWeight {
  weight: number;
  usedFallback: boolean;
}

/**
 * Weight of a leaf (§6.5): the primary basis when > 0, else the other basis when > 0,
 * else 1 (equal weight). Both fallbacks reduce progress accuracy, so they are flagged.
 */
export function leafWeight(
  leaf: { estCost: number | null; durationHours: number | null },
  weighting: ProgressWeighting,
): LeafWeight {
  const cost = positiveOrZero(leaf.estCost);
  const hours = positiveOrZero(leaf.durationHours);
  const primary = weighting === "cost" ? cost : hours;
  const secondary = weighting === "cost" ? hours : cost;
  if (primary > 0) return { weight: primary, usedFallback: false };
  if (secondary > 0) return { weight: secondary, usedFallback: true };
  return { weight: 1, usedFallback: true };
}

function positiveOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Derived parent status from its leaves' statuses (§10.4). */
export function deriveParentStatus(statuses: ReadonlyArray<ActivityStatus>): ActivityStatus {
  if (statuses.length === 0) return "not_started";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.every((s) => s === "not_started")) return "not_started";
  if (statuses.every((s) => s === "on_hold")) return "on_hold";
  return "ongoing";
}

interface Accumulator {
  startDate: ISODate | null;
  endDate: ISODate | null;
  hours: number;
  costs: number[];
  weightedPercent: number;
  weight: number;
  statuses: ActivityStatus[];
  hasDelayed: boolean;
  leafCount: number;
  usedFallbackWeight: boolean;
}

function isLeafDelayed(leaf: ActivityRecord, options: RollupOptions): boolean {
  if (leaf.status === "delayed" || leaf.delayedReported) return true;
  if (options.delayedIds?.has(leaf.id)) return true;
  if (options.today) {
    return derivedDelayed({
      status: leaf.status,
      startDate: leaf.startDate,
      endDate: leaf.endDate,
      today: options.today,
    }).delayed;
  }
  return false;
}

/** Computes a Rollup for every node in the tree. */
export function rollupTree<T extends ActivityRecord>(
  roots: ReadonlyArray<ActivityNode<T>>,
  options: RollupOptions,
): Map<string, Rollup> {
  const result = new Map<string, Rollup>();
  for (const root of roots) visit(root, options, result);
  return result;
}

function visit<T extends ActivityRecord>(
  node: ActivityNode<T>,
  options: RollupOptions,
  result: Map<string, Rollup>,
): Accumulator {
  let acc: Accumulator;
  if (node.children.length === 0) {
    const { weight, usedFallback } = leafWeight(node, options.weighting);
    const percent = clampPercent(node.percent);
    const cost = finiteOrZero(node.estCost);
    const hours = finiteOrZero(node.durationHours);
    acc = {
      startDate: node.startDate || null,
      endDate: node.endDate || null,
      hours,
      costs: [cost],
      weightedPercent: weight * percent,
      weight,
      statuses: [node.status],
      hasDelayed: isLeafDelayed(node, options),
      leafCount: 1,
      usedFallbackWeight: usedFallback,
    };
    result.set(node.id, {
      isLeaf: true,
      startDate: acc.startDate,
      endDate: acc.endDate,
      hours,
      cost,
      percent,
      status: node.status,
      hasDelayed: acc.hasDelayed,
      leafCount: 1,
      weight,
      usedFallbackWeight: usedFallback,
    });
    return acc;
  }

  acc = {
    startDate: null,
    endDate: null,
    hours: 0,
    costs: [],
    weightedPercent: 0,
    weight: 0,
    statuses: [],
    hasDelayed: false,
    leafCount: 0,
    usedFallbackWeight: false,
  };
  for (const child of node.children) mergeInto(acc, visit(child, options, result));
  result.set(node.id, toRollup(acc, false));
  return acc;
}

function mergeInto(target: Accumulator, source: Accumulator): void {
  target.startDate = minISO(target.startDate, source.startDate);
  target.endDate = maxISO(target.endDate, source.endDate);
  target.hours += source.hours;
  target.costs.push(...source.costs);
  target.weightedPercent += source.weightedPercent;
  target.weight += source.weight;
  target.statuses.push(...source.statuses);
  target.hasDelayed = target.hasDelayed || source.hasDelayed;
  target.leafCount += source.leafCount;
  target.usedFallbackWeight = target.usedFallbackWeight || source.usedFallbackWeight;
}

function toRollup(acc: Accumulator, isLeaf: boolean): Rollup {
  return {
    isLeaf,
    startDate: acc.startDate,
    endDate: acc.endDate,
    hours: acc.hours,
    cost: sumMoney(acc.costs),
    percent: acc.weight > 0 ? acc.weightedPercent / acc.weight : 0,
    status: deriveParentStatus(acc.statuses),
    hasDelayed: acc.hasDelayed,
    leafCount: acc.leafCount,
    weight: acc.weight,
    usedFallbackWeight: acc.usedFallbackWeight,
  };
}

export interface ProjectRollup extends Omit<Rollup, "isLeaf"> {
  /** Activities at all levels. */
  activityCount: number;
  /** Activities (all levels) whose rolled-up status is not Completed. */
  incompleteCount: number;
  /** Ids of those activities, in WBS (pre-order) order — for the "complete these first" message (§5.2). */
  incompleteIds: string[];
}

/** Totals for the whole project: same rules as a parent, over all leaves (§6.5 "Project % = same over all leaves"). */
export function projectRollup<T extends ActivityRecord>(
  roots: ReadonlyArray<ActivityNode<T>>,
  options: RollupOptions,
): ProjectRollup {
  const perNode = new Map<string, Rollup>();
  const acc: Accumulator = {
    startDate: null,
    endDate: null,
    hours: 0,
    costs: [],
    weightedPercent: 0,
    weight: 0,
    statuses: [],
    hasDelayed: false,
    leafCount: 0,
    usedFallbackWeight: false,
  };
  for (const root of roots) mergeInto(acc, visit(root, options, perNode));

  const incompleteIds: string[] = [];
  let activityCount = 0;
  const walk = (nodes: ReadonlyArray<ActivityNode<T>>): void => {
    for (const node of nodes) {
      activityCount += 1;
      if (perNode.get(node.id)?.status !== "completed") incompleteIds.push(node.id);
      walk(node.children);
    }
  };
  walk(roots);

  const totals = toRollup(acc, false);
  return {
    startDate: totals.startDate,
    endDate: totals.endDate,
    hours: totals.hours,
    cost: totals.cost,
    percent: totals.percent,
    status: totals.status,
    hasDelayed: totals.hasDelayed,
    leafCount: totals.leafCount,
    weight: totals.weight,
    usedFallbackWeight: totals.usedFallbackWeight,
    activityCount,
    incompleteCount: incompleteIds.length,
    incompleteIds,
  };
}
