/**
 * Documentation screenshots for the projects home (docs/screenshots/f2-*.png). Skipped unless
 * F2_SHOTS=1, because it overwrites the committed images:
 *
 *   F2_SHOTS=1 BASE_URL=http://localhost:3202 npx playwright test e2e/f2-screenshots.spec.ts
 *
 * Each screen is shot at 1440×900 light, 1440×900 dark and 390×844 (phone, full page).
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, type Who } from "./helpers/auth";
import { waitForRealtime } from "./helpers/ui";
import { ensureF2Tenant, F2_EMPTY, F2_INSPECTOR, F2_OWNER } from "./f2-tenant";

test.skip(process.env.F2_SHOTS !== "1", "Set F2_SHOTS=1 to refresh docs/screenshots/f2-*.png");
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const OUT = path.join(process.cwd(), "docs", "screenshots");

const VARIANTS = [
  { suffix: "light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const, fullPage: false },
  { suffix: "dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const, fullPage: false },
  { suffix: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" as const, fullPage: true },
];

type Shot = {
  name: string;
  who: Who;
  url: string;
  /** Waits for the content and optionally opens an overlay. Return false to shoot the viewport only. */
  prepare: (page: Page, mobile: boolean) => Promise<boolean | void>;
};

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

async function shoot(browser: Browser, shot: Shot) {
  for (const variant of VARIANTS) {
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await loginAs(context, shot.who);
    const page = await context.newPage();
    await page.goto(shot.url);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const keepFullPage = await shot.prepare(page, variant.suffix === "mobile");
    await settle(page);
    await page.screenshot({
      path: path.join(OUT, `f2-${shot.name}-${variant.suffix}.png`),
      fullPage: variant.fullPage && keepFullPage !== false,
    });
    await context.close();
  }
}

const SHOTS: Shot[] = [
  {
    name: "home",
    who: "owner",
    url: "/",
    prepare: async (page) => {
      await expect(page.getByTestId("project-card").first()).toBeVisible();
    },
  },
  {
    name: "home-attention",
    who: "owner",
    url: "/?status=attention",
    prepare: async (page) => {
      await expect(page.getByTestId("project-card")).toHaveCount(2);
    },
  },
  {
    name: "home-card-menu",
    who: F2_OWNER,
    url: "/?status=archived",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Actions for / }).first().click();
      await expect(page.getByRole("menuitem", { name: "Delete project" })).toBeVisible();
      return false;
    },
  },
  {
    name: "home-tenant",
    who: F2_OWNER,
    url: "/",
    prepare: async (page) => {
      await expect(page.getByTestId("project-card").first()).toBeVisible();
    },
  },
  {
    name: "home-no-match",
    who: "owner",
    url: "/?q=marikina",
    prepare: async (page) => {
      await expect(page.getByTestId("projects-filter-empty")).toBeVisible();
    },
  },
  {
    name: "home-inspector",
    who: "inspector",
    url: "/",
    prepare: async (page) => {
      await expect(page.getByTestId("project-card")).toHaveCount(1);
    },
  },
  {
    name: "home-first-run",
    who: F2_EMPTY,
    url: "/",
    prepare: async (page) => {
      await expect(page.getByTestId("projects-first-run")).toBeVisible();
    },
  },
  {
    name: "home-unassigned",
    who: F2_INSPECTOR,
    url: "/",
    prepare: async (page) => {
      await expect(page.getByTestId("projects-unassigned")).toBeVisible();
    },
  },
  {
    // "No company yet" (spec §4.3) on this page; the [FOUND] specs make this account join and leave.
    name: "home-no-company",
    who: "foundInspector",
    url: "/",
    prepare: async (page) => {
      await expect(page.getByText("Join a company to see its projects.")).toBeVisible();
    },
  },
  {
    name: "create-project",
    who: F2_OWNER,
    url: "/",
    prepare: async (page) => {
      await waitForRealtime(page); // hydrated: clicks and typing before hydration would be lost
      await page.getByTestId("add-project").click();
      const dialog = page.getByRole("dialog", { name: "New project" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Project name").fill("ab");
      await dialog.getByLabel("Estimated end").fill("2027-08-27");
      await dialog.getByLabel("Estimated budget").fill("86500000");
      await dialog.getByLabel("Site name").fill("Tagbilaran–Panglao link");
      await dialog.getByLabel("Site name").blur();
      await expect(dialog.getByText("Use at least 3 characters for the project name.")).toBeVisible();
      await dialog.locator(".overflow-y-auto").first().evaluate((el) => el.scrollTo({ top: 0 }));
      return false;
    },
  },
  {
    name: "recently-deleted",
    who: F2_OWNER,
    url: "/",
    prepare: async (page) => {
      await page.getByTestId("open-trash").click();
      await expect(page.getByRole("dialog", { name: "Recently deleted" })).toBeVisible();
      return false;
    },
  },
];

test.beforeAll(async () => {
  await ensureF2Tenant();
});

for (const shot of SHOTS) {
  test(`screenshot ${shot.name}`, async ({ browser }) => {
    await shoot(browser, shot);
  });
}
