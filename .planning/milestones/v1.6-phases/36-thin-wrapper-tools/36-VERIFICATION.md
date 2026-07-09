---
phase: 36-thin-wrapper-tools
verified: 2026-07-08T23:30:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
---

# Phase 36: Thin-Wrapper Tools Verification Report

**Phase Goal:** User can ask the chat agent about a known entity or find related emails and get
grounded, cited results — both tools are thin wrappers over existing retrieval muscle, zero new
backend.
**Verified:** 2026-07-08T23:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves, deduplicated)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Asking about a known entity by name or id returns top-5 grounded results via `lookup_entity`, backed by the existing `find_candidates()` — no new repository methods | VERIFIED | `app/infrastructure/tools/lookup_entity_executor.py` read in full: `_TOP_N = 5`; `_lookup_by_id`/`_search_by_name` call `self._resolution_repo.find_candidates(...)` (the pre-existing sync port method, imported only via `TYPE_CHECKING`) and `self._entity_instances.find_by_id(...)`; grep for `.rpc(\|CREATE \|ALTER ` in `app/infrastructure/tools/*.py` → zero matches |
| 2 | Asking to find related emails returns top-5 results via `search_emails`, backed by the existing `find_similar_confirmed()` (BlendedRAG RRF) — no new repository methods | VERIFIED | `app/infrastructure/tools/search_emails_executor.py` read in full: `_TOP_N_EMAILS = 5`; `_gather_candidates` calls `self._retrieval.find_similar_confirmed(...)` (pre-existing port); same zero-`.rpc(`/`CREATE`/`ALTER` grep result |
| 3 | `search_emails` results never carry raw email body — only safe metadata/structured fields | VERIFIED (see note) | `EmailSearchResult` dataclass has fields `email_id, subject, sender_name, sender_address, received_at, extracted_fields, score` — structurally no raw-text field; `grep -n "content_text\|body_html\|body_text\|raw_storage_key" search_emails_executor.py` → 0 matches; `test_tier2_never_surfaces_raw_source_text` plants a unique marker string in both `Component.content_text` and `Email.body_text`/`body_html` and asserts the marker is absent from `result.content` — ran in isolation, passed. **Note:** ROADMAP's literal wording ("the existing quarantine adapter's sanitized output, safe enum + `intent_summary`") does not correspond to any actual email-domain quarantine adapter in this codebase — the only `GenuiQuarantineAdapter` in the repo is Call A of the unrelated genui UI-spec dual-LLM pipeline. 36-CONTEXT.md's own decisions section pre-authorizes this exact substitution ("if no LLM-derived summary exists, return metadata + component-level extracted values only"), and the underlying security intent (never raw body) is independently proven above — treated as satisfied, not a gap |
| 4 | Both tools' results carry `citations[]` of `{kind, id, route}` resolving to real `/emails/[id]`/`/entities/[id]` routes | VERIFIED | `envelope.py`'s `_ROUTE_TEMPLATES = {"entity": "/entities/{id}", "email": "/emails/{id}"}`; both executors build citations exclusively via `build_citation(...)`; `test_citations_shape_matches_results` in both test files asserts route equality, not just presence — both pass |
| 5 | `ToolExecutor` port carries the caller's `importer_id` into every executor call | VERIFIED | `app/domain/ports/tool_executor.py`: `execute(self, *, name, arguments, importer_id: str) -> ToolExecutionResult` (required, no default); `run_chat_turn.py` threads `importer_id=importer_id` from `_advance_round` → `_run_server_tool_round` → `executor.execute(...)` (3 call sites grepped and read) |
| 6 | A `lookup_entity` call for unknown/empty name, cross-tenant id, or repo failure returns a friendly `is_error` result — never raises past the executor boundary | VERIFIED | `execute()`'s single `try/except Exception` wraps both `_lookup_by_id`/`_search_by_name`; cross-tenant id (`instance.importer_id != importer_id`) falls through to name-search (never surfaces a tenant-mismatch error); `test_cross_tenant_id_falls_back_to_name_search_without_leaking`, `test_empty_name_or_id_returns_error_without_repo_calls`, `test_repository_exception_returns_error_never_raises` all present and passing |
| 7 | `search_emails` applies the same tenant defense-in-depth + never-raises contract | VERIFIED | `_resolve_to_email_result` skips any component/email whose own `.importer_id != importer_id`; `execute()`'s try/except returns `is_error=True` on any collaborator exception; `test_tenant_defense_in_depth_skips_cross_tenant_component_and_email` and `test_collaborator_exception_returns_error_never_raises` present and passing |
| 8 | `container.py` wires both real executors into `RunChatTurn.tool_executors` — production mapping no longer empty | VERIFIED | `_provide_run_chat_turn` (container.py:630-701) instantiates `LookupEntityExecutor`/`SearchEmailsExecutor` and passes `tool_executors={LOOKUP_ENTITY_TOOL_NAME: ..., SEARCH_EMAILS_TOOL_NAME: ...}`; `test_container_wires_both_real_tool_executors` resolves the REAL dishka container (`create_container()`, only external Supabase/Anthropic/boto3 clients patched) and asserts `run_chat_turn._tool_executors` has exactly `{lookup_entity, search_emails}` with correct concrete types — ran in isolation, passed |
| 9 | The model is advertised real per-tool JSON schemas for `lookup_entity`/`search_emails` — not the Phase-34 placeholder empty-properties stub | VERIFIED | `_build_tool_offer` does `self._server_tool_defs.get(tool_name, <generic stub>)`; container.py passes `server_tool_defs={LOOKUP_ENTITY_TOOL_NAME: build_lookup_entity_tool(), SEARCH_EMAILS_TOOL_NAME: build_search_emails_tool()}`; `test_build_tool_offer_advertises_real_lookup_entity_and_search_emails_schemas` asserts `"properties"` exists and `name_or_id`/`query` are declared — ran in isolation, passed |
| 10 | Zero new SQL, migrations, or RPCs anywhere in this phase's new files | VERIFIED | `grep -rn "CREATE \|ALTER \|\.rpc(" apps/email-listener/app/infrastructure/tools/` → zero matches (independently re-run, not just trusting SUMMARY) |
| 11 | Scope confinement — phase 36 commits touch only `apps/email-listener/**` and `.planning/**` | VERIFIED | `git diff 94f7d6d..0840045 --stat` → 25 files changed, all under `apps/email-listener/` or `.planning/`; none of `apps/web`, `packages/*`, `infrastructure/aws/ecs.tf`, `.claude/skills/nauta-design-system/SKILL.md`, `.planning/HANDOFF.json` appear |
| 12 | Prior suites stay green — no regression introduced by the `importer_id` port extension or the container wiring | VERIFIED | Independently ran the full 1106-test suite once: 1087 passed, 9 skipped (missing credentials), 10 failed — all 10 failures in `tests/test_genui_retrieval_provider.py::TestLexicalRetrievalProviderBehavior` (Python 3.13 `asyncio.get_event_loop()` removal, `RuntimeError: There is no current event loop in thread 'MainThread'`); `git diff 94f7d6d..0840045 -- tests/test_genui_retrieval_provider.py` → empty (file byte-identical, untouched by this phase). Targeted 9-file regression sweep independently run: 83 passed, 0 failed (matches SUMMARY claim exactly) |
| 13 | `lint-imports` "3 kept, 0 broken"; `mypy` clean on the 6 touched/created source files | VERIFIED | Independently ran both: `lint-imports` → "Contracts: 3 kept, 0 broken."; `mypy` on the 6 files → 12 pre-existing errors, all in 4 OTHER files (`genui_generator_adapter.py`, `genui_code_generator_adapter.py`, `supabase_ui_spec_template_repository.py`, `supabase_chat_widget_interaction_repository.py`) transitively imported by `container.py`, zero errors in the 6 target files themselves; `git diff 94f7d6d..0840045 --stat` on those 4 files → empty (confirmed pre-existing/untouched) |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/domain/ports/tool_executor.py` | `ToolExecutor.execute(*, name, arguments, importer_id)` Protocol + `ToolExecutionResult` | VERIFIED | Read in full; required `importer_id: str` kwarg present, docstring states the enforcement obligation |
| `app/infrastructure/tools/envelope.py` | `ToolCitation`, `build_citation`, `citation_to_dict`, `truncate_field`, `MAX_RESULT_FIELD_CHARS` | VERIFIED | Read in full; all 5 exports present in `__all__`, `MAX_RESULT_FIELD_CHARS = 300` |
| `app/infrastructure/tools/lookup_entity_executor.py` | `LOOKUP_ENTITY_TOOL_NAME`, `build_lookup_entity_tool()`, `LookupEntityExecutor`, `EntityLookupResult` | VERIFIED | Read in full; all 4 exports present, 246 lines, thin wrapper over `find_candidates`/`find_by_id`/`list_active` only |
| `app/infrastructure/tools/search_emails_executor.py` | `SEARCH_EMAILS_TOOL_NAME`, `build_search_emails_tool()`, `SearchEmailsExecutor`, `EmailSearchResult` | VERIFIED | Read in full; all 4 exports present, 236 lines, thin wrapper over `find_similar_confirmed`/`find_by_id`/`list_active` only |
| `app/container.py` | `_provide_run_chat_turn` wires `tool_executors={lookup_entity, search_emails}` + `server_tool_defs={...}` | VERIFIED | Lines 630-701 read directly; both dicts populated with real executor instances and real schema builders |
| `tests/infrastructure/tools/test_lookup_entity_executor.py` | 7 named behavior tests | VERIFIED | All 7 present (`test_id_hit_...`, `test_id_miss_...`, `test_cross_tenant_...`, `test_empty_name_or_id_...`, `test_repository_exception_...`, `test_citations_shape_...`, `test_content_is_capped_json`) |
| `tests/infrastructure/tools/test_search_emails_executor.py` | 7+ named behavior tests | VERIFIED | 8 present, including `test_tier2_never_surfaces_raw_source_text` (marker-string proof) |
| `tests/application/test_run_chat_turn_real_tools_wiring.py` | 3 integration/regression-guard tests | VERIFIED | All 3 present, one resolving the REAL dishka container |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `run_chat_turn.py:_run_server_tool_round` | `ToolExecutor.execute(..., importer_id=importer_id)` | keyword argument | WIRED | Grepped `importer_id=importer_id` — 5+ call sites including the executor call and the round-loop call |
| `lookup_entity_executor.py` | `entity_resolution_repository.py:find_candidates` | direct call | WIRED | `self._resolution_repo.find_candidates(...)` called synchronously (no `await`), matching the port's actual sync signature |
| `search_emails_executor.py` | `retrieval_port.py:find_similar_confirmed` | direct call | WIRED | `await self._retrieval.find_similar_confirmed(...)` inside `_gather_candidates`'s per-entity-type loop |
| `container.py:_provide_run_chat_turn` | `RunChatTurn(tool_executors=..., server_tool_defs=...)` | constructed executor instances + schema dicts | WIRED | Confirmed via real-container resolution test (`test_container_wires_both_real_tool_executors`), independently re-run and passing |
| `run_chat_turn.py:_build_tool_offer` | `self._server_tool_defs` | dict lookup with stub fallback | WIRED | `self._server_tool_defs.get(tool_name, <generic stub>)`; confirmed via `test_build_tool_offer_advertises_real_lookup_entity_and_search_emails_schemas`, independently re-run and passing |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `LookupEntityExecutor.execute` | `results` (envelope `results[]`) | `find_candidates()`/`find_by_id()` (real, pre-existing repository ports; SUPABASE-backed in production via `container.py`'s `resolution_repo = SupabaseEntityResolutionRepository(client=client)`) | Yes | FLOWING — `test_lookup_entity_round_trip_produces_grounded_citations` drives one full `run_chat_turn.run(...)` through a REAL `LookupEntityExecutor` and asserts the persisted `tool_invocation_result` part contains real citation data, not a static/empty envelope |
| `SearchEmailsExecutor.execute` | `results` (envelope `results[]`) | `find_similar_confirmed()` (real, pre-existing `RetrievalPort`, BlendedRAG RRF) | Yes | FLOWING (unit-level) — no full round-trip integration test exists for `search_emails` specifically (Plan 36-02 Task 3 explicitly scoped the round-trip proof to `lookup_entity` only, citing budget; `search_emails` has thorough direct-unit coverage instead) — proven at the executor-unit level via `test_happy_path_merges_dedupes_ranks_and_caps_at_five_emails`, not via a live chat-turn round trip |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Zero new backend (no `.rpc(`/`CREATE`/`ALTER` in new tool files) | `grep -n "\.rpc(\|CREATE \|ALTER " app/infrastructure/tools/*.py` | 0 matches | PASS |
| `search_emails` never touches raw body fields | `grep -n "content_text\|body_html\|body_text\|raw_storage_key" search_emails_executor.py` | 0 matches | PASS |
| Tier-2 marker-string leak test | `pytest tests/infrastructure/tools/test_search_emails_executor.py -k tier2` | 1 passed | PASS |
| Targeted 9-file regression sweep | `pytest tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py tests/infrastructure/tools/ tests/application/test_run_chat_turn_real_tools_wiring.py tests/test_container.py tests/evals/test_retrieval_golden_set.py -q --no-cov` | 83 passed, 0 failed | PASS |
| Full workspace suite (run once) | `pytest --no-cov -p no:warnings` (dot-count parsed) | 1087 passed, 10 failed (pre-existing, untouched file), 9 skipped, 1106 total | PASS |
| `lint-imports` | `uv run lint-imports` | "Contracts: 3 kept, 0 broken." | PASS |
| `mypy` on the 6 touched/created files | `uv run mypy app/domain/ports/tool_executor.py app/infrastructure/tools/envelope.py app/infrastructure/tools/lookup_entity_executor.py app/infrastructure/tools/search_emails_executor.py app/application/use_cases/run_chat_turn.py app/container.py` | 12 pre-existing errors in 4 OTHER (untouched) files, 0 in the 6 target files | PASS |
| Scope confinement diff | `git diff 94f7d6d..0840045 --stat` | 25 files, all under `apps/email-listener/**` or `.planning/**` | PASS |

### Probe Execution

Not applicable — this phase is not a migration/tooling phase and declares no `scripts/*/tests/probe-*.sh` fixtures. SKIPPED (no probes declared or discovered).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| TOOL-01 | 36-01 | User can ask about a known entity and get grounded results via `lookup_entity` — thin wrapper over `find_candidates()`, top-5, zero new backend | SATISFIED | `LookupEntityExecutor` implemented, unit-tested (7/7 behaviors), wired into production `container.py`, `REQUIREMENTS.md` marks `[x]` / "Complete" |
| TOOL-02 | 36-02 | User can ask to find related emails via `search_emails` — thin wrapper over `find_similar_confirmed()`, top-5, zero new backend, never raw email body | SATISFIED | `SearchEmailsExecutor` implemented, unit-tested (8 tests incl. Tier-2 marker-string proof), wired into production `container.py`, `REQUIREMENTS.md` marks `[x]` / "Complete" |

No orphaned requirements — `grep -n "Phase 36" .planning/REQUIREMENTS.md` returns only TOOL-01/TOOL-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/application/use_cases/run_chat_turn.py` | 243 | Stale comment: "empty in production until Phase 36 (container.py wires {} today)" — left over from Phase 34/35, no longer accurate now that Phase 36 wires real executors | INFO | Cosmetic only; does not affect behavior, not flagged as a must-have artifact by either plan's task list; `container.py`'s own comment (the one both plans explicitly required to be updated) was correctly updated |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers, no placeholder/"coming soon" language, and no empty-return stubs found in any of the 6 touched/created source files.

### Human Verification Required

None. This phase is backend-only (Python tool executors + DI wiring); no UI surface was added or changed (Phase 39 explicitly owns the tool-round UI surface, out of scope here per 36-CONTEXT.md). All observable truths are independently verifiable via grep, static typing, and automated test execution, all of which were re-run directly (not taken from SUMMARY.md claims) during this verification.

### Gaps Summary

No gaps found. All 6 hard constraints from the human operator were independently re-verified against the live codebase (not just SUMMARY.md text):

1. **Zero new backend** — confirmed via direct grep, zero `.rpc(`/`CREATE`/`ALTER` matches in `app/infrastructure/tools/*.py`.
2. **`search_emails` never returns raw body** — confirmed via direct grep (0 matches) AND a substantive marker-string unit test that plants a unique string in `content_text`/`body_text`/`body_html` and asserts its absence from the tool's output — re-run directly, passed.
3. **Scope confinement** — confirmed via `git diff 94f7d6d..0840045 --stat`: only `apps/email-listener/**` and `.planning/**` touched; none of the excluded paths (`apps/web`, `packages/*`, `infrastructure/aws/ecs.tf`, the design-system SKILL.md, `.planning/HANDOFF.json`) appear in the diff.
4. **Prior suites still green** — independently ran the FULL 1106-test workspace suite once (not trusted from SUMMARY): 1087 passed, 9 skipped, 10 failed — all 10 failures isolated to `tests/test_genui_retrieval_provider.py` (confirmed byte-identical/untouched by this phase's diff, and the failure mode — `asyncio.get_event_loop()` raising under Python 3.13 with no running loop — is a pre-existing environment/API-removal issue unrelated to any Phase 36 change). Numbers match the SUMMARY's claim exactly.
5. **`lint-imports`** — independently re-run: "3 kept, 0 broken."
6. **`mypy` clean on the 6 touched files** — independently re-run: 0 errors in the 6 target files; 12 pre-existing errors confined to 4 other files not touched by this phase's diff.

One wording note (not a gap): ROADMAP Success Criterion #3 references "the existing quarantine adapter's sanitized output (safe enum + `intent_summary`)" — no such email-specific quarantine adapter exists in this codebase (the only `GenuiQuarantineAdapter` present is for the unrelated genui UI-spec generation pipeline). 36-CONTEXT.md's own decisions section pre-authorized substituting metadata + confirmed `extracted_fields` when no LLM-derived summary exists for emails, which is exactly what was implemented. The underlying security guarantee (never raw email body) is fully and independently proven. Treated as satisfied.

One minor cosmetic note (INFO, not a gap): a stale explanatory comment in `run_chat_turn.py` (line 243, near the `_tool_executors` assignment) still says tool executors are "empty in production until Phase 36" — this predates Phase 36's actual wiring and was not on either plan's required-edit list (only the `container.py` comment was required to be updated, and it correctly was). Does not affect behavior.

---

_Verified: 2026-07-08T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
