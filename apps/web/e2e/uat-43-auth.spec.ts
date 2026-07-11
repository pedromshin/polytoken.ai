/**
 * apps/web/e2e/uat-43-auth.spec.ts — Phase-43 auth UAT burn-down: session
 * persistence across a reload + a new tab (43.2) and the sign-out loop
 * (43.3), Phase 50 Plan 03 (LIVE-05). Both scenarios run against the LOCAL
 * live stack via a seeded session (apps/web/e2e/helpers/seed-session.ts) —
 * no interactive Google.
 *
 * 43.4 (signed-out visit to `/` -> `/login`) is intentionally NOT duplicated
 * here — its canonical evidence is the existing
 * `apps/web/e2e/auth-redirect.spec.ts`, run alongside this file:
 *   npm run test:e2e -- uat-43-auth.spec.ts auth-redirect.spec.ts --project=chromium
 *
 * 43.1 (live Google OAuth on the deployed app) is not runnable locally (real
 * Google + a deployed app) — see 43-HUMAN-UAT.md's disposition
 * (moved-to-morning-checklist, cross-referencing 49-HUMAN-UAT.md §1 / LIVE-03).
 */

import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

import { seedAuthenticatedContext } from "./helpers/seed-session";

// Playwright's test runner does not load root .env.local itself (no dotenv
// wrapper on `playwright test` — see seed-session.ts's identical note).
// npm workspaces run this with cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

// Both scenarios below mint a session for the SAME seed email via GoTrue
// admin magiclink + verifyOtp (seed-session.ts). GoTrue invalidates a user's
// prior magiclink token when a new one is generated, so two tests calling
// seedAuthenticatedContext concurrently (this file's default
// `fullyParallel: true`) race and can fail with "Email link is invalid or
// has expired" — the SAME serialization fix uat-41-knowledge-preview.spec.ts
// applies. File-level serial mode keeps every test in this file running one
// at a time.
test.describe.configure({ mode: "serial" });

async function assertNotLoginUrl(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

async function assertLoginUrl(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });
}

/** Real authenticated app chrome (the sidebar's Inbox link) — proves the
 * page actually rendered signed-in content, not merely "didn't redirect". */
async function assertSignedInChromeVisible(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("UAT 43.2 — session persistence across refresh and a new tab", () => {
  test("seeded session survives a full reload and a fresh tab in the same context", async ({
    page,
    context,
  }) => {
    await seedAuthenticatedContext(context);

    await page.goto("/");
    await assertNotLoginUrl(page);
    await assertSignedInChromeVisible(page);

    // A full reload must not bounce to /login — middleware refreshes the
    // session transparently (apps/web/src/lib/supabase/middleware.ts).
    await page.reload();
    await assertNotLoginUrl(page);
    await assertSignedInChromeVisible(page);

    // A SECOND page in the SAME browser context (shares cookies — mirrors
    // "open a new tab") must also load signed-in without a fresh sign-in.
    const secondPage = await context.newPage();
    try {
      await secondPage.goto("/");
      await assertNotLoginUrl(secondPage);
      await expect(secondPage.getByRole("link", { name: "Inbox" })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await secondPage.close();
    }
  });
});

test.describe("UAT 43.3 — sign-out loop clears the session for real", () => {
  test("sign-out lands on /login and a protected route re-redirects afterward", async ({
    page,
    context,
  }) => {
    await seedAuthenticatedContext(context);

    await page.goto("/");
    await assertNotLoginUrl(page);
    await assertSignedInChromeVisible(page);

    // Click the sidebar sign-out control (sign-out-button.tsx: a plain form
    // POST to /auth/signout — a real full-page navigation, not a fetch —
    // that clears the httpOnly Supabase cookies server-side then
    // 303-redirects to /login, apps/web/src/app/auth/signout/route.ts).
    await page.getByRole("button", { name: "Sign out" }).click();
    await assertLoginUrl(page);

    // The proof this scenario exists for: the session must be ACTUALLY
    // cleared, not just a cosmetic /login landing. Revisiting a protected
    // route in the SAME browser context must redirect back to /login.
    await page.goto("/");
    await assertLoginUrl(page);
  });
});
