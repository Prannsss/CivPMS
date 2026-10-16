import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, type NotificationRecord } from "@/lib/notifications";
import { isAlertNotification, presentNotification, toBellItem } from "./notification-items";

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "n1",
    type: "added_to_project",
    title: "You were added to Cebu Coastal Road Widening",
    body: "Maria Santos added you as Inspector.",
    link: "/projects/p1",
    projectId: "p1",
    projectName: "Cebu (old name)",
    statusTo: null,
    readAt: null,
    createdAt: "2026-10-13T01:00:00.000Z",
    ...overrides,
  };
}

describe("presentNotification", () => {
  it("gives every known type an icon family", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(presentNotification({ type, statusTo: null }).type).toBeTruthy();
    }
  });

  it("reserves danger for real alerts", () => {
    expect(presentNotification({ type: "project_budget_exceeded", statusTo: null }).tone).toBe("danger");
    expect(presentNotification({ type: "project_delayed", statusTo: null }).tone).toBe("danger");
    expect(presentNotification({ type: "invitation_received", statusTo: null }).tone).toBe("primary");
  });

  it("colors status changes by the new status", () => {
    expect(presentNotification({ type: "project_status_changed", statusTo: "on_hold" }).tone).toBe("orange");
    expect(presentNotification({ type: "project_status_changed", statusTo: "completed" }).tone).toBe("success");
    expect(presentNotification({ type: "project_status_changed", statusTo: null }).tone).toBe("neutral");
  });

  it("falls back for types this build doesn't know yet", () => {
    expect(presentNotification({ type: "inspection_proposed", statusTo: null })).toEqual({ type: "system" });
  });
});

describe("isAlertNotification", () => {
  it("flags budget, delay and removal notices", () => {
    expect(isAlertNotification("project_budget_exceeded")).toBe(true);
    expect(isAlertNotification("removed_from_company")).toBe(true);
    expect(isAlertNotification("invitation_received")).toBe(false);
  });
});

describe("toBellItem", () => {
  it("maps a record to a bell item, preferring the project's current name", () => {
    const item = toBellItem(record(), new Map([["p1", "Cebu Coastal Road Widening"]]));
    expect(item).toMatchObject({
      id: "n1",
      type: "project",
      tone: "primary",
      read: false,
      href: "/projects/p1",
      projectName: "Cebu Coastal Road Widening",
      body: "Maria Santos added you as Inspector.",
    });
  });

  it("keeps the payload's name for projects the user can no longer see", () => {
    expect(toBellItem(record(), new Map()).projectName).toBe("Cebu (old name)");
  });

  it("treats a read timestamp as read and missing text as absent", () => {
    const item = toBellItem(record({ readAt: "2026-10-13T02:00:00.000Z", body: null, link: null }));
    expect(item.read).toBe(true);
    expect(item.body).toBeUndefined();
    expect(item.href).toBeUndefined();
  });
});
