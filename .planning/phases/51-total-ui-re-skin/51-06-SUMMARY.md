---
phase: 51-total-ui-re-skin
plan: 06
subsystem: ui
tags: [tanstack-query, trpc, react, cache-invalidation, knowledge-graph, chat]

# Dependency graph
requires:
  - phase: 33-chat-knowledge-convergence
    provides: "BIND-02 event-driven invalidation contract (promoteEdge → knowledge.byId/graph) this plan extends"
  - phase: 40-chat-confirmable-promotions
    provides: "handleTerminal's widget-submit continuation terminal (the chat-driven promotion path this plan wires up)"
  - phase: 41-knowledge-preview-canvas-node
    provides: "knowledge.expandNode (the KnowledgePreviewNode data source this plan makes invalidatable)"
provides:
  - "promoteEdge (/knowledge page) invalidates knowledge.expandNode on success, alongside byId + graph"
  - "invalidateOnChatTerminal — standalone exported helper handleTerminal delegates to, invalidating chat.* AND knowledge.* on every terminal turn"
  - "Two regression tests proving both promotion paths invalidate all three knowledge.* keys"
affects: [51-total-ui-re-skin, knowledge-canvas, chat-canvas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone exported orchestration function extracted from a useCallback for unit-testability without mounting tRPC/QueryClient context (promoteEdge precedent, now mirrored by invalidateOnChatTerminal)"

key-files:
  created:
    - apps/web/src/app/chat/_hooks/__tests__/use-conversation-controller-invalidate.test.ts
  modified:
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx
    - apps/web/src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx
    - apps/web/src/app/chat/_hooks/use-conversation-controller.ts
    - .planning/todos/pending/2026-07-09-knowledge-cache-invalidation-gap.md (moved to .planning/todos/done/)

key-decisions:
  - "Fire the three knowledge.* invalidations unconditionally on every chat terminal turn (not gated to a widget-submit continuation) — simpler than threading a 'was this a promotion?' flag through the stream-terminal callback, and the queries are cheap + staleTime-guarded (todo's own accepted rationale, T-51-07-B)"
  - "Extracted invalidateOnChatTerminal as a standalone exported function (mirrors knowledge-graph.tsx's promoteEdge extraction) so the regression test drives real invalidation logic without mounting the full hook/tRPC context"

patterns-established:
  - "Cache-invalidation orchestration logic lives in a standalone exported function taking a minimal structural utils interface, never inline inside a useCallback — makes it independently unit-testable"

requirements-completed: [RSKN-07]

# Metrics
duration: 5min
completed: 2026-07-11
---

# Phase 51 Plan 06: RSKN-07 Cache-Invalidation Gap Closure Summary

**Both knowledge-canvas promotion paths (`/knowledge` page button + chat-driven confirm_action widget) now invalidate `knowledge.byId` + `knowledge.graph` + `knowledge.expandNode` on success, closing the todo's two named gaps with two new regression tests.**

## Performance

- **Duration:** ~5 min (commits span 18:34:49–18:39:23)
- **Started:** 2026-07-11T18:34:49-03:00
- **Completed:** 2026-07-11T18:39:23-03:00
- **Tasks:** 2 completed
- **Files modified:** 4 (+ 1 test file created, + 1 todo moved)

## Accomplishments
- `promoteEdge()` in `knowledge-graph.tsx` now invalidates `knowledge.expandNode` (the `KnowledgePreviewNode` data source) alongside the existing `byId`/`graph` invalidation, success-branch-only — the `!ok` early return still invalidates nothing.
- `handleTerminal` in `use-conversation-controller.ts` now invalidates all three `knowledge.*` keys on every terminal chat turn, in addition to the three `chat.*` keys it always invalidated — closing the gap where a chat-driven promotion via the `confirm_action` widget never touched `knowledge.*` at all.
- Both invalidation orchestrations are standalone exported functions (`promoteEdge`, `invalidateOnChatTerminal`) unit-tested directly against mocked utils objects, with zero ReactFlow/tRPC context mounting required.
- Todo `2026-07-09-knowledge-cache-invalidation-gap.md` closed with a resolution note and moved to `.planning/todos/done/`.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: Extend promoteEdge to invalidate expandNode** — `a4e8f88` (test, RED), `cb9fa53` (feat, GREEN)
2. **Task 2: Chat-driven promotion invalidates knowledge.\* + close todo** — `b1034d0` (test, RED), `e4b1dad` (feat, GREEN), `a4cf73c` (docs, todo resolution note)

_Todo rename (pending → done) landed inside the `b1034d0` test commit (git tracked it as part of the same working-tree state at commit time); the resolution-note content was committed separately in `a4cf73c`._

## Files Created/Modified
- `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` — `PromoteEdgeUtils` extended with `expandNode`; `promoteEdge` invalidates it on success only
- `apps/web/src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx` — extended `makeUtils()` + added expandNode assertions to all 3 existing cases
- `apps/web/src/app/chat/_hooks/use-conversation-controller.ts` — new exported `ChatTerminalUtils` type + `invalidateOnChatTerminal()` function; `handleTerminal` delegates to it
- `apps/web/src/app/chat/_hooks/__tests__/use-conversation-controller-invalidate.test.ts` — new regression test (created)
- `.planning/todos/done/2026-07-09-knowledge-cache-invalidation-gap.md` — moved from `pending/`, resolution note added

## Decisions Made
- **Unconditional firing on every chat terminal turn** (not gated to widget-submit continuations): the plan explicitly left this to Claude's Discretion. Threading a "was this terminal a promotion continuation?" flag through `useChatStream`'s `onTerminal` callback would add surface area for a marginal cost — three already-cheap, staleTime-guarded tRPC queries refetching on turn settle. Matches the todo's own proposed rationale (T-51-07-B: bounded refetch, never unbounded fan-out).
- **Standalone exported helper, not inline logic**: `invalidateOnChatTerminal(conversationId, utils)` mirrors the `promoteEdge` extraction pattern already established in `knowledge-graph.tsx` — keeps the orchestration logic unit-testable without a live tRPC/QueryClient/ReactFlow context, consistent with this repo's existing test precedent (`panel-data-flow.test.tsx`, `interactive-widget-canvas.test.tsx`).

## Deviations from Plan

None - plan executed exactly as written. The "Claude's Discretion" choice called out in the plan (unconditional-vs-gated invalidation) is documented above, not a deviation from an explicit requirement.

## Issues Encountered

None. Note for the record: the `git mv` for the todo file landed inside the `b1034d0` test commit rather than a standalone commit as originally intended (git's index already held the staged rename from the `git mv` command by the time `git add` + `git commit` ran for the test file) — purely a commit-boundary cosmetic detail, not a functional issue. The resolution-note text itself was captured in its own follow-up `docs` commit (`a4cf73c`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- RSKN-07 fully closed; both promotion paths (`/knowledge` button + chat-driven widget) share one complete invalidation contract across all three `knowledge.*` query keys.
- Todo backlog for this area is now empty (`2026-07-09-knowledge-cache-invalidation-gap.md` closed).
- No blockers for sibling Phase-51 plans; this plan's file-ownership fence (`knowledge-graph.tsx`, `use-conversation-controller.ts`) held — no cross-plan edits observed.

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 5 modified/created files confirmed present on disk; pending todo confirmed removed and done
todo confirmed present; all 5 task commit hashes (a4e8f88, cb9fa53, b1034d0, e4b1dad, a4cf73c)
confirmed present in git log.
