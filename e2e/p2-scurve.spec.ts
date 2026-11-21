/**
 * Stage A S-curve (docs/ROADMAP.md §4.0): planned line from Baseline v1, no actual line yet.
 * Tenant: supabase/seed/p2-e2e.sql ("[P2] Gantt Lab", "[P2] Gantt Late"). Needs DEMO_PASSWORD.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";

async function openSCurve(page: Page, projectName: string) {
  await page.goto("/");
  const id = await page.locator('[data-testid="project-card"]', { hasText: projectName }).getAttribute("data-project-id");
  await page.goto(`/projects/${id}/s-curve`);
  await expect(page.getByRole("heading", { name: "S-Curve", level: 1 })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  test.skip(!process.env.DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  await loginAs(context, { email: "p2-pm@civpms.test" });
});

test("draws the planned curve, reads values by keyboard and lists them as a table", async ({ page }) => {
  const console = watchConsole(page);
  await openSCurve(page, "[P2] Gantt Lab");
  await expect(page.getByTestId("scurve-no-progress")).toBeVisible();
  const planned = page.getByTestId("scurve-kpi-planned");
  await expect(planned).toContainText("%");
  await expect(page.getByTestId("scurve-planned")).toBeVisible();

  // Keyboard readout: focus the chart and step a week.
  const chart = page.getByTestId("scurve-chart");
  await chart.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("scurve-readout")).toContainText("Planned");
  await expect(page.locator("#scurve-readout")).toContainText("planned");

  // Hours basis and the table view.
  await page.getByRole("radio", { name: "Hours" }).click();
  await expect(planned).toContainText("%");
  await page.getByRole("radio", { name: "Table" }).click();
  const table = page.getByTestId("scurve-table");
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  await expect(table.getByRole("row").last()).toContainText("100.0%");
  await page.getByRole("radio", { name: "Chart" }).click();
  await page.getByRole("radio", { name: "Cost" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  console.expectClean();
});

test("shades the overrun of a late project", async ({ page }) => {
  const console = watchConsole(page);
  await openSCurve(page, "[P2] Gantt Late");
  await expect(page.getByText(/past its planned end/)).toBeVisible();
  await expect(page.getByTestId("scurve-overrun")).toBeVisible();
  console.expectClean();
});
