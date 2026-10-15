import { describe, expect, it } from "vitest";
import { record } from "@/lib/domain/test-fixtures";
import { buildAttentionItems, delayText, missingText, wbsHref, type AttentionProject } from "./attention";
import { summarizeWork } from "./work-summary";

const TODAY = "2026-10-13";

const base: AttentionProject = {
  id: "p1",
  status: "active",
  endDate: "2026-12-31",
  budget: 1_000_000,
  allocated: 500_000,
  nearBudgetThreshold: 0.9,
  isDelayed: false,
};

describe("summarizeWork", () => {
  it("rolls up a tree with the domain module and lists delayed and unscheduled leaves", () => {
    const work = summarizeWork(
      [
        record({ id: "d1", name: "Earthworks" }),
        record({ id: "w1", parentId: "d1", name: "Excavation", startDate: "2026-10-01", endDate: "2026-10-05", durationHours: 24, estCost: 30_000 }),
        record({ id: "w2", parentId: "d1", name: "Backfill", startDate: "2026-11-02", endDate: "2026-11-03", durationHours: 16, estCost: 10_000, status: "completed", percent: 100 }),
        record({ id: "w3", parentId: "d1", name: "Survey" }),
      ],
      "cost",
      TODAY,
    );
    expect(work.activityCount).toBe(4);
    expect(work.leafCount).toBe(3);
    expect(work.completedLeafCount).toBe(1);
    // w3 has no cost and no hours: equal weight 1.
    expect(work.percent).toBeCloseTo((10_000 * 100) / (30_000 + 10_000 + 1), 5);
    expect(work.delayed.map((a) => a.id)).toEqual(["w1"]);
    expect(work.delayed[0]?.derived).toEqual({ reason: "END_PASSED", days: 8 });
    expect(work.delayed[0]?.wbsCode).toBe("1.1");
    expect(work.unscheduled.map((a) => [a.id, a.missing])).toEqual([["w3", ["start", "duration", "cost"]]]);
    expect(work.incomplete.map((a) => a.wbsCode)).toEqual(["1", "1.1", "1.3"]);
    expect(work.scheduleEnd).toBe("2026-11-03");
  });

  it("handles an empty project", () => {
    const work = summarizeWork([], "hours", TODAY);
    expect(work).toMatchObject({ activityCount: 0, leafCount: 0, percent: 0, scheduleStart: null, delayed: [], unscheduled: [] });
  });
});

describe("buildAttentionItems", () => {
  const emptyWork = summarizeWork([], "cost", TODAY);

  it("asks for the work breakdown when there is none", () => {
    const items = buildAttentionItems({ project: base, work: emptyWork, canManage: true });
    expect(items.map((i) => i.kind)).toEqual(["empty_wbs"]);
    expect(items[0]?.href).toBe("/projects/p1/wbs");
  });

  it("puts overdue and budget problems first, then delayed work", () => {
    const work = summarizeWork(
      [record({ id: "w1", name: "Pour", startDate: "2026-09-01", endDate: "2026-09-10", durationHours: 8, estCost: 1 })],
      "cost",
      TODAY,
    );
    const items = buildAttentionItems({
      project: { ...base, endDate: "2026-09-30", isDelayed: true, allocated: 1_200_000 },
      work,
      canManage: true,
    });
    expect(items.map((i) => i.kind)).toEqual(["project_overdue", "budget_exceeded", "delayed_activity"]);
    expect(items[0]?.title).toBe("13 days past the planned end date");
    expect(items[0]?.href).toBe("/projects/p1/settings");
    expect(items[1]?.title).toBe("Over budget by ₱200,000.00");
    expect(items[2]?.href).toBe(wbsHref("p1", "w1"));
  });

  it("does not link inspectors to settings", () => {
    const items = buildAttentionItems({
      project: { ...base, endDate: "2026-09-30", isDelayed: true },
      work: emptyWork,
      canManage: false,
    });
    expect(items[0]?.href).toBeNull();
  });

  it("warns near the budget limit and when the schedule runs past the end date", () => {
    const work = summarizeWork(
      [record({ id: "w1", name: "Late", startDate: "2027-01-04", endDate: "2027-01-20", durationHours: 8, estCost: 5 })],
      "cost",
      TODAY,
    );
    const items = buildAttentionItems({ project: { ...base, allocated: 950_000 }, work, canManage: true });
    expect(items.map((i) => i.kind)).toEqual(["projected_late", "budget_near"]);
    expect(items[0]?.title).toBe("Scheduled work ends 20 days after the project end date");
    expect(items[1]?.title).toBe("95% of the budget is allocated");
  });

  it("caps activity items and summarises the rest", () => {
    const records = Array.from({ length: 7 }, (_, i) => record({ id: `w${i}`, name: `Item ${i}` }));
    const work = summarizeWork(records, "cost", TODAY);
    const items = buildAttentionItems({ project: base, work, canManage: true });
    expect(items.filter((i) => i.kind === "unscheduled_activity")).toHaveLength(3);
    expect(items.at(-1)).toMatchObject({ kind: "unscheduled_more", title: "4 more work packages without dates or cost" });
  });

  it("skips planning chores for closed projects", () => {
    const work = summarizeWork([record({ id: "w1" })], "cost", TODAY);
    const items = buildAttentionItems({ project: { ...base, status: "completed" }, work, canManage: true });
    expect(items).toEqual([]);
  });
});

describe("texts", () => {
  it("describes missing values and delays in plain language", () => {
    expect(missingText(["start", "cost"])).toBe("Missing start date and cost.");
    expect(missingText(["start", "duration", "cost"])).toBe("Missing start date, duration and cost.");
    expect(delayText({ derived: { reason: "END_PASSED", days: 3 }, reportedDelayed: false, endDate: "2026-10-10", startDate: null })).toBe(
      "Planned end (10 Oct 2026) passed 3 days ago.",
    );
    expect(delayText({ derived: null, reportedDelayed: true, endDate: null, startDate: null })).toBe("Reported as delayed.");
    expect(delayText({ derived: { reason: "START_PASSED", days: 1 }, reportedDelayed: true, endDate: null, startDate: "2026-10-12" })).toBe(
      "Should have started 1 day ago (12 Oct 2026), also reported as delayed.",
    );
  });
});
