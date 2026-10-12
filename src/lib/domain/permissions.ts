/**
 * UI permission flags (spec §2.2). These only hide/disable controls; the database (RLS + RPCs)
 * is the security boundary (CLAUDE.md data-access rule 4).
 */

export const COMPANY_ROLES = ["owner_pm", "pm", "inspector"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PROJECT_ROLES = ["pm", "inspector"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  owner_pm: "Owner PM",
  pm: "Project Manager",
  inspector: "Inspector / QA / QC",
};

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  pm: "Project Manager",
  inspector: "Inspector / QA / QC",
};

export function companyRoleLabel(role: CompanyRole): string {
  return COMPANY_ROLE_LABELS[role];
}

export function projectRoleLabel(role: ProjectRole): string {
  return PROJECT_ROLE_LABELS[role];
}

export interface CompanyPermissions {
  canCreateProject: boolean;
  canManageCompany: boolean;
  canManageCompanyMembers: boolean;
  canCreateCompanyInviteCode: boolean;
  canViewTrash: boolean;
}

/**
 * Company-level capabilities. Owner PM: everything. PM: create projects (A1), create inspector
 * invite codes (D11) and see the trash of what they manage. Inspector / no company: nothing.
 */
export function companyPermissions(role: CompanyRole | null | undefined): CompanyPermissions {
  const isOwner = role === "owner_pm";
  const isPm = isOwner || role === "pm";
  return {
    canCreateProject: isPm,
    canManageCompany: isOwner,
    canManageCompanyMembers: isOwner,
    canCreateCompanyInviteCode: isPm,
    canViewTrash: isPm,
  };
}

export interface ProjectPermissions {
  canView: boolean;
  canEditProject: boolean;
  canEditWbs: boolean;
  canEditCalendar: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canChangeStatus: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canArchive: boolean;
  canViewLog: boolean;
  canUpdateProgress: boolean;
  canExport: boolean;
  canImport: boolean;
}

const NO_PROJECT_ACCESS: ProjectPermissions = {
  canView: false,
  canEditProject: false,
  canEditWbs: false,
  canEditCalendar: false,
  canInvite: false,
  canManageMembers: false,
  canChangeStatus: false,
  canCancel: false,
  canDelete: false,
  canArchive: false,
  canViewLog: false,
  canUpdateProgress: false,
  canExport: false,
  canImport: false,
};

/**
 * Project-level capabilities for the current user.
 * - Owner PM: everything on every company project (with or without a project role).
 * - Project PM: manages the project, but only the Owner PM may cancel (§5.2) or delete it.
 * - Inspector: view, activity log, progress updates at any level, export (A4).
 * - No project role (and not Owner PM): nothing — the project is not visible (§2.2).
 */
export function projectPermissions(input: {
  companyRole: CompanyRole | null | undefined;
  projectRole: ProjectRole | null | undefined;
}): ProjectPermissions {
  const { companyRole, projectRole } = input;
  if (companyRole === "owner_pm") {
    return {
      canView: true,
      canEditProject: true,
      canEditWbs: true,
      canEditCalendar: true,
      canInvite: true,
      canManageMembers: true,
      canChangeStatus: true,
      canCancel: true,
      canDelete: true,
      canArchive: true,
      canViewLog: true,
      canUpdateProgress: true,
      canExport: true,
      canImport: true,
    };
  }
  if (projectRole === "pm") {
    return {
      ...NO_PROJECT_ACCESS,
      canView: true,
      canEditProject: true,
      canEditWbs: true,
      canEditCalendar: true,
      canInvite: true,
      canManageMembers: true,
      canChangeStatus: true,
      canArchive: true,
      canViewLog: true,
      canUpdateProgress: true,
      canExport: true,
      canImport: true,
    };
  }
  if (projectRole === "inspector") {
    return {
      ...NO_PROJECT_ACCESS,
      canView: true,
      canViewLog: true,
      canUpdateProgress: true,
      canExport: true,
    };
  }
  return { ...NO_PROJECT_ACCESS };
}
