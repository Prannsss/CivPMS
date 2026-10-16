import { describe, expect, it } from "vitest";
import {
  ACTIVITY_STATUSES,
  activityStatusLabel,
  derivedDelayed,
  isActivityStatus,
  isEscalation,
  percentForStatus,
  statusChangeRequiresNote,
  validateStatusPercent,
} from "./status";

describe("labels", () => {
  it("labels every status", () => {
    expect(ACTIVITY_STATUSES.map(activityStatusLabel)).toEqual([
      "Not Started",
      "Ongoing",
      "Delayed",
      "On-Hold",
      "Completed",
    ]);
  });

  it("guards status strings", () => {
    expect(isActivityStatus("on_hold")).toBe(true);
    expect(isActivityStatus("On-Hold")).toBe(false);
    expect(isActivityStatus(3)).toBe(false);
  });
});

describe("validateStatusPercent (§10.3)", () => {
  it("rejects non-integers and out-of-range values for any status", () => {
    for (const p of [-1, 101, 50.5, Number.NaN]) {
      expect(validateStatusPercent("ongoing", p)).toBe("Progress must be a whole number from 0 to 100.");
    }
  });

  it("Not Started must be 0", () => {
    expect(validateStatusPercent("not_started", 0)).toBeNull();
    expect(validateStatusPercent("not_started", 5)).toMatch(/Not Started activities are at 0%/);
  });

  it("Ongoing must be 1–99", () => {
    expect(validateStatusPercent("ongoing", 1)).toBeNull();
    expect(validateStatusPercent("ongoing", 99)).toBeNull();
    expect(validateStatusPercent("ongoing", 0)).toMatch(/at least 1%/);
    expect(validateStatusPercent("ongoing", 100)).toMatch(/choose Completed/);
  });

  it("Delayed and On-Hold allow 0–99", () => {
    for (const s of ["delayed", "on_hold"] as const) {
      expect(validateStatusPercent(s, 0)).toBeNull();
      expect(validateStatusPercent(s, 99)).toBeNull();
    }
    expect(validateStatusPercent("delayed", 100)).toBe("Delayed activities are below 100%. Enter 0–99% or choose Completed.");
    expect(validateStatusPercent("on_hold", 100)).toBe("On-Hold activities are below 100%. Enter 0–99% or choose Completed.");
  });

  it("Completed must be 100", () => {
    expect(validateStatusPercent("completed", 100)).toBeNull();
    expect(validateStatusPercent("completed", 99)).toMatch(/Completed activities are at 100%/);
  });
});

describe("percentForStatus", () => {
  it("pre-fills a consistent percent", () => {
    expect(percentForStatus("completed", 40)).toBe(100);
    expect(percentForStatus("not_started", 40)).toBe(0);
    expect(percentForStatus("ongoing", 0)).toBe(1);
    expect(percentForStatus("ongoing", 100)).toBe(99);
    expect(percentForStatus("on_hold", 40)).toBe(40);
    expect(percentForStatus("delayed", 39.6)).toBe(40);
    expect(percentForStatus("delayed", Number.NaN)).toBe(0);
  });
});

describe("statusChangeRequiresNote", () => {
  it("requires a note for Delayed, On-Hold and reopening Completed", () => {
    expect(statusChangeRequiresNote("ongoing", "delayed")).toBe(true);
    expect(statusChangeRequiresNote("ongoing", "on_hold")).toBe(true);
    expect(statusChangeRequiresNote("completed", "ongoing")).toBe(true);
    expect(statusChangeRequiresNote("not_started", "ongoing")).toBe(false);
    expect(statusChangeRequiresNote("ongoing", "completed")).toBe(false);
    expect(statusChangeRequiresNote("delayed", "delayed")).toBe(false);
  });
});

describe("derivedDelayed (§10.5, A15)", () => {
  const base = { startDate: "2026-10-01", endDate: "2026-10-10" };

  it("is delayed when the end date has passed and not completed", () => {
    expect(derivedDelayed({ ...base, status: "ongoing", today: "2026-10-15" })).toEqual({
      delayed: true,
      reason: "END_PASSED",
      days: 5,
    });
  });

  it("is not delayed on the end date itself", () => {
    expect(derivedDelayed({ ...base, status: "ongoing", today: "2026-10-10" }).delayed).toBe(false);
  });

  it("end passed wins over start passed", () => {
    expect(derivedDelayed({ ...base, status: "not_started", today: "2026-10-11" })).toEqual({
      delayed: true,
      reason: "END_PASSED",
      days: 1,
    });
  });

  it("is delayed when the start has passed and still Not Started", () => {
    expect(derivedDelayed({ ...base, status: "not_started", today: "2026-10-03" })).toEqual({
      delayed: true,
      reason: "START_PASSED",
      days: 2,
    });
    expect(derivedDelayed({ ...base, status: "not_started", today: "2026-10-01" }).delayed).toBe(false);
  });

  it("a started activity before its end is fine", () => {
    expect(derivedDelayed({ ...base, status: "ongoing", today: "2026-10-03" })).toEqual({
      delayed: false,
      reason: null,
      days: 0,
    });
    expect(derivedDelayed({ ...base, status: "on_hold", today: "2026-10-03" }).delayed).toBe(false);
  });

  it("completed is never derived-delayed", () => {
    expect(derivedDelayed({ ...base, status: "completed", today: "2027-01-01" }).delayed).toBe(false);
  });

  it("is null-safe for missing dates", () => {
    expect(derivedDelayed({ startDate: null, endDate: undefined, status: "not_started", today: "2027-01-01" })).toEqual({
      delayed: false,
      reason: null,
      days: 0,
    });
  });

  it("counts days across a year boundary", () => {
    expect(derivedDelayed({ ...base, endDate: "2026-12-30", status: "ongoing", today: "2027-01-02" }).days).toBe(3);
  });
});

describe("isEscalation (§10.6)", () => {
  it("tags moves to Delayed or On-Hold", () => {
    expect(isEscalation({ status: "ongoing", percent: 40 }, { status: "delayed", percent: 40 })).toBe(true);
    expect(isEscalation({ status: "ongoing", percent: 40 }, { status: "on_hold", percent: 40 })).toBe(true);
    expect(isEscalation({ status: "delayed", percent: 40 }, { status: "on_hold", percent: 40 })).toBe(true);
  });

  it("tags percent decreases", () => {
    expect(isEscalation({ status: "ongoing", percent: 40 }, { status: "ongoing", percent: 30 })).toBe(true);
    expect(isEscalation({ status: "completed", percent: 100 }, { status: "ongoing", percent: 90 })).toBe(true);
  });

  it("does not tag progress or unchanged bad states", () => {
    expect(isEscalation({ status: "ongoing", percent: 40 }, { status: "ongoing", percent: 50 })).toBe(false);
    expect(isEscalation({ status: "delayed", percent: 40 }, { status: "delayed", percent: 40 })).toBe(false);
    expect(isEscalation({ status: "delayed", percent: 40 }, { status: "ongoing", percent: 45 })).toBe(false);
    expect(isEscalation({ status: "not_started", percent: 0 }, { status: "completed", percent: 100 })).toBe(false);
  });
});
