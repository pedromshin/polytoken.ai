---
phase: 47-brand-foundation-verification-tooling
plan: 01
subsystem: ui
tags: [brand, svg, sidebar, login, design-tokens, next-app-router]

# Dependency graph
requires:
  - phase: 43-auth-google-oauth-sessions-supabase-auth
    provides: app-sidebar.tsx SidebarHeader brand slot + login/page.tsx Google OAuth card (the two surfaces this plan re-marks)
provides:
  - "apps/web/src/components/brand-mark.tsx — reusable BrandMark component (glyph/lockup variants, brand/mono tones), token-driven via currentColor"
  - "apps/web/src/app/icon.svg — static App Router favicon glyph mirroring the mark geometry"
  - "sidebar brand slot and login card header both render the mark instead of the letter-'P' placeholder"
  - "warm first-person polytoken-register copy on the login card"
affects: [48-design-token-extensions, 49-total-ui-reskin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BrandMark component pattern: currentColor-driven inline SVG + Tailwind opacity-* for the one allowed secondary accent, zero raw color literals in TSX"
    - "Next.js App Router auto-favicon via app/icon.svg (no layout/link-tag edit)"

key-files:
  created:
    - apps/web/src/components/brand-mark.tsx
    - apps/web/src/app/icon.svg
  modified:
    - apps/web/src/components/app-sidebar.tsx
    - apps/web/src/app/login/page.tsx

key-decisions:
  - "Mark geometry: two rotated high-radius rounded-rect 'lobes' (brain reading) plus one small circle 'node' (node-cluster reading) — satisfies D-47-02's node/brain hybrid without sharp graph lines or hand-drawn doodle (ban #11)"
  - "tone='mono' drops the secondary lobe's opacity split (flat single currentColor) so the mark stays legible at small/favicon sizes instead of a muddy semi-transparent overlap"
  - "sign-out-button.tsx and google-signin-button.tsx reviewed per plan instruction and left unchanged — both labels ('Sign out', 'Continue with Google') are already clear/in-register with no systems vocabulary"
  - "Login copy finalized as-illustrated in the plan ('Welcome back to your workspace' / 'Pick up right where you left off — sign in with Google.') — reads warm/first-person per D-47-01 without meta-criticism (ban #13)"

patterns-established:
  - "Token-driven brand asset pattern: component SVG uses currentColor exclusively; the one static (non-inheriting) SVG asset (favicon) mirrors the same geometry with an explicit hsl(164 39% 22%) fill traced to --primary, never an opaque hex"

requirements-completed: [BRND-02, BRND-01]

# Metrics
duration: 25min
completed: 2026-07-10
---

# Phase 47 Plan 01: Brand Mark + Sidebar/Login Wiring Summary

**Committed polytoken node/brain-hybrid SVG mark (BrandMark component + icon.svg favicon) replacing the "P" letter placeholder in the sidebar and login card, plus a warm first-person login-copy rewrite — all token-driven via currentColor with zero raw hex in the touched TSX.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-10T17:33:35Z
- **Tasks:** 3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `BrandMark` component: a rounded, organic node/brain-hybrid mark (two interlocking soft-edge "lobe" rects + one bridging circular "node"), `variant="glyph"|"lockup"` and `tone="brand"|"mono"`, entirely `currentColor`-driven with the one D-47-02-allowed secondary accent expressed as a Tailwind `opacity-55` utility — no raw color literal anywhere in the file.
- `app/icon.svg` favicon mirrors the same geometry as a static asset (fills traced to `hsl(164 39% 22%)`, matching `--primary`), inert (no script/foreignObject/event-handler attributes) — auto-served by Next.js App Router with no layout change.
- Sidebar brand slot (`app-sidebar.tsx` `SidebarHeader`) and login card header (`login/page.tsx` `CardHeader`) both now render `<BrandMark variant="glyph">` in a `text-primary` context; the "P" letter-avatar placeholder is gone from both surfaces, the "Polytoken" wordmark name is unchanged (D-47-01 USER-LOCK).
- Login card copy rewritten into the warm polytoken first-person register: "Welcome back to your workspace" / "Pick up right where you left off — sign in with Google." — systems phrasing ("Sign in to Polytoken" / "Use your Google account to continue.") is gone.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the polytoken brand mark component + favicon glyph** - `750aec8` (feat)
2. **Task 2: Wire the mark + polytoken-register chrome into the sidebar** - `d2b129e` (feat)
3. **Task 3: Wire the mark + polytoken-register copy into the login card** - `7dabedd` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/src/components/brand-mark.tsx` - `BrandMark` component: currentColor SVG mark, glyph/lockup variants, brand/mono tones
- `apps/web/src/app/icon.svg` - static favicon glyph, `hsl(164 39% 22%)` fills, inert
- `apps/web/src/components/app-sidebar.tsx` - `SidebarHeader` brand slot now renders `BrandMark` instead of the "P" span
- `apps/web/src/app/login/page.tsx` - `CardHeader` now renders `BrandMark`; `CardTitle`/`CardDescription` rewritten to the warm polytoken register

## Decisions Made
- Mark geometry chosen as two rotated high-radius rounded rectangles (organic "lobes") plus a small bridging circle ("node") — reads as both a node cluster and something organic per D-47-02, stays clear of sharp graph-line/infra-diagram/hand-drawn-doodle territory (ban #11).
- `sign-out-button.tsx` and `google-signin-button.tsx` were in the plan's files list for review-only; both were confirmed already in-register and left unchanged (no edit needed, not a deviation — this was the plan's own instruction).
- Finalized the login copy exactly as the plan's illustrative examples suggested, since they already satisfied the warm/first-person register and ban #13 (no meta-criticism) cleanly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The first draft of `icon.svg`'s explanatory comment literally contained the substrings `<script` and `<foreignObject` (inside prose describing what the asset does NOT contain), which false-triggered the Task 1 inert-asset grep gate (`grep -niE "<script|<foreignObject|onload=|onclick="`). Reworded the comment to describe the same constraint without those literal substrings (e.g. "no script element" instead of "no `<script>`"); re-ran the grep to confirm a clean pass before proceeding.
- `npm run typecheck -w @polytoken/web` fails on pre-existing `src/app/dev/design/previews-*.tsx` errors (stale `@nauta/ui/*` import paths + 2 implicit-`any` params, from the untracked `apps/web/src/app/dev/design/` directory noted in the project's own baseline) — unrelated to this plan's files, confirmed out of scope by filtering those paths out of the typecheck output and confirming zero remaining errors after every task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- BRND-02 (committed mark in sidebar + login + favicon) and the login/sidebar slice of BRND-01 (warm polytoken-register chrome copy) are both satisfied; `npm run typecheck -w @polytoken/web` and `npm run test -w @polytoken/web` (294/294) stay green outside the pre-existing `dev/design` baseline.
- `BrandMark`'s `variant="lockup"` and `tone="mono"` are implemented but not yet consumed anywhere — available for Phase 49's total re-skin (header/marketing-facing chrome) and any future small-size/avatar slot.
- Ready for the next 47-0N plan (brand guide doc / Playwright toolchain / screenshot harness per 47-CONTEXT.md D-47-03/D-47-04/D-47-05).

---
*Phase: 47-brand-foundation-verification-tooling*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created files verified present on disk (`brand-mark.tsx`, `icon.svg`, this SUMMARY.md) and all
modified files present (`app-sidebar.tsx`, `login/page.tsx`); all three task commits (`750aec8`,
`d2b129e`, `7dabedd`) verified present in `git log`.
