import { describe, expect, it } from "vitest";
import { createCalendarIndex, DEFAULT_WORKING_CALENDAR } from "./calendar";
import {
  barGeometry,
  buildGanttRows,
  dateToX,
  finishVarianceDays,
  fitDayWidth,
  ganttSummary,
  nonWorkingRuns,
  projectOverrun,
  scaleForDayWidth,
  timelineHeader,
  timelineRange,
  varianceLabel,
  xToDate,
  ZOOM_DAY_WIDTH,
} from "./gantt";
import { rollupTree } from "./rollup";
import { record } from "./test-fixtures";
import { buildTree } from "./wbs";

const cal = createCalendarIndex({
  ...DEFAULT_WORKING_CALENDAR,
  holidays: [{ date: "2026-11-30", name: "Bonifacio Day" }],
  overrides: [{ date: "2026-10-17", kind: "working", note: "Saturday pour" }],
});

describe("zoom", () => {
  it("maps day widths to header scales", () => {
    expect(scaleForDayWidth(ZOOM_DAY_WIDTH.day)).toBe("day");
    expect(scaleForDayWidth(ZOOM_DAY_WIDTH.week)).toBe("week");
    expect(scaleForDayWidth(ZOOM_DAY_WIDTH.month)).toBe("month");
    expect(scaleForDayWidth(ZOOM_DAY_WIDTH.quarter)).toBe("quarter");
    expect(scaleForDayWidth(24)).toBe("day");
    expect(scaleForDayWidth(2.49)).toBe("quarter");
  });

  it("fits a range into the available width within limits", () => {
    expect(fitDayWidth(100, 1000)).toBe(10);
    expect(fitDayWidth(10, 1000)).toBe(48);
    expect(fitDayWidth(5000, 1000)).toBe(1);
    expect(fitDayWidth(0, 1000)).toBe(ZOOM_DAY_WIDTH.week);
    expect(fitDayWidth(100, 0)).toBe(ZOOM_DAY_WIDTH.week);
  });
});

describe("timelineRange", () => {
  it("pads the project dates to whole weeks plus a spare week each side", () => {
    // Wed 14 Oct 2026 → Fri 30 Oct 2026
    const range = timelineRange({
      projectStart: "2026-10-14",
      projectEnd: "2026-10-30",
      datedStarts: [],
      datedEnds: [],
      today: "2026-10-20",
      isOpen: true,
    });
    expect(range.start).toBe("2026-10-05"); // Monday of the week before
    expect(range.end).toBe("2026-11-08"); // Sunday of the week after
    expect(range.days).toBe(35);
  });

  it("reaches today and late bars while the project is open, not when closed", () => {
    const base = {
      projectStart: "2026-10-12",
      projectEnd: "2026-10-16",
      datedStarts: ["2026-10-12"],
      datedEnds: ["2026-10-23"],
      today: "2026-12-02",
    };
    expect(timelineRange({ ...base, isOpen: true }).end).toBe("2026-12-13");
    expect(timelineRange({ ...base, isOpen: false }).end).toBe("2026-11-01");
  });

  it("falls back to today when nothing is dated", () => {
    const range = timelineRange({
      projectStart: null,
      projectEnd: null,
      datedStarts: [null],
      datedEnds: [null],
      today: "2026-11-21",
      isOpen: true,
    });
    expect(range.start).toBe("2026-11-09");
    expect(range.end).toBe("2026-11-29");
  });
});

describe("geometry", () => {
  const range = { start: "2026-10-05", end: "2026-11-08", days: 35 };

  it("places dates and whole-day bars", () => {
    expect(dateToX(range, "2026-10-05", 10)).toBe(0);
    expect(dateToX(range, "2026-10-12", 10)).toBe(70);
    expect(barGeometry(range, "2026-10-12", "2026-10-16", 10)).toEqual({ x: 70, width: 50 });
    // A reversed range is drawn as one day.
    expect(barGeometry(range, "2026-10-16", "2026-10-12", 10)).toEqual({ x: 110, width: 10 });
  });

  it("maps x back to a date, clamped to the range", () => {
    expect(xToDate(range, 75, 10)).toBe("2026-10-12");
    expect(xToDate(range, -50, 10)).toBe("2026-10-05");
    expect(xToDate(range, 99999, 10)).toBe("2026-11-08");
  });
});

describe("timelineHeader", () => {
  const range = { start: "2026-09-28", end: "2026-11-08", days: 42 };

  it("day scale: months over days, with today and non-working days marked", () => {
    const header = timelineHeader(range, 36, { today: "2026-10-14", calendar: cal });
    expect(header.top.map((s) => s.label)).toEqual(["Sep 2026", "Oct 2026", "Nov 2026"]);
    expect(header.bottom).toHaveLength(42);
    expect(header.bottom.find((s) => s.isToday)?.title).toBe("14 Oct 2026");
    const sat = header.bottom.find((s) => s.key === "day-2026-10-10");
    expect(sat?.isNonWorking).toBe(true);
    // The Saturday override is a working day.
    expect(header.bottom.find((s) => s.key === "day-2026-10-17")?.isNonWorking).toBe(false);
    // Segments are clipped to the range: September shows 3 days.
    expect(header.top[0].width).toBe(3 * 36);
  });

  it("week scale: months over Monday-labelled weeks", () => {
    const header = timelineHeader(range, 16);
    expect(header.bottom[0]).toMatchObject({ label: "28 Sep", title: "Week of 28 Sep 2026", width: 7 * 16 });
    expect(header.bottom).toHaveLength(6);
  });

  it("month and quarter scales: years over months or quarters", () => {
    const wide = { start: "2026-11-02", end: "2027-02-28", days: 119 };
    expect(timelineHeader(wide, 5).top.map((s) => s.label)).toEqual(["2026", "2027"]);
    expect(timelineHeader(wide, 5).bottom.map((s) => s.label)).toEqual(["Nov", "Dec", "Jan", "Feb"]);
    expect(timelineHeader(wide, 2).bottom.map((s) => s.title)).toEqual(["Q4 2026", "Q1 2027"]);
  });
});

describe("nonWorkingRuns", () => {
  it("merges consecutive days and labels weekends, holidays and override notes", () => {
    const withOverride = createCalendarIndex({
      ...DEFAULT_WORKING_CALENDAR,
      holidays: [{ date: "2026-11-30", name: "Bonifacio Day" }],
      overrides: [{ date: "2026-12-01", kind: "nonworking", note: "Site closed" }],
    });
    const range = { start: "2026-11-27", end: "2026-12-02", days: 6 };
    const runs = nonWorkingRuns(withOverride, range, 10);
    expect(runs).toEqual([
      { start: "2026-11-28", end: "2026-12-01", x: 10, width: 40, label: "Bonifacio Day, Site closed" },
    ]);
    const weekendOnly = nonWorkingRuns(cal, { start: "2026-10-09", end: "2026-10-13", days: 5 }, 10);
    expect(weekendOnly).toEqual([{ start: "2026-10-10", end: "2026-10-11", x: 10, width: 20, label: "Weekend" }]);
  });

  it("labels an unnamed override as a non-working day", () => {
    const c = createCalendarIndex({
      ...DEFAULT_WORKING_CALENDAR,
      overrides: [{ date: "2026-10-14", kind: "nonworking" }],
    });
    expect(nonWorkingRuns(c, { start: "2026-10-14", end: "2026-10-14", days: 1 }, 10)[0].label).toBe("Non-working day");
  });
});

describe("buildGanttRows", () => {
  const records = [
    record({ id: "d1", name: "Foundations" }),
    record({ id: "w1", parentId: "d1", name: "Excavation", startDate: "2026-10-12", endDate: "2026-10-13", durationHours: 16, estCost: 30000, status: "completed", percent: 100 }),
    record({ id: "w2", parentId: "d1", name: "Footings", startDate: "2026-10-14", endDate: "2026-10-20", durationHours: 40, estCost: 10000, status: "ongoing", percent: 40 }),
    record({ id: "m1", parentId: "d1", name: "Pour approved", startDate: "2026-10-21", endDate: "2026-10-21", durationHours: 0 }),
    record({ id: "d2", name: "Unscheduled" }),
    record({ id: "w3", parentId: "d2", name: "Roofing", delayedReported: true }),
  ];
  const { roots } = buildTree(records);
  const today = "2026-10-23";
  const rollups = rollupTree(roots, { weighting: "cost", today });

  it("lists rows in WBS order with rolled-up parents", () => {
    const rows = buildGanttRows({ roots, rollups, today });
    expect(rows.map((r) => r.wbsCode)).toEqual(["1", "1.1", "1.2", "1.3", "2", "2.1"]);
    const d1 = rows[0];
    expect(d1).toMatchObject({ isLeaf: false, start: "2026-10-12", end: "2026-10-21", cost: 40000, hours: 56 });
    expect(d1.percent).toBeCloseTo(85); // (30000×100 + 10000×40) / 40000
    expect(d1.containsDelayed).toBe(true);
  });

  it("flags auto-delayed and reported leaves, overdue extensions and milestones", () => {
    const rows = buildGanttRows({ roots, rollups, today });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("w1")?.delay.delayed).toBe(false);
    expect(byId.get("w1")?.overdue).toBeNull(); // completed
    expect(byId.get("w2")).toMatchObject({
      status: "delayed",
      delay: { delayed: true, autoReason: "END_PASSED", reason: "Its end date passed 3 days ago" },
      overdue: { start: "2026-10-21", end: "2026-10-23" },
    });
    // End passed takes precedence over "should have started" (§10.5).
    expect(byId.get("m1")).toMatchObject({ isMilestone: true, delay: { reason: "Its end date passed 2 days ago" } });
    expect(byId.get("w3")).toMatchObject({ start: null, delay: { delayed: true, reason: "Reported as delayed" } });
  });

  it("skips children of collapsed parents", () => {
    const rows = buildGanttRows({ roots, rollups, today, collapsedIds: new Set(["d1"]) });
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2", "w3"]);
    expect(rows[0].isCollapsed).toBe(true);
  });

  it("attaches baseline dates and the finish variance in working days", () => {
    const baseline = new Map([
      ["w2", { start: "2026-10-14", end: "2026-10-16" }],
      ["w1", { start: "2026-10-12", end: "2026-10-14" }],
    ]);
    const rows = buildGanttRows({ roots, rollups, today, baseline, calendar: cal });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("w2")?.finishVariance).toBe(3); // Fri 16 → Tue 20: Sat 17 (working override), Mon, Tue
    expect(byId.get("w1")?.finishVariance).toBe(-1);
    expect(byId.get("m1")?.baseline).toBeNull();
    expect(byId.get("m1")?.finishVariance).toBeNull();
  });

  it("explains a leaf that should have started", () => {
    const { roots: r2 } = buildTree([
      record({ id: "s", startDate: "2026-11-02", endDate: "2026-11-06", durationHours: 40 }),
    ]);
    const rows = buildGanttRows({ roots: r2, rollups: rollupTree(r2, { weighting: "cost" }), today: "2026-11-04" });
    expect(rows[0].delay).toEqual({ delayed: true, autoReason: "START_PASSED", reason: "It should have started 2 days ago" });
  });

  it("marks manually delayed leaves that are not past their dates", () => {
    const { roots: r2 } = buildTree([
      record({ id: "x", startDate: "2026-11-02", endDate: "2026-11-06", durationHours: 40, status: "delayed" }),
    ]);
    const rows = buildGanttRows({ roots: r2, rollups: rollupTree(r2, { weighting: "cost" }), today: "2026-11-03" });
    expect(rows[0].delay).toEqual({ delayed: true, autoReason: null, reason: "Marked as delayed" });
  });
});

describe("variance helpers", () => {
  it("counts working days between finishes, skipping weekends and holidays", () => {
    expect(finishVarianceDays(cal, "2026-11-27", "2026-12-01")).toBe(1); // Mon 30 Nov is a holiday
    expect(finishVarianceDays(cal, "2026-12-01", "2026-11-27")).toBe(-1);
    expect(finishVarianceDays(cal, "2026-11-27", "2026-11-27")).toBe(0);
  });

  it("labels the variance", () => {
    expect(varianceLabel(null)).toBeNull();
    expect(varianceLabel(0)).toBe("On plan");
    expect(varianceLabel(2)).toBe("2 working days behind baseline");
    expect(varianceLabel(-1)).toBe("1 working day ahead of baseline");
  });
});

describe("projectOverrun", () => {
  it("shades from the day after the end to today for open, late projects", () => {
    expect(projectOverrun({ status: "active", endDate: "2026-11-30", today: "2026-12-04" })).toEqual({
      start: "2026-12-01",
      end: "2026-12-04",
      days: 4,
    });
    expect(projectOverrun({ status: "completed", endDate: "2026-11-30", today: "2026-12-04" })).toBeNull();
    expect(projectOverrun({ status: "active", endDate: "2026-11-30", today: "2026-11-30" })).toBeNull();
    expect(projectOverrun({ status: "active", endDate: null, today: "2026-12-04" })).toBeNull();
  });
});

describe("ganttSummary", () => {
  it("summarises for screen readers", () => {
    expect(
      ganttSummary({ activityCount: 12, start: "2026-10-12", end: "2026-11-30", delayedCount: 3, unscheduledCount: 1 }),
    ).toBe("12 activities from 12 Oct 2026 to 30 Nov 2026; 3 work packages delayed; 1 work package not scheduled yet.");
    expect(ganttSummary({ activityCount: 1, start: null, end: null, delayedCount: 0, unscheduledCount: 0 })).toBe("1 activity.");
  });
});
