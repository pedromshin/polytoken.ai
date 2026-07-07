---
phase: 29-tier-ladder-edge-materialization
plan: 02
subsystem: knowledge-graph
tags: [hexagonal-architecture, domain-ports, supabase, provenance, ocr]
dependency-graph:
  requires:
    - knowledge_nodes.tier (29-01)
    - knowledge_node_edges.tier/provenance/is_active (29-01)
  provides:
    - _token_provenance.capture_provenance
    - _token_provenance.capture_text
    - KnowledgeSynthesizer (domain port)
    - KnowledgeGraphRepository (domain port)
    - SupabaseKnowledgeGraphRepository (adapter)
  affects:
    - apps/email-listener/app/application/use_cases/confirm_region.py (29-03 will wire the hook)
tech-stack:
  added: []
  patterns:
    - "Shared private-module helper (_token_provenance.py) extracted from a use-case internal
      function, re-exported via a thin wrapper so existing call sites are byte-identical"
    - "Node-reuse-then-insert upsert idiom: find_active_node lookup precedes upsert_node's
      insert/update branch (avoids duplicate nodes for the same importer/scope/scope_ref_id)"
key-files:
  created:
    - apps/email-listener/app/application/use_cases/_token_provenance.py
    - apps/email-listener/app/domain/ports/knowledge_synthesizer.py
    - apps/email-listener/app/domain/ports/knowledge_graph_repository.py
    - apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
    - apps/email-listener/tests/test_knowledge_graph_repository.py
  modified:
    - apps/email-listener/app/application/use_cases/edit_region.py
decisions:
  - "capture_provenance returns {tokens, text} as a single call so the synthesizer (29-03) and
    edit_region's text-only need share one source of truth for the overlap predicate — no
    duplicated intersection logic anywhere in the codebase"
  - "upsert_node performs a read-then-write (find_active_node -> insert or update) rather than a
    DB-level upsert-on-conflict, because node identity is a business key
    (importer_id, scope, scope_ref_id), not a single unique column PostgREST can target with
    on_conflict — mirrors the plan's explicit find_active_node + upsert_node split"
metrics:
  duration_minutes: 35
  completed: 2026-07-07
---

# Phase 29 Plan 02: Provenance-Carrying Write Substrate Summary

Built the write substrate SYNTH-02 needs: a shared OCR token∩polygon provenance helper (used by
both region-edit ops and the future synthesizer), two clean domain ports (KnowledgeSynthesizer +
KnowledgeGraphRepository), and a Supabase adapter that persists tiered, provenance-carrying edges
with supersede-safe (never-delete) `is_active` transitions.

## What Was Built

**Task 1 — Shared token-provenance helper.** `_token_provenance.py` exposes
`capture_provenance(page, polygon) -> {tokens, text}` (tokens = list of `{text, bbox}` for every
overlapping OCR token; text = space-joined token text) and a thin `capture_text(page, polygon) -> str`
wrapper. Reuses `propose_regions._page_tokens` — no duplicated token-parsing logic. `edit_region.py`
deleted its local `_capture_text` body and now imports `capture_text as _capture_text` from the new
module, so every existing call site (redraw/split/merge/create) is unchanged. The axis-aligned
bounding-box overlap predicate (`t_right > p_left and t_left < p_right and t_bottom > p_top and
t_top < p_bottom`) is byte-identical to the original. 53 `edit_region`/`capture` tests pass;
`lint-imports` confirms the helper stays in the application layer (no infrastructure imports).

**Task 2 — Domain ports.** `KnowledgeSynthesizer` (Protocol) defines
`synthesize_from_confirmation(*, component_id, importer_id, confirmed_record, corrected_fields,
source="learned_from_correction")` — keyword params matched exactly to the `confirm_region.py:169`
hook comment's own call shape. Docstring states the best-effort contract (must not raise into the
caller) and the D-13 materialization role. `KnowledgeGraphRepository` (Protocol) exposes
`upsert_node`, `find_active_node` (node-reuse lookup), `insert_edge`, `deactivate_edges_for_node`
(the supersede primitive 29-03 depends on), and `find_active_edges_for_node`. Both ports use plain
dict/str param+return types; `ExtractionRecord` is imported under `TYPE_CHECKING` only. Both modules
import cleanly and `lint-imports` confirms zero infrastructure imports.

**Task 3 — Supabase adapter.** `SupabaseKnowledgeGraphRepository` implements every
`KnowledgeGraphRepository` method against a `supabase.Client`, following the `component_repository`
idiom: module-level `_node_to_row`/`_edge_to_row` builders wrapped in `strip_nul` (OCR-derived
provenance text/tokens sanitized before write). `upsert_node` calls `find_active_node` first and
either updates the reused row or inserts a fresh one (business-key identity, not a
DB-level `on_conflict`). `insert_edge` writes `is_active=True` and the exact `tier`/`source` passed,
with `provenance` carrying `{component_id, page_index, polygon, tokens}` through `strip_nul`.
`deactivate_edges_for_node` issues `.update({"is_active": False})` filtered by `source_node_id` +
`is_active=True` — never `.delete()` (audit trail, T-29-05). 5 call-shape tests (MagicMock,
`asyncio.run`, no pytest-asyncio) assert: insert_edge's provenance/tier/is_active payload; deactivate
updates-not-deletes; find_active_edges_for_node's filter shape; upsert_node's insert-when-absent and
update-when-reused branches. `mypy`, `ruff` (120 cols), and `lint-imports` all pass on the new files.

## Deviations from Plan

None — plan executed exactly as written. Two implementation details were left to discretion by the
plan's own phrasing and resolved as follows:
- `upsert_node`'s insert-vs-update branching (read-then-write via `find_active_node`) — the plan
  specified both methods' shapes but not their interaction; chose read-then-write since node
  identity is a business key, not a `on_conflict`-able single column.
- A pre-existing, unrelated test-isolation flake in `test_genui_retrieval_provider.py` (24 tests
  fail only when the full suite runs together, pass in isolation) was discovered during full-suite
  verification. Confirmed unrelated to this plan (reproduces on unmodified `main`); logged to
  `deferred-items.md` per the SCOPE BOUNDARY rule, not fixed.

## Commits

- `fddf69a` — refactor(29-02): extract shared token-provenance helper from edit_region
- `ef6361f` — feat(29-02): define KnowledgeSynthesizer and KnowledgeGraphRepository ports
- `43fece6` — feat(29-02): implement SupabaseKnowledgeGraphRepository with provenance-carrying edges

## Self-Check: PASSED

- FOUND: apps/email-listener/app/application/use_cases/_token_provenance.py
- FOUND: apps/email-listener/app/domain/ports/knowledge_synthesizer.py
- FOUND: apps/email-listener/app/domain/ports/knowledge_graph_repository.py
- FOUND: apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
- FOUND: apps/email-listener/tests/test_knowledge_graph_repository.py
- FOUND: commit fddf69a
- FOUND: commit ef6361f
- FOUND: commit 43fece6
- Verified: 53 edit_region/capture tests pass; 5 knowledge_graph_repository tests pass; mypy/ruff/lint-imports all clean on new files
