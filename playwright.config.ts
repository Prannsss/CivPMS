import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (Chromium only). Browsers are preinstalled at /opt/pw-browsers
 * (PLAYWRIGHT_BROWSERS_PATH) — never run `playwright install` here.
 *
 *   npm run test:e2e                       # starts `next dev` on E2E_PORT (default 3100)
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # reuse a running server
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Keep artifacts out of the working tree (the repo does not ignore test-results/).
  outputDir: "node_modules/.cache/playwright/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${port}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
