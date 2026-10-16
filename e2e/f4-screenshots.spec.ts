/**
 * Documentation screenshots for the WBS and calendar (docs/screenshots/f4-*.png). Skipped unless
 * F4_SHOTS=1, because it overwrites the committed images:
 *
 *   F4_SHOTS=1 BASE_URL=http://localhost:3204 npx playwright test e2e/f4-screenshots.spec.ts
 *
 * Each screen is shot at 1440×900 light, 1440×900 dark and 390×844 (phone, full page).
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, type Who } from "./helpers/auth";
import { ensureF4Tenant, F4_INSPECTOR, F4_OWNER, type F4Tenant } from "./f4-tenant";

test.skip(process.env.F4_SHOTS !== "1", "Set F4_SHOTS=1 to refresh docs/screenshots/f4-*.png");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const OUT = path.join(process.cwd(), "docs", "screenshots");
const ONLY = process.env.F4_ONLY?.split(",");

const VARIANTS = [
  { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
  { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
  { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
];

type Shot = {
  name: string;
  who: Who;
  url: (t: F4Tenant) => string;
  heading: string;
  prepare?: (page: Page, mobile: boolean) => Promise<boolean | void>;
};

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function shoot(browser: Browser, tenant: F4Tenant, shot: Shot) {
  for (const variant of VARIANTS) {
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await loginAs(context, shot.who);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || /hydrat/i.test(msg.text())) problems.push(msg.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.goto(shot.url(tenant));
    await expect(page.getByRole("heading", { level: 1, name: shot.heading })).toBeVisible();
    const keepFullPage = await shot.prepare?.(page, variant.suffix === "mobile");
    await settle(page);
    await page.screenshot({
      path: path.join(OUT, `f4-${shot.name}-${variant.suffix}.png`),
      fullPage: variant.fullPage && keepFullPage !== false,
    });
    expect(problems, `console problems on ${shot.name}-${variant.suffix}`).toEqual([]);
    await context.close();
  }
}

const SHOTS: Shot[] = [
  {
    name: "wbs",
    who: F4_OWNER,
    url: (t) => `/projects/${t.showcaseId}/wbs`,
    heading: "Work Breakdown",
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
      await page.reload();
      await expect(page.getByTestId("wbs-row").first()).toBeVisible();
    },
  },
  {
    name: "wbs-graph",
    who: F4_OWNER,
    url: (t) => `/projects/${t.showcaseId}/wbs`,
    heading: "Work Breakdown",
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "graph"));
      await page.reload();
      await expect(page.getByTestId("wbs-graph-node").first()).toBeVisible();
      await page.getByTestId("wbs-graph").evaluate((el) => el.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(600);
      return false;
    },
  },
  {
    name: "wbs-empty",
    who: F4_OWNER,
    url: (t) => `/projects/${t.emptyId}/wbs`,
    heading: "Work Breakdown",
    prepare: async (page) => {
      await expect(page.getByTestId("wbs-empty")).toBeVisible();
    },
  },
  {
    name: "wbs-inspector",
    who: F4_INSPECTOR,
    url: (t) => `/projects/${t.showcaseId}/wbs`,
    heading: "Work Breakdown",
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem("civpms.wbs.view", "list"));
      await page.reload();
      await expect(page.getByTestId("wbs-lock")).toBeVisible();
    },
  },
  {
    name: "calendar",
    who: F4_OWNER,
    url: (t) => `/projects/${t.showcaseId}/calendar`,
    heading: "Calendar",
    prepare: async (page) => {
      await expect(page.getByTestId("calendar-month")).toBeVisible();
    },
  },
];

let tenant: F4Tenant;

test.beforeAll(async () => {
  tenant = await ensureF4Tenant();
});

for (const shot of SHOTS) {
  test(`screenshot ${shot.name}`, async ({ browser }) => {
    test.skip(Boolean(ONLY && !ONLY.includes(shot.name)), "not selected");
    await shoot(browser, tenant, shot);
  });
}
