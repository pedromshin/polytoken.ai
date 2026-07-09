---
phase: 37-knowledge-search-python-read-side
plan: 02
subsystem: chat-tool-loop
tags: [tool-executor, search-knowledge, belt-two-field-omission, exposure-gate, flag-gated-wiring, TOOL-03, TOOL-04]
dependency_graph:
  requires:
    - "app.domain.ports.knowledge_graph_repository.search_nodes / .expand_neighbours + DEFAULT_SEARCH_LIMIT / MAX_EXPAND_DEPTH / DEFAULT_EXPAND_NODE_BUDGET (37-01)"
    - "app.infrastructure.supabase.knowledge_graph_repository.SupabaseKnowledgeGraphRepository (v1.5, extended by 37-01)"
    - "app.infrastructure.tools.envelope (36-01) -- build_citation/citation_to_dict/truncate_field/CitationKind"
    - "app.domain.ports.tool_executor.ToolExecutor.execute(..., importer_id) (36-01)"
    - "app.application.use_cases.run_chat_turn_tool_loop.cap_tool_output (34-01)"
  provides:
    - "app.infrastructure.tools.search_knowledge_executor (SEARCH_KNOWLEDGE_TOOL_NAME, build_search_knowledge_tool, SearchKnowledgeExecutor, _belt_two_label)"
    - "app.infrastructure.tools.envelope.CitationKind widened to include 'knowledge' + /knowledge?focus={id} route template"
    - "app.settings.BaseAppSettings.SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False (synthesis P6 exposure gate)"
    - "app.container._provide_run_chat_turn conditional (flag-gated) search_knowledge entry in tool_executors/server_tool_defs"
  affects:
    - "Phase 38 (flips SEARCH_KNOWLEDGE_TOOL_ENABLED default after the adversarial fixture suite passes; QUAR-01/QUAR-02 build on this executor)"
    - "Phase 39 (citation-chip UI consumes the /knowledge?focus={id} citations this plan's envelope produces)"
tech_stack:
  added: []
  patterns:
    - "Belt-2 field omission with exactly ONE implementation: _belt_two_label is the SOLE function reading title/content, gated on row's own tier == 'EXTRACTED' -- never trusts repository/view output (T-37-06)"
    - "Mode-dispatching ToolExecutor (search/expand) with per-mode private async helpers returning envelope-dict-or-error-result union"
    - "Exposure gating via structural key omission: container's tool_executors/server_tool_defs dict literals conditionally include the tool via ** unpacking, never mutation (T-37-09)"
    - "Embed-then-degrade: embedder failure -> query_embedding=None (trgm-only) + embedding_degraded: true envelope note, key omitted entirely when not degraded (T-37-08)"
key_files:
  created:
    - apps/email-listener/app/infrastructure/tools/search_knowledge_executor.py
    - apps/email-listener/tests/infrastructure/tools/test_search_knowledge_executor.py
  modified:
    - apps/email-listener/app/infrastructure/tools/envelope.py
    - apps/email-listener/app/settings.py
    - apps/email-listener/app/container.py
    - apps/email-listener/tests/test_container.py
decisions:
  - "_execute_search/_execute_expand return `dict[str, Any] | ToolExecutionResult` -- validation short-circuits (empty query/node_id) return the error result directly; success returns the envelope dict that execute() wraps via cap_tool_output (honors both halves of the plan's action text without a control-flow exception)"
  - "A single shared _map_node_row (built on _belt_two_label) maps BOTH search-mode results and expand-mode nodes -- the strongest form of the plan's 'SAME belt-2 logic' requirement, one implementation for the mapping too, not just the label gate"
  - "expand-mode envelope defensively coerces non-list nodes/edges from the repository result to [] (isinstance check) rather than raising -- consistent with never-raise-past-the-boundary"
  - "The two flag-gate container tests live in a dedicated TestSearchKnowledgeExposureGate class in tests/test_container.py with monkeypatch + get_settings.cache_clear() before/after (conftest.py's pattern), so later tests are never polluted by the cached flag override"
metrics:
  duration: "~15 min"
  completed: 2026-07-09
---

# Phase 37 Plan 02: SearchKnowledgeExecutor + Flag-Gated Wiring Summary

Ships the THIRD real `ToolExecutor` -- `search_knowledge` (TOOL-03), a mode-dispatching
(search/expand) thin wrapper over 37-01's `search_nodes`/`expand_neighbours` with TOOL-04's
belt-2 field omission enforced in the envelope itself (`_belt_two_label`, independent of belt
1's SQL view), then wires it into `container.py` behind `SEARCH_KNOWLEDGE_TOOL_ENABLED`
(default `False`) so the tool ships fully built and tested but DARK until Phase 38 flips the
flag after the adversarial suite passes.

## What Was Built

### Task 1 -- SearchKnowledgeExecutor (TOOL-03 + TOOL-04 belt 2, TDD RED/GREEN)

`app/infrastructure/tools/envelope.py` (extended, not recreated): `CitationKind` widened to
`Literal["entity", "email", "knowledge"]` and `"knowledge": "/knowledge?focus={id}"` added to
`_ROUTE_TEMPLATES` -- the Fork 5 citation route (no `/knowledge/[id]` route exists; the
deep-link + focus query param is the only correct form). No other symbol touched; Phase 36's
`lookup_entity`/`search_emails` executor tests all stay green (26/26 full tools-dir sweep).

`app/infrastructure/tools/search_knowledge_executor.py`:

- `SEARCH_KNOWLEDGE_TOOL_NAME = "search_knowledge"` + `build_search_knowledge_tool()` --
  Bedrock-valid shape (root type:object, `additionalProperties: false`, no root `$ref`),
  `required: ["mode"]` with `enum: ["search", "expand"]`, `maxLength` bounds on `query` (200)
  and `node_id` (100), description stating explicitly that only human-confirmed
  (EXTRACTED-tier) text ever appears as free text. The schema declares NO depth/budget
  property at all (T-37-10 -- the surface is closed, not validated).
- `_belt_two_label(row)` -- module-level, pure, the SOLE place in the file that ever reads
  `title`/`content` (grep-verified: exactly one matching line, inside this function). Returns
  `None` unless `row.get("tier") == "EXTRACTED"`, else
  `truncate_field(str(row.get("title") or row.get("content") or ""))` -- re-derives omission
  from `tier` itself, never trusting that belts 1/3 already nulled the text.
- `_map_node_row(row)` -- shared by BOTH modes: builds
  `{node_id, label, tier, confidence, source_region_id}` then filters ONLY the `label` key
  when `None` (the key is ABSENT, never `null`); `confidence`/`source_region_id` survive
  falsy-but-valid values (0.0 / None).
- `SearchKnowledgeExecutor.execute` -- validates `mode` first (unknown/missing -> early
  `is_error`, zero collaborator calls), dispatches to `_execute_search`/`_execute_expand`
  inside ONE outer try/except (any repository exception -> structlog warning + friendly
  `is_error=True`, internals never leaked), wraps the returned envelope via
  `cap_tool_output(json.dumps(envelope, separators=(",", ":")))`.
- `_execute_search` -- validates non-blank `query`; `embedder.embed` wrapped in its own
  try/except: on failure `query_embedding=None` + `degraded=True` (logged, never re-raised,
  never fails the tool -- T-37-08); calls `search_nodes(query_text=..., query_embedding=...,
  importer_id=..., limit=DEFAULT_SEARCH_LIMIT)`; envelope
  `{"mode": "search", "results": [...], "citations": [...]}` plus `"embedding_degraded": True`
  ONLY when degraded (key omitted entirely otherwise, proven by a dedicated test).
- `_execute_expand` -- validates non-blank `node_id`; calls
  `expand_neighbours(node_id=..., importer_id=..., max_depth=MAX_EXPAND_DEPTH,
  node_budget=DEFAULT_EXPAND_NODE_BUDGET)` -- hardcoded constants imported from the port,
  never read from `arguments` (T-37-10); envelope
  `{"mode": "expand", "nodes": [...], "edges": [...], "truncated": ..., "citations": [...]}`;
  edges map to `{edge_id, source_node_id, target_node_id, relation_type, tier, confidence}`
  (no free text beyond the controlled relation_type vocabulary).
- Citations: one `citation_to_dict(build_citation("knowledge", <id>))` per DISTINCT node id
  (first-seen order), both modes.

### TDD gate (RED -> GREEN)

`tests/infrastructure/tools/test_search_knowledge_executor.py` (11 tests, one per plan
behavior, all independently `-k`-selectable) was written and committed FIRST. RED confirmed:
`ModuleNotFoundError: No module named 'app.infrastructure.tools.search_knowledge_executor'`
(collection error) -- commit `bf9de7d`. Implementation added; all 11 passed on the first run
-- GREEN, commit `dcc59bb`.

The two belt-2 proofs (Tests 4/6) seed a HOSTILE mocked repository response -- a
`tier="INFERRED"` (search) / `tier="AMBIGUOUS"` (expand) row carrying non-null
title/content text -- and assert the `label` key is absent from that entry AND the hostile
marker string never appears anywhere in `result.content`. Selectable together:
`-k "belt_two or field_omission"` selects exactly 2 tests
(`test_search_mode_belt_two_omits_label_for_non_extracted_row`,
`test_expand_mode_belt_two_omits_label_for_non_extracted_node`).

### Task 2 -- Flag-gated container wiring (T-37-09 exposure gate)

`app/settings.py`: `SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False` added to `BaseAppSettings`
right after `COST_CAP_PER_ROUND_USD`, with a comment block explaining the synthesis P6 rule
(executor + tests exist regardless; only container wiring reads it; Phase 38 flips the
default after SC5). Plain bool field, no `@property` -- mirrors
`ANTICIPATORY_PROMPTING_ENABLED`'s un-wrapped convention.

`app/container.py`: re-read fresh per the plan's concurrency warning -- Phase 36's
`_provide_run_chat_turn` shape (including the `client: Client` and
`embedder: EmbeddingProtocol` parameters this task reuses) confirmed present before editing.
Added the `search_knowledge_executor` import block after the Phase-36 tools imports;
`SupabaseKnowledgeGraphRepository` was ALREADY imported (v1.5's promote-edge wiring). Inside
the factory: `knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)` (mirrors
`_provide_promote_edge_use_case`'s inline-instantiation idiom) +
`search_knowledge_executor = SearchKnowledgeExecutor(knowledge=knowledge_repo,
embedder=embedder)`. Both `tool_executors=` and `server_tool_defs=` are now single
dict-literal expressions: the two Phase-36 entries verbatim, followed by
`**({SEARCH_KNOWLEDGE_TOOL_NAME: ...} if settings.SEARCH_KNOWLEDGE_TOOL_ENABLED else {})` --
immutable construction, zero `.update()`/item-assignment (grep-verified inside the function
body). Docstring updated with the Phase 37-02 exposure-gate paragraph.

`tests/test_container.py`: new `TestSearchKnowledgeExposureGate` class --
`test_container_search_knowledge_disabled_by_default` (no env override, resolves the REAL
dishka container: `"search_knowledge"` absent from BOTH `_tool_executors` and
`_server_tool_defs` while `lookup_entity`/`search_emails` are still present -- the permanent
T-37-09 CI guard) and `test_container_search_knowledge_enabled_via_flag`
(`monkeypatch.setenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", "true")` + `get_settings.cache_clear()`
before AND after per conftest.py's pattern: `search_knowledge` present, `isinstance(...,
SearchKnowledgeExecutor)`, `input_schema.properties` contains `mode`, Phase 36 entries
intact). Both passed first run.

## Verification

```
cd apps/email-listener && uv run pytest tests/infrastructure/tools/test_search_knowledge_executor.py -q --no-cov
# 11 passed (Task 1 GREEN; RED confirmed first as ModuleNotFoundError)

cd apps/email-listener && uv run pytest tests/infrastructure/tools/test_search_knowledge_executor.py -k "belt_two or field_omission" -q --no-cov
# 2 passed (exactly the two belt-2 proofs)

grep -n "row\[.title.\]\|row\.get(.title.)\|row\.get(.content.)" app/infrastructure/tools/search_knowledge_executor.py
# 1 match, line 109 -- inside _belt_two_label ONLY

grep -n '"knowledge"' app/infrastructure/tools/envelope.py
# 2 matches: CitationKind Literal (line 18) + _ROUTE_TEMPLATES (line 29)

cd apps/email-listener && uv run pytest tests/infrastructure/tools/ -q --no-cov
# 26 passed (7 lookup_entity + 8 search_emails + 11 new -- Phase 36 executors unregressed)

cd apps/email-listener && uv run pytest tests/test_container.py tests/application/test_run_chat_turn.py -q --no-cov
# 29 passed (27 pre-existing + 2 new flag-gate guards)

# Full plan-level sweep:
cd apps/email-listener && uv run pytest tests/infrastructure/tools/ tests/test_container.py \
  tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_e2e.py --no-cov
# 66 passed, 0 failed

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_real_tools_wiring.py -q --no-cov
# 3 passed (Phase 36's exact-2-keys container assertion still holds with the flag off)

cd apps/email-listener && uv run mypy app/infrastructure/tools app/settings.py app/container.py
# 12 pre-existing errors in the SAME 4 unrelated infrastructure files 36-02-SUMMARY.md documented
# (genui_code_generator_adapter 2, genui_generator_adapter 1,
# supabase_chat_widget_interaction_repository 6, supabase_ui_spec_template_repository 3) --
# ZERO errors in any file this plan touched/created.

cd apps/email-listener && uv run mypy app/infrastructure/tools/search_knowledge_executor.py app/infrastructure/tools/envelope.py
# Success: no issues found in 2 source files

cd apps/email-listener && uv run lint-imports
# Contracts: 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/infrastructure/tools/search_knowledge_executor.py \
  app/infrastructure/tools/envelope.py app/settings.py app/container.py tests/test_container.py
# All checks passed!

grep -rn "CREATE \|ALTER \|\.rpc(\"match_" apps/email-listener/app/infrastructure/tools/search_knowledge_executor.py
# zero matches -- zero raw SQL / new RPC names beyond 37-01's repository calls (HARD constraint)

grep -n "SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False" apps/email-listener/app/settings.py
# line 152 -- the default is closed

sed -n '/def _provide_run_chat_turn/,/^def _provide_submit_widget_interaction/p' app/container.py | grep -n "\.update(\|tool_executors\["
# zero matches -- immutable dict-literal-with-conditional-unpack, no mutation
```

Note: as in every prior Phase 34/35/36/37 plan, the repo's global pytest coverage gate
(`fail-under=80`) fails on any targeted subset run by design -- the pass/fail counts above
are what verify this plan. The 10 pre-existing failures in
`tests/test_genui_retrieval_provider.py` (known unrelated Python 3.13 asyncio issue) were not
touched and not counted in any sweep here.

## Deviations from Plan

**1. [Claude's Discretion, minor] Per-mode helpers return `dict[str, Any] | ToolExecutionResult`.**
The plan's action text says the helpers both "validate" (Tests 7/8's early `is_error`) and
"build and return the mode-specific envelope dict" (which `execute` then caps). Honoring both
literally requires a union return: validation short-circuits return the error
`ToolExecutionResult` directly; the success path returns the envelope dict for `execute` to
`cap_tool_output`-wrap. No behavioral difference from the plan's 11 specified behaviors --
all pass exactly as written.

**2. [Cosmetic, non-blocking] Flag-gate tests grouped in a class.** The two new container
tests live in a `TestSearchKnowledgeExposureGate` class (with a T-37-09 docstring) rather
than as bare module-level functions -- matches `tests/test_container.py`'s existing
class-grouped style. Test NAMES are exactly the plan's
(`test_container_search_knowledge_disabled_by_default` /
`test_container_search_knowledge_enabled_via_flag`).

No Rule 1-3 fixes were needed (everything passed first run after RED). No architectural
deviations (Rule 4 not triggered). No auth gates encountered.

## Known Stubs

None. `SearchKnowledgeExecutor` is fully implemented and tested end-to-end against its 2
collaborator ports. It is intentionally NOT reachable by a real chat turn --
`SEARCH_KNOWLEDGE_TOOL_ENABLED` defaults `False` BY DESIGN (this plan's own must_have truth +
ROADMAP Phase 37 SC5: "built, not yet exposed"); Phase 38 flips it after the adversarial
fixture suite passes. This is the documented exposure gate, not a stub.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-37-06..10, all addressed as designed
-- see What Was Built for T-37-06/T-37-08/T-37-09/T-37-10's concrete implementations;
T-37-07 remains `accept` per the plan, deferred to Phase 38's adversarial suite with the
schema `maxLength` bounds as defense-in-depth only).

## Self-Check: PASSED

- FOUND: apps/email-listener/app/infrastructure/tools/search_knowledge_executor.py
- FOUND: apps/email-listener/tests/infrastructure/tools/test_search_knowledge_executor.py
- FOUND: apps/email-listener/app/infrastructure/tools/envelope.py ("knowledge" in CitationKind + _ROUTE_TEMPLATES)
- FOUND: apps/email-listener/app/settings.py (SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False)
- FOUND: apps/email-listener/app/container.py (flag-gated conditional inclusion, both mappings)
- FOUND: apps/email-listener/tests/test_container.py (both exposure-gate guards)
- FOUND commit bf9de7d (Task 1 RED -- 11-behavior test suite)
- FOUND commit dcc59bb (Task 1 GREEN -- executor + envelope "knowledge" kind)
- FOUND commit 9ef100d (Task 2 -- settings flag + container wiring + guards)
