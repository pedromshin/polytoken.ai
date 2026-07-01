/**
 * playwright.config.ts — cross-browser config for the code-island isolation spec (Phase 20).
 *
 * Runs the sandbox-escape assertions in BOTH Chromium and Firefox. The inline `<meta>` CSP is
 * the sole enforcing layer (no `csp=` attribute is used); exercising both engines proves the
 * opaque-origin + meta-CSP jail holds cross-browser (20-RESEARCH.md §5). These tests use
 * `page.setContent` (no dev server required).
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
