/**
 * playwright.config.ts — cross-browser config for the code-island isolation spec (Phase 20).
 *
 * Runs the sandbox-escape assertions in BOTH Chromium and Firefox: Firefox ignores the `csp=`
 * iframe attribute, so exercising both engines proves the inline `<meta>` CSP is the enforcing
 * layer (20-RESEARCH.md §5). These tests use `page.setContent` (no dev server required).
 *
 * SPIKE status: config authored; Playwright is not installed in the autonomous run. Enable with:
 *   npm i -D @playwright/test && npx playwright install chromium firefox
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
