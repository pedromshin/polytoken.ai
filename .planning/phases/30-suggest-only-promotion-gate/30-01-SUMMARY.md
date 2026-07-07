---
phase: 30-suggest-only-promotion-gate
plan: 01
subsystem: knowledge-graph
tags: [hexagonal-architecture, tdd, suggest-only, trust-tier, injection-gate, trpc]
dependency-graph:
  requires:
    - KnowledgeSynthesizerService / KnowledgeGraphRepository / EntityInstanceRepository (Phase 29)
    - knowledge_nodes.tier / knowledge_node_edges.tier/provenance/is_active columns (29-01)
  provides:
    - EntityInstanceRepository.find_unconfirmed_entity_components_for_email
    - EntityInstanceRepository.find_unselected_candidate_instances_for_component
    - KnowledgeSynthesizerService suggestion emission (INFERRED co_occurs_with / AMBIGUOUS possibly_about)
    - KnowledgeGraphRepository.list_injectable_edges (sanctioned auto-injection read gate)
    - graph.ts GraphEdge.tier + shapeExplicitEdgeRow pure helper
  affects:
    - packages/api-client/src/router/knowledge/graph.ts (explicitEdgeRows now excludes inactive edges, carries tier)
    - Phase 31 (KGX-01/02 alias injection) must call list_injectable_edges, never read knowledge_node_edges directly
tech-stack:
  added: []
  patterns:
    - "Suggestion emission runs AFTER deactivate-then-insert supersede, always source='synthesis', tier
       hardcoded to INFERRED/AMBIGUOUS — never EXTRACTED (suggest-only hard constraint, T-30-01)"
    - "list_injectable_edges is THE single sanctioned auto-injection read path: resolve importer's
       knowledge_nodes ids, then filter tier=EXTRACTED AND is_active=True (T-30-02)"
    - "Pure row-shaping helper (shapeExplicitEdgeRow) mirrors the shapeGraphResponse idiom for DB-free
       testability of the inactive-edge-exclusion + tier-carrying logic"
key-files:
  created: []
  modified:
    - apps/email-listener/app/domain/ports/entity_instance_repository.py
    - apps/email-listener/app/infrastructure/supabase/entity_instance_repository.py
    - apps/email-listener/tests/test_supabase_repositories.py
    - apps/email-listener/app/application/use_cases/synthesize_knowledge.py
    - apps/email-listener/tests/test_synthesize_knowledge.py
    - apps/email-listener/app/domain/ports/knowledge_graph_repository.py
    - apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
    - apps/email-listener/tests/test_knowledge_graph_repository.py
    - packages/api-client/src/router/knowledge/graph.ts
    - packages/api-client/src/router/knowledge/graph.test.ts
decisions:
  - "Suggestion relation_type strings: 'co_occurs_with' for INFERRED (mirrors the existing EXTRACTED
     co-occurrence relation, distinguished purely by tier) and 'possibly_about' for AMBIGUOUS (distinct
     from the EXTRACTED 'about' relation, signalling the non-selected-candidate nature explicitly)."
  - "list_injectable_edges resolves importer scope via a knowledge_nodes id lookup then .in_() on
     source_node_id, mirroring the existing transitive-isolation pattern (edges have no importer_id
     column; isolation holds via source_node_id -> knowledge_nodes.importer_id, T-29-06/T-30-02)."
  - "tRPC tier visibility implemented as a pure exported helper (shapeExplicitEdgeRow) rather than
     inline loop logic, so the inactive-edge-exclusion and tier-carrying invariants are DB-free
     testable (mirrors the pre-existing shapeGraphResponse idiom in the same file)."
  - "Promotion endpoint (TIER-03, migration 0027, promotion jsonb column) is explicitly OUT of scope
     for this plan (30-01 only covers TIER-02's suggest-emission + injection-gate + visibility seam);
     it is a separate plan within Phase 30 per the phase's task breakdown."
metrics:
  duration_minutes: 45
  completed: 2026-07-07
---

# Phase 30 Plan 01: Suggest-Only Promotion Gate (TIER-02) Summary

Extended the confirm-time synthesizer to emit human-reviewable suggestion edges (INFERRED/AMBIGUOUS,
`source='synthesis'`) alongside its existing EXTRACTED writes; shipped `list_injectable_edges` as the
single sanctioned auto-injection read path (active EXTRACTED only, proven by a seeded three-tier
exclusion test); and surfaced `tier`/`is_active` through the tRPC knowledge-graph payload so suggestions
are visibly distinguished from trusted truth. The design-case invariant — "synthesis emits suggestions;
only human-confirmed EXTRACTED edges are ever trusted for auto-injection" — is now literally true and
test-enforced.

## Session-Limit Recovery Note

This plan was originally started by a prior executor session that was cut off mid-Task-2 by a session
limit, immediately after writing the RED test suite for suggestion-edge emission (its last recorded
words: "Now confirm RED"). This executor resumed from that state:

- Verified Task 1's commit (`29b13c6`) against its acceptance criteria — confirmed complete, not redone.
- Inspected the ~124 uncommitted lines the prior executor had added to `test_synthesize_knowledge.py`
  (4 new tests: INFERRED emission, AMBIGUOUS emission, self/empty-source no-op, "never EXTRACTED"
  invariant). The tests matched the plan's Task 2 `<behavior>` spec exactly and needed no adjustment.
  Ran them to confirm genuine RED (`assert 0 == 1` on the INFERRED assertion — the module had no
  suggestion-emission code yet), then committed the RED state before proceeding to GREEN, per the
  standard TDD gate sequence.
- Completed Task 2's GREEN implementation and Task 3 (previously entirely unstarted) from scratch.

## What Was Built

**Task 1 — Suggestion-source reads (already committed at `29b13c6` on entry, verified not redone).**
`find_unconfirmed_entity_components_for_email(email_id)` (role='entity' AND extraction_status != 'confirmed'
via `.neq()`) and `find_unselected_candidate_instances_for_component(component_id)` (reads
`component_entity_candidate_links` where `was_selected=False`, resolves each `entity_instance_id` via
`find_by_id`, drops `None`) added to both the `EntityInstanceRepository` Protocol and the Supabase
adapter. Four MagicMock call-shape tests confirm the `.neq()` (not `.eq()`) filter and the was_selected/
find_by_id resolution shape.

**Task 2 — Suggestion-edge emission (TDD RED→GREEN).** RED: the recovered 4-test suite (see recovery
note above) confirmed failing against the pre-suggestion synthesizer, committed as `bf98e0e`. GREEN:
added `_TIER_INFERRED`/`_TIER_AMBIGUOUS` constants and two emission loops appended after the existing
about-edge block in `synthesize_from_confirmation` — one INFERRED `co_occurs_with` edge per unconfirmed
component (self-excluded, mirroring the existing co-occurrence loop's guard), one AMBIGUOUS
`possibly_about` edge per unselected candidate instance. Both always pass `source="synthesis"` and a
hardcoded tier — no branching that could ever produce `tier="EXTRACTED"` for a suggestion. Runs after
the deactivate-then-insert supersede block so re-confirm re-derives fresh suggestions alongside the
fresh EXTRACTED set. Committed as `babbf9a`. All 12 tests in `test_synthesize_knowledge.py` pass;
`grep -nE "tier=_TIER_(INFERRED|AMBIGUOUS)"` returns both lines; mypy/ruff/lint-imports clean (zero
`app.infrastructure` import in the synthesizer).

**Task 3 — Injection gate + seeded three-tier test + tRPC visibility seam.** Added
`list_injectable_edges(importer_id) -> list[dict]` to the `KnowledgeGraphRepository` Protocol and
Supabase adapter: resolves the importer's `knowledge_nodes` ids via a `select("id").eq("importer_id", ...)`
query, then `.in_("source_node_id", node_ids).eq("tier", "EXTRACTED").eq("is_active", True)` on
`knowledge_node_edges` — short-circuits to `[]` when the importer has no nodes. Docstring documents
this as the ONLY sanctioned auto-injection read path (Phase 31's alias injection reads
`entity_instances` directly and doesn't need this gate yet, but it ships now per the phase context).
Added `test_list_injectable_edges_excludes_suggestion_tiers`: a `_FilterableTableDouble` test helper
honors `.eq()`/`.in_()` filters over an in-memory row list, seeds one active EXTRACTED, one active
INFERRED, one active AMBIGUOUS, and one inactive EXTRACTED edge, and asserts exactly the single active
EXTRACTED edge id is returned (SC2). In `graph.ts`: added `readonly tier?: string` to `GraphEdge`,
extended `explicitEdgeWhere` with `eq(KnowledgeNodeEdges.isActive, true)`, and extracted a new pure
`shapeExplicitEdgeRow` helper (mirroring the existing `shapeGraphResponse` DB-free-testable idiom) that
excludes inactive edges and rows with no `targetRefId`, carrying `tier` on the shaped `kne-*` edge.
Three new `graph.test.ts` cases (`shapeExplicitEdgeRow`) assert: an active edge carries its tier, an
inactive edge is not shaped at all, and a no-target-ref row is not shaped. `npm test --workspace=@nauta/
api-client -- graph` passes 14/14; `npx tsc --noEmit` clean in `packages/api-client`.

## Deviations from Plan

None beyond the session-limit recovery documented above — plan executed as written. No Rule 1-4
auto-fixes were needed.

## Commits

- `29b13c6` — feat(30-01): add suggestion-source reads to EntityInstanceRepository (Task 1, pre-existing on entry)
- `bf98e0e` — test(30-01): add failing tests for suggestion-edge emission (INFERRED/AMBIGUOUS) (Task 2 RED, recovered)
- `babbf9a` — feat(30-01): emit INFERRED/AMBIGUOUS suggestion edges on confirmation (Task 2 GREEN)
- `017cadf` — feat(30-01): add list_injectable_edges gate + tier-aware tRPC graph seam (Task 3)

## TDD Gate Compliance

RED gate (`bf98e0e`) confirmed by a genuine assertion failure (`assert 0 == 1`) before any suggestion-
emission code existed — the tests were inherited from the cut-off prior session and independently
re-verified as failing before committing. GREEN gate (`babbf9a`) confirmed by 12/12
`test_synthesize_knowledge.py` tests passing. No REFACTOR commit needed.

## Self-Check: PASSED

- FOUND: apps/email-listener/app/application/use_cases/synthesize_knowledge.py (suggestion emission loops)
- FOUND: apps/email-listener/app/domain/ports/knowledge_graph_repository.py (list_injectable_edges)
- FOUND: apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py (list_injectable_edges impl)
- FOUND: packages/api-client/src/router/knowledge/graph.ts (tier field, shapeExplicitEdgeRow)
- FOUND: commit 29b13c6
- FOUND: commit bf98e0e
- FOUND: commit babbf9a
- FOUND: commit 017cadf
- Verified: 38 Python tests pass across test_synthesize_knowledge.py/test_supabase_repositories.py/
  test_knowledge_graph_repository.py; 14 graph.test.ts tests pass; mypy/ruff/lint-imports clean on all
  touched Python files; tsc --noEmit clean in packages/api-client.
