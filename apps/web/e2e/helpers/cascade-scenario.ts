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
 *   6. click not performable  — the Merge button refused the click (disabled/busy card,
 *                               mid-click detach); the failure text is recorded in
 *                               cascade-index.md and no pending pair is consumed.
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

// ---------------------------------------------------------------------------
// confirmMerge stream classification — structural parse of the actual wire format
// ---------------------------------------------------------------------------
//
// The app transport is httpBatchStreamLink (src/trpc/react.tsx), whose response body is the
// tRPC 11 "jsonl" batch stream (@trpc/server jsonlStreamProducer / @trpc/client
// jsonlStreamConsumer, v11.8.0). The shape, read from the installed sources:
//
//   line 1 (head):   { "<batchIndex>": <cell>, ... }   — one cell per procedure IN BATCH ORDER,
//                    where batch order is the comma-joined path list in the request URL
//                    (`/api/trpc/a.b,c.d?batch=1`).
//   later lines:     [chunkId, promiseStatus, <cell-or-errorShape>]   — resolved async values.
//   cell encoding (producer's `encode`):
//                    [[]]                       → undefined
//                    [[value]]                  → plain value
//                    [[0], [null, type, id]]    → the value ITSELF is async (follow chunk id)
//                    [[obj], [key, type, id]…]  → object whose `key`s are async (placeholder 0)
//                    type: 0 = promise, 1 = async iterable; promiseStatus: 0 = fulfilled,
//                    1 = rejected (payload is the formatError shape).
//   Every line is additionally SuperJSON-serialized: { json: <chunk>, meta? }. Pings are bare
//   spaces without a newline.
//
// The previous implementation substring-matched `"cascade":{` / `"error":` over the whole body,
// which mislabels: a FAILED merge whose formatted error message embeds a cascade-shaped
// substring classified "live", and a batched multi-procedure response classified from OTHER
// procedures' payloads. This parse finds confirmMerge's OWN batch index from the request URL,
// follows ITS chunk chain only, and classifies from ITS envelope. Anything that does not parse
// as this wire format is reported "unclassifiable" with the raw body retained — never guessed.

/** tRPC endpoint prefix in every procedure URL (src/trpc/react.tsx `getBaseUrl() + "/api/trpc"`). */
const TRPC_ENDPOINT_PREFIX = "/api/trpc/";
const CONFIRM_MERGE_PROCEDURE = "entities.confirmMerge";

/** Wire constants mirrored from @trpc/server's stream/jsonl (deliberately unexported upstream —
 * the module is `unstable-core-do-not-import` — so they are pinned here with the shape doc). */
const CHUNK_VALUE_TYPE_PROMISE = 0;
const PROMISE_STATUS_FULFILLED = 0;
const PROMISE_STATUS_REJECTED = 1;

/** Guard against cyclic/adversarial chunk references; the real confirmMerge chain is 3 deep
 * (envelope promise → result promise → data promise). */
const MAX_STREAM_DECODE_DEPTH = 8;

/** Where the raw body lands (in RUN_DIR) when classification refuses to guess. */
const RAW_BODY_FILENAME = "cascade-confirm-merge-body.raw.txt";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Position of entities.confirmMerge within the request's batch, or -1. Doubles as the
 * waitForResponse predicate (>= 0): unlike the old `url.includes(...)`, a longer procedure name
 * or a substring in a query param can no longer match — only an exact member of the
 * comma-joined path segment does. A batched multi-procedure response still matches, and the
 * returned index is exactly the head key that holds confirmMerge's OWN envelope.
 */
export function confirmMergeBatchIndex(url: string): number {
  try {
    const pathname = new URL(url).pathname;
    const at = pathname.indexOf(TRPC_ENDPOINT_PREFIX);
    if (at === -1) return -1;
    const procedureSegment = decodeURIComponent(pathname.slice(at + TRPC_ENDPOINT_PREFIX.length));
    return procedureSegment.split(",").indexOf(CONFIRM_MERGE_PROCEDURE);
  } catch {
    return -1;
  }
}

/**
 * Unwrap one stream line's SuperJSON envelope. Classification reads the raw `json` skeleton
 * WITHOUT applying `meta`: meta re-hydrates value types (Date/undefined/bigint/…) and can never
 * add or remove the `error`/`result` keys nor turn a null cascade into an object — a
 * `cascade: undefined` serializes as json `null` plus a meta mark, which still reads as dark.
 */
function unwrapSuperjsonLine(parsed: unknown): unknown {
  return isPlainRecord(parsed) && "json" in parsed ? parsed["json"] : parsed;
}

type DecodedStreamValue =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "rejected"; readonly errorShape: unknown }
  | { readonly kind: "opaque"; readonly reason: string };

type StreamChunks = ReadonlyMap<number, readonly [status: number, payload: unknown]>;

function resolveChunkRef(
  ref: readonly unknown[],
  chunks: StreamChunks,
  depth: number,
): DecodedStreamValue {
  const type = ref[1];
  const chunkId = ref[2];
  if (type !== CHUNK_VALUE_TYPE_PROMISE || typeof chunkId !== "number") {
    return { kind: "opaque", reason: "non-promise (async-iterable?) chunk on the followed chain" };
  }
  const chunk = chunks.get(chunkId);
  if (chunk === undefined) {
    return { kind: "opaque", reason: `stream ended before chunk ${chunkId} arrived` };
  }
  const [status, payload] = chunk;
  if (status === PROMISE_STATUS_REJECTED) return { kind: "rejected", errorShape: payload };
  if (status !== PROMISE_STATUS_FULFILLED) {
    return { kind: "opaque", reason: `unknown promise status ${status} on chunk ${chunkId}` };
  }
  return decodeStreamCell(payload, chunks, depth + 1);
}

/** Statically decode one producer `encode()` cell (shapes documented in the block comment
 * above), following promise chunk references. A rejection anywhere on the followed chain
 * propagates as "rejected"; any shape outside the wire format propagates as "opaque". */
function decodeStreamCell(encoded: unknown, chunks: StreamChunks, depth: number): DecodedStreamValue {
  if (depth > MAX_STREAM_DECODE_DEPTH) {
    return { kind: "opaque", reason: "chunk-reference chain deeper than the wire format produces" };
  }
  if (!Array.isArray(encoded) || encoded.length === 0 || !Array.isArray(encoded[0])) {
    return { kind: "opaque", reason: "cell is not the [[value?], ...asyncRefs] wire shape" };
  }
  const headCell = encoded[0] as readonly unknown[];
  const refs = encoded.slice(1) as readonly unknown[];

  // [[0], [null, type, id]] — the cell's whole value is async; follow the chunk.
  const wholeValueRef = refs.find((ref) => Array.isArray(ref) && ref[0] === null);
  if (Array.isArray(wholeValueRef)) return resolveChunkRef(wholeValueRef, chunks, depth);

  const base: unknown = headCell.length === 0 ? undefined : headCell[0];
  if (refs.length === 0) return { kind: "value", value: base };
  if (!isPlainRecord(base)) {
    return { kind: "opaque", reason: "async refs attached to a non-object cell" };
  }
  let assembled: Record<string, unknown> = { ...base };
  for (const ref of refs) {
    if (!Array.isArray(ref) || typeof ref[0] !== "string") {
      return { kind: "opaque", reason: "malformed async ref inside an object cell" };
    }
    const resolved = resolveChunkRef(ref, chunks, depth);
    if (resolved.kind !== "value") return resolved;
    assembled = { ...assembled, [ref[0]]: resolved.value };
  }
  return { kind: "value", value: assembled };
}

export interface CascadeClassification {
  /** One-line human classification, recorded verbatim in cascade-index.md. */
  readonly status: string;
  /** Present ONLY when unclassifiable: the caller retains this verbatim in RUN_DIR. */
  readonly rawBodyToRetain?: string;
}

/**
 * Classify what the confirmMerge response says the cascade actually did, from confirmMerge's
 * OWN envelope inside the batch stream. httpBatchStreamLink commits HTTP 200 before any
 * procedure resolves, so a FAILED merge arrives ok:true with an `error` envelope (or a rejected
 * chunk) in confirmMerge's slot — which is why the parse is structural, per-slot, and never
 * substring-matches the body. Never throws — the caller records the strings.
 *
 * Exported (with confirmMergeBatchIndex) so the parse can be verified against bodies produced
 * by the REAL @trpc/server jsonlStreamProducer, outside a live Playwright run — both are pure.
 */
export function classifyCascadeFromStreamBody(
  ok: boolean,
  httpStatus: number,
  url: string,
  body: string,
): CascadeClassification {
  if (!ok) {
    return { status: `merge request failed (HTTP ${httpStatus}) — optimistic repaint reverted` };
  }
  const unclassifiable = (reason: string): CascadeClassification => ({
    status: `unclassifiable — ${reason}`,
    rawBodyToRetain: body,
  });

  const batchIndex = confirmMergeBatchIndex(url);
  if (batchIndex < 0) {
    return unclassifiable("response URL carries no entities.confirmMerge path segment");
  }

  // Line 1 is the head; later lines are chunks. Pings are bare spaces — trim absorbs them.
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return unclassifiable("empty response body");

  let head: unknown;
  try {
    head = unwrapSuperjsonLine(JSON.parse(lines[0]));
  } catch {
    return unclassifiable("head line is not JSON");
  }
  if (!isPlainRecord(head)) {
    return unclassifiable("head line is not a jsonl batch-stream index→cell object");
  }

  const chunks = new Map<number, readonly [status: number, payload: unknown]>();
  for (const line of lines.slice(1)) {
    let parsed: unknown;
    try {
      parsed = unwrapSuperjsonLine(JSON.parse(line));
    } catch {
      continue; // an unrelated garbled line; if OUR chain needed it, the decode reports the gap
    }
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === "number" &&
      typeof parsed[1] === "number" &&
      !chunks.has(parsed[0])
    ) {
      chunks.set(parsed[0], [parsed[1], parsed[2]]);
    }
  }

  const cell = head[String(batchIndex)];
  if (cell === undefined) {
    return unclassifiable(`stream head has no cell at confirmMerge's batch index ${batchIndex}`);
  }

  const envelope = decodeStreamCell(cell, chunks, 0);
  if (envelope.kind === "rejected") {
    return {
      status:
        "failed — confirmMerge's stream slot rejected (formatted tRPC error) — " +
        "optimistic repaint reverted",
    };
  }
  if (envelope.kind === "opaque") return unclassifiable(envelope.reason);
  if (!isPlainRecord(envelope.value)) {
    return unclassifiable("confirmMerge's envelope is not an object");
  }
  if ("error" in envelope.value) {
    return {
      status:
        "failed — tRPC error envelope in confirmMerge's own batch slot — " +
        "optimistic repaint reverted",
    };
  }
  const result = envelope.value["result"];
  if (!isPlainRecord(result)) {
    return unclassifiable("confirmMerge's envelope has neither error nor a result object");
  }
  const output = result["data"];
  if (!isPlainRecord(output)) {
    return unclassifiable("confirmMerge's result carries no data object");
  }
  // `output` is ConfirmMergeResponse (packages/api-client mutations.ts): the listener envelope
  // { success, error?, data: { …, cascade? } | null } — cascade nests at output.data.cascade.
  if (output["success"] === false || typeof output["error"] === "string") {
    return {
      status:
        "failed — listener envelope in confirmMerge's result reports failure — " +
        "optimistic repaint reverted",
    };
  }
  const listenerData = output["data"];
  const cascade = isPlainRecord(listenerData) ? listenerData["cascade"] : undefined;
  if (isPlainRecord(cascade)) {
    return { status: "live — cascade summary object in confirmMerge's own result envelope" };
  }
  return {
    status: "dark — cascade null/absent in confirmMerge's own result envelope (listener flag off)",
  };
}

/** Playwright error text is multi-line and may carry ANSI color codes — both would corrupt the
 * cascade-index.md table — so recorded notes are flattened and bounded first. */
function toSingleLineNote(message: string, maxLength: number): string {
  const flat = message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength)}… [truncated]`;
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
      // missed response degrades to "unknown" in the record. The predicate is structural
      // (exact path-segment membership, see confirmMergeBatchIndex), so a batched response
      // matches only when confirmMerge is genuinely one of its procedures.
      const responsePromise = page
        .waitForResponse(
          (r) => confirmMergeBatchIndex(r.url()) >= 0 && r.request().method() === "POST",
          { timeout: 30_000 },
        )
        .catch(() => null);

      // Accessible name is the card's aria-label ("Merge X into Y") — the Reject button's
      // label starts with "Reject", so the anchor keeps this unambiguous within the card.
      // GUARDED: a disabled/busy card (an in-flight mutation disables both buttons) or a
      // mid-click detach must degrade to the skip ladder, never red the suite — the failure
      // text is recorded in cascade-index.md first, so the skip message points at evidence.
      const clickFailure = await firstPair
        .getByRole("button", { name: /^Merge\b/ })
        .click({ timeout: 10_000 })
        .then(() => null)
        .catch((cause: unknown) =>
          toSingleLineNote(cause instanceof Error ? cause.message : String(cause), 300),
        );
      if (clickFailure !== null) {
        headerNotes.push(`merge click failed (no click performed): ${clickFailure}`);
      }
      test.skip(
        clickFailure !== null,
        "cascade scenario skipped: the Merge click could not be performed (disabled/busy card " +
          "or detached DOM) — no pending pair was consumed; pre-state frames are kept and the " +
          "click error is recorded in cascade-index.md.",
      );

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
        const classification = classifyCascadeFromStreamBody(
          response.ok(),
          response.status(),
          response.url(),
          body,
        );
        cascadeStatus = classification.status;
        if (classification.rawBodyToRetain !== undefined) {
          // Never guess: an unparseable body is retained verbatim in its own RUN_DIR file
          // (raw newlines would corrupt the index table). A failed write is noted rather than
          // thrown — the rails: bookkeeping may never red the suite.
          cascadeStatus = await writeFile(
            path.join(harness.runDir, RAW_BODY_FILENAME),
            classification.rawBodyToRetain,
            "utf-8",
          )
            .then(() => `${classification.status}; raw body retained: ${RAW_BODY_FILENAME}`)
            .catch(() => `${classification.status}; raw body retention FAILED (write error)`);
        }
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
