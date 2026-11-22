import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { toastWith } from "./helpers/ui";
import { F5, F5_PROJECT, ensureF5PmNotifications, ensureF5Tenant } from "./f5-tenant";

/**
 * Notifications page (spec §14) as f5-pm, whose notifications come from the Owner PM moving
 * "[F5] Tagaytay Ridge Villas" between Active and On-Hold (see ensureF5PmNotifications): list,
 * All/Unread and project filters in the URL, mark one read, deep link, "Show older" keyset
 * pagination and mark all as read (the bell follows). Re-runnable: every run adds fresh unread rows.
 */

test.describe.configure({ mode: "serial" });

let projectId = "";

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await ensureF5Tenant();
  projectId = await ensureF5PmNotifications(24, 4);
});

async function unreadCount(): Promise<number> {
  const { client } = await supabaseAs(F5.pm);
  const { count, error } = await client.from("notifications").select("id", { count: "exact", head: true }).eq("in_app", true).is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

test("list, filters in the URL and mark one as read", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.pm);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const rows = page.getByTestId("notification-row");
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText(`${F5_PROJECT} is now Active`);
  await expect(rows.first().getByText(F5_PROJECT, { exact: true })).toBeVisible();

  // Unread only.
  await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: /^Unread/ }).click();
  await expect(page).toHaveURL(/filter=unread/);
  await expect(rows.first()).toHaveAttribute("data-unread", "true");
  await expect(page.locator('[data-testid="notification-row"][data-unread="false"]')).toHaveCount(0);

  // Mark the first one read.
  const before = await unreadCount();
  const first = rows.first();
  await first.getByRole("button", { name: /^Mark “.+” as read$/ }).click();
  await expect(first).toHaveAttribute("data-unread", "false");
  await expect.poll(unreadCount).toBe(before - 1);

  // Project filter.
  await page.getByRole("combobox", { name: "Filter by project" }).click();
  await page.getByRole("option", { name: F5_PROJECT }).click();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
  await expect(page).toHaveURL(/filter=unread/);
  await expect(rows.first()).toContainText(F5_PROJECT);

  // Back to everything.
  await page.goto("/notifications?filter=all&project=not-a-uuid");
  await expect(rows).toHaveCount(20);
  console.expectClean();
});

test("show older notifications (keyset pagination) and deep links", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.pm);
  await page.goto("/notifications");
  const rows = page.getByTestId("notification-row");
  await expect(rows).toHaveCount(20);
  const ids = () => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id") ?? ""));
  const firstPage = await ids();
  await page.getByRole("button", { name: "Show older notifications" }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(20);
  const all = await ids();
  // The first page is unchanged, nothing repeats at the boundary, and the second page holds the
  // next rows (up to 20 more).
  expect(all.slice(0, 20)).toEqual(firstPage);
  expect(new Set(all).size).toBe(all.length);
  const { client } = await supabaseAs(F5.pm);
  const { count } = await client.from("notifications").select("id", { count: "exact", head: true }).eq("in_app", true);
  expect(all.length).toBe(Math.min(count ?? 0, 40));

  // A row links to its page.
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
  console.expectClean();
});

test("mark all as read clears the list and the bell", async ({ page, context }) => {
  const console = watchConsole(page);
  await ensureF5PmNotifications(0, 2);
  await loginAs(context, F5.pm);
  await page.goto("/notifications");
  await expect(page.getByRole("button", { name: /^Notifications, \d+ unread$/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(toastWith(page, /Marked \d+ notifications? as read/)).toBeVisible();
  await expect.poll(unreadCount).toBe(0);
  await expect(page.locator('[data-testid="notification-row"][data-unread="true"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();

  await page.goto("/notifications?filter=unread");
  await expect(page.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
  await page.getByRole("button", { name: "Show all notifications" }).click();
  await expect(page).not.toHaveURL(/filter=unread/);
  await expect(page.getByTestId("notification-row").first()).toBeVisible();
  console.expectClean();
});

test("empty state for someone without notifications", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.profile);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "No notifications yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark all as read" })).toHaveCount(0);
  await page.getByRole("link", { name: "Choose what you're notified about" }).click();
  await expect(page).toHaveURL(/\/profile#notifications/);
  console.expectClean();
});
