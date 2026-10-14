/**
 * Pure helpers for the working-calendar screen (spec §7): the staged draft, per-day overrides,
 * the month grid and change counting. Working-day rules come from `@/lib/domain` (calendar.ts).
 */
import {
  addDays,
  createCalendarIndex,
  isoWeekday,
  isWorkingDay,
  nonWorkingReason,
  type CalendarIndex,
  type ISODate,
  type WorkingCalendar,
} from "@/lib/domain";

export interface DraftHoliday {
  date: ISODate;
  name: string;
}

export interface DraftOverride {
  date: ISODate;
  kind: "working" | "nonworking";
  note: string | null;
}

export interface CalendarDraft {
  workDays: number[];
  hoursPerDay: number;
  holidaysNonWorking: boolean;
  holidays: DraftHoliday[];
  overrides: DraftOverride[];
}

export const WEEKDAYS = [
  { day: 1, short: "Mon", long: "Monday" },
  { day: 2, short: "Tue", long: "Tuesday" },
  { day: 3, short: "Wed", long: "Wednesday" },
  { day: 4, short: "Thu", long: "Thursday" },
  { day: 5, short: "Fri", long: "Friday" },
  { day: 6, short: "Sat", long: "Saturday" },
  { day: 7, short: "Sun", long: "Sunday" },
] as const;

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Normalises a calendar into a draft (sorted lists, notes as null when empty). */
export function toDraft(calendar: {
  workDays: ReadonlyArray<number>;
  hoursPerDay: number;
  holidaysNonWorking: boolean;
  holidays: ReadonlyArray<{ date: ISODate; name: string }>;
  overrides: ReadonlyArray<{ date: ISODate; kind: "working" | "nonworking"; note?: string | null }>;
}): CalendarDraft {
  return {
    workDays: [...new Set(calendar.workDays)].sort((a, b) => a - b),
    hoursPerDay: calendar.hoursPerDay,
    holidaysNonWorking: calendar.holidaysNonWorking,
    holidays: calendar.holidays.map((h) => ({ date: h.date, name: h.name })).sort(byDate),
    overrides: calendar.overrides
      .map((o) => ({ date: o.date, kind: o.kind, note: o.note?.trim() ? o.note.trim() : null }))
      .sort(byDate),
  };
}

export function toWorkingCalendar(draft: CalendarDraft): WorkingCalendar {
  return {
    workDays: draft.workDays,
    hoursPerDay: draft.hoursPerDay,
    holidaysNonWorking: draft.holidaysNonWorking,
    holidays: draft.holidays,
    overrides: draft.overrides.map((o) => ({ date: o.date, kind: o.kind, ...(o.note ? { note: o.note } : {}) })),
  };
}

/** Index for display; null when the draft can't be indexed (e.g. hours/day being typed). */
export function safeIndex(draft: CalendarDraft): CalendarIndex | null {
  try {
    return createCalendarIndex(toWorkingCalendar(draft));
  } catch {
    return null;
  }
}

export interface DraftChanges {
  settings: number;
  holidays: number;
  overrides: number;
  total: number;
}

function keyed<T extends { date: string }>(items: ReadonlyArray<T>, value: (item: T) => string): Map<string, string> {
  return new Map(items.map((item) => [item.date, value(item)]));
}

function mapDiff(a: Map<string, string>, b: Map<string, string>): number {
  let count = 0;
  for (const [key, value] of a) if (b.get(key) !== value) count += 1;
  for (const key of b.keys()) if (!a.has(key)) count += 1;
  return count;
}

/** How many settings / dates differ between the saved calendar and the draft. */
export function countChanges(saved: CalendarDraft, draft: CalendarDraft): DraftChanges {
  let settings = 0;
  if (saved.workDays.join(",") !== draft.workDays.join(",")) settings += 1;
  if (saved.hoursPerDay !== draft.hoursPerDay) settings += 1;
  if (saved.holidaysNonWorking !== draft.holidaysNonWorking) settings += 1;
  const holidays = mapDiff(
    keyed(saved.holidays, (h) => h.name),
    keyed(draft.holidays, (h) => h.name),
  );
  const overrides = mapDiff(
    keyed(saved.overrides, (o) => `${o.kind}|${o.note ?? ""}`),
    keyed(draft.overrides, (o) => `${o.kind}|${o.note ?? ""}`),
  );
  return { settings, holidays, overrides, total: settings + holidays + overrides };
}

export function overrideOn(draft: CalendarDraft, date: ISODate): DraftOverride | null {
  return draft.overrides.find((o) => o.date === date) ?? null;
}

export function holidayOn(draft: CalendarDraft, date: ISODate): DraftHoliday | null {
  return draft.holidays.find((h) => h.date === date) ?? null;
}

/** Removes the override on `date` (if any). */
export function removeOverride(draft: CalendarDraft, date: ISODate): CalendarDraft {
  return { ...draft, overrides: draft.overrides.filter((o) => o.date !== date) };
}

/**
 * Marks `date` as working or non-working. When the day already is that way without an override
 * (e.g. "non-working" on a Sunday), the override is simply removed, so no redundant rows are stored.
 */
export function markDay(
  draft: CalendarDraft,
  date: ISODate,
  working: boolean,
  note: string | null = null,
): CalendarDraft {
  const without = removeOverride(draft, date);
  const index = safeIndex(without);
  const naturally = index ? isWorkingDay(index, date) : isoWeekdayWorking(without, date);
  if (naturally === working) return without;
  const cleanNote = note?.trim() ? note.trim().slice(0, 200) : null;
  const override: DraftOverride = { date, kind: working ? "working" : "nonworking", note: cleanNote };
  return { ...without, overrides: [...without.overrides, override].sort(byDate) };
}

function isoWeekdayWorking(draft: CalendarDraft, date: ISODate): boolean {
  return draft.workDays.includes(isoWeekday(date));
}

/** Adds or replaces the holiday on `date`. */
export function upsertHoliday(draft: CalendarDraft, holiday: DraftHoliday, previousDate?: ISODate): CalendarDraft {
  const name = holiday.name.trim();
  const rest = draft.holidays.filter((h) => h.date !== holiday.date && h.date !== previousDate);
  return { ...draft, holidays: [...rest, { date: holiday.date, name }].sort(byDate) };
}

export function removeHoliday(draft: CalendarDraft, date: ISODate): CalendarDraft {
  return { ...draft, holidays: draft.holidays.filter((h) => h.date !== date) };
}

/** "Mark all weekends as non-working": drops Saturday and Sunday from the working days. */
export function withoutWeekends(draft: CalendarDraft): CalendarDraft {
  const workDays = draft.workDays.filter((d) => d < 6);
  return { ...draft, workDays: workDays.length > 0 ? workDays : draft.workDays };
}

export function toggleWorkDay(draft: CalendarDraft, day: number, on: boolean): CalendarDraft {
  const set = new Set(draft.workDays);
  if (on) set.add(day);
  else set.delete(day);
  return { ...draft, workDays: [...set].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export interface MonthCell {
  date: ISODate;
  day: number;
  inMonth: boolean;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

/** Weeks (Monday first) covering `month` ("YYYY-MM"); always whole weeks, 4–6 rows. */
export function monthGrid(month: string): MonthCell[][] {
  const first = `${month}-01`;
  const start = addDays(first, -(isoWeekday(first) - 1));
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks: MonthCell[][] = [];
  let cursor = start;
  while (cursor < next || weeks.length === 0) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ date: cursor, day: Number(cursor.slice(8, 10)), inMonth: monthKey(cursor) === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type DayKind = "working" | "weekend" | "holiday" | "override-off" | "override-on" | "holiday-working";

export interface DayInfo {
  working: boolean;
  kind: DayKind;
  /** Short reason for the cell ("Weekend", holiday name, override note). */
  label: string | null;
  holiday: DraftHoliday | null;
  override: DraftOverride | null;
}

/** What a day looks like in the draft, and why. */
export function describeDay(draft: CalendarDraft, index: CalendarIndex | null, date: ISODate): DayInfo {
  const holiday = holidayOn(draft, date);
  const override = overrideOn(draft, date);
  const working = index ? isWorkingDay(index, date) : isoWeekdayWorking(draft, date);
  if (override) {
    return override.kind === "working"
      ? { working, kind: "override-on", label: override.note ?? "Working day", holiday, override }
      : { working, kind: "override-off", label: override.note ?? "Non-working", holiday, override };
  }
  if (!working) {
    const reason = index ? nonWorkingReason(index, date) : null;
    if (reason?.reason === "holiday" && holiday) {
      return { working, kind: "holiday", label: holiday.name, holiday, override };
    }
    const weekend = isoWeekday(date) >= 6;
    return {
      working,
      kind: "weekend",
      label: holiday ? holiday.name : weekend ? "Weekend" : "Rest day",
      holiday,
      override,
    };
  }
  if (holiday) return { working, kind: "holiday-working", label: holiday.name, holiday, override };
  return { working, kind: "working", label: null, holiday, override };
}
