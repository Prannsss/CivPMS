import { describe, expect, it } from "vitest";
import {
  countChanges,
  describeDay,
  markDay,
  monthGrid,
  removeHoliday,
  safeIndex,
  shiftMonth,
  toDraft,
  toggleWorkDay,
  upsertHoliday,
  withoutWeekends,
  type CalendarDraft,
} from "./model";

const base: CalendarDraft = toDraft({
  workDays: [5, 1, 2, 3, 4],
  hoursPerDay: 8,
  holidaysNonWorking: true,
  holidays: [
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-11-30", name: "Bonifacio Day" },
  ],
  overrides: [{ date: "2026-10-17", kind: "working", note: "  " }],
});

describe("toDraft", () => {
  it("sorts days and dates and blanks empty notes", () => {
    expect(base.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(base.holidays.map((h) => h.date)).toEqual(["2026-11-30", "2026-12-25"]);
    expect(base.overrides[0]).toEqual({ date: "2026-10-17", kind: "working", note: null });
  });
});

describe("markDay", () => {
  it("adds a non-working override on a working day with a trimmed note", () => {
    const next = markDay(base, "2026-10-14", false, "  Typhoon ");
    expect(next.overrides).toContainEqual({ date: "2026-10-14", kind: "nonworking", note: "Typhoon" });
  });

  it("removes instead of storing a redundant override", () => {
    // Saturday 17 Oct has a "working" override; marking it non-working just removes the override.
    const next = markDay(base, "2026-10-17", false);
    expect(next.overrides).toEqual([]);
    // Sunday is already non-working.
    expect(markDay(base, "2026-10-18", false).overrides).toEqual(base.overrides);
  });

  it("marks a holiday as a working day", () => {
    const next = markDay(base, "2026-11-30", true, null);
    expect(next.overrides).toContainEqual({ date: "2026-11-30", kind: "working", note: null });
    expect(describeDay(next, safeIndex(next), "2026-11-30")).toMatchObject({ working: true, kind: "override-on" });
  });
});

describe("describeDay", () => {
  const index = safeIndex(base);
  it("explains weekends, holidays and plain days", () => {
    expect(describeDay(base, index, "2026-10-18")).toMatchObject({ working: false, kind: "weekend", label: "Weekend" });
    expect(describeDay(base, index, "2026-12-25")).toMatchObject({ working: false, kind: "holiday", label: "Christmas Day" });
    expect(describeDay(base, index, "2026-10-14")).toMatchObject({ working: true, kind: "working", label: null });
    expect(describeDay(base, index, "2026-10-17")).toMatchObject({ working: true, kind: "override-on" });
  });

  it("shows holidays that are working days when holidays count as working", () => {
    const draft = { ...base, holidaysNonWorking: false };
    expect(describeDay(draft, safeIndex(draft), "2026-11-30")).toMatchObject({ working: true, kind: "holiday-working" });
  });

  it("works without an index (invalid hours being typed)", () => {
    const draft = { ...base, hoursPerDay: 0 };
    expect(safeIndex(draft)).toBeNull();
    expect(describeDay(draft, null, "2026-10-18").working).toBe(false);
  });
});

describe("countChanges", () => {
  it("counts settings and date differences", () => {
    expect(countChanges(base, base).total).toBe(0);
    let draft = withoutWeekends(toggleWorkDay(base, 6, true));
    expect(countChanges(base, draft).total).toBe(0);
    draft = toggleWorkDay(base, 6, true);
    draft = { ...draft, hoursPerDay: 9 };
    draft = upsertHoliday(draft, { date: "2026-11-01", name: "All Saints' Day" });
    draft = removeHoliday(draft, "2026-12-25");
    draft = markDay(draft, "2026-10-14", false, "Rain");
    expect(countChanges(base, draft)).toEqual({ settings: 2, holidays: 2, overrides: 1, total: 5 });
  });

  it("renames and moves holidays", () => {
    const renamed = upsertHoliday(base, { date: "2026-12-25", name: "Christmas" });
    expect(countChanges(base, renamed).holidays).toBe(1);
    const moved = upsertHoliday(base, { date: "2026-12-24", name: "Christmas Eve" }, "2026-12-25");
    expect(moved.holidays.map((h) => h.date)).toEqual(["2026-11-30", "2026-12-24"]);
  });
});

describe("month grid", () => {
  it("covers whole Monday-first weeks", () => {
    const weeks = monthGrid("2026-10");
    expect(weeks[0]![0]!.date).toBe("2026-09-28");
    expect(weeks.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(monthGrid("2021-02")).toHaveLength(4);
    expect(monthGrid("2026-02")).toHaveLength(5);
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("keeps at least one working day when removing weekends", () => {
    const weekendOnly = { ...base, workDays: [6, 7] };
    expect(withoutWeekends(weekendOnly).workDays).toEqual([6, 7]);
  });
});
