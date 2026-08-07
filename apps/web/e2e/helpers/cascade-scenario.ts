/**
 * apps/web/e2e/helpers/cascade-scenario.ts — the cascade / merge-repaint scenario body for the
 * screenshot-review harness (Phase 75, CPF-05/06 — vNEXT audit seam 7).
 *
 * WHY THIS EXISTS: the screenshot spec predates Phase 75 and had ZERO cascade coverage — the
 * merge-review surface (`/entities/review`, EN-02) never appeared in any committed capture, and
 * the CPF-06 repaint (a confirm click sweeping a highlight ring across every touched card) was
 * invisible to every review. That is 999.24's blindness shape again, one surface over. The
 * scenario lives here rather than inline because screenshot-review.spec.ts sits against the
 * 800-line file law; the spec registers the test and passes its OWN levers in (see
 * `CascadeScenarioHarness`), so the two capture paths share one theme/settle/filename discipline
 * instead of drifting copies.
 *
 * WHAT IT DOES:
 *   1. Pre-state frames of `/entities/review` in BOTH themes (999.23), desktop — pure camera
 *      work, no clicks, no writes. This alone ends the surface's zero-coverage state.
 *   2. IF the operator declares the cascade live (see CASCADE_FLAG_ENV below): ONE confirm-merge
 *      click on the first pending pair, light/desktop — then two frames: the immediate
 *      optimistic repaint (inside the highlight window, deliberately unsettled) and the settled
 *      post-merge state after the invalidation refetch.
 *   3. A `cascade-index.md` in the same RUN_DIR recording settle status, pair counts, the
 *      observed server cascade status, and the ring check — written even when a skip unwinds
 *      the scenario mid-way, so whatever WAS captured is indexed.
 *
 * SKIP LADDER — every rung `test.skip`s with a message; NONE reds the suite (pre-flip the whole
 * point is that this degrades to "photographed the queue, withheld the click"):
 *   1. non-local target       — handled in the SPEC before this module runs (T-50-01: the click
 *                               WRITES; it never runs against a hosted target).
 *   2. seeding failed         — also the spec's rung (its lever, its skip).
 *   3. redirected to /login   — seeded session did not hold; the redirect frames are kept.
 *   4. queue empty            — no cascade data exists yet; queue-clear frames are captured
 *                               FIRST (a photograph of the empty queue is honest information).
 *   5. flag dark              — `CASCADE_CORRECTION_ENABLED` not exported truthy for this run;
 *                               pre-state captured, the click withheld so a real pending pair is
 *                               not consumed photographing a cascade that cannot happen.
 *
 * THE MERGE IS A REAL WRITE, ONCE, DELIBERATELY. Clicking Merge runs the EXISTING
 * entities.confirmMerge write path (use-merge-review.ts) against the local dev DB and consumes
 * one real pending pair per run — that is the price of photographing the real repaint rather
 * than a mock, and it is why the click is gated behind the operator's explicit flag declaration
 * and runs on one theme/viewport only (pre-state gets the full theme axis; the click cannot be
 * replayed for the second theme without a second pair, and a re-labelled copy would be the
 * mislabelled-evidence sin the harness header forbids).
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { test, type BrowserContext, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The merge/correction surface (EN-02): the human gate whose confirm click is what drives the
 * Phase 75 correction cascade (use-merge-review.ts calls the EXISTING entities.confirmMerge). */
const CASCADE_REVIEW_PATH = "/entities/review";

/** Every pending pair card carries this attribute (review-pair-card.tsx — `data-pair-key` on the
 * Card), so pair presence/removal is read from the DOM, never inferred from counts in copy. */
const PAIR_CARD_SELECTOR = "[data-pair-key]";

/**
 * The CPF-06 highlight ring's DOM marker: EntityNode sets `data-corrected` while its entity id
 * is marked in the ephemeral cascade-highlight store (entity-node.tsx:142). EntityNode mounts on
 * the CANVAS surfaces (/chat, /home) — NOT on /entities/review — and the mark self-clears after
 * `HIGHLIGHT_MS` (cascade-highlight.ts:29, 1800ms; mirrored below rather than imported, because
 * that module is "use client" React and the harness deliberately imports only React-free app
 * modules — see the spec's NODE_REGISTRY_VERSION import note). A cross-route navigation cannot
 * arrive inside that window, so the ring is CHECKED on the current page immediately after the
 * merge and its presence/absence RECORDED — "IF reachable", never assumed and never faked.
 */
const CORRECTED_RING_SELECTOR = "[data-corrected]";
const CASCADE_HIGHLIGHT_MS = 1_800;

/**
 * The server cascade flag lives in the LISTENER's env (apps/email-listener/app/settings.py —
 * `CASCADE_CORRECTION_ENABLED`, byte-dark False until the WEDG-01 flip), which the web app and
 * this harness cannot read directly. The operator therefore DECLARES it per run by exporting the
 * same name into the harness's env; while undeclared/dark the merge click is withheld. The
 * declaration is then CHECKED against reality: the confirmMerge response's `cascade` field
 * (packages/api-client mutations.ts — null/absent while the listener flag is off) is classified
 * and recorded in cascade-index.md, so a wrong declaration is visible rather than trusted.
 */
const CASCADE_FLAG_ENV = "CASCADE_CORRECTION_ENABLED";

/** Desktop-only: the scenario is about the correction flow, not responsive geometry — the queue
 * is a single centered max-w-3xl column and the base surfaces already cover the viewport axis. */
const CASCADE_VIEWPORT = { name: "desktop", width: 1440, height: 900 } as const;

// ---------------------------------------------------------------------------
// Harness kit — the spec's own levers, passed in so the two paths never drift
// ---------------------------------------------------------------------------

/** Both halves of the locked identity (999.23) — structurally identical to the spec's Theme. */
export type CascadeTheme = "light" | "dark";

const CASCADE_THEMES: readonly CascadeTheme[] = ["light", "dark"];

interface CascadeSettleResult {
  readonly networkIdle: boolean;
  readonly contentReady: boolean;
}

/**
 * The levers this scenario borrows from screenshot-review.spec.ts. Passed as values rather than
 * imported: importing the spec from a helper the spec itself imports would be a cycle, and
 * re-implementing them here would fork the theme/settle discipline the spec's header spends
 * eighty lines defending.
 */
export interface CascadeScenarioHarness {
  readonly context: BrowserContext;
  readonly runDir: string;
  readonly runTimestamp: string;
  readonly openThemedPage: (context: BrowserContext, theme: CascadeTheme) => Promise<Page>;
  readonly assertThemeApplied: (page: Page, theme: CascadeTheme, label: string) => Promise<void>;
  readonly settle: (page: Page) => Promise<CascadeSettleResult>;
  readonly describeSettle: (result: CascadeSettleResult) => string;
  readonly resolveAuthStatus: (currentUrl: string, requestedPath: string) => string;
  readonly buildFilename: (
    surfaceName: string,
    viewportName: string,
    theme: CascadeTheme,
    packId: string,
  ) => string;
}

interface CascadeCaptureRecord {
  readonly step: string;
  readonly viewport: string;
  readonly theme: CascadeTheme;
  readonly note: string;
  readonly filename: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCascadeFlagDeclaredOn(): boolean {
  const raw = (process.env[CASCADE_FLAG_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Classify what the confirmMerge response says the cascade actually did. Body matching is
 * deliberately substring-tolerant (tRPC may batch and superjson-wrap the payload): a `"cascade"`
 * key holding an object means the listener ran the cascade. The app transport is
 * httpBatchStreamLink, which commits HTTP 200 before any procedure resolves — a FAILED merge
 * therefore arrives ok:true with a tRPC `"error"` envelope in the body, so the error check must
 * run before anything on a 2xx may be classified as flag-dark. Never throws — the caller records
 * the string.
 */
function classifyCascadeFromBody(ok: boolean, status: number, body: string): string {
  if (!ok) return `merge request failed (HTTP ${status}) — optimistic repaint reverted`;
  if (/"cascade"\s*:\s*\{/.test(body)) {
    return "live — cascade summary present in confirmMerge response";
  }
  if (/"error"\s*:/.test(body)) {
    return "failed — tRPC error envelope in streamed 200 response — optimistic repaint reverted";
  }
  return "dark — cascade null/absent in confirmMerge response (listener flag off)";
}

async function captureCascadeFrame(
  harness: CascadeScenarioHarness,
  page: Page,
  step: string,
  theme: CascadeTheme,
  note: string,
  records: CascadeCaptureRecord[],
): Promise<void> {
  const filename = harness.buildFilename(
    `cascade-review-${step}`,
    CASCADE_VIEWPORT.name,
    theme,
    "default",
  );
  await page.screenshot({ path: path.join(harness.runDir, filename), fullPage: true });
  records.push({ step, viewport: CASCADE_VIEWPORT.name, theme, note, filename });
}

/** Own index file (cascade-index.md), NOT index.md: the scenario is a separate Playwright test
 * and the main run's index is written at that test's end — appending across tests would race a
 * re-read or clobber. Same RUN_DIR, so one review folder still tells the whole run's story. */
async function writeCascadeIndex(
  harness: CascadeScenarioHarness,
  records: readonly CascadeCaptureRecord[],
  headerNotes: readonly string[],
): Promise<void> {
  const header = [
    `# Cascade / merge-repaint scenario — ${harness.runTimestamp}`,
    "",
    "Phase 75 (CPF-05/06) coverage — vNEXT audit seam 7. Pre-state frames photograph the",
    "`/entities/review` queue in both themes; the confirm-merge click (light/desktop only — it",
    "CONSUMES one real pending pair per run) is captured twice: the immediate optimistic repaint",
    `(inside the ${CASCADE_HIGHLIGHT_MS}ms highlight window, deliberately unsettled) and the`,
    "settled state after the invalidation refetch. The `[data-corrected]` highlight ring mounts",
    "on canvas EntityNodes (/chat, /home), not on this surface — its presence is RECORDED from",
    "the live DOM, never assumed. A skipped run still writes this index for whatever it captured.",
    "",
    ...headerNotes.map((note) => `- ${note}`),
    "",
    "| Step | Viewport | Theme | Notes | File |",
    "| --- | --- | --- | --- | --- |",
  ].join("\n");

  const rows = records
    .map((r) => `| ${r.step} | ${r.viewport} | ${r.theme} | ${r.note} | ${r.filename} |`)
    .join("\n");

  await writeFile(path.join(harness.runDir, "cascade-index.md"), `${header}\n${rows}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

/**
 * runCascadeScenario — the scenario body. Call from a running Playwright test AFTER the
 * local-target and session-seeding gates have passed (the spec's rungs). `test.skip` calls in
 * here resolve against the currently-running test, and the finally block writes cascade-index.md
 * for whatever was captured before a skip unwound the flow.
 */
export async function runCascadeScenario(harness: CascadeScenarioHarness): Promise<void> {
  await mkdir(harness.runDir, { recursive: true });

  const records: CascadeCaptureRecord[] = [];
  const headerNotes: string[] = [
    `${CASCADE_FLAG_ENV} declared for this run: ${
      isCascadeFlagDeclaredOn() ? "ON" : "dark (unset/false)"
    }`,
  ];

  try {
    // ---- Pre-state: both themes, desktop. Pure camera work — no clicks, no writes. ----
    let redirected = false;
    let observedPairCount = 0;
    for (const theme of CASCADE_THEMES) {
      const page = await harness.openThemedPage(harness.context, theme);
      try {
        await page.setViewportSize({
          width: CASCADE_VIEWPORT.width,
          height: CASCADE_VIEWPORT.height,
        });
        await page.goto(CASCADE_REVIEW_PATH, { waitUntil: "load" });
        const authStatus = harness.resolveAuthStatus(page.url(), CASCADE_REVIEW_PATH);
        const settleResult = await harness.settle(page);
        await harness.assertThemeApplied(page, theme, `cascade-review pre @ desktop/${theme}`);
        const pairCount =
          authStatus === "captured" ? await page.locator(PAIR_CARD_SELECTOR).count() : 0;
        if (authStatus !== "captured") redirected = true;
        observedPairCount = Math.max(observedPairCount, pairCount);
        await captureCascadeFrame(
          harness,
          page,
          "pre",
          theme,
          `${harness.describeSettle(settleResult)} auth:${authStatus} pairs:${pairCount}`,
          records,
        );
      } finally {
        await page.close();
      }
    }

    test.skip(
      redirected,
      "cascade scenario skipped: /entities/review redirected to /login despite the seeded " +
        "session — pre-state frames (of the redirect) were still captured and indexed.",
    );
    test.skip(
      observedPairCount === 0,
      "cascade scenario skipped: no cascade data exists — the merge-review queue holds no " +
        "pending pair (queue-clear frames captured). Pairs appear once extraction proposes " +
        "duplicates on real mail; re-run then.",
    );
    test.skip(
      !isCascadeFlagDeclaredOn(),
      `cascade scenario merge click withheld: ${CASCADE_FLAG_ENV} is dark for this run (the ` +
        "listener flag is byte-dark OFF pre-flip, and the click would consume a real pending " +
        "pair while the server cascade cannot run). Pre-state frames were captured. Export " +
        `${CASCADE_FLAG_ENV}=true when running post-flip (WEDG-01).`,
    );

    // ---- The click: ONCE, light/desktop. Consumes one real pending pair (deliberate). ----
    const page = await harness.openThemedPage(harness.context, "light");
    try {
      await page.setViewportSize({
        width: CASCADE_VIEWPORT.width,
        height: CASCADE_VIEWPORT.height,
      });
      await page.goto(CASCADE_REVIEW_PATH, { waitUntil: "load" });
      await harness.settle(page);
      await harness.assertThemeApplied(page, "light", "cascade-review merge @ desktop/light");

      const pairCount = await page.locator(PAIR_CARD_SELECTOR).count();
      test.skip(
        pairCount === 0,
        "cascade scenario skipped: the pending pair disappeared between the pre-state pass " +
          "and the merge pass (another session may have resolved it) — pre-state frames kept.",
      );

      const firstPair = page.locator(PAIR_CARD_SELECTOR).first();
      const pairKey = (await firstPair.getAttribute("data-pair-key")) ?? "";

      // Arm the response watch BEFORE the click — the cascade truth (mutations.ts's additive
      // `cascade` field) rides on this response and is recorded, never assumed. Non-fatal: a
      // missed response degrades to "unknown" in the record.
      const responsePromise = page
        .waitForResponse(
          (r) => r.url().includes("entities.confirmMerge") && r.request().method() === "POST",
          { timeout: 30_000 },
        )
        .catch(() => null);

      // Accessible name is the card's aria-label ("Merge X into Y") — the Reject button's
      // label starts with "Reject", so the anchor keeps this unambiguous within the card.
      await firstPair.getByRole("button", { name: /^Merge\b/ }).click({ timeout: 10_000 });

      // The optimistic repaint IS the pair card leaving the DOM (use-merge-review.ts onMutate
      // removes it from the cache before the server answers). Bounded + non-fatal: a miss is
      // recorded, and the frame is still taken — camera ethos.
      const removed =
        pairKey.length > 0
          ? await page
              .locator(`[data-pair-key="${pairKey}"]`)
              .waitFor({ state: "detached", timeout: 15_000 })
              .then(() => true)
              .catch(() => false)
          : false;

      // Ring check IMMEDIATELY — the mark self-clears after CASCADE_HIGHLIGHT_MS, so this
      // frame is deliberately unsettled (settling first would outlive the window). On this
      // route no EntityNode mounts, so the expected honest answer is "not mounted"; if a
      // canvas surface ever hosts this queue inline, the ring lands in this frame for free.
      const ringCount = await page.locator(CORRECTED_RING_SELECTOR).count();
      const ringNote =
        ringCount > 0
          ? `ring:visible(${ringCount})`
          : "ring:not-mounted-on-this-surface (EntityNode lives on /chat & /home canvases)";
      await captureCascadeFrame(
        harness,
        page,
        "post-merge-repaint",
        "light",
        `optimistic-removal:${removed ? "ok" : "not-observed"} ${ringNote} ` +
          `(immediate frame — inside the ${CASCADE_HIGHLIGHT_MS}ms highlight window, unsettled)`,
        records,
      );

      const response = await responsePromise;
      let cascadeStatus = "unknown — no confirmMerge response observed within 30s";
      if (response !== null) {
        const body = await response.text().catch(() => "");
        cascadeStatus = classifyCascadeFromBody(response.ok(), response.status(), body);
      }
      headerNotes.push(`confirmMerge cascade status: ${cascadeStatus}`);

      // A failed merge reverts the optimistic removal and toasts (use-merge-review.ts
      // onError) — record it and capture anyway; a photograph of the revert is information.
      const failedToastCount = await page.getByText("Merge failed", { exact: false }).count();
      const settleResult = await harness.settle(page);
      await captureCascadeFrame(
        harness,
        page,
        "post-merge-settled",
        "light",
        `${harness.describeSettle(settleResult)} cascade:${cascadeStatus}` +
          (failedToastCount > 0 ? " merge:FAILED-reverted" : ""),
        records,
      );
    } finally {
      await page.close();
    }
  } finally {
    // Written even when a skip unwinds mid-scenario, so whatever WAS captured is indexed.
    // Swallow a write failure rather than let it convert a skip into a red (the rails: this
    // scenario may never fail the suite pre-flip over bookkeeping).
    if (records.length > 0 || headerNotes.length > 1) {
      await writeCascadeIndex(harness, records, headerNotes).catch(() => undefined);
    }
  }
}
