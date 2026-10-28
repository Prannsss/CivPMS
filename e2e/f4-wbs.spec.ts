/**
 * Work breakdown (spec §6, §9.3, D20–D22): create, inline edit with the calendar-aware end date,
 * D21 carry-over, keyboard moves + Undo, delete + Undo + Recently deleted, sample structure, graph
 * view, Hours | Days, concurrency, and read-only roles. Mutations happen only in projects this spec
 * creates in the "[F4] WBS Lab Builders" tenant (e2e/f4-tenant.ts); they are deleted afterwards.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { toastWith } from "./helpers/ui";
import {
  createF4Project,
  deleteF4Project,
  ensureF4Tenant,
  F4_INSPECTOR,
  F4_OWNER,
  F4_PM,
  readActivities,
  type F4Tenant,
} from "./f4-tenant";

let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text())) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
});
test.afterEach(() => {
  expect(consoleErrors, "browser console errors").toEqual([]);
});

let tenant: F4Tenant;
test.beforeAll(async () => {
  tenant = await ensureF4Tenant();
});

function row(page: Page, code: string) {
  return page.locator(`[data-testid=wbs-row][data-wbs-code="${code}"]`);
}

async function rowMenu(page: Page, code: string, item: string | RegExp) {
  await row(page, code).getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", typeof item === "string" ? { name: item, exact: true } : { name: item }).click();
}

async function openWbs(page: Page, projectId: string, view: "list" | "graph" = "list") {
  await page.goto(`/projects/${projectId}/wbs`);
  await page.evaluate((v) => localStorage.setItem("civpms.wbs.view", v), view);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Work Breakdown" })).toBeVisible();
}

/** Drags a row's handle onto another row (dy: offset inside the target row, dx: sideways = level). */
async function drag(page: Page, fromCode: string, toCode: string, offset: { dx?: number; dy: number }) {
  const handle = row(page, fromCode).getByRole("button", { name: new RegExp(`^Drag ${fromCode.replace(/\./g, "\\.")} `) });
  await row(page, toCode).scrollIntoViewIfNeeded();
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  const to = (await row(page, toCode).boundingBox())!;
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + (to.y > from.y ? 10 : -10), { steps: 5 });
  await page.mouse.move(x + (offset.dx ?? 0), to.y + offset.dy, { steps: 12 });
  await page.mouse.up();
}

async function addViaDialog(page: Page, fields: { name: string; duration?: string; cost?: string }) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(fields.name);
  if (fields.duration !== undefined) await dialog.getByLabel(/^Duration/).fill(fields.duration);
  if (fields.cost !== undefined) {
    await dialog.getByLabel("Estimated cost").fill(fields.cost);
    await dialog.getByLabel("Estimated cost").blur();
  }
  await dialog.getByRole("button", { name: /^Add / }).click();
  await expect(dialog).toBeHidden();
}

test.describe("WBS — managers", () => {
  test.describe.configure({ mode: "serial" });
  let project: { id: string; name: string };

  test.beforeAll(async () => {
    project = await createF4Project("WBS flows", 1_000_000);
    // Durations typed in these specs are hours; a previous run may have left "days" on the profile.
    const owner = await supabaseAs(F4_OWNER);
    await owner.client.rpc("update_profile", { p_patch: { duration_unit: "hours" } });
  });
  test.afterAll(async () => {
    if (project) await deleteF4Project(project.id);
  });

  test("first deliverable, work package with calendar end date, inline edits", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);

    // Empty state explains the levels and offers both starts.
    const empty = page.getByTestId("wbs-empty");
    await expect(empty).toContainText("Work package");
    await expect(empty.getByRole("button", { name: "Use sample structure" })).toBeVisible();
    await empty.getByRole("button", { name: "Add first deliverable" }).click();
    await addViaDialog(page, { name: "[F4] Earthworks" });
    await expect(row(page, "1")).toContainText("[F4] Earthworks");

    // Child work package: 16 h starting Mon 12 Oct 2026 ends Tue 13 Oct (D20).
    await rowMenu(page, "1", /Add sub-deliverable inside/);
    await addViaDialog(page, { name: "[F4] Excavation", duration: "16", cost: "250000" });
    await expect(row(page, "1.1")).toContainText("13 Oct 2026");
    await expect(row(page, "1.1")).toContainText("₱250,000.00");
    await expect(row(page, "1")).toContainText("from 1 work package");
    await expect(page.getByTestId("wbs-allocated")).toHaveText("₱250,000.00");

    // Inline: duration 40 h → ends Fri 16 Oct.
    await row(page, "1.1").getByRole("button", { name: /^Duration of 1\.1/ }).click();
    const duration = row(page, "1.1").getByRole("textbox", { name: /^Duration of 1\.1/ });
    await duration.fill("40");
    await duration.press("Enter");
    await expect(row(page, "1.1")).toContainText("16 Oct 2026");

    // Inline: end date Tue 20 Oct → 7 working days, so the duration becomes 56 h.
    await row(page, "1.1").getByRole("button", { name: /^End date of 1\.1/ }).click();
    const end = row(page, "1.1").getByLabel(/^End date of 1\.1/);
    await end.fill("2026-10-20");
    await end.press("Enter");
    await expect(row(page, "1.1")).toContainText("20 Oct 2026");
    await expect(row(page, "1.1")).toContainText("56 h");

    // Inline cost → live budget bar, saved.
    await row(page, "1.1").getByRole("button", { name: /^Estimated cost of 1\.1/ }).click();
    const cost = row(page, "1.1").getByRole("textbox", { name: /^Estimated cost of 1\.1/ });
    await cost.fill("950000");
    await cost.press("Enter");
    await expect(page.getByTestId("wbs-allocated")).toHaveText("₱950,000.00");
    await expect(page.getByTestId("wbs-budget")).toHaveAttribute("data-state", "near");
    await expect(page.getByTestId("wbs-budget-warning")).toBeVisible();

    await expect(page.locator("[data-testid=wbs-row][aria-busy=true]")).toHaveCount(0);
    await expect
      .poll(async () => {
        const wp = (await readActivities(project.id)).find((r) => r.name === "[F4] Excavation")!;
        return [wp.start_date, wp.end_date, wp.wbs_code, Number(wp.duration_hours), Number(wp.est_cost)];
      })
      .toEqual(["2026-10-12", "2026-10-20", "1.1", 56, 950000]);
  });

  test("D21: a work package's first child can take over its values", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);
    await rowMenu(page, "1.1", /Add work package inside/);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("will become a parent");
    await expect(dialog.getByRole("checkbox", { name: /Move them to this new/ })).toBeChecked();
    await dialog.getByLabel("Name").fill("[F4] Footing excavation");
    await dialog.getByRole("button", { name: /^Add / }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, "1.1.1")).toContainText("20 Oct 2026");
    await expect(row(page, "1.1.1")).toContainText("₱950,000.00");
    await expect(row(page, "1.1")).toContainText("from 1 work package");

    await expect(page.locator("[data-testid=wbs-row][aria-busy=true]")).toHaveCount(0);
    const rows = await readActivities(project.id);
    const parent = rows.find((r) => r.name === "[F4] Excavation")!;
    const child = rows.find((r) => r.name === "[F4] Footing excavation")!;
    expect(child).toMatchObject({ start_date: "2026-10-12", end_date: "2026-10-20", level: 3 });
    expect(parent.est_cost).toBeNull();

    // A level-3 item can't get children.
    await row(page, "1.1.1").getByRole("button", { name: /^Actions for/ }).click();
    await expect(page.getByRole("menuitem", { name: /Add sub-deliverable|Add work package$/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("keyboard moves with Undo, delete with Undo and Recently deleted", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);

    await page.getByRole("button", { name: "Add deliverable" }).click();
    await addViaDialog(page, { name: "[F4] Drainage" });
    await expect(row(page, "2")).toContainText("[F4] Drainage");

    // Move deliverable 2 up → it becomes 1; Undo puts it back.
    await rowMenu(page, "2", "Move up");
    await expect(toastWith(page, "Moved to 1")).toBeVisible();
    await expect(row(page, "1")).toContainText("[F4] Drainage");
    await toastWith(page, "Moved to 1").getByRole("button", { name: "Undo" }).click();
    await expect(toastWith(page, "Move undone")).toBeVisible();
    await expect(row(page, "2")).toContainText("[F4] Drainage");

    // Outdent is disabled for deliverables, with the reason.
    await row(page, "2").getByRole("button", { name: /^Actions for/ }).click();
    await expect(page.getByRole("menuitem", { name: /Outdent/ })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: /Outdent/ })).toContainText("already the top level");
    await page.keyboard.press("Escape");

    // Indent "1.1" under nothing is blocked (first child); indent deliverable 2 under 1 → 1.2.
    await rowMenu(page, "2", /Indent/);
    await expect(toastWith(page, "Moved to 1.2")).toBeVisible();
    await expect(row(page, "1.2")).toContainText("[F4] Drainage");

    // Delete 1 → impact in the dialog → Undo restores everything.
    await rowMenu(page, "1", /Delete deliverable/);
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toContainText("Deletes 2 sub-deliverables and 1 work package");
    await confirmDialog.getByRole("button", { name: "Delete deliverable" }).click();
    await expect(page.getByTestId("wbs-empty")).toBeVisible();
    await toastWith(page, "Deleted 1 [F4] Earthworks").getByRole("button", { name: "Undo" }).click();
    await expect(toastWith(page, "Restored")).toBeVisible();
    await expect(row(page, "1.1.1")).toContainText("[F4] Footing excavation");

    // Delete the leaf, then restore it from Recently deleted.
    await rowMenu(page, "1.2", /Delete/);
    await page.getByRole("alertdialog").getByRole("button", { name: /^Delete/ }).click();
    await expect(row(page, "1.2")).toHaveCount(0);
    await expect(toastWith(page, "Deleted 1.2 [F4] Drainage")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Recently deleted/ }).click();
    const trash = page.getByTestId("wbs-trash");
    await expect(trash.getByTestId("wbs-trash-item").filter({ hasText: "[F4] Drainage" })).toBeVisible();
    await trash.getByRole("button", { name: /Restore 1\.2 \[F4\] Drainage/ }).click();
    await expect(toastWith(page, "Restored")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page, "1.2")).toContainText("[F4] Drainage");
  });

  test("drag and drop re-orders with Undo; an invalid drop is explained", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);
    await page.getByRole("button", { name: "Add deliverable" }).click();
    await addViaDialog(page, { name: "[F4] Roadworks" });
    await expect(row(page, "2")).toContainText("[F4] Roadworks");

    // Drag deliverable 2 above deliverable 1.
    await drag(page, "2", "1", { dy: 4 });
    await expect(toastWith(page, "Moved to 1")).toBeVisible();
    await expect(row(page, "1")).toContainText("[F4] Roadworks");
    await toastWith(page, "Moved to 1").getByRole("button", { name: "Undo" }).click();
    await expect(row(page, "2")).toContainText("[F4] Roadworks");

    // 1 [F4] Earthworks has three levels, so it can't go under another deliverable.
    await drag(page, "1", "2", { dy: 40, dx: 60 });
    await expect(toastWith(page, "Can't move it there")).toBeVisible();
    await expect(row(page, "1")).toContainText("[F4] Earthworks");
  });

  test("Hours | Days is saved to the profile; graph view is remembered", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);
    await page.getByRole("radio", { name: "Days" }).click();
    await expect(row(page, "1.1.1")).toContainText("7 d");
    await expect
      .poll(async () => {
        const owner = await supabaseAs(F4_OWNER);
        const { data } = await owner.client.from("profiles").select("duration_unit").eq("id", owner.userId).single();
        return data?.duration_unit;
      })
      .toBe("days");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Days" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Hours" }).click();
    await expect(row(page, "1.1.1")).toContainText("56 h");

    await page.getByRole("radio", { name: "Graph" }).click();
    await expect(page.getByTestId("wbs-graph-node")).toHaveCount(5);
    await page.getByRole("button", { name: /^Collapse 1 / }).click();
    await expect(page.getByTestId("wbs-graph-node")).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId("wbs-graph")).toBeVisible();
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.getByTestId("wbs-table")).toBeVisible();
  });

  test("someone else's change shows Reload / Keep mine", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, project.id);
    const leaf = (await readActivities(project.id)).find((r) => r.name === "[F4] Footing excavation")!;
    const pm = await supabaseAs(F4_OWNER);
    const bumped = await pm.client.rpc("update_activity", {
      p_activity_id: leaf.id,
      p_patch: { name: "[F4] Footing excavation (rev)" },
      p_expected_version: leaf.version,
    });
    expect(bumped.error).toBeNull();

    await row(page, "1.1.1").getByRole("button", { name: /^Estimated cost of 1\.1\.1/ }).click();
    const cost = row(page, "1.1.1").getByRole("textbox", { name: /^Estimated cost of 1\.1\.1/ });
    await cost.fill("900000");
    await cost.press("Enter");
    const stale = page.getByRole("alertdialog");
    await expect(stale).toContainText("Changed by someone else just now");
    await stale.getByRole("button", { name: "Keep mine" }).click();
    await expect(row(page, "1.1.1")).toContainText("₱900,000.00");
    await expect(row(page, "1.1.1")).toContainText("(rev)");
  });

  test("sample structure fills an empty project", async ({ page, context }) => {
    const sample = await createF4Project("WBS sample");
    try {
      await loginAs(context, F4_OWNER);
      await openWbs(page, sample.id);
      await page.getByRole("button", { name: "Use sample structure" }).click();
      await expect(toastWith(page, "Sample structure added")).toBeVisible();
      await expect(row(page, "3.3")).toContainText("Punch list and turnover");
      expect(await readActivities(sample.id)).toHaveLength(10);
    } finally {
      await deleteF4Project(sample.id);
    }
  });
});

test.describe("WBS — access", () => {
  test("project PM can edit the showcase", async ({ page, context }) => {
    await loginAs(context, F4_PM);
    await openWbs(page, tenant.showcaseId);
    await expect(page.getByRole("button", { name: "Add deliverable" })).toBeVisible();
    await expect(page.getByTestId("wbs-lock")).toHaveCount(0);
    await expect(row(page, "2.1.2").getByRole("button", { name: /^Duration of 2\.1\.2/ })).toBeVisible();
  });

  test("inspector sees a read-only WBS", async ({ page, context }) => {
    await loginAs(context, F4_INSPECTOR);
    await openWbs(page, tenant.showcaseId);
    await expect(page.getByTestId("wbs-lock")).toContainText("View only");
    await expect(page.getByRole("button", { name: "Add deliverable" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Duration of/ })).toHaveCount(0);
    await expect(row(page, "2.1.2")).toContainText("Reinforced concrete box culvert");
    await expect(page.getByRole("button", { name: /Recently deleted/ })).toHaveCount(0);
  });

  test("a cancelled project's WBS is locked for its Owner PM", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openWbs(page, tenant.cancelledId);
    await expect(page.getByTestId("wbs-lock")).toContainText("cancelled");
    await expect(page.getByRole("button", { name: /Add (first )?deliverable/ })).toHaveCount(0);

    // The database refuses it too (migration 20261023090000), not only the UI and Server Actions.
    const { client } = await supabaseAs(F4_OWNER);
    const { error } = await client.rpc("create_activity", { p_project_id: tenant.cancelledId, p_parent_id: null as unknown as string, p_name: "[F4] Must not be created" });
    expect(error?.message).toBe("FORBIDDEN");
    expect(error?.details).toContain("cancelled");
  });

  test("someone who hasn't finished onboarding is sent to onboarding", async ({ page, context }) => {
    await loginAs(context, "newbie");
    await page.goto(`/projects/${tenant.showcaseId}/wbs`);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText("[F4] Metro Drainage Upgrade")).toHaveCount(0);
  });

  test("another company gets a 404", async ({ page, context }) => {
    await loginAs(context, "rival");
    await page.goto(`/projects/${tenant.showcaseId}/wbs`);
    await expect(page.getByRole("heading", { name: /We couldn't (open that project|find that)/ })).toBeVisible();
    await expect(page.getByText("[F4] Metro Drainage Upgrade")).toHaveCount(0);
  });
});
