/**
 * Phase 0–1 gallery screenshots (docs/screenshots/final-<screen>-<light|dark|mobile>.png, used by
 * README.md) with the seeded demo accounts (supabase/seed/demo.sql). Read-only: it only opens
 * pages. Skipped unless FINAL_SHOTS=1, because it overwrites the committed images:
 *
 *   FINAL_SHOTS=1 BASE_URL=http://localhost:3210 npx playwright test e2e/final-screenshots.spec.ts
 *   FINAL_ONLY=wbs,calendar …   # only some screens
 *
 * Each screen is shot at 1440×900 light, 1440×900 dark and 390×844 (phone, full page). Every page
 * must stay free of console errors and hydration warnings.
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, supabaseAs, type Who } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";

test.skip(process.env.FINAL_SHOTS !== "1", "Set FINAL_SHOTS=1 to refresh docs/screenshots/final-*.png");
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const OUT = process.env.FINAL_SHOTS_DIR ?? path.join(process.cwd(), "docs", "screenshots");
const ONLY = process.env.FINAL_ONLY?.split(",").map((s) => s.trim());
/** The demo project with the fullest WBS (Owner PM: Juan Dela Cruz). */
const PROJECT = "Cebu Coastal Road Widening";

const VARIANTS = [
  { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
  { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
  { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
] as const;

type Shot = {
  name: string;
  who: Who;
  path: (projectPath: string) => string;
  heading: string | RegExp;
  prepare?: (page: Page) => Promise<void>;
};

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

async function wbsView(page: Page, view: "list" | "graph") {
  await page.evaluate((v) => localStorage.setItem("civpms.wbs.view", v), view);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Work Breakdown" }).first()).toBeVisible();
  if (view === "list") await expect(page.locator("[data-testid=wbs-row]").first()).toBeVisible();
  else await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

const SHOTS: Shot[] = [
  { name: "home", who: "owner", path: () => "/", heading: "Projects" },
  { name: "dashboard", who: "owner", path: (p) => p, heading: "Dashboard" },
  { name: "wbs", who: "owner", path: (p) => `${p}/wbs`, heading: "Work Breakdown", prepare: (page) => wbsView(page, "list") },
  { name: "wbs-graph", who: "owner", path: (p) => `${p}/wbs`, heading: "Work Breakdown", prepare: (page) => wbsView(page, "graph") },
  {
    name: "calendar",
    who: "owner",
    path: (p) => `${p}/calendar`,
    heading: "Calendar",
    prepare: (page) => showMonth(page, "November 2026"),
  },
  { name: "collaborators", who: "owner", path: (p) => `${p}/collaborators`, heading: "Collaborators" },
  { name: "audit", who: "owner", path: (p) => `${p}/audit`, heading: "Audit Trail" },
  { name: "profile", who: "owner", path: () => "/profile", heading: "Profile" },
  { name: "company", who: "owner", path: () => "/settings", heading: "Company settings" },
  { name: "notifications", who: "owner", path: () => "/notifications", heading: "Notifications" },
];

async function shoot(browser: Browser, shot: Shot, projectPath: string) {
  for (const variant of VARIANTS) {
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await loginAs(context, shot.who);
    const page = await context.newPage();
    const console = watchConsole(page);
    await page.goto(shot.path(projectPath));
    await expect(page.getByRole("heading", { name: shot.heading }).first()).toBeVisible();
    await shot.prepare?.(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `final-${shot.name}-${variant.suffix}.png`), fullPage: variant.fullPage });
    console.expectClean();
    await context.close();
  }
}

test("gallery screenshots (FINAL_SHOTS=1)", async ({ browser }) => {
  const { client } = await supabaseAs("owner");
  const { data, error } = await client.from("projects").select("id").eq("name", PROJECT).is("deleted_at", null).maybeSingle();
  expect(error).toBeNull();
  expect(data?.id, `${PROJECT} must exist (run supabase/seed/demo.sql)`).toBeTruthy();
  const projectPath = `/projects/${data?.id}`;
  for (const shot of SHOTS) {
    if (ONLY && !ONLY.includes(shot.name)) continue;
    await test.step(shot.name, () => shoot(browser, shot, projectPath));
  }
});
