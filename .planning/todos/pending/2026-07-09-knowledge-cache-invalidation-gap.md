---
created: 2026-07-09
title: Extend knowledge.* client cache invalidation to chat-driven promotions + expandNode
area: web/chat-canvas (query invalidation)
files:
  - apps/web/src/app/chat/_hooks/use-conversation-controller.ts
  - apps/web/src/app/knowledge/_components/knowledge-graph.tsx
  - apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx
resolves_phase: 51
---

## Problem

Found by the v1.6 milestone integration audit (2026-07-09). The BIND-02 invalidation contract
(Phase 33) only covers the `/knowledge` page's promote button: `promoteEdge()` in
`knowledge-graph.tsx` is the ONLY caller of `utils.knowledge.byId.invalidate()` /
`utils.knowledge.graph.invalidate()` in the web app. Two paths it doesn't cover:

1. **Phase 40's chat-driven promotion** (confirm_action widget → server-side PromoteEdgeUseCase):
   `handleTerminal` in `use-conversation-controller.ts:345-358` fires on the widget-submit
   continuation turn but invalidates only `chat.getHistory`/`chat.sessionCost`/
   `chat.getWidgetInteractions` — never `knowledge.*`.
2. **`knowledge.expandNode`** (Phase 41's KnowledgePreviewNode data source) is never invalidated
   by ANY promotion path, including the /knowledge page button.

Net effect: bound genui panels and knowledge-preview nodes show stale tier data for up to
~10s (staleTime) after a promotion, until staleTime elapses or window refocus refetches.
Self-healing, so WARNING not blocker — but the "one invalidation contract" promise of BIND-02
should extend to all promotion paths.

## Solution (proposed)

- Add `utils.knowledge.byId.invalidate()` + `utils.knowledge.graph.invalidate()` +
  `utils.knowledge.expandNode.invalidate()` to `handleTerminal` when the terminal turn was a
  widget-submit continuation (or unconditionally — the queries are cheap and staleTime-guarded).
- Add `expandNode` invalidation to the existing `promoteEdge()` in knowledge-graph.tsx.
- Regression test: promote via the widget path in a test harness → assert the three query keys
  are invalidated (mirror the existing Phase 33 invalidation test pattern).
