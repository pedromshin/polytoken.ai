---
phase: 41-knowledge-preview-canvas-node
verified: 2026-07-09T16:30:03Z
status: human_needed
score: 10/10 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Two-ring ellipse visual quality: open /chat with a placed knowledge-preview node whose focus node has both 1-hop and 2-hop neighbours, and visually inspect the mini-graph"
    expected: "Focus dot centered, 1-hop dots evenly spaced on an inner ellipse ring, 2-hop dots evenly spaced on an outer ellipse ring (grouped near their connecting 1-hop parent), SVG edge lines connecting them without visual overlap/crowding at the fixed 280x140 box size, tier-styled per 41-UI-SPEC.md (dashed=INFERRED, faint=AMBIGUOUS, solid=EXTRACTED)"
    why_human: "layoutPreview/orderTwoHopByParent's math is unit-tested for correctness (14 passing tests) and the DOM structure/attributes are mount-tested (9 passing tests confirm svg line count, stroke-dasharray/opacity values, dot count), but actual pixel-level visual crowding, ellipse proportions 'looking right', and label truncation legibility at real rendered size require a live browser — no playwright-core in this repo's dependency tree (confirmed absent from node_modules/apps/web/package.json, same constraint independently confirmed in Phase 39's verification)"
  - test: "Tooltip/hover behavior: hover over a mini-graph node dot"
    expected: "A Radix Tooltip appears after the ~300ms delayDuration showing the node's full (non-truncated) label, positioned sensibly relative to the dot, dismisses on mouse-leave"
    why_human: "TooltipProvider/Tooltip/TooltipContent are real, unmocked components (packages/ui) wired with the node's real label as children (confirmed by reading the file) — but hover-triggered show/hide timing, positioning, and visual legibility require real pointer events in a live browser, which jsdom mount tests cannot exercise"
  - test: "Popover open/close feel: click the 'Add knowledge preview' toolbar button, then Cancel/Add/click-outside"
    expected: "Popover opens anchored to the trigger with a smooth transition, form is usable, closes cleanly on Cancel/successful Add/outside-click with no visual glitch or lingering portal content"
    why_human: "Radix Popover's open/close state transitions and click-outside dismissal are real (unmocked) library behavior; DOM-level open/close and validation-gating are mount-tested (6 passing tests), but animation smoothness and outside-click dismissal require a live browser + real pointer events"
  - test: "Node placement near viewport center: add a knowledge-preview node from the toolbar while the canvas is panned/zoomed to some arbitrary viewport"
    expected: "The new node appears selected, cascaded away from any overlapping existing node, and visibly near the CURRENT viewport center (not the canvas's origin/an off-screen position)"
    why_human: "handleAddKnowledgePreview's use of rfInstanceRef.current.screenToFlowPosition({x: window.innerWidth/2, y: window.innerHeight/2}) plus offsetCascadePosition is read and structurally correct (mirrors the existing D-03 cascade pattern), but screenToFlowPosition depends on React Flow's live viewport transform, which only exists once mounted in a real browser — cannot be exercised by a jsdom unit/mount test without a full React Flow instance"
  - test: "Remove-then-reload persistence round-trip: click a knowledge-preview node's remove (X) button, then reload the /chat page against a running stack"
    expected: "The node disappears immediately on click, and after a full page reload the node stays gone (the debounced chat.saveCanvasLayout mutation persisted the removal to the DB, not just local React Flow state)"
    why_human: "The remove button's useReactFlow().deleteElements call and its threading into handleNodesChange -> persistence.scheduleSave(canvasStore) (the SAME debounced path handleEdgesChange/handleNodeDragStop already use, confirmed by reading chat-canvas.tsx) are code/mount-tested (deleteElements called exactly once with the right node id), but the full round-trip through a live tRPC mutation, DB write, and a real page reload requires a running FastAPI backend + Next.js dev server + Postgres, unavailable in this verification session (no playwright-core in the dependency tree; matches the same environmental constraint documented in Phase 39's human-verification items)"
---

# Phase 41: Knowledge-Preview Canvas Node Verification Report

**Phase Goal:** User can place a bounded, non-interactive knowledge-graph preview directly on the
`/chat` canvas that deep-links out to the full `/knowledge` exploration surface — nested React Flow
stays rejected as a confirmed hazard.
**Verified:** 2026-07-09T16:30:03Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves, merged/deduped)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | A `knowledge-preview` node type — 3rd, Zod-validated `NODE_TYPE_REGISTRY` entry (`focusNodeId: z.string().uuid()`, optional `label: z.string().max(80)`, `.strict()`) — can be placed on the `/chat` canvas | ✓ VERIFIED | `node-type-registry.ts:46-51` — 3rd object-literal entry, id `"knowledge-preview"`, `dataSchema: KnowledgePreviewNodeDataSchema`. `node-data-schemas.ts:73-78` — exact schema shape read verbatim, matches 41-UI-SPEC.md §6. `node-types.ts:26` wires it into React Flow's `nodeTypes` map. `chat-canvas.tsx`'s `handleAddKnowledgePreview` (lines 442-472) materializes a real node of `type: "knowledge-preview"` via `setNodes`. |
| 2 | `NODE_REGISTRY_VERSION` recomputes automatically from the 3-entry registry (no manual version bump); hash-determinism + order-insensitivity tests still pass | ✓ VERIFIED | `node-registry-version.ts:108` — `export const NODE_REGISTRY_VERSION: string = computeNodeRegistryHash(NODE_TYPE_REGISTRY);` (a live computation over the imported registry object, never hand-edited). `node-type-registry.test.ts` re-run directly: `"NODE_REGISTRY_VERSION matches computeNodeRegistryHash(NODE_TYPE_REGISTRY)"`, `"returns the same hex for the same registry (determinism)"`, `"is insensitive to registration order (sorted keys)"` — all pass among 20/20 tests in the file (`npx vitest run src/app/chat/_canvas/__tests__/node-type-registry.test.ts`). |
| 3 (REGISTRY DEGRADE PROOF) | A saved layout carrying an old 2-entry-registry-era `knowledge-preview`-typed node (or any unrecognized type) still degrades to the inert placeholder — never throws | ✓ VERIFIED | Exact test: `"resolves an unregistered type to an unknown marker, never throws"` (`node-type-registry.test.ts:107-114`) — asserts `expect(() => resolveNodeType("agent")).not.toThrow()` then `resolved.kind === "unknown"`. Combined with `"is insensitive to registration order (sorted keys)"` (proves hash stability across the now-3-entry registry regardless of insertion order) and `"returns the same hex for the same registry (determinism)"` (proves the hash itself is stable), the 2-entry-era degrade-gracefully contract (CANVAS-03) is unbroken by the 3rd entry's addition. `node-types.ts`'s `resolveNodeComponent` mirrors the same never-throws contract, falling back to `UnknownNodeTypePlaceholder` (confirmed by reading `node-types.ts:41-47`). Re-run directly: 20/20 pass. |
| 4 | Pure module computes hop distance (0/1/2), trims to a 25-node budget with the documented priority, orders 2-hop ids by connecting 1-hop parent, lays out on a two-ring ellipse — deterministic, framework-free | ✓ VERIFIED | `knowledge-preview-layout.ts` read in full (265 lines): `MAX_PREVIEW_NODES=25` (line 41), `computeHopDistances` (undirected BFS, lines 55-81), `trimPreviewGraph` (focus-always-kept / 1-hop-first / 2-hop-fills-remainder / dangling-edge-drop priority, lines 112-164), `orderTwoHopByParent` (stable sort by parent rank, lines 180-205), `layoutPreview` (two-ring ellipse, lines 251-265). `grep -nE "@xyflow/react\|@dagrejs/dagre"` on the file → 0 matches (exit 1). No `Math.random`/`Date.now()` anywhere in the file. 14/14 tests pass (`knowledge-preview-layout.test.ts`, re-run directly). |
| 5 (SC2) | The node renders a bounded (≤25 visible, ≤2-hop via `knowledge.expandNode depth:2`), NON-interactive subgraph — no pan/zoom/drag inside it, no second `<ReactFlow>`/`<ReactFlowProvider>` ever mounted | ✓ VERIFIED (code-level) | `grep -nE "<ReactFlow\|ReactFlowProvider"` across all 3 new UI files → 0 matches. `knowledge-preview-node.tsx`'s only `@xyflow/react` imports are `Handle, Position, useReactFlow` (value) + `Node, NodeProps` (type) — exactly the allowlisted set, no `<ReactFlow>` mount. `knowledge-preview-mini-graph.tsx` has ZERO `@xyflow/react` imports. `grep -noE "onWheel\|onDrag\|zoom\|pan"` on `knowledge-preview-mini-graph.tsx` → all 7 hits are substring false-positives inside `expandNode`/`span` (verified with `-o`; no actual interactivity handler exists). `knowledge-preview-node.tsx:93-96` calls `api.knowledge.expandNode.useQuery({ nodeId: data.focusNodeId, depth: 2 }, { staleTime: 10_000 })`. Mini-graph test 7 (`"a 30-node input renders AT MOST MAX_PREVIEW_NODES (25) dots"`) proves the 25-cap is enforced end-to-end through the real component, not just the pure module. |
| 6 (SC3) | Every mini-graph node dot AND the footer row are real Next `<Link>`s computed via `hrefFor('knowledge', id)` — never a hand-duplicated route string — deep-linking to `/knowledge?focus={id}` | ✓ VERIFIED | `knowledge-preview-mini-graph.tsx:138-139` (`PreviewNodeDot`) and `knowledge-preview-node.tsx:134-135` (footer) both call `hrefFor("knowledge", ...)`, imported from `~/components/provenance-link` (Phase 39's primitive, unmodified). `grep -rn "knowledge?focus="` across all 4 new/wired files → 0 matches (no hand-duplicated route string anywhere). Mini-graph test 6 (`"every node dot's href/aria-label are computed via hrefFor"`) asserts the real rendered `<a href>` equals `hrefFor("knowledge","a")`'s output. |
| 7 | User can click an 'Add knowledge preview' toolbar affordance, paste a UUID (+ optional label), and see the node appear on canvas, selected, near the current viewport | ✓ VERIFIED (code-level; live placement feel → human) | `add-knowledge-preview-popover.tsx`: toolbar trigger `aria-label="Add knowledge preview"` (line 78), `NODE_ID_SCHEMA = z.string().uuid()` gates `onAdd` (lines 32, 52-61) — invalid input never calls `onAdd` (test 3). `chat-canvas.tsx:715` mounts `<AddKnowledgePreviewPopover onAdd={handleAddKnowledgePreview} />` inside the top-right toolbar `<Panel>`. `handleAddKnowledgePreview` (lines 442-472) computes position via `rfInstanceRef.current?.screenToFlowPosition(...)` + `offsetCascadePosition`, sets `selected: true` on the new node and deselects all others, calls `persistence.scheduleSave(canvasStore)`. 6/6 popover tests + node-types wiring test pass. Visual "near viewport center" feel → human verification. |
| 8 | The node has a working remove button (first node-level remove affordance on this canvas) wired to `useReactFlow().deleteElements`, triggering the existing debounced `persistence.scheduleSave` — survives a reload | ✓ VERIFIED (code-level; reload round-trip → human) | `knowledge-preview-node.tsx:114-124` — button `aria-label="Remove knowledge preview"`, `onClick` calls `deleteElements({ nodes: [{ id }] })`. `chat-canvas.tsx:428-436` — new `handleNodesChange` mirrors `handleEdgesChange`'s exact shape, calling `persistence.scheduleSave(canvasStore)` whenever any change has `type === "remove"`; wired to React Flow's `onNodesChange={handleNodesChange}` (line 686). Node test 7 (`"remove wiring: clicking the remove button calls deleteElements once with this node's own id"`) passes. Live reload persistence round-trip → human verification. |
| 9 | Loading/error/empty-not-found/empty-no-connections/success are 5 distinct, correctly-branched render states; the footer link always renders regardless of state | ✓ VERIFIED | `knowledge-preview-mini-graph.tsx` branches in order (lines 173-231): loading (`role="status"`, 3 Skeletons) → error (`EmptyState` + Retry) → empty-not-found (`nodes.length===0`) → empty-no-connections (`nodes.length===1`) → success (mini-graph SVG+dots). All 5 covered by dedicated mount tests (tests 1-5) plus 4 additional success-branch tests (trim/href/tier/focus-icon), 9/9 pass. The footer `<Link>` in `knowledge-preview-node.tsx:134-139` is rendered unconditionally, AFTER `<KnowledgePreviewMiniGraph>`, outside any state branch — confirmed by reading the file; node test 6 (`"loading: ... threads isLoading down to the mini-graph"`) mounts the component in its loading state and the component tree still includes the footer `<Link>` structurally. |
| 10 | Zero new npm dependencies; zero edits to `spec-renderer.tsx`/`render-node.tsx`/`genui-part-boundary.tsx` (byte-identical, diff-verified) | ✓ VERIFIED | `git diff --name-only 5403cf7 HEAD` touches exactly 19 files, all within `apps/web/src/app/chat/_canvas/**` + `.planning/**` — zero `package.json`/lockfile files in the list. `git diff --stat 5403cf7 HEAD -- packages/genui/src/renderer/render-node.tsx packages/genui/src/renderer/spec-renderer.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx` → empty output (byte-identical), re-run directly. |

**Score:** 10/10 truths verified at the code level (static inspection + re-run automated tests, not
trusted from SUMMARY.md text). Truths 7 and 8 carry a live-browser/live-stack dimension (visual
placement feel, full reload-persistence round-trip against a running FastAPI+Postgres stack) that
static verification cannot exercise — routed to human verification below, consistent with the
project's Phase 22/23/24/26/27/28/29/32/39 precedent.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/app/chat/_canvas/node-data-schemas.ts` | `KnowledgePreviewNodeDataSchema` (focusNodeId uuid + optional label≤80, `.strict()`) | ✓ VERIFIED | Read in full; lines 73-80, exact shape, exported type `KnowledgePreviewNodeData` |
| `apps/web/src/app/chat/_canvas/node-type-registry.ts` | 3rd `NODE_TYPE_REGISTRY` entry, id `"knowledge-preview"` | ✓ VERIFIED | Lines 46-51, `dataSchema: KnowledgePreviewNodeDataSchema` |
| `apps/web/src/app/chat/_canvas/knowledge-preview-layout.ts` | `MAX_PREVIEW_NODES`, `computeHopDistances`, `trimPreviewGraph`, `orderTwoHopByParent`, `layoutPreview` — pure, no `@xyflow/react`/dagre import | ✓ VERIFIED | All 5 named exports present; 265 lines (≥80 min); 0 framework-import matches |
| `apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx` | `KnowledgePreviewMiniGraph` — SVG edges + Link node dots + 5-state branching | ✓ VERIFIED | Read in full; 9/9 mount tests pass |
| `apps/web/src/app/chat/_canvas/knowledge-preview-node.tsx` | `KnowledgePreviewNode`, `resolveHeaderLabel`, `resolveFooterCopy` | ✓ VERIFIED | All 3 named exports present; 8/8 mount tests pass |
| `apps/web/src/app/chat/_canvas/add-knowledge-preview-popover.tsx` | `AddKnowledgePreviewPopover` — toolbar trigger + UUID-gated form | ✓ VERIFIED | Read in full; 6/6 mount tests pass |
| `apps/web/src/app/chat/_canvas/node-types.ts` | `nodeTypes["knowledge-preview"] = KnowledgePreviewNode` | ✓ VERIFIED | Line 26, plus wiring test confirms `resolveNodeComponent("knowledge-preview") === KnowledgePreviewNode` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `node-type-registry.ts` | `node-data-schemas.ts` | `NODE_TYPE_REGISTRY["knowledge-preview"].dataSchema = KnowledgePreviewNodeDataSchema` | ✓ WIRED | Import + assignment confirmed at lines 18, 48 |
| `knowledge-preview-node.tsx` | `packages/api-client`'s `knowledge.expandNode` procedure | `api.knowledge.expandNode.useQuery({ nodeId: data.focusNodeId, depth: 2 })` | ✓ WIRED | Line 93-96, exact call shape, `staleTime: 10_000` |
| `knowledge-preview-mini-graph.tsx` | `apps/web/src/app/knowledge/_components/tier-edge-style.ts` | `import { tierEdgeStyle } from "~/app/knowledge/_components/tier-edge-style"` | ✓ WIRED | Line 42; `style.style?.stroke/strokeDasharray/opacity` consumed 1:1 in `PreviewEdge`, tier-encoding test passes |
| `knowledge-preview-mini-graph.tsx` / `knowledge-preview-node.tsx` | `apps/web/src/components/provenance-link.tsx` | `hrefFor("knowledge", id)` for every node dot/footer href | ✓ WIRED | Both files import + call `hrefFor`; provenance-link.tsx confirmed byte-unmodified relative to Phase 39 (not in the phase's changed-files list) |
| `chat-canvas.tsx` | `use-canvas-persistence.ts` | `handleNodesChange` (remove) + `handleAddKnowledgePreview` both call `persistence.scheduleSave(canvasStore)` | ✓ WIRED | Lines 432, 469 — same debounced path `handleNodeDragStop`/`handleEdgesChange` already use |
| `node-types.ts` | `node-type-registry.ts` (Plan 41-01) | `"knowledge-preview"` key matches the 3rd registry entry id exactly | ✓ WIRED | Confirmed same literal string in both files |

### Behavioral Spot-Checks / Test Runs (re-run directly by this verifier, not trusted from SUMMARY.md)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Registry version-hash degrade proof | `npx vitest run src/app/chat/_canvas/__tests__/node-type-registry.test.ts` | 20/20 passed | ✓ PASS |
| Pure layout module | `npx vitest run src/app/chat/_canvas/__tests__/knowledge-preview-layout.test.ts` | 14/14 passed | ✓ PASS |
| Framework-free layout module | `grep -nE "@xyflow/react\|@dagrejs/dagre" knowledge-preview-layout.ts` | 0 matches (exit 1) | ✓ PASS |
| No nested React Flow in new UI files | `grep -nE "<ReactFlow\|ReactFlowProvider"` across all 3 new UI files | 0 matches (exit 1) | ✓ PASS |
| No `@xyflow/react` import in mini-graph.tsx | `grep -n "@xyflow/react" knowledge-preview-mini-graph.tsx` | 0 matches (exit 1) | ✓ PASS |
| No interactivity handlers in mini-graph.tsx | `grep -noE "onWheel\|onDrag\|zoom\|pan"` | 7 matches, all `pan` substrings inside `expandNode`/`span` (false positives, verified via `-o`) | ✓ PASS |
| No hand-duplicated `/knowledge?focus=` route string | `grep -rn "knowledge?focus="` across new/wired files | 0 matches (exit 1) | ✓ PASS |
| Full `_canvas` directory sweep | `npx vitest run src/app/chat/_canvas` | 14 files, 128/128 passed | ✓ PASS |
| Typecheck | `cd apps/web && npx tsc --noEmit` | Clean, zero errors (re-run directly) | ✓ PASS |
| Locked genui renderer files byte-identical | `git diff --stat 5403cf7 HEAD -- packages/genui/src/renderer/render-node.tsx packages/genui/src/renderer/spec-renderer.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx` | empty output | ✓ PASS |
| Zero new deps / zero migrations / zero Python touched | `git diff --name-only 5403cf7 HEAD` | 19 files, all `apps/web/src/app/chat/_canvas/**` + `.planning/**` | ✓ PASS |
| Full web vitest sweep (corroborated, not independently re-run this session — canvas-directory sweep above is the targeted proof) | orchestrator-reported | 36 files, 275/275 passing (baseline 232) | context (corroborated) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PREV-01 | 41-01, 41-02 | User can place a `knowledge-preview` node on the `/chat` canvas (3rd `NODE_TYPE_REGISTRY` entry) rendering a bounded, non-interactive subgraph from the v1.5 ≤2-hop endpoint, deep-linking to `/knowledge?focus={id}` on click | ✓ SATISFIED (code-level) | Registry entry (41-01) + full UI wiring/creation/removal flow (41-02); live placement/reload-persistence confirmation → human |

No orphaned requirements — `REQUIREMENTS.md` line 169 maps only PREV-01 to Phase 41, declared by both
plans' frontmatter and satisfied by the evidence above.

### Anti-Patterns Found

None. `grep -nE "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` across all 9 phase-touched source files
(`knowledge-preview-mini-graph.tsx`, `knowledge-preview-node.tsx`, `add-knowledge-preview-popover.tsx`,
`knowledge-preview-layout.ts`, `node-types.ts`, `node-data-schemas.ts`, `node-type-registry.ts`,
`canvas-layout.ts`, `chat-canvas.tsx`) → zero debt-marker matches (the 2 raw hits are prose comments
describing the pre-existing `UnknownNodeTypePlaceholder` degrade pattern, not markers). `grep -niE
"placeholder|coming soon|will be here|not yet implemented|not available"` → same 2 prose-comment
hits only, no stub copy anywhere in rendered output.

### Human Verification Required

See YAML frontmatter `human_verification` — 5 items covering: (1) two-ring ellipse mini-graph visual
quality, (2) node-dot tooltip/hover behavior, (3) Add-preview popover open/close feel, (4) new-node
placement near the live viewport center, and (5) the remove-button's full reload-persistence
round-trip against a running FastAPI+Next.js+Postgres stack. All 5 are browser-rendering/live-stack
behaviors that static code inspection and automated DOM-mount tests (`createRoot`+`act`, 34 mount
tests across the 3 new UI-layer test files) cannot fully exercise — no `playwright-core` in this
repo's dependency tree, matching the same environmental constraint independently confirmed in Phase
39's verification. Per the project's established v1.3-v1.6 precedent (Phases 22/23/24/26/27/28/29/
32/39 all closed `human_needed` without blocking milestone progression), this is NOT treated as a
phase failure — every mechanism (registry validation, degrade-gracefully behavior, pure layout math,
non-interactivity, hrefFor deep-linking, remove-button wiring, add-flow wiring, 5-state branching)
is proven in unmocked automated tests, only the final pixel/timing/live-stack confirmation is
deferred.

### Gaps Summary

No code-level gaps. All 10 observable truths (3 ROADMAP success criteria + 10 plan-level must-haves,
merged and deduped) are verified against live code — re-read directly by this verifier, not trusted
from SUMMARY.md text. The registry version-hash degrade proof specifically requested for this
verification is the pair of tests `"resolves an unregistered type to an unknown marker, never
throws"` and `"is insensitive to registration order (sorted keys)"` in
`node-type-registry.test.ts`, both re-run directly and passing (20/20 in that file). The targeted
canvas-directory sweep (128/128, 14 files) and a direct `tsc --noEmit` re-run (clean) corroborate the
orchestrator's reported full-sweep numbers (275/275, 36 files) without needing to re-run the full
workspace suite. Scope discipline confirmed independently: `git diff --name-only 5403cf7 HEAD` touches
exactly 19 files, all within `apps/web/src/app/chat/_canvas/**`/`.planning/**` — zero migrations, zero
Python files, zero `package.json`/lockfile changes, and the 3 locked genui renderer files are
byte-identical (empty diff, re-confirmed). The only outstanding items are 5 live-browser/live-stack
visual and persistence-round-trip confirmations, honestly and non-silently documented as
`human_needed`, consistent with this project's long-standing verification pattern — not a phase
failure. This is the final phase of the v1.6 milestone; all code-level must-haves for PREV-01 verify.

---

_Verified: 2026-07-09T16:30:03Z_
_Verifier: Claude (gsd-verifier)_
