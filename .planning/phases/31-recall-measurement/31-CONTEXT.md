# Phase 31: Recall & Measurement - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous run — recommended answers auto-accepted per the user's standing
directive: never block, pick defaults, document)

<domain>
## Phase Boundary

Autofill prompts cheaply recall an entity's already-known `aliases[]` and `identifiers` (RECALL-01,
no BFS/graph traversal), and every autofill run persists an instrumentation record of its retrieval
outcome so a retrieval-miss rate is computable (RECALL-02) — the concrete artifact gating the
deferred stage-3 BFS work (KGX-01..03). Independent of Phases 29/30 (reads `entity_instances`
directly, not `knowledge_node_edges`). NO canvas work (Phase 32), NO graph-walk of any kind.

</domain>

<decisions>
## Implementation Decisions

### Close the few-shot rendering gap first (RECALL-01 prerequisite)
- VERIFIED GAP (scouted 2026-07-07): `app/infrastructure/llm/autofill_adapter.py` —
  `AnthropicAutofiller` accepts `examples` in its signature but `_generate` NEVER renders them
  into the Bedrock messages (user content is only the region text in `<document_content>`
  delimiters). The retrieval pipeline (RRF top-3 via `find_similar_confirmed`) works; its output
  just never reaches the model. Phase 31 MUST implement example rendering — otherwise alias
  injection lands in a prompt section that doesn't exist
- Render examples in clearly delimited blocks (mirror the existing `<document_content>` delimiter
  discipline) with content text + extracted fields; exact prompt format at Claude's discretion,
  preserving the cold-start contract (examples=() → single user message, `cold_start_autofill`
  routing_reason unchanged)

### Alias/identifier injection (RECALL-01)
- Source: the component's resolved entity — the selected `component_entity_candidate_links` row
  (wasSelected) when present, else the top entity-resolution candidate(s) via the EXISTING
  suggest-only resolution read paths. Never a graph walk; a direct `entity_instances` read
  (`aliases text[]`, `identifiers jsonb`)
- Injected as a delimited "known entity context" block (aliases + identifiers), size-bounded
  (cap alias count defensively; discretion on the cap)
- Zero new migrations for this half; suggest-only stance untouched (context for the model, never
  auto-committed truth)

### Instrumentation store (RECALL-02)
- New small event table via migration 0028 (follow 0026/0027 hand-written idempotent style +
  RLS deny-all + live-verify script): one row per autofill run recording at minimum:
  component_id, importer_id, entity_type_id, retrieval seed hits (example ids/scores/count),
  whether/what alias-identifier context was injected (entity_instance_id, counts), routing_reason,
  created_at. Table name at Claude's discretion (e.g. `autofill_retrieval_events`)
- Written best-effort from the autofill use case (an instrumentation failure must never break
  autofill — same best-effort posture as the Phase-29 synthesis hook)
- Human-correction linkage is derived AT QUERY TIME by joining confirms (`corrected_fields`
  presence per component) against these events — no in-place event mutation, no second write path
- The "computable retrieval-miss rate" artifact: a committed SQL view OR a script under the
  relevant package (discretion) + a documented miss definition. Miss = a run that HAD retrieval
  context yet the human subsequently corrected the autofilled field(s), or a run whose retrieval
  returned nothing for a component a human later hand-filled. The definition must be written down
  next to the artifact (this is the stage-3 go/no-go gate the design case cites)

### Claude's Discretion
- Prompt block format/delimiters, alias cap, exact event-table columns/names, view-vs-script for
  the miss-rate artifact, whether the injected-context metadata also lands in the existing
  generation-event audit trail
- Test strategy per repo convention (AsyncMock ports for the use case; MagicMock call-shape for
  the adapter/repo; prompt-content assertions on the constructed messages)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/application/use_cases/autofill.py` — `execute()`: embeds region, `retrieval.find_similar_confirmed(..., top_n=3)`, `_example_to_dict` → `{content_text, extracted_fields, score}`, passes `examples` tuple to `autofiller.autofill(...)`; `few_shot_autofill` vs `cold_start_autofill` routing_reason (line ~170)
- `app/infrastructure/llm/autofill_adapter.py` — `AnthropicAutofiller`; `_generate` builds messages (THE gap); Bedrock via IAM (no API key)
- `app/infrastructure/supabase/retrieval_repository.py` — RRF k=60 fusion (`_rrf_score`/`_merge_rrf`)
- `entity_instances` schema: `aliases text[]`, `identifiers jsonb` (packages/db/src/schema/entity-instances.ts); reads in `entity_instance_repository.py` (incl. 29-03's `find_selected_instance_for_component`)
- Best-effort posture reference: `confirm_region.py` synthesis hook (29-04) — try/except log-and-swallow
- Migration style: 0026/0027 + `verify-002X-live.ts` scripts; local Postgres postgresql://postgres:postgres@localhost:54322/postgres; apply via `npm run migrate:local`

### Established Patterns
- Hexagonal (use cases import only app.domain.*), lint-imports enforced
- Offline pytest conventions; asyncio.run(); ruff/mypy gates
- Every table: RESTRICTIVE RLS deny-all; service-role writer bypasses

### Integration Points
- `container.py` — autofill use case provider (`_provide_autofill_use_case`); add the event
  repository binding there
- Confirm-side correction signal already exists: `corrected_fields` param on
  `ConfirmRegionUseCase.execute` (persisted via extraction records)

</code_context>

<specifics>
## Specific Ideas

- The point of RECALL-02 (from 999.10): "only build graph-expand if it still buys anything after
  the cheap alias injection" — the miss-rate artifact must make that decision answerable with a
  number, not a vibe
- Design-case framing: measurement-gated architecture evolution is itself a defensible decision

</specifics>

<deferred>
## Deferred Ideas

- Seed-then-expand BFS + budget-pruned prompt packing (KGX-01/02) — stage 3, gated by this
  phase's measurement
- Snapshot/diff + staleness (KGX-03)
- Any dashboard/UI for the miss rate — a queryable artifact suffices at demo volume

</deferred>
