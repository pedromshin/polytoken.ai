---
phase: 36-thin-wrapper-tools
plan: 01
subsystem: chat-tool-loop
tags: [tool-executor, importer-scoping, lookup-entity, thin-wrapper, TOOL-01]
dependency_graph:
  requires:
    - "app.domain.ports.tool_executor.ToolExecutor (34-01)"
    - "app.application.use_cases.run_chat_turn._run_server_tool_round / _advance_round (34-03)"
    - "app.application.use_cases.resolve_entity_candidates.ResolveEntityCandidatesUseCase (call-shape reference)"
  provides:
    - "app.domain.ports.tool_executor.ToolExecutor.execute(..., importer_id) -- required kwarg"
    - "app.infrastructure.tools.envelope (ToolCitation, build_citation, citation_to_dict, truncate_field)"
    - "app.infrastructure.tools.lookup_entity_executor (LOOKUP_ENTITY_TOOL_NAME, build_lookup_entity_tool, LookupEntityExecutor, EntityLookupResult)"
  affects:
    - "36-02 (search_emails executor shares envelope.py + the same container.py wiring edit)"
    - "Every future ToolExecutor implementation (importer_id is now a required Protocol kwarg)"
tech_stack:
  added: []
  patterns:
    - "Thin infrastructure wrapper over an existing application use case's exact repository call shape (mirrors ResolveEntityCandidatesUseCase)"
    - "id-lookup-with-name-search-fallback, cross-tenant treated identically to not-found (D-18 pattern)"
    - "Server-built citations, never model-echoed (envelope.build_citation as the single route-construction point)"
key_files:
  created:
    - apps/email-listener/app/infrastructure/tools/__init__.py
    - apps/email-listener/app/infrastructure/tools/envelope.py
    - apps/email-listener/app/infrastructure/tools/lookup_entity_executor.py
    - apps/email-listener/tests/infrastructure/tools/__init__.py
    - apps/email-listener/tests/infrastructure/tools/test_lookup_entity_executor.py
  modified:
    - apps/email-listener/app/domain/ports/tool_executor.py
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/tests/support/echo_tool_executor.py
    - apps/email-listener/tests/support/test_echo_tool_executor.py
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py
decisions:
  - "importer_id is a REQUIRED (no default) keyword-only Protocol parameter on ToolExecutor.execute -- mirrors this codebase's find_candidates/find_similar_confirmed convention; a future executor that ignores it still receives the correct value (T-36-04 mitigation)"
  - "Cross-tenant find_by_id hits are treated IDENTICALLY to not-found: fall through to the name-search path scoped to the CALLER's importer_id, never surface a tenant-mismatch error that would reveal the id exists (T-36-01, D-18 pattern)"
  - "find_candidates is called PER active entity type on the name-search fallback path (its RPCs filter on a single entity_type_id) -- results merged by entity_instance_id keeping the highest rrf_score, then sorted descending and capped at 5"
  - "EntityLookupResult.entity_type_id on find_candidates results is set from the entity_type_id the call was scoped with (id-hit path: the id-hit instance's own type; name-search path: the loop's current entity type) -- find_candidates never returns cross-type candidates for a given call"
metrics:
  duration: "~55 min"
  completed: 2026-07-08
---

# Phase 36 Plan 01: ToolExecutor importer_id + LookupEntityExecutor Summary

Threads `importer_id` through the `ToolExecutor` port and the round loop, adds a shared
citation/truncation envelope module, and ships `LookupEntityExecutor` -- the first real,
production `ToolExecutor`, a thin wrapper over the existing `find_candidates()`/`find_by_id()`/
`list_active()` repository methods with zero new backend.

## What Was Built

### Task 1 -- ToolExecutor importer_id + shared envelope helpers

`app/domain/ports/tool_executor.py`: `ToolExecutor.execute` gained a new REQUIRED keyword-only
`importer_id: str` parameter (no default), with the docstring updated to state that implementations
MUST scope every downstream query to it -- the concrete enforcement mechanism for the port's
existing quarantine-obligation docstring (T-36-04).

`app/application/use_cases/run_chat_turn.py`: re-read fresh per the plan's concurrency warning
(Phase 35 had already landed per-round cost-ceiling wiring in this file, confirmed unchanged by
this plan's diff). `_run_server_tool_round` gained `importer_id: str` appended to its keyword-only
parameter list; its `executor.execute(...)` call site now passes `importer_id=importer_id`.
`_advance_round`'s existing call to `_run_server_tool_round` now also passes `importer_id=importer_id`
-- no new plumbing was needed above that call frame since `_advance_round` already received
`importer_id: str` as its own parameter (used by its pre-existing `self._terminate(...)` call).

Test doubles updated to the new required kwarg: `tests/support/echo_tool_executor.py`
(`EchoToolExecutor.execute` adds `importer_id: str`, `del name, importer_id`), its 5 call sites in
`tests/support/test_echo_tool_executor.py` (the plan's `<action>` text estimated 4; the fresh file
actually has 5 -- all updated), and `_RaisingToolExecutor`/`_CountingEchoToolExecutor` in
`tests/application/test_run_chat_turn_tool_loop_e2e.py`.

New `app/infrastructure/tools/__init__.py` (empty docstring-only, mirrors every other infrastructure
subpackage) and `app/infrastructure/tools/envelope.py`: `CitationKind` (`Literal["entity", "email"]`),
`MAX_RESULT_FIELD_CHARS = 300` (Fork 5's per-result-field truncation convention, distinct from
`cap_tool_output`'s whole-envelope 2000-char cap), frozen `ToolCitation` dataclass
(`kind`/`id`/`route`), `build_citation(kind, id)` (the ONLY place a citation route string is
constructed -- looks up `_ROUTE_TEMPLATES = {"entity": "/entities/{id}", "email": "/emails/{id}"}`),
`citation_to_dict` (`dataclasses.asdict`), and `truncate_field` (same visible `"…[truncated]"` marker
convention as `cap_tool_output`, kept independently since this module has zero dependency on
`run_chat_turn_tool_loop.py`).

### Task 2 -- LookupEntityExecutor (TOOL-01, TDD RED/GREEN)

`app/infrastructure/tools/lookup_entity_executor.py`: `LOOKUP_ENTITY_TOOL_NAME = "lookup_entity"`,
`build_lookup_entity_tool()` (Bedrock-valid `input_schema`: `required: ["name_or_id"]`,
`additionalProperties: false`, `maxLength: 200` -- mirrors `chat_tools.py`'s defense-in-depth
conventions), frozen `EntityLookupResult` dataclass (`display_name` run through `truncate_field`
before storage), and `LookupEntityExecutor` implementing all 7 behaviors:

1. **id hit** -- `find_by_id` resolves an active, same-tenant `EntityInstance` -> calls
   `find_candidates` with that instance's own `display_name`/`identifiers`/`entity_type_id`/
   `embedding` (mirrors `ResolveEntityCandidatesUseCase` exactly, called SYNCHRONOUSLY, no
   `await`) -> returns the instance itself (`match_type="id_exact"`, `score=1.0`) followed by up
   to 4 more candidates, deduped by `entity_instance_id`, capped at 5.
2. **id miss** -- falls back to `_search_by_name`: embeds `name_or_id` via `embedder.embed`, loads
   every active entity type via `entity_types.list_active(importer_id)`, calls `find_candidates`
   once PER entity type (each RPC filters on a single `entity_type_id`, so results are merged by
   `entity_instance_id` keeping the highest `rrf_score`), sorted descending, capped at 5 -- never
   raises on an empty merged list.
3. **cross-tenant id** -- `find_by_id`'s row has `.importer_id != importer_id` -> treated
   IDENTICALLY to not-found, takes the same `_search_by_name` fallback scoped to the CALLER's
   importer_id -- never returns the other tenant's instance, identifiers, or display_name (T-36-01).
4. **empty/missing/whitespace-only `name_or_id`** -> `is_error=True` with a friendly message,
   zero repository calls (verified via `assert_not_called()` on all 3 collaborators plus an empty
   `resolution_repo.calls` list, across 4 bad-input variants in one test).
5. **any collaborator exception** -- caught inside `execute`'s single try/except, logged via
   `structlog.warning` (detailed server-side), returns `is_error=True` with a generic message that
   never leaks exception internals (verified: a `RuntimeError` message containing a fake connection
   string never appears in `result.content`).
6. **citations shape** -- one `{"kind": "entity", "id", "route": "/entities/{id}"}` entry per
   distinct result id, built via `envelope.build_citation("entity", ...)`.
7. **content is capped JSON** -- `json.loads(result.content)` succeeds; length bounded by
   `cap_tool_output`'s `MAX_TOOL_OUTPUT_CHARS` + truncation-marker length.

Not yet wired into `container.py` -- 36-02 does that alongside `search_emails` (single shared
`_provide_run_chat_turn` diff).

### TDD gate (RED -> GREEN)

`tests/infrastructure/tools/test_lookup_entity_executor.py` was written and committed BEFORE the
implementation existed. RED confirmed by temporarily moving the implementation module aside and
re-running the suite: `ModuleNotFoundError: No module named 'app.infrastructure.tools.lookup_entity_executor'`
(collection error, 1 error). The implementation was restored and the full 7-test suite passed on
the first run (7 passed, 0 failed) -- GREEN. Commits: `e6bbcaa` (`test(36-01): ... RED`), `a4dd476`
(`feat(36-01): ... GREEN`).

## Verification

```
cd apps/email-listener && uv run pytest tests/support/test_echo_tool_executor.py \
  tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py -q --no-cov
# 31 passed (Task 1)

cd apps/email-listener && uv run pytest tests/infrastructure/tools/test_lookup_entity_executor.py -q --no-cov
# 7 passed (Task 2)

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py \
  tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py \
  tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py -q --no-cov
# 50 passed (full plan <verification> sweep -- note: the plan's own text references "66 passed" from
# 34-03-SUMMARY.md, but that count also included test_container.py + test_emit_ui_spec_tool.py, which
# this plan's own <verification> command does not list; 0 failures either way, which is what verifies
# the plan)

cd apps/email-listener && uv run mypy app/domain/ports/tool_executor.py \
  app/application/use_cases/run_chat_turn.py app/infrastructure/tools/envelope.py \
  app/infrastructure/tools/lookup_entity_executor.py tests/support/echo_tool_executor.py
# Success: no issues found in 5 source files

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/infrastructure/tools/lookup_entity_executor.py \
  app/infrastructure/tools/envelope.py app/infrastructure/tools/__init__.py
# All checks passed!

grep -c "content_text\|body_html\|body_text" app/infrastructure/tools/lookup_entity_executor.py
# 0
```

Note: as in every prior Phase 34/35 plan, the repo's global pytest coverage gate (`fail-under=80`)
fails on any targeted subset run by design -- the pass/fail counts above are what verify this plan.
`uv run ruff check` on the new test file surfaces the same pre-existing repo-wide `PT023`
(`@pytest.mark.unit()` vs `@pytest.mark.unit`) pattern already documented as out-of-scope in
34-01-SUMMARY.md -- confirmed absent from all 3 production files this plan touched/created.

## Deviations from Plan

**1. [Plan-text drift, non-blocking] Test-call-site count.** The plan's Task 1 action text estimated
"4 call sites" in `test_echo_tool_executor.py` needing the new `importer_id` kwarg; the fresh file
(re-read per the concurrency warning) actually has 5 (`test_echo_round_trips_arguments`,
`test_echo_defaults_tool_use_id_when_absent`, `test_echo_forced_error_returns_is_error_true`,
`test_echo_output_is_capped`, `test_echo_sleep_flag_delays_before_returning`). All 5 updated.

**2. [Plan-text drift, non-blocking] `<verification>` pass-count reference.** The plan's own
`<verification>` block says to "expect the same pass count 34-03-SUMMARY.md recorded, 66 passed,
plus this plan's new tests" but lists a 5-file sweep that is missing `test_container.py` and
`test_emit_ui_spec_tool.py` (both counted in 34-03's 66). Ran exactly the plan's specified command:
50 passed, 0 failed -- the pass/fail count (not the raw number) is what verifies the plan, per this
executor's own protocol note echoed in every prior Phase 34 SUMMARY.

**3. [Rule 3 -- scope-boundary, non-blocking] `.planning/HANDOFF.json` and other concurrent-agent
files.** Per the scope constraints, these were never touched by this plan's tasks; `git log`
confirmed at least one other agent (`docs(39): UI design contract`, commit `5534125`) committed to
`main` between this plan's Task 1 and Task 2 commits, exactly as the concurrency warning
anticipated. No conflict occurred since this plan staged only explicit paths at every commit.

No architectural deviations (Rule 4 not triggered).

## Known Stubs

None. `LookupEntityExecutor` is fully implemented and unit-tested end-to-end against its 3 real
collaborator ports. It is intentionally NOT yet wired into `container.py` -- documented in the plan
itself as 36-02's job (shared `_provide_run_chat_turn` diff alongside `search_emails`), not a gap.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-36-01..04, all addressed as designed --
see Decisions above for T-36-01/T-36-04's concrete implementation).

## Self-Check: PASSED

- FOUND: apps/email-listener/app/domain/ports/tool_executor.py
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py
- FOUND: apps/email-listener/app/infrastructure/tools/__init__.py
- FOUND: apps/email-listener/app/infrastructure/tools/envelope.py
- FOUND: apps/email-listener/app/infrastructure/tools/lookup_entity_executor.py
- FOUND: apps/email-listener/tests/infrastructure/tools/__init__.py
- FOUND: apps/email-listener/tests/infrastructure/tools/test_lookup_entity_executor.py
- FOUND: apps/email-listener/tests/support/echo_tool_executor.py
- FOUND: apps/email-listener/tests/support/test_echo_tool_executor.py
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py
- FOUND commit bf86cc6 (Task 1)
- FOUND commit e6bbcaa (Task 2 RED)
- FOUND commit a4dd476 (Task 2 GREEN)
