import { describe, expect, it } from "vitest";
import { detailsFormSchema, fromFormValues, rpcFieldToFormField, toFormDefaults, type ProjectDetailsValues } from "./details-schema";

const saved: ProjectDetailsValues = {
  name: "Cebu Coastal Road Widening",
  startDate: "2026-10-26",
  endDate: "2027-07-30",
  budget: 190_000_000,
  siteName: "Talisay",
  siteAddress: "",
  description: "",
  color: "blue",
  weighting: "cost",
  nearBudgetThreshold: 0.9,
};

describe("project details form", () => {
  it("round-trips saved values through the form (threshold as a percentage)", () => {
    const defaults = toFormDefaults(saved);
    expect(defaults.thresholdPercent).toBe(90);
    const parsed = detailsFormSchema.parse(defaults);
    expect(fromFormValues(parsed)).toEqual(saved);
  });

  it("validates with plain-language messages", () => {
    const result = detailsFormSchema.safeParse({ ...toFormDefaults(saved), endDate: "2026-10-01", thresholdPercent: "40", budget: "0" });
    expect(result.success).toBe(false);
    const messages = Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
    expect(messages.endDate).toBe("End date must be on or after 26 Oct 2026.");
    expect(messages.thresholdPercent).toMatch(/at least 50%/);
    expect(messages.budget).toMatch(/more than ₱0.00/);
  });

  it("maps RPC field hints to form fields", () => {
    expect(rpcFieldToFormField("near_budget_threshold")).toBe("nearBudgetThreshold");
    expect(rpcFieldToFormField("start_date")).toBe("startDate");
    expect(rpcFieldToFormField("version")).toBe("version");
  });
});
