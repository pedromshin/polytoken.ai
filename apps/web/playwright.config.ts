/**
 * playwright.config.ts — cross-browser config for the e2e suite (D-47-04).
 *
 * Covers two specs: code-island-isolation.spec.ts (Phase 20 SPIKE — `page.setContent` only,
 * no dev server needed) and auth-redirect.spec.ts (Phase 43 — needs a real running dev server
 * + baseURL). Runs the sandbox-escape assertions in BOTH Chromium and Firefox: the inline
 * `<meta>` CSP is the sole enforcing layer (no `csp=` attribute is used), so exercising both
 * engines proves the opaque-origin + meta-CSP jail holds cross-browser (20-RESEARCH.md §5).
 *
 * webServer runs `npm run dev` with cwd = this config's directory (apps/web), so the dev
 * script's `dotenv -e ../../.env.local -- next dev` still resolves to the root .env.local.
 * reuseExistingServer: true so this works whether or not a dev server is already running on
 * port 3000 (local dev commonly leaves one up).
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
