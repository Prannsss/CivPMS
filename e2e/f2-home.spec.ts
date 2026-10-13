/**
 * Projects home ("/"): visibility per role (RLS), toolbar URL state, empty states, create, archive,
 * delete + Undo and Recently deleted. Mutations happen only in the "[F2] Home QA Builders" tenant
 * (e2e/f2-tenant.ts); the demo company is only read.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { escapeRegExp, toastWith, waitForRealtime } from "./helpers/ui";
import {
  deleteF2Project,
  ensureF2Tenant,
  F2_COMPANY,
  F2_EMPTY,
  F2_EMPTY_COMPANY,
  F2_INSPECTOR,
  F2_OWNER,
  F2_PROJECTS,
  uniqueF2Name,
} from "./f2-tenant";

const DELA_CRUZ = [
  "Cebu Coastal Road Widening",
  "Iloilo Riverside Mixed-Use Tower",
  "Davao Drainage Rehabilitation, Phase 2",
  "Laguna Warehouse Expansion",
];
const BAYANIHAN = "Pampanga Farm-to-Market Road, Package 1";

function card(page: Page, name: string) {
  return page.getByTestId("project-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

// Every test fails on a console error or a hydration warning.
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

test.describe("projects home — demo tenant (read only)", () => {
  test("Owner PM sees every company project with badges, summary and URL-synced filters", async ({ page, context }) => {
    await loginAs(context, "owner");
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    for (const name of DELA_CRUZ) await expect(card(page, name)).toBeVisible();
    await expect(page.getByText(BAYANIHAN)).toHaveCount(0);
    await expect(page.getByText(/4 projects · 2 need attention/)).toBeVisible();

    const davao = card(page, "Davao Drainage Rehabilitation, Phase 2");
    await expect(davao.locator("[data-status=delayed]")).toBeVisible();
    await expect(davao.locator("[data-status=budget_exceeded]")).toBeVisible();
    await expect(card(page, "Iloilo Riverside Mixed-Use Tower").locator("[data-status=near_budget_limit]")).toBeVisible();

    // Segment → URL → reload keeps it.
    await page.getByRole("radio", { name: /Needs attention/ }).click();
    await expect(page).toHaveURL(/\?status=attention$/);
    await expect(page.getByTestId("project-card")).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole("radio", { name: /Needs attention/ })).toHaveAttribute("data-state", "on");
    await expect(page.getByTestId("project-card")).toHaveCount(2);

    // Search by site name, then clear.
    await page.getByRole("radio", { name: /^All/ }).click();
    const search = page.getByRole("searchbox", { name: "Search projects by name or site" });
    await search.fill("talisay");
    await expect(page).toHaveURL(/q=talisay/);
    await expect(page.getByTestId("project-card")).toHaveCount(1);
    await expect(card(page, "Cebu Coastal Road Widening")).toBeVisible();
    await search.fill("no such project zzz");
    await expect(page.getByTestId("projects-filter-empty")).toContainText("No projects match");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("project-card")).toHaveCount(4);

    // Sort by name.
    await page.getByRole("combobox", { name: "Sort projects" }).click();
    await page.getByRole("option", { name: "Name (A–Z)" }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByTestId("project-card").first()).toContainText("Cebu Coastal Road Widening");

    // The whole card is a link.
    await card(page, "Laguna Warehouse Expansion").getByRole("link", { name: "Laguna Warehouse Expansion" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  });

  test("Inspector sees only assigned projects and no create/delete affordances", async ({ page, context }) => {
    await loginAs(context, "inspector");
    await page.goto("/");
    await expect(card(page, "Cebu Coastal Road Widening")).toBeVisible();
    await expect(page.getByTestId("project-card")).toHaveCount(1);
    await expect(page.getByTestId("add-project")).toHaveCount(0);
    await expect(page.getByTestId("add-project-tile")).toHaveCount(0);

    await page.getByRole("button", { name: "Actions for Cebu Coastal Road Widening" }).click();
    await expect(page.getByRole("menuitem", { name: "Open project" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete project" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ?new=1 (palette action) is ignored for inspectors.
    await page.goto("/?new=1");
    await expect(page.getByTestId("create-project-dialog")).toHaveCount(0);
  });

  test("Company PM sees only their projects, can create but not delete", async ({ page, context }) => {
    await loginAs(context, "pm");
    await page.goto("/");
    await expect(card(page, "Cebu Coastal Road Widening")).toBeVisible();
    await expect(card(page, "Davao Drainage Rehabilitation, Phase 2")).toBeVisible();
    await expect(page.getByTestId("project-card")).toHaveCount(2);
    await expect(page.getByText("Laguna Warehouse Expansion")).toHaveCount(0);
    await expect(page.getByTestId("add-project")).toBeVisible();
    await expect(page.getByTestId("add-project-tile")).toBeVisible();
    await expect(page.getByTestId("open-trash")).toHaveCount(0);

    await page.getByRole("button", { name: "Actions for Cebu Coastal Road Widening" }).click();
    await expect(page.getByRole("menuitem", { name: "Project settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete project" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("Phone: one column, no sideways scroll, keyboard reaches the cards", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(context, "owner");
    await page.goto("/");
    await expect(page.getByTestId("project-card")).toHaveCount(4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const boxes = await page.getByTestId("project-card").evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().x));
    expect(new Set(boxes.map(Math.round)).size).toBe(1);

    const link = page.getByTestId("project-card").first().locator("[data-card-link]");
    await page.keyboard.press("Tab"); // keyboard modality, so focus is :focus-visible
    await link.focus();
    await expect(link).toBeFocused();
    const outline = await page.getByTestId("project-card").first().evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("Another company never sees Dela Cruz projects", async ({ page, context }) => {
    await loginAs(context, "rival");
    await page.goto("/");
    await expect(card(page, BAYANIHAN)).toBeVisible();
    for (const name of DELA_CRUZ) await expect(page.getByText(name)).toHaveCount(0);
    await page.getByRole("radio", { name: /Archived/ }).click();
    for (const name of DELA_CRUZ) await expect(page.getByText(name)).toHaveCount(0);
  });
});

test.describe("projects home — [F2] tenant", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await ensureF2Tenant();
  });

  test("Owner PM with no projects gets the first-run checklist; /?new=1 opens the dialog", async ({ page, context }) => {
    await loginAs(context, F2_EMPTY);
    await page.goto("/");
    const firstRun = page.getByTestId("projects-first-run");
    await expect(firstRun).toContainText("No projects yet");
    await expect(firstRun).toContainText("Create a project");
    await expect(firstRun).toContainText("Add deliverables");
    await expect(firstRun).toContainText("Invite your team");
    await expect(page.getByText(`${F2_EMPTY_COMPANY} has no projects yet.`)).toBeVisible();

    await page.goto("/?new=1");
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);

    await firstRun.getByRole("button", { name: "Add project" }).click();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\?new=1$/);
  });

  test("Inspector in a company but on no project sees who adds them", async ({ page, context }) => {
    await loginAs(context, F2_INSPECTOR);
    await page.goto("/");
    const panel = page.getByTestId("projects-unassigned");
    await expect(panel).toContainText("You haven't been added to a project yet");
    await expect(panel).toContainText(F2_COMPANY);
    await expect(panel).toContainText(F2_INSPECTOR.email);
    await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
  });

  test("Archived projects only appear under Archived", async ({ page, context }) => {
    await loginAs(context, F2_OWNER);
    await page.goto("/");
    await expect(card(page, F2_PROJECTS.active)).toBeVisible();
    await expect(card(page, F2_PROJECTS.delayed).locator("[data-status=delayed]")).toBeVisible();
    await expect(card(page, F2_PROJECTS.onHold).locator("[data-status=on_hold]")).toBeVisible();
    await expect(card(page, F2_PROJECTS.archived)).toHaveCount(0);

    await page.getByRole("radio", { name: /Archived/ }).click();
    await expect(card(page, F2_PROJECTS.archived)).toBeVisible();
    await expect(page.getByTestId("project-card")).toHaveCount(1);
    await expect(page.getByTestId("add-project-tile")).toHaveCount(0);

    // Unarchive → Undo puts it back.
    await page.getByRole("button", { name: `Actions for ${F2_PROJECTS.archived}` }).click();
    await page.getByRole("menuitem", { name: "Unarchive project" }).click();
    await expect(toastWith(page, "Project unarchived")).toBeVisible();
    await expect(card(page, F2_PROJECTS.archived)).toHaveCount(0);
    await toastWith(page, "Project unarchived").getByRole("button", { name: "Undo" }).click();
    await expect(card(page, F2_PROJECTS.archived)).toBeVisible();
  });

  test("Create a project: inline validation, name taken, success opens the project", async ({ page, context }) => {
    await loginAs(context, F2_OWNER);
    await page.goto("/");
    await page.getByTestId("add-project").click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();

    // Submit empty: errors say what's wrong.
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog.getByText("Enter a project name.")).toBeVisible();
    await expect(dialog.getByText("Enter the end date.")).toBeVisible();
    await expect(dialog.getByText("Enter the project budget.")).toBeVisible();

    // Inline on blur.
    const nameInput = dialog.getByLabel("Project name");
    await nameInput.fill("ab");
    await nameInput.blur();
    await expect(dialog.getByText("Use at least 3 characters for the project name.")).toBeVisible();

    // The name is taken (server error lands on the field).
    await nameInput.fill(F2_PROJECTS.active.toUpperCase());
    await dialog.getByLabel("Estimated start").fill("2026-11-02");
    await dialog.getByLabel("Estimated end").fill("2026-10-01");
    await dialog.getByLabel("Estimated end").blur();
    await expect(dialog.getByText("End date must be on or after 2 Nov 2026.")).toBeVisible();
    await dialog.getByLabel("Estimated end").fill("2027-04-30");
    await dialog.getByLabel("Estimated budget").fill("25,500,000.50");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog.getByText(/already has a project with this name/)).toBeVisible();
    await expect(nameInput).toBeFocused();

    // Success.
    const name = uniqueF2Name("Spec Create");
    await nameInput.fill(name);
    await dialog.getByLabel("Site name").fill("[F2] Cagayan de Oro bypass");
    await dialog.getByRole("radio", { name: "Purple" }).click();
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(toastWith(page, "Project created")).toBeVisible();
    const projectId = page.url().split("/").pop() ?? "";

    await page.goto("/");
    await expect(card(page, name)).toBeVisible();
    await expect(card(page, name)).toContainText("[F2] Cagayan de Oro bypass");
    await expect(card(page, name).locator("[data-status=planning]")).toBeVisible();
    await deleteF2Project(projectId);
  });

  test("Delete with type-to-confirm, Undo, then restore from Recently deleted", async ({ page, context }) => {
    await loginAs(context, F2_OWNER);
    const name = uniqueF2Name("Spec Delete");
    await page.goto("/?new=1");
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();
    await waitForRealtime(page); // hydrated: typing before hydration would be lost
    await dialog.getByLabel("Project name").fill(name);
    await dialog.getByLabel("Estimated end").fill("2027-02-26");
    await dialog.getByLabel("Estimated budget").fill("1500000");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const projectId = page.url().split("/").pop() ?? "";

    await page.goto("/");
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete project" }).click();
    const confirm = page.getByRole("alertdialog", { name: new RegExp(`Delete “${escapeRegExp(name)}”\\?`) });
    await expect(confirm).toBeVisible();
    const confirmButton = confirm.getByRole("button", { name: "Delete project" });
    await expect(confirmButton).toBeDisabled();
    await confirm.getByRole("textbox").fill(name);
    await confirmButton.click();

    await expect(toastWith(page, "Project deleted")).toBeVisible();
    await expect(card(page, name)).toHaveCount(0);
    await toastWith(page, "Project deleted").getByRole("button", { name: "Undo" }).click();
    await expect(card(page, name)).toBeVisible();

    // Delete again, restore from the drawer.
    await deleteF2Project(projectId);
    await page.reload();
    await expect(card(page, name)).toHaveCount(0);
    await page.getByTestId("open-trash").click();
    const sheet = page.getByRole("dialog", { name: "Recently deleted" });
    const item = sheet.getByTestId("trash-item").filter({ hasText: name });
    await expect(item).toContainText(/days? left to restore/);
    await item.getByRole("button", { name: `Restore ${name}` }).click();
    await expect(toastWith(page, "Project restored")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page, name)).toBeVisible();

    await deleteF2Project(projectId);
  });
});
