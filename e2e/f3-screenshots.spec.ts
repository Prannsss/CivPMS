/**
 * Documentation screenshots for the project workspace (docs/screenshots/f3-*.png). Skipped unless
 * F3_SHOTS=1, because it overwrites the committed images:
 *
 *   F3_SHOTS=1 BASE_URL=http://localhost:3203 npx playwright test e2e/f3-screenshots.spec.ts
 *
 * F3_SHOTS_DIR=<dir> writes somewhere else (for reviewing before replacing the committed ones).
 * Each screen is shot at 1440×900 light, 1440×900 dark and 390×844 (phone, full page). Demo
 * projects are only read here; nothing is changed.
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, supabaseAs, type Who } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";

test.skip(process.env.F3_SHOTS !== "1", "Set F3_SHOTS=1 to refresh docs/screenshots/f3-*.png");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const OUT = process.env.F3_SHOTS_DIR ?? path.join(process.cwd(), "docs", "screenshots");

const VARIANTS = [
  { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
  { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
  { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
];

type Shot = {
  name: string;
  who: Who;
  /** Path below /projects/<id>. */
  path: string;
  project: string;
  heading: string;
  variants?: string[];
  prepare?: (page: Page) => Promise<void>;
};

async function projectId(name: string): Promise<string> {
  const { client } = await supabaseAs("owner");
  const { data, error } = await client.from("projects").select("id").eq("name", name).is("deleted_at", null).single();
  if (error || !data) throw new Error(`Demo project "${name}" not found: ${error?.message}`);
  return data.id;
}

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function shoot(browser: Browser, shot: Shot) {
  const id = await projectId(shot.project);
  for (const variant of VARIANTS) {
    if (shot.variants && !shot.variants.includes(variant.suffix)) continue;
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await loginAs(context, shot.who);
    const page = await context.newPage();
    const console = watchConsole(page);
    await page.goto(`/projects/${id}${shot.path}`);
    await expect(page.getByRole("heading", { name: shot.heading }).first()).toBeVisible();
    await shot.prepare?.(page);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `f3-${shot.name}-${variant.suffix}.png`), fullPage: variant.fullPage });
    console.expectClean();
    await context.close();
  }
}

const CEBU = "Cebu Coastal Road Widening";
const DAVAO = "Davao Drainage Rehabilitation, Phase 2";
const LAGUNA = "Laguna Warehouse Expansion";

const SHOTS: Shot[] = [
  { name: "dashboard", who: "owner", project: CEBU, path: "", heading: "Dashboard" },
  { name: "dashboard-delayed", who: "owner", project: DAVAO, path: "", heading: "Dashboard" },
  { name: "dashboard-empty", who: "owner", project: LAGUNA, path: "", heading: "Dashboard", variants: ["light", "dark"] },
  { name: "settings", who: "owner", project: CEBU, path: "/settings", heading: "Project Settings" },
  {
    name: "settings-status",
    who: "owner",
    project: CEBU,
    path: "/settings#status",
    heading: "Project Settings",
    variants: ["light", "dark"],
    prepare: async (page) => {
      await page.getByRole("region", { name: "Status" }).scrollIntoViewIfNeeded();
    },
  },
  {
    name: "settings-forbidden",
    who: "inspector",
    project: CEBU,
    path: "/settings",
    heading: "You can't change this project's settings",
    variants: ["light", "dark"],
  },
  { name: "collaborators", who: "owner", project: CEBU, path: "/collaborators", heading: "Collaborators" },
  { name: "collaborators-inspector", who: "inspector", project: CEBU, path: "/collaborators", heading: "Collaborators", variants: ["light"] },
  { name: "audit", who: "owner", project: CEBU, path: "/audit", heading: "Audit Trail" },
  {
    name: "audit-empty",
    who: "owner",
    project: CEBU,
    path: "/audit?q=nothing-matches-this",
    heading: "Audit Trail",
    variants: ["light", "dark"],
  },
];

for (const shot of SHOTS) {
  test(`screenshot ${shot.name}`, async ({ browser }) => {
    await shoot(browser, shot);
  });
}
