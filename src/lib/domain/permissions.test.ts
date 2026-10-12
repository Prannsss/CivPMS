import { describe, expect, it } from "vitest";
import {
  COMPANY_ROLES,
  companyPermissions,
  companyRoleLabel,
  PROJECT_ROLES,
  projectPermissions,
  projectRoleLabel,
  type ProjectPermissions,
} from "./permissions";

function granted(p: ProjectPermissions): string[] {
  return Object.entries(p)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();
}

describe("labels", () => {
  it("labels roles", () => {
    expect(COMPANY_ROLES.map(companyRoleLabel)).toEqual(["Owner PM", "Project Manager", "Inspector / QA / QC"]);
    expect(PROJECT_ROLES.map(projectRoleLabel)).toEqual(["Project Manager", "Inspector / QA / QC"]);
  });
});

describe("companyPermissions", () => {
  it("Owner PM can do everything", () => {
    expect(companyPermissions("owner_pm")).toEqual({
      canCreateProject: true,
      canManageCompany: true,
      canManageCompanyMembers: true,
      canCreateCompanyInviteCode: true,
      canViewTrash: true,
    });
  });

  it("PM creates projects and invite codes but does not manage the company", () => {
    expect(companyPermissions("pm")).toEqual({
      canCreateProject: true,
      canManageCompany: false,
      canManageCompanyMembers: false,
      canCreateCompanyInviteCode: true,
      canViewTrash: true,
    });
  });

  it("inspectors and users without a company get nothing", () => {
    for (const role of ["inspector", null, undefined] as const) {
      expect(Object.values(companyPermissions(role)).every((v) => v === false)).toBe(true);
    }
  });
});

describe("projectPermissions (§2.2)", () => {
  it("Owner PM has every capability, with or without a project role", () => {
    for (const projectRole of [null, "pm", "inspector"] as const) {
      const p = projectPermissions({ companyRole: "owner_pm", projectRole });
      expect(Object.values(p).every(Boolean)).toBe(true);
    }
  });

  it("project PM manages the project but cannot cancel or delete", () => {
    const p = projectPermissions({ companyRole: "pm", projectRole: "pm" });
    expect(p.canCancel).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(granted(p)).toEqual(
      [
        "canArchive",
        "canChangeStatus",
        "canEditCalendar",
        "canEditProject",
        "canEditWbs",
        "canExport",
        "canImport",
        "canInvite",
        "canManageMembers",
        "canUpdateProgress",
        "canView",
        "canViewLog",
      ].sort(),
    );
  });

  it("inspector views, updates progress, sees the log and exports (A4)", () => {
    const p = projectPermissions({ companyRole: "inspector", projectRole: "inspector" });
    expect(granted(p)).toEqual(["canExport", "canUpdateProgress", "canView", "canViewLog"]);
  });

  it("a PM not assigned to the project sees nothing (Q12)", () => {
    const p = projectPermissions({ companyRole: "pm", projectRole: null });
    expect(granted(p)).toEqual([]);
  });

  it("no role at all gives nothing", () => {
    expect(granted(projectPermissions({ companyRole: null, projectRole: null }))).toEqual([]);
    expect(granted(projectPermissions({ companyRole: undefined, projectRole: undefined }))).toEqual([]);
  });

  it("returns fresh objects (callers may mutate safely)", () => {
    const a = projectPermissions({ companyRole: null, projectRole: null });
    a.canView = true;
    expect(projectPermissions({ companyRole: null, projectRole: null }).canView).toBe(false);
  });
});
