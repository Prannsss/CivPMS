/**
 * Working-calendar math (spec §7, docs/DECISIONS.md D20).
 *
 * Precedence for "is this date a working day?":
 *   1. a per-date override (working / non-working) always wins;
 *   2. otherwise a listed holiday is non-working when `holidaysNonWorking` is on;
 *   3. otherwise the weekday rule (`workDays`, ISO 1 = Mon … 7 = Sun) decides.
 */
import { DomainError, type DomainErrorCode } from "./errors";
import { addDays, isoWeekday, isValidISODate, type ISODate } from "./dates";

export interface CalendarHoliday {
  date: ISODate;
  name: string;
}

export type CalendarOverrideKind = "working" | "nonworking";

export interface CalendarOverride {
  date: ISODate;
  kind: CalendarOverrideKind;
  note?: string | null;
}

export interface WorkingCalendar {
  /** ISO weekdays that are working days (1 = Mon … 7 = Sun). */
  workDays: number[];
  hoursPerDay: number;
  holidaysNonWorking: boolean;
  holidays: CalendarHoliday[];
  overrides: CalendarOverride[];
}

/** Precomputed lookup structure; build once per calendar with `createCalendarIndex`. */
export interface CalendarIndex {
  readonly calendar: WorkingCalendar;
  readonly hoursPerDay: number;
  readonly holidaysNonWorking: boolean;
  readonly workDays: ReadonlySet<number>;
  readonly holidays: ReadonlyMap<ISODate, string>;
  readonly overrides: ReadonlyMap<ISODate, CalendarOverride>;
  /** False when no date can ever be a working day (no work days and no "working" override). */
  readonly hasAnyWorkingDay: boolean;
}

export type CalendarErrorCode = Extract<
  DomainErrorCode,
  "NO_WORKING_DAYS" | "INVALID_HOURS_PER_DAY" | "INVALID_DURATION" | "INVALID_DATE"
>;

export class CalendarError extends DomainError {
  declare readonly code: CalendarErrorCode;

  constructor(code: CalendarErrorCode, message?: string) {
    super(code, message);
    this.name = "CalendarError";
  }
}

/** Search horizon for the next working day (~10 years). Beyond it we give up instead of looping. */
export const WORKING_DAY_SEARCH_LIMIT = 3660;

/** The default template for new projects: Mon–Fri, 8 h/day, holidays non-working (spec §5.1, §7). */
export const DEFAULT_WORKING_CALENDAR: Readonly<WorkingCalendar> = Object.freeze({
  workDays: [1, 2, 3, 4, 5],
  hoursPerDay: 8,
  holidaysNonWorking: true,
  holidays: [],
  overrides: [],
});

const EPSILON = 1e-9;

export function createCalendarIndex(calendar: WorkingCalendar): CalendarIndex {
  if (!Number.isFinite(calendar.hoursPerDay) || calendar.hoursPerDay <= 0) {
    throw new CalendarError("INVALID_HOURS_PER_DAY", `hoursPerDay must be > 0, got ${calendar.hoursPerDay}`);
  }
  const workDays = new Set(calendar.workDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  const holidays = new Map<ISODate, string>();
  for (const h of calendar.holidays) holidays.set(h.date, h.name);
  const overrides = new Map<ISODate, CalendarOverride>();
  // Later entries win, mirroring a list where the newest override replaces an older one.
  for (const o of calendar.overrides) overrides.set(o.date, o);
  const hasAnyWorkingDay = workDays.size > 0 || calendar.overrides.some((o) => o.kind === "working");
  return {
    calendar,
    hoursPerDay: calendar.hoursPerDay,
    holidaysNonWorking: calendar.holidaysNonWorking,
    workDays,
    holidays,
    overrides,
    hasAnyWorkingDay,
  };
}

function assertDate(date: ISODate): void {
  if (!isValidISODate(date)) throw new CalendarError("INVALID_DATE", `Invalid ISO date: ${JSON.stringify(date)}`);
}

export function isWorkingDay(index: CalendarIndex, date: ISODate): boolean {
  const override = index.overrides.get(date);
  if (override) return override.kind === "working";
  if (index.holidaysNonWorking && index.holidays.has(date)) return false;
  return index.workDays.has(isoWeekday(date));
}

export type NonWorkingReason = "weekend" | "holiday" | "override";

export interface NonWorkingInfo {
  reason: NonWorkingReason;
  /** Set when the date is a listed holiday (even if an override is the deciding rule). */
  holidayName?: string;
  /** The override's note, when the reason is an override. */
  note?: string;
}

/**
 * Why a date is not a working day, or null when it is one.
 * 'weekend' means "its weekday is not a work day" (Sat/Sun by default).
 */
export function nonWorkingReason(index: CalendarIndex, date: ISODate): NonWorkingInfo | null {
  if (isWorkingDay(index, date)) return null;
  const holidayName = index.holidays.get(date);
  const override = index.overrides.get(date);
  if (override) {
    const info: NonWorkingInfo = { reason: "override" };
    if (override.note) info.note = override.note;
    if (holidayName !== undefined) info.holidayName = holidayName;
    return info;
  }
  if (holidayName !== undefined) return { reason: "holiday", holidayName };
  return { reason: "weekend" };
}

/** The holiday name listed for a date, regardless of whether holidays are non-working. */
export function holidayName(index: CalendarIndex, date: ISODate): string | null {
  return index.holidays.get(date) ?? null;
}

/**
 * First working day on or after `date` (`inclusive: true`) or strictly after it (`inclusive: false`).
 * Throws `CalendarError('NO_WORKING_DAYS')` if none exists within WORKING_DAY_SEARCH_LIMIT days.
 */
export function nextWorkingDay(index: CalendarIndex, date: ISODate, options: { inclusive: boolean }): ISODate {
  assertDate(date);
  if (!index.hasAnyWorkingDay) {
    throw new CalendarError("NO_WORKING_DAYS", "The working calendar has no working days.");
  }
  let current = options.inclusive ? date : addDays(date, 1);
  for (let i = 0; i < WORKING_DAY_SEARCH_LIMIT; i += 1) {
    if (isWorkingDay(index, current)) return current;
    current = addDays(current, 1);
  }
  throw new CalendarError(
    "NO_WORKING_DAYS",
    `No working day within ${WORKING_DAY_SEARCH_LIMIT} days after ${date}.`,
  );
}

/** Number of whole working days needed for `durationHours` (0 for a milestone). */
export function workingDaysForHours(index: CalendarIndex, durationHours: number): number {
  assertDuration(durationHours);
  if (durationHours === 0) return 0;
  return Math.max(1, Math.ceil(durationHours / index.hoursPerDay - EPSILON));
}

function assertDuration(durationHours: number): void {
  if (!Number.isFinite(durationHours) || durationHours < 0) {
    throw new CalendarError("INVALID_DURATION", `durationHours must be a finite number ≥ 0, got ${durationHours}`);
  }
}

/**
 * End date of a leaf per D20: zero hours is a milestone (end = start, even on a non-working day).
 * Otherwise work starts on the first working day ≥ start and runs ceil(hours / hoursPerDay)
 * working days; the end date is the last of them. 12 h at 8 h/day starting Monday ends Tuesday.
 */
export function computeEndDate(index: CalendarIndex, startDate: ISODate, durationHours: number): ISODate {
  assertDate(startDate);
  const days = workingDaysForHours(index, durationHours);
  if (days === 0) return startDate;
  let current = nextWorkingDay(index, startDate, { inclusive: true });
  for (let i = 1; i < days; i += 1) current = nextWorkingDay(index, current, { inclusive: false });
  return current;
}

/** Working days in the inclusive range [start, end]. 0 when end < start. */
export function countWorkingDays(index: CalendarIndex, start: ISODate, end: ISODate): number {
  assertDate(start);
  assertDate(end);
  let count = 0;
  for (let current = start; current <= end; current = addDays(current, 1)) {
    if (isWorkingDay(index, current)) count += 1;
  }
  return count;
}

/** Duration implied by editing a leaf's end date: working days in [start, end] × hoursPerDay. */
export function durationHoursFromDates(index: CalendarIndex, start: ISODate, end: ISODate): number {
  return countWorkingDays(index, start, end) * index.hoursPerDay;
}

export interface SchedulableLeaf {
  id: string;
  startDate: ISODate;
  durationHours: number;
  endDate: ISODate;
}

export interface RescheduledLeaf extends SchedulableLeaf {
  previousEndDate: ISODate;
}

/**
 * After a calendar change: keeps each leaf's start and duration, recomputes its end date,
 * and returns only the rows whose end date changed (spec §7 "14 activities will move").
 */
export function rescheduleLeaves(
  leaves: ReadonlyArray<SchedulableLeaf>,
  index: CalendarIndex,
): RescheduledLeaf[] {
  const changed: RescheduledLeaf[] = [];
  for (const leaf of leaves) {
    const endDate = computeEndDate(index, leaf.startDate, leaf.durationHours);
    if (endDate !== leaf.endDate) {
      changed.push({
        id: leaf.id,
        startDate: leaf.startDate,
        durationHours: leaf.durationHours,
        endDate,
        previousEndDate: leaf.endDate,
      });
    }
  }
  return changed;
}
