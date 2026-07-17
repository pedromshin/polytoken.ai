/**
 * screenshot-review.spec.ts — visual review capture harness (D-47-05, VRFY-02;
 * extended Phase 50 Plan 01 for LIVE-06 / todo W-1; theme axis + settle added 61-01 Task 2).
 *
 * Boots the dev server (via playwright.screenshot.config.ts's webServer, reused from the base
 * config per D-47-04) and walks the app's main surfaces across two viewports AND both themes,
 * capturing a full-page PNG for each combination plus a reviewable index.md — all under a single
 * timestamped run directory at `.planning/ui-reviews/{ISO-timestamp}/` (repo root, resolved via
 * `import.meta.url` so the output lands there regardless of the invoking cwd).
 *
 * Surfaces: /login (public), / (inbox), /chat, /knowledge, /studio, /settings/forwarding, and
 * (local target only) /emails/[id] built from a seeded fixture — see below.
 * Viewports: mobile 390px, desktop 1440px.
 * Themes: light + dark.
 *
 * THE THEME AXIS (999.23, added 61-01). The user's locked identity pick explicitly requires
 * light AND dark, globals.css has shipped a full `.dark` block since Phase 59, and **dark mode
 * had never once been captured** — every review in this project's history looked at half of the
 * identity and called it the whole thing. COST, stated honestly: this doubles the run (14 -> 28
 * default frames, plus studio's alternate pack 2 -> 4, so 16 -> 32 PNGs and roughly twice the
 * wall time). That is the correct trade — half of this design had never been looked at.
 *
 * Theme is the OUTERMOST loop and each theme gets its OWN page, because the deterministic lever
 * is `addInitScript` (registered per page, never removable) — it must run BEFORE next-themes'
 * pre-mount script on first paint. Writing localStorage after `goto` needs a reload to take
 * effect and is a race. The applied theme is then ASSERTED, never trusted (see
 * `assertThemeApplied`).
 *
 * THE SETTLE (999.24, added 61-01). This harness previously did `goto({ waitUntil: "load" })` +
 * a fixed `waitForTimeout(400)`, which fires BEFORE async data lands: entity chips were missing
 * from every capture ever taken. That nearly produced a false "the redesign has no tier chips"
 * verdict, and made inbox-mobile.png look like three grey skeleton rows when the real mobile feed
 * renders correctly. The 400ms looked deliberate, which is exactly why the defect survived so
 * long. It is replaced by a real settle: a bounded `networkidle` wait plus a bounded wait for
 * every skeleton to leave the DOM.
 *
 * ON `networkidle`, RE-CHECKED (61-01) rather than inherited: this file's previous header
 * asserted networkidle was "deliberately avoided" because Next dev's HMR websocket keeps its
 * connection open indefinitely. That claim does NOT hold against the current stack — Playwright's
 * networkidle ignores long-lived websocket connections, and the 61-01 geometry gate reaches it on
 * /chat in ~2-3s per navigation. So it is used here, but BOUNDED and non-fatal: whether it was
 * actually reached is RECORDED per capture in index.md rather than assumed, which re-checks the
 * claim continuously instead of trusting this comment.
 *
 * THE SETTLE DEGRADES, THE THEME DOES NOT. A timed-out settle still captures and records "NOT
 * settled" — this is a camera, and a picture of a still-loading surface is still information,
 * whereas a hard failure would lose the other 31 frames. A MISLABELLED theme throws: a harness
 * that photographs light twice and calls one of them "dark" is worse than one with no theme axis,
 * because it reads as evidence.
 *
 * Auth (T-47-11, SUPERSEDED for the local case by T-50-01): the original harness had no
 * signed-in session and never faked one. This is still true against a NON-local target — no
 * cookie injection, no sign-in call of any kind runs there, and a protected surface's middleware
 * redirect to `/login` is captured AS-IS and recorded with an auth-status note, exactly as
 * before. Against a LOCAL target (`isLocalTarget` below), the harness now authenticates via the
 * 49-03 `seedAuthenticatedContext` helper — a REAL Supabase session minted locally through GoTrue
 * admin (magiclink + verifyOtp), never an interactive Google flow and never a faked cookie. That
 * seeded session is gated to local-only by construction (T-50-01): it is NEVER minted against a
 * non-local baseURL/SUPABASE_URL, so a hosted Supabase/Vercel target never receives service_role
 * admin traffic from this harness.
 *
 * Studio pack switcher (D-47-05): studio is the only surface with a style-pack switcher (the
 * Sandbox tab's "Select visual theme" dropdown, see generation-sandbox-island.tsx). When studio
 * actually renders (not redirected), the harness also selects one alternate pack and captures
 * that state.
 *
 * ARTIFACTS ARE NEVER COMMITTED (T-61-02): RUN_DIR's PNGs are gitignored. They contain a signed-in
 * session's rendered pixels — never `git add -f` one, and never paste a rendered forwarding
 * address / token / signed URL out of one.
 *
 * Kept in a dedicated config (playwright.screenshot.config.ts) with a scoped testMatch so
 * `npm run test:e2e` (the assertion specs) never runs this capture spec, and vice versa.
 */

import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type BrowserContext, type Page } from "@playwright/test";

import { seedAuthenticatedContext } from "./helpers/seed-session";
// Safe to import from app source: this module and its one dependency pull in `zod` and types
// only — no React components — so Playwright's runner loads them without Next's pipeline. Taking
// the version from the registry itself (rather than pasting a hash) is what keeps the fixture
// from silently degrading every node to the inert placeholder when the registry changes.
import { NODE_REGISTRY_VERSION } from "~/app/chat/_canvas/node-registry-version";

import {
  FIXTURE_USER_QUESTION,
  seedChatCanvasFixture,
  seedChatThreadFixture,
  seedEmailFixture,
} from "./helpers/screenshot-fixtures";

// ---------------------------------------------------------------------------
// Surfaces + viewports (D-47-05 LOCKED spec + Phase 50 Plan 01 /emails/[id] addition)
// ---------------------------------------------------------------------------

interface Surface {
  readonly name: string;
  readonly path: string;
  /**
   * If set, click the conversation row with this title after navigating.
   *
   * `/chat` selects a conversation by STATE, not by URL — there is no `?c=` to navigate to. A
   * harness that only ever visits a path therefore photographs the "Ask me anything" empty state
   * forever, which is exactly what happened: 61-04 redesigned the message stream, tool rounds and
   * the citation chip, then found the surface had zero coverage in any committed capture. This is
   * the one surface whose interesting state costs a click.
   */
  readonly selectConversationTitle?: string;
  /**
   * After selecting, wait for this text to appear before capturing.
   *
   * Selecting the row is NOT enough: `chat.getHistory` is a separate async query that announces
   * itself through neither a skeleton nor `aria-busy`, so `settle()` is blind to it and the frame
   * lands on an empty transcript. That is 999.24 one layer deeper than where it was first found —
   * and it is exactly how the first attempt here produced a `select:ok` frame showing no messages
   * at all. Gate on a REAL element, never a sleep.
   */
  readonly awaitText?: string;
  /**
   * After selecting (and after `awaitText`), click the tab with this accessible name.
   *
   * The canvas only mounts on "Canvas view", so without this the board is in no capture at all —
   * which is how four pieces of stock React Flow chrome survived on it since Phase 26.
   */
  readonly openTabName?: string;
}

/** The six D-47-05 surfaces reviewed every run — login is public, the rest are auth-gated. */
const BASE_SURFACES: readonly Surface[] = [
  { name: "login", path: "/login" },
  { name: "inbox", path: "/" },
  { name: "chat", path: "/chat" },
  { name: "knowledge", path: "/knowledge" },
  { name: "studio", path: "/studio" },
  { name: "forwarding", path: "/settings/forwarding" },
  // Phase 66 — the files vault (v2.1 slice). Path-navigable, so it needs no selection step.
  { name: "files", path: "/files" },
];

/** Hosts allowed to receive the seeded (service_role-minted) session — T-50-01. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * isLocalTarget — true ONLY when BOTH the app baseURL host and the Supabase URL host are
 * localhost/127.0.0.1. This is the security gate (T-50-01): the seeded session mints a
 * service_role admin session and MUST NEVER run against a hosted Supabase/Vercel target. Any
 * unparseable URL or non-local host fails closed (returns false, seeding skipped).
 */
export function isLocalTarget(baseURL: string, supabaseUrl: string): boolean {
  try {
    const baseHost = new URL(baseURL).hostname;
    const supabaseHost = new URL(supabaseUrl).hostname;
    return LOCAL_HOSTS.has(baseHost) && LOCAL_HOSTS.has(supabaseHost);
  } catch {
    return false;
  }
}

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Mobile 390px / desktop 1440px per D-47-05. */
const VIEWPORTS: readonly Viewport[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Both halves of the locked identity (999.23). */
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** next-themes' default storage key (layout.tsx passes no `storageKey` override). */
const THEME_STORAGE_KEY = "theme";

/** The one alternate style pack captured on studio when the switcher is reachable. */
const ALT_PACK_LABEL = "Linear Clean";
const ALT_PACK_ID = "linear-clean";

// ---------------------------------------------------------------------------
// Settle budget (999.24)
// ---------------------------------------------------------------------------

/** Bounded so one slow surface cannot stall a 32-frame run; non-fatal on expiry. */
const NETWORK_IDLE_TIMEOUT_MS = 8_000;
const CONTENT_SETTLE_TIMEOUT_MS = 8_000;
const SETTLE_POLL_INTERVAL_MS = 100;

/**
 * Every skeleton this app can render, by the two markers actually used in src/ — verified by
 * reading the call sites, not assumed:
 *
 *   - `[aria-busy="true"]` — conversation-rail, entities-gallery, studio history, email-detail.
 *   - `[class*="animate-pulse"]` — the `Skeleton` primitive (packages/ui/src/skeleton.tsx:11)
 *     and the hand-rolled skeletons in studio/knowledge/canvas.
 *
 * BOTH are required, and the substring match is not laziness. The INBOX's loading block — the
 * very surface whose "three grey skeleton rows" capture motivated 999.24 — is
 * `<div aria-hidden>` wrapping `<Skeleton>`s (inbox-three-pane.tsx:384): it carries NO
 * `aria-busy` at all, so waiting on aria-busy alone would have "fixed" 999.24 everywhere except
 * the place it was found. And `Skeleton` applies `motion-safe:animate-pulse`, which Tailwind v4
 * emits into the DOM as the literal class `motion-safe:animate-pulse` — a `.animate-pulse`
 * selector matches NOTHING. `[class*="animate-pulse"]` catches both forms, and is already this
 * codebase's own idiom for exactly this (genui-part-boundary.test.tsx:80).
 *
 * The remaining `animate-pulse` call sites (message-turn's streaming caret, genui-panel-node's
 * streaming glyph, region-overlay-box's in-flight mutation) are only present DURING streaming or
 * a mutation, neither of which a static capture triggers. If one ever did, the settle degrades to
 * "NOT settled" and still captures — it never fails a run.
 */
const SKELETON_SELECTOR = '[aria-busy="true"], [class*="animate-pulse"]';

type AuthStatus = "captured" | "redirected to /login (no session)";

interface SettleResult {
  readonly networkIdle: boolean;
  readonly contentReady: boolean;
}

interface CaptureRecord {
  readonly surface: string;
  readonly viewport: string;
  readonly theme: Theme;
  readonly pack: string;
  readonly authStatus: AuthStatus;
  readonly settle: string;
  readonly filename: string;
}

// ---------------------------------------------------------------------------
// Run directory — anchored to the repo root via import.meta.url, not cwd, so the
// artifact always lands at <repo-root>/.planning/ui-reviews/{timestamp}/ regardless
// of whether the harness is invoked from apps/web or the workspace root
// (`npm run screenshot:review -w @polytoken/web`).
// ---------------------------------------------------------------------------

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile); // apps/web/e2e
const REPO_ROOT = path.resolve(currentDir, "..", "..", "..");
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DIR = path.join(REPO_ROOT, ".planning", "ui-reviews", RUN_TIMESTAMP);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "redirected" only when a NON-login surface lands on /login — never faked, only observed. */
function resolveAuthStatus(currentUrl: string, requestedPath: string): AuthStatus {
  const pathname = new URL(currentUrl).pathname;
  if (requestedPath !== "/login" && pathname === "/login") {
    return "redirected to /login (no session)";
  }
  return "captured";
}

/** `light` stays EXPLICIT in the filename rather than implicit — no reader should have to know
 * which theme the bare name used to mean. The pack suffix stays composable after it:
 * `studio-desktop-dark-linear-clean.png`. */
function buildFilename(
  surfaceName: string,
  viewportName: string,
  theme: Theme,
  packId: string,
): string {
  const suffix = packId === "default" ? "" : `-${packId}`;
  return `${surfaceName}-${viewportName}-${theme}${suffix}.png`;
}

/**
 * openThemedPage — a page pinned to one theme, by both levers next-themes reads (§G):
 *   - `emulateMedia({ colorScheme })` drives `defaultTheme="system"` + `enableSystem`.
 *   - `localStorage.theme`, seeded via addInitScript so it lands BEFORE next-themes' pre-mount
 *     script runs on first paint. emulateMedia alone would work only while no stored preference
 *     exists; the storage write makes it deterministic instead of dependent on the absence of
 *     prior state (and localStorage is shared per-origin across a context's pages, so a previous
 *     theme's value WOULD otherwise leak into this one).
 *
 * A fresh page per theme is required because addInitScript is per-page and cannot be unregistered.
 */
async function openThemedPage(context: BrowserContext, theme: Theme): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
  await page.emulateMedia({ colorScheme: theme });
  return page;
}

/**
 * assertThemeApplied — ASSERT the resulting state rather than trust either lever. next-themes
 * toggles `.dark` on <html> (`attribute="class"`, layout.tsx:65). Throws, deliberately: see the
 * file header's "THE SETTLE DEGRADES, THE THEME DOES NOT".
 */
async function assertThemeApplied(page: Page, theme: Theme, label: string): Promise<void> {
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (isDark !== (theme === "dark")) {
    throw new Error(
      `${label}: theme axis mislabelled — requested "${theme}", but <html> ${
        isDark ? "HAS" : "does NOT have"
      } the .dark class (class="${htmlClass}"). Refusing to save a PNG labelled "${theme}" that ` +
        "shows the other theme: a mislabelled capture reads as evidence and is worse than no " +
        "theme axis at all (999.23). Check next-themes' storageKey/attribute in layout.tsx " +
        "against openThemedPage's levers.",
    );
  }
}

/** Bounded poll for every skeleton to leave the DOM. Returns whether it cleared; never throws —
 * the caller records the outcome and captures regardless (999.24). */
async function waitForSkeletonsToClear(page: Page): Promise<boolean> {
  const deadline = Date.now() + CONTENT_SETTLE_TIMEOUT_MS;
  for (;;) {
    if ((await page.locator(SKELETON_SELECTOR).count()) === 0) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
  }
}

/** The real settle that replaced the fixed 400ms (999.24). Both halves are bounded and
 * non-fatal — a still-loading picture is information; losing the run is not. */
async function settle(page: Page): Promise<SettleResult> {
  let networkIdle = true;
  try {
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS });
  } catch {
    networkIdle = false;
  }
  const contentReady = await waitForSkeletonsToClear(page);
  return { networkIdle, contentReady };
}

/**
 * The reviewer-facing distinction that IS the whole defect: "this surface has no chips" must be
 * readable apart from "this surface's chips had not arrived yet".
 */
function describeSettle(result: SettleResult): string {
  if (result.networkIdle && result.contentReady) {
    return "settled";
  }
  const reasons: string[] = [];
  if (!result.networkIdle) {
    reasons.push(`network still busy after ${NETWORK_IDLE_TIMEOUT_MS}ms`);
  }
  if (!result.contentReady) {
    reasons.push(`skeleton still on screen after ${CONTENT_SETTLE_TIMEOUT_MS}ms`);
  }
  return `NOT settled (captured anyway) — ${reasons.join("; ")}`;
}

async function captureSurface(
  page: Page,
  surface: Surface,
  viewport: Viewport,
  theme: Theme,
  records: CaptureRecord[],
): Promise<AuthStatus> {
  const label = `${surface.name} @ ${viewport.name}/${theme}`;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  // 61-07 — DROP /chat's PERSISTED Chat/Canvas CHOICE BEFORE EVERY CAPTURE.
  //
  // `chat-thread` and `chat-canvas` are the SAME conversation, and clicking
  // "Canvas view" makes `chat-canvas-view-toggle.tsx` WRITE that choice to
  // localStorage (`polytoken.chat.canvas-view:{conversationId}` — the prefix is
  // read from that file, not guessed; a wrong prefix here would clear nothing
  // and "work" only by accident of capture order), by design: a user's view
  // choice should survive a reload. The capture loop then reuses one
  // browser context across surfaces and both theme passes, so `chat-canvas`
  // left "canvas" behind and the NEXT pass's `chat-thread` faithfully restored
  // it: the dark `chat-thread-*.png` were photographs of the BOARD, filed under
  // the transcript's name, with `select:ok` next to them.
  //
  // Found by looking at chat-thread-desktop-dark.png (61-07). It has been true
  // since `chat-canvas` joined the surface list, and no gate could see it — the
  // harness is a camera, and the picture WAS of a real, correctly-rendered
  // surface. Just not the one on the label.
  //
  // Clearing the key rather than clicking "Chat view": the toggle only exists
  // above `md`, so a mobile capture has no tab to click, and `openTabName`'s
  // own wait gates on the React Flow pane that only the canvas branch mounts.
  // An `addInitScript` runs before the app's first render, so `readStoredViewMode`
  // reads a clean slate and each surface gets the mode its OWN definition asks
  // for.
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("polytoken.chat.canvas-view:")) window.localStorage.removeItem(key);
    }
  });

  await page.goto(surface.path, { waitUntil: "load" });
  const authStatus = resolveAuthStatus(page.url(), surface.path);

  // Selection is best-effort and NON-FATAL, matching this harness's standing stance: it is a
  // camera. If the row never arrives we still capture — a picture of the empty state is honest
  // information, and it is recorded as `select:missed` in index.md rather than passed off as the
  // thread. Silently capturing the empty state and LABELLING it as the thread is the failure
  // this whole change exists to end, so the miss has to be visible in the record.
  let selectNote = "";
  if (surface.selectConversationTitle !== undefined && authStatus === "captured") {
    const row = page.getByText(surface.selectConversationTitle, { exact: false }).first();

    // NO TOGGLE CLICKING. Two attempts at "reveal the rail first" were both actively harmful and
    // are recorded here so the third person does not try a fourth:
    //
    //   1. Clicking the toggle by the "Collapse conversation list" label CLOSED an already-open
    //      rail. The single `railToggle` in page.tsx flips `railCollapsed` AND `mobileRailOpen`
    //      in one handler, so the mobile capture's click also collapsed the desktop rail.
    //   2. Falling back to a toggle when the row had not appeared *yet* was worse (4 of 4 missed):
    //      on desktop the rail is already open and the only visible control reads "Collapse …",
    //      so the fallback collapsed the very rail it was trying to reveal.
    //
    // Measured reality (e2e diagnostics, both viewports, fixture seeded):
    //   desktop -> row rect {x:266,y:63,w:142,h:31}  — visible, rail open by default
    //   mobile  -> row rect {x:0,y:0,w:0,h:0}        — in the DOM but boxless (overlay Sheet)
    //
    // `railCollapsed` is `useState(false)` and is NOT persisted, so every navigation lands with
    // the desktop rail open and the row simply present. Waiting is sufficient; touching the
    // toggle only ever breaks it.
    //
    // Mobile is deliberately NOT selected: the rail is a left overlay Sheet, so reaching the row
    // means opening the Sheet, and a Sheet-over-transcript is a different photograph than the
    // docked mobile transcript. That surface is SURF-07 / plan 61-07's, and it should capture it
    // on its own terms rather than have this harness guess.
    const isOverlayRailViewport = viewport.width < 768;
    if (isOverlayRailViewport) {
      selectNote = " select:n/a-overlay-rail";
    } else {
      const opened = await row
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => row.click({ timeout: 10_000 }))
        .then(() => true)
        .catch(() => false);

      let loaded = true;
      if (opened && surface.awaitText !== undefined) {
        loaded = await page
          .getByText(surface.awaitText, { exact: false })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
      }
      selectNote = !opened
        ? " select:missed"
        : loaded
          ? " select:ok"
          : " select:ok-but-transcript-empty";

      if (opened && loaded && surface.openTabName !== undefined) {
        const tabOk = await page
          .getByRole("tab", { name: surface.openTabName })
          .click({ timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        // React Flow mounts and runs its own layout pass; gate on the pane it renders rather
        // than a sleep, then let the shared settle() finish the job.
        const paneOk = tabOk
          ? await page
              .locator(".react-flow__pane")
              .first()
              .waitFor({ state: "visible", timeout: 15_000 })
              .then(() => true)
              .catch(() => false)
          : false;
        selectNote += paneOk ? " tab:ok" : " tab:missed";
      }
    }
  }

  const settleResult = await settle(page);
  await assertThemeApplied(page, theme, label);

  const filename = buildFilename(surface.name, viewport.name, theme, "default");
  await page.screenshot({ path: path.join(RUN_DIR, filename), fullPage: true });
  records.push({
    surface: surface.name,
    viewport: viewport.name,
    theme,
    pack: "default",
    authStatus,
    settle: describeSettle(settleResult) + selectNote,
    filename,
  });
  return authStatus;
}

/**
 * Studio-only, best-effort: if the style-pack switcher is reachable (surface actually
 * rendered, not redirected), select the one alternate pack and capture that state too.
 * Every lookup is feature-detected via `.count()` first, so a redirected/missing surface
 * is silently skipped rather than forcing an interaction against a login page.
 */
async function captureAlternatePackIfPresent(
  page: Page,
  surface: Surface,
  viewport: Viewport,
  theme: Theme,
  authStatus: AuthStatus,
  records: CaptureRecord[],
): Promise<void> {
  if (surface.name !== "studio" || authStatus !== "captured") {
    return;
  }

  const sandboxTab = page.getByRole("tab", { name: "Sandbox" });
  if ((await sandboxTab.count()) === 0) {
    return;
  }
  await sandboxTab.click();

  const packTrigger = page.getByLabel("Select visual theme");
  if ((await packTrigger.count()) === 0) {
    return;
  }
  await packTrigger.click();

  const altOption = page.getByRole("option", { name: ALT_PACK_LABEL });
  if ((await altOption.count()) === 0) {
    return;
  }
  await altOption.click();
  const settleResult = await settle(page);

  const filename = buildFilename(surface.name, viewport.name, theme, ALT_PACK_ID);
  await page.screenshot({ path: path.join(RUN_DIR, filename), fullPage: true });
  records.push({
    surface: surface.name,
    viewport: viewport.name,
    theme,
    pack: ALT_PACK_ID,
    authStatus,
    settle: describeSettle(settleResult),
    filename,
  });
}

async function writeIndex(records: readonly CaptureRecord[], authSeeded: boolean): Promise<void> {
  const authNote = authSeeded
    ? [
        "Authenticated capture (T-50-01): a REAL session was minted locally via GoTrue admin",
        "(magiclink + verifyOtp — never interactive Google) and injected into this run's browser",
        "context, so auth-gated surfaces below capture real signed-in pixels rather than the",
        "`/login` redirect. The seeded session is local-only by construction — it is never minted",
        "against a non-local baseURL/SUPABASE_URL.",
      ]
    : [
        "Auth-gated surfaces are captured best-effort: with no signed-in session (non-local target,",
        "or seeding was skipped), protected routes redirect to `/login` and are recorded below as",
        '"redirected to /login (no session)" — this is documented, expected behavior, not a harness',
        "failure. Re-run against a local target to capture the authenticated surfaces.",
      ];

  const settleNote = [
    "**Settle (999.24):** every capture waits for network idle AND for all skeletons to leave the",
    'DOM before the shutter. A row reading "settled" means what you see is the surface with its',
    'async data landed — so a missing chip is a REAL missing chip. A row reading "NOT settled"',
    "means the shot was taken while content was still arriving: read that frame as incomplete, not",
    "as evidence of absence. Captures are never dropped on a slow settle — a picture of a",
    "still-loading surface is still information.",
    "",
    "**Themes (999.23):** each surface is captured in BOTH light and dark. The applied theme is",
    "asserted against `<html>.dark` before every shot, so a frame labelled `dark` is dark.",
  ];

  const header = [
    `# Screenshot review — ${RUN_TIMESTAMP}`,
    "",
    ...authNote,
    "",
    ...settleNote,
    "",
    "| Surface | Viewport | Theme | Pack | Auth Status | Settle | File |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ].join("\n");

  const rows = records
    .map(
      (r) =>
        `| ${r.surface} | ${r.viewport} | ${r.theme} | ${r.pack} | ${r.authStatus} | ${r.settle} | ${r.filename} |`,
    )
    .join("\n");

  await writeFile(path.join(RUN_DIR, "index.md"), `${header}\n${rows}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// The capture run — a single sequential test (see playwright.screenshot.config.ts:
// workers=1, fullyParallel=false) so all captures share one RUN_DIR and one index.
// ---------------------------------------------------------------------------

test.describe("screenshot review capture", () => {
  test("captures all surfaces across mobile (390) and desktop (1440) viewports, light + dark", async ({
    context,
    baseURL,
  }) => {
    // Doubled by the theme axis (999.23) — 32 full-page captures, each with a bounded settle.
    test.setTimeout(600_000);
    await mkdir(RUN_DIR, { recursive: true });

    // Local-only seeded session (T-50-01): the seeded session mints a service_role admin
    // session and MUST NEVER run against a hosted Supabase/Vercel target — isLocalTarget gates
    // this to local dev only. A non-local baseURL/SUPABASE_URL skips seeding entirely and keeps
    // the original best-effort public capture behavior.
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const resolvedBaseURL = baseURL ?? "http://localhost:3000";
    const authSeeded = isLocalTarget(resolvedBaseURL, supabaseUrl);

    let surfaces: readonly Surface[] = BASE_SURFACES;
    if (authSeeded) {
      const seeded = await seedAuthenticatedContext(context);
      const fixture = await seedEmailFixture(seeded.userId);
      const chatFixture = await seedChatThreadFixture(seeded.userId);
      await seedChatCanvasFixture(NODE_REGISTRY_VERSION);
      surfaces = [
        ...BASE_SURFACES,
        { name: "emails", path: "/emails/" + fixture.emailId },
        // `chat` above stays as-is — the empty state is a real state worth reviewing. This is
        // ADDITIVE: the same surface with a conversation actually open, which is where the
        // message stream, tool-round rows and citation chips live.
        {
          name: "chat-thread",
          path: "/chat",
          selectConversationTitle: chatFixture.conversationTitle,
          awaitText: FIXTURE_USER_QUESTION,
        },
        // The board. Same conversation, header toggle flipped to Canvas — the surface where
        // 61-05 found four pieces of stock chrome that had survived since Phase 26 precisely
        // because no committed capture could see it.
        {
          name: "chat-canvas",
          path: "/chat",
          selectConversationTitle: chatFixture.conversationTitle,
          awaitText: FIXTURE_USER_QUESTION,
          openTabName: "Canvas view",
        },
      ];
    }

    const records: CaptureRecord[] = [];

    // Theme is the OUTERMOST axis: addInitScript is per-page and cannot be unregistered, so each
    // theme runs on its own page (the context — and its seeded auth cookies — is shared).
    for (const theme of THEMES) {
      const page = await openThemedPage(context, theme);
      try {
        for (const surface of surfaces) {
          for (const viewport of VIEWPORTS) {
            const authStatus = await captureSurface(page, surface, viewport, theme, records);
            await captureAlternatePackIfPresent(
              page,
              surface,
              viewport,
              theme,
              authStatus,
              records,
            );
          }
        }
      } finally {
        await page.close();
      }
    }

    await writeIndex(records, authSeeded);
  });
});
