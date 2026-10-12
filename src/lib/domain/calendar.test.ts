import { describe, expect, it } from "vitest";
import {
  CalendarError,
  computeEndDate,
  countWorkingDays,
  createCalendarIndex,
  DEFAULT_WORKING_CALENDAR,
  durationHoursFromDates,
  holidayName,
  isWorkingDay,
  nextWorkingDay,
  nonWorkingReason,
  rescheduleLeaves,
  workingDaysForHours,
  type WorkingCalendar,
} from "./calendar";
import { DomainError, isDomainError } from "./errors";

// Reference week: Mon 2026-10-12 … Sun 2026-10-18.
const MON = "2026-10-12";
const TUE = "2026-10-13";
const WED = "2026-10-14";
const THU = "2026-10-15";
const FRI = "2026-10-16";
const SAT = "2026-10-17";
const SUN = "2026-10-18";
const NEXT_MON = "2026-10-19";

function cal(overrides: Partial<WorkingCalendar> = {}): WorkingCalendar {
  return { ...DEFAULT_WORKING_CALENDAR, holidays: [], overrides: [], ...overrides };
}

const standard = createCalendarIndex(cal());

describe("createCalendarIndex", () => {
  it("rejects non-positive or non-finite hours per day", () => {
    expect(() => createCalendarIndex(cal({ hoursPerDay: 0 }))).toThrow(CalendarError);
    expect(() => createCalendarIndex(cal({ hoursPerDay: -8 }))).toThrow(CalendarError);
    expect(() => createCalendarIndex(cal({ hoursPerDay: Number.NaN }))).toThrow(CalendarError);
  });

  it("ignores out-of-range weekdays and lets the last duplicate override win", () => {
    const index = createCalendarIndex(
      cal({
        workDays: [1, 0, 8, 2.5],
        overrides: [
          { date: TUE, kind: "working" },
          { date: TUE, kind: "nonworking", note: "Replaced" },
        ],
      }),
    );
    expect([...index.workDays]).toEqual([1]);
    expect(isWorkingDay(index, TUE)).toBe(false);
    expect(index.hasAnyWorkingDay).toBe(true);
  });

  it("errors carry a code and are DomainErrors", () => {
    try {
      createCalendarIndex(cal({ hoursPerDay: 0 }));
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect(isDomainError(e, "INVALID_HOURS_PER_DAY")).toBe(true);
      expect((e as CalendarError).name).toBe("CalendarError");
    }
  });
});

describe("isWorkingDay / nonWorkingReason", () => {
  const index = createCalendarIndex(
    cal({
      holidays: [
        { date: WED, name: "Town Fiesta" },
        { date: SAT, name: "Weekend Holiday" },
        { date: THU, name: "Overridden Holiday" },
      ],
      overrides: [
        { date: SUN, kind: "working", note: "Catch-up pour" },
        { date: TUE, kind: "nonworking", note: "Typhoon" },
        { date: THU, kind: "working" },
      ],
    }),
  );

  it("applies the weekday rule", () => {
    expect(isWorkingDay(standard, MON)).toBe(true);
    expect(isWorkingDay(standard, FRI)).toBe(true);
    expect(isWorkingDay(standard, SAT)).toBe(false);
    expect(nonWorkingReason(standard, SAT)).toEqual({ reason: "weekend" });
    expect(nonWorkingReason(standard, MON)).toBeNull();
  });

  it("treats holidays as non-working when the switch is on", () => {
    expect(isWorkingDay(index, WED)).toBe(false);
    expect(nonWorkingReason(index, WED)).toEqual({ reason: "holiday", holidayName: "Town Fiesta" });
    expect(nonWorkingReason(index, SAT)).toEqual({ reason: "holiday", holidayName: "Weekend Holiday" });
  });

  it("treats holidays as normal days when the switch is off", () => {
    const off = createCalendarIndex(cal({ holidaysNonWorking: false, holidays: [{ date: WED, name: "Fiesta" }] }));
    expect(isWorkingDay(off, WED)).toBe(true);
    expect(nonWorkingReason(off, WED)).toBeNull();
    expect(holidayName(off, WED)).toBe("Fiesta");
    expect(holidayName(off, THU)).toBeNull();
  });

  it("override 'working' wins over weekend and over holiday", () => {
    expect(isWorkingDay(index, SUN)).toBe(true);
    expect(isWorkingDay(index, THU)).toBe(true);
    expect(nonWorkingReason(index, THU)).toBeNull();
  });

  it("override 'nonworking' wins over a work day and reports its note", () => {
    expect(isWorkingDay(index, TUE)).toBe(false);
    expect(nonWorkingReason(index, TUE)).toEqual({ reason: "override", note: "Typhoon" });
  });

  it("override on a holiday still reports the holiday name", () => {
    const both = createCalendarIndex(
      cal({ holidays: [{ date: MON, name: "Holiday" }], overrides: [{ date: MON, kind: "nonworking" }] }),
    );
    expect(nonWorkingReason(both, MON)).toEqual({ reason: "override", holidayName: "Holiday" });
  });

  it("supports custom work weeks (Mon–Sat)", () => {
    const sixDay = createCalendarIndex(cal({ workDays: [1, 2, 3, 4, 5, 6] }));
    expect(isWorkingDay(sixDay, SAT)).toBe(true);
    expect(isWorkingDay(sixDay, SUN)).toBe(false);
  });
});

describe("nextWorkingDay", () => {
  it("inclusive returns the same day when it is a working day", () => {
    expect(nextWorkingDay(standard, MON, { inclusive: true })).toBe(MON);
    expect(nextWorkingDay(standard, MON, { inclusive: false })).toBe(TUE);
  });

  it("skips weekends", () => {
    expect(nextWorkingDay(standard, SAT, { inclusive: true })).toBe(NEXT_MON);
    expect(nextWorkingDay(standard, FRI, { inclusive: false })).toBe(NEXT_MON);
  });

  it("crosses the year boundary past holidays", () => {
    const ph = createCalendarIndex(
      cal({
        holidays: [
          { date: "2026-12-30", name: "Rizal Day" },
          { date: "2026-12-31", name: "Last Day of the Year" },
          { date: "2027-01-01", name: "New Year's Day" },
        ],
      }),
    );
    expect(nextWorkingDay(ph, "2026-12-29", { inclusive: false })).toBe("2027-01-04");
  });

  it("throws NO_WORKING_DAYS when every weekday is off", () => {
    const none = createCalendarIndex(cal({ workDays: [] }));
    expect(none.hasAnyWorkingDay).toBe(false);
    expect(() => nextWorkingDay(none, MON, { inclusive: true })).toThrow(CalendarError);
    try {
      nextWorkingDay(none, MON, { inclusive: true });
    } catch (e) {
      expect(isDomainError(e, "NO_WORKING_DAYS")).toBe(true);
    }
  });

  it("finds a lone working override when no weekday works", () => {
    const one = createCalendarIndex(cal({ workDays: [], overrides: [{ date: "2027-03-03", kind: "working" }] }));
    expect(nextWorkingDay(one, MON, { inclusive: true })).toBe("2027-03-03");
    // Beyond the override nothing works: the search gives up instead of looping forever.
    expect(() => nextWorkingDay(one, "2027-03-04", { inclusive: true })).toThrow(CalendarError);
  });

  it("gives up after the search horizon even if work days exist far away", () => {
    // Every Monday is a work day, but 11 years of Mondays are overridden as non-working.
    const overrides = [];
    for (let d = new Date(Date.UTC(2026, 9, 12)); d.getUTCFullYear() < 2037; d.setUTCDate(d.getUTCDate() + 7)) {
      overrides.push({ date: d.toISOString().slice(0, 10), kind: "nonworking" as const });
    }
    const blocked = createCalendarIndex(cal({ workDays: [1], overrides }));
    expect(() => nextWorkingDay(blocked, MON, { inclusive: true })).toThrow(/No working day within 3660 days/);
  });

  it("rejects invalid dates", () => {
    expect(() => nextWorkingDay(standard, "2026-02-30", { inclusive: true })).toThrow(CalendarError);
  });
});

describe("computeEndDate (D20)", () => {
  it("zero hours is a milestone ending on its start, even on a weekend", () => {
    expect(computeEndDate(standard, MON, 0)).toBe(MON);
    expect(computeEndDate(standard, SAT, 0)).toBe(SAT);
  });

  it("8 h at 8 h/day ends the same day", () => {
    expect(computeEndDate(standard, MON, 8)).toBe(MON);
  });

  it("12 h at 8 h/day starting Monday ends Tuesday", () => {
    expect(computeEndDate(standard, MON, 12)).toBe(TUE);
  });

  it("1 h still takes one working day", () => {
    expect(computeEndDate(standard, MON, 1)).toBe(MON);
    expect(computeEndDate(standard, MON, 0.25)).toBe(MON);
  });

  it("40 h fills the week; 48 h spills over the weekend", () => {
    expect(computeEndDate(standard, MON, 40)).toBe(FRI);
    expect(computeEndDate(standard, MON, 48)).toBe(NEXT_MON);
  });

  it("a weekend start moves work to Monday", () => {
    expect(computeEndDate(standard, SAT, 8)).toBe(NEXT_MON);
    expect(computeEndDate(standard, SUN, 16)).toBe("2026-10-20");
  });

  it("holiday at the start shifts the first working day", () => {
    const index = createCalendarIndex(cal({ holidays: [{ date: MON, name: "Holiday" }] }));
    expect(computeEndDate(index, MON, 8)).toBe(TUE);
    expect(computeEndDate(index, MON, 16)).toBe(WED);
  });

  it("holiday at the would-be end pushes the end out", () => {
    const index = createCalendarIndex(cal({ holidays: [{ date: TUE, name: "Holiday" }] }));
    expect(computeEndDate(index, MON, 16)).toBe(WED);
  });

  it("holiday right after the end does not matter", () => {
    const index = createCalendarIndex(cal({ holidays: [{ date: WED, name: "Holiday" }] }));
    expect(computeEndDate(index, MON, 16)).toBe(TUE);
  });

  it("holiday ignored when holidaysNonWorking is off", () => {
    const index = createCalendarIndex(cal({ holidaysNonWorking: false, holidays: [{ date: MON, name: "H" }] }));
    expect(computeEndDate(index, MON, 8)).toBe(MON);
  });

  it("working override on a weekend is used", () => {
    const index = createCalendarIndex(cal({ overrides: [{ date: SAT, kind: "working" }] }));
    expect(computeEndDate(index, FRI, 16)).toBe(SAT);
    expect(computeEndDate(index, SAT, 8)).toBe(SAT);
  });

  it("non-working override inside the span pushes the end", () => {
    const index = createCalendarIndex(cal({ overrides: [{ date: TUE, kind: "nonworking" }] }));
    expect(computeEndDate(index, MON, 24)).toBe(THU);
  });

  it("fractional hours per day (7.5)", () => {
    const index = createCalendarIndex(cal({ hoursPerDay: 7.5 }));
    expect(computeEndDate(index, MON, 7.5)).toBe(MON);
    expect(computeEndDate(index, MON, 15)).toBe(TUE);
    expect(computeEndDate(index, MON, 22.5)).toBe(WED);
    expect(computeEndDate(index, MON, 22.51)).toBe(THU);
    expect(workingDaysForHours(index, 37.5)).toBe(5);
  });

  it("is robust to binary noise in hours", () => {
    expect(workingDaysForHours(standard, 0.1 * 3 * 80)).toBe(3); // 24.000000000000004
  });

  it("crosses year boundaries and leap days", () => {
    // Fri 2027-12-31 + 2 working days → Mon 2028-01-03.
    expect(computeEndDate(standard, "2027-12-31", 16)).toBe("2028-01-03");
    // Mon 2028-02-28, 3 days → Wed 2028-03-01 via the leap day Tue 2028-02-29.
    expect(computeEndDate(standard, "2028-02-28", 24)).toBe("2028-03-01");
    const leapHoliday = createCalendarIndex(cal({ holidays: [{ date: "2028-02-29", name: "Leap" }] }));
    expect(computeEndDate(leapHoliday, "2028-02-28", 16)).toBe("2028-03-01");
  });

  it("handles long durations", () => {
    // 2600 h = 325 working days.
    const end = computeEndDate(standard, "2026-01-01", 2600);
    expect(countWorkingDays(standard, "2026-01-01", end)).toBe(325);
  });

  it("rejects negative, NaN and infinite durations", () => {
    expect(() => computeEndDate(standard, MON, -1)).toThrow(CalendarError);
    expect(() => computeEndDate(standard, MON, Number.NaN)).toThrow(CalendarError);
    expect(() => computeEndDate(standard, MON, Number.POSITIVE_INFINITY)).toThrow(CalendarError);
  });

  it("rejects invalid start dates", () => {
    expect(() => computeEndDate(standard, "2026-13-01", 8)).toThrow(CalendarError);
  });

  it("throws NO_WORKING_DAYS for a calendar with all days off", () => {
    const none = createCalendarIndex(cal({ workDays: [] }));
    expect(() => computeEndDate(none, MON, 8)).toThrow(CalendarError);
    // Milestones don't need a working day.
    expect(computeEndDate(none, MON, 0)).toBe(MON);
  });
});

describe("countWorkingDays / durationHoursFromDates", () => {
  it("counts inclusive working days", () => {
    expect(countWorkingDays(standard, MON, FRI)).toBe(5);
    expect(countWorkingDays(standard, MON, NEXT_MON)).toBe(6);
    expect(countWorkingDays(standard, SAT, SUN)).toBe(0);
    expect(countWorkingDays(standard, MON, MON)).toBe(1);
    expect(countWorkingDays(standard, TUE, MON)).toBe(0);
  });

  it("respects holidays and overrides", () => {
    const index = createCalendarIndex(
      cal({ holidays: [{ date: WED, name: "H" }], overrides: [{ date: SAT, kind: "working" }] }),
    );
    expect(countWorkingDays(index, MON, SUN)).toBe(5);
  });

  it("converts to hours with fractional hours per day", () => {
    expect(durationHoursFromDates(standard, MON, TUE)).toBe(16);
    const index = createCalendarIndex(cal({ hoursPerDay: 7.5 }));
    expect(durationHoursFromDates(index, MON, WED)).toBe(22.5);
    expect(durationHoursFromDates(index, SAT, SUN)).toBe(0);
  });

  it("round-trips with computeEndDate on working-day boundaries", () => {
    const hours = durationHoursFromDates(standard, MON, NEXT_MON);
    expect(computeEndDate(standard, MON, hours)).toBe(NEXT_MON);
  });

  it("rejects invalid dates", () => {
    expect(() => countWorkingDays(standard, "x", MON)).toThrow(CalendarError);
    expect(() => countWorkingDays(standard, MON, "2026-02-29")).toThrow(CalendarError);
  });
});

describe("rescheduleLeaves", () => {
  const leaves = [
    { id: "a", startDate: MON, durationHours: 16, endDate: TUE },
    { id: "b", startDate: MON, durationHours: 8, endDate: MON },
    { id: "c", startDate: THU, durationHours: 0, endDate: THU },
    { id: "d", startDate: WED, durationHours: 24, endDate: FRI },
  ];

  it("returns nothing when no end date changes", () => {
    expect(rescheduleLeaves(leaves, standard)).toEqual([]);
  });

  it("returns only changed rows, keeping start and duration", () => {
    const index = createCalendarIndex(cal({ holidays: [{ date: TUE, name: "New holiday" }] }));
    expect(rescheduleLeaves(leaves, index)).toEqual([
      { id: "a", startDate: MON, durationHours: 16, endDate: WED, previousEndDate: TUE },
    ]);
  });

  it("moves work forward when a Friday becomes non-working", () => {
    const index = createCalendarIndex(cal({ overrides: [{ date: FRI, kind: "nonworking" }] }));
    expect(rescheduleLeaves(leaves, index)).toEqual([
      { id: "d", startDate: WED, durationHours: 24, endDate: NEXT_MON, previousEndDate: FRI },
    ]);
  });

  it("pulls work back when weekends become working", () => {
    const index = createCalendarIndex(cal({ workDays: [1, 2, 3, 4, 5, 6, 7] }));
    const rows = rescheduleLeaves([{ id: "x", startDate: FRI, durationHours: 24, endDate: "2026-10-20" }], index);
    expect(rows).toEqual([{ id: "x", startDate: FRI, durationHours: 24, endDate: SUN, previousEndDate: "2026-10-20" }]);
  });
});
