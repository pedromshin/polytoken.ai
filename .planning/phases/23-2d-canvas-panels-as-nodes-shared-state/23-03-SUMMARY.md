---
phase: 23-2d-canvas-panels-as-nodes-shared-state
plan: 03
subsystem: web-ui, canvas, chat
tags: [react-flow, dagre, canvas, chat, streaming, view-toggle, a11y]

# Dependency graph
requires:
  - phase: 23-2d-canvas-panels-as-nodes-shared-state
    plan: 02
    provides: NODE_TYPE_REGISTRY/resolveNodeType, GenuiPanelNode, CanvasSpecProvider/useCanvasSpec, node.data Zod boundary (provenance-only)
provides:
  - useConversationController — lifted streaming/turn/webllm state shared by the docked Chat view AND the canvas ChatNode (D-02 — one instance, never re-instantiated on view switch)
  - ChatNode — canvas custom node reusing MessageList/Composer/GeneratingIndicator, driven by the shared controller via ChatControllerContext
  - nodeTypes module-level map {chat, genui-panel} + resolveNodeComponent (unknown -> placeholder)
  - layoutCanvasNodes/offsetCascadePosition — dagre LR auto-placement + cascade fallback (D-03)
  - ChatCanvas/ChatCanvasIsland — the mounted React Flow surface (dynamic ssr:false) + ChatCanvasViewToggle (Chat<->Canvas, localStorage per conversation)
affects: [23-04, 23-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ChatControllerContext (chat-node.tsx) — React Flow's NodeProps only ever carries {data, selected, ...}, so a shared cross-view instance (useConversationController) that can't live in node.data (D-05/D-07) is threaded through React context instead, mirroring CanvasSpecContext's seam shape from 23-02"
    - "vitest had no '~/*' path alias configured (only tsconfig.json's `paths` had it) — any test importing a module reaching '~/trpc/react' failed to resolve under vite; fixed once in vitest.config.ts via `resolve.alias`, unblocking all future _hooks/_canvas tests that import trpc-touching modules"
    - "Keyboard pan/zoom/fitView fallback is scoped to fire ONLY when `event.target === event.currentTarget` on the canvas container — this is the safe reading of the UI-SPEC's own 'when canvas has focus (not inside a specific node)' qualifier, preventing a hijack when the user types +/arrow keys into a node's composer or a genui panel's form controls"
    - "New-panel fade-in (`motion-safe:animate-in fade-in duration-200`) is a per-node `className` set once at construction — React Flow only (re)mounts a node's DOM element when its id first enters the array, so this naturally plays once per genuinely-new node and never replays on already-mounted siblings, with zero extra diffing/state"

key-files:
  created:
    - apps/web/src/app/chat/_hooks/use-conversation-controller.ts
    - apps/web/src/app/chat/_hooks/__tests__/use-conversation-controller.test.ts
    - apps/web/src/app/chat/_canvas/chat-node.tsx
    - apps/web/src/app/chat/_canvas/node-types.ts
    - apps/web/src/app/chat/_canvas/canvas-layout.ts
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
    - apps/web/src/app/chat/_canvas/chat-canvas-island.tsx
    - apps/web/src/app/chat/_canvas/canvas-skeleton.tsx
    - apps/web/src/app/chat/_canvas/canvas-empty-state.tsx
    - apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx
    - apps/web/src/app/chat/_canvas/canvas-keyboard-hint.tsx
  modified:
    - apps/web/src/app/chat/page.tsx
    - apps/web/vitest.config.ts

key-decisions:
  - "ChatNode fetches conversation title via api.chat.listConversations (same cached query the rail already uses), falling back to 'Chat' — node.data stays provenance-only (conversationId) per the fixed 23-02 Zod boundary, so the display title cannot live in node.data and must come from a live/cached query instead"
  - "genui-panel nodes materialize only from ACTIVE (isActive) history rows — a regenerated turn's retired sibling's genui_spec parts never also render as a panel, keeping canvas panel count in lockstep with what the docked view currently displays for that turn"
  - "CanvasEmptyState's render condition is `nodes.length === 0` (not 'zero genui-panel nodes') — per 23-UI-SPEC.md's own qualifier that since the chat node is always present once a conversation exists, this state is transient/defensive, not the primary first-run experience"
  - "Keyboard pan/zoom/fitView/Escape-deselect implemented as a single explicit onKeyDown handler (React Flow ships no built-in canvas-level, non-node arrow-key panning) gated to the container's own focus — the fuller UI-SPEC two-level Tab-cycle/Enter-to-enter-node-content/Escape-step-out focus model is NOT implemented this plan (no acceptance criterion gates it); documented here as a scoped interim, not a stub, since the REQUIRED baseline fallback (arrows pan, +/- zoom, 0 fitView) works end to end"
  - "Persistence/restore intentionally NOT wired (plan 23-04's seam, per this plan's own Objective) — ChatCanvas rebuilds nodes + a fresh dagre layout from chat.getHistory on every mount; dragged positions are not preserved across a Chat<->Canvas toggle or remount yet"

requirements-completed: [CANVAS-01]

# Metrics
duration: ~35min
completed: 2026-07-04
---

# Phase 23 Plan 03: Canvas Surface + View Toggle Summary

**React Flow canvas (chat node + dagre-placed genui-panel nodes) mounted behind a per-conversation Chat<->Canvas toggle, both views sharing ONE lifted `useConversationController` instance so switching never interrupts a stream.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files created:** 11 (1 hook + 1 hook test, 9 canvas surface files)
- **Files modified:** 2 (`page.tsx` host wiring, `vitest.config.ts` path-alias fix)

## Accomplishments

- **Task 1 — `useConversationController`:** Extracted ALL of `ConversationView`'s streaming/turn/webllm state (the `useChatStream`/`useWebllmEngine` locus branch, sibling overrides, regenerate/retry, optimistic user turn, live announcer, and the pure helpers `groupTurnsFromHistory`/`toWebllmMessages`/`liveAnnouncementFor`/`siblingGroupKeyFor`) verbatim into a new hook module. `ConversationView` is now a purely presentational consumer. Added `use-conversation-controller.test.ts` (8 tests) re-asserting the moved helpers' behavior (all-siblings fold, local sibling-override display vs. server-active regenerate target, in-flight-regenerate suppression, text-only extraction with genui_spec parts dropped, active-sibling-only filter, turnIndex ordering) — proving the extraction is behavior-preserving. Existing chat vitest suite (34 tests) stayed green throughout.
- **Task 2 — `ChatNode` + `nodeTypes` + `canvas-layout.ts`:** Built `ChatNode` (`memo`, `min-w-[400px] min-h-[320px]`, `node-drag-handle` header, reuses `MessageList`/`Composer`/`GeneratingIndicator` wholesale) driven by the shared controller through a new `ChatControllerContext` seam (the canvas host provides the instance; `ChatNode` never calls `useConversationController` itself). Built `canvas-layout.ts`: `layoutCanvasNodes` (pure dagre LR port of `/knowledge`'s `graph-layout.ts`, `chat=400x320`/`genui-panel=320x240` dims) + `offsetCascadePosition` (+32,+32 cascade fallback for a future live-materializing panel, D-03). Built `node-types.ts`: the module-level `nodeTypes` map (`{chat, genui-panel}`, defined once at module scope per D-04/D-07) + `resolveNodeComponent`, never throws, degrades to `UnknownNodeTypePlaceholder`.
- **Task 3 — `ChatCanvas` surface + island + toggle + host wiring:** Built `ChatCanvas` (one chat node + one genui-panel node per ACTIVE turn's `genui_spec` part, node.data carrying ONLY the provenance ref per D-05, dagre-auto-placed), wrapped in `CanvasSpecProvider` (23-02) + `ChatControllerProvider` (Task 2). Container is `role="application"`/`aria-roledescription="node-based diagram"` with a scoped keyboard fallback (arrows pan, +/- zoom, `0` fitView, Escape deselects — firing only when the container itself has focus, never hijacking a node's composer/form input), `Background`/`Controls`, a session-only `MiniMap` behind a `Map`-icon toolbar toggle (default off, `aria-pressed`), and a per-node fade-in class for new-panel materialization. Built `CanvasSkeleton`, `CanvasEmptyState`, `CanvasKeyboardHint` (first-visit-per-browser, localStorage-gated), `ChatCanvasIsland` (`dynamic(ssr:false)`, mirrors `knowledge-graph-island.tsx`), and `ChatCanvasViewToggle` (`@nauta/ui/tabs` segmented, `localStorage["nauta.chat.canvas-view:{conversationId}"]`, tamper-safe coercion to `"chat"`/`"canvas"` only). Wired `page.tsx`'s `ConversationView` to instantiate the controller once and switch its body between the docked view and `ChatCanvasIsland` via the toggle, passing the SAME controller instance to both.

## Task Commits

Each task was committed atomically:

1. **Task 1: extract useConversationController; refactor docked ConversationView** — `1c02c48` (refactor) — includes the vitest path-alias fix (Rule 3)
2. **Task 2: ChatNode + module-level nodeTypes map + dagre canvas-layout.ts** — `77fa316` (feat)
3. **Task 3: ChatCanvas surface + island + view toggle + page host wiring** — `c771815` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/chat/_hooks/use-conversation-controller.ts` — `useConversationController`, `ConversationController`, `ChatHistoryRow`, `groupTurnsFromHistory`, `toWebllmMessages`, `liveAnnouncementFor`, `siblingGroupKeyFor`, `STREAMING_TURN_ID`/`OPTIMISTIC_USER_TURN_ID`
- `apps/web/src/app/chat/_hooks/__tests__/use-conversation-controller.test.ts` — 8 tests over the moved pure helpers
- `apps/web/src/app/chat/_canvas/chat-node.tsx` — `ChatNode`, `ChatControllerProvider`/`ChatControllerContext` seam, `ChatNodeType`
- `apps/web/src/app/chat/_canvas/node-types.ts` — `nodeTypes`, `resolveNodeComponent`
- `apps/web/src/app/chat/_canvas/canvas-layout.ts` — `layoutCanvasNodes`, `offsetCascadePosition`, `CanvasRect`, `CANVAS_NODE_DIMENSIONS`
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx` — `ChatCanvas`
- `apps/web/src/app/chat/_canvas/chat-canvas-island.tsx` — `ChatCanvasIsland`
- `apps/web/src/app/chat/_canvas/canvas-skeleton.tsx` — `CanvasSkeleton`
- `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx` — `CanvasEmptyState`
- `apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx` — `ChatCanvasViewToggle`, `readStoredViewMode`, `writeStoredViewMode`, `ChatCanvasViewMode`
- `apps/web/src/app/chat/_canvas/canvas-keyboard-hint.tsx` — `CanvasKeyboardHint`, `KEYBOARD_HINT_DISMISSED_KEY`
- `apps/web/src/app/chat/page.tsx` — `ConversationView` now hosts the controller + toggle + docked/canvas switch
- `apps/web/vitest.config.ts` — added `resolve.alias` for `~/*` (Rule 3 fix)

## Decisions Made

See `key-decisions` in frontmatter — summarized: ChatNode's title comes from a live query (not node.data, which is provenance-only by the fixed 23-02 schema); genui-panel nodes derive only from active history rows; CanvasEmptyState's trigger is total node count, not genui-panel count specifically (per UI-SPEC's own framing); the keyboard fallback implements the REQUIRED baseline (pan/zoom/fitView, focus-scoped) but not yet the full two-level Tab-cycle focus model; persistence/restore is deliberately deferred to 23-04.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest missing `~/*` path alias resolution**
- **Found during:** Task 1, first `vitest run` of the new controller test
- **Issue:** `vitest.config.ts` had no `resolve.alias` for `~/*`, unlike `tsconfig.json`'s `paths` — any test importing a module that transitively reaches `"~/trpc/react"` (as `use-conversation-controller.ts` now does) failed with `Failed to resolve import "~/trpc/react"` under vite, even though `tsc`/`next build` both resolve it fine.
- **Fix:** Added `resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } }` to `vitest.config.ts`, mirroring the tsconfig mapping exactly.
- **Files modified:** `apps/web/vitest.config.ts`
- **Commit:** `1c02c48`

## Issues Encountered

None beyond the vitest alias fix above.

## User Setup Required

None — no new dependencies (`@xyflow/react`/`@dagrejs/dagre` were already deps, reused from `/knowledge`), no env vars, no infra changes. All new surface is client-side TypeScript/TSX behind the existing `/chat` route.

## Known Scope Notes (not stubs — explicit plan-sanctioned seams)

- **Persistence/restore:** `ChatCanvas` rebuilds nodes + a fresh dagre layout from `chat.getHistory` on every mount; dragged positions are not preserved across a Chat<->Canvas toggle or page reload yet. This is plan 23-04's seam per this plan's own Objective ("Persistence... land in 23-04").
- **Live panel materialization while Canvas is already open:** a new `genui_spec` turn completing while a user is looking at the Canvas view does not yet auto-materialize a panel (the surface only rebuilds on mount) — `offsetCascadePosition` exists and is ready for 23-04 to wire into a live-update path, but nothing calls it yet.
- **Two-level keyboard focus model:** the REQUIRED baseline (arrow-pan/+-zoom/0-fitView, Escape-deselect) is implemented and scoped safely; the fuller Tab-cycle-through-nodes / Enter-to-enter-node-content / Escape-to-step-out model from 23-UI-SPEC.md Accessibility is not implemented this plan (no acceptance criterion required it).
- **Data-carrying edges / shared state:** out of scope per this plan (23-05).

## Threat Flags

None — all new surface (localStorage view-mode value, node.data provenance-only boundary, keyboard/pointer interaction on a custom-nav'd graph) was already enumerated in the plan's `<threat_model>` (T-23-07, T-23-06, T-23-08) and implemented exactly as dispositioned:
- T-23-07 (view-toggle localStorage tampering) — `readStoredViewMode` coerces to `"chat"`/`"canvas"` only, falling back to `"chat"` for anything else.
- T-23-06 (rehydrated spec -> renderer) — panels render only through the unmodified `GenuiPartBoundary`/`SpecRenderer` via `CanvasSpecProvider`; no-eval grep on `_canvas` returns 0.
- T-23-08 (dagre relayout thrash) — positions assigned once at materialization via `layoutCanvasNodes`; `nodeTypes` module-level; `ChatNode`/`GenuiPanelNode` both `memo`-wrapped.

## Next Phase Readiness

- `useConversationController` is the shared seam plan 23-04 (streaming responsiveness) will layer live spec content through via `CanvasSpecProvider`'s existing `streamingByProvenance` prop (23-02) — no contract change needed.
- `layoutCanvasNodes`/`offsetCascadePosition` are ready for 23-04 to call on a live `genui_spec` arrival (materializing a new node into the mounted canvas without a full remount).
- `ChatCanvas`'s history-driven node/edge construction is the seam 23-04 extends with persisted-layout restore (`chat.getCanvasLayout`, 23-01) and debounced save (`chat.saveCanvasLayout`, 23-01) — this plan intentionally left both unwired.
- Edge rendering/creation (`DataEdge`, `EdgeCreationPicker`) and the shared per-chat state store are 23-05's scope — `edges` in `ChatCanvas` is currently always `[]`.

---
*Phase: 23-2d-canvas-panels-as-nodes-shared-state*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 13 created/modified files confirmed present on disk. All 3 task commits (`1c02c48`, `77fa316`, `c771815`) confirmed present in `git log --oneline`. `vitest run src/app/chat` — 42/42 tests pass (34 pre-existing + 8 new). `tsc --noEmit` clean. `next build` (`build:local`) compiles, including the `/chat` route with the canvas island. No-eval grep (`eval\(|new Function`) returns 0 across all `_canvas` source files.
