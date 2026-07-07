# Requirements: nauta.services.email-listener — Milestone v1.5 Knowledge-Graph Uplift

**Defined:** 2026-07-07
**Core Value:** Reliably receive every inbound email and make it observable — nothing lost, everything logged — as the foundation for parsing, persistence, and the agentic pipeline.

Scope source: backlog **999.10** (`.planning/phases/999.10-knowledge-graph-uplift-graphify-adoption/NOTE.md`,
captured 2026-07-07) — adopt graphify's *algorithms* (tier ladder, bounded expand, tier-pruned detail)
onto the live Postgres store, per its own staged cost/benefit ordering: stage 1 (wire the dormant
synthesis hook) + stage 2 (tier ladder + suggest-only promotion gate) + the cheap recall win, with
stage 3 (BFS-into-prompts, budget-pruning of prompts, snapshot/diff) explicitly deferred until a
retrieval miss is *measured*. Requirements were defined autonomously (run invoked as
`/gsd:new-milestone /gsd:autonomous`; all confirmation gates off in config).

## v1.5 Requirements

### Edge Materialization (SYNTH)

The scaffolded no-op synthesis hook (`apps/email-listener/app/application/use_cases/confirm_region.py:169`)
goes live: confirms feed the Phase-11 `knowledge_node_edges` table (currently empty + read-only) so
corrections compound. Without this, every other borrow is a no-op.

- [ ] **SYNTH-01**: Confirming a region materializes knowledge nodes and EXTRACTED-tier `knowledge_node_edges` rows linking the confirmed entity/field to its knowledge context (co-occurring entities, importer scope)
- [x] **SYNTH-02**: Materialized edges carry OCR token-polygon provenance identifying exactly which tokens the knowledge came from
- [x] **SYNTH-03**: Re-confirming or superseding a region updates its edges supersede-safely — no duplicate or orphaned edges (consistent with the Phase-6 versioning convention)

### Tier Ladder & Promotion Gate (TIER)

Graphify's confidence *ladder* (not a float), doubled as governance graphify never needed: the
suggest-only promotion gate. "Being wrong is expensive" becomes a property of the tier.

- [x] **TIER-01**: Every knowledge node and edge carries an ordinal trust tier (EXTRACTED | INFERRED | AMBIGUOUS); the existing `confidence real` remains as an intra-tier score
- [ ] **TIER-02**: Synthesis-generated edges enter as INFERRED or AMBIGUOUS *suggestions* — display-only, never trusted for automatic prompt injection
- [ ] **TIER-03**: A human confirmation promotes an edge to EXTRACTED with promotion provenance recorded; only EXTRACTED edges are eligible for auto-injection

### Recall & Measurement (RECALL)

The cheaper 80% of the recall win first — and the instrumentation that gates whether stage-3
graph-expand is ever justified.

- [ ] **RECALL-01**: Autofill few-shot prompts include the resolved entity's `aliases[]` and `identifiers` (no BFS, no graph traversal)
- [ ] **RECALL-02**: Retrieval outcomes are instrumented per autofill run (seed hits, injected context, subsequent human correction) so a retrieval-miss rate can be measured — the stage-3 go/no-go gate

### Knowledge Canvas (GRAPH)

Graphify's query algorithm as the `/knowledge` canvas interaction model — one graph-walk
implementation serving reviewer exploration now, and (if stage 3 is ever justified) retrieval later.

- [ ] **GRAPH-01**: `/knowledge` renders edge tiers with distinct visual encoding (EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint), reusing the existing edge-style conventions
- [ ] **GRAPH-02**: Reviewer can click a node to expand its neighbours via a bounded (≤2-hop) server-side graph query
- [ ] **GRAPH-03**: Reviewer can filter the graph by tier (detail control: EXTRACTED-only → include suggestions), the budget-prune analog

## Future Requirements

Deferred, tracked in ROADMAP.md backlog — not in this roadmap.

### Knowledge graph stage 3 (999.10, defer until a retrieval miss is measured via RECALL-02)

- **KGX-01**: Seed-then-expand BFS retrieval into autofill prompts (BlendedRAG/RRF k=60 as the seeding fn → BFS-expand ≤2 hops)
- **KGX-02**: Budget-aware tier-pruning of injected prompt context (drop AMBIGUOUS → INFERRED first, always keep seeds)
- **KGX-03**: Snapshot + diff ("what did this week's confirmations change") + staleness signal

### Design Engine (backlog 999.4)

- **DSGN-01..04**: unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction (see milestones/v1.3-REQUIREMENTS.md → Future Requirements)

### Orchestration Visualizer (backlog 999.5)

- **ORCH-01**: live orchestration run-tree visualization on the canvas (seams SEAM-03/04 + CANVAS-03 left open by v1.3)

### Other carried backlog

- **999.3**: v1.3/v1.2 connected-env verification + measurement (needs live Bedrock + browser)
- **999.7**: editable genui panels / studio-on-canvas (overlaps 999.4)
- **999.8(b)**: renderer affordance resolving declared-state into text — touches the locked `SpecRenderer`
- Anticipatory-prompting go/no-go follow-through (7 seams, 25-SPIKE-FINDINGS.md)
- Truncated-tool-call salvage/surface (todo 2026-07-06; interim cap raise shipped e501e57)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep — sourced from 999.10's own "honest discount".

| Feature | Reason |
|---------|--------|
| Seed-then-expand BFS into autofill prompts | Stage 3 — flat RRF top-k is fine for the similar-document case; only justified if RECALL-02 measures a real retrieval-miss rate |
| Budget-aware tier-pruning of prompts | Near-zero value at top-3 few-shot; no token pressure yet |
| Snapshot/diff + staleness | Flywheel observability matters at operational scale, not at demo volume |
| Graphify's static `graph.json` build model | Fights the live transactional flywheel — Postgres+pgvector stays source of truth |
| Graphify's LLM-from-prose extractor | Our OCR→segment→classify→autofill funnel is the superior domain extractor |
| Hyperedges | Premature — no consumer yet |
| `/chat` 2D-canvas knowledge subgraph panel | Speculative v-next; don't anchor the case on it (999.10's own note) |
| Auto-merge / auto-acting on INFERRED or AMBIGUOUS edges | Hard suggest-only constraint — "being wrong is expensive" (design-case deliverable) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TIER-01 | Phase 29 | Complete |
| SYNTH-01 | Phase 29 | Pending |
| SYNTH-02 | Phase 29 | Complete |
| SYNTH-03 | Phase 29 | Complete |
| TIER-02 | Phase 30 | Pending |
| TIER-03 | Phase 30 | Pending |
| RECALL-01 | Phase 31 | Pending |
| RECALL-02 | Phase 31 | Pending |
| GRAPH-01 | Phase 32 | Pending |
| GRAPH-02 | Phase 32 | Pending |
| GRAPH-03 | Phase 32 | Pending |

**Coverage:**
- v1.5 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-07*
*Last updated: 2026-07-07 after roadmap creation — 11/11 requirements mapped to Phases 29-32, no orphans*
