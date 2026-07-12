---
phase: 53-mobile-responsive-answer
plan: 05
subsystem: ui
tags: [react, nextjs, tailwind, radix-dialog, sheet, chat, dynamic-import, responsive]

# Dependency graph
requires:
  - phase: 53-mobile-responsive-answer
    provides: "53-01's useIsMobileViewport() hook (matchMedia(max-width:767px), SSR-safe false default) — the single shared mount/unmount signal this plan consumes as one of its two permitted 53-UI-SPEC consumers"
provides:
  - "/chat's ConversationView gates ChatCanvasIsland (the dynamic(ssr:false) React-Flow island) + ChatCanvasViewToggle on useIsMobileViewport() — below md the effective view mode is force-coerced to \"chat\", the toggle is conditionally unmounted (not merely CSS-hidden), and the island's dynamic import is never triggered"
  - "ConversationRail's mobile Sheet-collapse pattern (renderRailBody() shared-content extraction, mobileOpen/onMobileOpenChange lifted to ChatPage, dual-boolean top-bar toggle button) — the fourth application of this phase's Sheet-collapse-of-desktop-persistent-panel idiom (after AppSidebar, inbox, CanvasShell)"
affects: [49-live-loop-gate-deploy-oauth-real-email]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-boolean single-button toggle: one top-bar button (page.tsx's existing size-11 PanelLeft/PanelLeftClose control) flips BOTH railCollapsed (desktop Collapsible) and mobileRailOpen (mobile Sheet) on every click, with no extra useIsMobileViewport() read — only one boolean is ever visually relevant per viewport (CSS alone decides which), keeping ChatPage within 53-UI-SPEC's \"only 2 consumers this phase\" hook-usage budget"
    - "Conditional unmount (not CSS hidden md:flex) for a toggle whose presence itself is the affordance being removed — {!isMobile && <ChatCanvasViewToggle/>} guarantees the Chat/Canvas TabsList is provably absent from the DOM below md, not merely display:none, satisfying \"no user-facing way to request canvas mode\" literally rather than visually"
    - "Shared rail-body extraction (renderRailBody(handleSelect, wrapperClassName)) reused by both the desktop Collapsible and the mobile Sheet — avoids duplicating the New-chat button + ConversationRow list JSX while letting each caller supply a different onSelect (mobile's closes the Sheet too)"

key-files:
  created:
    - apps/web/src/app/chat/__tests__/chat-mobile-feed.test.tsx
  modified:
    - apps/web/src/app/chat/page.tsx
    - apps/web/src/app/chat/_components/conversation-rail.tsx
    - apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx
    - apps/web/src/app/chat/_components/chat-home-empty-state.tsx
    - apps/web/src/app/chat/_components/composer.tsx
    - apps/web/src/app/chat/_components/conversation-row.tsx
    - apps/web/src/app/chat/_components/cost-meter.tsx
    - apps/web/src/app/chat/_components/delete-conversation-dialog.tsx
    - apps/web/src/app/chat/_components/message-list.tsx
    - apps/web/src/app/chat/_components/model-picker.tsx

key-decisions:
  - "ChatCanvasViewToggle is conditionally rendered ({!isMobile && ...}), not wrapped in a hidden md:flex CSS class — the plan's acceptance criteria required the toggle to be literally absent from queryByLabelText/DOM queries under a mocked-true hook, which a CSS-only hidden class would NOT satisfy in jsdom (Tailwind's `hidden` class doesn't remove the node from the tree, only from paint in a real browser with the stylesheet loaded)"
  - "ChatPage's top-bar rail-toggle button flips railCollapsed AND mobileRailOpen together on every click rather than branching on viewport — avoids a third useIsMobileViewport() read in ChatPage (53-UI-SPEC caps this phase's mount-decision hook usage at exactly 2 consumers: ChatCanvasIsland's host and KnowledgeGraphIsland's host) while remaining behaviorally correct since only one boolean is ever visually relevant per breakpoint"
  - "conversation-rail.tsx's rail body (New-chat button + conversation list) is extracted into a renderRailBody(handleSelect, wrapperClassName) closure rather than duplicated literally — both the desktop CollapsibleContent and the mobile SheetContent call it with different onSelect wrappers (mobile's also closes the Sheet) and different wrapper widths (w-[280px] fixed vs w-full inside the Sheet)"

patterns-established:
  - "Fourth Sheet-collapse-of-desktop-persistent-panel instance this phase (AppSidebar's own internal mobile Sheet, 53-03's inbox rail via a different CSS-dual-tree mechanism, 53-04's CanvasShell LAYERS/INSPECTOR, now ConversationRail) — confirms Sheet(side, default w-3/4 sm:max-w-sm)/hidden md:block as the phase's settled idiom for \"a rail that must not compete with the main content column for width on a phone\""

requirements-completed: [MOBL-01]

# Metrics
duration: ~31min
completed: 2026-07-12
---

# Phase 53 Plan 05: /chat inline feed below md — canvas island never mounts, rail becomes overlay Sheet Summary

**`ConversationView` force-coerces below-`md` view mode to "chat" (island's `dynamic(ssr:false)` import never triggers, toggle conditionally unmounted) and `ConversationRail` renders inside a closed-by-default left overlay `Sheet` below `md` instead of a fixed-280px inline flex sibling — proven by a new 12-test `chat-mobile-feed.test.tsx`, plus 10 auto-fixed pre-existing files that were the first vitest suite to mount the full `/chat` render tree directly.**

## Performance

- **Duration:** ~31 min
- **Started:** 2026-07-12T02:51:00Z (approx., immediately following 53-04's close)
- **Completed:** 2026-07-12T03:22:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 13 (1 created, 12 modified)

## Accomplishments
- Below `md`, `/chat` is the inline feed: `ConversationView` reads `useIsMobileViewport()` and derives an `effectiveViewMode` that is ALWAYS `"chat"` on mobile regardless of the persisted/forced `viewMode` state — the `<ChatCanvasIsland>` JSX branch is never reached, so `next/dynamic`'s `ssr:false` React-Flow chunk is never requested (its init cost is never paid on a phone), not merely visually hidden
- `ChatCanvasViewToggle` is conditionally unmounted (`{!isMobile && ...}`) rather than CSS-hidden — there is no user-facing way to request canvas mode on a phone, and the Chat/Canvas `TabsList` is provably absent from the DOM (not just `display:none`)
- The persisted `chat:canvas-view:{id}` value is still READ on mount (`readStoredViewMode`) so returning to desktop restores the prior choice, but is never WRITTEN while mobile-forced (the only code path that calls `writeStoredViewMode` — the toggle's own `onChange` — is unreachable below `md`)
- `ConversationRail` becomes a left overlay `Sheet` (`side="left"`, default `w-3/4 sm:max-w-sm`, no override) below `md`, closed by default — a NEW `mobileOpen`/`onMobileOpenChange` boolean, separate from `collapsed` (which defaults rail-VISIBLE), lifted to `page.tsx`'s `ChatPage` so the existing top-bar `size-11` rail-toggle button drives both the desktop `railCollapsed` state and the mobile `mobileRailOpen` state on every click (no extra `useIsMobileViewport()` read needed — 53-UI-SPEC's "only 2 consumers this phase" budget preserved)
- Selecting a conversation from inside the mobile Sheet closes it (`handleMobileSelect` wraps `onSelect` with `onMobileOpenChange(false)`) — otherwise the full-overlay Sheet would hide the very conversation just chosen
- Desktop (`>=md`) behavior — canvas toggle, canvas island, inline `Collapsible` rail — is byte-identical; the desktop `Collapsible` tree is now wrapped in `hidden md:block` but its internals are untouched
- New `chat-mobile-feed.test.tsx` (12 tests): island-never-mounted-even-with-stored-canvas-preference, toggle-absent, docked-feed-renders, storage-read-not-written (Task 1); Sheet-closed-by-default, toggle-opens-Sheet, select-closes-Sheet, plus 2 source-string assertions (Task 2); desktop-regression pair (toggle present, island still mounts in canvas mode when hook mocked `false`)
- Found-live Rule 3 fix: `chat-mobile-feed.test.tsx` is the FIRST vitest suite to mount `ChatPage`'s full render tree directly (previously only individual leaf components/hooks were unit-tested in isolation) — exposed the same missing `import * as React from "react"` gotcha 53-03/53-04 already documented, across 10 files this time

## Task Commits

Each task was committed atomically:

1. **Task 1: Gate the canvas island + view toggle on useIsMobileViewport in page.tsx** - `623950b` (feat)
2. **Task 2: ConversationRail becomes a left overlay Sheet below md** - `e89d038` (feat)

**Plan metadata:** _pending — this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md updates committed next_

_Note: Both tasks were TDD (`tdd="true"` for Task 1; Task 2 extends the same test file per the plan's own instruction). Both tasks' test file and implementation were designed together in a single pass, then the resulting diff was split by hunk/file so each of the two commits above is independently typecheck-clean and test-green at its own boundary — Task 1's commit intentionally does NOT include `conversation-rail.tsx`'s Sheet changes or `page.tsx`'s `mobileRailOpen` wiring (verified standalone: 7/7 relevant tests green, typecheck clean, full `_canvas` suite green before committing); Task 2's commit adds exactly those hunks back plus the 5 additional rail-Sheet tests. This mirrors the RED-confirmed-live convention 53-01/53-03/53-04 established for the identical class of gotcha, applied here across a wider render tree since this is the first suite to mount `ChatPage` end-to-end._

## Files Created/Modified
- `apps/web/src/app/chat/page.tsx` - `ConversationView`: `useIsMobileViewport()` + `effectiveViewMode` derivation, conditional toggle unmount, `SaveStatusIndicator`/`ChatCanvasIsland` branches gated on `effectiveViewMode`. `ChatPage`: new `mobileRailOpen` state, top-bar toggle button flips both `railCollapsed` and `mobileRailOpen`, new `mobileOpen`/`onMobileOpenChange` props threaded to `ConversationRail`. Explicit `React` import (vitest gotcha).
- `apps/web/src/app/chat/_components/conversation-rail.tsx` - New `mobileOpen`/`onMobileOpenChange` props; extracted `renderRailBody(handleSelect, wrapperClassName)` shared by the desktop `Collapsible` (now wrapped `hidden md:block`, internals untouched) and a new `md:hidden` left `Sheet` (`SheetTitle` `sr-only`, `p-0` content padding override); `handleMobileSelect` closes the Sheet on row-select. Explicit `React` import (vitest gotcha).
- `apps/web/src/app/chat/__tests__/chat-mobile-feed.test.tsx` - New: 12 tests across 6 describe blocks — mobile-forced island-never-mounted/toggle-absent/docked-feed-renders/storage-read-not-written, desktop-regression toggle-present/island-still-mounts, page.tsx source-import assertion, mobile Sheet closed-by-default/toggle-opens/select-closes, and 2 conversation-rail.tsx source assertions. Mounts the real `ChatPage` default export; mocks `~/hooks/use-is-mobile-viewport` (mutable `let` for both mobile/desktop cases in one file), `../_canvas/chat-canvas-island` (spy), and `~/trpc/react`'s handful of direct query/mutation call sites as plain stubs.
- `apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/chat-home-empty-state.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/composer.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/conversation-row.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/cost-meter.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/delete-conversation-dialog.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/message-list.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).
- `apps/web/src/app/chat/_components/model-picker.tsx` - Explicit `React` import only (vitest gotcha, zero behavior change).

## Decisions Made
- Conditionally unmounting `ChatCanvasViewToggle` (`{!isMobile && ...}`) instead of CSS-hiding it with `hidden md:flex` — the plan's own acceptance criteria required the Chat/Canvas `TabsList` to be absent from `queryByLabelText`/DOM queries under a mocked-`true` hook; a CSS class alone doesn't remove the node from jsdom's tree (or satisfy "no user-facing way" as literally as an actual unmount does)
- The single top-bar rail-toggle button flips BOTH `railCollapsed` and `mobileRailOpen` on every click rather than branching on a viewport check — keeps ChatPage within 53-UI-SPEC's "only 2 `useIsMobileViewport()` consumers this phase" budget (`ChatCanvasIsland`'s host and `KnowledgeGraphIsland`'s host) since only one boolean is ever visually relevant per breakpoint (CSS decides which tree renders)
- Extracted `renderRailBody()` as a closure inside `ConversationRail` (not a separate component) — keeps the shared `conversations`/`isLoading`/`renamingId`/`deletingConversation` state and mutations in one place without prop-drilling a second component; both the desktop and mobile callers pass their own `onSelect`/wrapper-width but read the same underlying query data

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicit `React` import added to 10 files (vitest classic-runtime JSX gotcha)**
- **Found during:** Task 1 (first test run — `ReferenceError: React is not defined`, cascading through the full `ChatPage` render tree)
- **Issue:** `page.tsx`, `conversation-rail.tsx`, `conversation-row.tsx`, `delete-conversation-dialog.tsx`, `chat-home-empty-state.tsx`, `composer.tsx`, `model-picker.tsx`, `cost-meter.tsx`, `message-list.tsx`, and `chat-canvas-view-toggle.tsx` all compile fine under Next.js's SWC automatic JSX runtime (no `React` import needed) but crash under vitest's plain esbuild transform, which defaults to the classic runtime (`React.createElement`) and needs `React` explicitly in scope. This is the same pre-existing, already-documented gotcha `genui-panel-node.tsx`/53-03/53-04 carry — `chat-mobile-feed.test.tsx` is simply the FIRST vitest suite to mount `ChatPage`'s full tree end-to-end (previously only individual leaf hooks/components were unit-tested in isolation), so it's the first to trip over it for these 10 files.
- **Fix:** Added `import * as React from "react";` with the same explanatory comment convention, to all 10 files.
- **Files modified:** listed above under Files Created/Modified.
- **Verification:** `chat-mobile-feed.test.tsx` green (12/12); full `_canvas` regression suite green (28 files/216 tests); full web suite reconfirmed green (59 files/400 tests, up from 58/388 at 53-04's close); `npm run typecheck -w @polytoken/web` clean outside the pre-existing, documented `app/dev/design/**` exclusion.
- **Committed in:** `623950b` (Task 1, 9 of the 10 files) and `e89d038` (Task 2, `conversation-rail.tsx`'s fix — bundled with its own Sheet changes since that file's React-import fix was authored together with the rest of Task 2's diff).

---

**Total deviations:** 1 auto-fixed (blocking/Rule 3, spanning 10 files)
**Impact on plan:** The fix was a necessary consequence of this plan's own test being the first to exercise `ChatPage`'s complete render tree under vitest — no scope creep, no unrelated changes, identical fix shape to 53-03/53-04's precedent.

## Issues Encountered
None beyond the deviation above, resolved within the fix-attempt limit (1 attempt, discovered incrementally file-by-file as each successive mount error surfaced).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MOBL-01's `/chat` half is now complete: the canvas island never mounts below `md`, no canvas-mode affordance exists there, and the rail no longer squeezes the chat column to ~80px at 360px — MOBL-01 also covers `/knowledge`'s mobile list + detail sheet (Component Inventory §3), which is a separate, not-yet-executed plan in this phase's remaining wave
- Full web test suite reconfirmed green (59 files/400 tests, up from 58/388 at 53-04's close); typecheck clean outside the pre-existing, documented `app/dev/design/**` exclusion; palette-ban/token-contrast/token-registration gates green
- Live 360/768/1024 confirmation (feed below `md`, canvas at/above `md`, rail overlay behavior) remains DEFERRED to `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md` §G per this plan's own `<verification>` block — not faked as passed. A Playwright viewport spec was NOT authored this session (not required by this plan's acceptance criteria; the plan explicitly scoped live-viewport work out)
- `renderRailBody()`'s shared-content-extraction shape and the dual-boolean single-button toggle pattern are available as reference shapes for any future rail/panel that needs an identical desktop-persistent/mobile-Sheet split without a third `useIsMobileViewport()` read

## Self-Check: PASSED

- FOUND: `apps/web/src/app/chat/page.tsx` (modified, contains `useIsMobileViewport`)
- FOUND: `apps/web/src/app/chat/_components/conversation-rail.tsx` (modified, contains `side="left"` and `hidden md:block`)
- FOUND: `apps/web/src/app/chat/__tests__/chat-mobile-feed.test.tsx`
- FOUND commit `623950b` in `git log --oneline`
- FOUND commit `e89d038` in `git log --oneline`

---
*Phase: 53-mobile-responsive-answer*
*Completed: 2026-07-12*
