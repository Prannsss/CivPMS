import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/server/queries/audit";
import {
  activeFilterCount,
  auditFiltersToSearchParams,
  cleanSearch,
  decodeAuditCursor,
  describeAuditFilters,
  encodeAuditCursor,
  parseAuditFilters,
} from "./audit-filters";
import { auditCsvFilename, buildAuditCsv, csvCell } from "./audit-csv";
import { dayHeading, entryTone, formatLogValue, groupByDay, observedDiffers, viaLabel } from "./audit-format";

const UID = "f1703cdc-7fc7-4cfc-8408-c0a8b027ae95";

describe("parseAuditFilters", () => {
  it("reads valid filters and ignores the rest", () => {
    const filters = parseAuditFilters({
      person: UID.toUpperCase(),
      type: "status",
      from: "2026-10-01",
      to: "2026-10-31",
      escalations: "1",
      q: "  rebar  ",
    });
    expect(filters).toEqual({ person: UID, type: "status", from: "2026-10-01", to: "2026-10-31", escalations: true, q: "rebar" });
    expect(parseAuditFilters({ person: "x", type: "nope", from: "2026-02-30", escalations: "yes" })).toEqual({
      person: null,
      type: null,
      from: null,
      to: null,
      escalations: false,
      q: null,
    });
  });

  it("accepts the system actor, swaps reversed dates and reads URLSearchParams", () => {
    const filters = parseAuditFilters(new URLSearchParams("person=system&from=2026-10-31&to=2026-10-01"));
    expect(filters.person).toBe("system");
    expect([filters.from, filters.to]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("round-trips through the URL", () => {
    const filters = parseAuditFilters({ q: "budget", type: "project", escalations: "true" });
    const params = auditFiltersToSearchParams(filters);
    expect(params.toString()).toBe("q=budget&type=project&escalations=1");
    expect(parseAuditFilters(params)).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(3);
  });

  it("strips characters that would break the query", () => {
    expect(cleanSearch('a,b (c) "d" 50%*')).toBe("a b c d 50");
    expect(cleanSearch("   ")).toBeNull();
    expect(cleanSearch("x".repeat(300))?.length).toBe(100);
  });

  it("describes filters in plain language", () => {
    expect(describeAuditFilters(parseAuditFilters({}))).toBe("All entries");
    expect(describeAuditFilters(parseAuditFilters({ from: "2026-10-01", escalations: "1", person: UID }), "Maria Santos")).toBe(
      "Person: Maria Santos · From 1 Oct 2026 · Escalations only",
    );
  });
});

describe("cursor", () => {
  it("round-trips and rejects garbage", () => {
    const cursor = { id: 1234, recordedAt: "2026-10-12T22:16:34.483214+00:00" };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
    expect(decodeAuditCursor("nope")).toBeNull();
    expect(decodeAuditCursor("12_2026-13-99Tzz")).toBeNull();
    expect(decodeAuditCursor(null)).toBeNull();
  });
});

describe("audit-format", () => {
  it("groups by Manila day and labels days", () => {
    const groups = groupByDay([
      { recordedAt: "2026-10-12T17:00:00Z" }, // 13 Oct 01:00 Manila
      { recordedAt: "2026-10-12T15:00:00Z" }, // 12 Oct 23:00 Manila
      { recordedAt: "2026-10-12T01:00:00Z" },
    ]);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["2026-10-13", 1],
      ["2026-10-12", 2],
    ]);
    expect(dayHeading("2026-10-13", "2026-10-13")).toBe("Today");
    expect(dayHeading("2026-10-12", "2026-10-13")).toBe("Yesterday");
    expect(dayHeading("2026-10-05", "2026-10-13")).toBe("Monday, 5 Oct 2026");
  });

  it("formats logged values for the CSV", () => {
    expect(formatLogValue("budget", 1200000)).toBe("₱1,200,000.00");
    expect(formatLogValue("est_cost", "2500.5")).toBe("₱2,500.50");
    expect(formatLogValue("end_date", "2026-10-10")).toBe("10 Oct 2026");
    expect(formatLogValue("percent", 40)).toBe("40%");
    expect(formatLogValue("near_budget_threshold", 0.9)).toBe("90%");
    expect(formatLogValue("status", "on_hold")).toBe("on_hold");
    expect(formatLogValue(null, { role: "pm", email: "a@b.c", nested: { x: 1 } })).toBe("Role: pm; Email: a@b.c");
    expect(formatLogValue("x", null)).toBe("");
  });

  it("labels via, tones and observed time", () => {
    expect(viaLabel("invite_code")).toBe("Invite code");
    expect(viaLabel("something_new")).toBe("Something new");
    expect(entryTone({ action: "update", isEscalation: true })).toBe("orange");
    expect(entryTone({ action: "delete", isEscalation: false })).toBe("danger");
    expect(observedDiffers("2026-10-12T10:00:00Z", "2026-10-12T09:30:00Z")).toBe(true);
    expect(observedDiffers("2026-10-12T10:00:00Z", "2026-10-12T10:00:20Z")).toBe(false);
    expect(observedDiffers("2026-10-12T10:00:00Z", null)).toBe(false);
  });
});

function entry(partial: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    recordedAt: "2026-10-12T06:32:00Z",
    observedAt: null,
    actorId: UID,
    actorName: "Maria Santos",
    actorAvatarUrl: null,
    entityType: "project",
    action: "update",
    field: "budget",
    summary: "Budget: ₱1,000,000.00 → ₱1,200,000.00",
    note: null,
    via: "direct",
    wbsCode: null,
    activityName: null,
    activityId: null,
    isEscalation: false,
    oldValue: 1000000,
    newValue: 1200000,
    ...partial,
  };
}

describe("audit CSV", () => {
  it("quotes cells and neutralises formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-₱1,000.00")).toBe('"-₱1,000.00"');
    expect(csvCell(42)).toBe("42");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(null)).toBe("");
  });

  it("builds a file with a preamble, Manila times and pesos", () => {
    const csv = buildAuditCsv({
      projectName: "Cebu Coastal Road",
      generatedAt: new Date("2026-10-13T02:00:00Z"),
      filterSummary: "All entries",
      entries: [entry({}), entry({ id: 2, action: "status_change", field: "status", isEscalation: true, note: "Rain", via: "system", oldValue: "active", newValue: "on_hold", summary: "Status: Active → On-Hold" })],
      truncated: false,
    });
    expect(csv.startsWith("﻿Project,Cebu Coastal Road\r\n")).toBe(true);
    expect(csv).toContain('Audit trail exported,"13 Oct 2026, 10:00 AM (Asia/Manila)"');
    expect(csv).toContain(
      '"12 Oct 2026, 2:32 PM",,Maria Santos,Project,Updated,,,"Budget: ₱1,000,000.00 → ₱1,200,000.00",budget,"₱1,000,000.00","₱1,200,000.00",,Direct update,',
    );
    expect(csv).toContain("Status: Active → On-Hold,status,active,on_hold,Rain,System,Yes");
  });

  it("names the file after the project and the Manila date", () => {
    expect(auditCsvFilename("Davao Drainage Rehabilitation, Phase 2", "2026-10-13")).toBe(
      "davao-drainage-rehabilitation-phase-2-audit-2026-10-13.csv",
    );
    expect(auditCsvFilename("[F3] Ñiño Tower", "2026-10-13")).toBe("f3-nino-tower-audit-2026-10-13.csv");
    expect(auditCsvFilename("!!!", "2026-10-13")).toBe("project-audit-2026-10-13.csv");
  });
});
