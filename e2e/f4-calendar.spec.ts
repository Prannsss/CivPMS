/**
 * Working calendar (spec §7, D20): overrides from the month grid (right-click and keyboard),
 * holidays, hours per day, the "N work packages will move" preview with old → new end dates, the
 * atomic save, and read-only roles / closed projects. Mutations happen only in projects this spec
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

function day(page: Page, date: string) {
  return page.locator(`[data-testid=calendar-month] button[data-date="${date}"]`);
}

async function openCalendar(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/calendar`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
}

/** Shows October 2026 in the month grid (the projects in this spec start on 12 Oct 2026). */
async function showOctober2026(page: Page) {
  const title = page.locator("#calendar-month-title");
  for (let i = 0; i < 24 && (await title.textContent()) !== "October 2026"; i += 1) {
    const text = (await title.textContent()) ?? "";
    const [monthName, year] = text.split(" ");
    const index = new Date(`${monthName} 1, ${year}`).getMonth() + Number(year) * 12;
    await page.getByRole("button", { name: index > 9 + 2026 * 12 ? "Previous month" : "Next month" }).click();
  }
  await expect(title).toHaveText("October 2026");
}

test.describe("Calendar — managers", () => {
  test.describe.configure({ mode: "serial" });
  let project: { id: string; name: string };
  let packageId: string;

  test.beforeAll(async () => {
    project = await createF4Project("Calendar flows");
    const owner = await supabaseAs(F4_OWNER);
    const deliverable = await owner.client.rpc("create_activity", {
      p_project_id: project.id,
      p_parent_id: null as unknown as string,
      p_name: "[F4] Foundations",
    });
    expect(deliverable.error).toBeNull();
    // Mon 12 Oct 2026 + 40 h at 8 h/day (Mon–Fri) → ends Fri 16 Oct 2026.
    const pkg = await owner.client.rpc("create_activity", {
      p_project_id: project.id,
      p_parent_id: deliverable.data!.id,
      p_name: "[F4] Pile caps",
      p_fields: { start_date: "2026-10-12", duration_hours: 40, end_date: "2026-10-16", est_cost: 100000 },
    });
    expect(pkg.error).toBeNull();
    packageId = pkg.data!.id;
  });
  test.afterAll(async () => {
    if (project) await deleteF4Project(project.id);
  });

  test("a non-working override shows the moves preview and reschedules on save", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openCalendar(page, project.id);
    await showOctober2026(page);
    await expect(day(page, "2026-10-14")).toHaveAttribute("data-working", "true");
    await expect(day(page, "2026-10-17")).toHaveAttribute("data-kind", "weekend");

    // Right-click Wed 14 Oct → mark it non-working with a note.
    await day(page, "2026-10-14").click({ button: "right" });
    const panel = page.getByTestId("calendar-day-panel");
    await panel.getByLabel(/Note/).fill("[F4] Typhoon — site closed");
    await panel.getByRole("button", { name: "Mark as non-working day" }).click();
    await expect(day(page, "2026-10-14")).toHaveAttribute("data-kind", "override-off");
    await expect(page.getByTestId("calendar-savebar")).toContainText("1 day override");

    // Discard brings the saved calendar back.
    await page.getByTestId("calendar-savebar").getByRole("button", { name: "Discard" }).click();
    await expect(day(page, "2026-10-14")).toHaveAttribute("data-working", "true");

    // Again with the keyboard: focus the 14th, open its panel with Shift+F10.
    await day(page, "2026-10-13").click({ button: "right" });
    await page.keyboard.press("Escape");
    await day(page, "2026-10-13").focus();
    await page.keyboard.press("ArrowRight");
    await expect(day(page, "2026-10-14")).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await panel.getByLabel(/Note/).fill("[F4] Typhoon — site closed");
    await panel.getByRole("button", { name: "Mark as non-working day" }).click();

    await page.getByRole("button", { name: "Save changes" }).click();
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toContainText("1 work package will move");
    await expect(confirmDialog).toContainText("[F4] Pile caps");
    await expect(confirmDialog).toContainText("Ends 16 Oct 2026 → 19 Oct 2026");
    await confirmDialog.getByRole("button", { name: "Save and reschedule" }).click();
    await expect(toastWith(page, "Calendar saved")).toBeVisible();
    await expect(page.getByTestId("calendar-savebar")).toHaveCount(0);

    const pkg = (await readActivities(project.id)).find((a) => a.id === packageId)!;
    expect(pkg.end_date).toBe("2026-10-19");
    expect(Number(pkg.duration_hours)).toBe(40);

    await page.reload();
    await showOctober2026(page);
    await expect(day(page, "2026-10-14")).toHaveAttribute("data-kind", "override-off");
    await page.getByRole("tab", { name: /Overrides/ }).click();
    await expect(page.getByTestId("calendar-override").filter({ hasText: "[F4] Typhoon" })).toBeVisible();
  });

  test("hours per day, holidays and removing an override", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openCalendar(page, project.id);
    await showOctober2026(page);

    // 10 h/day: 40 h now takes 4 working days (12, 13, 15, 16 Oct — the 14th is still off).
    const hours = page.getByLabel("Working hours per day");
    await hours.fill("10");
    await hours.press("Enter");

    // Add a local holiday on Thu 15 Oct.
    await page.getByTestId("calendar-lists").getByRole("button", { name: "Add" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Date").fill("2026-10-15");
    await dialog.getByLabel("Name").fill("[F4] Town fiesta");
    await dialog.getByRole("button", { name: "Add holiday" }).click();
    await expect(dialog).toBeHidden();
    await expect(day(page, "2026-10-15")).toHaveAttribute("data-kind", "holiday");

    // Remove the typhoon override from the list.
    await page.getByRole("tab", { name: /Overrides/ }).click();
    await page.getByRole("button", { name: "Remove override on 14 Oct 2026" }).click();
    await expect(day(page, "2026-10-14")).toHaveAttribute("data-working", "true");
    await expect(page.getByTestId("calendar-savebar")).toContainText("1 setting, 1 holiday, 1 day override");

    // Working days 12, 13, 14 and 16 Oct (the 15th is now a holiday) → it moves back to Fri 16 Oct.
    await page.getByRole("button", { name: "Save changes" }).click();
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toContainText("Ends 19 Oct 2026 → 16 Oct 2026");
    await confirmDialog.getByRole("button", { name: "Save and reschedule" }).click();
    await expect(toastWith(page, "Calendar saved")).toBeVisible();

    const pkg = (await readActivities(project.id)).find((a) => a.id === packageId)!;
    expect(pkg.end_date).toBe("2026-10-16");
    const owner = await supabaseAs(F4_OWNER);
    const { data: settings } = await owner.client
      .from("calendars")
      .select("hours_per_day")
      .eq("project_id", project.id)
      .single();
    expect(Number(settings?.hours_per_day)).toBe(10);
    const { data: fiesta } = await owner.client
      .from("calendar_dates")
      .select("kind, name")
      .eq("project_id", project.id)
      .eq("date", "2026-10-15");
    expect(fiesta).toEqual([{ kind: "holiday", name: "[F4] Town fiesta" }]);
  });

  test("undoing a change clears the save bar; a change that moves nothing saves directly", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openCalendar(page, project.id);
    await page.getByRole("switch", { name: "Mark all holidays as non-working" }).click();
    await page.getByRole("switch", { name: "Mark all holidays as non-working" }).click();
    await expect(page.getByTestId("calendar-savebar")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Saturday" }).click();
    await page.getByRole("checkbox", { name: "Saturday" }).click();
    await expect(page.getByTestId("calendar-savebar")).toHaveCount(0);

    // A make-up Saturday after the work package ends: nothing moves, so no preview dialog.
    await showOctober2026(page);
    await day(page, "2026-10-24").click({ button: "right" });
    await page.getByTestId("calendar-day-panel").getByRole("button", { name: "Mark as working day" }).click();
    await expect(day(page, "2026-10-24")).toHaveAttribute("data-kind", "override-on");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toastWith(page, "Calendar saved")).toContainText("No work package dates changed");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});

test.describe("Calendar — access", () => {
  test("project PM can edit the showcase calendar", async ({ page, context }) => {
    await loginAs(context, F4_PM);
    await openCalendar(page, tenant.showcaseId);
    await expect(page.getByTestId("calendar-lock")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Monday" })).toBeEnabled();
  });

  test("inspector sees a read-only calendar", async ({ page, context }) => {
    await loginAs(context, F4_INSPECTOR);
    await openCalendar(page, tenant.showcaseId);
    await expect(page.getByTestId("calendar-lock")).toContainText("View only");
    await expect(page.getByRole("checkbox", { name: "Monday" })).toBeDisabled();
    await expect(page.getByLabel("Working hours per day")).toBeDisabled();
    await page.locator("[data-testid=calendar-month] button[data-date]").first().click();
    await expect(page.getByTestId("calendar-day-panel")).toBeVisible();
    await expect(page.getByTestId("calendar-day-panel").getByRole("button")).toHaveCount(0);
  });

  test("a cancelled project's calendar is locked for its Owner PM", async ({ page, context }) => {
    await loginAs(context, F4_OWNER);
    await openCalendar(page, tenant.cancelledId);
    await expect(page.getByTestId("calendar-lock")).toContainText("cancelled");
    await expect(page.getByRole("checkbox", { name: "Monday" })).toBeDisabled();
  });

  test("another company gets a 404", async ({ page, context }) => {
    await loginAs(context, "rival");
    await page.goto(`/projects/${tenant.showcaseId}/calendar`);
    await expect(page.getByRole("heading", { name: /We couldn't (open that project|find that)/ })).toBeVisible();
    await expect(page.getByText("[F4] Metro Drainage Upgrade")).toHaveCount(0);
  });
});
