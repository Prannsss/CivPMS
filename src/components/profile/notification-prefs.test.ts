import { describe, expect, it } from "vitest";
import { prefPatch, readEmailDigest, resolvePrefs, type CatalogEntry } from "./notification-prefs";

const CATALOG: CatalogEntry[] = [
  { type: "invitation_received", label: "Invitation received", description: "d", inAppDefault: true, emailDefault: true },
  { type: "invitation_declined", label: "Invitation declined", description: "d", inAppDefault: true, emailDefault: false },
  { type: "removed_from_company", label: "Removed", description: "d", inAppDefault: true, emailDefault: true },
  { type: "project_delayed", label: "Project delayed", description: "d", inAppDefault: true, emailDefault: true },
];

describe("resolvePrefs", () => {
  it("uses catalog defaults for missing entries and stored values otherwise", () => {
    const resolved = resolvePrefs({ project_delayed: { email: false }, invitation_declined: { in_app: false, email: true } }, CATALOG);
    expect(resolved.groups.map((g) => g.key)).toEqual(["project_alerts", "invitations", "membership_removed"]);
    const rows = Object.fromEntries(resolved.groups.flatMap((g) => g.rows).map((r) => [r.type, r]));
    expect(rows.project_delayed).toMatchObject({ inApp: true, email: false });
    expect(rows.invitation_declined).toMatchObject({ inApp: false, email: true });
    expect(rows.invitation_received).toMatchObject({ inApp: true, email: true });
    expect(resolved.emailDigest).toBe("off");
  });

  it("lists later-phase families as upcoming", () => {
    const { upcoming } = resolvePrefs({}, CATALOG);
    expect(upcoming).toContain("Inspection reminders");
    expect(upcoming).toContain("Offline sync conflicts");
    expect(upcoming).not.toContain("Project alerts");
  });

  it("survives junk", () => {
    expect(resolvePrefs(null, []).groups).toEqual([]);
    expect(resolvePrefs([1, 2], CATALOG).groups.length).toBe(3);
  });
});

describe("readEmailDigest", () => {
  it("accepts only off and daily", () => {
    expect(readEmailDigest({ email_digest: "daily" })).toBe("daily");
    expect(readEmailDigest({ email_digest: "weekly" })).toBe("off");
    expect(readEmailDigest(null)).toBe("off");
  });
});

describe("prefPatch", () => {
  it("builds the snake_case payload for one type", () => {
    expect(prefPatch("project_delayed", { inApp: true, email: false })).toEqual({ project_delayed: { in_app: true, email: false } });
  });
});
