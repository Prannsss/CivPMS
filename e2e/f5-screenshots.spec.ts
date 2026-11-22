/**
 * Documentation screenshots for profile, company settings and notifications
 * (docs/screenshots/f5-*.png). Skipped unless F5_SHOTS=1, because it overwrites the committed
 * images:
 *
 *   F5_SHOTS=1 BASE_URL=http://localhost:3215 npx playwright test e2e/f5-screenshots.spec.ts
 *
 * F5_SHOTS_DIR=<dir> writes somewhere else (for reviewing before replacing the committed ones).
 * Each screen is shot at 1440×900 light, 1440×900 dark and 390×844 (phone, full page). Pages are
 * only read here; nothing is changed.
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, type Who } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { F5, ensureF5Tenant } from "./f5-tenant";

test.skip(process.env.F5_SHOTS !== "1", "Set F5_SHOTS=1 to refresh docs/screenshots/f5-*.png");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const OUT = process.env.F5_SHOTS_DIR ?? path.join(process.cwd(), "docs", "screenshots");

const VARIANTS = [
  { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
  { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
  { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
];

type Shot = {
  name: string;
  who: Who;
  path: string;
  heading: string;
  variants?: string[];
  prepare?: (page: Page) => Promise<void>;
};

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

async function shoot(browser: Browser, shot: Shot) {
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
    await page.goto(shot.path);
    await expect(page.getByRole("heading", { level: 1, name: shot.heading })).toBeVisible();
    await shot.prepare?.(page);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `f5-${shot.name}-${variant.suffix}.png`), fullPage: variant.fullPage });
    console.expectClean();
    await context.close();
  }
}

const SHOTS: Shot[] = [
  { name: "profile", who: F5.owner, path: "/profile", heading: "Profile" },
  {
    name: "profile-notifications",
    who: F5.owner,
    path: "/profile#notifications",
    heading: "Profile",
    variants: ["light", "dark"],
    prepare: async (page) => {
      await page.locator("#notifications").scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById("notifications")?.scrollIntoView({ block: "start" }));
    },
  },
  { name: "company", who: F5.owner, path: "/settings", heading: "Company settings" },
  {
    name: "company-members",
    who: F5.owner,
    path: "/settings#members",
    heading: "Company settings",
    variants: ["light", "dark"],
    prepare: async (page) => {
      await page.evaluate(() => document.getElementById("members")?.scrollIntoView({ block: "start" }));
    },
  },
  { name: "company-pm", who: F5.pm, path: "/settings", heading: "Company settings", variants: ["light"] },
  { name: "company-inspector", who: F5.inspector, path: "/settings", heading: "Company settings", variants: ["light", "mobile"] },
  { name: "notifications", who: F5.owner, path: "/notifications", heading: "Notifications" },
  { name: "notifications-empty", who: F5.profile, path: "/notifications?filter=unread", heading: "Notifications", variants: ["light", "dark"] },
];

test.beforeAll(async () => {
  await ensureF5Tenant();
});

for (const shot of SHOTS) {
  test(`screenshot ${shot.name}`, async ({ browser }) => {
    await shoot(browser, shot);
  });
}
