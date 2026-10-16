import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { openPalette } from "./helpers/ui";

/**
 * Connected top bar: role-aware user menu, the ⌘K palette's actions and recent items, sign out
 * and the friendly 404. Uses the demo accounts read-only (sign-out uses its own fresh session).
 */

test("the user menu shows Company settings to the Owner PM only", async ({ page, context }) => {
  await loginAs(context, "owner");
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu for Juan Dela Cruz" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Owner PM · Dela Cruz Builders")).toBeVisible();
  await menu.getByRole("menuitem", { name: "Company settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Company settings" })).toBeVisible();

  await loginAs(context, "pm");
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu for Maria Santos" }).click();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Company settings" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Company settings are for the Owner PM" })).toBeVisible();
});

test("the palette remembers opened projects and switches the theme", async ({ page, context }) => {
  await loginAs(context, "inspector");
  await page.goto("/");
  await page.getByRole("link", { name: /Cebu Coastal Road Widening/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  const palette = await openPalette(page);
  await expect(palette.getByRole("group", { name: "Recent" }).getByRole("option", { name: /Cebu Coastal Road Widening/ })).toBeVisible();
  // Inspectors can't create projects.
  await palette.getByRole("combobox").fill("project");
  await expect(palette.getByRole("option", { name: /New project/ })).toHaveCount(0);

  const html = page.locator("html");
  const wasDark = ((await html.getAttribute("class")) ?? "").includes("dark");
  await palette.getByRole("combobox").fill("theme");
  await palette.getByRole("option", { name: wasDark ? /Switch to light theme/ : /Switch to dark theme/ }).click();
  if (wasDark) await expect(html).not.toHaveClass(/\bdark\b/);
  else await expect(html).toHaveClass(/\bdark\b/);
});

test("project managers get a New project action that opens the create flow", async ({ page, context }) => {
  await loginAs(context, "pm");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("new project");
  await palette.getByRole("option", { name: /New project/ }).click();
  await expect(page).toHaveURL(/\/\?new=1$/);
  await expect(palette).toBeHidden();
});

test("Gantt and S-curve are reachable from the sidebar and explain what's coming", async ({ page, context }) => {
  await loginAs(context, "owner");
  await page.goto("/");
  await page.getByRole("link", { name: /Iloilo Riverside Mixed-Use Tower/ }).click();
  const nav = page.getByRole("navigation", { name: "Project" });
  await nav.getByRole("link", { name: /Gantt Chart/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gantt Chart" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get this project ready" })).toBeVisible();
  await nav.getByRole("link", { name: /S-Curve/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "S-Curve" })).toBeVisible();
  // Iloilo is still in Planning: no baseline yet.
  await expect(page.getByText("No baseline yet")).toBeVisible();
});

test("signing out from the user menu ends the session", async ({ page, context }) => {
  await loginAs(context, "owner", { fresh: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu for Juan Dela Cruz" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
});

test("signing out from the palette ends the session", async ({ page, context }) => {
  await loginAs(context, "pm", { fresh: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("sign out");
  await palette.getByRole("option", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("an unknown address shows a friendly 404 with a way back", async ({ page, context }) => {
  await loginAs(context, "owner");
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "We couldn't find that page" })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
});
