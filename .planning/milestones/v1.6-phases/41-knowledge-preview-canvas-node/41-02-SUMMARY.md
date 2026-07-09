---
phase: 41-knowledge-preview-canvas-node
plan: 02
subsystem: chat-canvas-knowledge-preview-node
tags: [react-flow-node, mini-graph-renderer, popover-form, PREV-01, node-remove-persistence]
dependency_graph:
  requires:
    - "apps/web/src/app/chat/_canvas/node-data-schemas.ts's KnowledgePreviewNodeDataSchema (Plan 41-01)"
    - "apps/web/src/app/chat/_canvas/node-type-registry.ts's 3rd NODE_TYPE_REGISTRY entry, id 'knowledge-preview' (Plan 41-01)"
    - "apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts's MAX_PREVIEW_NODES/trimPreviewGraph/orderTwoHopByParent/layoutPreview (Plan 41-01)"
    - "apps/web/src/app/knowledge/_components/tier-edge-style.ts's tierEdgeStyle (unchanged, Phase 32)"
    - "apps/web/src/components/provenance-link.tsx's hrefFor (unchanged, Phase 39)"
    - "apps/web/src/app/chat/_canvas/canvas-layout.ts's CANVAS_NODE_DIMENSIONS/DEFAULT_CANVAS_NODE_DIMENSIONS/offsetCascadePosition/CanvasRect"
  provides:
    - "apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx's KnowledgePreviewMiniGraph (presentational, prop-driven)"
    - "apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx's KnowledgePreviewNode / resolveHeaderLabel / resolveFooterCopy"
    - "apps/web/src/app/chat/_canvas/add-knowledge-preview-popover.tsx's AddKnowledgePreviewPopover"
    - "apps/web/src/app/chat/_canvas/node-types.ts's 3rd nodeTypes entry, 'knowledge-preview'"
    - "apps/web/src/app/chat/_canvas/chat-canvas.tsx's handleNodesChange (remove-triggers-save) + handleAddKnowledgePreview"
  affects:
    - "The /chat canvas surface end-to-end: PREV-01's full user-observable outcome (place -> render -> deep-link -> remove-persists) now exists"
tech_stack:
  added: []
  patterns:
    - "Data-fetching lives in the node component (knowledge-preview-node.tsx), never in the presentational mini-graph (knowledge-preview-mini-graph.tsx) -- mirrors the app's existing container/presentational split"
    - "SVG-for-edges + absolutely-positioned real Next <Link>-for-nodes, single TooltipProvider per instance -- deliberately NOT a second React Flow/ReactFlowProvider mount"
    - "Controlled-open Popover (AddKnowledgePreviewPopover) vs edge-creation-picker.tsx's always-open anchored Popover -- a normal PopoverTrigger-driven popover that closes itself programmatically on success"
    - "handleNodesChange mirrors handleEdgesChange's exact onChange-then-conditional-scheduleSave shape -- the first node-level remove-triggers-save wiring on this canvas"
key_files:
  created:
    - apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx
    - apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-mini-graph.test.tsx
    - apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx
    - apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-node.test.tsx
    - apps/web/src/app/chat/_canvas/add-knowledge-preview-popover.tsx
    - apps/web/src/app/chat/_canvas/__tests__/add-knowledge-preview-popover.test.tsx
  modified:
    - apps/web/src/app/chat/_canvas/node-types.ts
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
decisions:
  - "KNOWLEDGE_PREVIEW_STALE_TIME_MS = 10_000 kept as an independent local module constant in knowledge-preview-node.tsx rather than folded into use-data-bindings.ts's STALE_TIME_MS map, per the plan's own instruction -- expandNode isn't one of that module's 5 wired allowlisted procedures"
  - "Test mocks for api.knowledge.expandNode.useQuery use isPending (TanStack Query v5's actual field, matching this repo's installed @tanstack/react-query ^5.62.0) rather than the plan behavior text's literal isLoading -- the component reads query.isPending per the plan's own <action> instructions; kept both call sites internally consistent since this executor authored both the component and its test in the same session"
  - "AddKnowledgePreviewPopover's PopoverContent renders through a Radix Portal (packages/ui's own PopoverContent wraps content in PopoverPrimitive.Portal) -- its test queries document.body directly for form-field assertions (not the mounted container) and calls root.unmount() in afterEach to tear down portaled DOM between tests, avoiding cross-test pollution"
  - "knowledge-preview-node.tsx and its test needed an explicit import * as React from \"react\" (mirrors Phase 39's provenance-link.tsx precedent, documented in STATE.md) -- this repo's vitest config lacks @vitejs/plugin-react and relies on esbuild's classic JSX transform under test"
metrics:
  duration: "~50 min (resumed execution -- Task 1 was reconciled from an interrupted prior run's uncommitted output; Tasks 2-3 built fresh)"
  completed: 2026-07-09
---

# Phase 41 Plan 02: Knowledge-Preview Canvas Node -- Node Shell + Mini-Graph + Add-Preview Popover Summary

The full visible surface for the `knowledge-preview` canvas node (PREV-01): a non-interactive
SVG/`<Link>`-dot mini-graph renderer, the 3rd React Flow custom node (header, remove, footer,
`knowledge.expandNode` data-fetching), a paste-a-UUID "Add knowledge preview" toolbar popover, and
`chat-canvas.tsx`'s wiring so node removal finally persists through the same debounced save path
node-drag already used. This plan resumed a previously-interrupted executor run.

## What Was Built

### Task 1 -- KnowledgePreviewMiniGraph (reconciled from an interrupted prior run)

This session started by verifying, not rewriting, the interrupted run's uncommitted output:
`knowledge-preview-mini-graph.tsx` and its 9-test spec already matched 41-UI-SPEC.md sections 2/4/5
and the plan's `<behavior>`/`<acceptance_criteria>` blocks exactly on first read. Ran the targeted
suite (9/9 passing) and every literal acceptance-criteria grep (zero `@xyflow/react`/`ReactFlow`,
zero `onWheel`/`onDrag`/zoom-state/`onPointerMove`, `hrefFor` used with zero hand-duplicated
`/knowledge?focus=` string literals, `tierEdgeStyle` imported by exact path) before committing as-is
-- no code changes were needed, only verification.

`KnowledgePreviewMiniGraph` branches loading -> error -> empty(not-found) -> empty(no-connections)
-> success (41-UI-SPEC.md section 4's fixed order), the success branch chaining Plan 41-01's
`trimPreviewGraph` -> `orderTwoHopByParent` -> `layoutPreview`. One `<svg aria-hidden>` layer of
`PreviewEdge` `<line>`s (tier-styled via `tierEdgeStyle`, imported not hand-duplicated) stacked under
one `role="group"` layer of real `<Link href={hrefFor("knowledge", id)}>` node dots (`PreviewNodeDot`,
distance-keyed sizing/color/icon/label per 41-UI-SPEC.md's node-dot tables, every dot wrapped in a
`Tooltip` showing the full untruncated label, every dot a `min-h-6 min-w-6` padded hit-target).

### Task 2 -- KnowledgePreviewNode + node-types.ts wiring

New `knowledge-preview-node.tsx`: `resolveHeaderLabel` (explicit `data.label` -> resolved focus
node's own title -> `"Knowledge preview"` fallback, `.find` defensively never throwing) and
`resolveFooterCopy` (`"Open in Knowledge →"` / `` `+${n} more — Open in Knowledge →` ``) exported as
pure helpers per 41-UI-SPEC.md sections 1/3's exact resolution order and copy. `KnowledgePreviewNode`
is a `memo`-wrapped `NodeProps<KnowledgePreviewNodeType>` component: the fixed `h-[240px] w-[320px]`
shell (not `min-h`/`min-w` -- content is bounded by construction), header (`Share2` icon + truncating
`headerLabel` + remove button), `KnowledgePreviewMiniGraph` body fed by
`api.knowledge.expandNode.useQuery({ nodeId: data.focusNodeId, depth: 2 }, { staleTime:
KNOWLEDGE_PREVIEW_STALE_TIME_MS })` (data-fetching lives here, not in the presentational mini-graph),
and a footer `<Link href={hrefFor("knowledge", data.focusNodeId)}>` that always renders. The remove
button (`aria-label="Remove knowledge preview"`, the first node-level remove affordance on this
canvas) calls `useReactFlow().deleteElements({ nodes: [{ id }] })`, `stopPropagation`-guarded.
`node-types.ts` gained `"knowledge-preview": KnowledgePreviewNode` as its 3rd `nodeTypes` entry.

8 new tests cover all 8 documented behaviors (4 `resolveHeaderLabel` resolution-order cases, the
copy-table `resolveFooterCopy` case, mount-loading threading `role="status"` down to the mini-graph,
remove-button wiring against a partial `useReactFlow` mock, and `node-types.ts`/`resolveNodeComponent`
resolution). Mounting the real `Handle` component required wrapping test renders in a real
`ReactFlowProvider` (the zustand store context `Handle` reads from) -- discovered and fixed during
this task's own TDD loop, not deferred.

### Task 3 -- AddKnowledgePreviewPopover + chat-canvas.tsx wiring

New `add-knowledge-preview-popover.tsx`: a controlled-`open` `Popover` > `TooltipProvider` > `Tooltip`
> `TooltipTrigger asChild` > `PopoverTrigger asChild` > `Button` (`aria-label="Add knowledge
preview"`) trigger, `PopoverContent` rendering the node-id/label form per 41-UI-SPEC.md section 6's
exact copy. `z.string().uuid().safeParse` gates the "Add preview" click handler (T-41-07): failure
sets the inline error `"Enter a valid knowledge node ID."` and keeps the popover open, never calling
`onAdd`; success calls `onAdd(parsedId, labelInput.trim() || undefined)`, resets the form, and closes
the popover. "Cancel" resets and closes without ever calling `onAdd`.

`chat-canvas.tsx`: `handleNodesChange` mirrors `handleEdgesChange`'s exact shape (`onNodesChange` then
`persistence.scheduleSave(canvasStore)` gated on any `"remove"` change) -- wired as the
`<ReactFlowJSX>`'s `onNodesChange` prop, replacing the raw `onNodesChange` passthrough. This closes
the pre-existing gap the plan targeted: node removal (via this plan's own remove button, or React
Flow's native Backspace-key deletion) now actually persists. `handleAddKnowledgePreview` resolves a
viewport-center flow position via `rfInstanceRef.current?.screenToFlowPosition`, builds
`CanvasRect`s from every current node's `CANVAS_NODE_DIMENSIONS`-derived size, calls
`offsetCascadePosition` to avoid exact overlap, appends a new selected `knowledge-preview` `FlowNode`
(deselecting every prior node first, mirroring `handlePaneClick`'s pattern), and schedules a save.
`AddKnowledgePreviewPopover` is mounted first (before the pre-existing minimap-toggle button) inside a
new `<div className="flex items-center gap-2">` wrapping both, inside the existing top-right `Panel`.

6 new tests cover all 6 documented behaviors (trigger discoverability, disabled-while-empty,
non-UUID inline error + stays-open + no-`onAdd`, valid-UUID-no-label success + closes, valid-UUID-
plus-label success, Cancel closes without `onAdd`) plus the pre-existing 7-test
`chat-canvas.test.ts` pure-function file confirmed unchanged/passing.

## Verification

```
cd apps/web && npx vitest run src/app/chat/_canvas/__tests__/knowledge-preview-mini-graph.test.tsx src/app/chat/_canvas/__tests__/knowledge-preview-node.test.tsx src/app/chat/_canvas/__tests__/add-knowledge-preview-popover.test.tsx
# Test Files  3 passed (3)
#      Tests  23 passed (23)  -- 9 mini-graph + 8 node + 6 popover

cd apps/web && npx vitest run src/app/chat/_canvas
# Test Files  14 passed (14)
#      Tests  128 passed (128)  -- 0 regressions across the full canvas-directory sweep

cd apps/web && npx tsc --noEmit -p tsconfig.json
# (clean, zero output outside pre-existing .next/types generated-artifact noise, out of scope)

git diff --stat packages/genui/src/renderer/render-node.tsx packages/genui/src/renderer/spec-renderer.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx
# (empty -- locked files byte-identical)

grep -rc "@xyflow/react\" import.*ReactFlow\b\|<ReactFlow " apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx
# knowledge-preview-mini-graph.tsx:0
# knowledge-preview-node.tsx:0

grep -n "handleNodesChange" apps/web/src/app/chat/_canvas/chat-canvas.tsx
# definition + onNodesChange prop use (2 occurrences)

grep -c "persistence.scheduleSave(canvasStore)" apps/web/src/app/chat/_canvas/chat-canvas.tsx
# 11 (9 pre-existing + 2 new: handleNodesChange's remove branch + handleAddKnowledgePreview)
```

## Deviations from Plan

**1. [Task 2, non-architectural, discovered mid-TDD] `Handle` requires a real `ReactFlowProvider`
ancestor.** Mounting `<KnowledgePreviewNode>` directly (as the plan's own read_first note for
`use-data-bindings.test.tsx` implied would be sufficient) threw `"you have not used zustand provider
as an ancestor"` from the real `Handle` component (not mocked -- the plan explicitly requires
`Handle`/`Position` stay real). Fixed by wrapping every test mount in a real `<ReactFlowProvider>`
(imported from the same partially-mocked `@xyflow/react`, unaffected by the `useReactFlow`-only
override) -- no component code change, test-harness-only.

**2. [Task 2/3, non-architectural, both files] `import * as React from "react"` added explicitly.**
Mirrors Phase 39's `provenance-link.tsx` precedent (already documented in STATE.md): this repo's
vitest config lacks `@vitejs/plugin-react` and relies on esbuild's classic JSX transform under test,
which requires `React` to be in scope even though the JSX-consuming component files never call
`React.*` directly elsewhere.

**3. [Task 3, non-architectural] `AddKnowledgePreviewPopover`'s test queries `document.body` for
form-field assertions instead of the mounted container.** `packages/ui`'s `PopoverContent` renders
through a Radix `Portal` (appended to `document.body`, confirmed by reading `packages/ui/src/
popover.tsx` before writing the test) -- a `container.querySelector` convention (used successfully
for Task 1's `Tooltip`, which does NOT portal) would silently find nothing for `Popover`. `root.unmount()`
added to `afterEach` to tear down portaled DOM between tests and prevent cross-test pollution.

No architectural deviations (Rule 4 not triggered). No auth gates encountered. No package installs
attempted (zero new npm dependencies, as required, confirmed by `git diff --stat` against
`package.json`/lockfiles showing no changes this plan).

## Known Stubs

None. Every component built this plan is fully wired end-to-end: `KnowledgePreviewMiniGraph`
consumes real `knowledge.expandNode` data (no mock/placeholder data path in production code),
`KnowledgePreviewNode`'s remove button actually removes and persists, `AddKnowledgePreviewPopover`'s
`onAdd` actually materializes a real node on the canvas. No `TODO`/`FIXME` markers, no hardcoded
empty values flowing into a rendered surface.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-41-02, T-41-03, T-41-05, T-41-06, T-41-07,
T-41-08 -- all addressed exactly as designed: every href computed via `hrefFor`, never a
hand-duplicated/server-supplied route string; the Add-preview popover's free-text input gated by
`z.string().uuid().safeParse` before ever reaching `onAdd`/a persisted node/a tRPC call; zero
`@xyflow/react` `<ReactFlow>`/`ReactFlowProvider` mounts in either new UI file, grep-verified; the
pre-existing `MAX_CANVAS_NODES` cap and `canvas-schema.ts`'s generic `nodeDataSchema` unchanged and
still governing this node type).

## Self-Check: PASSED

- FOUND: apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx
- FOUND: apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-mini-graph.test.tsx
- FOUND: apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx
- FOUND: apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-node.test.tsx
- FOUND: apps/web/src/app/chat/_canvas/add-knowledge-preview-popover.tsx
- FOUND: apps/web/src/app/chat/_canvas/__tests__/add-knowledge-preview-popover.test.tsx
- FOUND: apps/web/src/app/chat/_canvas/node-types.ts ("knowledge-preview": KnowledgePreviewNode)
- FOUND: apps/web/src/app/chat/_canvas/chat-canvas.tsx (handleNodesChange, handleAddKnowledgePreview,
  AddKnowledgePreviewPopover mount)
- FOUND commit c7395db (Task 1 -- KnowledgePreviewMiniGraph, reconciled)
- FOUND commit e2a4547 (Task 2 -- KnowledgePreviewNode + node-types.ts)
- FOUND commit 2ed1578 (Task 3 -- AddKnowledgePreviewPopover + chat-canvas.tsx wiring)

All 8 created/modified source files confirmed present on disk; all 3 task commits (c7395db, e2a4547,
2ed1578) confirmed present in git history. No missing items.
