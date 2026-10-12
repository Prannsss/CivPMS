import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayMonth,
  formatDuration,
  formatPercent,
  formatPeso,
  formatPesoCompact,
  formatRelativeTime,
  formatTime,
  initials,
  parseDurationInput,
  pluralize,
  pluralWord,
} from "./format";

describe("formatPeso", () => {
  it("formats with grouping and 2 decimals", () => {
    expect(formatPeso(1234567.89)).toBe("₱1,234,567.89");
    expect(formatPeso(0)).toBe("₱0.00");
    expect(formatPeso(5)).toBe("₱5.00");
    expect(formatPeso(1250000.5)).toBe("₱1,250,000.50");
    expect(formatPeso(999_999_999_999.99)).toBe("₱999,999,999,999.99");
  });

  it("formats negatives with the sign before the peso sign", () => {
    expect(formatPeso(-1000)).toBe("-₱1,000.00");
    expect(formatPeso(-0.001)).toBe("₱0.00");
  });

  it("rounds half away from zero (1.005 → 1.01)", () => {
    expect(formatPeso(1.005)).toBe("₱1.01");
    expect(formatPeso(-1.005)).toBe("-₱1.01");
    expect(formatPeso(2.675)).toBe("₱2.68");
    expect(formatPeso(0.994)).toBe("₱0.99");
    expect(formatPeso(999.995)).toBe("₱1,000.00");
  });

  it("returns a dash for missing values", () => {
    expect(formatPeso(null)).toBe("—");
    expect(formatPeso(undefined)).toBe("—");
    expect(formatPeso(Number.NaN)).toBe("—");
    expect(formatPeso(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatPesoCompact", () => {
  it.each([
    [0, "₱0"],
    [0.4, "₱0"],
    [950, "₱950"],
    [999.4, "₱999"],
    [999.6, "₱1K"],
    [1500, "₱1.5K"],
    [950_000, "₱950K"],
    [999_950, "₱1M"],
    [1_234_567, "₱1.2M"],
    [12_500_000, "₱12.5M"],
    [3_500_000_000, "₱3.5B"],
    [2_000_000_000_000, "₱2T"],
    [5_000_000_000_000_000, "₱5,000T"],
    [-1_234_567, "-₱1.2M"],
    [-0.4, "₱0"],
  ])("%d → %s", (value, expected) => {
    expect(formatPesoCompact(value)).toBe(expected);
  });

  it("returns a dash for missing values", () => {
    expect(formatPesoCompact(null)).toBe("—");
    expect(formatPesoCompact(Number.NaN)).toBe("—");
  });
});

describe("formatDate / formatDayMonth / formatDateRange", () => {
  it("formats ISO dates without timezone shifts", () => {
    expect(formatDate("2026-10-10")).toBe("10 Oct 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2028-02-29")).toBe("29 Feb 2028");
    expect(formatDayMonth("2026-10-03")).toBe("3 Oct");
  });

  it("returns a dash for invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("2026-02-30")).toBe("—");
    expect(formatDayMonth(undefined)).toBe("—");
  });

  it("collapses the year when shared", () => {
    expect(formatDateRange("2026-10-10", "2026-12-12")).toBe("10 Oct – 12 Dec 2026");
    expect(formatDateRange("2026-12-20", "2027-01-15")).toBe("20 Dec 2026 – 15 Jan 2027");
    expect(formatDateRange("2026-10-10", "2026-10-10")).toBe("10 Oct 2026");
  });

  it("handles missing sides", () => {
    expect(formatDateRange(null, null)).toBe("—");
    expect(formatDateRange("2026-10-10", null)).toBe("10 Oct 2026 – —");
    expect(formatDateRange(undefined, "2026-10-10")).toBe("— – 10 Oct 2026");
  });
});

describe("formatDateTime / formatTime (Asia/Manila)", () => {
  it("formats in Manila time with a 12-hour clock", () => {
    expect(formatDateTime("2026-10-10T06:32:00Z")).toBe("10 Oct 2026, 2:32 PM");
    expect(formatDateTime(new Date("2026-10-10T06:32:00Z"))).toBe("10 Oct 2026, 2:32 PM");
    expect(formatTime("2026-10-10T06:32:00Z")).toBe("2:32 PM");
  });

  it("crosses the Manila date boundary", () => {
    expect(formatDateTime("2026-10-11T16:30:00Z")).toBe("12 Oct 2026, 12:30 AM");
    expect(formatDateTime("2026-10-11T04:05:00Z")).toBe("11 Oct 2026, 12:05 PM");
    expect(formatDateTime("2026-12-31T16:00:00Z")).toBe("1 Jan 2027, 12:00 AM");
    expect(formatDateTime("2026-10-11T03:59:00Z")).toBe("11 Oct 2026, 11:59 AM");
  });

  it("returns a dash for invalid input", () => {
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("nope")).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  const now = "2026-10-12T06:00:00Z"; // 2:00 PM, 12 Oct in Manila

  it.each([
    ["2026-10-12T05:59:30Z", "just now"],
    ["2026-10-12T06:00:30Z", "just now"], // slight clock skew
    ["2026-10-12T05:55:00Z", "5 min ago"],
    ["2026-10-12T05:00:01Z", "59 min ago"],
    ["2026-10-12T03:00:00Z", "3 h ago"],
    ["2026-10-11T06:00:01Z", "23 h ago"],
    ["2026-10-11T05:00:00Z", "yesterday"],
    ["2026-10-10T16:30:00Z", "yesterday"], // 00:30 on 11 Oct in Manila
    ["2026-10-10T15:30:00Z", "10 Oct"], // 23:30 on 10 Oct in Manila
    ["2026-10-03T02:00:00Z", "3 Oct"],
    ["2025-10-03T02:00:00Z", "3 Oct 2025"],
    ["2026-10-20T02:00:00Z", "20 Oct"], // future beyond a minute shows the date
  ])("%s → %s", (ts, expected) => {
    expect(formatRelativeTime(ts, now)).toBe(expected);
  });

  it("accepts Date objects and rejects invalid input", () => {
    expect(formatRelativeTime(new Date("2026-10-12T05:55:00Z"), new Date(now))).toBe("5 min ago");
    expect(formatRelativeTime("nope", now)).toBe("—");
    expect(formatRelativeTime(now, "nope")).toBe("—");
  });
});

describe("formatPercent", () => {
  it("rounds safely and keeps fixed decimals", () => {
    expect(formatPercent(45)).toBe("45%");
    expect(formatPercent(87.5)).toBe("88%");
    expect(formatPercent(33.333, { decimals: 1 })).toBe("33.3%");
    expect(formatPercent(1.005, { decimals: 2 })).toBe("1.01%");
    expect(formatPercent(50, { decimals: 1 })).toBe("50.0%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("shows hours or days and trims trailing zeros", () => {
    expect(formatDuration(12, "hours", 8)).toBe("12 h");
    expect(formatDuration(12, "days", 8)).toBe("1.5 d");
    expect(formatDuration(16, "days", 8)).toBe("2 d");
    expect(formatDuration(10, "days", 7.5)).toBe("1.33 d");
    expect(formatDuration(7.25, "hours", 8)).toBe("7.25 h");
    expect(formatDuration(1200, "hours", 8)).toBe("1,200 h");
    expect(formatDuration(0, "days", 8)).toBe("0 d");
  });

  it("returns a dash for missing values or bad hours/day", () => {
    expect(formatDuration(null, "hours", 8)).toBe("—");
    expect(formatDuration(8, "days", 0)).toBe("—");
  });
});

describe("parseDurationInput", () => {
  it("parses bare numbers in the current unit", () => {
    expect(parseDurationInput("12", "hours", 8)).toBe(12);
    expect(parseDurationInput("1.5", "days", 8)).toBe(12);
    expect(parseDurationInput(" 1,000 ", "hours", 8)).toBe(1000);
    expect(parseDurationInput(".5", "days", 8)).toBe(4);
    expect(parseDurationInput("0", "days", 8)).toBe(0);
  });

  it("lets an explicit suffix win", () => {
    expect(parseDurationInput("2d", "hours", 8)).toBe(16);
    expect(parseDurationInput("1.5 days", "hours", 7.5)).toBe(11.25);
    expect(parseDurationInput("1 DAY", "hours", 8)).toBe(8);
    expect(parseDurationInput("12h", "days", 8)).toBe(12);
    expect(parseDurationInput("12 hrs", "days", 8)).toBe(12);
    expect(parseDurationInput("3 hours", "days", 8)).toBe(3);
  });

  it("rounds to 2 decimals", () => {
    expect(parseDurationInput("0.333", "days", 8)).toBe(2.66);
  });

  it("returns null for invalid input", () => {
    expect(parseDurationInput("", "hours", 8)).toBeNull();
    expect(parseDurationInput("-2", "hours", 8)).toBeNull();
    expect(parseDurationInput("abc", "hours", 8)).toBeNull();
    expect(parseDurationInput("2 weeks", "hours", 8)).toBeNull();
    expect(parseDurationInput("2", "days", 0)).toBeNull();
  });
});

describe("initials", () => {
  it.each([
    ["Maria Santos", "MS"],
    ["maria", "M"],
    ["Maria Clara de la Cruz", "MC"],
    ["  juan   dela   cruz ", "JC"],
    ["maria.santos@example.com", "MS"],
    ["Élise Ñunez", "ÉÑ"],
    ["", "?"],
    [null, "?"],
    ["@", "?"],
  ])("%j → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("pluralize / pluralWord", () => {
  it("handles singular, plural and custom plurals", () => {
    expect(pluralize(1, "work package")).toBe("1 work package");
    expect(pluralize(0, "work package")).toBe("0 work packages");
    expect(pluralize(11, "work package")).toBe("11 work packages");
    expect(pluralize(2, "activity", "activities")).toBe("2 activities");
    expect(pluralize(1200, "day")).toBe("1,200 days");
    expect(pluralWord(1, "activity", "activities")).toBe("activity");
    expect(pluralWord(3, "activity", "activities")).toBe("activities");
  });
});
