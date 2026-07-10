---
phase: 47-brand-foundation-verification-tooling
plan: 05
subsystem: testing
tags: [playwright, screenshot, visual-review, e2e, ui-reviews]

# Dependency graph
requires:
  - phase: 47-brand-foundation-verification-tooling
    provides: "47-04's @playwright/test toolchain + playwright.config.ts webServer/baseURL wiring"
  - phase: 47-brand-foundation-verification-tooling
    provides: "47-01/47-02's brand mark + copy touchpoints (login card, sidebar) — the surfaces this harness first captured"
provides:
  - "Committed, repeatable screenshot review harness (screenshot-review.spec.ts + dedicated playwright.screenshot.config.ts + npm run screenshot:review)"
  - "First real .planning/ui-reviews/{timestamp}/ artifact: 12 PNGs + index.md documenting the current re-skin state"
affects: [48-design-token-system, 49-brand-reskin-application, any-future-visual-review-work]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Screenshot capture specs live under apps/web/e2e/*.spec.ts but run through a DEDICATED playwright.*.config.ts (not the shared test:e2e config) via testMatch/testIgnore pairing, so assertion suites and capture harnesses never run each other", "Capture harness output resolves its write path via import.meta.url -> repo root, not process.cwd(), so it lands in the same place regardless of invocation cwd (workspace root vs apps/web)"]

key-files:
  created:
    - apps/web/e2e/screenshot-review.spec.ts
    - apps/web/playwright.screenshot.config.ts
  modified:
    - apps/web/package.json
    - apps/web/playwright.config.ts

key-decisions:
  - "Single sequential Playwright test (not one test per surface/viewport) iterating a SURFACES x VIEWPORTS loop in one browser context — keeps all captures under one shared timestamped RUN_DIR without cross-worker timestamp skew; config sets workers:1/fullyParallel:false to match."
  - "Deviation (Rule 3): added testIgnore to the pre-existing playwright.config.ts so its broad testMatch (/.*\\.spec\\.ts/) does not also pick up screenshot-review.spec.ts — required for `test:e2e` and `screenshot:review` to never run each other's specs, per D-47-05/47-CONTEXT.md interfaces."
  - "Studio's style-pack switcher (Sandbox tab -> 'Select visual theme' dropdown) is captured best-effort via .count()-gated feature detection (never forced) — it only fires when studio actually renders un-redirected; in this run it stayed dormant since studio (like all protected surfaces) redirected to /login with no session."

requirements-completed: [VRFY-02]

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 47 Plan 05: Screenshot Review Harness Summary

**Committed Playwright capture harness (`screenshot-review.spec.ts` + dedicated `playwright.screenshot.config.ts` + `npm run screenshot:review`) that shoots 6 surfaces x 2 viewports into a timestamped PNG set + index.md, and its first real run captured the freshly-branded polytoken login page live.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T18:05:00Z (approx)
- **Completed:** 2026-07-10T18:40:00Z (approx)
- **Tasks:** 2 of 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- Built `apps/web/e2e/screenshot-review.spec.ts` (220 lines): a single sequential Playwright test that walks all six main surfaces (`/login`, `/`, `/chat`, `/knowledge`, `/studio`, `/settings/forwarding`) across mobile (390px) and desktop (1440px) viewports, capturing a full-page PNG per combination into `.planning/ui-reviews/{ISO-timestamp}/`
- Auth-gated surfaces are observed, never faked: the harness detects when the middleware redirects a protected route to `/login` and records `"redirected to /login (no session)"` in the index rather than injecting a session cookie or calling sign-in (T-47-11)
- Studio's style-pack switcher is captured best-effort — feature-detected via `.count()`, only engaged when the surface actually renders (not redirected)
- Added `apps/web/playwright.screenshot.config.ts`, a dedicated config (`testMatch` scoped to the capture spec, `workers: 1` / `fullyParallel: false`) that reuses the base config's `webServer`/`baseURL` wiring from 47-04
- Wired `screenshot:review` npm script in `apps/web/package.json`
- Ran the harness for real: **12 PNGs + index.md** produced under `.planning/ui-reviews/2026-07-10T18-39-30-080Z/` in 13.8s — `login` captured live and shows the 47-01/47-02 brand work (polytoken mark, "Welcome back to your workspace / Pick up right where you left off — sign in with Google."); the other 5 surfaces correctly recorded as redirected (no session in this run)

## Task Commits

1. **Task 1: Build the screenshot capture harness** - `d93e382` (feat)
2. **Task 2: Wire the screenshot:review script and produce the artifact** - `0327d9d` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/e2e/screenshot-review.spec.ts` - the capture harness (surfaces x viewports -> PNG + index.md)
- `apps/web/playwright.screenshot.config.ts` - dedicated config restricting the harness to this one spec
- `apps/web/package.json` - added `screenshot:review` script
- `apps/web/playwright.config.ts` - added `testIgnore` so the base assertion config never runs the capture spec (deviation, see below)

## Decisions Made

- **Single sequential test over parallel per-surface tests:** all 12 (or more, with alt-pack captures) screenshots share one `RUN_DIR` computed once at module load; a parallel/multi-test design would risk multiple timestamped directories for one logical run. `workers: 1` + `fullyParallel: false` in the dedicated config enforce this.
- **Output path anchored via `import.meta.url`, not `process.cwd()`:** the harness resolves the repo root from its own file location (`apps/web/e2e/` -> up 3 levels), so `npm run screenshot:review -w @polytoken/web` (cwd = apps/web under the hood) and any other invocation style both land the artifact at `<repo-root>/.planning/ui-reviews/`, never `apps/web/.planning/...`.
- **Alternate pack fixed to `linear-clean` ("Linear Clean"):** the second pack in `STYLE_PACK_IDS` (after the default `polytoken-teal`) — a concrete, discoverable choice rather than random, so index rows stay reproducible/greppable across runs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `testIgnore` to `apps/web/playwright.config.ts` so `test:e2e` never runs the capture spec**

- **Found during:** Task 1 (building the harness)
- **Issue:** The plan's `files_modified` list only named `screenshot-review.spec.ts`, `playwright.screenshot.config.ts`, and `package.json` — but the pre-existing base `playwright.config.ts` has `testMatch: /.*\.spec\.ts/`, which matches ANY `*.spec.ts` file under `e2e/`, including the new `screenshot-review.spec.ts`. Left as-is, `npm run test:e2e` would run the capture spec on both chromium AND firefox (contrary to D-47-05/the plan's own interfaces section: "`test:e2e` (assertions) and `screenshot:review` (capture) do not run each other").
- **Fix:** Added one line to `playwright.config.ts`: `testIgnore: /screenshot-review\.spec\.ts$/`. No other change to that file.
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** `npm run typecheck` shows zero errors attributable to this file (isolated `tsc --noEmit` check on the file, since the shared typecheck excludes `playwright.config.ts` by tsconfig `exclude` regardless); the two existing specs (`code-island-isolation.spec.ts`, `auth-redirect.spec.ts`) are untouched and the new capture spec is excluded from their config's testMatch by construction.
- **Committed in:** `d93e382` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for the plan's own "do not run each other" contract to actually hold; no scope creep — a single-line addition to a file the plan didn't list, driven directly by the plan's own interfaces requirement.

## Issues Encountered

None — the harness ran clean on the first try (13.8s, 1/1 test passed).

### Incidental finding (not fixed — out of this plan's scope)

While reviewing the captured `login` screenshots, the sidebar chrome (nav links, sign-out button, avatar) renders on the `/login` page itself — `apps/web/src/app/layout.tsx` is a single root layout with no route-group split between authenticated and public routes, so `AppSidebar` always renders regardless of auth state. This is pre-existing architecture (Phase 42/43), not something introduced by this plan, and fixing it would be a layout/architectural change (Rule 4 territory) well outside a screenshot-harness plan's scope. Flagging here as useful input for Phase 49 (brand reskin application), which may want a dedicated `(auth)` route group for a clean signed-out shell.

## User Setup Required

None — the harness ran against the already-running local dev server with no external service configuration needed.

## Next Phase Readiness

- VRFY-02 is satisfied: the harness exists, is committed, and produced a real reviewable artifact this run.
- `.planning/ui-reviews/2026-07-10T18-39-30-080Z/` (PNGs + index.md, gitignored) is available for human/UI review of the current re-skin state.
- Phases 48-51 can run `npm run screenshot:review -w @polytoken/web` at any point for a fresh visual snapshot; once a real Supabase session exists (OAuth runbook completed), re-running will capture the 5 currently auth-gated surfaces plus studio's per-pack alternate.
- Incidental finding above (login page showing full app sidebar) is a candidate for Phase 49's attention, not a blocker for this phase.

---
*Phase: 47-brand-foundation-verification-tooling*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: apps/web/e2e/screenshot-review.spec.ts
- FOUND: apps/web/playwright.screenshot.config.ts
- FOUND: apps/web/playwright.config.ts
- FOUND: screenshot:review script in apps/web/package.json
- FOUND: .planning/ui-reviews/2026-07-10T18-39-30-080Z/index.md (produced artifact)
- FOUND: commit d93e382 (feat(47-05): build screenshot review capture harness)
- FOUND: commit 0327d9d (feat(47-05): wire screenshot:review script, produce first review artifact)
