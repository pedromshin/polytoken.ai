# Phase 32: Knowledge Canvas: Tiered Graph Exploration - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous run — recommended answers auto-accepted per the user's standing
directive: never block, pick defaults, document)

<domain>
## Phase Boundary

Reviewers see and explore the confidence-tiered knowledge graph directly on `/knowledge`: tier is a
first-class visual concept (GRAPH-01: EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint), clicking
a node expands its neighbours via a bounded ≤2-hop server-side graph query (GRAPH-02), and a tier
filter narrows/widens the view (GRAPH-03, the budget-prune analog). Plus one small closure from
Phase 30's explicit deferral: a minimal promote affordance on suggestion-tier edges. NO stage-3
work (no BFS into prompts), no other `/knowledge` redesign.

</domain>

<decisions>
## Implementation Decisions

### Tier visual encoding (GRAPH-01)
- Applies to `kne-*` edges only (the knowledge_node_edges UNION seam — they carry `tier` since
  30-01). The 8 FK-derived structural edge types (has_field, instance_of, …) have no tier and keep
  their current styling untouched
- EXTRACTED = solid (current default stroke); INFERRED = dashed (`strokeDasharray`); AMBIGUOUS =
  faint (reduced-opacity stroke + label). Design tokens ONLY — no raw hex, no new colors (v1.4
  bans apply: teal primary discipline, no glassmorphism, docs/design/product-register-and-bans.md)
- Keep the existing convention: taxonomy edges (`TAXONOMY_RELATION_TYPES`) have no arrowhead
- Touch point: `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` `toFlowEdges`
  (lines ~127-147); a legend affordance for the three tiers is at Claude's discretion (small)

### Bounded click-expand (GRAPH-02)
- New READ-ONLY tRPC procedure (e.g. `knowledge.expandNode`): input `{nodeId, depth?}` with depth
  clamped to ≤2 and a hard node/edge budget cap (e.g. ~50 nodes); walks `knowledge_node_edges`
  (active edges) from the seed, returning nodes+edges in the existing GraphNode/GraphEdge shapes
- Read-only is consistent with the D-09 posture of the knowledge routers; Zod-validated input
  (boundary rule); tenant scope via the node's importer join (same as the graph query)
- Client: clicking a knowledge node triggers expand and MERGES results into the current canvas
  (dedupe by id; reuse dagre placement conventions for new nodes); a second click or re-expand is
  idempotent
- One graph-walk implementation serves exploration now and (if stage 3 is ever justified)
  retrieval later — implement the BFS in a shape that could be reused server-side (999.10's
  "one implementation serves both" point), but do NOT wire it anywhere near prompts

### Tier filter (GRAPH-03)
- Client-side segmented control: "Confirmed only" (EXTRACTED) → "+ Inferred" → "+ Ambiguous"
  (default: all shown, or Claude's discretion with rationale). Applies to tiered `kne-*` edges;
  structural FK edges are unaffected by the filter
- Reuse the existing both-endpoints-visible edge filtering so orphaned nodes degrade exactly as
  today; the control lives with the graph's existing toolbar/controls area, styled with existing
  primitives (@nauta/ui), zero new npm dependencies

### Promote affordance (Phase-30 deferral closure — small, discretionary scope)
- Suggestion-tier (INFERRED/AMBIGUOUS) `kne-*` edges get a click affordance opening a small
  detail surface (popover/panel) showing relation, tier, confidence, provenance summary — with a
  "Promote to confirmed" button for suggestion tiers
- Wire: Next.js API proxy route (server-side X-API-Key injection, same two-hop-key pattern as the
  chat/widget proxies) → FastAPI `POST /v1/knowledge/edges/{id}/promote` (Phase 30). On success,
  refetch/patch the edge to EXTRACTED styling
- This is a MINIMAL affordance (one popover, one button, error toast on 4xx) — not a review queue,
  not bulk operations. If it threatens to balloon, planner may cut it to edge-detail-only and
  log the promote button as a deferred item — GRAPH-01..03 remain the phase's requirements

### Claude's Discretion
- Legend, default filter state, expand-interaction details (double-click vs click vs button),
  popover component choice (existing @nauta/ui primitives), exact budget caps
- Test strategy: vitest for pure derivations (edge styling map, filter logic, merge/dedupe),
  api-client tests for expandNode (Zod shapes, depth clamp, budget), TestClient not needed
  (no FastAPI changes expected beyond what exists)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` — `toFlowEdges` (styling touch
  point), both-endpoints-visible filter (~lines 254-266), `TAXONOMY_RELATION_TYPES`
- `graph-nodes.tsx` (node components), `graph-layout.ts` (dagre)
- `packages/api-client/src/router/knowledge/graph.ts` — GraphEdge now carries `tier` +
  `isActive` filtering (30-01, `shapeExplicitEdgeRow`); router conventions for a new
  `expandNode` procedure live here
- Phase-30 endpoint: `POST /v1/knowledge/edges/{id}/promote` (apps/email-listener
  app/presentation/api/v1/knowledge_edges.py) — fail-closed 4xx semantics already tested
- Proxy pattern: apps/web chat widget submit proxy (server-side API-key injection)
- React Flow chrome/tokens: v1.4 already token-styled Controls/MiniMap/Background on /chat —
  /knowledge conventions predate that but the token discipline applies to anything touched
- Design contracts: docs/design/product-register-and-bans.md (13 bans), WCAG-AA contrast +
  token-registration regression tests exist app-wide

### Established Patterns
- Zero new npm dependencies (standing v1.4 discipline — everything needed exists: React Flow,
  @nauta/ui popover/toast primitives, TanStack Query via tRPC)
- Zod at every boundary; read-only knowledge routers (D-09); suggest-only hard constraint —
  the ONLY trust-raising action is the Phase-30 promote endpoint, human-clicked
- Tests: vitest (apps/web, packages/api-client), `npm test --workspace=...`; `npx tsc --noEmit`

### Integration Points
- `/knowledge` page container → graph island; toolbar/controls area for the filter
- tRPC router registration for expandNode; api-client exported types
- Next API route for the promote proxy (apps/web/src/app/api/...)

</code_context>

<specifics>
## Specific Ideas

- Graphify mapping (999.10): click-expand = seed-then-expand BFS as the canvas interaction model;
  tier filter = budget-aware pruning as a "detail slider"; tier styling reuses the "taxonomy edges
  have no arrowhead" convention precedent
- Design-case demo path this phase enables: confirm a region → see EXTRACTED edges + suggestions
  appear on /knowledge → filter to confirmed-only → promote a suggestion live

</specifics>

<deferred>
## Deferred Ideas

- Review queue / bulk promote-dismiss operations — beyond the minimal affordance
- Dismiss (deactivate) affordance — Phase 30 chose not to ship the endpoint; revisit with a
  real review-queue design
- `/chat` canvas knowledge-subgraph panel — speculative v-next (999.10's own note)
- Any BFS wiring toward prompts — stage 3, gated by the Phase-31 miss-rate artifact

</deferred>
