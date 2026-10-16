/**
 * Maps stored notifications (`NotificationRecord`) to the bell's display items: an icon family
 * (`NotificationType`) and a tone. Danger is reserved for real alerts (over budget, delayed).
 */
import type { BadgeTone } from "@/components/ui/badge";
import type { NotificationItem, NotificationType } from "@/components/shell/notification-bell";
import type { NotificationRecord } from "@/lib/notifications";

type Presentation = { type: NotificationType; tone?: BadgeTone };

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "primary",
  on_hold: "orange",
  completed: "success",
  cancelled: "neutral",
  planning: "neutral",
};

export function presentNotification(record: Pick<NotificationRecord, "type" | "statusTo">): Presentation {
  switch (record.type) {
    case "invitation_received":
      return { type: "invitation", tone: "primary" };
    case "invitation_accepted":
      return { type: "member", tone: "success" };
    case "invitation_declined":
      return { type: "invitation", tone: "neutral" };
    case "member_joined":
      return { type: "member", tone: "success" };
    case "added_to_project":
      return { type: "project", tone: "primary" };
    case "removed_from_project":
    case "removed_from_company":
      return { type: "system", tone: "orange" };
    case "project_budget_exceeded":
    case "project_delayed":
      return { type: "project", tone: "danger" };
    case "project_status_changed":
      return {
        type: "project",
        tone: (record.statusTo && STATUS_TONES[record.statusTo]) || "neutral",
      };
    default:
      return { type: "system" };
  }
}

/** True for alerts that deserve a warning-styled toast when they arrive live. */
export function isAlertNotification(type: string): boolean {
  return (
    type === "project_budget_exceeded" ||
    type === "project_delayed" ||
    type === "removed_from_project" ||
    type === "removed_from_company"
  );
}

export function toBellItem(record: NotificationRecord, projectNames?: ReadonlyMap<string, string>): NotificationItem {
  const { type, tone } = presentNotification(record);
  return {
    id: record.id,
    type,
    tone,
    title: record.title,
    body: record.body ?? undefined,
    createdAt: record.createdAt,
    read: record.readAt !== null,
    href: record.link ?? undefined,
    projectId: record.projectId,
    // The current name wins (renames); the payload snapshot covers projects you can no longer see.
    projectName: (record.projectId ? projectNames?.get(record.projectId) : undefined) ?? record.projectName,
  };
}
