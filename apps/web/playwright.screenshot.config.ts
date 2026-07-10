/**
 * playwright.screenshot.config.ts — dedicated config for the screenshot review harness (D-47-05).
 *
 * Kept SEPARATE from playwright.config.ts (the assertion-spec config `test:e2e` runs) so that
 * `npm run test:e2e` and `npm run screenshot:review` never run each other's specs: testMatch
 * below restricts this config to e2e/screenshot-review.spec.ts only, and the base config's
 * testMatch/testIgnore pair excludes that same spec so it never rides along on `test:e2e`.
 *
 * Reuses the base config's webServer + baseURL wiring (D-47-04) so a single command boots the
 * dev server and captures — `npm run dev`'s `dotenv -e ../../.env.local -- next dev` still
 * resolves correctly since cwd is this config's directory (apps/web).
 *
 * workers: 1 / fullyParallel: false — the capture spec is a single sequential test that shares
 * one timestamped run directory across every surface × viewport combination; parallelizing would
 * risk multiple runs racing on the same RUN_DIR.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /screenshot-review\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
