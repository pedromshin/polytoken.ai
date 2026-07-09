---
phase: 41-knowledge-preview-canvas-node
plan: 01
subsystem: chat-canvas-node-registry
tags: [node-type-registry, zod-boundary, ego-network-layout, PREV-01, hand-rolled-layout]
dependency_graph:
  requires:
    - "apps/web/src/app/chat/_canvas/node-type-registry.ts (2-entry registry + FNV-1a NODE_REGISTRY_VERSION hash, v1.3 FOUND-2)"
    - "apps/web/src/app/chat/_canvas/node-data-schemas.ts (per-node-type Zod .strict() boundary convention)"
    - "packages/api-client/src/router/knowledge/expand.ts (walkKnowledgeGraph's undirected-BFS traversal + EXPAND_BUDGET_CAP=50 -- read-only reference, not imported)"
  provides:
    - "apps/web/src/app/chat/_canvas/node-data-schemas.ts's KnowledgePreviewNodeDataSchema/KnowledgePreviewNodeData"
    - "apps/web/src/app/chat/_canvas/node-type-registry.ts's 3rd NODE_TYPE_REGISTRY entry, id 'knowledge-preview'"
    - "apps/web/src/app/chat/_canvas/canvas-layout.ts's explicit knowledge-preview CANVAS_NODE_DIMENSIONS entry (320x240)"
    - "apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts's MAX_PREVIEW_NODES/computeHopDistances/trimPreviewGraph/orderTwoHopByParent/layoutPreview"
  affects:
    - "Plan 41-02's knowledge-preview-node.tsx / knowledge-preview-mini-graph.tsx / add-knowledge-preview-popover.tsx / node-types.ts / chat-canvas.tsx (consumes every export from this plan)"
tech_stack:
  added: []
  patterns:
    - "3rd instance of the id + content-hash-version + Zod-schema + closed-allowlist registry contract (v1.3 FOUND-2) -- NODE_REGISTRY_VERSION recomputes automatically from the imported registry object, node-registry-version.ts itself untouched"
    - "Hand-rolled, framework-free, dependency-free pure layout module (no @xyflow/react, no @dagrejs/dagre) -- deliberately simpler than the app's own existing dagre-based /knowledge layoutGraph, per 41-CONTEXT.md's explicit 'hand-rolled, small' lock"
    - "Undirected BFS mirroring packages/api-client's walkKnowledgeGraph traversal exactly (both edge endpoints are frontier candidates regardless of source/target)"
key_files:
  created:
    - apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts
    - apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-layout.test.ts
  modified:
    - apps/web/src/app/chat/_canvas/node-data-schemas.ts
    - apps/web/src/app/chat/_canvas/node-type-registry.ts
    - apps/web/src/app/chat/_canvas/canvas-layout.ts
    - apps/web/src/app/chat/_canvas/__tests__/node-type-registry.test.ts
decisions:
  - "KnowledgePreviewNodeDataSchema carries no .refine() (unlike GenuiPanelNodeDataSchema's spec/root guard) -- this node's data (focusNodeId + optional label) has no spec/root ambiguity to guard against, per the plan's own read_first note"
  - "canvas-layout.ts gets an EXPLICIT knowledge-preview dimensions entry (320x240) even though it numerically equals DEFAULT_CANVAS_NODE_DIMENSIONS today -- prevents silent implicit-default drift later, matching the plan's explicit instruction"
  - "trimPreviewGraph's overflowCount is computed from the ORIGINAL input node count (nodes.length - cap), per 41-UI-SPEC.md section 3's exact formula -- not from the count of nodes actually dropped (the two numbers are always equal for this cap logic, but the formula is followed literally)"
metrics:
  duration: "~35 min"
  completed: 2026-07-09
---

# Phase 41 Plan 01: Knowledge-Preview Canvas Node -- Data Layer Foundation Summary

A 3rd, Zod-validated `knowledge-preview` `NODE_TYPE_REGISTRY` entry (focus node id + optional
80-char label, `.strict()`) plus a fully pure, fully tested `knowledge-preview-layout.ts` module
implementing the exact hop-distance / cap-trim / two-ring-ellipse algorithm `41-UI-SPEC.md` locks --
hand-rolled, not dagre, not a second React Flow. Touches zero React components and zero tRPC calls;
defines the contracts Plan 41-02's UI layer builds against.

## What Was Built

### Task 1 -- KnowledgePreviewNodeDataSchema + 3rd NODE_TYPE_REGISTRY entry + explicit node dimensions

`node-data-schemas.ts` gained a 3rd schema section, matching the file's existing per-schema
header-comment + `z.object(...).strict()` + exported-type convention exactly:
`KnowledgePreviewNodeDataSchema = z.object({ focusNodeId: z.string().uuid(), label:
z.string().max(80).optional() }).strict()` + `KnowledgePreviewNodeData` type export.

`node-type-registry.ts` imports the new schema and adds the 3rd `NODE_TYPE_REGISTRY` entry:
`"knowledge-preview": { id: "knowledge-preview", dataSchema: KnowledgePreviewNodeDataSchema,
description: "Knowledge-preview node -- renders a bounded, non-interactive knowledge-graph
subgraph anchored on a focus node id." }`. `resolveNodeType`/`ResolvedNodeType` untouched (both
generic over the registry object). `node-registry-version.ts` was NOT edited --
`NODE_REGISTRY_VERSION` recomputes automatically from the imported `NODE_TYPE_REGISTRY` object at
module load, confirmed by the pre-existing `NODE_REGISTRY_VERSION matches
computeNodeRegistryHash(NODE_TYPE_REGISTRY)` test still passing unchanged.

`canvas-layout.ts`'s `CANVAS_NODE_DIMENSIONS` gained an explicit `"knowledge-preview": { width:
320, height: 240 }` entry, matching `41-UI-SPEC.md` section 1's fixed `h-[240px] w-[320px]` shell
exactly (even though it happens to equal `DEFAULT_CANVAS_NODE_DIMENSIONS` today).

`__tests__/node-type-registry.test.ts` grew a new `describe("KnowledgePreviewNodeDataSchema")`
block (5 tests: valid-no-label, valid-with-label, non-uuid rejected, label>80 chars rejected,
unrecognized extra key rejected via `.strict()`) and one new `it("resolves 'knowledge-preview' to
its registered entry")` inside the existing `describe("resolveNodeType")` block. All 20 tests in
the file pass (14 pre-existing + 6 new).

### Task 2 -- knowledge-preview-layout.ts: hop distance, cap-trim, 2-hop ordering, two-ring ellipse layout

New `apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts`, fully framework-free (grep-verified
zero `@xyflow/react`/`@dagrejs/dagre` references anywhere including doc comments):

- `MAX_PREVIEW_NODES = 25` -- the locked cap.
- `computeHopDistances(focusId, edges)` -- plain BFS treating every edge as UNDIRECTED (mirrors
  `walkKnowledgeGraph`'s own `for (const candidate of [shaped.source, shaped.target])` traversal),
  returns a `ReadonlyMap<string, number>`; a node with no path to focus is simply absent (never
  `Infinity`).
- `trimPreviewGraph(focusId, nodes, edges, cap = MAX_PREVIEW_NODES)` -- implements the exact
  41-UI-SPEC.md section 3 priority: focus always kept; 1-hop kept in full up to `cap - 1`, or
  trimmed to the first N (stable order) with ALL 2-hop dropped if 1-hop alone exceeds budget;
  otherwise 2-hop fills whatever budget remains (stable order); dangling edges (either endpoint not
  in the kept set) silently dropped; `overflowCount = Math.max(0, nodes.length - cap)`.
- `orderTwoHopByParent(oneHopIds, twoHopIds, edges)` -- stable sort of `twoHopIds` by their
  connecting 1-hop parent's index within `oneHopIds` (unresolvable parents sort to the end via
  `Number.POSITIVE_INFINITY` rank, never throwing).
- `layoutPreview(focusId, oneHop, twoHop, box = {width:280,height:140})` -- focus at box center;
  ring 1 on an ellipse `rx=0.38*width, ry=0.38*height`; ring 2 on `rx=0.62*width, ry=0.62*height`;
  both rings evenly spaced by angle starting at 12 o'clock (`(i/n)*2*PI - PI/2`), in the exact order
  given (no re-sort, no collision detection, no randomness).

14 new tests cover all 13 documented behaviors (computeHopDistances undirected-traversal +
shorter-path-wins + absent-when-unreachable; trimPreviewGraph under-cap / fills-remaining-budget /
1-hop-alone-exceeds-budget / dangling-edge-drop; orderTwoHopByParent parent-rank-sort +
unresolvable-sorts-to-end; layoutPreview single-node-center / ring-1-ellipse-formula /
ring-2-ellipse-formula / determinism; plus a `MAX_PREVIEW_NODES === 25` sanity check).

## Verification

```
cd apps/web && npx vitest run src/app/chat/_canvas/__tests__/node-type-registry.test.ts src/app/chat/_canvas/__tests__/knowledge-preview-layout.test.ts
# Test Files  2 passed (2)
#      Tests  34 passed (34)  -- 20 node-type-registry + 14 knowledge-preview-layout

cd apps/web && npx tsc --noEmit -p tsconfig.json
# (clean, zero output)

grep -n "knowledge-preview" apps/web/src/app/chat/_canvas/node-type-registry.ts
# 46:  "knowledge-preview": {
# 47:    id: "knowledge-preview",

grep -n "export const KnowledgePreviewNodeDataSchema" apps/web/src/app/chat/_canvas/node-data-schemas.ts
# 73:export const KnowledgePreviewNodeDataSchema = z

grep -n "knowledge-preview" apps/web/src/app/chat/_canvas/canvas-layout.ts
# 30:  "knowledge-preview": { width: 320, height: 240 },

grep -c "computeNodeRegistryHash\|NODE_REGISTRY_VERSION" apps/web/src/app/chat/_canvas/node-registry-version.ts
# 3 (file untouched by this plan)

grep -n "export function computeHopDistances\|export function trimPreviewGraph\|export function orderTwoHopByParent\|export function layoutPreview\|export const MAX_PREVIEW_NODES" apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts
# all 5 present

grep -c "@xyflow/react\|@dagrejs/dagre" apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts
# 0

grep -c "MAX_PREVIEW_NODES = 25" apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts
# 1
```

## Deviations from Plan

**1. [Rule 1 -- bug fix, discovered during Task 1] Pre-existing `"is insensitive to registration
order"` test broke when the registry grew a 3rd entry.** That test builds a manually reordered
2-key subset (`genui-panel` + `chat`) and asserts its hash equals `computeNodeRegistryHash` of the
FULL `NODE_TYPE_REGISTRY` -- an assertion that only held while the full registry had exactly those
2 keys. Adding `knowledge-preview` (as the plan directs) made the subset's hash diverge from the
full registry's hash (missing the 3rd entry). Fixed by adding `knowledge-preview` to the reordered
object (still in a different insertion order than the source registry, preserving the test's
"order-insensitive" intent) -- verified: all 20 tests in the file pass, including this one.

**2. [Rule 3 -- non-architectural, discovered during Task 2 verification] Doc-comment prose
literally containing `@dagrejs/dagre`/`@xyflow/react` tripped the plan's own literal grep
acceptance criterion (`grep -c "@xyflow/react\|@dagrejs/dagre" ... is 0`).** The module's header
comment explained WHY these are not imported by naming them explicitly, which the grep (correctly,
per its purpose of catching an actual import) still matched as text. Reworded the prose to describe
"the dagre graph-layout library" / "a second React Flow instance" without the literal package-name
strings -- meaning unchanged, grep now returns 0, confirming no accidental import.

No architectural deviations (Rule 4 not triggered). No auth gates encountered. No package installs
attempted (zero new npm dependencies, as required).

## Known Stubs

None. Both the registry entry and the layout module are fully implemented, fully tested, and ready
for Plan 41-02's UI layer to consume directly -- no placeholder values, no `TODO`/`FIXME` markers,
no hardcoded empty data flowing anywhere (this plan touches zero rendering/UI code).

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-41-01, T-41-04, T-41-06-partial -- all
addressed exactly as designed: `.strict()` + `uuid()` + `max(80)` schema boundary for T-41-01;
`MAX_PREVIEW_NODES = 25` hard cap enforced before any layout math for T-41-04; zero
`@xyflow/react`/`@dagrejs/dagre` imports, grep-verified, for T-41-06's partial mitigation in this
plan).

## Self-Check: PASSED

- FOUND: apps/web/src/app/chat/_canvas/node-data-schemas.ts (KnowledgePreviewNodeDataSchema)
- FOUND: apps/web/src/app/chat/_canvas/node-type-registry.ts (knowledge-preview entry)
- FOUND: apps/web/src/app/chat/_canvas/canvas-layout.ts (knowledge-preview dimensions)
- FOUND: apps/web/src/app/chat/_canvas/__tests__/node-type-registry.test.ts (34 total incl. 6 new)
- FOUND: apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts
- FOUND: apps/web/src/app/chat/_canvas/__tests__/knowledge-preview-layout.test.ts
- FOUND commit d316a71 (Task 1 -- schema + registry entry + dimensions)
- FOUND commit 8a8c4a6 (Task 2 -- knowledge-preview-layout.ts + tests)

All 6 created/modified source files confirmed present on disk; both task commits (d316a71,
8a8c4a6) confirmed present in git history. No missing items.
