---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 03
subsystem: ui
tags: [tailwind, tokens, chat, design-system, react, button]

# Dependency graph
requires:
  - phase: 26-01
    provides: shared JsonPane component; history-island.tsx already cleaned of its font-medium/amber sites
  - phase: 26-02
    provides: 8 of 11 studio font-medium call-sites cleared (#1-8,#11); root-cause button.tsx fix explicitly deferred to this plan
provides:
  - packages/ui/src/button.tsx buttonVariants base emitting font-normal (root-cause fix, app-wide blast radius — every Button label in the app)
  - Zero rendered font-medium anywhere under /chat or /studio (11/11 studio sites + button.tsx source + 2 chat drift sites all cleared; app-wide FIX-02 grep gate now passes)
  - Eased transition-colors + hover:bg-muted affordances on conversation-row.tsx (row + overflow-menu trigger) and turn-action-row.tsx (copy/regenerate buttons)
  - Assistant-message neutral left rail (border-l-2 border-l-border/60 pl-3) on message-turn.tsx distinguishing role beyond alignment
affects: [26-04, 26-05, 26-06, 26-07, TOKEN-01..05 design-system token upgrade phase]

# Tech tracking
tech-stack:
  added: []
  patterns: [explicit font-normal at the design-system source rather than a bare omission — keeps the 2-weight contract legible at the declaration site; hover affordances pair transition-colors with a real hover:bg-muted background rather than text-color-only swaps]

key-files:
  created: []
  modified:
    - packages/ui/src/button.tsx
    - apps/web/src/app/chat/_components/cost-cap-blocked-card.tsx
    - apps/web/src/app/chat/_components/inline-error-card.tsx
    - apps/web/src/app/chat/_components/conversation-row.tsx
    - apps/web/src/app/chat/_components/turn-action-row.tsx
    - apps/web/src/app/chat/_components/message-turn.tsx

key-decisions:
  - "buttonVariants base gets explicit font-normal (not a bare omission of font-medium) so the 2-weight contract is legible at the declaration site — every Button in the app (Send/New chat/Retry/model-picker) changes weight, an intentional blast radius per 26-UI-SPEC FIX-02"
  - "cost-cap-blocked-card.tsx and inline-error-card.tsx destructive headings moved to font-semibold (not dropped to font-normal) to match generation-state-chrome.tsx's existing destructive-heading emphasis register — these were drift sites not in the UI-SPEC's 11-item studio table but required by the app-wide grep gate"
  - "Assistant-message left rail uses neutral border-l-border/60, explicitly NOT border-primary — a per-message role marker is not on the accent allowlist; primary stays reserved for its already-established uses"

requirements-completed: [FIX-02, FIX-07, FIX-08]

# Metrics
duration: ~12min
completed: 2026-07-06
---

# Phase 26 Plan 03: Button Source Fix + Chat Hover/Role Chrome Summary

**Purged `font-medium` at its root cause (`packages/ui/src/button.tsx`'s `buttonVariants` base, app-wide blast radius) plus 2 chat drift sites, added eased `transition-colors` + `hover:bg-muted` affordances to conversation rows and turn-action buttons, and gave assistant messages a neutral left-rail role marker — zero new dependencies, app-wide FIX-02 grep gate now passes.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-06T21:13:00Z (approx.)
- **Completed:** 2026-07-06T21:15:53Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `packages/ui/src/button.tsx`'s `buttonVariants` base class changed `font-medium` -> `font-normal` — the single root-cause fix that resolves FIX-02's typography contract for every `Button` in the app (Send, New chat, Retry, model-picker-trigger, and every other call site)
- The two chat-side `font-medium` drift sites (`cost-cap-blocked-card.tsx`, `inline-error-card.tsx` destructive headings) moved to `font-semibold`, matching `generation-state-chrome.tsx`'s established destructive-heading register
- Verified the app-wide FIX-02 grep gate (`font-medium` search across `apps/web/src/app/chat`, `apps/web/src/app/studio`, and `packages/ui/src/button.tsx`) now returns zero matches outside test files (the one remaining hit is a negative assertion inside `markdown-renderer.test.tsx` explicitly checking that `font-medium` is absent)
- `conversation-row.tsx`'s row base gained `transition-colors` (easing the `isActive`/hover background swap) and its overflow-menu trigger gained `hover:bg-muted` alongside the existing `hover:text-foreground`
- `turn-action-row.tsx`'s raw copy/regenerate `<button>` elements gained `transition-colors hover:bg-muted` (regenerate keeps its existing `disabled:opacity-30`)
- `message-turn.tsx`'s assistant branch gained a thin neutral left rail (`border-l-2 border-l-border/60 pl-3`), giving assistant turns role chrome beyond side-of-screen alignment, without touching the user bubble or introducing an accent color

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove font-medium at the Button source + two chat drift sites (FIX-02)** - `7919ca8` (fix)
2. **Task 2: Eased hover affordances on conversation-row + turn-action-row (FIX-07)** - `ab1ec11` (feat)
3. **Task 3: Assistant-message thin left rail (FIX-08)** - `b38cf5f` (feat)

## Files Created/Modified
- `packages/ui/src/button.tsx` - `buttonVariants` base `font-medium` -> `font-normal` (root-cause fix, app-wide blast radius)
- `apps/web/src/app/chat/_components/cost-cap-blocked-card.tsx` - destructive heading span `font-medium` -> `font-semibold`
- `apps/web/src/app/chat/_components/inline-error-card.tsx` - destructive heading span `font-medium` -> `font-semibold`
- `apps/web/src/app/chat/_components/conversation-row.tsx` - row base gained `transition-colors`; overflow-menu trigger gained `hover:bg-muted`
- `apps/web/src/app/chat/_components/turn-action-row.tsx` - copy + regenerate raw buttons gained `transition-colors hover:bg-muted`
- `apps/web/src/app/chat/_components/message-turn.tsx` - assistant branch wrapper gained `border-l-2 border-l-border/60 pl-3`

## Decisions Made
- Used explicit `font-normal` rather than omitting the weight class entirely at the `buttonVariants` declaration site, per the plan's literal diff target — keeps the 2-weight contract legible in the source rather than relying on Tailwind's default.
- Moved the two chat drift-site headings to `font-semibold` (not `font-normal`) since they are heading-register text matching `generation-state-chrome.tsx`'s destructive-heading convention, not body text.
- Kept the assistant-message rail strictly neutral (`border-border/60`) per the UI-SPEC's explicit instruction that a per-message role marker is not on the primary accent allowlist.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched the plan's `<action>` targets verbatim; every acceptance-criteria grep/typecheck passed on the first attempt.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FIX-02 is now fully resolved app-wide: 11/11 studio call-sites (26-01/26-02) + the `buttonVariants` source + the 2 chat drift sites (this plan) all clear the `font-medium` grep gate (excluding the intentional negative assertion in `markdown-renderer.test.tsx`).
- FIX-07 (conversation-row + turn-action-row hover affordances) and FIX-08 (assistant left rail) are complete per this plan's `must_haves`.
- Both `npm run typecheck -w @nauta/ui` and `npm run typecheck -w @nauta/web` pass; the full `@nauta/genui` (477 tests) and `@nauta/web` (153 tests) vitest suites pass with no `Button`-class snapshot/assertion breakage from the app-wide weight change.
- No blockers for subsequent 26-xx plans (FIX-01, FIX-04, FIX-05, FIX-09, FIX-10, FIX-11, POLISH-01/02 — whichever remain across 26-04 through 26-07).

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 6 modified files + this SUMMARY.md confirmed present on disk; all 3 commits (7919ca8, ab1ec11, b38cf5f) confirmed in git log.
