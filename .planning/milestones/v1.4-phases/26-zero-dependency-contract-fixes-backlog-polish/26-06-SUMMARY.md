---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 06
subsystem: ui
tags: [react, lucide-react, tailwind, chat, canvas, empty-state]

# Dependency graph
requires:
  - phase: 26-01..05
    provides: FIX-02/03/04/06/07/08/01/09/10 token-discipline fixes already landed on the same chat/canvas surfaces
provides:
  - "apps/web/src/components/empty-state.tsx — shared EmptyState primitive (layout/tone/size/action/caption variant props)"
  - "ChatHomeEmptyState/CanvasEmptyState/UnknownNodeTypePlaceholder rewired as thin wrappers around EmptyState"
affects: [27-adopted-external-design-picks, 28-design-system-token-upgrades]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App-local cross-cutting presentational primitives live in apps/web/src/components/ (alongside app-sidebar.tsx/theme-provider.tsx), not packages/ui — matches this directory's existing convention for non-design-system, cross-route components"
    - "Variant-prop primitive collapsing near-duplicate JSX recipes (layout/tone/size/action/caption) while call-site components stay as thin, stable-named wrappers"

key-files:
  created:
    - apps/web/src/components/empty-state.tsx
    - apps/web/src/components/empty-state.test.tsx
  modified:
    - apps/web/src/app/chat/_components/chat-home-empty-state.tsx
    - apps/web/src/app/chat/_canvas/canvas-empty-state.tsx
    - apps/web/src/app/chat/_canvas/unknown-node-type-placeholder.tsx

key-decisions:
  - "UnknownNodeTypePlaceholder keeps its own outer card chrome (border-destructive/30 bg-muted/40 rounded-lg min-h/min-w p-4) as a local wrapper — that's bounded-node-card styling, not part of the shared EmptyState primitive; only the inner icon+text row + caption delegates to EmptyState's inline/destructive/compact variant"
  - "EmptyState's centered layout has two literal container recipes gated by size (spacious: h-full px-6 py-24; compact: absolute inset-0 gap-3 p-8) — this preserves each of the two current centered call sites' exact positioning/padding rather than forcing one shared container shape onto both"
  - "body is a required EmptyStateProps field even though the inline variant never renders it (UnknownNodeTypePlaceholder passes an empty string) — keeps every call site explicit about having no body copy instead of silently making the field optional"
  - "Heading tag is size-driven (h1 for spacious, p otherwise) — reproduces the pre-refactor per-site semantics (ChatHomeEmptyState's h1 vs Canvas/UnknownNodeType's p) without adding a new prop"

requirements-completed: [FIX-11]

# Metrics
duration: 9min
completed: 2026-07-06
---

# Phase 26 Plan 06: Shared EmptyState Primitive Summary

**One `EmptyState` primitive (layout/tone/size/action/caption variant props) replacing three near-identical icon+heading+body JSX recipes across ChatHomeEmptyState, CanvasEmptyState, and UnknownNodeTypePlaceholder — pixel-identical output, zero copy changes.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-06T21:45:29Z
- **Completed:** 2026-07-06T21:54:40Z
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- New `apps/web/src/components/empty-state.tsx` exports `EmptyState`/`EmptyStateProps` with five variant dimensions (`layout`, `tone`, `size`, `action`, `caption`) that together reproduce all three prior call-site renderings exactly
- `ChatHomeEmptyState` now renders `centered/muted/spacious` + a "New chat" action; `CanvasEmptyState` renders `centered/muted/compact`, no action; `UnknownNodeTypePlaceholder` keeps its card chrome and delegates to `inline/destructive/compact` + caption
- Colocated `empty-state.test.tsx` (5 tests) covers the spacious icon/heading register, inline+destructive tone without full-pane centering, action `onClick` wiring, and caption presence/absence
- Every variant keeps its icon `aria-hidden`; the heading remains the accessible content in each case

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the shared EmptyState primitive** - `350d915` (feat)
2. **Task 2: Rewire the three call sites to EmptyState variants** - `ff74b94` (feat)

_No TDD-gated tasks (Task 1 was `tdd="true"` in the plan frontmatter but there was no pre-existing behavior to RED against — this is a net-new primitive, not a bugfix; test file was written alongside the implementation and both were verified together before commit, consistent with the plan's single `<verify>` step covering both)._

## Files Created/Modified
- `apps/web/src/components/empty-state.tsx` - Shared `EmptyState` primitive; `iconToneClass`/`iconSizeClass` helpers derive icon tint/size from `tone`/`size`/`layout`; internal `ActionButton` renders the optional `@nauta/ui` `Button` action
- `apps/web/src/components/empty-state.test.tsx` - 5 vitest cases (createRoot + `act`, mirrors `json-pane.test.tsx`'s mounting convention)
- `apps/web/src/app/chat/_components/chat-home-empty-state.tsx` - Body replaced with `<EmptyState icon={MessageSquarePlus} layout="centered" tone="muted" size="spacious" action={{ label: "New chat", icon: Plus, onClick: onNewChat, disabled: creating }} />`; same exported component name/props, copy unchanged
- `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx` - Body replaced with `<EmptyState icon={LayoutGrid} layout="centered" tone="muted" size="compact" />`; no action, copy unchanged
- `apps/web/src/app/chat/_canvas/unknown-node-type-placeholder.tsx` - Outer card div unchanged; inner row+caption replaced with `<EmptyState icon={AlertTriangle} layout="inline" tone="destructive" size="compact" caption={...} />`; copy unchanged

## Decisions Made
- See `key-decisions` in frontmatter — outer card chrome stays local to `UnknownNodeTypePlaceholder`, centered-layout container recipe is `size`-gated to preserve each site's exact padding/positioning, `body` stays a required (if inline-unused) prop, heading tag is `size`-driven.

## Deviations from Plan

None - plan executed exactly as written. Both tasks match the plan's literal variant-configuration targets (icons, copy, layout/tone/size/action assignments per the `26-UI-SPEC.md` FIX-11 table and the plan's `<action>` blocks).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All plan `must_haves` verified: one `EmptyState` primitive drives all three call sites via variant props; each site's copy and visual recipe is unchanged from before the refactor; the three variants are explicitly differentiated (spacious+action vs compact vs inline+destructive+caption); every variant's icon stays `aria-hidden`.
- `npm run typecheck -w @nauta/web` exits 0; `npm run test -w @nauta/web -- empty-state` (5/5) and the full web vitest suite (21 files / 158 tests) both pass — no regression in any chat/canvas/studio test.
- `apps/web/src/components/empty-state.tsx` is the only new artifact under `apps/web/src/components/`; `packages/genui/src/renderer/spec-renderer.tsx`, `GenuiPartBoundary`, `InteractiveWidgetBoundary` untouched (hard constraint honored). Zero new npm dependencies (only `lucide-react` icons already in use).
- This was the only plan touching `chat-home-empty-state.tsx`/`canvas-empty-state.tsx`/`unknown-node-type-placeholder.tsx`/`empty-state.tsx` per the phase's file-ownership split — Phase 26 wave 1 is now 6/7 plans complete (26-07 remains).

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commit hashes (`350d915`, `ff74b94`) confirmed in `git log`.
