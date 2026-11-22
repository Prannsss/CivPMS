/**
 * Phase 0–1 golden path with brand-new accounts, end to end through the UI:
 *
 *   sign in → onboarding as PM → new company → new project → WBS (deliverable, sub-deliverable,
 *   work packages with dates + costs) → calendar (non-working day, reschedule preview, save) →
 *   invite an inspector by email (copy the link) → the inspector accepts → read-only project for
 *   the inspector → audit trail shows all of it → profile, company settings and notifications
 *   → another company can't see any of it (UI and database).
 *
 * Every page must stay free of console errors and hydration warnings.
 *
 * Opt-in, because onboarding is one-way and each run needs three fresh accounts:
 *
 *   1. Create the accounts (Supabase SQL editor / MCP execute_sql, as postgres):
 *        select set_config('civpms.qa_stamp', '1016072430', false);
 *        -- then run supabase/seed/qa-e2e.sql in the same session
 *   2. QA_STAMP=1016072430 BASE_URL=http://localhost:3210 npx playwright test e2e/final-golden-path.spec.ts
 *
 * QA_SHOTS=1 also writes docs/screenshots/final-qa-*.png (light, dark, 390 px phone) of the QA
 * accounts; QA_SHOTS_DIR writes them somewhere else. The README gallery (final-<screen>-*.png, demo
 * accounts) comes from e2e/final-screenshots.spec.ts.
 */
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loginAs, supabaseAs, type Who } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { toastWith, waitForRealtime } from "./helpers/ui";

const STAMP = process.env.QA_STAMP ?? "";
test.skip(!/^\d{10,14}$/.test(STAMP), "Set QA_STAMP and create the accounts with supabase/seed/qa-e2e.sql first");
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const PM: Who = { email: `qa-${STAMP}-pm@civpms.test` };
const INSPECTOR: Who = { email: `qa-${STAMP}-inspector@civpms.test` };
const RIVAL: Who = { email: `qa-${STAMP}-rival@civpms.test` };
const NAMES = { pm: "[QA] Patricia Planner", inspector: "[QA] Ivan Inspector", rival: "[QA] Rita Rival" };
const COMPANY = `[QA] ${STAMP}`;
const RIVAL_COMPANY = `[QA] ${STAMP} Rival Co`;
const PROJECT = `[QA] ${STAMP} Mactan Bridge Retrofit`;

const SHOTS = process.env.QA_SHOTS === "1";
const SHOTS_DIR = process.env.QA_SHOTS_DIR ?? path.join(process.cwd(), "docs", "screenshots");

let projectId = "";

/** The QA project's id: from test 1, or looked up by name when tests run on their own. */
async function qaProjectId(): Promise<string> {
  if (projectId) return projectId;
  const { client } = await supabaseAs(PM);
  const { data } = await client.from("projects").select("id").eq("name", PROJECT).maybeSingle();
  projectId = data?.id ?? "";
  expect(projectId, `${PROJECT} must exist (run test 1 first)`).not.toBe("");
  return projectId;
}

function row(page: Page, code: string) {
  return page.locator(`[data-testid=wbs-row][data-wbs-code="${code}"]`);
}

async function rowMenu(page: Page, code: string, item: RegExp) {
  await row(page, code).getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function addActivity(
  page: Page,
  fields: { name: string; start?: string; hours?: string; cost?: string },
) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(fields.name);
  if (fields.start) await dialog.getByLabel("Start date").fill(fields.start);
  if (fields.hours) await dialog.getByLabel(/^Duration/).fill(fields.hours);
  if (fields.cost) {
    await dialog.getByLabel("Estimated cost").fill(fields.cost);
    await dialog.getByLabel("Estimated cost").blur();
  }
  await dialog.getByRole("button", { name: /^Add / }).click();
  await expect(dialog).toBeHidden();
}

/** Pages the calendar's month grid to `target` ("November 2026"). */
async function showMonth(page: Page, target: string) {
  const title = page.locator("#calendar-month-title");
  const monthIndex = (text: string) => {
    const [monthName, year] = text.split(" ");
    return new Date(`${monthName} 1, ${year}`).getMonth() + Number(year) * 12;
  };
  for (let i = 0; i < 24 && (await title.textContent()) !== target; i += 1) {
    const current = monthIndex((await title.textContent()) ?? "");
    await page.getByRole("button", { name: current > monthIndex(target) ? "Previous month" : "Next month" }).click();
  }
  await expect(title).toHaveText(target);
}

/** Screenshots one screen as light + dark (1440×900) and phone (390×844, full page). */
async function shoot(
  browser: Browser,
  who: Who,
  shot: { name: string; path: string; heading: string | RegExp; variants?: ("light" | "dark" | "mobile")[]; prepare?: (page: Page) => Promise<void> },
) {
  if (!SHOTS) return;
  const variants = [
    { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
    { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
    { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
  ] as const;
  for (const variant of variants) {
    if (shot.variants && !shot.variants.includes(variant.suffix)) continue;
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await loginAs(context, who);
    const page = await context.newPage();
    const console = watchConsole(page);
    await page.goto(shot.path);
    await expect(page.getByRole("heading", { name: shot.heading }).first()).toBeVisible();
    await shot.prepare?.(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS_DIR, `final-qa-${shot.name}-${variant.suffix}.png`), fullPage: variant.fullPage });
    console.expectClean();
    await context.close();
  }
}

async function signIn(context: BrowserContext, who: Who) {
  await loginAs(context, who);
}

test("1 · a new PM onboards, creates the company and the first project", async ({ page, context }) => {
  const console = watchConsole(page);
  await signIn(context, PM);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);

  const progress = page.getByTestId("onboarding-progress");
  await expect(progress).toHaveAttribute("data-step", "1");
  await page.getByLabel("Full name").fill(NAMES.pm);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(progress).toHaveAttribute("data-step", "2");
  await page.getByRole("radio", { name: "Project Manager" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(progress).toHaveAttribute("data-step", "3");
  await page.getByTestId("company-name").fill(COMPANY);
  await expect(page.getByText(`${COMPANY} is available`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(toastWith(page, "Welcome to CivPMS")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByTestId("projects-first-run")).toContainText("No projects yet");

  // First project from the first-run checklist.
  await waitForRealtime(page);
  await page.getByTestId("projects-first-run").getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Project name").fill(PROJECT);
  await dialog.getByLabel("Estimated start").fill("2026-11-09");
  await dialog.getByLabel("Estimated end").fill("2027-03-31");
  await dialog.getByLabel("Estimated budget").fill("5,000,000");
  await dialog.getByLabel("Site name").fill("[QA] Mactan Channel, pier 4");
  await dialog.getByRole("radio", { name: "Teal" }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(toastWith(page, "Project created")).toBeVisible();
  projectId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(PROJECT);
  console.expectClean();
});

test("2 · the PM builds the WBS with dates and costs", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  await signIn(context, PM);
  await page.goto(`/projects/${projectId}/wbs`);
  await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Work Breakdown" })).toBeVisible();

  const empty = page.getByTestId("wbs-empty");
  await empty.getByRole("button", { name: "Add first deliverable" }).click();
  await addActivity(page, { name: "[QA] Substructure" });
  await expect(row(page, "1")).toContainText("[QA] Substructure");

  await rowMenu(page, "1", /^Add sub-deliverable inside/);
  await addActivity(page, { name: "[QA] Pier 4 foundations" });
  await expect(row(page, "1.1")).toContainText("[QA] Pier 4 foundations");

  // Mon 9 Nov 2026 + 40 working hours at 8 h/day → Fri 13 Nov 2026 (D20).
  await rowMenu(page, "1.1", /^Add work package inside/);
  await addActivity(page, { name: "[QA] Bored piles", start: "2026-11-09", hours: "40", cost: "1,250,000" });
  await expect(row(page, "1.1.1")).toContainText("13 Nov 2026");
  await expect(row(page, "1.1.1")).toContainText("₱1,250,000.00");

  // Mon 16 Nov + 24 h → Wed 18 Nov.
  await rowMenu(page, "1.1.1", /^Add work package below/);
  await addActivity(page, { name: "[QA] Pile caps", start: "2026-11-16", hours: "24", cost: "800,000" });
  await expect(row(page, "1.1.2")).toContainText("18 Nov 2026");

  // Parents roll up from their work packages; the budget bar follows.
  await expect(row(page, "1")).toContainText("₱2,050,000.00");
  await expect(page.getByTestId("wbs-allocated")).toHaveText("₱2,050,000.00");
  await expect(page.locator("[data-testid=wbs-row][aria-busy=true]")).toHaveCount(0);
  console.expectClean();
});

test("3 · a non-working day shows the reschedule preview and moves the work package", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  await signIn(context, PM);
  await page.goto(`/projects/${projectId}/calendar`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await showMonth(page, "November 2026");

  const day = page.locator('[data-testid=calendar-month] button[data-date="2026-11-11"]');
  await expect(day).toHaveAttribute("data-working", "true");
  await day.click({ button: "right" });
  const panel = page.getByTestId("calendar-day-panel");
  await panel.getByLabel(/Note/).fill("[QA] Typhoon signal no. 2 — site closed");
  await panel.getByRole("button", { name: "Mark as non-working day" }).click();
  await expect(day).toHaveAttribute("data-kind", "override-off");

  await page.getByRole("button", { name: "Save changes" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("1 work package will move");
  await expect(confirm).toContainText("[QA] Bored piles");
  await expect(confirm).toContainText("Ends 13 Nov 2026 → 16 Nov 2026");
  await confirm.getByRole("button", { name: "Save and reschedule" }).click();
  await expect(toastWith(page, "Calendar saved")).toBeVisible();

  await page.goto(`/projects/${projectId}/wbs`);
  await expect(row(page, "1.1.1")).toContainText("16 Nov 2026");
  await expect(row(page, "1.1.2")).toContainText("18 Nov 2026");
  console.expectClean();
});

let inviteToken = "";

test("4 · the PM invites an inspector by email and copies the link", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(context, PM);
  await page.goto(`/projects/${projectId}/collaborators`);
  await expect(page.getByRole("heading", { level: 1, name: "Collaborators" })).toBeVisible();
  await waitForRealtime(page);
  await page.getByRole("button", { name: "Invite people" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email address").fill(INSPECTOR.email);
  await dialog.getByRole("radio", { name: "Inspector" }).click();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog.getByLabel("Invitation link")).toHaveValue(/\/invite\/[A-Za-z0-9_-]{16,}$/);
  await dialog.getByRole("button", { name: "Copy invite link" }).click();
  await expect(toastWith(page, "Invite link copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await dialog.getByLabel("Invitation link").inputValue());
  inviteToken = copied.split("/invite/")[1] ?? "";
  expect(inviteToken).not.toBe("");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: INSPECTOR.email })).toBeVisible();
  console.expectClean();
});

test("5 · the inspector accepts and gets a read-only project", async ({ page, context }) => {
  await qaProjectId();
  expect(inviteToken, "run test 4 first").not.toBe("");
  const console = watchConsole(page);
  await signIn(context, INSPECTOR);
  await page.goto(`/invite/${inviteToken}`);
  await expect(page.getByRole("heading", { level: 1, name: `Join ${PROJECT}` })).toBeVisible();
  await expect(page.getByText(COMPANY).first()).toBeVisible();
  await page.getByLabel("Your full name").fill(NAMES.inspector);
  await page.getByRole("button", { name: "Accept and open project" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await expect(toastWith(page, `Welcome to ${PROJECT}`)).toBeVisible();

  // Read-only WBS.
  await page.goto(`/projects/${projectId}/wbs`);
  await expect(page.getByTestId("wbs-lock")).toContainText("View only");
  await expect(row(page, "1.1.1")).toContainText("[QA] Bored piles");
  await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Duration of/ })).toHaveCount(0);

  // Read-only calendar.
  await page.goto(`/projects/${projectId}/calendar`);
  await expect(page.getByTestId("calendar-lock")).toContainText("View only");
  await expect(page.getByRole("checkbox", { name: "Monday" })).toBeDisabled();

  // No invite controls, no project settings.
  await page.goto(`/projects/${projectId}/collaborators`);
  await expect(page.getByRole("heading", { level: 1, name: "Collaborators" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite people" })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText(NAMES.pm);

  // Home lists only this project, without "Add project".
  await page.goto("/");
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await expect(page.getByTestId("project-card")).toContainText(PROJECT);
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
  console.expectClean();
});

test("6 · the audit trail shows every step", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  await signIn(context, PM);
  await page.goto(`/projects/${projectId}/audit`);
  await expect(page.getByRole("heading", { level: 1, name: "Audit Trail" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText(`Created project "${PROJECT}"`)).toBeVisible();
  await expect(main.getByText(/Added 1 \[QA\] Substructure/)).toBeVisible();
  await expect(main.getByText(/Added 1\.1 \[QA\] Pier 4 foundations/)).toBeVisible();
  await expect(main.getByText(/Added 1\.1\.1 \[QA\] Bored piles/)).toBeVisible();
  await expect(main.getByText(/Added 1\.1\.2 \[QA\] Pile caps/)).toBeVisible();
  await expect(main.getByText(/11 Nov 2026/).first()).toBeVisible();
  await expect(main.getByText(new RegExp(`Invited ${INSPECTOR.email.replace(/[.]/g, "\\.")}`)).first()).toBeVisible();
  await expect(main.getByText(`${NAMES.inspector} joined the project as Inspector`)).toBeVisible();
  console.expectClean();
});

test("7 · profile, company settings and notifications work for the PM", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  await signIn(context, PM);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue(NAMES.pm);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Company settings" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(NAMES.inspector);
  await expect(page.getByRole("main").getByRole("textbox").first()).toHaveValue(COMPANY);

  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(NAMES.inspector);
  console.expectClean();
});

test("8 · another company sees none of it (UI and database)", async ({ page, context }) => {
  await qaProjectId();
  const console = watchConsole(page);
  const rival = await supabaseAs(RIVAL);
  const profile = await rival.client.from("profiles").select("onboarded_at").eq("id", rival.userId).single();
  if (!profile.data?.onboarded_at) {
    expect((await rival.client.rpc("complete_profile", { p_full_name: NAMES.rival, p_role_pref: "pm" })).error).toBeNull();
    expect((await rival.client.rpc("create_company", { p_name: RIVAL_COMPANY })).error).toBeNull();
  }

  // Database: RLS hides the project, its WBS, calendar, members and log.
  const [projects, activities, logs, members, invitations] = await Promise.all([
    rival.client.from("projects").select("id").eq("id", projectId),
    rival.client.from("activities").select("id").eq("project_id", projectId),
    rival.client.from("activity_logs").select("id").eq("project_id", projectId),
    rival.client.from("project_members").select("user_id").eq("project_id", projectId),
    rival.client.from("invitations").select("id").eq("project_id", projectId),
  ]);
  for (const result of [projects, activities, logs, members, invitations]) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  }

  // UI: home doesn't list it; its pages answer "not found".
  await signIn(context, RIVAL);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByText(PROJECT)).toHaveCount(0);
  for (const sub of ["", "/wbs", "/calendar", "/audit", "/collaborators"]) {
    await page.goto(`/projects/${projectId}${sub}`);
    await expect(page.getByRole("heading", { name: /We couldn't (open that project|find that)/ })).toBeVisible();
    await expect(page.getByText(PROJECT)).toHaveCount(0);
  }
  const csv = await page.request.get(`/projects/${projectId}/audit/export`);
  expect(csv.status()).toBe(404);
  console.expectClean();
});

test("9 · screenshots (QA_SHOTS=1)", async ({ browser }) => {
  test.skip(!SHOTS, "Set QA_SHOTS=1 to write docs/screenshots/final-qa-*.png");
  const p = `/projects/${await qaProjectId()}`;
  await shoot(browser, PM, { name: "home", path: "/", heading: "Projects" });
  await shoot(browser, PM, { name: "dashboard", path: p, heading: "Dashboard" });
  await shoot(browser, PM, {
    name: "wbs",
    path: `${p}/wbs`,
    heading: "Work Breakdown",
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
      await page.reload();
      await expect(row(page, "1.1.2")).toBeVisible();
    },
  });
  await shoot(browser, PM, {
    name: "wbs-graph",
    path: `${p}/wbs`,
    heading: "Work Breakdown",
    variants: ["light", "dark"],
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "graph"));
      await page.reload();
      await expect(page.locator(".react-flow__node").first()).toBeVisible();
    },
  });
  await shoot(browser, PM, {
    name: "calendar",
    path: `${p}/calendar`,
    heading: "Calendar",
    prepare: async (page) => showMonth(page, "November 2026"),
  });
  await shoot(browser, PM, { name: "collaborators", path: `${p}/collaborators`, heading: "Collaborators" });
  await shoot(browser, PM, { name: "audit", path: `${p}/audit`, heading: "Audit Trail" });
  await shoot(browser, PM, { name: "profile", path: "/profile", heading: "Profile" });
  await shoot(browser, PM, { name: "company", path: "/settings", heading: "Company settings" });
  await shoot(browser, PM, { name: "notifications", path: "/notifications", heading: "Notifications" });
  await shoot(browser, INSPECTOR, {
    name: "inspector-wbs",
    path: `${p}/wbs`,
    heading: "Work Breakdown",
    variants: ["light", "mobile"],
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
      await page.reload();
      await expect(page.getByTestId("wbs-lock")).toBeVisible();
    },
  });
  await shoot(browser, INSPECTOR, { name: "inspector-home", path: "/", heading: "Projects", variants: ["light", "mobile"] });
  await shoot(browser, RIVAL, { name: "rival-not-found", path: p, heading: /We couldn't/, variants: ["light", "dark"] });
});
