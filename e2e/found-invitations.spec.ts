import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ACCOUNTS, loginAs } from "./helpers/auth";
import { escapeRegExp, toastWith, waitForRealtime } from "./helpers/ui";
import {
  FOUND_COMPANY,
  FOUND_PROJECT,
  createFoundInviteCode,
  ensureFoundTenant,
  inviteFoundInspector,
  resetFoundInspector,
  revokeFoundInviteCode,
  type FoundTenant,
} from "./helpers/found-tenant";

/**
 * Joining a company from the invitee's side, live against the database, in the e2e tenant
 * "[FOUND] QA Builders" (never the demo company): invite codes, email invitations (accept and
 * decline) and the Realtime bell. Serial: every test starts from "No company yet".
 */
test.describe.configure({ mode: "serial" });

let tenant: FoundTenant;

test.beforeAll(async () => {
  tenant = await ensureFoundTenant();
});

test.afterEach(async () => {
  await resetFoundInspector();
});

async function openAs(browser: Browser, who: "foundOwner" | "foundInspector", path = "/"): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await loginAs(context, who);
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
}

/** "Notifications, 3 unread" → 3; "Notifications" → 0. */
function unreadIn(label: string | null): number {
  return Number(label?.match(/(\d+) unread/)?.[1] ?? 0);
}

const toast = toastWith;

test("an inspector joins with an invite code, and the owner's bell updates live", async ({ browser }) => {
  const code = await createFoundInviteCode();
  const owner = await openAs(browser, "foundOwner");
  const inspector = await openAs(browser, "foundInspector");
  try {
    const ownerBell = owner.page.getByRole("button", { name: /^Notifications/ });
    await expect(ownerBell).toBeVisible();
    await waitForRealtime(owner.page);
    const before = await ownerBell.getAttribute("aria-label");

    const { page } = inspector;
    await expect(page.getByTestId("no-company-state")).toBeVisible();
    await expect(page.getByRole("banner").getByText("No company yet")).toBeVisible();

    // Wrong code first: inline, plain-language error.
    const input = page.getByRole("textbox", { name: "Invite code" });
    await input.fill("zzzz zzzz");
    await expect(input).toHaveValue("ZZZZ-ZZZZ");
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText(/not valid|doesn't look like/i)).toBeVisible();

    // The real code, typed loosely (lower case, no dash).
    await input.fill(code.code.toLowerCase().replace("-", " "));
    await expect(input).toHaveValue(code.code);
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByRole("heading", { name: `Join ${FOUND_COMPANY}?` })).toBeVisible();
    await page.getByRole("button", { name: `Join ${FOUND_COMPANY}` }).click();

    await expect(toast(page, `Welcome to ${FOUND_COMPANY}`)).toBeVisible();
    await expect(page.getByRole("banner").getByText(FOUND_COMPANY)).toBeVisible();
    await expect(page.getByTestId("no-company-state")).toHaveCount(0);

    // Realtime: the code's creator hears about it without reloading.
    await expect(toast(owner.page, /joined with your invite code/)).toBeVisible({ timeout: 20_000 });
    await expect(ownerBell).not.toHaveAttribute("aria-label", before ?? "");
  } finally {
    await revokeFoundInviteCode(code.id).catch(() => undefined);
    await owner.context.close();
    await inspector.context.close();
  }
});

test("an email invitation arrives live, then accepting opens the project", async ({ browser }) => {
  const inspector = await openAs(browser, "foundInspector");
  try {
    const { page } = inspector;
    await expect(page.getByTestId("no-company-state")).toBeVisible();
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    const unreadBefore = unreadIn(await bell.getAttribute("aria-label"));
    await waitForRealtime(page);

    await inviteFoundInspector(tenant.projectId);

    // Realtime toast, bell badge and the refreshed invitation list, all without a reload.
    await expect(toast(page, `Invitation to ${FOUND_PROJECT}`)).toBeVisible({ timeout: 20_000 });
    await expect(bell).toHaveAttribute("aria-label", `Notifications, ${unreadBefore + 1} unread`);
    const card = page.getByTestId("pending-invitation").filter({ hasText: FOUND_PROJECT });
    await expect(card).toBeVisible();
    await expect(card.getByText(FOUND_COMPANY)).toBeVisible();
    await expect(card.getByText(/Expires/)).toBeVisible();

    await card.getByRole("button", { name: `Accept invitation to ${FOUND_PROJECT}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `Join ${FOUND_COMPANY}?` })).toBeVisible();
    await dialog.getByRole("button", { name: `Join ${FOUND_COMPANY}` }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${tenant.projectId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(toast(page, `You joined ${FOUND_PROJECT}`)).toBeVisible();
    // Inspectors don't manage projects.
    await expect(page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Project Settings" })).toHaveCount(0);
  } finally {
    await inspector.context.close();
  }
});

test("declining an invitation asks first, then removes it", async ({ browser }) => {
  await inviteFoundInspector(tenant.projectId);
  const inspector = await openAs(browser, "foundInspector");
  try {
    const { page } = inspector;
    const card = page.getByTestId("pending-invitation").filter({ hasText: FOUND_PROJECT });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Decline invitation to ${FOUND_PROJECT}` }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `Decline the invitation to ${FOUND_PROJECT}?` })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: `Decline invitation to ${FOUND_PROJECT}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Decline invitation" }).click();
    await expect(toast(page, "Invitation declined")).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("pending-invitation")).toHaveCount(0);
    await expect(page.getByTestId("no-company-state")).toBeVisible();
  } finally {
    await inspector.context.close();
  }
});

test("the bell marks one notification, then all, as read", async ({ browser }) => {
  // Two fresh notifications for the inspector: an invitation, then a second one after a re-send.
  await inviteFoundInspector(tenant.projectId);
  await inviteFoundInspector(tenant.projectId);
  const inspector = await openAs(browser, "foundInspector");
  try {
    const { page } = inspector;
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toHaveAttribute("aria-label", /\d+ unread/);
    const unreadBefore = unreadIn(await bell.getAttribute("aria-label"));
    expect(unreadBefore).toBeGreaterThan(0);

    await bell.click();
    const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
    await expect(panel).toBeVisible();
    // Opening one marks it read (it links home, where invitations are listed).
    await panel.getByRole("link", { name: new RegExp(escapeRegExp(`Invitation to ${FOUND_PROJECT}`)) }).first().click();
    if (unreadBefore > 1) {
      await expect(bell).toHaveAttribute("aria-label", `Notifications, ${unreadBefore - 1} unread`);
      await bell.click();
      await page.getByRole("button", { name: "Mark all as read" }).click();
    }
    await expect(bell).toHaveAttribute("aria-label", "Notifications");
    await page.keyboard.press("Escape");

    // It stuck on the server.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveAttribute("aria-label", "Notifications");
  } finally {
    await inspector.context.close();
  }
});

test.afterAll(async () => {
  // Leave the e2e inspector where every run expects it.
  await resetFoundInspector();
  expect(ACCOUNTS.foundInspector).toContain("@civpms.test");
});
