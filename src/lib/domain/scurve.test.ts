import { describe, expect, it } from "vitest";
import { createCalendarIndex, DEFAULT_WORKING_CALENDAR } from "./calendar";
import { plannedCumulative, plannedPercentAt, sampleSCurve, scurveRange, weeklyRows } from "./scurve";

const cal = createCalendarIndex({ ...DEFAULT_WORKING_CALENDAR });

describe("plannedCumulative", () => {
  // Roadmap fixture (docs/ROADMAP.md P3-08): A ₱30,000 5–9 Oct, B ₱10,000 12–16 Oct 2026.
  const leaves = [
    { start: "2026-10-05", end: "2026-10-09", cost: 30000, hours: 40 },
    { start: "2026-10-12", end: "2026-10-16", cost: 10000, hours: 40 },
  ];
  const curve = plannedCumulative({ leaves, basis: "cost", calendar: cal, range: { start: "2026-10-01", end: "2026-10-20" } });

  it("matches the roadmap fixture", () => {
    expect(plannedPercentAt(curve, "2026-10-07")).toBeCloseTo(45);
    expect(plannedPercentAt(curve, "2026-10-09")).toBeCloseTo(75);
    expect(plannedPercentAt(curve, "2026-10-10")).toBeCloseTo(75); // weekend: flat
    expect(plannedPercentAt(curve, "2026-10-16")).toBeCloseTo(100);
    expect(curve.finish).toBe("2026-10-16");
    expect(curve.total).toBe(40000);
  });

  it("is 0 before the work and flat at 100 % after it", () => {
    expect(plannedPercentAt(curve, "2026-10-02")).toBe(0);
    expect(plannedPercentAt(curve, "2026-09-01")).toBe(0);
    expect(plannedPercentAt(curve, "2026-10-20")).toBeCloseTo(100);
    expect(plannedPercentAt(curve, "2027-01-01")).toBeCloseTo(100);
    expect(curve.points.at(-1)?.value).toBeCloseTo(40000);
  });

  it("weights by hours when asked", () => {
    const byHours = plannedCumulative({ leaves, basis: "hours", calendar: cal, range: { start: "2026-10-01", end: "2026-10-20" } });
    expect(plannedPercentAt(byHours, "2026-10-09")).toBeCloseTo(50);
    expect(byHours.total).toBe(80);
  });

  it("puts a milestone or a non-working span on its end date, and counts undated leaves", () => {
    const c = plannedCumulative({
      leaves: [
        { start: "2026-10-05", end: "2026-10-05", cost: 0, hours: 0 }, // milestone, equal-weight fallback
        { start: "2026-10-10", end: "2026-10-11", cost: 100, hours: 0 }, // weekend only
        { start: null, end: null, cost: 500, hours: 8 },
      ],
      basis: "cost",
      calendar: cal,
      range: { start: "2026-10-05", end: "2026-10-12" },
    });
    expect(c.undatedCount).toBe(1);
    expect(c.datedCount).toBe(2);
    expect(c.usedFallbackWeight).toBe(true);
    expect(plannedPercentAt(c, "2026-10-05")).toBeCloseTo((1 / 101) * 100);
    expect(plannedPercentAt(c, "2026-10-10")).toBeCloseTo((1 / 101) * 100);
    expect(plannedPercentAt(c, "2026-10-11")).toBeCloseTo(100);
    expect(c.finish).toBe("2026-10-11");
  });

  it("counts work before the range from the first day and handles empty input", () => {
    const c = plannedCumulative({ leaves, basis: "cost", calendar: cal, range: { start: "2026-10-12", end: "2026-10-16" } });
    expect(c.points[0].percent).toBeCloseTo(75 + 5); // A done + B's first day
    const empty = plannedCumulative({ leaves: [], basis: "cost", calendar: cal, range: { start: "2026-10-12", end: "2026-10-13" } });
    expect(empty.points.map((p) => p.percent)).toEqual([0, 0]);
    expect(empty.finish).toBeNull();
    expect(plannedPercentAt({ ...empty, points: [] }, "2026-10-12")).toBe(0);
  });

  it("treats a reversed range as one day at its start", () => {
    const c = plannedCumulative({
      leaves: [{ start: "2026-10-07", end: "2026-10-05", cost: 10, hours: 0 }],
      basis: "cost",
      calendar: cal,
      range: { start: "2026-10-05", end: "2026-10-08" },
    });
    expect(plannedPercentAt(c, "2026-10-06")).toBe(0);
    expect(plannedPercentAt(c, "2026-10-07")).toBeCloseTo(100);
  });

  it("computes 5,000 work packages quickly", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      start: `2026-${String(1 + (i % 12)).padStart(2, "0")}-05`,
      end: `2026-${String(1 + (i % 12)).padStart(2, "0")}-20`,
      cost: 1000 + i,
      hours: 8,
    }));
    const t0 = performance.now();
    plannedCumulative({ leaves: many, basis: "cost", calendar: cal, range: { start: "2026-01-01", end: "2026-12-31" } });
    expect(performance.now() - t0).toBeLessThan(150); // roadmap budget: 5,000 leaves < 150 ms
  });
});

describe("scurveRange", () => {
  it("spans project and baseline dates and today while open", () => {
    expect(
      scurveRange({ projectStart: "2026-10-05", projectEnd: "2026-11-30", baselineStart: "2026-10-01", baselineEnd: "2026-12-04", today: "2026-12-10", isOpen: true }),
    ).toEqual({ start: "2026-10-01", end: "2026-12-10" });
    expect(
      scurveRange({ projectStart: "2026-10-05", projectEnd: "2026-11-30", baselineStart: null, baselineEnd: null, today: "2026-12-10", isOpen: false }),
    ).toEqual({ start: "2026-10-05", end: "2026-11-30" });
    expect(
      scurveRange({ projectStart: null, projectEnd: null, baselineStart: null, baselineEnd: null, today: "2026-12-10", isOpen: false }),
    ).toEqual({ start: "2026-12-10", end: "2026-12-10" });
  });
});

describe("sampling and table rows", () => {
  const points = Array.from({ length: 1000 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    percent: i / 10,
    value: i,
  }));

  it("keeps at most ~max points plus the first, last and kept dates", () => {
    const sampled = sampleSCurve(points, 100, ["2026-03-17"]);
    expect(sampled.length).toBeLessThanOrEqual(101);
    expect(sampled[0].date).toBe("2026-01-01");
    expect(sampled.at(-1)?.date).toBe(points.at(-1)?.date);
    expect(sampled.some((p) => p.date === "2026-03-17")).toBe(true);
    expect(sampleSCurve(points.slice(0, 10), 100)).toHaveLength(10);
  });

  it("lists Mondays plus the first and last day", () => {
    const rows = weeklyRows(points.slice(0, 15)); // Thu 1 Jan → Thu 15 Jan 2026
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-05", "2026-01-12", "2026-01-15"]);
    expect(weeklyRows([])).toEqual([]);
    expect(weeklyRows(points.slice(4, 5)).map((r) => r.date)).toEqual(["2026-01-05"]);
  });
});
