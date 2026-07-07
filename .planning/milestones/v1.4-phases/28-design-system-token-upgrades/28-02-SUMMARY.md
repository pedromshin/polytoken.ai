---
phase: 28-design-system-token-upgrades
plan: 02
subsystem: ui
tags: [design-tokens, tailwind, tailwindcss-animate, react-flow, css-shadows]

# Dependency graph
requires:
  - phase: 28-design-system-token-upgrades (28-01)
    provides: "--elevation-1/2/3 custom properties + shadow-elevation-1/2/3 Tailwind utilities registered in base.ts"
provides:
  - "TOKEN-03 fully consumed: all 4 named elevation call sites (card.tsx, composer.tsx, chat-node.tsx, genui-panel-node.tsx) now use shadow-elevation-1/2 instead of stock shadow/shadow-sm"
  - "TOKEN-05 item (a): genui panel mount entrance (animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none) on GenuiPanelNode's outer shell only — CORRECTED 2026-07-06: the originally-shipped duration-[250ms] collided with the shell's duration-150 transition utility (Tailwind ambiguity warning); hotfixed to the unambiguous arbitrary property in commit 64f3cbc"
affects: [28-03-design-system-token-upgrades]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resting/selected elevation swap on canvas node shells: elevation-1 at rest, elevation-2 + existing SELECTED_RING when selected -- reinforces the ring idiom rather than replacing it"
    - "Mount-only entrance animation applied strictly to a memo'd component's outer shell div so re-renders (drag/stream/select) never replay it -- confirmed via GenuiPanelNodeBody's existing memo boundary, no new memoization added"
    - "One animation per reveal: genui-panel-node entrance never stacks with Phase 27's GeneratingRing (neither file touches the other's concern)"

key-files:
  created: []
  modified:
    - packages/ui/src/card.tsx
    - apps/web/src/app/chat/_components/composer.tsx
    - apps/web/src/app/chat/_canvas/chat-node.tsx
    - apps/web/src/app/chat/_canvas/genui-panel-node.tsx

key-decisions:
  - "TOKEN-03 marked complete: all 4 named consumers (the plan's entire scope) landed in this single plan -- no partial-consumer state to leave open"
  - "TOKEN-05 left open: only item (a), the genui panel mount entrance, landed here; items (b) Studio history-island/page-ideas-island list stagger are 28-03's scope"

requirements-completed: [TOKEN-03]

# Metrics
duration: ~4min
completed: 2026-07-07
---

# Phase 28 Plan 02: Design-System Token Upgrades (Elevation Consumers + Genui Mount Entrance) Summary

**Wired the 28-01 elevation scale into its 4 named consumers (card, composer, both canvas node shells) and gave GenuiPanelNode's outer shell a motion-reduce-safe fade+zoom mount entrance via the already-installed tailwindcss-animate plugin.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-07T01:36:55Z
- **Completed:** 2026-07-07T01:40:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `card.tsx`'s base `shadow` and `composer.tsx`'s dock `shadow-sm` now resolve through `shadow-elevation-1`/`shadow-elevation-2` respectively -- both visibly consume the teal-tinted, ≤8px-blur elevation scale from 28-01
- `chat-node.tsx` and `genui-panel-node.tsx` both gained a resting/selected elevation split (`shadow-elevation-1` at rest, `shadow-elevation-2` alongside the existing `SELECTED_RING` when selected) on their previously-inert `transition-shadow duration-150` class, reinforcing the ring-2 selection idiom instead of replacing it; the FIX-04 `border-l-2 border-l-primary` differentiation stripe on `chat-node.tsx` is untouched
- `genui-panel-node.tsx`'s outer shell gained the exact TOKEN-05 (a) entrance class string (`animate-in fade-in-0 zoom-in-95 duration-[250ms] motion-reduce:animate-none`) -- applied only to the outer `<div>`, never to `GenuiPanelNodeBody`/`GenuiPartBoundary`/`InteractiveWidgetBoundary`/`SpecRenderer` (all four confirmed untouched via `git status`)
- `npm --prefix apps/web run typecheck` and the full web vitest suite (24 files / 174 tests, including `token-contrast.test.ts` from 28-01) both green; `use-canvas-persistence*` (14 tests) and `panel-data-flow` (1 test) specifically re-verified green to confirm the node shell edits didn't touch layout/dimension math

## Task Commits

Each task was committed atomically:

1. **Task 1: card.tsx + composer.tsx elevation swaps** - `e180c31` (feat)
2. **Task 2: canvas node shells -- resting/selected elevation + genui panel entrance** - `7f1e64d` (feat)

**Plan metadata:** (this commit -- docs: complete plan)

## Files Created/Modified
- `packages/ui/src/card.tsx` - `shadow` -> `shadow-elevation-1` (only edit this phase; `rounded-xl` stays token-driven purely via 28-01's `web.ts` config, no radius edit here)
- `apps/web/src/app/chat/_components/composer.tsx` - dock wrapper `shadow-sm` -> `shadow-elevation-2` (reads as a top-shadow since nothing renders below the composer)
- `apps/web/src/app/chat/_canvas/chat-node.tsx` - resting=`shadow-elevation-1`, selected=`${SELECTED_RING} shadow-elevation-2`; `border-l-2 border-l-primary` preserved
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` - same elevation swap plus the mount entrance classes on the outer shell

## Decisions Made
- TOKEN-03 marked complete in REQUIREMENTS.md: this plan's 2 tasks cover all 4 named elevation consumers from the UI-SPEC table, so there is no remaining partial-consumer scope for TOKEN-03.
- TOKEN-05 intentionally left open: only its genui-panel-mount item (a) landed here; the Studio list stagger items (b) (`history-island.tsx`, `page-ideas-island.tsx`) are explicitly 28-03's scope per the plan's own success criteria.

## Deviations from Plan

None - plan executed exactly as written. Both interface strings (card.tsx:12, composer.tsx:76, chat-node.tsx:150, genui-panel-node.tsx:157) matched the plan's cited "exact current strings" verbatim before editing, so no reconciliation was needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Manual Verification Deferred

The plan's Task 2 `<human-check>` (drop a genui panel on the canvas and confirm the fade+zoom fires once on mount, not on drag/stream/select; confirm the selection shadow lift; confirm `prefers-reduced-motion` cancels the entrance) was not performed interactively in this autonomous run -- this plan has no `checkpoint:human-verify` task type, and `config.json` runs in `yolo`/`skip_checkpoints` mode with `auto_advance: true`. All automatable gates (grep class-string assertions, typecheck, full vitest suite including canvas-persistence/panel-data-flow) passed. Recommend a quick visual pass next time the `/chat` dev server is up: drop/generate a genui panel and toggle OS reduced-motion.

## Next Phase Readiness
- TOKEN-03 fully closed: all 4 named consumers wired, elevation scale visibly doing work app-wide (card lift, composer dock, canvas node selection lift).
- TOKEN-05 item (a) done; item (b) (Studio history/page-ideas list stagger) and TOKEN-04's docs/radius-allowlist note remain for 28-03.
- No token-layer or config changes needed by 28-03 -- pure consumer-file wiring, same as this plan.

---
*Phase: 28-design-system-token-upgrades*
*Completed: 2026-07-07*

## Self-Check: PASSED

All 4 modified files + SUMMARY.md confirmed present on disk; both task commit hashes (`e180c31`, `7f1e64d`) confirmed present in `git log --oneline --all`.
