/**
 * Work Breakdown Structure tree helpers (spec §6.1, §9.3, docs/DECISIONS.md D22).
 * Levels are 1-based: 1 = Deliverable, 2 = Sub-deliverable, 3 = Work package.
 */
import { WBS_MAX_DEPTH } from "@/lib/constants";
import type { ISODate } from "./dates";
import { pluralize } from "./format";
import type { ActivityStatus } from "./status";

/** An activity row as read from the database (camelCased). Leaf values only are authoritative (D23). */
export interface ActivityRecord {
  id: string;
  parentId: string | null;
  sortOrder: number;
  name: string;
  description?: string | null;
  startDate: ISODate | null;
  durationHours: number | null;
  endDate: ISODate | null;
  estCost: number | null;
  status: ActivityStatus;
  percent: number;
  delayedReported: boolean;
  version: number;
  wbsCode?: string | null;
  level?: number | null;
  /** Soft-delete timestamp; rows with a value are ignored by `buildTree`. */
  deletedAt?: string | null;
}

/** A record placed in the tree. `level` and `wbsCode` are recomputed from the tree position. */
export type ActivityNode<T extends ActivityRecord = ActivityRecord> = T & {
  level: number;
  wbsCode: string;
  children: ActivityNode<T>[];
};

export interface BuildTreeResult<T extends ActivityRecord> {
  roots: ActivityNode<T>[];
  /**
   * Ids attached as roots because their parent is missing (not in the input) or because their
   * parent links form a cycle. Non-empty means the data needs repair; the UI still renders.
   */
  orphanIds: string[];
}

/** Sibling order: sortOrder, then name, then id (stable and deterministic). */
export function compareSiblings(
  a: Pick<ActivityRecord, "sortOrder" | "name" | "id">,
  b: Pick<ActivityRecord, "sortOrder" | "name" | "id">,
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const byName = a.name.localeCompare(b.name, "en");
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds the WBS tree from flat records. Soft-deleted rows (and anything below them) are ignored.
 * Records whose parent is missing are attached as roots and reported in `orphanIds`;
 * parent cycles are broken the same way, so this never loops forever.
 */
export function buildTree<T extends ActivityRecord>(records: ReadonlyArray<T>): BuildTreeResult<T> {
  const deletedIds = new Set<string>();
  const live = new Map<string, T>();
  for (const r of records) {
    if (r.deletedAt) deletedIds.add(r.id);
    else if (!live.has(r.id)) live.set(r.id, r);
  }

  const childrenOf = new Map<string, T[]>();
  for (const r of live.values()) {
    if (r.parentId === null) continue;
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r);
    else childrenOf.set(r.parentId, [r]);
  }

  const visited = new Set<string>();
  const attach = (record: T): ActivityNode<T> => {
    visited.add(record.id);
    const node: ActivityNode<T> = { ...record, level: 0, wbsCode: "", children: [] };
    const kids = [...(childrenOf.get(record.id) ?? [])].sort(compareSiblings);
    for (const kid of kids) {
      if (!visited.has(kid.id)) node.children.push(attach(kid));
    }
    return node;
  };

  const realRoots: T[] = [];
  const orphanRoots: T[] = [];
  for (const r of live.values()) {
    if (r.parentId === null) realRoots.push(r);
    else if (!live.has(r.parentId) && !deletedIds.has(r.parentId)) orphanRoots.push(r);
  }
  realRoots.sort(compareSiblings);
  orphanRoots.sort(compareSiblings);

  const roots: ActivityNode<T>[] = [];
  const orphanIds: string[] = [];
  for (const r of realRoots) roots.push(attach(r));
  for (const r of orphanRoots) {
    orphanIds.push(r.id);
    roots.push(attach(r));
  }

  // Anything still unvisited is either below a deleted row (ignored) or part of a parent cycle.
  for (const r of live.values()) {
    if (visited.has(r.id) || isUnderDeleted(r, live, deletedIds)) continue;
    const entry = cycleEntry(r, live);
    orphanIds.push(entry.id);
    roots.push(attach(entry));
  }

  assignLevelsAndCodes(roots);
  return { roots, orphanIds };
}

function isUnderDeleted<T extends ActivityRecord>(
  record: T,
  live: ReadonlyMap<string, T>,
  deletedIds: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  let parentId = record.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    if (deletedIds.has(parentId)) return true;
    seen.add(parentId);
    const parent = live.get(parentId);
    if (!parent) return false;
    parentId = parent.parentId;
  }
  return false;
}

/** Walks up the parent links of an unreachable record until a node repeats: that node is on the cycle. */
function cycleEntry<T extends ActivityRecord>(record: T, live: ReadonlyMap<string, T>): T {
  const seen = new Set<string>();
  let current = record;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    const parent = current.parentId === null ? undefined : live.get(current.parentId);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

function assignLevelsAndCodes<T extends ActivityRecord>(roots: ActivityNode<T>[]): void {
  const visit = (nodes: ActivityNode<T>[], level: number, prefix: string): void => {
    nodes.forEach((node, i) => {
      node.level = level;
      node.wbsCode = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      visit(node.children, level + 1, node.wbsCode);
    });
  };
  visit(roots, 1, "");
}

/** Minimal shape the traversal helpers need, so they also work on hand-built trees. */
export interface TreeNodeLike<N> {
  id: string;
  children: N[];
}

/** WBS codes ('1', '1.2', '1.2.3') from the given order of roots and children. */
export function computeWbsCodes<N extends TreeNodeLike<N>>(roots: ReadonlyArray<N>): Map<string, string> {
  const codes = new Map<string, string>();
  const visit = (nodes: ReadonlyArray<N>, prefix: string): void => {
    nodes.forEach((node, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      codes.set(node.id, code);
      visit(node.children, code);
    });
  };
  visit(roots, "");
  return codes;
}

export interface FlatWbsRow<N> {
  node: N;
  id: string;
  parentId: string | null;
  /** 0 for roots; use for indentation. */
  depth: number;
  /** 1-based WBS level (depth + 1). */
  level: number;
  wbsCode: string;
  hasChildren: boolean;
  isLastChild: boolean;
  isCollapsed: boolean;
  /** For each ancestor (root first), whether it is the last child — drives tree guide lines. */
  ancestorIsLast: boolean[];
}

/** Pre-order rows for list rendering. Children of ids in `collapsedIds` are skipped. */
export function flattenTree<N extends TreeNodeLike<N>>(
  roots: ReadonlyArray<N>,
  collapsedIds: ReadonlySet<string> = new Set(),
): FlatWbsRow<N>[] {
  const rows: FlatWbsRow<N>[] = [];
  const visit = (
    nodes: ReadonlyArray<N>,
    depth: number,
    prefix: string,
    parentId: string | null,
    ancestorIsLast: boolean[],
  ): void => {
    nodes.forEach((node, i) => {
      const wbsCode = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const isLastChild = i === nodes.length - 1;
      const hasChildren = node.children.length > 0;
      const isCollapsed = hasChildren && collapsedIds.has(node.id);
      rows.push({
        node,
        id: node.id,
        parentId,
        depth,
        level: depth + 1,
        wbsCode,
        hasChildren,
        isLastChild,
        isCollapsed,
        ancestorIsLast,
      });
      if (hasChildren && !isCollapsed) {
        visit(node.children, depth + 1, wbsCode, node.id, [...ancestorIsLast, isLastChild]);
      }
    });
  };
  visit(roots, 0, "", null, []);
  return rows;
}

export function findNode<N extends TreeNodeLike<N>>(roots: ReadonlyArray<N>, id: string): N | null {
  for (const node of roots) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Ancestors from the root down to the direct parent. Empty for roots and unknown ids. */
export function ancestorsOf<N extends TreeNodeLike<N>>(roots: ReadonlyArray<N>, id: string): N[] {
  const path: N[] = [];
  const visit = (nodes: ReadonlyArray<N>): boolean => {
    for (const node of nodes) {
      if (node.id === id) return true;
      path.push(node);
      if (visit(node.children)) return true;
      path.pop();
    }
    return false;
  };
  return visit(roots) ? path : [];
}

/** All descendants in pre-order, excluding the node itself. */
export function descendantsOf<N extends TreeNodeLike<N>>(node: N): N[] {
  const out: N[] = [];
  const visit = (nodes: ReadonlyArray<N>): void => {
    for (const child of nodes) {
      out.push(child);
      visit(child.children);
    }
  };
  visit(node.children);
  return out;
}

/** Leaves of the subtree in pre-order (the node itself when it has no children). */
export function leavesOf<N extends TreeNodeLike<N>>(node: N): N[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap((child) => leavesOf(child));
}

/** Number of levels in the subtree including the node: 1 for a leaf. */
export function subtreeHeight<N extends TreeNodeLike<N>>(node: N): number {
  let max = 0;
  for (const child of node.children) max = Math.max(max, subtreeHeight(child));
  return max + 1;
}

/** 1-based level of the node in the tree, or null when not found. */
export function depthOf<N extends TreeNodeLike<N>>(roots: ReadonlyArray<N>, id: string): number | null {
  if (!findNode(roots, id)) return null;
  return ancestorsOf(roots, id).length + 1;
}

export type CanMoveResult = { ok: true } | { ok: false; reason: "SELF" | "DESCENDANT" | "MAX_DEPTH" | "NOT_FOUND" };

/**
 * Whether `id` (with its subtree) may be re-parented under `newParentId` (null = top level)
 * without creating a loop or exceeding WBS_MAX_DEPTH (D22).
 */
export function canMove<N extends TreeNodeLike<N>>(
  roots: ReadonlyArray<N>,
  id: string,
  newParentId: string | null,
): CanMoveResult {
  const node = findNode(roots, id);
  if (!node) return { ok: false, reason: "NOT_FOUND" };
  if (newParentId === id) return { ok: false, reason: "SELF" };
  let parentLevel = 0;
  if (newParentId !== null) {
    const parentDepth = depthOf(roots, newParentId);
    if (parentDepth === null) return { ok: false, reason: "NOT_FOUND" };
    if (findNode(node.children, newParentId)) return { ok: false, reason: "DESCENDANT" };
    parentLevel = parentDepth;
  }
  if (parentLevel + subtreeHeight(node) > WBS_MAX_DEPTH) return { ok: false, reason: "MAX_DEPTH" };
  return { ok: true };
}

/** Plain-language message for a rejected move. */
export function canMoveMessage(reason: "SELF" | "DESCENDANT" | "MAX_DEPTH" | "NOT_FOUND"): string {
  switch (reason) {
    case "SELF":
      return "An item can't be moved inside itself.";
    case "DESCENDANT":
      return "An item can't be moved inside one of its own sub-items.";
    case "MAX_DEPTH":
      return `The work breakdown has at most ${WBS_MAX_DEPTH} levels (Deliverable → Sub-deliverable → Work package). Move it higher up instead.`;
    case "NOT_FOUND":
      return "That item no longer exists. Reload the page and try again.";
  }
}

export interface DescendantCounts {
  subDeliverables: number;
  workPackages: number;
  total: number;
}

/** Counts descendants by their WBS level (level 2 = sub-deliverable, level 3 = work package). */
export function countDescendantsByLevel<N extends TreeNodeLike<N> & { level: number }>(node: N): DescendantCounts {
  const counts: DescendantCounts = { subDeliverables: 0, workPackages: 0, total: 0 };
  const visit = (nodes: ReadonlyArray<N>, level: number): void => {
    for (const child of nodes) {
      counts.total += 1;
      if (level === 2) counts.subDeliverables += 1;
      else if (level === 3) counts.workPackages += 1;
      visit(child.children, level + 1);
    }
  };
  visit(node.children, node.level + 1);
  return counts;
}

/** Confirmation text for deleting a node, e.g. 'Deletes 4 sub-deliverables and 11 work packages' (spec §17.2). */
export function describeDeleteImpact<N extends TreeNodeLike<N> & { level: number }>(node: N): string {
  const { subDeliverables, workPackages } = countDescendantsByLevel(node);
  const parts: string[] = [];
  if (subDeliverables > 0) parts.push(pluralize(subDeliverables, "sub-deliverable"));
  if (workPackages > 0) parts.push(pluralize(workPackages, "work package"));
  if (parts.length === 0) return `Deletes this ${levelLabel(node.level).toLowerCase()}`;
  return `Deletes ${parts.join(" and ")}`;
}

export type WbsLevelLabel = "Deliverable" | "Sub-deliverable" | "Work package";

/** Label for a 1-based level; out-of-range levels clamp to the nearest valid one. */
export function levelLabel(level: number): WbsLevelLabel {
  if (level <= 1) return "Deliverable";
  if (level === 2) return "Sub-deliverable";
  return "Work package";
}

/** Label for a child of a node at `level`, or null when the level cannot have children (D22). */
export function childLevelLabel(level: number): WbsLevelLabel | null {
  if (level >= WBS_MAX_DEPTH) return null;
  return levelLabel(level + 1);
}
