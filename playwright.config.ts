import { existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (Chromium only). Browsers are preinstalled at /opt/pw-browsers
 * (PLAYWRIGHT_BROWSERS_PATH) — never run `playwright install` here.
 *
 *   npm run test:e2e                                  # starts `next dev` on :3200 (or reuses it)
 *   BASE_URL=http://localhost:3000 npm run test:e2e   # test a server that is already running
 *
 * Tests sign in through `e2e/helpers/auth.ts` (`loginAs(context, "owner")`), which needs
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and DEMO_PASSWORD. They are read
 * from .env.local (and the other Next env files) below.
 */
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Agent containers reach the internet through HTTPS_PROXY. Node's fetch (Supabase calls from the
// test workers and the dev server) only honours it with NODE_USE_ENV_PROXY; workers and the web
// server are spawned after this file runs, so they inherit it. Chromium gets the proxy below.
const httpsProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (httpsProxy && !process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = "1";

const baseURL = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3200").replace(/\/+$/, "");
const port = Number(new URL(baseURL).port || 80);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(new URL(baseURL).hostname);

// Cloud containers ship Chromium under /opt/pw-browsers; the build number changes between images, so
// prefer the stable symlink and fall back to the build this project was first set up with.
const CHROMIUM_PATH =
  ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((path) => existsSync(path)) ?? "";

export default defineConfig({
  testDir: "./e2e",
  // test-results/ is git-ignored.
  outputDir: "test-results/playwright",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    proxy: httpsProxy ? { server: httpsProxy, bypass: "localhost,127.0.0.1,::1" } : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer:
    process.env.BASE_URL || process.env.E2E_BASE_URL || !isLocal
      ? undefined
      : {
          command: `npx next dev -p ${port}`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 180_000,
        },
});
