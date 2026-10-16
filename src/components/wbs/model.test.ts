import { describe, expect, it } from "vitest";
import { createCalendarIndex, DEFAULT_WORKING_CALENDAR } from "@/lib/domain";
import { applyMove, buildSampleStructure, getProjection, indexAmongSiblings, nodeLabel, resolveLeafSchedule } from "./model";

const index = createCalendarIndex({ ...DEFAULT_WORKING_CALENDAR, holidays: [], overrides: [] });

describe("resolveLeafSchedule", () => {
  const leaf = { startDate: "2026-10-12", durationHours: 16, endDate: "2026-10-13" };

  it("recomputes the end from start + duration (D20)", () => {
    const r = resolveLeafSchedule(index, leaf, { durationHours: 48 });
    expect(r).toEqual({ ok: true, endAdjusted: false, schedule: { startDate: "2026-10-12", durationHours: 48, endDate: "2026-10-19" } });
    const moved = resolveLeafSchedule(index, leaf, { startDate: "2026-10-17" });
    expect(moved.ok && moved.schedule.endDate).toBe("2026-10-20");
  });

  it("recomputes the duration when the end date is edited and snaps to a working day", () => {
    const r = resolveLeafSchedule(index, leaf, { endDate: "2026-10-18" });
    expect(r).toEqual({ ok: true, endAdjusted: true, schedule: { startDate: "2026-10-12", durationHours: 40, endDate: "2026-10-16" } });
  });

  it("explains invalid end dates", () => {
    expect(resolveLeafSchedule(index, leaf, { endDate: "2026-10-01" })).toMatchObject({ ok: false, field: "endDate" });
    expect(resolveLeafSchedule(index, { startDate: "2026-10-17", durationHours: 8, endDate: null }, { endDate: "2026-10-18" })).toMatchObject({
      ok: false,
      field: "endDate",
    });
    expect(resolveLeafSchedule(index, { startDate: null, durationHours: null, endDate: null }, { endDate: "2026-10-18" })).toMatchObject({
      ok: false,
    });
  });

  it("keeps partial schedules and milestones", () => {
    expect(resolveLeafSchedule(index, { startDate: null, durationHours: null, endDate: null }, { durationHours: 8 })).toMatchObject({
      ok: true,
      schedule: { startDate: null, durationHours: 8, endDate: null },
    });
    expect(resolveLeafSchedule(index, leaf, { durationHours: 0 })).toMatchObject({ ok: true, schedule: { endDate: "2026-10-12" } });
  });

  it("reports a calendar without working days", () => {
    const none = createCalendarIndex({ ...DEFAULT_WORKING_CALENDAR, workDays: [], holidays: [], overrides: [] });
    expect(resolveLeafSchedule(none, leaf, { durationHours: 8 })).toMatchObject({ ok: false, field: "startDate" });
  });
});

describe("applyMove", () => {
  const records = [
    { id: "a", parentId: null, sortOrder: 0 },
    { id: "b", parentId: null, sortOrder: 1 },
    { id: "a1", parentId: "a", sortOrder: 0 },
    { id: "a2", parentId: "a", sortOrder: 1 },
  ];

  it("reorders siblings", () => {
    const next = applyMove(records, "a2", "a", 0);
    expect(indexAmongSiblings(next, "a2")).toBe(0);
    expect(indexAmongSiblings(next, "a1")).toBe(1);
  });

  it("re-parents and renumbers both lists", () => {
    const next = applyMove(records, "a1", "b", null);
    expect(next.find((r) => r.id === "a1")).toEqual({ id: "a1", parentId: "b", sortOrder: 0 });
    expect(next.find((r) => r.id === "a2")!.sortOrder).toBe(0);
    expect(applyMove(records, "zz", null, 0)).toEqual(records);
  });
});

describe("getProjection", () => {
  const items = [
    { id: "a", parentId: null, depth: 0 },
    { id: "a1", parentId: "a", depth: 1 },
    { id: "b", parentId: null, depth: 0 },
  ];

  it("drops under the previous row when dragged right", () => {
    expect(getProjection(items, "b", "b", 22, 22)).toEqual({ depth: 1, parentId: "a", index: 1 });
  });

  it("keeps the level when not moved sideways, and outdents when dragged left", () => {
    expect(getProjection(items, "a1", "b", 0, 22)).toEqual({ depth: 1, parentId: "b", index: 0 });
    expect(getProjection(items, "a1", "b", -22, 22)).toEqual({ depth: 0, parentId: null, index: 2 });
    expect(getProjection(items, "x", "b", 0, 22)).toBeNull();
  });
});

describe("buildSampleStructure", () => {
  it("creates three deliverables with sequential work packages", () => {
    const sample = buildSampleStructure(index, "2026-10-17");
    expect(sample).toHaveLength(3);
    const first = sample[0]!.workPackages[0]!;
    expect(first).toMatchObject({ startDate: "2026-10-19", durationHours: 40, endDate: "2026-10-23" });
    expect(sample[0]!.workPackages[1]!.startDate).toBe("2026-10-26");
    expect(buildSampleStructure(index, "nope")).toEqual([]);
  });
});

describe("nodeLabel", () => {
  it("calls leaves below the top level work packages", () => {
    expect(nodeLabel({ level: 1, children: [] })).toBe("Deliverable");
    expect(nodeLabel({ level: 2, children: [] })).toBe("Work package");
    expect(nodeLabel({ level: 2, children: [{}] })).toBe("Sub-deliverable");
    expect(nodeLabel({ level: 3, children: [] })).toBe("Work package");
  });
});
