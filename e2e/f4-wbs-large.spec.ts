/**
 * A large work breakdown (560 rows): the list switches to windowed rendering, collapse / expand
 * stay quick, a cost can still be edited inline, and the graph opens. Creates its own "[F4] …"
 * project and deletes it afterwards.
 */
import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { createF4Project, deleteF4Project, F4_OWNER } from "./f4-tenant";

test.setTimeout(300_000);

test("560 rows render windowed and stay responsive", async ({ page, context }) => {
  const project = await createF4Project("Large WBS", 900_000_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text())) consoleErrors.push(message.text());
  });
  try {
    const owner = await supabaseAs(F4_OWNER);
    for (let d = 0; d < 10; d += 1) {
      const deliverable = await owner.client.rpc("create_activity", {
        p_project_id: project.id,
        p_parent_id: null as unknown as string,
        p_name: `[F4] Deliverable ${d + 1}`,
      });
      expect(deliverable.error).toBeNull();
      await Promise.all(
        Array.from({ length: 5 }, async (_, s) => {
          const sub = await owner.client.rpc("create_activity", {
            p_project_id: project.id,
            p_parent_id: deliverable.data!.id,
            p_name: `[F4] Section ${d + 1}.${s + 1}`,
          });
          expect(sub.error).toBeNull();
          for (let w = 0; w < 10; w += 1) {
            const created = await owner.client.rpc("create_activity", {
              p_project_id: project.id,
              p_parent_id: sub.data!.id,
              p_name: `[F4] Work package ${w + 1}`,
              p_fields: { start_date: "2026-10-12", duration_hours: 16, end_date: "2026-10-13", est_cost: 10000 },
            });
            expect(created.error).toBeNull();
          }
        }),
      );
    }

    await loginAs(context, F4_OWNER);
    await page.goto(`/projects/${project.id}/wbs`);
    await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
    await page.reload();
    const table = page.getByTestId("wbs-table");
    await expect(table).toHaveAttribute("data-virtual", "true");
    await expect(page.getByTestId("wbs-allocated")).toHaveText("₱5,000,000.00");
    const rendered = await page.getByTestId("wbs-row").count();
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(120);

    // Scrolling to the end brings the last rows in.
    await table.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.locator('[data-testid=wbs-row][data-wbs-code="10.5.10"]')).toBeVisible();

    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByTestId("wbs-row")).toHaveCount(10);
    await expect(table).not.toHaveAttribute("data-virtual", "true");
    const expandMs = await page.evaluate(async () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Expand"))!;
      const start = performance.now();
      button.click();
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      return performance.now() - start;
    });
    expect(expandMs, "expanding 560 rows").toBeLessThan(1500);
    await expect(table).toHaveAttribute("data-virtual", "true");

    // Inline edit still works on a windowed row.
    const row = page.locator('[data-testid=wbs-row][data-wbs-code="1.1.2"]');
    await row.getByRole("button", { name: /^Estimated cost of/ }).click();
    const cost = row.getByRole("textbox", { name: /^Estimated cost of/ });
    await page.waitForTimeout(100);
    await cost.pressSequentially("25000");
    await cost.press("Enter");
    await expect(row).toContainText("₱25,000.00");
    await expect(page.getByTestId("wbs-allocated")).toHaveText("₱5,015,000.00");

    await page.getByRole("radio", { name: "Graph" }).click();
    await expect(page.getByTestId("wbs-graph-node").first()).toBeVisible();
    expect(consoleErrors, "browser console errors").toEqual([]);
  } finally {
    await deleteF4Project(project.id);
  }
});
