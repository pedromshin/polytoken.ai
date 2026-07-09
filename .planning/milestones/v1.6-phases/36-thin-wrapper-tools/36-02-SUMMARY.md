---
phase: 36-thin-wrapper-tools
plan: 02
subsystem: chat-tool-loop
tags: [tool-executor, search-emails, container-wiring, thin-wrapper, TOOL-02]
dependency_graph:
  requires:
    - "app.infrastructure.tools.envelope (36-01) -- ToolCitation, build_citation, citation_to_dict, truncate_field"
    - "app.infrastructure.tools.lookup_entity_executor (36-01) -- LOOKUP_ENTITY_TOOL_NAME, LookupEntityExecutor, build_lookup_entity_tool"
    - "app.domain.ports.tool_executor.ToolExecutor.execute(..., importer_id) (36-01)"
    - "app.domain.ports.retrieval_port.RetrievalPort.find_similar_confirmed (Phase 4/8, unchanged)"
  provides:
    - "app.infrastructure.tools.search_emails_executor (SEARCH_EMAILS_TOOL_NAME, build_search_emails_tool, SearchEmailsExecutor, EmailSearchResult)"
    - "app.application.use_cases.run_chat_turn.RunChatTurn server_tool_defs constructor param + real-schema _build_tool_offer lookup"
    - "app.container._provide_run_chat_turn production tool_executors={lookup_entity, search_emails} + server_tool_defs wiring"
  affects:
    - "Phase 37 (search_knowledge shares the same container.py _provide_run_chat_turn factory + the server_tool_defs seam this plan added)"
    - "Phase 38 (quarantine formalization/eval builds on the Tier-2 structural-omission pattern this plan established)"
    - "Phase 39 (tool-round UI consumes the citations[] this plan's envelope produces)"
tech_stack:
  added: []
  patterns:
    - "Thin infrastructure wrapper looping per-active-entity-type over an existing retrieval port call (mirrors 36-01's LookupEntityExecutor name-search fallback -- there is no single cross-entity-type retrieval RPC)"
    - "Tier-2 quarantine enforced by dataclass field omission, not a runtime check (EmailSearchResult has no raw-source-text field at all)"
    - "Real per-tool schema lookup with generic-stub fallback (server_tool_defs.get(name, stub)) -- additive, non-breaking for callers that never pass it"
key_files:
  created:
    - apps/email-listener/app/infrastructure/tools/search_emails_executor.py
    - apps/email-listener/tests/infrastructure/tools/test_search_emails_executor.py
    - apps/email-listener/tests/application/test_run_chat_turn_real_tools_wiring.py
  modified:
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/app/container.py
decisions:
  - "SearchEmailsExecutor loops find_similar_confirmed() once PER active entity type (same shape as 36-01's LookupEntityExecutor name-search fallback) -- both underlying RPCs (match_components_by_embedding/match_components_by_trgm) require a single match_entity_type_id, so there is no single cross-entity-type retrieval call; results are merged, deduped by resulting email_id (keep highest score), sorted descending, capped at top 5 EMAILS (not top 5 components)"
  - "EmailSearchResult dataclass carries ONLY email_id/subject/sender_name/sender_address/received_at/extracted_fields/score -- no raw-source-text field exists on the type at all, so the Tier-2 'never raw body' rule is structurally unreachable to violate by omission (verified by a grep returning zero matches for the 4 forbidden identifiers anywhere in the executor file, including comments)"
  - "Tenant defense-in-depth (T-36-06) re-checks BOTH the resolved component's AND the resolved email's own importer_id against the caller's importer_id before the result is ever constructed -- belt-and-suspenders against a future RPC regression, even though find_similar_confirmed's RPC is already importer-scoped"
  - "_build_tool_offer's per-server-tool schema now does server_tool_defs.get(tool_name, <generic stub>) instead of always building the generic stub -- additive default (empty mapping) so every pre-Phase-36 test/caller that constructs RunChatTurn without server_tool_defs stays green; a name with no matching def (e.g. a test-only EchoToolExecutor) still gets the original stub"
  - "container.py's _provide_run_chat_turn instantiates SupabaseEntityResolutionRepository directly from Client (mirrors _provide_resolve_candidates_use_case's identical existing pattern) since it is a concrete infrastructure class, not a port dishka can bind directly"
metrics:
  duration: "~70 min"
  completed: 2026-07-08
---

# Phase 36 Plan 02: SearchEmailsExecutor + Container Wiring Summary

Ships the second real `ToolExecutor` (`search_emails`, TOOL-02) as a thin wrapper over the
existing `RetrievalPort.find_similar_confirmed()`, enforcing the Tier-2 "never raw body" rule
structurally via dataclass field omission, then wires BOTH real tools (`lookup_entity` from
36-01 + `search_emails` from this plan) into `container.py`'s production `tool_executors`
mapping and closes the Phase-34 tool-schema-advertisement gap so the model sees real per-tool
argument shapes instead of the empty-object placeholder.

## What Was Built

### Task 1 -- SearchEmailsExecutor (TOOL-02, thin wrapper, zero new backend)

`app/infrastructure/tools/search_emails_executor.py`: `SEARCH_EMAILS_TOOL_NAME = "search_emails"`,
`build_search_emails_tool()` (Bedrock-valid `input_schema`: `required: ["query"]`,
`additionalProperties: false`, `maxLength: 200` -- same defense-in-depth convention as 36-01's
`build_lookup_entity_tool()`), a frozen `EmailSearchResult` dataclass (`email_id`, `subject`,
`sender_name`, `sender_address`, `received_at` (ISO string), `extracted_fields`, `score` -- no
raw-source-text field exists on the type at all), and `SearchEmailsExecutor` implementing all 7
required behaviors:

1. **Happy path** -- embeds `query` via `embedder.embed`, extracts `key_terms` via
   `extract_key_terms`, loads every active entity type via `entity_types.list_active`, calls
   `retrieval.find_similar_confirmed` ONCE PER active entity type (`top_n=5`), resolves each
   surviving `RetrievedExample.component_id` -> `components.find_by_id` -> `.email_id` ->
   `emails.find_by_id`, dedupes by `email_id` (keeps the highest-scoring example per email since
   two confirmed components can belong to the same email), sorts descending, caps at the top 5
   EMAILS.
2. **Tenant defense-in-depth (T-36-06)** -- a resolved `Component` or `Email` whose own
   `.importer_id` disagrees with the caller's `importer_id` is skipped entirely, even though
   `find_similar_confirmed`'s RPC is already importer-scoped.
3. **Tier-2 (never raw body)** -- `EmailSearchResult` structurally excludes any raw-source-text
   field; verified by planting a unique marker string in both the region's raw text and the
   email's raw body/HTML fields and asserting the marker never appears in the executor's returned
   `ToolExecutionResult.content`, plus a zero-matches grep for the 4 forbidden identifiers
   (`content_text`/`body_html`/`body_text`/`raw_storage_key`) anywhere in the executor source file
   -- including comments/docstrings, which were deliberately written to avoid those literal
   identifiers entirely.
4. **Empty query** -- `arguments.get("query")` missing/None/blank -> `is_error=True`, zero
   collaborator calls (verified via `assert_not_called()` across 4 bad-input variants).
5. **No active entity types / no confirmed matches** -- returns `is_error=False`, `results: []`,
   `citations: []` (cold-start safe, D-13 convention) -- covered as two sub-cases in one test.
6. **Collaborator exception** -- caught inside `execute`'s single try/except, logged via
   `structlog.warning`, returns a friendly `is_error=True` result with no exception internals
   leaked in `content`.
7. **Citations shape** -- one `{"kind": "email", "id", "route": "/emails/{id}"}` entry per
   distinct result `email_id`, built via `envelope.build_citation("email", ...)`.

Extracted `_gather_candidates` (the per-entity-type loop + merge/dedupe/rank/cap) and
`_resolve_to_email_result` (the tenant-checked component -> email resolution) as private async
helpers, so `execute` stays a thin orchestration/envelope-building method -- matching
`LookupEntityExecutor`'s two-helper structure from 36-01.

`tests/infrastructure/tools/test_search_emails_executor.py`: 8 tests (one behavior split into a
dedicated happy-path test covering merge+dedupe+rank+cap together, since all four are only
provable in combination against one realistic fixture set, plus the standard content-is-capped
regression test mirroring 36-01's convention).

### Task 2 -- Wire both real executors into container.py + close the schema-advertisement gap

`app/application/use_cases/run_chat_turn.py`: re-read fresh per the plan's concurrency warning --
confirmed `RunChatTurn.__init__`'s signature and `_build_tool_offer`'s current shape matched the
plan's `<read_first>` description exactly (Phase 35's per-round cost-ceiling wiring lives entirely
in `_execute_turn`'s round-boundary checks, untouched by this diff). Added a new keyword-only
constructor parameter `server_tool_defs: Mapping[str, dict[str, Any]] = MappingProxyType({})`
(additive default, positioned alongside `tool_executors`), stored as `self._server_tool_defs`.
`_build_tool_offer`'s server-tools comprehension now does `self._server_tool_defs.get(tool_name,
<original generic stub dict>)` per tool name -- a tool with a matching entry gets its real schema
verbatim; a tool with no entry (e.g. a test-only `EchoToolExecutor` registered without a def)
still gets the exact original stub, unchanged. No other branch of `_build_tool_offer` touched.

`app/container.py`: added imports for `LOOKUP_ENTITY_TOOL_NAME`/`LookupEntityExecutor`/
`build_lookup_entity_tool` and `SEARCH_EMAILS_TOOL_NAME`/`SearchEmailsExecutor`/
`build_search_emails_tool` (placed in isort-correct alphabetical position, after the `supabase.*`
import block and before `app.settings`). `_provide_run_chat_turn` gained 7 new parameters
(`client`, `entity_instances`, `entity_types`, `embedder`, `retrieval`, `components`,
`email_repo`) -- every one already `provider.provide(...)`-bound elsewhere in the file, confirmed
against the plan's `<interfaces>` block before adding them. Inside the factory:
`resolution_repo = SupabaseEntityResolutionRepository(client=client)` (mirrors
`_provide_resolve_candidates_use_case`'s identical existing pattern), then both executors are
constructed and passed as `tool_executors={LOOKUP_ENTITY_TOOL_NAME: ..., SEARCH_EMAILS_TOOL_NAME:
...}` and `server_tool_defs={LOOKUP_ENTITY_TOOL_NAME: build_lookup_entity_tool(),
SEARCH_EMAILS_TOOL_NAME: build_search_emails_tool()}` -- the production `tool_executors` mapping
is no longer empty. The old "EMPTY in production" comment was replaced with one stating these are
the first two real production tools, offered to every `max_tool_rounds > 0` model (the 2 Bedrock
Claude registry entries) via the existing gate -- no new capability gating added.

A live smoke test against the real `create_container()` (external clients patched, mirrors
`test_container.py`'s pattern) confirmed both tools resolve to their concrete executor types and
advertise real `input_schema.properties` before this task was committed.

### Task 3 -- Wiring/integration regression guards

`tests/application/test_run_chat_turn_real_tools_wiring.py` (3 tests, fakes adapted from
`test_run_chat_turn_tool_loop_e2e.py`'s working shapes, self-contained per this repo's
per-test-file convention):

1. `test_build_tool_offer_advertises_real_lookup_entity_and_search_emails_schemas` -- constructs
   `RunChatTurn` directly with both `tool_executors` and `server_tool_defs` populated, calls
   `_build_tool_offer` with the REAL `us.anthropic.claude-sonnet-4-6` registry entry (no test-model
   monkeypatching needed), asserts `"properties"` exists on both tools' `input_schema` and that
   `name_or_id`/`query` are present as declared properties -- the exact regression guard 36-CONTEXT.md
   flagged for the schema-advertisement gap.
2. `test_container_wires_both_real_tool_executors` -- resolves `RunChatTurn` from the real dishka
   container and asserts `run_chat_turn._tool_executors` has EXACTLY the 2 keys
   `{"lookup_entity", "search_emails"}`, each an instance of its concrete executor class.
3. `test_lookup_entity_round_trip_produces_grounded_citations` -- a real `LookupEntityExecutor`
   wired against `AsyncMock`-based fakes (id-miss path -> name-search fallback) and a manual
   synchronous fake `EntityResolutionRepository.find_candidates` returning one canned
   `EntityCandidate`, driven through one full `run_chat_turn.run(...)` call via a single-tool-round
   fake `ChatProvider`. Asserts the persisted `tool_invocation_result` part's `content` parses as
   JSON, contains a `citations` entry whose `route == "/entities/<fixture entity_instance_id>"`,
   and the substring `content_text` never appears in the raw content string -- proving the
   Tier-1/Tier-2 quarantine obligation holds through a REAL round trip, not just isolated unit
   tests.

All 3 tests passed on the first run.

## Verification

```
cd apps/email-listener && uv run pytest tests/infrastructure/tools/test_search_emails_executor.py -q --no-cov
# 8 passed (Task 1)

cd apps/email-listener && uv run pytest tests/infrastructure/tools/test_search_emails_executor.py -k tier2 -q --no-cov
# 1 passed (Tier-2 marker-string filter)

cd apps/email-listener && uv run mypy app/infrastructure/tools/search_emails_executor.py
# Success: no issues found in 1 source file

cd apps/email-listener && uv run pytest tests/test_container.py tests/application/test_run_chat_turn.py -q --no-cov
# 27 passed (Task 2)

cd apps/email-listener && uv run mypy app/container.py app/application/use_cases/run_chat_turn.py
# 12 pre-existing errors, ALL in unrelated infrastructure files (genui_generator_adapter.py,
# genui_code_generator_adapter.py, supabase_ui_spec_template_repository.py,
# supabase_chat_widget_interaction_repository.py) transitively imported by container.py --
# confirmed IDENTICAL count/content via git stash before/after this plan's diff (34-03-SUMMARY.md
# precedent). Zero errors in container.py / run_chat_turn.py themselves.

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_real_tools_wiring.py -q --no-cov
# 3 passed (Task 3)

# Full phase-level sweep (plan's <verification> block):
cd apps/email-listener && uv run pytest tests/infrastructure/tools/ tests/application/test_run_chat_turn_real_tools_wiring.py \
  tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/test_container.py -q --no-cov
# 58 passed, 0 failed

cd apps/email-listener && uv run mypy app/infrastructure/tools app/container.py app/application/use_cases/run_chat_turn.py
# 12 pre-existing errors (same 4 unrelated files as above), 0 in the 6 touched/created source files

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

grep -rn "CREATE \|ALTER \|\.rpc(\"match_components\|\.rpc(\"" apps/email-listener/app/infrastructure/tools/
# zero matches -- zero NEW rpc names, zero raw SQL anywhere in this phase's new files (HARD constraint verified)

grep -n "content_text\|body_html\|body_text\|raw_storage_key" apps/email-listener/app/infrastructure/tools/search_emails_executor.py
# zero matches (as attribute reads AND as literal identifiers anywhere in the file, including comments)

grep -n "LOOKUP_ENTITY_TOOL_NAME:\|SEARCH_EMAILS_TOOL_NAME:" apps/email-listener/app/container.py
# 4 matches (2 in tool_executors=, 2 in server_tool_defs=) -- matches acceptance criteria exactly

grep -n "server_tool_defs" apps/email-listener/app/application/use_cases/run_chat_turn.py
# matches in __init__'s signature, the self._server_tool_defs = assignment, and inside _build_tool_offer
```

Live DI resolution was also smoke-tested directly against the real `create_container()` (external
clients patched) before Task 2's commit: both `lookup_entity` and `search_emails` resolved to
their concrete executor types with real `input_schema` properties advertised.

Note: as in every prior Phase 34/35/36 plan, the repo's global pytest coverage gate
(`fail-under=80`) fails on any targeted subset run by design -- the pass/fail counts above are
what verify this plan.

## Deviations from Plan

**1. [Rule 1 -- test-fixture bug caught during authoring, non-blocking] Happy-path test's expected
ranking.** The first draft of `test_happy_path_merges_dedupes_ranks_and_caps_at_five_emails`
asserted the wrong 5-email subset would survive the top-5 cap (expected the wrong email to be
dropped by insertion-position intuition rather than by actual score). Caught on first test run
(assertion failure, not a silent pass), root-caused as a test-authoring arithmetic error (not an
executor bug), and fixed by recomputing the expected ranking from the fixture's actual scores. The
executor implementation was correct from the first write; only the test's own expected-value
literal was wrong. No production code changed.

**2. [Rule 1 -- lint cleanup, non-blocking] Two ruff-flagged issues in the new test file fixed
before commit.** `PLW0108` (unnecessary lambda -- `lambda x: some_map.get(x)` simplified to
`some_map.get`) and `RUF059` (an unpacked-but-unused `retrieval` variable prefixed with `_`) were
both fixed inline; both are mechanical, zero-behavior-change cleanups. The remaining ruff findings
in the new test file are the same pre-existing repo-wide `PT023` (`@pytest.mark.unit()` vs
`@pytest.mark.unit`) pattern 34-01-SUMMARY.md and 36-01-SUMMARY.md both already documented as
out-of-scope (present in `test_lookup_entity_executor.py` too) -- left as-is for consistency with
the established convention in this file family.

**3. [Plan-text interpretation, non-blocking] Literal-zero-grep-match interpretation of the
Tier-2 acceptance criterion.** The plan's Task 1 acceptance criterion text is internally
ambiguous -- it first says the grep "returns ONLY read-time source-attribute references needed to
resolve routing (e.g. reading `component.email_id` is fine)" but then states "grep for these 4
identifiers must return zero matches." Taken the stricter way (literally zero occurrences of
`content_text`/`body_html`/`body_text`/`raw_storage_key` anywhere in the file, including
docstrings/comments) per the human operator's success-criteria wording, which also demanded zero
matches. The executor's docstrings were written to describe the Tier-2 rule without ever using
those 4 literal identifier strings. Verified: `grep -c` on the executor file returns 0.

**4. [Rule 3 -- scope-boundary, non-blocking] Concurrent-agent commits observed mid-plan.** Per
the scope constraints, `git log` showed at least one other agent's commit (`4c15cd2 fix(39):
restore LF line endings in ROADMAP.md`) land on `main` between this plan's Task 2 and Task 3
commits, exactly as the operator's concurrency note anticipated. No conflict occurred -- every
commit in this plan staged only explicit paths (never `git add -A`/`git add .`), and none of the
files this plan touches overlap with any concurrently-modified file.

No architectural deviations (Rule 4 not triggered).

## Known Stubs

None. `SearchEmailsExecutor` is fully implemented and unit-tested end-to-end against its 4 real
collaborator ports, and both `lookup_entity`/`search_emails` are now live in `container.py`'s
production `tool_executors` mapping with real schemas advertised via `server_tool_defs` -- the gap
36-01-SUMMARY.md explicitly deferred to this plan is now closed.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-36-05/T-36-06/T-36-07/T-36-08, all
addressed as designed -- see Decisions above and the `<threat_model>`-mandated Task 3 regression
tests for T-36-07's concrete implementation).

## Self-Check: PASSED

- FOUND: apps/email-listener/app/infrastructure/tools/search_emails_executor.py
- FOUND: apps/email-listener/tests/infrastructure/tools/test_search_emails_executor.py
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_real_tools_wiring.py
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py (server_tool_defs param +
  `_build_tool_offer` real-schema lookup present)
- FOUND: apps/email-listener/app/container.py (LOOKUP_ENTITY_TOOL_NAME/SEARCH_EMAILS_TOOL_NAME
  wired in both `tool_executors=` and `server_tool_defs=`)
- FOUND commit 4a5f247 (Task 1)
- FOUND commit 1ea9a68 (Task 2)
- FOUND commit b7b6c94 (Task 3)
