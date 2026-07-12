---
phase: 54-email-cluster-workflow-e3
plan: 04
subsystem: ui
tags: [react-flow, xyflow, trpc, zod, sonner, cmdk, radix, canvas, node-registry]

# Dependency graph
requires:
  - phase: 54-email-cluster-workflow-e3 (Plan 01)
    provides: "emails.threadCard (single-thread projection) + chat.createConversation/attachConversationToThread (ownership-scoped thread<->conversation linkage), all feature-detected against migration 0036"
provides:
  - "EmailThreadNode — the 4th versioned canvas node type ('email-thread'), rendering real thread subject/participants/summary with loading/error/empty/success branches + Open-thread/Attach-chat actions"
  - "AddEmailThreadPopover — search-select thread picker mounted in the canvas toolbar, drops a selected thread onto the canvas near viewport center"
  - "EmailThreadNodeDataSchema (.strict, threadId uuid + optional label) + NODE_TYPE_REGISTRY['email-thread'] + CANVAS_NODE_DIMENSIONS['email-thread'] (320x220) — registry hash flips"
  - "CanvasPersistenceContext.onOpenConversation — new optional plumbing seam threaded chat-canvas.tsx -> chat-canvas-island.tsx -> page.tsx's setSelectedId, letting a canvas node switch the visible conversation"
affects: [54-05-thread-cluster-context, 54-06-thread-cluster-indicator-header, 54-07-morning-checklist-clus07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "4th node-registry entry mirrors the 3rd (knowledge-preview) byte-for-byte: fixed-dimension shell, resolveHeaderLabel 3-step precedent, loading->error->empty->success branch order, remove-button recipe, footer deep-link recipe"
    - "Two-call Attach action (createConversation then attachConversationToThread) rather than a single call, because attachConversationToThread only links an EXISTING conversation id and the plan's own key_link explicitly targets that procedure"
    - "CanvasPersistenceContext extended (not a new context) for one more optional cross-cutting canvas capability — mirrors its existing scheduleSave/conversationId shape rather than inventing a parallel provider"

key-files:
  created:
    - apps/web/src/app/chat/_canvas/email-thread-node.tsx
    - apps/web/src/app/chat/_canvas/add-email-thread-popover.tsx
    - apps/web/src/app/chat/_canvas/__tests__/email-thread-node.test.tsx
    - apps/web/src/app/chat/_canvas/__tests__/add-email-thread-popover.test.tsx
  modified:
    - apps/web/src/app/chat/_canvas/node-data-schemas.ts
    - apps/web/src/app/chat/_canvas/node-type-registry.ts
    - apps/web/src/app/chat/_canvas/node-types.ts
    - apps/web/src/app/chat/_canvas/canvas-layout.ts
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
    - apps/web/src/app/chat/_canvas/chat-canvas-island.tsx
    - apps/web/src/app/chat/_canvas/panel-overlay-context.tsx
    - apps/web/src/app/chat/page.tsx
    - apps/web/src/app/chat/_canvas/__tests__/node-type-registry.test.ts

key-decisions:
  - "Extended CanvasPersistenceContextValue with an optional onOpenConversation field and threaded it chat-canvas.tsx -> chat-canvas-island.tsx -> page.tsx's setSelectedId (Rule 2 deviation) — the plan's own must-have truth ('Attach chat creates a thread-linked conversation and opens it') is unimplementable without SOME mechanism for a deeply-nested canvas node to trigger the top-level page's conversation-selection state, since /chat has no per-conversation route and React Flow node types receive no custom JSX props"
  - "Attach chat is 2 tRPC calls (createConversation then attachConversationToThread), not 1 — attachConversationToThread only links an already-existing conversationId; this matches the plan's own key_links entry naming attachConversationToThread specifically as the consumed procedure"
  - "'Open thread' footer link is conditionally disabled (href='#', aria-disabled, pointer-events-none) until query.data resolves with a real latestMessageId — unlike KnowledgePreviewNode's footer link (whose href only ever depends on node.data, always available), EmailThreadNode's latestMessageId is FETCHED, so the UI-SPEC's unconditional recipe would otherwise produce a dead '/emails/' link during loading/error/empty states"
  - "Fixed a pre-existing test bug in node-type-registry.test.ts's 'insensitive to registration order' test — it manually constructed a 3-entry reordered registry that excluded the new email-thread entry, so it fell out of sync with NODE_TYPE_REGISTRY the moment Task 1 registered the entry (Rule 1 fix)"

patterns-established:
  - "onOpenConversation as an optional CanvasPersistenceContext field is now the sanctioned mechanism for a canvas node to request the host page switch conversations — later plans needing similar cross-tree navigation should extend this field rather than re-deriving a parallel seam"

requirements-completed: [CLUS-01]

# Metrics
duration: 22min
completed: 2026-07-12
---

# Phase 54 Plan 04: EmailThreadNode + AddEmailThreadPopover + Versioned Registry Summary

**4th canvas node type (`email-thread`) rendering real thread subject/participants/summary via `emails.threadCard`, a search-select `AddEmailThreadPopover` picker, and a new `onOpenConversation` plumbing seam so "Attach chat" actually switches the app to the newly created, thread-linked conversation.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-12T08:41:00Z (approx, first Read call)
- **Completed:** 2026-07-12T09:03:15Z
- **Tasks:** 3 (Tasks 2 and 3 each TDD RED->GREEN)
- **Files modified:** 13 (4 created, 9 modified)

## Accomplishments

- `EmailThreadNode`, the 4th React Flow node type in the versioned `NODE_TYPE_REGISTRY`, byte-mirroring `KnowledgePreviewNode`'s shell/header/branch-order/remove-button recipes exactly (54-UI-SPEC.md Component 1 verbatim), fetching real thread data via `emails.threadCard` (54-01) — loading skeletons, a destructive error `EmptyState` with Retry, an "unavailable" empty state, and a success state showing the deduped participants row + `line-clamp-4` latest-message summary
- `AddEmailThreadPopover`, a `Popover`+`Command` search-select thread picker (mirrors `ModelPicker`'s exact composition, diverging deliberately from `AddKnowledgePreviewPopover`'s manual-paste precedent per 54-UI-SPEC.md Judgment Call #5), mounted immediately left of `AddKnowledgePreviewPopover` in the canvas toolbar, excluding pre-backfill singleton threads (`threadId === null`)
- `handleAddEmailThread` in `chat-canvas.tsx`, materializing a selected+cascaded `email-thread` node at viewport center — byte-identical placement mechanics to the existing `handleAddKnowledgePreview`
- Attach chat: creates a new conversation, links it to the thread (`chat.attachConversationToThread`), then switches the app to it via a newly threaded `onOpenConversation` context seam — in-flight `Loader2`+disabled, `toast.error` + Retry on any failure or degrade (`{attached:false}`)
- Registry integrity: `EmailThreadNodeDataSchema` (`.strict()`, `threadId` uuid + optional `label` max 120) + `CANVAS_NODE_DIMENSIONS["email-thread"] = {320, 220}` — `computeNodeRegistryHash` verifiably flips with the new entry

## Task Commits

Each task was committed atomically (Tasks 2 and 3 followed RED->GREEN per `tdd="true"`):

1. **Task 1: Registry extensions for the email-thread node type** - `caa56d1` (feat)
2. **Task 2 RED: EmailThreadNode component + Attach-chat tests** - `a21ba63` (test)
2. **Task 2 GREEN: EmailThreadNode component + Attach-chat + node-types wiring** - `9eb73b5` (feat)
3. **Task 3 RED: AddEmailThreadPopover tests** - `bf6c1c1` (test)
3. **Task 3 GREEN: AddEmailThreadPopover + chat-canvas mount** - `415a76d` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `apps/web/src/app/chat/_canvas/email-thread-node.tsx` - `EmailThreadNode` React Flow node (221 lines): shell/header/body branches/footer, `resolveHeaderLabel`, Attach-chat handler
- `apps/web/src/app/chat/_canvas/add-email-thread-popover.tsx` - `AddEmailThreadPopover` search-select picker (137 lines)
- `apps/web/src/app/chat/_canvas/node-data-schemas.ts` - `EmailThreadNodeDataSchema` + `EmailThreadNodeData` type
- `apps/web/src/app/chat/_canvas/node-type-registry.ts` - `NODE_TYPE_REGISTRY["email-thread"]` entry
- `apps/web/src/app/chat/_canvas/node-types.ts` - `nodeTypes["email-thread"] = EmailThreadNode`
- `apps/web/src/app/chat/_canvas/canvas-layout.ts` - `CANVAS_NODE_DIMENSIONS["email-thread"] = { width: 320, height: 220 }`
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx` - mounts `AddEmailThreadPopover`, `handleAddEmailThread`, `onOpenConversation` prop threaded into `CanvasPersistenceContext`
- `apps/web/src/app/chat/_canvas/chat-canvas-island.tsx` - threads `onOpenConversation` through to `ChatCanvas`
- `apps/web/src/app/chat/_canvas/panel-overlay-context.tsx` - `CanvasPersistenceContextValue` gains optional `onOpenConversation`
- `apps/web/src/app/chat/page.tsx` - `ConversationView` accepts `onOpenConversation`; `ChatPage`'s `handleOpenConversation` (invalidate + `setSelectedId`) wires the loop closed
- `apps/web/src/app/chat/_canvas/__tests__/email-thread-node.test.tsx` - 22 tests (9 registry + 13 component)
- `apps/web/src/app/chat/_canvas/__tests__/add-email-thread-popover.test.tsx` - 6 tests
- `apps/web/src/app/chat/_canvas/__tests__/node-type-registry.test.ts` - fixed the stale 3-entry reordering test (Rule 1)

## Decisions Made

- **Extended `CanvasPersistenceContext` with `onOpenConversation` rather than inventing a new provider** — this context already threads `scheduleSave`/`conversationId` to every canvas node/panel; adding one more optional cross-cutting capability follows the same shape every existing control (`RegenerateControl`, `PackSwitcher`, etc.) already consumes, and avoids a second parallel plumbing mechanism.
- **Attach chat makes 2 tRPC calls, not 1** — `chat.createConversation` (mirrors the rail's "New chat") then `chat.attachConversationToThread` (54-01's ownership-scoped linkage write) — because the latter only links an already-existing conversation id, and the plan's own `key_links` entry names it as the specific procedure to consume.
- **"Open thread" footer link disables (`href="#"`, `aria-disabled`, `pointer-events-none`) until the thread card query resolves** — `latestMessageId` is fetched (not part of `node.data` like `KnowledgePreviewNode`'s `focusNodeId`), so an unconditional link would otherwise point at a broken `/emails/` route during loading/error/empty states. This is a judgment call the UI-SPEC's snippet didn't spell out explicitly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Threaded a new `onOpenConversation` seam through `panel-overlay-context.tsx` -> `chat-canvas-island.tsx` -> `page.tsx`**
- **Found during:** Task 2 (EmailThreadNode's Attach-chat handler)
- **Issue:** The plan's own must-have truth states "The card's 'Attach chat' action creates a thread-linked conversation and opens it," and 54-UI-SPEC.md's Interactive-State Contract requires "the visible conversation switch IS the confirmation." `/chat` has no per-conversation route (`selectedId` is `ChatPage`-local React state) and React Flow node types receive no custom JSX props — a canvas node many levels deep (`ChatPage` -> `ConversationView` -> `ChatCanvasIsland` -> `ChatCanvas` -> `nodeTypes["email-thread"]`) has no way to trigger the top-level page's conversation switch without SOME new plumbing seam. `chat-canvas.tsx` is in the plan's own `files_modified`, but `chat-canvas-island.tsx`/`page.tsx`/`panel-overlay-context.tsx` were not declared.
- **Fix:** Extended `CanvasPersistenceContextValue` (already the established cross-cutting canvas-capability context, consumed the same way `scheduleSave`/`conversationId` already are) with an optional `onOpenConversation?: (conversationId: string) => void` field, threaded it through `chat-canvas.tsx`'s existing `canvasPersistenceValue` memo, added a matching optional prop to `ChatCanvasIslandProps`/`ChatCanvasProps`, and wired `page.tsx`'s `ChatPage` to define `handleOpenConversation` (invalidate `chat.listConversations` + `setSelectedId`, mirroring `handleNewChat`'s own `onSuccess` shape) passed down through `ConversationView`.
- **Files modified:** apps/web/src/app/chat/_canvas/panel-overlay-context.tsx, apps/web/src/app/chat/_canvas/chat-canvas-island.tsx, apps/web/src/app/chat/page.tsx (beyond the plan's declared `chat-canvas.tsx`)
- **Verification:** `email-thread-node.test.tsx`'s Attach-chat success test asserts `onOpenConversation` is called with the new conversation id; `chat-mobile-feed.test.tsx` (which mounts the real `ChatPage`) still passes 12/12 after the wiring change, confirming no regression to the existing "New chat" / mobile rail flows.
- **Committed in:** 9eb73b5 (Task 2 commit, context field) + 415a76d (Task 3 commit, page.tsx/island wiring)

**2. [Rule 1 - Bug] Fixed a pre-existing test now broken by Task 1's registry addition**
- **Found during:** Task 1 verification (full `_canvas` suite regression check before Task 2's commit)
- **Issue:** `node-type-registry.test.ts`'s "is insensitive to registration order (sorted keys)" test manually constructs a 3-entry `reordered` registry (`knowledge-preview`, `genui-panel`, `chat`) and asserts its hash equals `computeNodeRegistryHash(NODE_TYPE_REGISTRY)`. Adding the 4th `email-thread` entry to `NODE_TYPE_REGISTRY` (Task 1) made the two registries genuinely different (3 entries vs. 4), so the assertion started failing — not a bug in the registry/hash code, but a stale test fixture.
- **Fix:** Added `"email-thread": NODE_TYPE_REGISTRY["email-thread"]!` to the `reordered` object so it once again mirrors the full current registry (just reordered).
- **Files modified:** apps/web/src/app/chat/_canvas/__tests__/node-type-registry.test.ts
- **Verification:** Full `_canvas` suite (32 files / 244 tests) green after the fix.
- **Committed in:** 9eb73b5 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical-functionality, 1 bug)
**Impact on plan:** Both were necessary for the plan's own stated must-haves/regression bar to hold. No scope creep beyond the minimum plumbing needed to make "Attach chat" actually open the new conversation, and a one-line fixture fix in an existing test.

## TDD Gate Compliance

Task 1 (registry extensions) does not have a separate RED test commit before its GREEN implementation commit — `caa56d1` combines the schema/registry/dimension edits and their tests in one commit. This is a deliberate, documented deviation from strict RED->GREEN ordering for this ONE task: the three edits (a `.strict()` Zod object mirroring an existing sibling schema, one registry-map entry, one dimension-map entry) are declarative, mechanically-verified additions with no meaningfully "failing" behavior to red against (there is no code path that could partially work) — writing the tests first, chronologically, would have required a throwaway revert-and-reapply cycle for zero additional verification value. All 9 registry tests were run and confirmed passing before the commit. Tasks 2 and 3 both have a real RED commit (`a21ba63`, `bf6c1c1`, each confirmed failing via module-resolution error before implementation) followed by a real GREEN commit (`9eb73b5`, `415a76d`).

## Issues Encountered

- **`@polytoken/api-client`'s `dist/` was stale** (flagged as a known gotcha in 54-01-SUMMARY.md — this plan is the first `apps/web` consumer of `emails.threadCard`/`chat.attachConversationToThread`). `npm run typecheck -w @polytoken/web` initially failed with `Property 'threadCard' does not exist...` because the package's `exports["."].types` condition points at `dist/index.d.ts` (stale) while `default` points at `src/index.ts` (current) — resolved by running `npm run build -w @polytoken/api-client` (a `tsc` build, gitignored output, no commit needed).
- **jsdom lacks `ResizeObserver`**, which `cmdk`'s `Command.List` calls unconditionally on mount — `add-email-thread-popover.test.tsx` needed a no-op `ResizeObserver` polyfill (same family of jsdom gap as the pre-existing `scrollIntoView` polyfill `pack-switcher.test.tsx` already carries for Radix `Select`).
- **TS narrowing**: `query.data ? hrefFor(...) : "#"` needed the truthy check performed on `query.data` directly inside the ternary (not via a separately-computed `canOpenThread` boolean) for TypeScript to narrow away `null`/`undefined` at the `hrefFor` call site.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 54-05 (`depends_on: [54-01, 54-03]`, CLUS-02/CLUS-06, Python-side turn-time context injection) is unaffected by this plan's web-only changes and can proceed independently.
- 54-06 (`depends_on: [54-01]`, CLUS-02/CLUS-06/CLUS-03) will mount `ThreadClusterIndicator` in `page.tsx`'s top bar and already declares `page.tsx` in its own `files_modified` — it will find `page.tsx` already carrying this plan's `onOpenConversation` wiring (additive-only, no conflict expected) when it edits the same file.
- The `onOpenConversation` plumbing pattern (an optional field on `CanvasPersistenceContextValue`) is now the established seam for any future canvas node needing to trigger a host-page-level navigation/state change — later plans should extend it rather than re-deriving a parallel mechanism.
- No blockers. Live-browser confirmation (real thread card render, the Add-thread picker, the actual Attach-chat round-trip against a real thread) is DEFERRED to `.planning/MORNING-CHECKLIST.md` §H per 54-CONTEXT.md's CLUS-07 gating — not faked tonight. Tonight's verification is vitest (mocked tRPC) + typecheck + committed palette/token gates only, per this plan's own `<verification>` section.

---
*Phase: 54-email-cluster-workflow-e3*
*Completed: 2026-07-12*

## Self-Check: PASSED

All 14 declared files (4 created, 9 modified, this SUMMARY) confirmed present on
disk; all 5 task commit hashes (caa56d1, a21ba63, 9eb73b5, bf6c1c1, 415a76d)
confirmed in `git log --oneline --all`.
