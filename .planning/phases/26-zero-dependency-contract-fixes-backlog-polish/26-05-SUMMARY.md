---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 05
subsystem: ui
tags: [tailwind, react-flow, radix-scroll-area, css-layer, chat]

# Dependency graph
requires:
  - phase: 26-01..04
    provides: FIX-02/03/04/06/07/08 token-discipline fixes already landed on the same surfaces
provides:
  - "@layer components react-flow chrome (.react-flow__controls/-button/-minimap/-attribution) in globals.css"
  - "@layer utilities .scrollbar-token CSS (10px thumb, bg-border, rounded-full) replicating the ScrollArea aesthetic for native elements"
  - "chat-canvas Background/MiniMap token SVG-fill props (hsl(var(--border))/--background/--muted-foreground)"
  - "markdown-renderer Pre + Table wrapped in Radix ScrollArea (orientation=horizontal)"
  - "composer full-width dock band (border-t + shadow-sm) + scrollbar-token textarea"
affects: [27-adopted-external-design-picks, 28-design-system-token-upgrades]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Token-consuming @layer components/utilities blocks appended after :root/.dark in globals.css, never touching existing custom-property declarations"
    - "React Flow SVG-fill props (color/maskColor/nodeColor/nodeStrokeColor) set inline via hsl(var(--token)) since they are props, not CSS classes"
    - "Native-scroll elements that cannot host Radix ScrollArea (native <textarea>) get .scrollbar-token instead"

key-files:
  created: []
  modified:
    - apps/web/src/app/globals.css
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
    - apps/web/src/app/chat/_components/markdown-renderer.tsx
    - apps/web/src/app/chat/_components/composer.tsx

key-decisions:
  - "Used the ScrollArea/ScrollBar wrap for markdown Pre/Table (not the .scrollbar-token fallback) — Radix's own ScrollAreaViewport wraps children in a `display:table; min-width:100%` inner div, so horizontal overflow and natural (non-collapsing) height both work without the fallback; typecheck + build + the full markdown-renderer vitest suite all pass with the primary approach"

requirements-completed: [FIX-01, FIX-09, FIX-10]

# Metrics
duration: 18min
completed: 2026-07-06
---

# Phase 26 Plan 05: React Flow Token Chrome, Composer Dock, Scrollbar Unification Summary

**Token-colored React Flow Controls/MiniMap/Background chrome, a full-width composer dock band, and one Radix-ScrollArea-matching scrollbar aesthetic across every native-scroll spot on `/chat` — zero new npm dependencies, zero token-value changes.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-06T21:22:00Z
- **Completed:** 2026-07-06T21:40:00Z
- **Tasks:** 3 completed
- **Files modified:** 4

## Accomplishments
- React Flow's stock light-gray chrome now reads from the app's existing `border`/`card`/`muted`/`foreground`/`background` tokens in both light and dark mode (Controls via new CSS, Background/MiniMap via inline `hsl(var(--...))` props)
- Composer wraps its existing centered row in a new full-width `border-t border-border/60 bg-background shadow-sm` band so it visually reads as a docked surface across the entire viewport width, not just the centered column
- Every native-scroll spot on `/chat` (composer textarea, markdown fenced-code blocks, markdown tables) now matches the Radix `ScrollArea` thumb aesthetic — textarea via a new `.scrollbar-token` CSS utility (native elements can't host Radix `ScrollArea`), markdown Pre/Table via actual `ScrollArea`/`ScrollBar` wraps

## Task Commits

Each task was committed atomically:

1. **Task 1: Add React Flow chrome + scrollbar-token CSS to globals.css** - `01a0464` (feat)
2. **Task 2: chat-canvas Background/MiniMap props + markdown ScrollArea wrappers** - `70a2df6` (feat)
3. **Task 3: Composer dock band + scrollbar-token textarea** - `e8d5c6c` (feat)

_No TDD tasks in this plan (CSS/presentational-prop plan, no `tdd="true"` tasks)._

## Files Created/Modified
- `apps/web/src/app/globals.css` - New `@layer components` block for `.react-flow__controls`/`-controls-button`/`-controls-button:hover`/`-controls-button svg`/`-minimap`/`-attribution`; new `@layer utilities` `.scrollbar-token` (thin scrollbar-width/scrollbar-color + `::-webkit-scrollbar*` rules). No `:root`/`.dark` custom-property line added, changed, or removed (grep-verified 55 == 55 against the pre-plan baseline).
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx` - `<Background>` gets `color="hsl(var(--border))"`; conditional `<MiniMap>` gets `maskColor`/`nodeColor`/`nodeStrokeColor` token props (kept `pannable zoomable`). `<Controls>` props untouched — its look comes entirely from Task 1's CSS.
- `apps/web/src/app/chat/_components/markdown-renderer.tsx` - Added `import { ScrollArea, ScrollBar } from "@nauta/ui/scroll-area"`; `Pre` and `Table` components now wrap their content in `<ScrollArea>`/`<ScrollBar orientation="horizontal" />` instead of a plain `overflow-x-auto` div.
- `apps/web/src/app/chat/_components/composer.tsx` - Outer return wrapped in a new `<div className="w-full shrink-0 border-t border-border/60 bg-background shadow-sm">`; inner row keeps `mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-4` with Textarea/Button unchanged except Textarea class gains `scrollbar-token`.

## Decisions Made
- Chose the Radix `ScrollArea` wrap over the `.scrollbar-token` CSS fallback for markdown Pre/Table: confirmed via `node_modules/@radix-ui/react-scroll-area`'s `ScrollAreaViewport` source that Radix already wraps children in an inner `display:table; min-width:100%` div, which lets a wide `<pre>`/`<table>` overflow horizontally and lets the viewport size to natural content height (no fixed-height container needed) — the exact concern the plan's fallback clause anticipated. Verified via typecheck, full production build, and the existing `markdown-renderer.test.tsx` suite (5/5 passing) rather than introducing the CSS-only fallback.

## Deviations from Plan

None - plan executed exactly as written. All three tasks match the plan's literal diff targets (identical class strings/props to `26-UI-SPEC.md` FIX-01/FIX-09/FIX-10 and the plan's `<action>` blocks).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three `<must_haves><truths>` verified: Controls/MiniMap/Background render with token vars (light+dark, since all values are `hsl(var(--token))`/`hsl(var(--token) / opacity)` which resolve per-mode); composer reads as a full-width dock band; every native-scroll spot on `/chat` (composer textarea, markdown Pre, markdown Table) matches the ScrollArea aesthetic (2 via actual ScrollArea, 1 via the token-matched CSS fallback for the native `<textarea>`).
- No token VALUE in `globals.css` was added, changed, or removed (grep-gated at 55 == 55, both immediately post-Task-1 and against the pre-plan `HEAD~3` baseline) — Phase 28 (design-system token upgrades) is unblocked and starts from an unmodified token layer.
- `packages/genui/src/renderer/spec-renderer.tsx`, `GenuiPartBoundary`, `InteractiveWidgetBoundary` untouched (hard constraint honored — no edits in this plan touched genui internals).
- Full `npm run build -w @nauta/web` and `npm run typecheck -w @nauta/web` both exit 0; all 19 web vitest test files (151 tests) pass, including the chat-scoped suites (`markdown-renderer.test.tsx`, canvas/panel/edge suites).
- This was the last plan in Phase 26's wave-1 set that touches `globals.css`/`chat-canvas.tsx`/`markdown-renderer.tsx`/`composer.tsx` per the phase's file-ownership split — no other 26-0X plan should re-touch these four files.

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*
