import { describe, expect, it } from "vitest";
import { addMonths, DATE_RANGE_PRESETS, endOfMonth, monthGrid, parseDateEntry, parseRangeEntry } from "./date-entry";

const today = "2026-11-22"; // Sunday

describe("parseDateEntry", () => {
  it("reads ISO, day-first and month-name dates", () => {
    expect(parseDateEntry("2026-10-25", today)).toBe("2026-10-25");
    expect(parseDateEntry(" 2026-1-5 ", today)).toBe("2026-01-05");
    expect(parseDateEntry("25/10/2026", today)).toBe("2026-10-25");
    expect(parseDateEntry("5.10.2026", today)).toBe("2026-10-05");
    expect(parseDateEntry("25 Oct 2026", today)).toBe("2026-10-25");
    expect(parseDateEntry("25 october", today)).toBe("2026-10-25");
    expect(parseDateEntry("Oct 25, 2026", today)).toBe("2026-10-25");
    expect(parseDateEntry("December 1", today)).toBe("2026-12-01");
    expect(parseDateEntry("1 Sept 2026", today)).toBe("2026-09-01");
  });

  it("reads words and offsets from today", () => {
    expect(parseDateEntry("today", today)).toBe(today);
    expect(parseDateEntry("Tomorrow", today)).toBe("2026-11-23");
    expect(parseDateEntry("yesterday", today)).toBe("2026-11-21");
    expect(parseDateEntry("+3d", today)).toBe("2026-11-25");
    expect(parseDateEntry("-2w", today)).toBe("2026-11-08");
    expect(parseDateEntry("+1 month", today)).toBe("2026-12-22");
    expect(parseDateEntry("+1y", today)).toBe("2027-11-22");
  });

  it("rejects what isn't a real date", () => {
    for (const bad of ["", "31 Feb 2026", "2026-13-01", "32/01/2026", "next friday", "Octember 3", "12345"]) {
      expect(parseDateEntry(bad, today)).toBeNull();
    }
  });
});

describe("parseRangeEntry", () => {
  it("reads spans that end today", () => {
    expect(parseRangeEntry("7d", today)).toEqual({ from: "2026-11-16", to: today });
    expect(parseRangeEntry("30 days", today)).toEqual({ from: "2026-10-24", to: today });
    expect(parseRangeEntry("2w", today)).toEqual({ from: "2026-11-09", to: today });
    expect(parseRangeEntry("last 3 months", today)).toEqual({ from: "2026-08-23", to: today });
    expect(parseRangeEntry("1y", today)).toEqual({ from: "2025-11-23", to: today });
    expect(parseRangeEntry("0d", today)).toBeNull();
  });

  it("reads preset names and two dates in either order", () => {
    expect(parseRangeEntry("last month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(parseRangeEntry("This month", today)).toEqual({ from: "2026-11-01", to: today });
    expect(parseRangeEntry("1 Oct - 15 Oct 2026", today)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(parseRangeEntry("2026-10-15 to 2026-10-01", today)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(parseRangeEntry("1 Dec 2025 – 3 Jan 2026", today)).toEqual({ from: "2025-12-01", to: "2026-01-03" });
    expect(parseRangeEntry("25 Oct 2026", today)).toEqual({ from: "2026-10-25", to: "2026-10-25" });
    expect(parseRangeEntry("whenever", today)).toBeNull();
  });

  it("presets cover the expected spans", () => {
    const byId = Object.fromEntries(DATE_RANGE_PRESETS.map((p) => [p.id, p.range(today)]));
    expect(byId["7d"]).toEqual({ from: "2026-11-16", to: today });
    expect(byId["yesterday"]).toEqual({ from: "2026-11-21", to: "2026-11-21" });
    expect(byId["this-year"]).toEqual({ from: "2026-01-01", to: today });
  });
});

describe("month helpers", () => {
  it("adds months with day clamping and finds month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(endOfMonth("2026-11-22")).toBe("2026-11-30");
  });

  it("builds a Monday-first grid with whole weeks", () => {
    const grid = monthGrid("2026-11-22"); // 1 Nov 2026 is a Sunday
    expect(grid[0][0]).toBe("2026-10-26");
    expect(grid[0][6]).toBe("2026-11-01");
    expect(grid.at(-1)?.at(-1)).toBe("2026-12-06");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(monthGrid("2027-02-10")).toHaveLength(4); // Feb 2027 starts on a Monday and has 28 days
    expect(monthGrid("2026-02-10")).toHaveLength(5);
  });
});
