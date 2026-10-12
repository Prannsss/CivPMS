import { describe, expect, it } from "vitest";
import {
  budgetAllocation,
  canArchiveProjectStatus,
  findProjectTransition,
  isOpenProjectStatus,
  isProjectDelayed,
  isProjectStatus,
  PROJECT_STATUSES,
  projectBadges,
  projectStatusLabel,
  projectStatusRequiresReason,
  projectTransitions,
  type ProjectTransitionContext,
} from "./project";

const ownerCtx: ProjectTransitionContext = {
  companyRole: "owner_pm",
  projectRole: null,
  activityCount: 5,
  incompleteCount: 0,
};
const pmCtx: ProjectTransitionContext = { ...ownerCtx, companyRole: "pm", projectRole: "pm" };
const inspectorCtx: ProjectTransitionContext = { ...ownerCtx, companyRole: "inspector", projectRole: "inspector" };

function summary(list: ReturnType<typeof projectTransitions>) {
  return list.map((t) => `${t.to}:${t.allowed ? "yes" : "no"}`);
}

describe("labels and guards", () => {
  it("labels statuses", () => {
    expect(PROJECT_STATUSES.map(projectStatusLabel)).toEqual(["Planning", "Active", "On-Hold", "Completed", "Cancelled"]);
    expect(isProjectStatus("active")).toBe(true);
    expect(isProjectStatus("archived")).toBe(false);
  });

  it("open vs closed and archivable", () => {
    expect(PROJECT_STATUSES.filter(isOpenProjectStatus)).toEqual(["planning", "active", "on_hold"]);
    expect(PROJECT_STATUSES.filter(canArchiveProjectStatus)).toEqual(["completed", "cancelled"]);
  });

  it("reasons are required for On-Hold and Cancelled", () => {
    expect(PROJECT_STATUSES.filter(projectStatusRequiresReason)).toEqual(["on_hold", "cancelled"]);
  });
});

describe("projectTransitions (§5.2)", () => {
  it("lists the graph for each status", () => {
    expect(projectTransitions("planning", ownerCtx).map((t) => t.to)).toEqual(["active", "cancelled"]);
    expect(projectTransitions("active", ownerCtx).map((t) => t.to)).toEqual(["on_hold", "completed", "cancelled"]);
    expect(projectTransitions("on_hold", ownerCtx).map((t) => t.to)).toEqual(["active", "completed", "cancelled"]);
    expect(projectTransitions("completed", ownerCtx).map((t) => t.to)).toEqual(["active"]);
    expect(projectTransitions("cancelled", ownerCtx)).toEqual([]);
  });

  it("Owner PM can do everything", () => {
    expect(summary(projectTransitions("active", ownerCtx))).toEqual(["on_hold:yes", "completed:yes", "cancelled:yes"]);
  });

  it("project PM can do everything except cancel", () => {
    const list = projectTransitions("active", pmCtx);
    expect(summary(list)).toEqual(["on_hold:yes", "completed:yes", "cancelled:no"]);
    expect(list[2]!.blockedReason).toBe("Only the Owner PM can cancel a project.");
  });

  it("a company PM who is not on the project can't change status", () => {
    const list = projectTransitions("planning", { ...pmCtx, projectRole: null });
    expect(summary(list)).toEqual(["active:no", "cancelled:no"]);
    expect(list[0]!.blockedReason).toBe("Only project managers on this project can change its status.");
  });

  it("inspectors and users without a role can't change status", () => {
    expect(summary(projectTransitions("active", inspectorCtx))).toEqual(["on_hold:no", "completed:no", "cancelled:no"]);
    expect(summary(projectTransitions("active", { ...ownerCtx, companyRole: null }))).toEqual([
      "on_hold:no",
      "completed:no",
      "cancelled:no",
    ]);
  });

  it("flags reasons, confirmation and baseline capture", () => {
    const fromPlanning = projectTransitions("planning", ownerCtx);
    expect(fromPlanning[0]).toEqual({
      to: "active",
      allowed: true,
      requiresReason: false,
      requiresConfirmation: false,
      capturesBaseline: true,
    });
    expect(fromPlanning[1]).toMatchObject({ to: "cancelled", requiresReason: true, requiresConfirmation: true });
    const onHold = projectTransitions("active", ownerCtx)[0]!;
    expect(onHold).toMatchObject({ to: "on_hold", requiresReason: true, capturesBaseline: false });
    expect(projectTransitions("on_hold", ownerCtx)[0]).toMatchObject({ to: "active", capturesBaseline: false });
  });

  it("blocks Completed without activities", () => {
    const t = findProjectTransition("active", "completed", { ...pmCtx, activityCount: 0 })!;
    expect(t.allowed).toBe(false);
    expect(t.blockedReason).toBe("Add at least one activity before completing the project.");
  });

  it("blocks Completed while activities are incomplete (singular and plural)", () => {
    expect(findProjectTransition("on_hold", "completed", { ...pmCtx, incompleteCount: 1 })!.blockedReason).toBe(
      "1 activity is not completed yet. Complete them before completing the project.",
    );
    expect(findProjectTransition("active", "completed", { ...ownerCtx, incompleteCount: 12 })!.blockedReason).toBe(
      "12 activities are not completed yet. Complete them before completing the project.",
    );
  });

  it("reopens Completed → Active", () => {
    expect(findProjectTransition("completed", "active", pmCtx)).toMatchObject({ allowed: true });
    expect(findProjectTransition("completed", "active", inspectorCtx)).toMatchObject({ allowed: false });
  });

  it("returns null for edges outside the graph", () => {
    expect(findProjectTransition("cancelled", "active", ownerCtx)).toBeNull();
    expect(findProjectTransition("planning", "completed", ownerCtx)).toBeNull();
  });
});

describe("budgetAllocation (§5.3, §6.4)", () => {
  it("is ok below the threshold", () => {
    expect(budgetAllocation(1_000_000, 899_999.99)).toEqual({
      budget: 1_000_000,
      allocated: 899_999.99,
      remaining: 100_000.01,
      ratio: 0.89999999,
      state: "ok",
    });
  });

  it("is near at exactly 90%", () => {
    expect(budgetAllocation(1_000_000, 900_000)).toMatchObject({ state: "near", ratio: 0.9, remaining: 100_000 });
  });

  it("is near at exactly 100%", () => {
    expect(budgetAllocation(1_000_000, 1_000_000)).toMatchObject({ state: "near", ratio: 1, remaining: 0 });
  });

  it("is exceeded one centavo over", () => {
    expect(budgetAllocation(1_000_000, 1_000_000.01)).toMatchObject({ state: "exceeded", remaining: -0.01 });
  });

  it("compares in centavos, not floats", () => {
    // 0.1 + 0.2 allocated against a 0.3 budget is exactly 100%, not exceeded.
    expect(budgetAllocation(0.3, 0.1 + 0.2).state).toBe("near");
    // 90% of an odd budget.
    expect(budgetAllocation(123.45, 111.11).state).toBe("near");
    expect(budgetAllocation(123.45, 111.1).state).toBe("ok");
  });

  it("supports a custom threshold", () => {
    expect(budgetAllocation(100, 75, 0.75).state).toBe("near");
    expect(budgetAllocation(100, 74.99, 0.75).state).toBe("ok");
  });

  it("handles nothing allocated and a zero budget", () => {
    expect(budgetAllocation(500, 0)).toMatchObject({ state: "ok", ratio: 0, remaining: 500 });
    expect(budgetAllocation(0, 0)).toMatchObject({ state: "ok", ratio: 0, remaining: 0 });
    expect(budgetAllocation(0, 10)).toMatchObject({ state: "exceeded", ratio: Number.POSITIVE_INFINITY, remaining: -10 });
  });
});

describe("isProjectDelayed / projectBadges (§5.3, §5.4)", () => {
  const base = { endDate: "2026-10-10", budget: 1_000_000, allocated: 500_000 };

  it("is delayed after the end date while open", () => {
    expect(isProjectDelayed({ status: "active", endDate: "2026-10-10", today: "2026-10-11" })).toBe(true);
    expect(isProjectDelayed({ status: "planning", endDate: "2026-10-10", today: "2026-10-11" })).toBe(true);
    expect(isProjectDelayed({ status: "on_hold", endDate: "2026-10-10", today: "2026-10-11" })).toBe(true);
  });

  it("is not delayed on the end date, when closed, or without an end date", () => {
    expect(isProjectDelayed({ status: "active", endDate: "2026-10-10", today: "2026-10-10" })).toBe(false);
    expect(isProjectDelayed({ status: "completed", endDate: "2026-10-10", today: "2027-01-01" })).toBe(false);
    expect(isProjectDelayed({ status: "cancelled", endDate: "2026-10-10", today: "2027-01-01" })).toBe(false);
    expect(isProjectDelayed({ status: "active", endDate: null, today: "2027-01-01" })).toBe(false);
  });

  it("combines delay and budget badges", () => {
    expect(projectBadges({ ...base, status: "active", today: "2026-10-15" })).toEqual({
      delayed: true,
      budgetState: "ok",
      overdueDays: 5,
    });
    expect(projectBadges({ ...base, status: "completed", allocated: 2_000_000, today: "2026-10-15" })).toEqual({
      delayed: false,
      budgetState: "exceeded",
      overdueDays: 0,
    });
    expect(projectBadges({ ...base, status: "active", allocated: 950_000, today: "2026-10-01" }).budgetState).toBe("near");
    expect(
      projectBadges({ ...base, status: "active", allocated: 800_000, today: "2026-10-01", threshold: 0.8 }).budgetState,
    ).toBe("near");
  });

  it("clears Delayed when the end date moves into the future (§5.4)", () => {
    expect(projectBadges({ ...base, endDate: "2026-12-31", status: "active", today: "2026-10-15" }).delayed).toBe(false);
  });
});
