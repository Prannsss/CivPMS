import { describe, expect, it } from "vitest";
import { absoluteUrl, escapeHtml } from "./escape";
import {
  NOTIFICATION_SETTINGS_PATH,
  invitationEmail,
  renderNotificationEmail,
  type NotificationEmailRow,
} from "./index";

const appUrl = "https://pms.example.com";
const hostile = {
  script: "<script>alert('x')</script>",
  img: '"><img src=x onerror=alert(1)>',
  amp: "Tom & Jerry's Builders",
};

function expectNoInjection(html: string) {
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img src=x");
  expect(html).not.toMatch(/onerror=alert\(1\)>/);
  expect(html).not.toContain("javascript:");
}

describe("escaping helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>\``)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;&#96;",
    );
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });

  it("only links to the app's own origin", () => {
    expect(absoluteUrl(appUrl, "/projects/1?tab=wbs")).toBe("https://pms.example.com/projects/1?tab=wbs");
    expect(absoluteUrl(appUrl, "//evil.com")).toBe("https://pms.example.com/");
    expect(absoluteUrl(appUrl, "https://evil.com")).toBe("https://pms.example.com/");
    expect(absoluteUrl(appUrl, "javascript:alert(1)")).toBe("https://pms.example.com/");
    expect(absoluteUrl("not a url", "/x")).toBe("http://localhost:3000/x");
  });
});

describe("invitationEmail", () => {
  const base = {
    appUrl,
    email: "ana@example.com",
    inviterName: hostile.script,
    companyName: hostile.amp,
    projectName: hostile.img,
    role: "inspector",
    expiresAt: "2026-10-19T06:32:00Z",
  };

  it("escapes every interpolated value", () => {
    const email = invitationEmail({ ...base, token: "a".repeat(64) });
    expectNoInjection(email.html);
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("Tom &amp; Jerry&#39;s Builders");
  });

  it("links new users to /invite/<token> and explains the email requirement", () => {
    const token = "0123456789abcdef".repeat(4);
    const email = invitationEmail({ ...base, inviterName: "Maria Santos", projectName: "Tower A", token });
    const url = `https://pms.example.com/invite/${token}`;
    expect(email.subject).toBe("Maria Santos invited you to Tower A on CivPMS");
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain("Accept invitation");
    expect(email.html).toContain("Inspector / QA / QC");
    expect(email.html).toContain("19 Oct 2026, 2:32 PM (Philippine time)");
    expect(email.html).toContain("Sign up or sign in with ana@example.com");
    expect(email.html).not.toContain("Manage email notifications");
    expect(email.text).toContain(`Accept invitation: ${url}`);
    expect(email.text).toContain("Maria Santos invited you to join Tower A at Tom & Jerry's Builders as Inspector / QA / QC.");
    expect(email.tags).toEqual(["invitation"]);
  });

  it("encodes odd tokens into the path", () => {
    const email = invitationEmail({ ...base, token: "../../login?x=<y>" });
    expect(email.html).toContain("https://pms.example.com/invite/..%2F..%2Flogin%3Fx%3D%3Cy%3E");
  });

  it("points existing users to the app instead of a token link", () => {
    const email = invitationEmail({ ...base, projectName: "Tower A", inviterName: "Maria", link: "/" });
    expect(email.html).toContain('href="https://pms.example.com/"');
    expect(email.html).toContain("Review invitation");
    expect(email.html).toContain("Manage email notifications");
  });

  it("keeps the subject on one line", () => {
    const email = invitationEmail({ ...base, inviterName: "Maria\r\nBcc: x@y.z", projectName: "Tower A" });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe("renderNotificationEmail", () => {
  const row = (overrides: Partial<NotificationEmailRow>): NotificationEmailRow => ({
    type: "project_budget_exceeded",
    title: "Tower A is over budget",
    body: "Allocated cost ₱1,250,000.00 is above the budget of ₱1,000,000.00 (₱250,000.00 over).",
    link: "/projects/11111111-1111-1111-1111-111111111111",
    payload: { project_name: "Tower A", allocated: 1250000, budget: 1000000 },
    recipient_name: "Maria Santos",
    recipient_email: "maria@example.com",
    ...overrides,
  });

  it("renders the budget template with money details and a project link", () => {
    const email = renderNotificationEmail(row({}), { appUrl });
    expect(email.subject).toBe("Tower A is over budget");
    expect(email.tags).toEqual(["project_budget_exceeded"]);
    expect(email.html).toContain("Hi Maria,");
    expect(email.html).toContain("Budget exceeded by ₱250,000.00");
    expect(email.html).toContain("₱1,000,000.00");
    expect(email.html).toContain("₱1,250,000.00");
    expect(email.html).toContain('href="https://pms.example.com/projects/11111111-1111-1111-1111-111111111111"');
    expect(email.html).toContain(`href="${appUrl}${NOTIFICATION_SETTINGS_PATH}"`);
    expect(email.text).toContain("Review budget: https://pms.example.com/projects/11111111-1111-1111-1111-111111111111");
    expect(email.text).toContain(`Manage email notifications: ${appUrl}${NOTIFICATION_SETTINGS_PATH}`);
  });

  it.each([
    ["invitation_received", "Review invitation"],
    ["invitation_accepted", "View collaborators"],
    ["invitation_declined", "View collaborators"],
    ["member_joined", "View team"],
    ["added_to_project", "Open project"],
    ["removed_from_project", "Open CivPMS"],
    ["removed_from_company", "Open CivPMS"],
    ["project_budget_exceeded", "Review budget"],
    ["project_delayed", "Review schedule"],
    ["project_status_changed", "Open project"],
    ["something_new", "Open CivPMS"],
  ])("renders %s even with an empty payload", (type, cta) => {
    const email = renderNotificationEmail(row({ type, payload: {}, body: null }), { appUrl });
    expect(email.html).toContain(cta);
    expect(email.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(email.text.length).toBeGreaterThan(20);
  });

  it("escapes hostile titles, bodies and payload values", () => {
    const email = renderNotificationEmail(
      row({
        type: "project_status_changed",
        title: hostile.script,
        body: hostile.img,
        payload: { project_name: hostile.img, from: "active", to: "on_hold", reason: hostile.script },
        recipient_name: hostile.img,
      }),
      { appUrl },
    );
    expectNoInjection(email.html);
    expect(email.html).toContain("Status: On-Hold");
  });

  it("never links outside the app", () => {
    for (const link of ["javascript:alert(1)", "//evil.com/x", "https://evil.com", "/\\evil.com"]) {
      const email = renderNotificationEmail(row({ type: "something_new", link }), { appUrl });
      expect(email.html).not.toContain("evil.com");
      expectNoInjection(email.html);
      expect(email.html).toContain('href="https://pms.example.com/"');
    }
  });

  it("greets people without a name neutrally", () => {
    const email = renderNotificationEmail(row({ recipient_name: "maria@example.com" }), { appUrl });
    expect(email.html).toContain("Hi there,");
  });

  it("shows status labels and the reason for status changes", () => {
    const email = renderNotificationEmail(
      row({
        type: "project_status_changed",
        title: "Tower A is now On-Hold",
        body: "Maria changed the status from Active to On-Hold. Reason: Waiting for permits.",
        payload: { project_name: "Tower A", from: "active", to: "on_hold", reason: "Waiting for permits" },
      }),
      { appUrl },
    );
    expect(email.text).toContain("From: Active");
    expect(email.text).toContain("To: On-Hold");
    expect(email.text).toContain("Reason: Waiting for permits");
  });

  it("formats the planned end date for delayed projects", () => {
    const email = renderNotificationEmail(
      row({ type: "project_delayed", title: "Tower A is delayed", payload: { project_name: "Tower A", end_date: "2026-10-10" } }),
      { appUrl },
    );
    expect(email.text).toContain("Planned end: 10 Oct 2026");
  });
});
