/** Serializable data the connected shells receive from the server (see load-shell-data.ts). */
import type { CompanyPermissions, CompanyRole } from "@/lib/domain/permissions";
import type { NotificationFeed } from "@/lib/notifications";
import type { PaletteProject } from "@/server/queries/palette";

export type { PaletteProject } from "@/server/queries/palette";

export interface ShellCompany {
  id: string;
  name: string;
  role: CompanyRole;
  /** "Owner PM", "Project Manager", "Inspector / QA / QC". */
  roleLabel: string;
}

export interface ShellViewer {
  id: string;
  /** Full name, or the email's local part until onboarding sets a name. */
  name: string;
  firstName: string;
  email: string;
  avatarUrl: string | null;
  /** null: the "No company yet" state (spec §4.3). */
  company: ShellCompany | null;
  permissions: CompanyPermissions;
}

export interface ShellData {
  viewer: ShellViewer;
  notifications: NotificationFeed;
  projects: PaletteProject[];
}
