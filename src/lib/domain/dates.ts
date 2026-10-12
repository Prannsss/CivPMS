/**
 * Calendar-date helpers. Calendar dates are ISO `YYYY-MM-DD` strings everywhere.
 * All arithmetic is done on UTC midnights so the machine's local timezone can never
 * shift a date by one day. The only clock helper is `todayInManila(now)`.
 */
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { DomainError } from "./errors";

/** An ISO calendar date, `YYYY-MM-DD`. Alias for readability only. */
export type ISODate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True when `value` is a real calendar date written as `YYYY-MM-DD` (rejects 2026-02-30). */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses `YYYY-MM-DD` into a Date at UTC midnight. Throws `DomainError('INVALID_DATE')`. */
export function parseISODate(iso: string): Date {
  if (!isValidISODate(iso)) {
    throw new DomainError("INVALID_DATE", `Invalid ISO date: ${JSON.stringify(iso)}`);
  }
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC maps years 0–99 to 1900–1999; correct it.
  date.setUTCFullYear(y);
  return date;
}

/** Formats a Date's UTC calendar parts as `YYYY-MM-DD`. */
export function toISODate(date: Date): ISODate {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new DomainError("INVALID_DATE", "Invalid Date object");
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Adds (or subtracts, when negative) whole calendar days. */
export function addDays(iso: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) throw new DomainError("INVALID_NUMBER", `addDays expects an integer, got ${days}`);
  const date = parseISODate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Whole calendar days from `b` to `a` (`a − b`), like date-fns `differenceInCalendarDays(a, b)`. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / MS_PER_DAY);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: ISODate): number {
  const day = parseISODate(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Compares two ISO dates: −1 when a < b, 0 when equal, 1 when a > b. */
export function compareISO(a: ISODate, b: ISODate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Earliest of the given dates, ignoring null/undefined/empty. Null when none. */
export function minISO(...dates: ReadonlyArray<ISODate | null | undefined>): ISODate | null {
  let result: ISODate | null = null;
  for (const d of dates) {
    if (d && (result === null || d < result)) result = d;
  }
  return result;
}

/** Latest of the given dates, ignoring null/undefined/empty. Null when none. */
export function maxISO(...dates: ReadonlyArray<ISODate | null | undefined>): ISODate | null {
  let result: ISODate | null = null;
  for (const d of dates) {
    if (d && (result === null || d > result)) result = d;
  }
  return result;
}

/**
 * Calendar date parts of an instant in the business timezone (Asia/Manila).
 * Exported for the formatting helpers; prefer `todayInManila` for "today".
 */
export function zonedParts(
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): { year: number; month: number; day: number; hour: number; minute: number } {
  if (Number.isNaN(instant.getTime())) throw new DomainError("INVALID_DATE", "Invalid Date object");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** Today's calendar date in Asia/Manila. The only clock helper in the domain module. */
export function todayInManila(now: Date = new Date()): ISODate {
  const { year, month, day } = zonedParts(now);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Calendar years touched by the inclusive range [start, end], e.g. 2026-11-01 → 2027-02-01
 * gives [2026, 2027]. Used to know which years of holidays a schedule needs. Empty when end < start.
 */
export function yearsBetween(start: ISODate, end: ISODate): number[] {
  const from = parseISODate(start).getUTCFullYear();
  const to = parseISODate(end).getUTCFullYear();
  const years: number[] = [];
  if (end < start) return years;
  for (let y = from; y <= to; y += 1) years.push(y);
  return years;
}

/** Every calendar date in the inclusive range [start, end]. Empty when end < start. */
export function eachDayISO(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  const total = diffDays(end, start);
  for (let i = 0; i <= total; i += 1) days.push(addDays(start, i));
  return days;
}
