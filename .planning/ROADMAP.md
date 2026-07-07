# Roadmap: nauta.services.email-listener

## Milestones

- ✅ **v1.0 — MVP** (Phases 1–11) — inbound email → parse → extract → entities/knowledge (shipped; phase dirs retained under `.planning/phases/`, lifecycle not formally run).
- ✅ **v1.1 — Generative UI Engine** (Phases 12–15) — spec-first Catalog→Spec→Registry→Renderer→Generation→Cache→Studio. Archived: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
- ✅ **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) — SHIPPED 2026-07-03. Eval harness + style packs + catalog expansion + declarative form engine + jailed-eval code-island (multi-candidate + judge). Archived: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Audit: [milestones/v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md).
- ✅ **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25) — SHIPPED 2026-07-06. Persistent streamed `/chat` on a 2D infinite canvas of genui panels with bidirectional (agent↔user) interactive widgets, plus an anticipatory-prompting spike. Local/sandbox only. Archived: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) · Audit: [milestones/v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md).
- ✅ **v1.4 — Chat & Studio Design Uplift** (Phases 26–28) — SHIPPED 2026-07-07. A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome — zero new npm dependencies — executing the locked 3-phase punch list (zero-dep contract fixes → adopted external picks → design-system token upgrades). Archived: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) · Audit: [milestones/v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md).
- 🚧 **v1.5 — Knowledge-Graph Uplift** (Phases 29–32) — PLANNING. Activate the dormant knowledge-graph substrate — human confirms materialize confidence-tiered edges (with OCR token provenance) through a suggest-only promotion gate — adopting graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live Postgres store, per backlog 999.10's staged plan.

## Phases

**Phase Numbering:**
- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. v1.4 ran Phases 26–28. **v1.5 starts at Phase 29.**
- Integer phases (29, 30, 31, 32): planned v1.5 milestone work.
- Decimal phases (e.g. 29.1): urgent insertions via `/gsd:phase insert`, executed between the
  surrounding integers.

<details>
<summary>✅ v1.2 — Generative UI: Realism & Interactivity (Phases 16–20) — SHIPPED 2026-07-03</summary>

- [x] Phase 16 — Studio Foundation: Eval Harness + History/Page-Ideas Tabs
- [x] Phase 17 — Tier A: Design-Token/Theme Layer + Style Packs + Assembly RAG
- [x] Phase 18 — Tier A: Catalog Expansion
- [x] Phase 19 — Tier B-1: Declarative (zero-eval) Form Engine
- [x] Phase 20 — Tier B-2: Sandboxed Code-Island (jailed-eval; SPIKE→phase; +Phase-21 multi-candidate/judge, cost guard)

Full detail: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Audit `tech_debt`, 0 gaps;
15 connected-env/browser verifications deferred (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.1 — Generative UI Engine (Phases 12–15) — SHIPPED 2026-06-27</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

</details>

<details>
<summary>✅ v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel (Phases 22–25) — SHIPPED 2026-07-06</summary>

- [x] Phase 22 — Chat Spine + Persistence + Streaming (11/11 plans) — completed 2026-07-04
- [x] Phase 23 — 2D Canvas + Panels-as-Nodes + Shared State (6/6 plans) — completed 2026-07-05
- [x] Phase 24 — Dual-Channel GenUI (4/4 plans) — completed 2026-07-06
- [x] Phase 25 — Anticipatory Prompting (SPIKE) (3/3 plans) — completed 2026-07-06

Full detail: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md). Audit `tech_debt`, 0 gaps,
24/24 requirements satisfied + cross-phase integration verified; 6 connected-env/browser
verifications deferred (STATE.md → Deferred Items). SPIKE verdict: ship-with-conditions
(25-SPIKE-FINDINGS.md).

</details>

<details>
<summary>✅ v1.4 — Chat & Studio Design Uplift (Phases 26–28) — SHIPPED 2026-07-07</summary>

- [x] Phase 26 — Zero-Dependency Contract Fixes + Backlog Polish (7/7 plans) — completed 2026-07-06
- [x] Phase 27 — Adopted External Design Picks (5/5 plans) — completed 2026-07-07
- [x] Phase 28 — Design-System Token Upgrades (3/3 plans) — completed 2026-07-07

Full detail: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md). Audit `tech_debt`, 0 gaps:
23/23 requirements + 18/18 integration seams (one FIX-02 primitive leak closed at audit e9faa55);
deferred: browser/OS visual checks + 1 pending todo (STATE.md → Deferred Items).

</details>

### 🚧 v1.5 — Knowledge-Graph Uplift (Planning)

**Milestone Goal:** Activate the dormant knowledge-graph substrate — human confirms materialize
confidence-tiered edges (with OCR token provenance) through a suggest-only promotion gate — adopting
graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live
Postgres store, per backlog 999.10's staged plan (stages 1–2 + the cheap recall win; stage-3
BFS-into-prompts explicitly deferred until a retrieval miss is *measured*).

**Hard constraints (apply to every phase below):** suggest-only is non-negotiable — nothing
auto-merges; only human-confirmed EXTRACTED edges are ever trusted for prompt auto-injection.
Migrations-first deploy discipline (`packages/db/migrations/`). Do NOT borrow graphify's static
`graph.json` build model or its LLM-from-prose extractor; no hyperedges; no stage-3 BFS/budget-pruning/
snapshot-diff work in this milestone (tracked as KGX-01..03, deferred until RECALL-02 measures a real
retrieval-miss rate).

- [x] **Phase 29: Tier Ladder + Edge Materialization** - Confirming a region durably materializes provenance-carrying knowledge graph edges, tagged with an ordinal trust tier, so corrections compound instead of evaporating
 (completed 2026-07-07)
- [ ] **Phase 30: Suggest-Only Promotion Gate** - Synthesis-generated relationships surface only as human-reviewable suggestions; a human promotes a suggestion to EXTRACTED before it is ever trusted for auto-injection
- [ ] **Phase 31: Recall & Measurement** - Autofill prompts recall an entity's known aliases/identifiers cheaply, and every autofill run's retrieval outcome is measured well enough to gate the deferred stage-3 BFS work
- [ ] **Phase 32: Knowledge Canvas: Tiered Graph Exploration** - `/knowledge` renders edge tiers distinctly, supports bounded click-to-expand-neighbours, and filters by tier

## Phase Details

### Phase 29: Tier Ladder + Edge Materialization
**Goal**: Confirming a region in the review UI durably materializes provenance-carrying knowledge
graph edges — every future correction compounds instead of evaporating — and every node/edge carries
an ordinal trust tier so that provenance is trustworthy from the first row written.
**Depends on**: Nothing (first v1.5 phase; extends the existing dormant Phase-11 `knowledge_nodes`/
`knowledge_node_edges` tables and the scaffolded `confirm_region.py:169` hook)
**Requirements**: TIER-01, SYNTH-01, SYNTH-02, SYNTH-03
**Success Criteria** (what must be TRUE):
  1. `knowledge_nodes` and `knowledge_node_edges` each carry a non-null ordinal `tier` column
     (EXTRACTED | INFERRED | AMBIGUOUS) added via a Drizzle migration in `packages/db/migrations/`;
     the existing `confidence real` column remains as the intra-tier score
  2. Confirming a region (via the existing region-confirm review flow) creates `knowledge_nodes` and
     EXTRACTED-tier `knowledge_node_edges` rows linking the confirmed entity/field to co-occurring
     entities and importer scope — where the table was previously empty, a reviewer can query rows
     immediately after a confirm
  3. Each newly materialized edge's provenance references the exact OCR token-polygon(s)
     (`content_raw.tokens`/`location.polygon`) it was derived from, inspectable on the edge row
  4. Re-confirming or superseding an already-confirmed region updates that region's edges without
     creating duplicate or orphaned rows, consistent with the Phase-6 supersede-versioning convention
**Plans**: 4 plans
  - [x] 29-01-PLAN.md — Tier-ladder enum + provenance/is_active columns; migration 0026 applied + live-verified (TIER-01)
  - [x] 29-02-PLAN.md — Shared token-provenance helper, KnowledgeSynthesizer + KnowledgeGraphRepository ports, Supabase edge/node adapter (SYNTH-02)
  - [x] 29-03-PLAN.md — KnowledgeSynthesizerService: 1:1 region node + supersede-safe EXTRACTED edge set (SYNTH-03)
  - [x] 29-04-PLAN.md — Best-effort synthesis hook wired into ConfirmRegionUseCase + DI; end-to-end materialization (SYNTH-01)

### Phase 30: Suggest-Only Promotion Gate
**Goal**: Synthesis-generated relationships surface only as human-reviewable suggestions — never as
auto-trusted truth — so "being wrong is expensive" is a property of the tier itself, not a bolt-on
check (the design-case defense narrative).
**Depends on**: Phase 29 (the tier column and EXTRACTED-tier materialization must exist before
suggestions have a ladder to sit on and a tier to be promoted into)
**Requirements**: TIER-02, TIER-03
**Success Criteria** (what must be TRUE):
  1. Synthesis-generated edges are created with tier INFERRED or AMBIGUOUS (never EXTRACTED) and are
     visibly distinguished as suggestions wherever edges are surfaced
  2. The auto-injection query path (used by autofill/prompting) returns only EXTRACTED-tier edges —
     INFERRED/AMBIGUOUS edges are excluded even when present, verified by a test that seeds all three
     tiers and asserts only EXTRACTED comes back
  3. A human reviewer has an explicit confirm/promote action that changes a suggested edge's tier to
     EXTRACTED
  4. Promoting an edge records promotion provenance (what was promoted, when, from which suggestion)
     on the edge row, distinct from the original synthesis provenance
**Plans**: 2 plans
  - [ ] 30-01-PLAN.md — Suggestion emission (INFERRED/AMBIGUOUS) + EXTRACTED-only injection gate + tRPC tier visibility (TIER-02)
  - [ ] 30-02-PLAN.md — Promotion mechanic: migration 0027 promotion column + fail-closed promote use case + authenticated endpoint (TIER-03)

### Phase 31: Recall & Measurement
**Goal**: Autofill prompts recall an entity's already-known aliases and identifiers cheaply, and every
autofill run's retrieval outcome is measured well enough to tell whether the deferred BFS graph-expand
(stage 3) would ever be worth building.
**Depends on**: Nothing (independent of Phases 29/30 — reads `entity_instances.aliases[]`/
`identifiers` directly, not `knowledge_node_edges`; can execute in parallel with either)
**Requirements**: RECALL-01, RECALL-02
**Success Criteria** (what must be TRUE):
  1. An autofill run for a resolved entity includes that entity's `aliases[]` and `identifiers` in the
     few-shot prompt payload, observable in the constructed prompt/log for a real run
  2. No BFS/graph traversal is introduced to achieve this — the injection is a direct read off
     `entity_instances`, with zero new migrations
  3. Every autofill run persists an instrumentation record of its retrieval outcome (seed hits, what
     context was injected, whether the human later corrected the field)
  4. A retrieval-miss rate is computable from the instrumented data (a query/report over the
     persisted records) — the concrete artifact that gates the stage-3 BFS go/no-go decision
**Plans**: TBD

### Phase 32: Knowledge Canvas: Tiered Graph Exploration
**Goal**: Reviewers can see and explore the confidence-tiered knowledge graph directly on
`/knowledge` — tier becomes a first-class visual and interaction concept on the canvas, not just a
database column.
**Depends on**: Phase 29, Phase 30 (needs materialized, tiered edges — including promoted/suggested
ones — to have anything meaningful to render, expand, or filter)
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03
**Success Criteria** (what must be TRUE):
  1. `/knowledge` renders EXTRACTED edges solid, INFERRED edges dashed, and AMBIGUOUS edges faint,
     reusing the existing edge-style conventions
  2. Clicking a node expands and displays its neighbours via a bounded (≤2-hop) server-side graph
     query — not an unbounded or client-only walk
  3. A tier filter control lets the reviewer narrow the view to EXTRACTED-only or widen it to
     include INFERRED/AMBIGUOUS suggestions
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 29 → 30 → 31 → 32, with Phase 31 (Recall & Measurement)
parallelizable alongside 29/30 if desired (no shared schema/table).

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 29. Tier Ladder + Edge Materialization | 4/4 | Complete   | 2026-07-07 |
| 30. Suggest-Only Promotion Gate | 0/? | Not started | - |
| 31. Recall & Measurement | 0/? | Not started | - |
| 32. Knowledge Canvas: Tiered Graph Exploration | 0/? | Not started | - |

## Next

Roadmap created for v1.5. Run `/gsd:plan-phase 29` to break Phase 29 into executable plans.

## Backlog

- **999.1 — GenUI history per-importer authorization** (from Phase 16 code review, CR-01): `GET /v1/genui/history` returns all importers' rows when `importer_id` is omitted. Accepted for the current single-shared-key local/sandbox posture (auth enforced via `X-API-Key`; mirrors `/v1/genui/generate`). Enforce per-importer scoping (require `importer_id` or derive from auth context) if real multi-tenancy is introduced. Source: `.planning/phases/16-.../16-REVIEW.md`.
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — Design Engine (deferred):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). See REQUIREMENTS.md → Future Requirements.
- **999.5 — Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
- **999.6 — Chat & Studio Design Uplift — PROMOTED to v1.4 (2026-07-06), SHIPPED 2026-07-07.** UPLIFT-01..03 — see milestones/v1.4-ROADMAP.md for full detail (finer FIX/ADOPT/TOKEN requirement IDs superseded the coarse UPLIFT-01..03 IDs).
- **999.7 — Editable genui panels / studio-on-canvas (raised 2026-07-06, user):** each canvas genui-panel becomes a live editing surface — per-panel controls to change UI tokens / `style_pack_id`, tweak spec parameters, and run studio-related tools (re-theme, regenerate variant, inspect) in place, instead of the current read-only render. Foundations already deliberately open: the versioned node-type registry (CANVAS-03) admits a richer "editable/studio panel" node type; `style_pack_id` is already threaded through chat + canvas (v1.3 locked decision); the Phase-17 DTCG style-pack engine + `/studio` token machinery already exist; the per-chat shared-state store can hold live params. Overlaps **999.4 Design Engine** — a promptable design system is the generation-side of the same tokens. NOT yet a requirement/phase.
- **999.8 — Declarative display-binding gap (found live 2026-07-06):** the declarative renderer binds values via a `dataRef` dotted-path field (`resolveDataRef`, SPEC-05) — it does NOT interpolate `{{mustache}}` inside a text node's `content`. Two candidate fixes: (a) generator-prompt fix (cheap, high-value), and/or (b) a small renderer affordance to resolve declared-state into text (bigger, touches the locked renderer). **Option (a) shipped as v1.4 POLISH-01 (Phase 26), 2026-07-06. Option (b) remains backlogged** — it touches the locked `SpecRenderer`.
- **999.9 — Canvas auto-layout stacking (cosmetic) — folded into v1.4 as POLISH-02 (Phase 26), SHIPPED 2026-07-06.**
- **999.10 — Knowledge-graph uplift — PROMOTED to v1.5 (2026-07-07).** Adopt graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live Postgres store, per its own staged cost/benefit ordering — see full analysis in `.planning/phases/999.10-knowledge-graph-uplift-graphify-adoption/NOTE.md`. Now executing as **Phases 29–32** above. Stage-3 BFS-into-prompts, budget-aware tier-pruning, and snapshot/diff remain explicitly deferred (tracked as KGX-01..03 in REQUIREMENTS.md → Future Requirements) until RECALL-02 measures a real retrieval-miss rate.
