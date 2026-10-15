/**
 * Pure helpers for the WBS screens (no React, no Supabase): leaf schedule resolution (D20),
 * optimistic re-ordering, drag-and-drop projection and the sample structure.
 * Business rules themselves (calendar math, tree rules) come from `@/lib/domain`.
 */
import { WBS_MAX_DEPTH as WBS_MAX_DEPTH_LEVELS } from "@/lib/constants";
import {
  CalendarError,
  computeEndDate,
  countWorkingDays,
  durationHoursFromDates,
  formatDate,
  isValidISODate,
  levelLabel,
  nextWorkingDay,
  type CalendarIndex,
  type ISODate,
} from "@/lib/domain";

// ---------------------------------------------------------------------------
// Leaf schedule (spec §6.2, D20)
// ---------------------------------------------------------------------------

export interface LeafSchedule {
  startDate: ISODate | null;
  durationHours: number | null;
  endDate: ISODate | null;
}

export interface SchedulePatch {
  startDate?: ISODate | null;
  durationHours?: number | null;
  endDate?: ISODate | null;
}

export type ResolvedSchedule =
  | { ok: true; schedule: LeafSchedule; endAdjusted: boolean }
  | { ok: false; field: "startDate" | "durationHours" | "endDate"; message: string };

/**
 * Applies a user edit to a leaf's start / duration / end and returns the authoritative values:
 * - editing the end date recomputes the duration (working days in [start, end] × hours/day),
 *   then the end snaps to the last working day of that span;
 * - editing start or duration recomputes the end with `computeEndDate`.
 */
export function resolveLeafSchedule(index: CalendarIndex, current: LeafSchedule, patch: SchedulePatch): ResolvedSchedule {
  const startDate = patch.startDate !== undefined ? patch.startDate : current.startDate;
  try {
    if (patch.endDate !== undefined && patch.endDate !== null) {
      const end = patch.endDate;
      if (!startDate) {
        return { ok: false, field: "endDate", message: "Set a start date first, then the end date." };
      }
      if (end < startDate) {
        return { ok: false, field: "endDate", message: `End date must be on or after ${formatDate(startDate)}.` };
      }
      if (countWorkingDays(index, startDate, end) === 0) {
        return {
          ok: false,
          field: "endDate",
          message: `There are no working days from ${formatDate(startDate)} to ${formatDate(end)}. Pick a later end date, or set the duration to 0 for a milestone.`,
        };
      }
      const durationHours = durationHoursFromDates(index, startDate, end);
      const endDate = computeEndDate(index, startDate, durationHours);
      return { ok: true, schedule: { startDate, durationHours, endDate }, endAdjusted: endDate !== end };
    }

    let durationHours = patch.durationHours !== undefined ? patch.durationHours : current.durationHours;
    if (durationHours === null && startDate && current.endDate && current.endDate >= startDate && patch.durationHours === undefined) {
      // Older rows with dates but no duration: keep their span.
      durationHours = durationHoursFromDates(index, startDate, current.endDate);
    }
    if (!startDate || durationHours === null) {
      const endDate = patch.endDate === null ? null : !startDate ? null : current.endDate;
      return { ok: true, schedule: { startDate, durationHours, endDate }, endAdjusted: false };
    }
    const endDate = computeEndDate(index, startDate, durationHours);
    return { ok: true, schedule: { startDate, durationHours, endDate }, endAdjusted: false };
  } catch (error) {
    if (error instanceof CalendarError && error.code === "NO_WORKING_DAYS") {
      return {
        ok: false,
        field: "startDate",
        message: "The project calendar has no working days. Add working days on the Calendar page first.",
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Tree re-ordering (optimistic UI for move_activity)
// ---------------------------------------------------------------------------

export interface OrderedRecord {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/** Siblings under `parentId` in display order (sortOrder, then id). */
export function siblingsOf<T extends OrderedRecord>(records: ReadonlyArray<T>, parentId: string | null): T[] {
  return records
    .filter((r) => r.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Position of `id` among its siblings (0-based), or -1. */
export function indexAmongSiblings<T extends OrderedRecord>(records: ReadonlyArray<T>, id: string): number {
  const record = records.find((r) => r.id === id);
  if (!record) return -1;
  return siblingsOf(records, record.parentId).findIndex((r) => r.id === id);
}

/**
 * Mirrors `move_activity`: removes `id` from its siblings, inserts it under `newParentId` at
 * `newIndex` (clamped; null = append) and renumbers both sibling lists contiguously.
 */
export function applyMove<T extends OrderedRecord>(
  records: ReadonlyArray<T>,
  id: string,
  newParentId: string | null,
  newIndex: number | null,
): T[] {
  const moving = records.find((r) => r.id === id);
  if (!moving) return [...records];
  const oldSiblings = siblingsOf(records, moving.parentId).filter((r) => r.id !== id);
  const newSiblings = siblingsOf(records, newParentId).filter((r) => r.id !== id);
  const index = Math.max(0, Math.min(newIndex ?? newSiblings.length, newSiblings.length));
  newSiblings.splice(index, 0, moving);

  const updates = new Map<string, { parentId: string | null; sortOrder: number }>();
  oldSiblings.forEach((r, i) => updates.set(r.id, { parentId: r.parentId, sortOrder: i }));
  newSiblings.forEach((r, i) => updates.set(r.id, { parentId: newParentId, sortOrder: i }));
  return records.map((r) => {
    const u = updates.get(r.id);
    return u ? { ...r, parentId: u.parentId, sortOrder: u.sortOrder } : r;
  });
}

// ---------------------------------------------------------------------------
// Drag-and-drop projection (list view)
// ---------------------------------------------------------------------------

export interface ProjectionItem {
  id: string;
  parentId: string | null;
  depth: number;
}

export interface Projection {
  depth: number;
  parentId: string | null;
  /** 0-based index among the new siblings (excluding the dragged item). */
  index: number;
}

/**
 * Where a dragged row would land: `items` are the visible rows in order (the dragged item's
 * descendants already removed), `overId` the row under the pointer and `offsetX` the horizontal
 * drag distance (each `indentWidth` px = one level). Depth is clamped so the tree stays valid
 * around the drop position; the WBS depth limit is checked separately with `canMove`.
 */
export function getProjection(
  items: ReadonlyArray<ProjectionItem>,
  activeId: string,
  overId: string,
  offsetX: number,
  indentWidth: number,
): Projection | null {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  const active = items[activeIndex]!;
  const reordered = [...items];
  reordered.splice(activeIndex, 1);
  reordered.splice(overIndex, 0, active);

  const previous = reordered[overIndex - 1];
  const next = reordered[overIndex + 1];
  const projected = active.depth + Math.round(offsetX / indentWidth);
  const maxDepth = Math.min(previous ? previous.depth + 1 : 0, WBS_MAX_DEPTH_LEVELS - 1);
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(Math.min(projected, maxDepth), Math.min(minDepth, maxDepth));

  let parentId: string | null = null;
  if (depth > 0 && previous) {
    if (depth === previous.depth) parentId = previous.parentId;
    else if (depth > previous.depth) parentId = previous.id;
    else {
      const ancestor = reordered
        .slice(0, overIndex)
        .reverse()
        .find((item) => item.depth === depth);
      parentId = ancestor ? ancestor.parentId : null;
    }
  }

  let index = 0;
  for (let i = 0; i < overIndex; i += 1) {
    const item = reordered[i]!;
    if (item.id !== activeId && item.parentId === parentId && item.depth === depth) index += 1;
  }
  return { depth, parentId, index };
}

// ---------------------------------------------------------------------------
// Sample structure (empty-state onboarding)
// ---------------------------------------------------------------------------

export interface SampleWorkPackage {
  name: string;
  startDate: ISODate;
  durationHours: number;
  endDate: ISODate;
}

export interface SampleDeliverable {
  name: string;
  workPackages: SampleWorkPackage[];
}

const SAMPLE: { name: string; packages: { name: string; days: number }[] }[] = [
  {
    name: "Site preparation",
    packages: [
      { name: "Mobilization and temporary facilities", days: 5 },
      { name: "Clearing, grubbing and layout", days: 5 },
    ],
  },
  {
    name: "Structural works",
    packages: [
      { name: "Excavation and foundations", days: 15 },
      { name: "Superstructure", days: 30 },
    ],
  },
  {
    name: "Finishing and turnover",
    packages: [
      { name: "Finishing works", days: 20 },
      { name: "Testing and commissioning", days: 5 },
      { name: "Punch list and turnover", days: 3 },
    ],
  },
];

/** Three example deliverables with sequential work packages starting on the project start date. */
export function buildSampleStructure(index: CalendarIndex, projectStart: ISODate): SampleDeliverable[] {
  if (!isValidISODate(projectStart)) return [];
  let cursor = nextWorkingDay(index, projectStart, { inclusive: true });
  return SAMPLE.map((deliverable) => ({
    name: deliverable.name,
    workPackages: deliverable.packages.map((pkg) => {
      const durationHours = pkg.days * index.hoursPerDay;
      const startDate = cursor;
      const endDate = computeEndDate(index, startDate, durationHours);
      cursor = nextWorkingDay(index, endDate, { inclusive: false });
      return { name: pkg.name, startDate, durationHours, endDate };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * What an item is called on screen: a leaf below the top level is a work package (it carries the
 * schedule and cost), even at level 2; parents use their level's name (D22).
 */
export function nodeLabel(node: { level: number; children: ReadonlyArray<unknown> }): string {
  return node.children.length === 0 && node.level > 1 ? "Work package" : levelLabel(node.level);
}
