---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 02
subsystem: ui
tags: [tailwind, tokens, studio, design-system, react]

# Dependency graph
requires:
  - phase: 26-01
    provides: shared JsonPane component (json-pane.tsx); history-island.tsx already cleaned of its font-medium/amber sites
provides:
  - code-island-frame.tsx's PHASE_TONE map, ViolationList tone recipes, and iframe wrapper rendering exclusively from destructive/primary/muted/background tokens (no dark: overrides)
  - catalog-browser-island.tsx's prop table with a muted header band (bg-muted/40) and zebra rows (odd:bg-muted/20)
  - Elimination of 8 of 11 studio font-medium call-sites (FIX-02 #1,2,3,4,5,6,7,11)
  - page-ideas-island.tsx curveball badge reusing Badge variant="outline" instead of hand-rolled amber classes
affects: [26-03, TOKEN-01..05 design-system token upgrade phase]

# Tech tracking
tech-stack:
  added: []
  patterns: [semantic-token color recipes reused verbatim across studio islands (border-primary/30 bg-primary/10 text-primary for success; border-destructive/30 bg-destructive/10 text-destructive for failure; border-border bg-muted/40 text-foreground for neutral/in-progress)]

key-files:
  created: []
  modified:
    - apps/web/src/app/studio/_components/code-island-frame.tsx
    - apps/web/src/app/studio/_components/catalog-browser-island.tsx
    - apps/web/src/app/studio/_components/generation-state-chrome.tsx
    - apps/web/src/app/studio/_components/code-sandbox-island.tsx
    - apps/web/src/app/studio/_components/page-ideas-island.tsx

key-decisions:
  - "ViolationList's tone prop renamed from red/amber to destructive/muted to match the token vocabulary it now renders (no amber token exists in this design system)"
  - "Catalog prop table cell padding normalized to px-2 py-1/py-2 (was pb-1/pr-3/py-0.5) to support the new header band + zebra treatment"

requirements-completed: [FIX-02, FIX-03, FIX-06]

# Metrics
duration: 3min
completed: 2026-07-06
---

# Phase 26 Plan 02: Studio Token & Weight Cleanup Summary

**Replaced code-island-frame's 6-entry raw amber/emerald/red PHASE_TONE map and 2-recipe red/amber ViolationList with 3 semantic-token buckets, gave the catalog prop table a muted header band + zebra rows, and cleared 8 of 11 remaining studio `font-medium` sites — zero new dependencies.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-06T21:01:34Z
- **Completed:** 2026-07-06T21:04:38Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `code-island-frame.tsx`'s `PHASE_TONE` map collapsed from 6 raw-palette entries to 3 token buckets (in-progress/success/failure), reusing `generation-state-chrome`'s cache-hit/in-progress recipes verbatim
- `ViolationList`'s `tone` prop renamed to `destructive`/`muted` vocabulary; iframe wrapper's `bg-white` swapped for `bg-background`
- Catalog prop table styled to match its surrounding `Card`: `bg-muted/40` header band + `odd:bg-muted/20` zebra rows, all four `<th>` moved to `font-semibold`
- Remaining `font-medium` sites in `generation-state-chrome.tsx`, `code-sandbox-island.tsx`, and `page-ideas-island.tsx` cleared (heading weight bumps + one `Badge` override deletion)
- `code-sandbox-island.tsx`'s error text and `page-ideas-island.tsx`'s curveball badge moved off raw `red-600`/`amber-*` classes onto `text-destructive` / `Badge variant="outline"`

## Task Commits

Each task was committed atomically:

1. **Task 1: code-island-frame — PHASE_TONE + ViolationList + iframe wrapper + PHASE_LABEL weight** - `53664a3` (feat)
2. **Task 2: catalog-browser prop table — zebra + muted header + th font-semibold** - `53069ff` (feat)
3. **Task 3: generation-state-chrome + code-sandbox + page-ideas — remaining token/weight fixes** - `62d80b8` (feat)

## Files Created/Modified
- `apps/web/src/app/studio/_components/code-island-frame.tsx` - PHASE_TONE (3 token buckets), ViolationList tone recipes (destructive/muted), iframe bg-background, PHASE_LABEL font-semibold
- `apps/web/src/app/studio/_components/catalog-browser-island.tsx` - prop table thead/tbody restyled with muted header band + zebra rows, th font-semibold
- `apps/web/src/app/studio/_components/generation-state-chrome.tsx` - fallback heading font-semibold; cache-hit Badge's local font-medium override deleted
- `apps/web/src/app/studio/_components/code-sandbox-island.tsx` - "Generate from intent" heading font-semibold; error text text-destructive
- `apps/web/src/app/studio/_components/page-ideas-island.tsx` - "Page Ideas" heading font-semibold; curveball badge -> Badge variant="outline"

## Decisions Made
- Renamed `ViolationList`'s `tone` prop values from `"red"`/`"amber"` to `"destructive"`/`"muted"` since no amber token exists in this system — informational/accessibility findings now render as neutral muted rather than an invented hue, per `26-UI-SPEC.md` FIX-03(b).
- Normalized catalog prop table cell padding to a uniform `px-2 py-1`/`px-2 py-2` scheme (dropping the prior `pb-1 pr-3`/`py-0.5 pr-3` asymmetric padding) so the new header band and zebra rows read cleanly — a presentational-only adjustment within the plan's literal target markup.

## Deviations from Plan

None - plan executed exactly as written. All five files matched the plan's `<read_first>` line-number references, and every acceptance-criteria grep/typecheck passed on the first attempt per task.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three tasks' acceptance criteria (grep counts + `npm run typecheck -w @nauta/web`) verified individually and again in aggregate across all five files; zero `font-medium`, zero `amber-|red-[0-9]|emerald-|bg-white` remain in the five plan-scoped files.
- 3 of the 11 FIX-02 `font-medium` call-sites (history-island.tsx #9/#10) were already resolved in 26-01 per prior-wave context; this plan's 8 sites (#1-#8, #11) bring the running total to 11/11 studio-side. `packages/ui/src/button.tsx`'s root-cause fix (`buttonVariants` base class) remains for a separate plan/task in this phase.
- FIX-03(e) (`history-island.tsx`'s `FallbackNotice`) was explicitly out of this plan's `files_modified` scope (26-01 already touched that file) — confirm it is covered by another 26-xx plan before closing out FIX-03 phase-wide.
- No blockers for subsequent 26-xx plans (FIX-01, FIX-04 through FIX-11, POLISH-01/02).

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*
