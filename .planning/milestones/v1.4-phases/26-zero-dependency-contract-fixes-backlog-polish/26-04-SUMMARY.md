---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 04
subsystem: ui
tags: [react-flow, lucide-react, dagre, tailwind, canvas, chat, genui]

# Dependency graph
requires:
  - phase: 23-canvas-genui
    provides: ChatNode/GenuiPanelNode byte-identical shells, dagre LR canvas-layout.ts, node-type registry
provides:
  - "ChatNode: teal primary left-edge stripe (border-l-2 border-l-primary) + MessageSquare header icon"
  - "GenuiPanelNode: lighter neutral header (bg-muted/40) + PanelsTopLeft header icon"
  - "canvas-layout.ts dagre nodesep tuned 32 -> 64 so same-rank sibling panels get 8-pt breathing room"
affects: [28-design-system-token-upgrades, 27-adopted-external-design-picks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Accent allowlist member: ChatNode's left-edge stripe + icon is the ONLY primary-colored decoration on node chrome; GenuiPanelNode stays neutral (bg-muted/40 vs bg-muted/60, same gray token, no second hue)"
    - "Decorative lucide icons in node headers use aria-hidden with the row's existing text as the accessible name"

key-files:
  created: []
  modified:
    - apps/web/src/app/chat/_canvas/chat-node.tsx
    - apps/web/src/app/chat/_canvas/genui-panel-node.tsx
    - apps/web/src/app/chat/_canvas/canvas-layout.ts

key-decisions:
  - "Tuned only nodesep (32 -> 64) for POLISH-02, not a column-wrap cap - the cramped-column symptom is same-rank dagre stacking, and widening the sibling gutter to the next 8-pt step directly addresses it without adding new layout-branching logic to canvas-layout.ts"
  - "Left ranksep (64) and offsetCascadePosition's CASCADE_STEP_PX (32) untouched - both are already 8-pt compliant and out of the reported symptom's path (rank-to-rank spacing and live-materialization cascade are not the vertical-stacking complaint)"

patterns-established:
  - "Node header differentiation lives entirely in fill opacity + decorative icon + one accent stripe - never in size/position math, per 26-UI-SPEC.md FIX-04"

requirements-completed: [FIX-04, POLISH-02]

# Metrics
duration: 8min
completed: 2026-07-06
---

# Phase 26 Plan 04: Node Chrome Differentiation + Canvas Layout Tuning Summary

**ChatNode gets a teal `border-l-primary` stripe + `MessageSquare` icon, GenuiPanelNode gets a lighter `bg-muted/40` header + `PanelsTopLeft` icon, and dagre's `nodesep` widened 32→64 so sibling genui-panels stop cramming into one vertical rank.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-06T21:26:35Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `ChatNode` and `GenuiPanelNode` (previously byte-identical shells) are now visually distinguishable at a glance: `ChatNode` carries the one new accent-allowlist member (`border-l-2 border-l-primary` + `MessageSquare` icon), `GenuiPanelNode` stays neutral with a lighter header fill (`bg-muted/40`) + `PanelsTopLeft` icon
- Dagre's same-rank `nodesep` widened from 32px to 64px so sibling genui-panels connected to the same chat node get real 8-pt breathing room instead of a cramped vertical column
- Node dimensions, drag-handle selector (`.node-drag-handle`), and selection ring (`ring-2 ring-primary ring-offset-1`) left completely unchanged — differentiation and layout tuning both stayed presentational/numeric, never touching persistence or registry contracts

## Task Commits

Each task was committed atomically:

1. **Task 1: Differentiate ChatNode vs GenuiPanelNode header chrome (FIX-04)** - `0d14be3` (feat)
2. **Task 2: Tune dagre auto-layout so sibling panels don't cram (POLISH-02)** - `4bc0a49` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/web/src/app/chat/_canvas/chat-node.tsx` - outer shell gains `border-l-2 border-l-primary`; header prepends a `MessageSquare` icon (`size-3 text-primary shrink-0 aria-hidden`) before the title; doc comment updated to note FIX-04 supersedes the prior "never special-case chat" shell clause
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` - header fill `bg-muted/60` → `bg-muted/40`; prepends a `PanelsTopLeft` icon (`size-3 text-muted-foreground shrink-0 aria-hidden`) before the "From turn {n}" caption (wrapped both in a `flex min-w-0 items-center gap-2` span so the existing `justify-between` streaming-dot layout is preserved); doc comment updated
- `apps/web/src/app/chat/_canvas/canvas-layout.ts` - `nodesep: 32` → `nodesep: 64` in the dagre graph config; added a comment explaining the POLISH-02 rationale (same-rank sibling gutter, not rank-to-rank spacing)

## Decisions Made
- Chose pure `nodesep` tuning over introducing a column-wrap cap for POLISH-02 — the plan explicitly offered both as options ("and/or"), and widening the existing same-rank gutter to the next 8-pt step (64) directly resolves the reported cramped-column symptom without adding new branching logic to the layout utility, keeping the change minimal and easy to verify via grep.
- Left `ranksep` (64) and `offsetCascadePosition`'s `CASCADE_STEP_PX` (32) untouched — both are already on the 8-pt scale and govern different concerns (rank-to-rank distance, and the live-materialization diagonal cascade) that are not the "cramped vertical column" complaint POLISH-02 targets.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their literal diff targets from 26-UI-SPEC.md's FIX-04/POLISH-02 sections.

## Issues Encountered

None. No dedicated `canvas-layout.test.ts` file exists in the repo (the plan's `<verify>` step referenced `npm run test -w @nauta/web -- canvas-layout`, which returns "No test files found"); per the hard-constraints instruction to "run the canvas vitest suites (use-canvas-persistence, panel-data-flow, canvas layout tests) after layout changes," ran the existing `use-canvas-persistence` (13 tests + 1 loop-regression test) and `panel-data-flow` (1 test) suites instead — all 15 tests pass, confirming the `nodesep` change doesn't affect saved-position round-trip or overlap-cascade logic (neither suite hardcodes a dagre-computed coordinate).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FIX-04 and POLISH-02 are the last two requirements assigned to Phase 26; all FIX-01..11 and POLISH-01/02 requirements are now covered across 26-01 through 26-04
- Visual verification (per plan's `<verification>` section: "on a fresh canvas with several panels, panels spread with 8-pt breathing room... ChatNode and GenuiPanelNode are distinguishable at a glance") is a UI-review item, not automated — deferred to the phase's checker/UI-review pass
- No blockers for Phase 27 (Adopted External Design Picks) or Phase 28 (Design-System Token Upgrades)

## Self-Check: PASSED

All modified files confirmed present on disk (chat-node.tsx, genui-panel-node.tsx,
canvas-layout.ts, this SUMMARY.md); all task/summary commit hashes (0d14be3, 4bc0a49,
3b69233) confirmed present in `git log --oneline --all`.

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*
