/**
 * Gantt view model (spec §9.1, §5.4; docs/ROADMAP.md §4.0 Stage A): the timeline range, zoom
 * scales, header segments, non-working shading, rows and bar geometry. Pure: dates in, numbers
 * out. Stage A is read-only; Phase 2 adds links, CPM and editing on top of the same model.
 */
import { countWorkingDays, nonWorkingReason, type CalendarIndex } from "./calendar";
import { addDays, diffDays, isoWeekday, maxISO, minISO, parseISODate, type ISODate } from "./dates";
import { formatDate, pluralize } from "./format";
import type { ProjectStatus } from "./project";
import type { Rollup } from "./rollup";
import { derivedDelayed, type ActivityStatus, type DerivedDelayReason } from "./status";
import { flattenTree, type ActivityNode, type ActivityRecord } from "./wbs";

/** Zoom presets: pixels per calendar day. "Fit" picks any width in between. */
export const GANTT_ZOOMS = ["day", "week", "month", "quarter"] as const;
export type GanttZoom = (typeof GANTT_ZOOMS)[number];

export const ZOOM_DAY_WIDTH: Readonly<Record<GanttZoom, number>> = Object.freeze({
  day: 36,
  week: 16,
  month: 5,
  quarter: 2,
});

export const MIN_DAY_WIDTH = 1;
export const MAX_DAY_WIDTH = 48;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The header scale that suits a day width (also used after "Fit"). */
export function scaleForDayWidth(dayWidth: number): GanttZoom {
  if (dayWidth >= 24) return "day";
  if (dayWidth >= 8) return "week";
  if (dayWidth >= 2.5) return "month";
  return "quarter";
}

/** Day width that fits `days` into `availablePx`, kept inside the readable limits. */
export function fitDayWidth(days: number, availablePx: number): number {
  if (days <= 0 || availablePx <= 0) return ZOOM_DAY_WIDTH.week;
  const width = availablePx / days;
  return Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, Math.floor(width * 100) / 100));
}

export interface TimelineRange {
  start: ISODate;
  end: ISODate;
  /** Calendar days in [start, end]. */
  days: number;
}

/**
 * §5.4: the timeline spans the project dates, every bar and baseline bar and, while the project
 * is open, today (so overruns and overdue work stay visible). Padded to whole Monday–Sunday weeks
 * plus one spare week on each side.
 */
export function timelineRange(input: {
  projectStart: ISODate | null;
  projectEnd: ISODate | null;
  datedStarts: ReadonlyArray<ISODate | null>;
  datedEnds: ReadonlyArray<ISODate | null>;
  today: ISODate;
  isOpen: boolean;
}): TimelineRange {
  const earliest = minISO(input.projectStart, ...input.datedStarts) ?? input.today;
  const latest = maxISO(input.projectEnd, ...input.datedEnds, input.isOpen ? input.today : null) ?? earliest;
  const startMonday = addDays(earliest, -(isoWeekday(earliest) - 1));
  const endSunday = addDays(latest, 7 - isoWeekday(latest));
  const start = addDays(startMonday, -7);
  const end = addDays(maxISO(endSunday, startMonday) ?? endSunday, 7);
  return { start, end, days: diffDays(end, start) + 1 };
}

/** Left edge of a date's column, in px. */
export function dateToX(range: TimelineRange, date: ISODate, dayWidth: number): number {
  return diffDays(date, range.start) * dayWidth;
}

/** The date under an x position (clamped to the range). */
export function xToDate(range: TimelineRange, x: number, dayWidth: number): ISODate {
  const day = Math.min(range.days - 1, Math.max(0, Math.floor(x / dayWidth)));
  return addDays(range.start, day);
}

/** A bar covering whole days [start, end] (end ≥ start; a reversed range is drawn as one day). */
export function barGeometry(
  range: TimelineRange,
  start: ISODate,
  end: ISODate,
  dayWidth: number,
): { x: number; width: number } {
  const days = Math.max(1, diffDays(end, start) + 1);
  return { x: dateToX(range, start, dayWidth), width: days * dayWidth };
}

export interface HeaderSegment {
  key: string;
  x: number;
  width: number;
  label: string;
  /** Full label for screen readers / tooltips. */
  title: string;
  /** Today falls in this segment (day scale highlights it). */
  isToday?: boolean;
  /** Non-working day (day scale). */
  isNonWorking?: boolean;
}

export interface TimelineHeader {
  top: HeaderSegment[];
  bottom: HeaderSegment[];
}

type Unit = "day" | "week" | "month" | "quarter" | "year";

function unitStart(date: ISODate, unit: Unit): ISODate {
  const d = parseISODate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "day":
      return date;
    case "week":
      return addDays(date, -(isoWeekday(date) - 1));
    case "month":
      return isoFrom(y, m, 1);
    case "quarter":
      return isoFrom(y, m - (m % 3), 1);
    case "year":
      return isoFrom(y, 0, 1);
  }
}

function nextUnit(date: ISODate, unit: Unit): ISODate {
  const d = parseISODate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "day":
      return addDays(date, 1);
    case "week":
      return addDays(date, 7);
    case "month":
      return isoFrom(y, m + 1, 1);
    case "quarter":
      return isoFrom(y, m + 3, 1);
    case "year":
      return isoFrom(y + 1, 0, 1);
  }
}

function isoFrom(year: number, month: number, day: number): ISODate {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function unitLabel(date: ISODate, unit: Unit, long: boolean): string {
  const d = parseISODate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "day":
      return String(d.getUTCDate());
    case "week":
      return `${d.getUTCDate()} ${MONTHS[m]}`;
    case "month":
      return long ? `${MONTHS[m]} ${y}` : MONTHS[m];
    case "quarter":
      return long ? `Q${Math.floor(m / 3) + 1} ${y}` : `Q${Math.floor(m / 3) + 1}`;
    case "year":
      return String(y);
  }
}

function segments(
  range: TimelineRange,
  unit: Unit,
  dayWidth: number,
  long: boolean,
  extra?: (start: ISODate) => Partial<HeaderSegment>,
): HeaderSegment[] {
  const out: HeaderSegment[] = [];
  for (let cursor = unitStart(range.start, unit); cursor <= range.end; cursor = nextUnit(cursor, unit)) {
    const from = maxISO(cursor, range.start) as ISODate;
    const to = minISO(addDays(nextUnit(cursor, unit), -1), range.end) as ISODate;
    const { x, width } = barGeometry(range, from, to, dayWidth);
    out.push({
      key: `${unit}-${cursor}`,
      x,
      width,
      label: unitLabel(cursor, unit, long),
      title: unit === "week" ? `Week of ${formatDate(cursor)}` : unit === "day" ? formatDate(cursor) : unitLabel(cursor, unit, true),
      ...extra?.(cursor),
    });
  }
  return out;
}

/** Two header rows for a zoom scale: months over days or weeks, years over months or quarters. */
export function timelineHeader(
  range: TimelineRange,
  dayWidth: number,
  options: { today: ISODate; calendar?: CalendarIndex } = { today: range.start },
): TimelineHeader {
  const scale = scaleForDayWidth(dayWidth);
  switch (scale) {
    case "day":
      return {
        top: segments(range, "month", dayWidth, true),
        bottom: segments(range, "day", dayWidth, false, (date) => ({
          isToday: date === options.today,
          isNonWorking: options.calendar ? nonWorkingReason(options.calendar, date) !== null : false,
        })),
      };
    case "week":
      return { top: segments(range, "month", dayWidth, true), bottom: segments(range, "week", dayWidth, false) };
    case "month":
      return { top: segments(range, "year", dayWidth, false), bottom: segments(range, "month", dayWidth, false) };
    case "quarter":
      return { top: segments(range, "year", dayWidth, false), bottom: segments(range, "quarter", dayWidth, false) };
  }
}

export interface NonWorkingRun {
  start: ISODate;
  end: ISODate;
  x: number;
  width: number;
  /** "Weekend", holiday names, or "Non-working day". */
  label: string;
}

/** Consecutive non-working days merged into shaded runs, labelled for the tooltip. */
export function nonWorkingRuns(calendar: CalendarIndex, range: TimelineRange, dayWidth: number): NonWorkingRun[] {
  const runs: NonWorkingRun[] = [];
  let current: { start: ISODate; end: ISODate; names: Set<string>; weekend: boolean; other: boolean } | null = null;
  const flush = () => {
    if (!current) return;
    const names = [...current.names];
    const label =
      names.length > 0
        ? names.join(", ")
        : current.weekend && !current.other
          ? "Weekend"
          : "Non-working day";
    runs.push({ start: current.start, end: current.end, ...barGeometry(range, current.start, current.end, dayWidth), label });
    current = null;
  };
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const info = nonWorkingReason(calendar, date);
    if (!info) {
      flush();
      continue;
    }
    if (!current) current = { start: date, end: date, names: new Set(), weekend: false, other: false };
    current.end = date;
    if (info.holidayName) current.names.add(info.holidayName);
    else if (info.reason === "override" && info.note) current.names.add(info.note);
    if (info.reason === "weekend") current.weekend = true;
    else current.other = true;
  }
  flush();
  return runs;
}

export interface BaselineDates {
  start: ISODate | null;
  end: ISODate | null;
}

export interface GanttDelay {
  /** Auto (§10.5) or reported/manual Delayed. */
  delayed: boolean;
  /** Plain reason for the badge tooltip, e.g. "Its end date passed 3 days ago". */
  reason: string | null;
  autoReason: DerivedDelayReason | null;
}

export interface GanttRow {
  id: string;
  wbsCode: string;
  name: string;
  /** 1 = Deliverable … 3 = Work package. */
  level: number;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  isLeaf: boolean;
  start: ISODate | null;
  end: ISODate | null;
  hours: number;
  cost: number;
  percent: number;
  /** Leaf: its status (Delayed when auto-delayed). Parent: derived per §10.4. */
  status: ActivityStatus;
  delay: GanttDelay;
  /** Parent: some work package below is delayed. */
  containsDelayed: boolean;
  isMilestone: boolean;
  /** Overdue extension (hatched) from the day after the planned end to today, for unfinished leaves. */
  overdue: { start: ISODate; end: ISODate } | null;
  baseline: BaselineDates | null;
  /** Finish vs baseline in working days: > 0 behind, < 0 ahead, 0 on plan, null without both dates. */
  finishVariance: number | null;
}

/** Working-day difference between two finish dates (+ = `current` is later). */
export function finishVarianceDays(calendar: CalendarIndex, baselineEnd: ISODate, currentEnd: ISODate): number {
  if (currentEnd === baselineEnd) return 0;
  if (currentEnd > baselineEnd) return countWorkingDays(calendar, addDays(baselineEnd, 1), currentEnd);
  return -countWorkingDays(calendar, addDays(currentEnd, 1), baselineEnd);
}

function delayFor(leaf: ActivityRecord, today: ISODate): GanttDelay {
  const auto = derivedDelayed({ status: leaf.status, startDate: leaf.startDate, endDate: leaf.endDate, today });
  if (auto.delayed) {
    const ago = pluralize(auto.days, "day");
    return {
      delayed: true,
      autoReason: auto.reason,
      reason: auto.reason === "END_PASSED" ? `Its end date passed ${ago} ago` : `It should have started ${ago} ago`,
    };
  }
  if (leaf.status === "delayed" || leaf.delayedReported) {
    return { delayed: true, autoReason: null, reason: leaf.delayedReported ? "Reported as delayed" : "Marked as delayed" };
  }
  return { delayed: false, autoReason: null, reason: null };
}

/**
 * Visible rows in WBS order (children of collapsed parents skipped), with rolled-up values for
 * parents (§6.2, D23), Delayed indicators (§10.5) and baseline dates when a baseline is shown.
 */
export function buildGanttRows<T extends ActivityRecord>(input: {
  roots: ReadonlyArray<ActivityNode<T>>;
  rollups: ReadonlyMap<string, Rollup>;
  collapsedIds?: ReadonlySet<string>;
  today: ISODate;
  baseline?: ReadonlyMap<string, BaselineDates> | null;
  calendar?: CalendarIndex;
}): GanttRow[] {
  return flattenTree(input.roots, input.collapsedIds).map((flat) => {
    const node = flat.node;
    const r = input.rollups.get(node.id);
    const isLeaf = !flat.hasChildren;
    const start = (isLeaf ? node.startDate : r?.startDate) ?? null;
    const end = (isLeaf ? node.endDate : r?.endDate) ?? null;
    const hours = r?.hours ?? node.durationHours ?? 0;
    const delay = isLeaf ? delayFor(node, input.today) : { delayed: false, autoReason: null, reason: null };
    const status: ActivityStatus = isLeaf ? (delay.delayed ? "delayed" : node.status) : (r?.status ?? node.status);
    const overdue =
      isLeaf && end && node.status !== "completed" && input.today > end ? { start: addDays(end, 1), end: input.today } : null;
    const baseline = input.baseline?.get(node.id) ?? null;
    const finishVariance =
      baseline?.end && end && input.calendar ? finishVarianceDays(input.calendar, baseline.end, end) : null;
    return {
      id: node.id,
      wbsCode: flat.wbsCode,
      name: node.name,
      level: flat.level,
      depth: flat.depth,
      hasChildren: flat.hasChildren,
      isCollapsed: flat.isCollapsed,
      isLeaf,
      start,
      end,
      hours,
      cost: r?.cost ?? node.estCost ?? 0,
      percent: r?.percent ?? node.percent,
      status,
      delay,
      containsDelayed: !isLeaf && (r?.hasDelayed ?? false),
      isMilestone: isLeaf && start !== null && (node.durationHours ?? 0) === 0,
      overdue,
      baseline,
      finishVariance,
    };
  });
}

/** §5.3/§5.4: an open project past its end date shades the days from the end to today. */
export function projectOverrun(input: {
  status: ProjectStatus;
  endDate: ISODate | null;
  today: ISODate;
}): { start: ISODate; end: ISODate; days: number } | null {
  const { status, endDate, today } = input;
  if (!endDate || status === "completed" || status === "cancelled" || today <= endDate) return null;
  return { start: addDays(endDate, 1), end: today, days: diffDays(today, endDate) };
}

/** "Finish 2 days behind baseline" / "1 day ahead" / "On plan". */
export function varianceLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "On plan";
  return days > 0 ? `${pluralize(days, "working day")} behind baseline` : `${pluralize(-days, "working day")} ahead of baseline`;
}

/** One-sentence summary of the chart for screen readers (the chart itself is aria-hidden). */
export function ganttSummary(input: {
  activityCount: number;
  start: ISODate | null;
  end: ISODate | null;
  delayedCount: number;
  unscheduledCount: number;
}): string {
  const parts = [`${pluralize(input.activityCount, "activity", "activities")}`];
  if (input.start && input.end) parts[0] += ` from ${formatDate(input.start)} to ${formatDate(input.end)}`;
  if (input.delayedCount > 0) parts.push(`${pluralize(input.delayedCount, "work package")} delayed`);
  if (input.unscheduledCount > 0) parts.push(`${pluralize(input.unscheduledCount, "work package")} not scheduled yet`);
  return `${parts.join("; ")}.`;
}
