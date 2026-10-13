import { PROJECT_ROLES, isProjectStatus, projectRoleLabel, projectStatusLabel, type ProjectRole } from "@/lib/domain";
import { singleLine } from "./escape";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Brevo tags (the notification type), for filtering in Brevo's logs. */
  tags: string[];
}

function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/** "Project Manager" / "Inspector / QA / QC" for known roles, the cleaned value otherwise. */
export function roleLabel(role: unknown): string {
  const value = typeof role === "string" ? role : "";
  return isProjectRole(value) ? projectRoleLabel(value) : singleLine(value, 60) || "Team member";
}

/** "On-Hold" for `on_hold`; unknown values are shown cleaned. */
export function statusLabel(status: unknown): string {
  const value = typeof status === "string" ? status : "";
  return isProjectStatus(value) ? projectStatusLabel(value) : singleLine(value.replace(/_/g, " "), 40);
}
