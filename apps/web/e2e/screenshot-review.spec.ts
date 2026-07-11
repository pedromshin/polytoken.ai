/**
 * screenshot-review.spec.ts — visual review capture harness (D-47-05, VRFY-02;
 * extended Phase 50 Plan 01 for LIVE-06 / todo W-1).
 *
 * Boots the dev server (via playwright.screenshot.config.ts's webServer, reused from the base
 * config per D-47-04) and walks the app's main surfaces across two viewports, capturing a
 * full-page PNG for each combination plus a reviewable index.md — all under a single timestamped
 * run directory at `.planning/ui-reviews/{ISO-timestamp}/` (repo root, resolved via
 * `import.meta.url` so the output lands there regardless of the invoking cwd).
 *
 * Surfaces: /login (public), / (inbox), /chat, /knowledge, /studio, /settings/forwarding, and
 * (local target only) /emails/[id] built from a seeded fixture — see below.
 * Viewports: mobile 390px, desktop 1440px.
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
 * that state. Every other surface captures its single default render — no switcher exists there.
 *
 * Kept in a dedicated config (playwright.screenshot.config.ts) with a scoped testMatch so
 * `npm run test:e2e` (the assertion specs) never runs this capture spec, and vice versa.
 */

import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type Page } from "@playwright/test";

import { seedAuthenticatedContext } from "./helpers/seed-session";
import { seedEmailFixture } from "./helpers/screenshot-fixtures";

// ---------------------------------------------------------------------------
// Surfaces + viewports (D-47-05 LOCKED spec + Phase 50 Plan 01 /emails/[id] addition)
// ---------------------------------------------------------------------------

interface Surface {
  readonly name: string;
  readonly path: string;
}

/** The six D-47-05 surfaces reviewed every run — login is public, the rest are auth-gated. */
const BASE_SURFACES: readonly Surface[] = [
  { name: "login", path: "/login" },
  { name: "inbox", path: "/" },
  { name: "chat", path: "/chat" },
  { name: "knowledge", path: "/knowledge" },
  { name: "studio", path: "/studio" },
  { name: "forwarding", path: "/settings/forwarding" },
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

/** The one alternate style pack captured on studio when the switcher is reachable. */
const ALT_PACK_LABEL = "Linear Clean";
const ALT_PACK_ID = "linear-clean";

type AuthStatus = "captured" | "redirected to /login (no session)";

interface CaptureRecord {
  readonly surface: string;
  readonly viewport: string;
  readonly pack: string;
  readonly authStatus: AuthStatus;
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

function buildFilename(surfaceName: string, viewportName: string, packId: string): string {
  const suffix = packId === "default" ? "" : `-${packId}`;
  return `${surfaceName}-${viewportName}${suffix}.png`;
}

async function captureSurface(
  page: Page,
  surface: Surface,
  viewport: Viewport,
  records: CaptureRecord[],
): Promise<AuthStatus> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(surface.path, { waitUntil: "load" });
  // Let hydration / fonts settle before the shot — Next dev's HMR websocket keeps its
  // connection open indefinitely, so "networkidle" is deliberately avoided here.
  await page.waitForTimeout(400);

  const authStatus = resolveAuthStatus(page.url(), surface.path);
  const filename = buildFilename(surface.name, viewport.name, "default");
  await page.screenshot({ path: path.join(RUN_DIR, filename), fullPage: true });
  records.push({ surface: surface.name, viewport: viewport.name, pack: "default", authStatus, filename });
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
  await page.waitForTimeout(200);

  const filename = buildFilename(surface.name, viewport.name, ALT_PACK_ID);
  await page.screenshot({ path: path.join(RUN_DIR, filename), fullPage: true });
  records.push({
    surface: surface.name,
    viewport: viewport.name,
    pack: ALT_PACK_ID,
    authStatus,
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

  const header = [`# Screenshot review — ${RUN_TIMESTAMP}`, "", ...authNote, "", "| Surface | Viewport | Pack | Auth Status | File |", "| --- | --- | --- | --- | --- |"].join(
    "\n",
  );

  const rows = records
    .map((r) => `| ${r.surface} | ${r.viewport} | ${r.pack} | ${r.authStatus} | ${r.filename} |`)
    .join("\n");

  await writeFile(path.join(RUN_DIR, "index.md"), `${header}\n${rows}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// The capture run — a single sequential test (see playwright.screenshot.config.ts:
// workers=1, fullyParallel=false) so all captures share one RUN_DIR and one index.
// ---------------------------------------------------------------------------

test.describe("screenshot review capture", () => {
  test("captures all surfaces across mobile (390) and desktop (1440) viewports", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(300_000);
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
      surfaces = [...BASE_SURFACES, { name: "emails", path: "/emails/" + fixture.emailId }];
    }

    const records: CaptureRecord[] = [];

    for (const surface of surfaces) {
      for (const viewport of VIEWPORTS) {
        const authStatus = await captureSurface(page, surface, viewport, records);
        await captureAlternatePackIfPresent(page, surface, viewport, authStatus, records);
      }
    }

    await writeIndex(records, authSeeded);
  });
});
