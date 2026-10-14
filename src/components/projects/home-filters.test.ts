import { describe, expect, it } from "vitest";
import {
  applyHomeQuery,
  countByFilter,
  homeQueryHref,
  homeSummary,
  matchesSearch,
  needsAttention,
  normalizeSearch,
  parseHomeQuery,
  type FilterableProject,
} from "./home-filters";
import { restoreDaysLabel, restoreDaysLeft, suggestedProjectColor } from "./trash";

function project(overrides: Partial<FilterableProject> & { name: string }): FilterableProject {
  return {
    siteName: null,
    status: "active",
    endDate: "2027-01-31",
    updatedAt: "2026-10-01T00:00:00.000Z",
    isArchived: false,
    isDelayed: false,
    budgetState: "ok",
    ...overrides,
  };
}

const cebu = project({ name: "Cebu Coastal Road Widening", siteName: "Talisay–Minglanilla", updatedAt: "2026-10-12T01:00:00Z", endDate: "2027-07-30" });
const davao = project({ name: "Davao Drainage, Phase 2", isDelayed: true, budgetState: "exceeded", updatedAt: "2026-10-10T00:00:00Z", endDate: "2026-09-30" });
const iloilo = project({ name: "Iloilo Riverside Tower", status: "planning", budgetState: "near", updatedAt: "2026-10-11T00:00:00Z", endDate: "2028-12-15" });
const laguna = project({ name: "Laguna Warehouse", status: "on_hold", siteName: "Calamba, Laguna", updatedAt: "2026-09-01T00:00:00Z", endDate: "2027-11-26" });
const pasig = project({ name: "Pasig Ferry Terminal", status: "cancelled", isArchived: true, budgetState: "exceeded", updatedAt: "2026-08-01T00:00:00Z" });
const done = project({ name: "Bohol Bridge", status: "completed", budgetState: "near", updatedAt: "2026-07-01T00:00:00Z" });
const all = [cebu, davao, iloilo, laguna, pasig, done];

describe("needsAttention", () => {
  it("flags open projects that are delayed or near/over budget", () => {
    expect(needsAttention(davao)).toBe(true);
    expect(needsAttention(iloilo)).toBe(true);
    expect(needsAttention(cebu)).toBe(false);
  });
  it("ignores archived and closed projects", () => {
    expect(needsAttention(pasig)).toBe(false);
    expect(needsAttention(done)).toBe(false);
  });
});

describe("applyHomeQuery", () => {
  it("shows every non-archived project under All, most recently updated first", () => {
    expect(applyHomeQuery(all, { filter: "all", q: "", sort: "updated" }).map((p) => p.name)).toEqual([
      cebu.name,
      iloilo.name,
      davao.name,
      laguna.name,
      done.name,
    ]);
  });
  it("filters by status", () => {
    expect(applyHomeQuery(all, { filter: "on_hold", q: "", sort: "updated" })).toEqual([laguna]);
    expect(applyHomeQuery(all, { filter: "completed", q: "", sort: "updated" })).toEqual([done]);
  });
  it("lists archived projects only under Archived", () => {
    expect(applyHomeQuery(all, { filter: "archived", q: "", sort: "updated" })).toEqual([pasig]);
    expect(applyHomeQuery(all, { filter: "all", q: "pasig", sort: "updated" })).toEqual([]);
  });
  it("sorts by name and by end date", () => {
    expect(applyHomeQuery(all, { filter: "all", q: "", sort: "name" }).map((p) => p.name)[0]).toBe("Bohol Bridge");
    expect(applyHomeQuery(all, { filter: "attention", q: "", sort: "end" })).toEqual([davao, iloilo]);
  });
  it("searches name and site, ignoring case and accents", () => {
    expect(applyHomeQuery(all, { filter: "all", q: "calamba", sort: "updated" })).toEqual([laguna]);
    expect(applyHomeQuery(all, { filter: "all", q: "  ROAD   cebu ", sort: "updated" })).toEqual([cebu]);
  });
});

describe("search helpers", () => {
  it("normalizes accents and whitespace", () => {
    expect(normalizeSearch("  Parañaque   Ñino ")).toBe("paranaque nino");
  });
  it("needs every word to match", () => {
    expect(matchesSearch(cebu, "talisay widening")).toBe(true);
    expect(matchesSearch(cebu, "talisay davao")).toBe(false);
    expect(matchesSearch(cebu, "")).toBe(true);
  });
});

describe("countByFilter", () => {
  it("counts each segment", () => {
    expect(countByFilter(all)).toEqual({
      all: 5,
      active: 2,
      planning: 1,
      on_hold: 1,
      completed: 1,
      attention: 2,
      archived: 1,
    });
  });
  it("applies the search to the counts", () => {
    expect(countByFilter(all, "laguna").all).toBe(1);
    expect(countByFilter(all, "laguna").active).toBe(0);
  });
});

describe("URL state", () => {
  it("parses known values and falls back for unknown ones", () => {
    expect(parseHomeQuery(new URLSearchParams("status=archived&q=cebu&sort=end"))).toEqual({
      filter: "archived",
      q: "cebu",
      sort: "end",
    });
    expect(parseHomeQuery(new URLSearchParams("status=bogus&sort=<x>"))).toEqual({ filter: "all", q: "", sort: "updated" });
  });
  it("leaves defaults out of the URL and keeps other params", () => {
    expect(homeQueryHref({ filter: "all", q: "", sort: "updated" })).toBe("/");
    expect(homeQueryHref({ filter: "attention", q: " road ", sort: "name" })).toBe("/?status=attention&q=road&sort=name");
    expect(homeQueryHref({ filter: "all", q: "", sort: "updated" }, "new=1&status=active")).toBe("/?new=1");
  });
});

describe("homeSummary", () => {
  it("counts open projects and those needing attention", () => {
    expect(homeSummary(all)).toBe("5 projects · 2 need attention");
    expect(homeSummary([cebu, iloilo])).toBe("2 projects · 1 needs attention");
    expect(homeSummary([cebu])).toBe("1 project · all on track");
    expect(homeSummary([pasig])).toBe("No open projects");
  });
});

describe("trash helpers", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  it("rounds days left up and stops at zero", () => {
    expect(restoreDaysLeft("2026-11-12T00:00:00Z", now)).toBe(30);
    expect(restoreDaysLeft("2026-10-13T05:00:00Z", now)).toBe(1);
    expect(restoreDaysLeft("2026-10-12T00:00:00Z", now)).toBe(0);
    expect(restoreDaysLeft("not a date", now)).toBe(0);
  });
  it("labels days left", () => {
    expect(restoreDaysLabel(1)).toBe("1 day left to restore");
    expect(restoreDaysLabel(29)).toBe("29 days left to restore");
    expect(restoreDaysLabel(0)).toBe("Can't be restored anymore");
  });
  it("cycles the card palette", () => {
    expect(suggestedProjectColor(0)).toBe("blue");
    expect(suggestedProjectColor(1)).toBe("green");
    expect(suggestedProjectColor(6)).toBe("blue");
  });
});
