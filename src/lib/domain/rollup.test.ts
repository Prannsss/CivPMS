import { describe, expect, it } from "vitest";
import { deriveParentStatus, leafWeight, projectRollup, rollupTree } from "./rollup";
import { record } from "./test-fixtures";
import { buildTree, type ActivityRecord } from "./wbs";

function tree(records: ActivityRecord[]) {
  return buildTree(records).roots;
}

describe("leafWeight (§6.5)", () => {
  it("uses the primary basis when positive", () => {
    expect(leafWeight({ estCost: 1000, durationHours: 8 }, "cost")).toEqual({ weight: 1000, usedFallback: false });
    expect(leafWeight({ estCost: 1000, durationHours: 8 }, "hours")).toEqual({ weight: 8, usedFallback: false });
  });

  it("falls back to the other basis, then to equal weight 1", () => {
    expect(leafWeight({ estCost: 0, durationHours: 8 }, "cost")).toEqual({ weight: 8, usedFallback: true });
    expect(leafWeight({ estCost: 500, durationHours: 0 }, "hours")).toEqual({ weight: 500, usedFallback: true });
    expect(leafWeight({ estCost: 0, durationHours: 0 }, "cost")).toEqual({ weight: 1, usedFallback: true });
    expect(leafWeight({ estCost: null, durationHours: null }, "hours")).toEqual({ weight: 1, usedFallback: true });
    expect(leafWeight({ estCost: -5, durationHours: Number.NaN }, "cost")).toEqual({ weight: 1, usedFallback: true });
  });
});

describe("deriveParentStatus (§10.4)", () => {
  it("derives from leaf statuses", () => {
    expect(deriveParentStatus(["completed", "completed"])).toBe("completed");
    expect(deriveParentStatus(["not_started", "not_started"])).toBe("not_started");
    expect(deriveParentStatus(["on_hold", "on_hold"])).toBe("on_hold");
    expect(deriveParentStatus(["completed", "not_started"])).toBe("ongoing");
    expect(deriveParentStatus(["on_hold", "not_started"])).toBe("ongoing");
    expect(deriveParentStatus(["delayed", "delayed"])).toBe("ongoing");
    expect(deriveParentStatus(["ongoing"])).toBe("ongoing");
    expect(deriveParentStatus([])).toBe("not_started");
  });
});

describe("rollupTree", () => {
  const records = [
    record({ id: "D", estCost: 999_999, durationHours: 999, startDate: "2020-01-01", status: "completed", percent: 100 }),
    record({
      id: "W1",
      parentId: "D",
      startDate: "2026-10-12",
      endDate: "2026-10-13",
      durationHours: 16,
      estCost: 30_000,
      status: "completed",
      percent: 100,
    }),
    record({
      id: "W2",
      parentId: "D",
      startDate: "2026-10-14",
      endDate: "2026-10-20",
      durationHours: 40,
      estCost: 10_000,
      status: "ongoing",
      percent: 50,
    }),
    record({ id: "E", startDate: "2026-11-02", endDate: "2026-11-02", durationHours: 8, estCost: 0.1, percent: 0 }),
  ];

  it("leaves use their own values", () => {
    const map = rollupTree(tree(records), { weighting: "cost" });
    expect(map.get("W2")).toEqual({
      isLeaf: true,
      startDate: "2026-10-14",
      endDate: "2026-10-20",
      hours: 40,
      cost: 10_000,
      percent: 50,
      status: "ongoing",
      hasDelayed: false,
      leafCount: 1,
      weight: 10_000,
      usedFallbackWeight: false,
    });
  });

  it("parents ignore their own stored values and derive from leaves (D21)", () => {
    const map = rollupTree(tree(records), { weighting: "cost" });
    expect(map.get("D")).toEqual({
      isLeaf: false,
      startDate: "2026-10-12",
      endDate: "2026-10-20",
      hours: 56,
      cost: 40_000,
      percent: 87.5, // (30000·100 + 10000·50) / 40000
      status: "ongoing",
      hasDelayed: false,
      leafCount: 2,
      weight: 40_000,
      usedFallbackWeight: false,
    });
  });

  it("weights by hours when the project says so", () => {
    const map = rollupTree(tree(records), { weighting: "hours" });
    expect(map.get("D")!.percent).toBeCloseTo((16 * 100 + 40 * 50) / 56, 10);
    expect(map.get("D")!.weight).toBe(56);
  });

  it("falls back cost 0 → hours → equal weight and flags it up the tree", () => {
    const roots = tree([
      record({ id: "P" }),
      record({ id: "a", parentId: "P", estCost: 0, durationHours: 8, percent: 100, status: "completed" }),
      record({ id: "b", parentId: "P", estCost: 0, durationHours: 0, percent: 0 }),
      record({ id: "c", parentId: "P", estCost: 100, durationHours: 8, percent: 50, status: "ongoing" }),
      record({ id: "Q" }),
      record({ id: "q1", parentId: "Q", estCost: 100, percent: 10, status: "ongoing" }),
    ]);
    const map = rollupTree(roots, { weighting: "cost" });
    expect(map.get("a")).toMatchObject({ weight: 8, usedFallbackWeight: true });
    expect(map.get("b")).toMatchObject({ weight: 1, usedFallbackWeight: true });
    expect(map.get("c")).toMatchObject({ weight: 100, usedFallbackWeight: false });
    expect(map.get("P")!.percent).toBeCloseTo((8 * 100 + 1 * 0 + 100 * 50) / 109, 10);
    expect(map.get("P")!.usedFallbackWeight).toBe(true);
    expect(map.get("Q")!.usedFallbackWeight).toBe(false);
  });

  it("all-zero weights become an equal-weight average", () => {
    const roots = tree([
      record({ id: "P" }),
      record({ id: "a", parentId: "P", percent: 100, status: "completed" }),
      record({ id: "b", parentId: "P", percent: 50, status: "ongoing" }),
      record({ id: "c", parentId: "P", percent: 0 }),
    ]);
    expect(rollupTree(roots, { weighting: "hours" }).get("P")!.percent).toBe(50);
  });

  it("rolls up three levels and sums money without drift", () => {
    const roots = tree([
      record({ id: "D" }),
      record({ id: "S1", parentId: "D" }),
      record({ id: "S2", parentId: "D", estCost: 0.2, startDate: "2026-01-05", endDate: "2026-01-05", percent: 0 }),
      record({ id: "W1", parentId: "S1", estCost: 0.1, startDate: "2026-01-01", endDate: "2026-01-02", durationHours: 7.5 }),
      record({ id: "W2", parentId: "S1", estCost: 0.2, startDate: null, endDate: "2026-02-01", durationHours: null }),
    ]);
    const map = rollupTree(roots, { weighting: "cost" });
    expect(map.get("S1")).toMatchObject({ cost: 0.3, hours: 7.5, startDate: "2026-01-01", endDate: "2026-02-01", leafCount: 2 });
    expect(map.get("D")).toMatchObject({ cost: 0.5, startDate: "2026-01-01", endDate: "2026-02-01", leafCount: 3 });
  });

  it("is null-safe for leaves without values", () => {
    const roots = tree([record({ id: "x", percent: Number.NaN, estCost: null, durationHours: null })]);
    expect(rollupTree(roots, { weighting: "cost" }).get("x")).toMatchObject({
      startDate: null,
      endDate: null,
      hours: 0,
      cost: 0,
      percent: 0,
      weight: 1,
    });
  });

  it("clamps out-of-range leaf percents", () => {
    const roots = tree([record({ id: "x", percent: 140, estCost: 1 }), record({ id: "y", percent: -10, estCost: 1 })]);
    const map = rollupTree(roots, { weighting: "cost" });
    expect(map.get("x")!.percent).toBe(100);
    expect(map.get("y")!.percent).toBe(0);
  });

  describe("status derivation with mixed leaves", () => {
    const make = (statuses: ActivityRecord["status"][]) =>
      tree([record({ id: "P" }), ...statuses.map((status, i) => record({ id: `l${i}`, parentId: "P", status }))]);

    it.each([
      [["completed", "completed"], "completed"],
      [["not_started", "not_started"], "not_started"],
      [["on_hold", "on_hold"], "on_hold"],
      [["completed", "not_started"], "ongoing"],
      [["ongoing", "on_hold"], "ongoing"],
      [["delayed", "completed"], "ongoing"],
    ] as const)("%j → %s", (statuses, expected) => {
      expect(rollupTree(make([...statuses]), { weighting: "cost" }).get("P")!.status).toBe(expected);
    });
  });

  describe("hasDelayed", () => {
    const leaves = (overrides: Partial<ActivityRecord>) =>
      tree([
        record({ id: "D" }),
        record({ id: "S", parentId: "D" }),
        record({ id: "W", parentId: "S", status: "ongoing", startDate: "2026-10-01", endDate: "2026-10-10", ...overrides }),
        record({ id: "OK", parentId: "D", status: "ongoing", endDate: "2099-01-01" }),
      ]);

    it("propagates a manual Delayed status", () => {
      const map = rollupTree(leaves({ status: "delayed" }), { weighting: "cost" });
      expect(map.get("W")!.hasDelayed).toBe(true);
      expect(map.get("S")!.hasDelayed).toBe(true);
      expect(map.get("D")!.hasDelayed).toBe(true);
      expect(map.get("OK")!.hasDelayed).toBe(false);
    });

    it("propagates the reported flag", () => {
      expect(rollupTree(leaves({ delayedReported: true }), { weighting: "cost" }).get("D")!.hasDelayed).toBe(true);
    });

    it("propagates ids flagged as derived-delayed", () => {
      const map = rollupTree(leaves({}), { weighting: "cost", delayedIds: new Set(["W"]) });
      expect(map.get("D")!.hasDelayed).toBe(true);
    });

    it("computes derived Delayed when today is given", () => {
      expect(rollupTree(leaves({}), { weighting: "cost", today: "2026-10-11" }).get("D")!.hasDelayed).toBe(true);
      expect(rollupTree(leaves({}), { weighting: "cost", today: "2026-10-10" }).get("D")!.hasDelayed).toBe(false);
      expect(rollupTree(leaves({}), { weighting: "cost" }).get("D")!.hasDelayed).toBe(false);
    });
  });
});

describe("projectRollup", () => {
  it("handles an empty project", () => {
    expect(projectRollup([], { weighting: "cost" })).toEqual({
      startDate: null,
      endDate: null,
      hours: 0,
      cost: 0,
      percent: 0,
      status: "not_started",
      hasDelayed: false,
      leafCount: 0,
      weight: 0,
      usedFallbackWeight: false,
      activityCount: 0,
      incompleteCount: 0,
      incompleteIds: [],
    });
  });

  it("totals all leaves and lists incomplete activities at every level", () => {
    const roots = tree([
      record({ id: "D1" }),
      record({ id: "W1", parentId: "D1", estCost: 300, status: "completed", percent: 100, endDate: "2026-12-01" }),
      record({ id: "W2", parentId: "D1", estCost: 100, status: "ongoing", percent: 20, startDate: "2026-10-01" }),
      record({ id: "D2", estCost: 600, status: "completed", percent: 100 }),
    ]);
    const total = projectRollup(roots, { weighting: "cost" });
    expect(total).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-12-01",
      cost: 1000,
      percent: (300 * 100 + 100 * 20 + 600 * 100) / 1000,
      status: "ongoing",
      leafCount: 3,
      activityCount: 4,
      incompleteCount: 2,
      incompleteIds: ["D1", "W2"],
    });
  });

  it("reports zero incomplete when everything is completed", () => {
    const roots = tree([
      record({ id: "D1" }),
      record({ id: "W1", parentId: "D1", status: "completed", percent: 100 }),
    ]);
    expect(projectRollup(roots, { weighting: "hours" })).toMatchObject({
      status: "completed",
      percent: 100,
      activityCount: 2,
      incompleteCount: 0,
      usedFallbackWeight: true,
    });
  });
});
