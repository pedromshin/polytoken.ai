---
phase: 53-mobile-responsive-answer
plan: 06
subsystem: ui
tags: [react, nextjs, tailwind, radix-dialog, sheet, knowledge, dynamic-import, responsive]

# Dependency graph
requires:
  - phase: 53-mobile-responsive-answer
    provides: "53-01's useIsMobileViewport() hook (matchMedia(max-width:767px), SSR-safe false default) — the second and final permitted 53-UI-SPEC mount/unmount consumer this phase"
provides:
  - "/knowledge's KnowledgeSurface client wrapper: below md renders KnowledgeMobileList (self-fetching filter-chip bar + node list + empty states + full-width detail Sheet), at/above md renders KnowledgeGraphIsland unchanged — the dynamic(ssr:false) React-Flow graph is never mounted on a phone"
  - "filter-rail.tsx's NODE_TYPE_ROWS exported as the single source of node-type facet data (label + dotClass), reused verbatim by both desktop FilterRail and KnowledgeMobileList"
  - "NodeDetailPane's internal close X suppressed below md (hidden md:inline-flex) so a Sheet host never shows two close affordances — reusable pattern for any future mobile Sheet wrapping this component"
affects: [49-live-loop-gate-deploy-oauth-real-email]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-fetching mobile presentation component — KnowledgeMobileList calls api.knowledge.graph.useQuery itself (rather than lifting state from the desktop KnowledgeGraph) since the two presentations never mount simultaneously, avoiding a shared-state refactor across the md boundary"
    - "Facet-array-as-single-source-of-truth: NODE_TYPE_ROWS exported once from filter-rail.tsx; KnowledgeMobileList derives its dotClassFor/typeLabelFor lookups FROM that array (Map built once at module scope) rather than re-declaring a second vocabulary"
    - "hidden md:inline-flex to suppress a component-owned close control when it renders inside a Sheet that ships its own corner close — fourth Sheet-collapse-family fix this phase (AppSidebar, inbox, CanvasShell, ConversationRail all precede it; this one suppresses a NESTED control instead of collapsing a whole panel)"

key-files:
  created:
    - apps/web/src/app/knowledge/_components/knowledge-mobile-list.tsx
    - apps/web/src/app/knowledge/_components/knowledge-surface.tsx
    - apps/web/src/app/knowledge/_components/__tests__/knowledge-mobile-list.test.tsx
  modified:
    - apps/web/src/app/knowledge/_components/filter-rail.tsx
    - apps/web/src/app/knowledge/_components/node-detail-pane.tsx
    - apps/web/src/app/knowledge/page.tsx

key-decisions:
  - "KnowledgeMobileList derives includeInstances/includeEmails from visibleTypes only (no showInstances override) — the desktop-only 'Show all instances' Switch has no mobile equivalent in 53-UI-SPEC §3, so the mobile derivation intentionally omits that one input while matching knowledge-graph.tsx's flag logic otherwise"
  - "Added a GraphErrorState branch to KnowledgeMobileList (not explicitly named in 53-UI-SPEC §3's empty-state table, which only covers filtered-to-zero and genuinely-empty-graph) — a self-fetching component that renders nothing on query error would be a blank screen; reusing the already-imported, already-designed GraphErrorState is a Rule 2 (missing critical functionality) addition, zero new vocabulary"
  - "SheetTitle (sr-only) added to the detail Sheet though not spelled out in the plan's action text — matches the established Sheet-collapse convention this phase (ConversationRail, CanvasShell's Layers/Inspector) and satisfies Radix Dialog's accessible-title requirement"

patterns-established:
  - "Both of Phase 53's permitted useIsMobileViewport() mount/unmount consumers are now spent (ChatCanvasIsland's host in 53-05, KnowledgeGraphIsland's host here) — 53-UI-SPEC's 'only 2 consumers this phase' hook-usage budget is fully accounted for; any future graph/canvas island needs its own design conversation about a third consumer"

requirements-completed: [MOBL-01]

# Metrics
duration: ~25min
completed: 2026-07-12
---

# Phase 53 Plan 06: /knowledge mobile list + full-width detail Sheet — graph island never mounts below md Summary

**`KnowledgeSurface` branches `/knowledge` on `useIsMobileViewport()`: below `md` a self-fetching `KnowledgeMobileList` (h-11 filter chips reusing `filter-rail.tsx`'s exact `NODE_TYPE_ROWS`, min-h-16 rows, empty states) with tap-through into the unchanged `NodeDetailPane` inside a full-width right `Sheet`; the `dynamic(ssr:false)` React-Flow `KnowledgeGraphIsland` is never mounted on a phone — closing MOBL-01's second and final half.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-12T03:40:00Z (approx.)
- **Completed:** 2026-07-12T04:05:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Below `md`, `/knowledge` is a real node list: `KnowledgeMobileList` self-fetches `api.knowledge.graph.useQuery`, renders an `h-11` horizontal filter-chip bar (`role="group" aria-label="Filter by type"`, one pill per `filter-rail.tsx`'s now-exported `NODE_TYPE_ROWS` entry, active recipe `border-primary/30 bg-primary/10 text-primary` reused verbatim), and `min-h-16` `InboxRow`-idiom node rows below it
- `KnowledgeGraphIsland` (the `dynamic(ssr:false)` React-Flow wrapper) is NEVER mounted below `md` — `knowledge-surface.tsx` is the client-wrapper seam (`page.tsx` stays a server component owning `metadata`) that branches on `useIsMobileViewport()`, proven by a mocked-module spy assertion (not a DOM query) matching `/chat`'s 53-05 precedent exactly
- Tapping a row opens the unchanged `NodeDetailPane` inside a full-width right `Sheet` (`side="right"` `w-full sm:max-w-full p-0`); `NodeDetailPane`'s own internal close `X` now carries `hidden md:inline-flex` so exactly ONE close affordance shows inside the mobile Sheet (the Sheet's own corner `X`), while desktop keeps `NodeDetailPane`'s own close exactly as before
- Two empty states: filtered-to-zero renders the exact copy "No nodes match your filters — try showing another type."; a genuinely empty/no-schema graph reuses `GraphNoSchemaState` verbatim — plus a found-live Rule 2 addition (query error reuses `GraphErrorState` verbatim, not named in the UI-SPEC's empty-state table but necessary since this is now a self-fetching component)
- Desktop (`>=md`) `/knowledge` graph is byte-identical: `KnowledgeGraphIsland` still renders with `absolute inset-0`, `FilterRail`/`NodeDetailPane`'s only change is the internal close button's added `hidden md:inline-flex` (additive at `>=md`, since `md:inline-flex` restores exactly the prior always-visible behavior)
- New `knowledge-mobile-list.test.tsx` (8 tests): graph-island-never-mounted, chips/rows render, filter-toggle changes visible rows, row-tap opens the detail Sheet with `NodeDetailPane` content, desktop-regression pair (island mounts, mobile list absent), plus 2 source-string assertions (node-detail-pane's `hidden md:inline-flex`, page.tsx renders `KnowledgeSurface` and stays server-component)

## Task Commits

Each task was committed atomically:

1. **Task 1: Export filter facets and build KnowledgeMobileList** - `0ddfcb8` (feat)
2. **Task 2: Branch the knowledge surface on the hook + suppress the redundant detail close** - `51fa0fd` (feat)

**Plan metadata:** _pending — this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md updates committed next_

_Note: Task 2 was TDD (`tdd="true"`). `knowledge-surface.tsx` was temporarily moved aside after being written so `knowledge-mobile-list.test.tsx` could RED-confirm live (`Failed to resolve import "../knowledge-surface"`) before being restored for GREEN — same "RED confirmed live" convention 53-01/53-05 established, applied here by relocating the already-drafted implementation file rather than deferring its authorship, since Task 2's action text bundles `knowledge-surface.tsx` + `page.tsx` + `node-detail-pane.tsx` into one task boundary. Both task commits are independently typecheck-clean and test-green at their own boundary._

## Files Created/Modified
- `apps/web/src/app/knowledge/_components/filter-rail.tsx` - `NODE_TYPE_ROWS` changed from module-private to `export const` (zero other changes) — the single source of node-type facet data both `FilterRail` and `KnowledgeMobileList` consume
- `apps/web/src/app/knowledge/_components/knowledge-mobile-list.tsx` - New: self-fetching `KnowledgeMobileList` — `h-11` filter-chip bar, `min-h-16` node-list rows, filtered/genuinely-empty/error states, full-width right `Sheet` wrapping `NodeDetailPane`. `dotClassFor`/`typeLabelFor` helpers built from `NODE_TYPE_ROWS` (never a second vocabulary)
- `apps/web/src/app/knowledge/_components/knowledge-surface.tsx` - New: `"use client"` wrapper reading `useIsMobileViewport()`; renders `KnowledgeMobileList` below `md`, `KnowledgeGraphIsland` (unchanged, `absolute inset-0`) at/above `md`
- `apps/web/src/app/knowledge/_components/node-detail-pane.tsx` - Internal close `Button`'s className gains `hidden md:inline-flex` (plus explanatory comment); explicit `import * as React from "react"` (vitest classic-runtime JSX gotcha, this suite is the first to mount `NodeDetailPane` directly)
- `apps/web/src/app/knowledge/page.tsx` - Renders `<KnowledgeSurface />` instead of `<KnowledgeGraphIsland className="absolute inset-0" />` directly; doc comment updated; stays a server component with `metadata` intact
- `apps/web/src/app/knowledge/_components/__tests__/knowledge-mobile-list.test.tsx` - New: 8 tests across 4 describe blocks, mounts the real `KnowledgeSurface` default export; mocks `~/hooks/use-is-mobile-viewport` (mutable `let`), `../knowledge-graph-island` (spy), and `~/trpc/react`'s `api.knowledge.graph.useQuery` (2 fake nodes: one `entity_type`, one `entity_type_field`, matching `DEFAULT_VISIBLE_TYPES`)

## Decisions Made
- `KnowledgeMobileList` derives `includeInstances`/`includeEmails` from `visibleTypes` only, omitting the desktop-only `showInstances` override switch — 53-UI-SPEC §3 names no mobile equivalent for that control, and the mobile filter-chip bar already gives direct per-type control
- Added a `GraphErrorState` branch (reused verbatim, already imported for `GraphNoSchemaState`) — not named in the UI-SPEC's empty-state table, but a self-fetching component silently rendering nothing on a query error would be a blank screen; Rule 2 (missing critical functionality)
- Added `SheetTitle` (`sr-only`, the node's label or "Node details") to the detail Sheet — not spelled out in the plan's action text, but matches every other Sheet this phase (`ConversationRail`, `CanvasShell`'s Layers/Inspector) and satisfies Radix Dialog's accessible-title requirement
- Temporarily relocated the already-written `knowledge-surface.tsx` to confirm RED live (rather than deferring its authorship past the test), since Task 2's action bundles three files' worth of implementation with one test file — restored immediately after RED was observed, then GREEN-verified

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicit `React` import added to `node-detail-pane.tsx` (vitest classic-runtime JSX gotcha)**
- **Found during:** Task 2 (first `knowledge-mobile-list.test.tsx` run after restoring `knowledge-surface.tsx` — `ReferenceError: React is not defined` when a row-click mounted `NodeDetailPane` inside the Sheet)
- **Issue:** `node-detail-pane.tsx` compiles fine under Next.js's SWC automatic JSX runtime but crashes under vitest's esbuild classic-runtime transform, which needs `React` explicitly in scope. Same pre-existing, already-documented gotcha 53-01/53-03/53-04/53-05 fixed elsewhere — this suite is simply the first to mount `NodeDetailPane` directly (prior tests exercised `knowledge-graph.tsx`'s standalone `promoteEdge` helper, never the component tree).
- **Fix:** Added `import * as React from "react";` to `node-detail-pane.tsx`.
- **Files modified:** `apps/web/src/app/knowledge/_components/node-detail-pane.tsx`
- **Verification:** `knowledge-mobile-list.test.tsx` green (8/8); full web suite reconfirmed green (60 files/408 tests, up from 59/400 at 53-05's close); `npm run typecheck -w @polytoken/web` clean outside the pre-existing, documented `app/dev/design/**` exclusion.
- **Committed in:** `51fa0fd` (Task 2)

**2. [Rule 1 - Bug] Own test assertion false-positived on prose text, not the directive**
- **Found during:** Task 2 (GREEN run — `stays a server component with metadata intact` failed: `PAGE_SOURCE` legitimately contains the phrase `"use client"` inside `knowledge/page.tsx`'s own doc comment describing `KnowledgeSurface`)
- **Issue:** The test's `not.toContain('"use client"')` assertion matched the substring anywhere in the file, including prose, not just the literal directive line.
- **Fix:** Changed the assertion to `not.toMatch(/^"use client";?$/m)` — checks the directive as its own line, not the phrase anywhere in the file.
- **Files modified:** `apps/web/src/app/knowledge/_components/__tests__/knowledge-mobile-list.test.tsx`
- **Verification:** Test passes; `page.tsx` correctly confirmed to remain a server component (no `"use client"` directive at file scope).
- **Committed in:** `51fa0fd` (Task 2)

---

**Total deviations:** 2 auto-fixed (1 blocking/Rule 3, 1 bug/Rule 1 in the plan's own new test file)
**Impact on plan:** Both fixes were necessary consequences of this plan's own test being the first to mount `NodeDetailPane` end-to-end and the first to source-assert `page.tsx`'s server-component boundary — no scope creep, no unrelated changes.

## Issues Encountered
None beyond the deviations above, resolved within the fix-attempt limit (1 attempt each, both found on the first GREEN run).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MOBL-01 is now fully complete: `/chat`'s inline feed (53-05) and `/knowledge`'s mobile list + detail sheet (this plan) both gate their React-Flow islands on `useIsMobileViewport()`, and both of 53-UI-SPEC's permitted hook consumers are spent — no future Phase-53 plan should add a third
- Phase 53 (Mobile-Responsive Answer) is now 6/6 plans complete (53-01..53-06 all have a SUMMARY.md)
- Full web test suite reconfirmed green (60 files/408 tests, up from 59/400 at 53-05's close); typecheck clean outside the pre-existing, documented `app/dev/design/**` exclusion; palette-ban/token-contrast/token-registration gates green (10/10 across the two dedicated gate files)
- Live 360/768/1024 confirmation (list below `md`, graph at/above `md`, full-width detail sheet, single close affordance) remains DEFERRED to `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md` §G per this plan's own `<verification>` block — not faked as passed. A Playwright viewport spec was NOT authored this session (not required by this plan's acceptance criteria).
- `dotClassFor`/`typeLabelFor`-built-from-a-single-exported-array is a reusable shape for any future mobile presentation that needs to re-derive a desktop component's facet vocabulary without duplicating it

## Self-Check: PASSED

- FOUND: `apps/web/src/app/knowledge/_components/knowledge-mobile-list.tsx`
- FOUND: `apps/web/src/app/knowledge/_components/knowledge-surface.tsx`
- FOUND: `apps/web/src/app/knowledge/_components/__tests__/knowledge-mobile-list.test.tsx`
- FOUND: `apps/web/src/app/knowledge/_components/filter-rail.tsx` (modified, `export const NODE_TYPE_ROWS` confirmed)
- FOUND: `apps/web/src/app/knowledge/_components/node-detail-pane.tsx` (modified, `hidden md:inline-flex` confirmed)
- FOUND: `apps/web/src/app/knowledge/page.tsx` (modified, renders `KnowledgeSurface` confirmed)
- FOUND commit `0ddfcb8` in `git log --oneline`
- FOUND commit `51fa0fd` in `git log --oneline`

---
*Phase: 53-mobile-responsive-answer*
*Completed: 2026-07-12*
