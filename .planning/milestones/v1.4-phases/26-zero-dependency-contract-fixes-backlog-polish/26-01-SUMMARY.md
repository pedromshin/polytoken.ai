---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 01
subsystem: ui
tags: [react, nextjs, tailwind, radix-scroll-area, lucide-react, vitest, token-discipline]

# Dependency graph
requires: []
provides:
  - "Shared JsonPane component (apps/web/src/app/studio/_components/json-pane.tsx) with a Copy/Check clipboard button"
  - "generation-sandbox-island.tsx, preview/page.tsx, history-island.tsx all render their Spec JSON pane via JsonPane"
  - "history-island.tsx fully token-compliant: zero font-medium, zero amber, destructive-token FallbackNotice"
affects: [26-zero-dependency-contract-fixes-backlog-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App-local debug/inspector component (JsonPane) reusing @nauta/ui ScrollArea + Button rather than a new packages/ui primitive"
    - "Copy-to-clipboard idiom: navigator.clipboard.writeText + Copy/Check lucide-react icon swap, COPIED_RESET_MS=1500 (mirrors turn-action-row.tsx)"

key-files:
  created:
    - apps/web/src/app/studio/_components/json-pane.tsx
    - apps/web/src/app/studio/_components/json-pane.test.tsx
  modified:
    - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
    - apps/web/src/app/studio/preview/page.tsx
    - apps/web/src/app/studio/_components/history-island.tsx

key-decisions:
  - "FIX-02 #9 (history-island row title) drops font-medium entirely with no font-normal replacement, matching conversation-row.tsx's sibling convention (no weight override at all) — distinct from #10's explicit font-medium -> font-normal caption-role swap"
  - "JsonPane copy button uses Button variant=\"ghost\" size=\"icon\" (36x36) rather than the 44px isolated-touch-target size — FIX-07's 44px rule is scoped to primary/isolated controls (composer Send, minimap toggle), not this dense inspector header"
  - "Colocated json-pane.test.tsx installs a minimal ResizeObserver stub (jsdom has none) before mounting — required for @radix-ui/react-scroll-area's ScrollArea to mount without throwing in this repo's createRoot+act test convention"

patterns-established:
  - "Debug/inspector chrome (JsonPane) stays app-local per 26-CONTEXT.md even when shared across 3 call sites — not promoted to packages/ui"

requirements-completed: [FIX-05, FIX-02, FIX-03]

# Metrics
duration: 15min
completed: 2026-07-06
---

# Phase 26 Plan 01: Shared JsonPane + history-island token cleanup Summary

**One shared `JsonPane` component (header bar + ScrollArea/pre + Copy/Check clipboard button) now backs all three studio Spec JSON debug panes, and `history-island.tsx` is fully token-compliant (zero `font-medium`, zero `amber`, destructive-token `FallbackNotice`).**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-06T20:49:00Z (approx.)
- **Completed:** 2026-07-06T20:54:21Z
- **Tasks:** 3/3 completed
- **Files modified:** 5 (1 created component, 1 created test, 3 modified call sites)

## Accomplishments
- Created `JsonPane` (`apps/web/src/app/studio/_components/json-pane.tsx`): labeled header bar + `ScrollArea`/`pre` JSON body + ghost icon-only copy button (`Copy` -> `Check` swap, `COPIED_RESET_MS=1500`), replicating `turn-action-row.tsx`'s clipboard idiom exactly. Zero new npm dependencies (reuses `@nauta/ui`'s `ScrollArea`/`Button` and `lucide-react`, already installed).
- Rewired all 3 duplicated raw-`JSON.stringify` debug panes — `generation-sandbox-island.tsx`, `preview/page.tsx`, `history-island.tsx` — to consume `JsonPane`, adding the copy affordance none of the three previously had, with identical visual footprint (`bg-muted` outer wrapper unchanged at every call site).
- Cleared `history-island.tsx`'s three FIX-02/FIX-03 token drifts in the same file: row-title `font-medium` dropped entirely, detail-header caption `font-medium` -> `font-normal`, and `FallbackNotice`'s hand-rolled `amber`/`dark:` override replaced with the verbatim `destructive` recipe already established by `generation-state-chrome.tsx`'s fallback state.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared JsonPane component** - `4cd49ec` (feat)
2. **Task 2: Wire JsonPane into generation-sandbox + preview panes** - `77f1497` (feat)
3. **Task 3: history-island — JsonPane swap + token cleanup (FIX-02 #9/#10, FIX-03e)** - `4b88fcc` (fix)

**Plan metadata:** (this commit, following SUMMARY.md write)

## Files Created/Modified
- `apps/web/src/app/studio/_components/json-pane.tsx` - New shared `JsonPane` component (`value`/`label` props, copy button, ScrollArea/pre body)
- `apps/web/src/app/studio/_components/json-pane.test.tsx` - Colocated tests: formatted-JSON render + copy-button clipboard write & icon swap
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` - Spec JSON pane now renders `<JsonPane value={specToRender} />`; removed now-unused `ScrollArea` import
- `apps/web/src/app/studio/preview/page.tsx` - Spec JSON pane now renders `<JsonPane value={SHOWCASE_SPEC} />`; removed now-unused `ScrollArea` import
- `apps/web/src/app/studio/_components/history-island.tsx` - Detail Spec JSON pane renders `<JsonPane value={spec} />`; row-title/detail-caption weight fixes; `FallbackNotice` destructive-token recipe (kept its own `ScrollArea` import — still used by the master-list scroll container)

## Decisions Made
- FIX-02 #9 vs #10 treated as genuinely distinct per the UI-SPEC's row-by-row table: #9 (list-row title) omits the weight class entirely to match `conversation-row.tsx`'s sibling convention (which carries no weight override at all); #10 (caption) gets an explicit `font-normal` since it is documented as a caption-role weight statement, not a bare omission.
- `JsonPane`'s copy button uses the standard `size="icon"` (36x36) register, not the 44px minimum-touch-target size used for isolated primary controls elsewhere (composer Send, minimap dismiss) — this is a dense inspector-header affordance, same category FIX-07 explicitly exempts.
- Test file adds a local `ResizeObserver` stub class (not a dependency) because jsdom has no native implementation and `@radix-ui/react-scroll-area` calls `new ResizeObserver(...)` unconditionally on mount.

## Deviations from Plan

None - plan executed exactly as written. The `ResizeObserver` stub in `json-pane.test.tsx` is test-infrastructure necessary to exercise the plan-mandated `ScrollArea`-based component in jsdom; it isn't a deviation from any planned behavior, just a required test fixture.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FIX-05 (shared JSON pane), and the FIX-02 #9/#10 + FIX-03e slice of `history-island.tsx`'s token cleanup, are complete and verified (typecheck + full `@nauta/web` test suite, 20 files / 153 tests passing).
- Remaining FIX-02 call sites (#1-4, #5-8, #11 in `catalog-browser-island.tsx`, `generation-state-chrome.tsx`, `code-sandbox-island.tsx`, `code-island-frame.tsx`, `page-ideas-island.tsx`) and remaining FIX-03 sub-items (a/b/c/d/f in `code-island-frame.tsx`, `page-ideas-island.tsx`, `code-sandbox-island.tsx`) are NOT covered by this plan — they belong to other 26-xx plans per the phase's `26-UI-SPEC.md` fix inventory.
- No blockers for subsequent phase-26 plans; `JsonPane` is now available for reuse if any other studio surface needs a JSON inspector pane.

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 6 created/modified files verified present on disk; all 4 commit hashes (4cd49ec, 77f1497, 4b88fcc, a6023a7) verified present in `git log --oneline --all`.
