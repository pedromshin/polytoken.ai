# Phase 41: Knowledge-Preview Canvas Node - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning (planner MUST read Phase 39's SUMMARY for the ProvenanceLink primitive it consumes; a UI-SPEC via ui-phase is warranted — this is a real visual surface)
**Mode:** Smart discuss, autonomous (source: SYNTHESIS.md Fork 1 Phase C, locked; nested React Flow REJECTED)

<domain>
## Phase Boundary

User can place a `knowledge-preview` node on the `/chat` canvas — the 3rd `NODE_TYPE_REGISTRY`
entry — rendering a bounded, NON-INTERACTIVE subgraph from v1.5's ≤2-hop `knowledge.expandNode`
tRPC endpoint, deep-linking out to `/knowledge?focus={id}` via Phase 39's `<ProvenanceLink>` on
click. Requirement: PREV-01. Web/TS only. The single most-gated phase — plan/execute LAST. No
migrations, no Python.

</domain>

<decisions>
## Implementation Decisions

### Node type + registry
- 3rd entry in `NODE_TYPE_REGISTRY` (`node-type-registry.ts` — currently a 2-entry closed allowlist): `knowledge-preview`, with Zod-validated node data (focus node id + optional label), content-hash `NODE_REGISTRY_VERSION` recomputes automatically. Unknown-type degrade (v1.3) already protects old snapshots; adding an entry must not break existing layouts (registry tests updated).
- Node placement UX: minimal — an "Add knowledge preview" affordance consistent with how canvas nodes currently appear (planner reads how chat/genui-panel nodes get created; if panels only appear via genui emission, add a small canvas toolbar action for this node; keep it token-styled and unobtrusive).
- Focus-node selection: simplest honest v1 — the node data carries a knowledge node id; the affordance lets the user paste/pick an id from... (planner verifies what's cheap: if an entity/knowledge picker exists reuse it; else accept the deep-link/manual id path and note the picker as deferred polish). Do not build a full search UI inside the node — `search_knowledge` chat tool + /knowledge canvas already cover discovery.

### Rendering (the hard constraint)
- **NOT a nested React Flow** (confirmed hazard: duplicate providers, wheel/drag capture, persistence blindness). Render the bounded subgraph as plain SVG (or absolutely-positioned divs + SVG edges) inside the node body: static layout computed from the expandNode response (simple radial/level layout util — hand-rolled, small), tier visual encoding REUSED from /knowledge conventions (EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint; token colors only).
- NON-INTERACTIVE inside: no pan/zoom/drag of the mini-graph. The ONLY interactions: node body click-through → `/knowledge?focus={id}` (via `<ProvenanceLink>` semantics — real links), and the standard canvas node chrome (drag handle, remove) from the existing node shell.
- Bounded: render whatever expandNode's budget returns (≤2 hops, ~50 nodes) but CAP visible nodes (~25) with a "+N more — open in Knowledge" footer link; never overflow the node.
- Data via existing tRPC hooks (`knowledge.expandNode`) with TanStack defaults + a modest staleTime; importer-scoped server-side already. This is app UI calling tRPC directly — the model-facing `ALLOWED_PROCEDURES` gate is not implicated and is NOT touched.

### Persistence + design
- Node data persists through the existing `CanvasSnapshotSchema`/`useCanvasPersistence` path (schema extended for the new node type's data, Zod-gated; over-cap and pollution rules preserved).
- Design: nauta-design-system constraints hard (Tailwind v3.4/React 18/Radix, tokens only, zero new npm deps, elevation/radius scale from v1.4, reduced-motion-gated entrance consistent with GenuiPanelNode). frontend-design skill is the floor. Visual check via playwright-core loop, else human_needed (precedent).
- Locked files stay byte-identical (spec-renderer/render-node/genui-part-boundary untouched — this node does not render genui specs).

### Claude's Discretion
- Layout algorithm details (radial vs layered), visible-node cap value, empty/error/loading states inside the node (mirror EmptyState primitive), whether label truncation shows tooltips (Radix tooltip exists).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `node-type-registry.ts` (2-entry registry + FNV-1a version hash), `GenuiPanelNode` (node shell/chrome/entrance conventions), `CanvasSpecContext` seam (NOT needed here — this node owns its data), `useCanvasPersistence` + `CanvasSnapshotSchema`, `knowledge.expandNode` tRPC (packages/api-client/src/router/knowledge/expand.ts — hard budget caps at T-32-01), /knowledge tier edge-encoding conventions (solid/dashed/faint), Phase 39's `<ProvenanceLink>`, `EmptyState` primitive (v1.4).

### Established Patterns
- Registry: id + content-hash version + Zod schema + closed allowlist; unknown-type degrade; volatile content NEVER in React Flow node.data (but this node's data is a stable id — fine); token-only styling.

### Integration Points
- `NODE_TYPE_REGISTRY`, canvas toolbar/creation affordance, `CanvasSnapshotSchema`, `ProvenanceLink`, `knowledge.expandNode`.

</code_context>

<specifics>
## Specific Ideas

- PREV-01 verbatim: bounded, non-interactive, deep-links out. The moment a plan reaches for a second `<ReactFlow>`, it has violated the locked research.
- The tier encoding must match /knowledge exactly — one visual language for trust across surfaces (design-case narrative).

</specifics>

<deferred>
## Deferred Ideas

- Inline-interactive mini pan/zoom → explicitly deferred fallback, only if the static preview proves insufficient (Fork 1).
- Entity/knowledge picker UI for focus selection → polish backlog if no cheap reuse exists.
- Auto-suggesting a preview node from chat tool results → anticipatory territory (25-SPIKE conditions), not this phase.

</deferred>
