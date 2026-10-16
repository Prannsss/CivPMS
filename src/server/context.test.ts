import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import type { Database } from "@/lib/supabase/database.types";
import { isUuid, toProjectOverview } from "./context";

type OverviewRow = Database["public"]["Views"]["project_overview"]["Row"];

const row: OverviewRow = {
  id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  name: "Tower A",
  site_name: null,
  site_address: null,
  description: null,
  start_date: "2026-10-12",
  end_date: "2027-03-31",
  budget: 1_000_000,
  status: "planning",
  status_reason: null,
  is_archived: false,
  weighting: "cost",
  near_budget_threshold: 0.9,
  color: "blue",
  version: 1,
  created_by: null,
  closed_at: null,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
  allocated: 0,
  remaining: 1_000_000,
  leaf_count: 0,
  activity_count: 0,
  completed_count: 0,
  percent_complete: 0,
  budget_state: "ok",
  is_delayed: false,
  unscheduled_count: 0,
  my_project_role: "pm",
  my_company_role: "pm",
};

describe("isUuid", () => {
  it("accepts canonical UUIDs only", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")).toBe(true);
    for (const value of ["abc", "", "11111111111141118111111111111111", "11111111-1111-4111-8111-11111111111g", null, 42]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});

describe("toProjectOverview", () => {
  it("narrows a complete row", () => {
    const project = toProjectOverview(row);
    expect(project?.id).toBe(row.id);
    expect(project?.budget_state).toBe("ok");
  });

  it("keeps nullable columns nullable (e.g. caller roles, site fields)", () => {
    expect(toProjectOverview({ ...row, my_project_role: null, my_company_role: null, site_name: null })).not.toBeNull();
  });

  it("rejects rows missing a NOT NULL column or with an unknown budget state", () => {
    expect(toProjectOverview(null)).toBeNull();
    expect(toProjectOverview(undefined)).toBeNull();
    expect(toProjectOverview({ ...row, id: null })).toBeNull();
    expect(toProjectOverview({ ...row, percent_complete: null })).toBeNull();
    expect(toProjectOverview({ ...row, budget_state: "weird" })).toBeNull();
  });
});
