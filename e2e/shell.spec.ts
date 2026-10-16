import { expect, test, type Page } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { openPalette } from "./helpers/ui";

/**
 * The connected app shell against the live database with the seeded demo accounts
 * (supabase/seed/demo.sql). Read-only: nothing here changes demo data.
 */

const CEBU = "Cebu Coastal Road Widening";
let cebuId = "";

test.beforeAll(async () => {
  const { client } = await supabaseAs("owner");
  const { data, error } = await client.from("project_overview").select("id").eq("name", CEBU).single();
  if (error || !data?.id) throw new Error(`Seed missing: ${CEBU} (${error?.message ?? "no row"})`);
  cebuId = data.id;
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("owner sees the home shell, opens a project and moves around the sidebar", async ({ page, context }) => {
  await loginAs(context, "owner");
  await page.goto("/");

  const banner = page.getByRole("banner");
  await expect(banner.getByText("Welcome back, Juan")).toBeVisible();
  await expect(banner.getByText("Dela Cruz Builders")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(CEBU) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${cebuId}$`));
  const nav = page.getByRole("navigation", { name: "Project" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByText(CEBU)).toBeVisible();

  for (const [label, path, heading] of [
    ["Work Breakdown", "/wbs", "Work Breakdown"],
    ["Calendar", "/calendar", "Calendar"],
    ["Collaborators", "/collaborators", "Collaborators"],
    ["Audit Trail", "/audit", "Audit Trail"],
    ["Project Settings", "/settings", "Project Settings"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${cebuId}${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }

  // Gantt and S-Curve are "Soon" in the sidebar; their pages explain what is coming.
  await expect(nav.getByText("Gantt Chart")).toBeVisible();
  await page.goto(`/projects/${cebuId}/gantt`);
  await expect(page.getByRole("heading", { level: 1, name: "Gantt Chart" })).toBeVisible();
  await expect(page.getByText("Coming next", { exact: true })).toBeVisible();
  await page.goto(`/projects/${cebuId}/s-curve`);
  await expect(page.getByRole("heading", { level: 1, name: "S-Curve" })).toBeVisible();
  await expect(page.getByText("Baseline v1 is in place")).toBeVisible();
});

test("another company's project is not found", async ({ page, context }) => {
  await loginAs(context, "rival");
  await page.goto(`/projects/${cebuId}`);
  await expect(page.getByRole("heading", { level: 1, name: "We couldn't open that project" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to projects" })).toBeVisible();
  await expect(page.getByText(CEBU)).toHaveCount(0);
});

test("a user who hasn't finished onboarding is sent to /onboarding", async ({ page, context }) => {
  await loginAs(context, "newbie");
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("signed-out visitors go to /login with the page they wanted", async ({ page }) => {
  await page.goto(`/projects/${cebuId}/wbs`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/projects/${cebuId}/wbs`)}$`));
});

test("the notification bell opens with the latest notifications", async ({ page, context }) => {
  await loginAs(context, "owner");
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "View all notifications" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("Ctrl+K opens the command palette and lists visible projects", async ({ page, context }) => {
  await loginAs(context, "pm");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const palette = await openPalette(page);
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("option", { name: new RegExp(CEBU) })).toBeVisible();
  // Maria is not on Iloilo or Laguna: RLS keeps them out of her palette.
  await expect(palette.getByRole("option", { name: /Iloilo|Laguna/ })).toHaveCount(0);
  await palette.getByRole("combobox").fill("davao");
  await expect(palette.getByRole("option", { name: /Davao Drainage/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("an inspector doesn't get Project Settings", async ({ page, context }) => {
  await loginAs(context, "inspector");
  await page.goto(`/projects/${cebuId}`);
  const nav = page.getByRole("navigation", { name: "Project" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Project Settings" })).toHaveCount(0);
  await page.goto(`/projects/${cebuId}/settings`);
  await expect(page.getByRole("heading", { name: "You can't change this project's settings" })).toBeVisible();
});

test("phone: the project menu opens as a drawer and the page doesn't scroll sideways", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(context, "owner");
  await page.goto(`/projects/${cebuId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: `${CEBU} navigation` });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${cebuId}/calendar$`));
  await expect(drawer).toBeHidden();
});
