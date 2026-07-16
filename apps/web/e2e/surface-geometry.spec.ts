/**
 * apps/web/e2e/surface-geometry.spec.ts — the rendered-geometry gate (61-01 Task 1, SURF-02).
 *
 * WHY THIS EXISTS: jsdom does no layout, and the build does not error on an invalid arbitrary
 * value. Four layout bugs shipped through green suites in a single night, every one invisible to
 * every test we had:
 *
 *   - `/chat`'s conversation rail broke its height chain (`e2a2abf`). Radix renders
 *     `<Collapsible>` as a bare <div> with NO class of its own; given no className it grew to
 *     content, `CollapsibleContent`'s `h-full` resolved against THAT instead of the 856px
 *     wrapper, and the document scrolled to **11,296px at a 900px viewport** — the main pane read
 *     as empty. All 44 chat suites (363 tests) passed before AND after the fix.
 *   - The sidebar shipped at HALF WIDTH through Phase 55's 4/4 verification and 730 green tests
 *     (`w-[--sidebar-width]` is Tailwind v3; v4 needs `w-(--sidebar-width)`).
 *
 * Both were found by a human opening the app. Class-string assertions cannot see either, because
 * in both cases every class PRESENT was correct — the bug was a missing class on a component
 * rendering an invisible div, and a silently-dropped value. Only a real browser measuring a real
 * box can catch this class of defect. That is this file's entire job.
 *
 * THE INVARIANT: `/chat`'s root is `<div className="flex h-svh flex-col">` (chat/page.tsx), so a
 * correct /chat NEVER scrolls its document — its content scrolls INSIDE the rail and the
 * transcript. Two assertions therefore cover the whole class:
 *
 *   1. `document.documentElement.scrollHeight <= window.innerHeight + ε` — the negative half.
 *   2. the rail's and the transcript's own `[data-radix-scroll-area-viewport]` exist, are laid
 *      out, and stay bounded by the viewport — the positive half. Without (2), a surface that
 *      merely CLIPS its overflow would pass (1) while being just as broken.
 *
 * NEGATIVE PROOF (61-01 Task 1, re-runnable): remove `className="h-full"` from the
 * `<Collapsible>` in src/app/chat/_components/conversation-rail.tsx and this gate goes RED with
 * a scrollHeight in the thousands. Executed and recorded verbatim in 61-01-SUMMARY.md.
 *
 * RUNNING IT: `npm run test:geometry` (playwright.geometry.config.ts) — NEVER a bare
 * `npx playwright test`, which resolves the default config and spawns a second `next dev` that
 * corrupts the live server's `.next` (T-61-03 / 999.22). This config declares no `webServer` at
 * all: it asserts against the dev server ALREADY serving port 3000, and fails fast if none is.
 *
 * AUTH (T-61-01): `seedAuthenticatedContext` mints a REAL local GoTrue admin session
 * (magiclink + verifyOtp, never interactive Google). `isLocalTarget` is REIMPLEMENTED here
 * rather than imported from screenshot-review.spec.ts — importing that module would also
 * register its capture `test.describe` into this run (the same reason token-render.spec.ts
 * reimplements it, T-50-01). Both the app baseURL host and the Supabase URL host must be local;
 * anything unparseable fails CLOSED and the test skips rather than measuring a `/login`
 * redirect. A gate that silently measures the wrong page is worse than no gate — that is 60-07's
 * whole lesson.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { seedAuthenticatedContext } from "./helpers/seed-session";
import { resolveImporterId } from "./helpers/uat-chat-fixtures";

// Playwright's test runner does not load root .env.local itself (seed-session.ts documents the
// same footgun). npm workspaces run this with cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

/**
 * Sub-pixel rounding tolerance. Fractional layout heights (a 0.5px border, a scaled rem) can put
 * `scrollHeight` a hair above `innerHeight` on a perfectly correct page. 2px absorbs that and
 * nothing else: the failure mode this gate exists to catch measured 11,296px against a 900px
 * viewport — it is orders of magnitude, not a pixel. A tight epsilon costs nothing here, and a
 * loose one would not have caught anything extra.
 */
export const SCROLL_EPSILON_PX = 2;

/** Mirrors screenshot-review.spec.ts's VIEWPORTS exactly — the same two viewports every capture
 * is reviewed at, so the gate measures what the reviewer looks at. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * The real scroller inside a Radix ScrollArea. `@polytoken/ui/scroll-area`'s wrapper only
 * forwards a ref to the non-scrolling Root; `[data-radix-scroll-area-viewport]` is set
 * internally by @radix-ui/react-scroll-area and is the stable selector the product code itself
 * already keys on (message-list.tsx:85 does the same query for its auto-scroll logic).
 */
export const SCROLL_AREA_VIEWPORT_SELECTOR = "[data-radix-scroll-area-viewport]";

/** Matches chat/conversations.ts's DEFAULT_CHAT_MODEL_ID — never actually invoked. The fixture
 * conversation is never sent a message; selecting it is enough to mount the transcript +
 * composer, which is all this gate measures. */
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

/** Hosts allowed to receive the seeded (service_role-minted) session — T-61-01 / T-50-01.
 * Reimplemented locally, never imported (see file header). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalTarget(baseURL: string, supabaseUrl: string): boolean {
  try {
    const baseHost = new URL(baseURL).hostname;
    const supabaseHost = new URL(supabaseUrl).hostname;
    return LOCAL_HOSTS.has(baseHost) && LOCAL_HOSTS.has(supabaseHost);
  } catch {
    return false;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`surface-geometry.spec: missing required environment variable "${name}"`);
  }
  return value;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface DocumentMetrics {
  readonly scrollHeight: number;
  readonly innerHeight: number;
  readonly bodyScrollHeight: number;
}

async function measureDocument(page: Page): Promise<DocumentMetrics> {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    bodyScrollHeight: document.body.scrollHeight,
  }));
}

/**
 * THE PRIMARY ASSERTION — no surface scrolls its document unexpectedly.
 *
 * The failure message names the measured numbers on purpose: a gate whose red output does not
 * say "expected <= 902, got 11296" is a gate someone re-runs instead of reads.
 */
async function assertDocumentDoesNotScroll(page: Page, label: string): Promise<void> {
  const metrics = await measureDocument(page);
  const budget = metrics.innerHeight + SCROLL_EPSILON_PX;
  expect(
    metrics.scrollHeight,
    `${label}: the DOCUMENT scrolls, so a height chain is broken. Expected ` +
      `documentElement.scrollHeight <= ${budget} (innerHeight ${metrics.innerHeight} + ` +
      `${SCROLL_EPSILON_PX}px sub-pixel epsilon), got ${metrics.scrollHeight}. ` +
      `(body.scrollHeight ${metrics.bodyScrollHeight}.) /chat's root is "flex h-svh flex-col", ` +
      "so any element between it and a ScrollArea that grows to CONTENT instead of being bounded " +
      "by its parent produces exactly this — see e2a2abf (Radix <Collapsible> given no className " +
      "renders a bare unstyled <div> and grew to ~11,296px at a 900px viewport).",
  ).toBeLessThanOrEqual(budget);
}

/**
 * THE CONTAINMENT ASSERTION — the positive half of the same invariant. The document not
 * scrolling is only CORRECT if the content is scrolling somewhere else; a surface that clips its
 * overflow, or collapses to zero height, would otherwise sail through.
 */
async function assertScrollsInternally(
  page: Page,
  viewport: Locator,
  label: string,
): Promise<void> {
  await expect(viewport, `${label}: expected exactly one ScrollArea viewport`).toHaveCount(1);

  const measured = await viewport.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    rectHeight: el.getBoundingClientRect().height,
    innerHeight: window.innerHeight,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));

  expect(
    measured.clientHeight,
    `${label}: the ScrollArea viewport has zero client height — it is not laid out at all, so ` +
      "nothing can scroll inside it (the document-scroll assertion alone would still pass here).",
  ).toBeGreaterThan(0);

  const budget = measured.innerHeight + SCROLL_EPSILON_PX;
  expect(
    measured.rectHeight,
    `${label}: the ScrollArea viewport is TALLER than the viewport itself — it grew to its ` +
      `content instead of scrolling inside its parent. Expected rect height <= ${budget}, got ` +
      `${measured.rectHeight} (clientHeight ${measured.clientHeight}, scrollHeight ` +
      `${measured.scrollHeight}). This is the shape of a broken height chain even when an ` +
      "ancestor happens to clip it out of the document's own scrollHeight.",
  ).toBeLessThanOrEqual(budget);

  // D-61-06 — the HORIZONTAL half. This gate was green through a real, shipped bug: the
  // conversation rail's overflow menu sat at x=608 against a rail edge of x=464, so Rename
  // and Delete were UNREACHABLE. Radix's ScrollArea Viewport wraps its children in an
  // inline-styled `display:table` div that shrink-wraps to CONTENT, not to the viewport — so
  // a correctly-bounded rail silently grows sideways and pushes its controls off-screen.
  // Every ScrollArea in the app carries that wrapper, so this is systemic, not a chat quirk.
  // Vertical containment cannot see it, jsdom does no layout, and the surface still screenshots
  // plausibly (the overflow is clipped). Only this measurement finds it.
  expect(
    measured.scrollWidth,
    `${label}: the ScrollArea viewport scrolls HORIZONTALLY — its content is wider than it is, ` +
      `so controls at the content's right edge are pushed out of reach. Expected scrollWidth <= ` +
      `${measured.clientWidth + SCROLL_EPSILON_PX} (clientWidth ${measured.clientWidth} + ` +
      `${SCROLL_EPSILON_PX}px epsilon), got ${measured.scrollWidth}. Radix's Viewport child is ` +
      "`display:table` and shrink-wraps to content — give the inner content `w-full`/`min-w-0` " +
      "rather than widening the rail. See D-61-06 (61-03-SUMMARY.md).",
  ).toBeLessThanOrEqual(measured.clientWidth + SCROLL_EPSILON_PX);
}

interface PreparedChat {
  readonly conversationTitle: string;
}

/**
 * A settled assistant turn carrying ONE genui_spec part — the panel 61-08's editable-panel
 * toolbar mounts into (SURF-07, criterion 3).
 *
 * Never invokes a model: `chat.getHistory` replays `parts` VERBATIM (D-18), so this renders
 * through the identical component path a live generated panel would, at zero cost and with no
 * nondeterminism. Mirrors `screenshot-fixtures.ts`'s seeded part, deliberately — that is the one
 * this surface's captures show, and a gate measuring a DIFFERENT panel than the one in the
 * photographs would be answering a question nobody asked.
 *
 * No `style_pack_id`: a pack-less spec is the common case, and it keeps the toolbar's own chrome
 * (which is what is being measured) on the app's tokens rather than under a pack's ThemedRoot.
 */
const GENUI_PANEL_PARTS = [
  {
    type: "genui_spec",
    spec: {
      v: 1,
      root: {
        type: "card",
        title: "Q3 renewal quote",
        description: "Example Sender · received 12 March",
        children: [
          {
            type: "key-value-list",
            label: "Quote summary",
            items: [
              { key: "Subtotal", value: "$1,000.00" },
              { key: "Total", value: "$1,180.00" },
            ],
          },
        ],
      },
    },
  },
] as const;

/**
 * Seeds a session + one fixture conversation, opens /chat at `viewport`, selects the
 * conversation, and PROVES the app hydrated before anything is measured.
 *
 * The hydration proof is not ceremony: 60-07 reviewed 14 plausible-looking PNGs of an app that
 * had crashed on boot. A geometrically-perfect empty page is the easiest way for this gate to
 * report green about nothing at all, so the composer textarea must be visible AND enabled — a
 * skeleton-only or crashed render fails here, loudly, before a single box is measured.
 *
 * `withGenuiPanel` (61-08) seeds a settled turn carrying a genui panel. OPT-IN and default-off,
 * so the three existing geometry tests measure exactly the surface they always did — a fixture
 * change under a passing gate is how a gate quietly starts measuring something else.
 */
async function prepareChat(
  page: Page,
  context: BrowserContext,
  viewport: { readonly width: number; readonly height: number },
  options: { readonly withGenuiPanel?: boolean } = {},
): Promise<PreparedChat> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
  await dbClient.connect();
  let conversationTitle: string;
  try {
    const seeded = await seedAuthenticatedContext(context);
    const importerId = await resolveImporterId(dbClient, seeded.userId);

    // Sweep this spec's OWN stale fixtures before seeding. The run-unique title below is a
    // deliberate anti-race pattern and stays — but it leaks one conversation per run forever, and
    // this gate runs on every plan: 51 had already accumulated (of 281 total conversations in the
    // dev DB), which is why /chat's rail is ~11,000px of leaked test data. That is not cosmetic —
    // it made the rail's query slow enough to miss the screenshot harness's click timeout.
    //
    // Age-bounded, NOT title-bounded-only: a concurrent run's fixture is by definition recent, so
    // the 1-hour floor keeps the anti-race property intact while making growth bounded.
    await dbClient.query(
      `DELETE FROM chat_conversations
        WHERE title LIKE 'surface-geometry fixture %'
          AND created_at < now() - interval '1 hour'`,
    );

    // Own random id + run-unique title (49-03/live-loop-green.spec.ts's anti-race pattern) so
    // concurrent/previous runs' fixtures can never be the row this test clicks.
    const conversationId = randomUUID();
    conversationTitle = `surface-geometry fixture ${conversationId.slice(0, 8)}`;
    await dbClient.query(
      `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, seeded.userId, importerId, conversationTitle, CHAT_MODEL_ID],
    );

    if (options.withGenuiPanel === true) {
      await dbClient.query(
        `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
         VALUES ($1, 'user', $2::jsonb, 0, 'completed')`,
        [conversationId, JSON.stringify([{ type: "text", text: "Summarize the Q3 quote." }])],
      );
      await dbClient.query(
        `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
         VALUES ($1, 'assistant', $2::jsonb, 0, 'completed')`,
        [conversationId, JSON.stringify(GENUI_PANEL_PARTS)],
      );
    }
  } finally {
    await dbClient.end();
  }

  // SETTLING: `networkidle` (re-checked against this live stack — see 61-01-SUMMARY.md) plus an
  // explicit wait for a REAL element. The element wait is what actually gates the measurement; a
  // fixed sleep would be exactly the 999.24 defect this phase is fixing elsewhere.
  await page.goto("/chat", { waitUntil: "networkidle" });
  await expect(page, "seeded session did not survive to /chat — measuring a login redirect's " +
    "geometry would be a false green").not.toHaveURL(/\/login(\?|$)/);

  // Below `md` the rail is a left overlay Sheet (MOBL-01), closed on first paint — the
  // conversation row is not in the DOM until the top-bar toggle opens it.
  if (viewport.width < 768) {
    await page.getByRole("button", { name: "Collapse conversation list" }).click();
  }

  await page
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) })
    .click();

  // HYDRATION PROOF — visible AND enabled (see this function's doc comment).
  const composer = page.getByPlaceholder("Ask the agent anything…");
  await expect(composer, "the composer never became visible — the app did not hydrate, so any " +
    "geometry measured below would be the geometry of a broken page").toBeVisible({
    timeout: 30_000,
  });
  await expect(composer, "the composer is visible but DISABLED — the page is not interactive").
    toBeEnabled();

  return { conversationTitle };
}

/** The rail's own scroller: the ScrollArea viewport that contains the conversation list. Keyed
 * on the seeded row rather than on a class, so a Phase 61/62/63 restyle cannot silently point
 * this gate at the wrong box. */
function railViewport(page: Page, conversationTitle: string): Locator {
  return page.locator(SCROLL_AREA_VIEWPORT_SELECTOR).filter({
    has: page.getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) }),
  });
}

/**
 * The transcript's own scroller: the ScrollArea viewport inside the column that owns the
 * composer. Every <div> containing the composer textarea is by definition one of its ancestors,
 * and they nest, so `.last()` is the INNERMOST — ConversationView's
 * `flex h-full min-h-0 flex-col` column (MessageList + GeneratingIndicator + Composer). The
 * rail's viewport lives outside that column and is therefore excluded by construction.
 */
function transcriptViewport(page: Page): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByPlaceholder("Ask the agent anything…") })
    .filter({ has: page.locator(SCROLL_AREA_VIEWPORT_SELECTOR) })
    .last()
    .locator(SCROLL_AREA_VIEWPORT_SELECTOR);
}

test.describe("rendered-geometry gate: /chat (SURF-02, 61-01)", () => {
  // Serial — every test seeds a GoTrue session for the SAME local seed user, and minting a
  // magic link invalidates the prior unconsumed one (seed-session.ts's documented race). The
  // config pins workers: 1 for the same reason; this makes it explicit at the file level too.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ baseURL }) => {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const resolvedBaseURL = baseURL ?? "http://localhost:3000";
    test.skip(
      !isLocalTarget(resolvedBaseURL, supabaseUrl),
      "the geometry gate requires the local Supabase/dev stack (T-61-01 safety gate) — " +
        "seedAuthenticatedContext must never mint a service_role session against a non-local " +
        "target, and a /login redirect's geometry is not the geometry under test",
    );
  });

  test("does not scroll its document at the desktop viewport (1440x900)", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await prepareChat(page, context, DESKTOP_VIEWPORT);
    await assertDocumentDoesNotScroll(page, "/chat @ 1440x900");
  });

  test("does not scroll its document at the mobile viewport (390x844)", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await prepareChat(page, context, MOBILE_VIEWPORT);
    await assertDocumentDoesNotScroll(page, "/chat @ 390x844");
  });

  test("the rail and the transcript scroll INSIDE themselves (1440x900)", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const { conversationTitle } = await prepareChat(page, context, DESKTOP_VIEWPORT);

    await assertScrollsInternally(
      page,
      railViewport(page, conversationTitle),
      "/chat @ 1440x900 conversation rail",
    );
    await assertScrollsInternally(
      page,
      transcriptViewport(page),
      "/chat @ 1440x900 message transcript",
    );
  });
});

// ---------------------------------------------------------------------------
// CRITERION 3 — the editable-panel toolbar is OPERABLE on a phone (SURF-07, 61-08)
// ---------------------------------------------------------------------------

/**
 * "Reachable" is a claim about a THUMB, not about a media query — 61-CONTEXT says so explicitly,
 * and this is the only place in the repo that can measure it.
 *
 * WHY THIS LIVES IN THE GEOMETRY GATE AND NOT IN A UNIT SUITE: a touch target is a RENDERED
 * BOX. jsdom does no layout, so `transcript-panel-toolbar.test.tsx` can prove the four controls
 * MOUNT and can prove their aria contract, and it cannot prove a single pixel of their size.
 * The existing class-string gate (`touch-target-pointer-coarse.test.tsx`) is weaker still and
 * said so in its own header — "asserting the CLASS STRING is present is the correct, and only
 * testable, contract at this layer". It was green for three milestones while the floor it
 * asserted emitted NOTHING (`touch-target` was declared with `@layer utilities`, so Tailwind
 * never learned the name and could not compose `pointer-coarse:` onto it — 61-08 measured the
 * built sheet and fixed it with `@utility`). This suite is the answer to that: it measures the
 * boxes the browser actually lays out.
 *
 * WHY `hasTouch`/`isMobile` AND NOT JUST A 390px VIEWPORT: `pointer-coarse:` is a media FEATURE
 * keyed on pointer CAPABILITY, not on width — and that is correct, not a bug. A 390px-wide
 * desktop window driven by a mouse can hit a 24px button perfectly well and gets the compact
 * chrome by design. Only a real touch pointer earns the 44px floor. A width-only test would
 * measure 24px, be right to, and prove nothing about a phone. So this project emulates the
 * device, which is what makes `@media (pointer: coarse)` actually match.
 */
test.describe("criterion 3: the panel toolbar is operable on a phone (SURF-07, 61-08)", () => {
  test.describe.configure({ mode: "serial" });

  // A real touch device. `isMobile` + `hasTouch` are what make Chromium report
  // `(pointer: coarse)` — asserted in the first test rather than assumed.
  //
  // NOT `...devices["Pixel 7"]`: a device descriptor carries `defaultBrowserType`, which
  // Playwright refuses inside a describe group ("forces a new worker"). Naming the two options
  // that actually matter is also the more honest spelling — this suite's claim is about pointer
  // CAPABILITY, not about one vendor's handset.
  test.use({ hasTouch: true, isMobile: true });

  test.beforeEach(async ({ baseURL }) => {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const resolvedBaseURL = baseURL ?? "http://localhost:3000";
    test.skip(
      !isLocalTarget(resolvedBaseURL, supabaseUrl),
      "requires the local Supabase/dev stack (T-61-01 safety gate)",
    );
  });

  test("all four controls are reachable AND meet the 44px touch floor at 390px", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await prepareChat(page, context, MOBILE_VIEWPORT, { withGenuiPanel: true });

    // FIXTURE PRECONDITION. Without this the floor assertions below would pass for free on an
    // empty set — 61-06's negative proof found exactly that shape: a gate that was green and
    // about nothing.
    const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    expect(
      coarse,
      "the emulated device does not report (pointer: coarse), so the 44px floor this test " +
        "exists to measure is not even in play — every assertion below would be vacuous",
    ).toBe(true);

    // THE CLAIM: on a phone, the canvas cannot mount at all (`effectiveViewMode = isMobile ?
    // "chat" : viewMode`), so this toolbar existing here IS 999.17's write half closing.
    const toolbar = page.getByRole("toolbar", { name: "Panel actions" });
    await expect(
      toolbar,
      "the editable-panel toolbar is absent from the mobile transcript — the canvas never " +
        "mounts below md, so this is the ONLY place these four controls can exist on a phone " +
        "(999.17's write half, criterion 3)",
    ).toBeVisible({ timeout: 30_000 });

    // Every control criterion 3 names, by the accessible name a user reaches it through.
    const CONTROLS = ["Style pack", "Edit parameters", "Regenerate", "Re-theme"] as const;
    const TOUCH_FLOOR_PX = 44; // WCAG 2.5.8 / D-48-07

    for (const name of CONTROLS) {
      const control = toolbar.getByRole(/^Style pack$/.test(name) ? "combobox" : "button", {
        name,
      });
      await expect(control, `'${name}' is not reachable in the mobile transcript`).toBeVisible();

      const box = await control.boundingBox();
      expect(box, `'${name}' has no rendered box`).not.toBeNull();

      // The floor, measured — not a class string. `size-6` (24px) is the base recipe; the
      // coarse-pointer floor is the only thing standing between a thumb and a 24px target.
      expect(
        Math.round(box!.height),
        `'${name}' renders ${Math.round(box!.width)}x${Math.round(box!.height)}px on a touch ` +
          `device — below the ${TOUCH_FLOOR_PX}px floor (WCAG 2.5.8 / D-48-07). "Reachable" ` +
          `means operable with a thumb, not merely present in the DOM.`,
      ).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(
        Math.round(box!.width),
        `'${name}' renders ${Math.round(box!.width)}x${Math.round(box!.height)}px on a touch ` +
          `device — below the ${TOUCH_FLOOR_PX}px floor (WCAG 2.5.8 / D-48-07).`,
      ).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
  });

  test("the pack dropdown OPENS and its options are on-screen and tappable at 390px", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await prepareChat(page, context, MOBILE_VIEWPORT, { withGenuiPanel: true });

    const toolbar = page.getByRole("toolbar", { name: "Panel actions" });
    await expect(toolbar).toBeVisible({ timeout: 30_000 });

    // Mounted is not operable. A Radix Select renders its content in a PORTAL positioned against
    // the trigger — on a 390px screen a panel-anchored popover is exactly the thing that lands
    // half off-viewport, and no unit test and no screenshot of the closed toolbar can see it.
    await toolbar.getByRole("combobox", { name: "Style pack" }).click();

    const option = page.getByRole("option").first();
    await expect(
      option,
      "the pack dropdown did not open on a touch device — the control is present but not operable",
    ).toBeVisible({ timeout: 10_000 });

    const box = await option.boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.x,
      `a pack option is off the LEFT of a ${MOBILE_VIEWPORT.width}px screen (x=${box!.x})`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `a pack option overflows the RIGHT of a ${MOBILE_VIEWPORT.width}px screen ` +
        `(right edge ${Math.round(box!.x + box!.width)})`,
    ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  test("the Edit-parameters popover OPENS and stays on-screen at 390px", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await prepareChat(page, context, MOBILE_VIEWPORT, { withGenuiPanel: true });

    const toolbar = page.getByRole("toolbar", { name: "Panel actions" });
    await expect(toolbar).toBeVisible({ timeout: 30_000 });

    await toolbar.getByRole("button", { name: "Edit parameters" }).click();

    // `w-80` is 320px against a 390px screen — it fits, but only just, and only if Radix's
    // collision handling is actually doing its job at this width. Measured, not assumed.
    const surface = page.getByRole("dialog").first();
    await expect(
      surface,
      "the Edit-parameters popover did not open on a touch device — the control is present but " +
        "not operable, so criterion 3 is not met",
    ).toBeVisible({ timeout: 10_000 });

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.x,
      `the params popover is off the LEFT of a ${MOBILE_VIEWPORT.width}px screen (x=${box!.x})`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `the params popover overflows the RIGHT of a ${MOBILE_VIEWPORT.width}px screen ` +
        `(right edge ${Math.round(box!.x + box!.width)}) — a user cannot reach what is off-screen`,
    ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });
});
