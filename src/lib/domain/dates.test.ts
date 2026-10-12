import { describe, expect, it } from "vitest";
import {
  addDays,
  compareISO,
  diffDays,
  eachDayISO,
  isoWeekday,
  isValidISODate,
  maxISO,
  minISO,
  parseISODate,
  toISODate,
  todayInManila,
  yearsBetween,
  zonedParts,
} from "./dates";
import { DomainError, isDomainError } from "./errors";

describe("isValidISODate", () => {
  it.each(["2026-10-10", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])("accepts %s", (v) => {
    expect(isValidISODate(v)).toBe(true);
  });

  it.each([
    "2026-02-29", // not a leap year
    "1900-02-29", // century, not leap
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-10-00",
    "2026-1-10",
    "26-10-10",
    "2026/10/10",
    "2026-10-10T00:00:00Z",
    " 2026-10-10",
    "",
  ])("rejects %j", (v) => {
    expect(isValidISODate(v)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(undefined)).toBe(false);
    expect(isValidISODate(20261010)).toBe(false);
    expect(isValidISODate(new Date())).toBe(false);
  });
});

describe("parseISODate / toISODate", () => {
  it("round-trips at UTC midnight", () => {
    const d = parseISODate("2026-10-10");
    expect(d.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(toISODate(d)).toBe("2026-10-10");
  });

  it("handles years below 100 without the 19xx shift", () => {
    expect(toISODate(parseISODate("0050-06-15"))).toBe("0050-06-15");
  });

  it("throws a typed error for invalid input", () => {
    expect(() => parseISODate("2026-02-30")).toThrow(DomainError);
    try {
      parseISODate("nope");
    } catch (e) {
      expect(isDomainError(e, "INVALID_DATE")).toBe(true);
      expect(isDomainError(e, "NO_WORKING_DAYS")).toBe(false);
    }
  });

  it("toISODate uses UTC parts and rejects Invalid Date", () => {
    expect(toISODate(new Date("2026-10-11T23:30:00Z"))).toBe("2026-10-11");
    expect(() => toISODate(new Date("x"))).toThrow(DomainError);
  });
});

describe("addDays", () => {
  it("adds and subtracts across month and year boundaries", () => {
    expect(addDays("2026-10-10", 1)).toBe("2026-10-11");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDays("2026-10-10", 0)).toBe("2026-10-10");
  });

  it("handles leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("is not affected by DST-like offsets (pure UTC)", () => {
    // 2026-03-08 is the US DST switch; UTC arithmetic must not care.
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
  });

  it("rejects fractional days", () => {
    expect(() => addDays("2026-10-10", 1.5)).toThrow(DomainError);
  });
});

describe("diffDays", () => {
  it("returns a − b in whole days", () => {
    expect(diffDays("2026-10-12", "2026-10-10")).toBe(2);
    expect(diffDays("2026-10-10", "2026-10-12")).toBe(-2);
    expect(diffDays("2027-01-01", "2026-12-31")).toBe(1);
    expect(diffDays("2029-01-01", "2028-01-01")).toBe(366);
    expect(diffDays("2026-10-10", "2026-10-10")).toBe(0);
  });
});

describe("isoWeekday", () => {
  it("returns 1 for Monday through 7 for Sunday", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("2026-10-16")).toBe(5); // Friday
    expect(isoWeekday("2026-10-17")).toBe(6); // Saturday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(isoWeekday("2028-02-29")).toBe(2); // Tuesday
  });
});

describe("compareISO / minISO / maxISO", () => {
  it("compares", () => {
    expect(compareISO("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareISO("2026-01-02", "2026-01-01")).toBe(1);
    expect(compareISO("2026-01-01", "2026-01-01")).toBe(0);
    expect(["2026-03-01", "2025-12-31", "2026-01-15"].sort(compareISO)).toEqual([
      "2025-12-31",
      "2026-01-15",
      "2026-03-01",
    ]);
  });

  it("min/max ignore empty values", () => {
    expect(minISO("2026-03-01", null, "2026-01-01", undefined, "")).toBe("2026-01-01");
    expect(maxISO("2026-03-01", null, "2026-01-01", undefined)).toBe("2026-03-01");
    expect(minISO()).toBeNull();
    expect(maxISO(null, undefined)).toBeNull();
    expect(minISO(...["2026-05-05", "2026-05-04"])).toBe("2026-05-04");
  });
});

describe("todayInManila", () => {
  it("is the Manila calendar date (UTC+8)", () => {
    expect(todayInManila(new Date("2026-10-11T16:30:00Z"))).toBe("2026-10-12");
    expect(todayInManila(new Date("2026-10-11T15:59:59Z"))).toBe("2026-10-11");
    expect(todayInManila(new Date("2026-10-11T16:00:00Z"))).toBe("2026-10-12");
    expect(todayInManila(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });

  it("defaults to the current clock", () => {
    expect(isValidISODate(todayInManila())).toBe(true);
  });

  it("zonedParts reports hours 0–23 and rejects invalid dates", () => {
    expect(zonedParts(new Date("2026-10-11T16:30:00Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 12,
      hour: 0,
      minute: 30,
    });
    expect(zonedParts(new Date("2026-10-11T16:30:00Z"), "UTC").hour).toBe(16);
    expect(() => zonedParts(new Date("x"))).toThrow(DomainError);
  });
});

describe("yearsBetween / eachDayISO", () => {
  it("lists the calendar years touched", () => {
    expect(yearsBetween("2026-11-01", "2027-02-01")).toEqual([2026, 2027]);
    expect(yearsBetween("2026-01-01", "2026-12-31")).toEqual([2026]);
    expect(yearsBetween("2026-01-01", "2028-01-01")).toEqual([2026, 2027, 2028]);
    expect(yearsBetween("2027-01-01", "2026-01-01")).toEqual([]);
  });

  it("lists every day inclusive", () => {
    expect(eachDayISO("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(eachDayISO("2026-01-02", "2026-01-01")).toEqual([]);
  });
});
