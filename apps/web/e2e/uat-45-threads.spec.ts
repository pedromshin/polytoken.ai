/**
 * apps/web/e2e/uat-45-threads.spec.ts — Phase-45 thread/inbox UAT burn-down:
 * grouping/expand/singleton/minimal-styling (45.1-45.4) + the
 * verification-code UI-visibility slice (45.7), Phase 50 Plan 03 (LIVE-05).
 * All five scenarios run against the LOCAL live stack via a seeded session
 * (apps/web/e2e/helpers/seed-session.ts) and a deterministic thread fixture
 * (apps/web/e2e/helpers/uat-thread-fixtures.ts) — no interactive Google, no
 * dependency on ambient local mail.
 *
 * 45.5 (real Gmail-forward fixture realism) and 45.6 (SES + Gmail forwarding
 * round-trip) are NOT runnable without a real Gmail forward / live SES —
 * see 45-HUMAN-UAT.md's dispositions (moved-to-morning-checklist, 45.6
 * cross-referencing 49-HUMAN-UAT.md §2 / LIVE-04).
 *
 * 45.7 note: the app's `/emails/[id]` editor is a canvas/region-review
 * surface (apps/web/src/app/emails/[id]/_components/email-detail.tsx) — it
 * renders plain-text body ONLY via a PDF/attachment preview pane, which a
 * plain-text fixture email (no attachment) never populates. The genuinely
 * UI-visible surface for a plain-text body is the INBOX's own reading
 * preview (apps/web/src/app/_components/inbox-three-pane.tsx's
 * `ReadingPreview`, right pane) — selecting the email there renders
 * `email.bodyText` directly. This spec asserts the verification code is
 * visible there, which is what "findable via inbox -> email detail without
 * DB access" means given the app's actual current surfaces.
 *
 * Locator discipline (50-02's documented lesson: unscoped text/svg locators
 * can match an ancestor AND a descendant simultaneously, or an unrelated
 * icon, causing strict-mode ambiguity): every assertion below targets an
 * element via its ARIA role (role="button" resolves ONLY to the element
 * that carries the role — never a nested <span> that merely contains
 * matching text) or a structurally-unique class token scoped to a single
 * known-unique ancestor, never a bare page-wide `getByText`.
 */

import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

import { seedAuthenticatedContext } from "./helpers/seed-session";
import { seedThreadFixtures } from "./helpers/uat-thread-fixtures";

// Playwright's test runner does not load root .env.local itself — see
// seed-session.ts's identical note. npm workspaces run this with
// cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

// All tests seed a session for the SAME shared local seed user via GoTrue
// admin magiclink + verifyOtp (seed-session.ts). GoTrue invalidates a user's
// prior magiclink token when a new one is generated, so concurrent
// seedAuthenticatedContext calls race — the same fix uat-41-knowledge-preview
// .spec.ts and uat-43-auth.spec.ts apply. Keep every test in this file
// serialized.
test.describe.configure({ mode: "serial" });

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertNotLoginUrl(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

test.describe("UAT 45: thread-grouped inbox (seeded session, DB/DOM-verified)", () => {
  test("45.1: a multi-message thread shows ONE entry with a count Badge and the latest snippet/date", async ({
    page,
    context,
  }) => {
    const seeded = await seedAuthenticatedContext(context);
    const fixtures = await seedThreadFixtures(seeded.userId);

    await page.goto("/");
    await assertNotLoginUrl(page);

    // The thread-group summary trigger is a real HTML `<button>` element
    // (InboxThreadGroup); a member InboxRow is a `<div role="button">` — NOT
    // a real button tag. The LATEST member shares its subject text verbatim
    // with the collapsed summary row (it IS the latest member), so a
    // role="button" accessible-name query would match BOTH once expanded;
    // scoping to the literal `button` tag resolves ONLY the summary trigger.
    const threadButton = page.locator("button").filter({ hasText: fixtures.threadLatestSubject });
    await expect(threadButton).toBeVisible({ timeout: 20_000 });

    // The collapsed summary row shows the LATEST member's subject + a count
    // Badge (> 1) + the latest snippet — never one row per member email.
    // Scoped to structurally-unique class tokens within the button (never a
    // bare getByText, which would also match the button's own aggregated
    // accessible-name text).
    const countBadge = threadButton.locator(".bg-secondary");
    await expect(countBadge).toHaveText(String(fixtures.threadEmailIds.length));
    const snippet = threadButton.locator("span.pl-6");
    await expect(snippet).toHaveText(fixtures.threadLatestSnippet);

    // The two OTHER thread members must NOT appear as separate top-level
    // rows while collapsed — no role=button element carries their subject
    // as its accessible name.
    await expect(
      page.getByRole("button", { name: new RegExp(escapeRegExp(fixtures.threadOldestSubject)) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: new RegExp(escapeRegExp(fixtures.threadMiddleSubject)) }),
    ).toHaveCount(0);
  });

  test("45.2: expanding a thread reveals members; selecting one drives the reading preview and 'Open editor ->' deep-links correctly", async ({
    page,
    context,
  }) => {
    const seeded = await seedAuthenticatedContext(context);
    const fixtures = await seedThreadFixtures(seeded.userId);

    await page.goto("/");
    await assertNotLoginUrl(page);

    // See 45.1's comment: scope to the literal `button` tag so this never
    // collides with the LATEST member's InboxRow (a `div[role=button]`) once
    // expanded — they share the same subject text.
    const threadButton = page.locator("button").filter({ hasText: fixtures.threadLatestSubject });
    await expect(threadButton).toBeVisible({ timeout: 20_000 });

    // Collapsed by default: aria-expanded=false, chevron not rotated.
    await expect(threadButton).toHaveAttribute("aria-expanded", "false");
    const chevron = threadButton.locator("svg").first();
    await expect(chevron).not.toHaveClass(/rotate-90/);

    await threadButton.click();
    await expect(threadButton).toHaveAttribute("aria-expanded", "true");
    await expect(chevron).toHaveClass(/rotate-90/);

    // The oldest member (a distinct, unmodified InboxRow — div[role=button])
    // is now revealed and selectable. role=button resolves ONLY to that
    // div, never to any nested span, so this is unambiguous.
    const oldestMemberRow = page.getByRole("button", {
      name: new RegExp(escapeRegExp(fixtures.threadOldestSubject)),
    });
    await expect(oldestMemberRow).toBeVisible({ timeout: 10_000 });
    await oldestMemberRow.click();

    // The strongest, unambiguous proof the reading preview now shows the
    // OLDEST member (not the thread's latest): the "Open editor ->" link's
    // href targets that exact member email's id.
    const openEditorLink = page.getByRole("link", { name: /Open editor/ });
    await expect(openEditorLink).toHaveAttribute(
      "href",
      `/emails/${fixtures.threadEmailIds[0]}`,
    );

    await openEditorLink.click();
    await expect(page).toHaveURL(new RegExp(`/emails/${fixtures.threadEmailIds[0]}`), {
      timeout: 20_000,
    });
    await assertNotLoginUrl(page);
    await expect(
      page.getByRole("heading", { name: fixtures.threadOldestSubject }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("45.3: a singleton (null thread_id orphan) renders as a flat row — no chevron, no count badge", async ({
    page,
    context,
  }) => {
    const seeded = await seedAuthenticatedContext(context);
    const fixtures = await seedThreadFixtures(seeded.userId);

    await page.goto("/");
    await assertNotLoginUrl(page);

    const singletonRow = page.getByRole("button", {
      name: new RegExp(escapeRegExp(fixtures.singletonSubject)),
    });
    await expect(singletonRow).toBeVisible({ timeout: 20_000 });

    // A singleton row is the UNMODIFIED InboxRow (div[role=button],
    // aria-pressed) — never the thread-group's disclosure <button
    // aria-expanded>. No aria-expanded attribute, no chevron svg.
    expect(await singletonRow.getAttribute("aria-expanded")).toBeNull();
    await expect(singletonRow.locator("svg")).toHaveCount(0);

    // Clicking it selects it directly (drives the reading preview) — it
    // never toggles a disclosure state. Verified via the "Open editor ->"
    // deep-link target, same unambiguous pattern as 45.2.
    await singletonRow.click();
    await expect(page.getByRole("link", { name: /Open editor/ })).toHaveAttribute(
      "href",
      `/emails/${fixtures.singletonEmailId}`,
    );
  });

  test("45.4: count Badge and snippet use only existing tokens (Badge variant=secondary, text-muted-foreground)", async ({
    page,
    context,
  }) => {
    const seeded = await seedAuthenticatedContext(context);
    const fixtures = await seedThreadFixtures(seeded.userId);

    await page.goto("/");
    await assertNotLoginUrl(page);

    // See 45.1's comment on why this is scoped to the literal `button` tag.
    const threadButton = page.locator("button").filter({ hasText: fixtures.threadLatestSubject });
    await expect(threadButton).toBeVisible({ timeout: 20_000 });

    // Badge variant="secondary" -> badgeVariants' secondary class includes
    // the literal `bg-secondary`/`text-secondary-foreground` tokens
    // (packages/ui/src/badge.tsx) — never a raw hex/new color.
    const countBadge = threadButton.locator(".bg-secondary");
    await expect(countBadge).toHaveClass(/bg-secondary/);
    await expect(countBadge).toHaveClass(/text-secondary-foreground/);

    // The latest-snippet span uses the existing text-muted-foreground token.
    const snippet = threadButton.locator("span.pl-6");
    await expect(snippet).toHaveClass(/text-muted-foreground/);
  });

  test("45.7 (UI-visibility slice): a seeded verification-code email is findable via the inbox without DB access", async ({
    page,
    context,
  }) => {
    const seeded = await seedAuthenticatedContext(context);
    const fixtures = await seedThreadFixtures(seeded.userId);

    await page.goto("/");
    await assertNotLoginUrl(page);

    const verificationRow = page.getByRole("button", {
      name: new RegExp(escapeRegExp(fixtures.verificationSubject)),
    });
    await expect(verificationRow).toBeVisible({ timeout: 20_000 });
    await verificationRow.click();

    // The reading preview (right pane) renders the email's plain-text body
    // directly (inbox-three-pane.tsx's ReadingPreview) — the verification
    // code is visible without opening the editor or touching the database.
    // `p.whitespace-pre-line` is the one structurally-unique body paragraph.
    const bodyParagraph = page.locator("p.whitespace-pre-line");
    await expect(bodyParagraph).toContainText(fixtures.verificationCode);
  });
});
