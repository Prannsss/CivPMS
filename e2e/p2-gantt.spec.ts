/**
 * Stage A read-only Gantt (docs/ROADMAP.md §4.0) on the "[P2] Gantt Lab" / "[P2] Gantt Late" tenant.
 * Seed first: supabase/seed/p2-e2e.sql (dates are relative to the day it ran; re-run it to refresh).
 * Needs DEMO_PASSWORD (the seed sets p2-pm@civpms.test to it).
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";

const P2_PM = { email: "p2-pm@civpms.test" };

async function openGantt(page: Page, projectName: string) {
  await page.goto("/");
  const card = page.locator('[data-testid="project-card"]', { hasText: projectName });
  const id = await card.getAttribute("data-project-id");
  await page.goto(`/projects/${id}/gantt`);
  await expect(page.getByRole("heading", { name: "Gantt Chart", level: 1 })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  test.skip(!process.env.DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  await loginAs(context, P2_PM);
});

test("draws the WBS on the timeline with delays, milestone, baseline and zoom", async ({ page }) => {
  const console = watchConsole(page);
  await openGantt(page, "[P2] Gantt Lab");
  const rows = page.getByTestId("gantt-row");
  await expect(rows).toHaveCount(15);
  await expect(page.getByTestId("gantt-bar")).toHaveCount(8);
  await expect(page.getByTestId("gantt-milestone")).toHaveCount(1);
  await expect(page.getByTestId("gantt-summary-bar")).toHaveCount(6);
  expect(await page.getByTestId("gantt-overdue").count()).toBeGreaterThan(0);
  await expect(page.getByText(/^Planned end /)).toBeVisible();

  // Keyboard: focus the tree, move down, details follow the selection.
  await rows.first().getByRole("treeitem").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("gantt-details")).toContainText("Survey and clearing");

  // Baseline overlay and the variance of the work package moved after Baseline v1.
  await page.getByRole("switch", { name: /Baseline/ }).check();
  expect(await page.getByTestId("gantt-baseline-bar").count()).toBeGreaterThan(8);
  await rows.filter({ hasText: "Concrete pouring" }).click();
  await expect(page.getByTestId("gantt-details")).toContainText(/working days? behind baseline/);

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Expand all" }).click();

  await page.getByRole("radio", { name: "Fit" }).click();
  const overflow = await page.getByTestId("gantt-scroller").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.getByRole("radio", { name: "Week" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  console.expectClean();
});

test("shades the overrun of a project past its end date", async ({ page }) => {
  const console = watchConsole(page);
  await openGantt(page, "[P2] Gantt Late");
  await expect(page.getByTestId("gantt-overrun-notice")).toContainText("past its planned end");
  await expect(page.getByTestId("gantt-overrun")).toHaveCount(1);
  console.expectClean();
});
