# Backlog 999.10 — Knowledge-graph uplift: adopt graphify's algorithms onto our live store

**Captured:** 2026-07-07 (user-initiated theory analysis; "record it with gsd, we'll pick it up the correct way")
**Status:** BACKLOG — theory only, not yet planned. Promote via `/gsd:review-backlog` / `/gsd:discuss-phase 999.10`.
**Origin:** Session analysis comparing the GSD `graphify` knowledge-graph tool against Nauta's own knowledge system, entity resolution, canvas, and OCR extraction pipelines.

---

## The verdict

Nauta's knowledge system and graphify are **the same shape**: typed nodes + graded edges + budget-aware
graph retrieval + diffable evolution. The difference is that graphify is a **static, single-tenant,
auto-materialised, file-derived** instance of that shape, while ours must be a **live, multi-tenant,
human-gated, geometry-grounded** one. So we do **not** port graphify — we port its **four algorithms**
onto our live Postgres substrate, and the confidence ladder picks up a governance role graphify never
needed (a suggest-only promotion gate).

Crucially, the substrate is **already built and dormant**: `knowledge_node_edges` (Phase 11) already has
`relation_type` + `confidence` + `source`, but it is **empty, read-only, and edges are mostly derived
from FKs at query time**. And the one wire that would feed it — the synthesis hook at
`apps/email-listener/app/application/use_cases/confirm_region.py:169` — is scaffolded but not connected.
This is less "build a new system" than "activate and regrade what's already there."

---

## Graphify's transferable pages (the four algorithms)

Source: `~/.claude/plugins/cache/gsd-plugin/gsd/3.4.5/bin/lib/graphify.cjs`.

1. **Confidence *ladder*, not a float** — every edge is `EXTRACTED | INFERRED | AMBIGUOUS`. An ordinal
   trust tier, distinct from a similarity score.
2. **Seed-then-expand BFS retrieval** — match seeds, then walk edges *k* hops (default 2). Retrieval as
   graph-walk, not flat top-k.
3. **Budget-aware pruning by tier** — to fit a token budget, drop `AMBIGUOUS → INFERRED → EXTRACTED`
   edges in order, prune now-unreachable nodes, but *always keep seeds*.
4. **Snapshot + diff + staleness** — topology-level added/removed/changed counts vs a baseline, plus
   freshness signals (content-age + commit-distance).

**Do NOT borrow:** graphify's SHA256 incremental *build* of a static `graph.json` (fights our live
transactional flywheel — Postgres+pgvector stays source of truth), or its LLM-from-prose *extractor*
(our OCR→segment→classify→autofill funnel is the superior domain extractor). Hyperedges are premature —
no consumer yet.

---

## Our current system (ground truth, verified this session)

- **`knowledge_nodes`** (`packages/db/src/schema/knowledge-nodes.ts`): context chunks + `embedding`
  halfvec(1536) + `confidence real` default 1.0 + `source` + `scope`
  (entity_type|entity_instance|sender|importer_global). No populated inter-node edges.
- **`knowledge_node_edges`** (`packages/db/src/schema/knowledge-node-edges.ts`, Phase 11): EXISTS but
  **empty + read-only**; polymorphic target; `relation_type`, `confidence real`, `source`
  (`manual | synthesis | learned_from_correction`).
- **Retrieval = BlendedRAG**: dense HNSW (`match_*_by_embedding`) + lexical pg_trgm (`match_*_by_trgm`),
  fused by **Reciprocal Rank Fusion k=60** (`_rrf_score = 1/(k+rank)`). Two instances: entity resolution
  over `entity_instances` (migration `0017`) and few-shot retrieval over confirmed `email_components`
  (migration `0009`). **Suggest-only, no graph traversal.**
- **`/knowledge` React Flow graph** (`packages/api-client/src/router/knowledge/graph.ts`): derives 8 edge
  types from FKs at query time (`has_field`, `instance_of`, `belongs_to_email`, `nested_in`, …) and
  UNIONs the empty `knowledge_node_edges` table in as a live-but-empty "provider seam". Pure
  visualisation; no traversal, no path-finding.
- **OCR provenance is our superpower graphify lacks**: every component carries token-level polygon
  geometry (`content_raw.tokens`, `location.polygon`); regions are grounded in the exact tokens the LLM
  selected. So our edges can carry "this field came from these pixels" provenance graphify structurally
  cannot.
- **Suggest-only is a hard constraint** ("being wrong is expensive" — design-case deliverable, must be
  defended in person): resolver is read-only, promotion records provenance but never auto-merges.
- **Knowledge synthesis hook is a NO-OP** (`confirm_region.py:169`): the confirmed-extraction →
  `knowledge_nodes`/edges materialisation is scaffolded but not wired. This is the key open seam.

---

## The mapping

| Graphify page | Our current state | The borrow |
|---|---|---|
| Edge tier (EXTRACTED/INFERRED/AMBIGUOUS) | `confidence` is an ungraded `real`; `source` is `manual\|synthesis\|learned_from_correction` | Add a **tier enum**; keep the float as *intra-tier* score. Our `source` column already IS the ladder: `learned_from_correction`≈EXTRACTED, `synthesis`≈INFERRED, `manual`≈authored truth |
| Seed-then-expand BFS | Flat BlendedRAG, no traversal | BlendedRAG becomes the **seeding function** (stronger than graphify's substring match), then BFS-expand `knowledge_node_edges` to pull a confirmed entity's neighbours (aliases, co-occurring entities, importer rules) |
| Budget-aware tier-pruning | `autofill.py` injects top-3 few-shot flatly | Same drop-AMBIGUOUS-first policy to pack the most trustworthy context into the prompt |
| Snapshot + diff | Derived-at-query-time; no history | "What did this week's confirmations change in the graph" — regression detection + reviewer audit trail |
| Staleness signal | none | "Suggestions reflect N confirmations since last synthesis" freshness indicator |

**The synthesis that makes this ours, not graphify's:** tier ladder + suggest-only = a **promotion
pipeline**. Synthesis jobs emit `AMBIGUOUS`/`INFERRED` edges as *suggestions* (display-only, never act on
truth); a human confirm **promotes** an edge to `EXTRACTED`, and only then is it trusted for
auto-injection. Graphify auto-materialises all tiers; we gate the top tier behind a human. "Being wrong
is expensive" becomes a property of the tier, not a bolt-on.

---

## What we'd actually gain (honest)

1. **Real product win — cross-context recall.** Flat RRF top-k only retrieves things
   textually/semantically *similar to the region in front of it* — a lookup that plateaus.
   Seed-then-expand pulls in *related* context by relation, so a confirmation about "Acme Corp" in
   email A improves extraction of Acme in email Z **even when the documents look nothing alike**. Flat
   similarity structurally can't do that. → fewer human corrections on entities already seen.
2. **Real narrative win — a named, defensible architecture.** "A confidence-graded knowledge graph with
   a suggest-only promotion gate, grounded in OCR token provenance" is something to whiteboard and
   justify decision-by-decision in the design-case defense. Arguably worth more than the runtime win
   right now.

**The honest discount:**
- Both gains are **LATENT until correction volume exists**. Edge table is empty, synthesis hook is a
  no-op — cold-start, every graphify borrow returns exactly what flat RRF already returns.
- Flat RRF top-k is already fine for the similar-document case (probably most cases). Graph-expand only
  pays off if retrieval-*miss* is a **measured** failure mode — it isn't measured yet.
- Budget-pruning and snapshot/diff are near-zero value now (no token pressure at top-3; flywheel
  observability matters at operational scale, not at demo).
- The single highest-value thing here **isn't graphify** — it's wiring `confirm → knowledge edges` so
  corrections compound at all. You'd want that regardless; graphify only supplies the *shape* for
  consuming those edges well.
- **Cheaper 80% of the recall win**: `entity_instances.aliases[]` + `identifiers` already exist — just
  inject the resolved entity's aliases/identifiers into the few-shot prompt (no BFS, no tier enum, no
  migration) and see whether graph-expand still buys anything. Full graph apparatus is only justified
  once relations are genuinely multi-hop and heterogeneous (entity → rule → sibling-field →
  co-occurring-entity).

---

## Integration surfaces

**OCR extraction (where edges get born):** materialise at the dormant `confirm_region.py:169` hook.
Confirm → also emit `knowledge_node_edges` tagged EXTRACTED, linking the confirmed entity/field to
knowledge nodes and co-occurring entities, with the token polygon as edge provenance. The next
extraction's autofill runs seed-then-expand (embed region → BlendedRAG-seed → BFS-expand the
confirmed-entity subgraph → tier-prune to budget → inject as few-shot). Synthesis jobs emit
INFERRED/AMBIGUOUS edges = the suggest-only queue a reviewer promotes.

**Canvas — `/knowledge` React Flow graph is the direct fit.** Graphify's query algorithm IS the canvas
interaction model:
- Seed-then-expand BFS = click-a-node-expand-neighbours → one implementation serves both retrieval
  (server, for prompts) and exploration (client, for reviewers).
- Tier → visual encoding: EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint (reuse the existing
  "taxonomy edges have no arrowhead" convention).
- Budget-pruning → a "detail slider" (show only EXTRACTED, or expand into suggestions).
- The v1.3 `/chat` 2D canvas connection (knowledge subgraph as a genui panel-node wired by a data-edge)
  is speculative v-next — don't anchor the case on it.

---

## Staged plan (honest cost/benefit ordering)

1. **Do regardless:** wire the synthesis hook (`confirm_region.py:169`) so corrections compound.
2. **Cheap + defensible:** add the tier ladder enum (keep float as intra-tier score); wire the
   promotion gate. Good ROI; makes suggest-only legible for the defense.
3. **Defer until a real retrieval-miss is measured:** seed-then-expand BFS + budget-pruning +
   snapshot/diff. Ship the cheap alias/identifier few-shot injection first; only build graph-expand if
   it still buys anything after that.

**Watch:** BFS-per-autofill cost — bound hops (≤2, like graphify) and tier-prune hard before it hits a
prompt.

**Relationship to other backlog items:** lands alongside/after the Phase-11 knowledge-synthesis work;
`/knowledge` canvas encoding overlaps the graph-visualisation surface. Distinct from 999.4/999.7
(generative design engine).
