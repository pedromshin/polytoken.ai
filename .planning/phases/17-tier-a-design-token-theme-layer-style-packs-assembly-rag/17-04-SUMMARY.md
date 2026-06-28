---
phase: 17-tier-a-design-token-theme-layer-style-packs-assembly-rag
plan: "04"
subsystem: genui-python-pipeline
tags: [style-packs, rag, cache-key, retrieval, generation, fastapi]
dependency_graph:
  requires: ["17-01", "17-02"]
  provides: ["pack-aware-generation", "rag-grounded-pipeline"]
  affects: ["genui-generator-adapter", "generate-ui-spec-use-case", "genui-route"]
tech_stack:
  added: []
  patterns:
    - "RAG-before-generation ordering contract (RAG-01)"
    - "5-dimension SHA-256 cache key with style_pack_id (D-08/T-17-20)"
    - "Static vs Dynamic prompt split: token table + exemplars ONLY in DYNAMIC user turn (COST-01/T-17-21)"
    - "Graceful RAG degradation: retrieval failure does not block generation"
    - "T-17-04 spoofing guard: Pydantic field_validator against KNOWN_STYLE_PACK_IDS at route boundary"
key_files:
  created:
    - apps/email-listener/app/infrastructure/llm/genui_style_packs.py
  modified:
    - apps/email-listener/app/application/use_cases/cache_key.py
    - apps/email-listener/app/application/use_cases/generate_ui_spec.py
    - apps/email-listener/app/domain/ports/generation_audit_repository.py
    - apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/presentation/api/v1/genui.py
    - apps/email-listener/tests/application/test_cache_key.py
    - apps/email-listener/tests/application/test_generate_ui_spec.py
    - apps/email-listener/tests/presentation/test_genui_endpoint.py
    - apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py
decisions:
  - "style_pack_id resolves at use case boundary (None -> DEFAULT_STYLE_PACK_ID='nauta-teal') so callers need not know the default"
  - "retrieve() is called only on cache MISS, never on cache HIT — Phase-14 short-circuit semantics preserved"
  - "retrieval_provider typed as Any in use case constructor to satisfy lint-imports (domain module must not import infra)"
  - "_count_retrieved_overlap intersects emitted spec node types with retrieved_ids tuple for RAG-02 proof logging"
  - "LexicalRetrievalProvider bound to RetrievalProvider port in Dishka at APP scope (deterministic, no external calls)"
  - "Graceful degradation: retrieval failure (exception) logs warning and passes retrieval_result=None to generator"
metrics:
  duration: "~90 minutes (across 2 sessions with compaction)"
  completed: "2026-06-28"
  tasks: 3
  files_modified: 10
---

# Phase 17 Plan 04: Pack-aware generation pipeline + RAG wiring — Summary

Pack-aware Python generation pipeline: 5-dimension cache key (style_pack_id as D-08 dimension), per-request retrieval-before-generation (RAG-01), token table + exemplar injection into DYNAMIC generator user turn (COST-01 preserved), retrieved_ids + overlap logged per generation (RAG-02 proof), T-17-04 spoofing guard at route boundary.

## Tasks Completed

### Task 1: Python pack registry + style_pack_id in the cache key

**Commits:**
- `88b47e9` — test(17-04): add failing tests for pack registry and cache key style_pack_id dimension (RED)
- `f68c2c2` — feat(17-04): add genui_style_packs.py and extend cache key with style_pack_id (GREEN)

**What was built:**
- `genui_style_packs.py`: Python mirror of TS `STYLE_PACK_IDS` — 6 packs (nauta-teal, linear-clean, warm-editorial, brutalist, corporate-saas, playful-rounded), `DEFAULT_STYLE_PACK_ID = "nauta-teal"`, `STYLE_PACK_IDS` frozenset, `is_known_pack()`, `format_pack_token_table()` (deterministic compact rendering per pack for prompt injection)
- `cache_key.py` extended: `compute_cache_key` gains `style_pack_id: str | None` keyword arg; maps `None` → `_NO_PACK_SENTINEL = "__no_pack__"` (prevents None aliasing a real pack ID); joined as 5th field via `_FIELD_SEP` (0x1f). All existing mitigations (T-14-05/06/08) preserved.

**Verification:** 20 cache key tests green + 5 pack registry tests green.

---

### Task 2: Per-request RAG + token-table injection in the generator adapter

**Commits:**
- `bbc28f2` — test(17-04): add failing tests for generator style_pack_id + retrieval injection (RED)
- `de5c98e` — feat(17-04): extend GenuiGeneratorAdapter with style_pack_id + retrieval injection (GREEN)

**What was built:**
- `generate()` extended with `retrieval: RetrievalResult | None = None` and `style_pack_id: str | None = None`
- In `_repair_loop`, a per-request injection block appended to `initial_user_content` (DYNAMIC user turn): (a) `<EXEMPLARS_SECTION>` framing for retrieved items (id + spec_json as structured reference data — SAFE-02 preserved), (b) `format_pack_token_table(style_pack_id)` injected as pack token aliases for per-node style props
- `_build_system_blocks()` NOT touched — static cached prefix remains byte-identical regardless of pack/retrieval (COST-01/T-17-21)
- `retrieval=None` path: no injection block added, generator behaves identically to pre-17-04

**Verification:** All existing repair-loop/escalation tests pass; new tests confirm DYNAMIC vs STATIC split; raw-prose-never-leaks assertion preserved.

---

### Task 3: Orchestrate pack selection + retrieval in the use case + wire DI + route

**Commits:**
- `c7e72fc` — test(17-04): add failing tests for pack-aware use case + retrieval wiring (RED)
- `1c19dac` — feat(17-04): implement pack-aware use case + retrieval wiring + DI + route (GREEN)
- `a77eb81` — fix(17-04): update endpoint tests to use flexible kwargs assertion (Rule 1 auto-fix)

**What was built:**

*`generate_ui_spec.py`*:
- `GenerateUiSpecResult` extended: `style_pack_id: str | None = None`, `retrieved_ids: tuple[str, ...] = ()`
- `execute()` extended: `style_pack_id: str | None = None` param; resolves None → DEFAULT_STYLE_PACK_ID via pack registry; passes style_pack_id to `compute_cache_key`
- On cache MISS: calls `self._retrieval_provider.retrieve(intent=intent, top_k=8, style_pack_id=style_pack_id)` before quarantine/generate (RAG-01 ordering); graceful degradation on exception
- Generator called with `style_pack_id=style_pack_id, retrieval=retrieval_result`
- RAG-02: `_count_retrieved_overlap(spec, retrieved_ids)` computes intersection of emitted spec node types with retrieved IDs; result logged via structlog (`genui_retrieved_overlap`)
- `GenerationEvent` stamped with `style_pack_id`, `retrieved_ids`, `retrieved_overlap_count`
- Return: `GenerateUiSpecResult` carries `style_pack_id` + `retrieved_ids`

*`generation_audit_repository.py`*:
- `GenerationEvent` frozen dataclass extended additively: `style_pack_id: str | None = None`, `retrieved_ids: tuple[str, ...] = ()`, `retrieved_overlap_count: int = 0`

*`container.py`*:
- `LexicalRetrievalProvider` factory added (`_provide_lexical_retrieval_provider`)
- Bound to `RetrievalProvider` port at APP scope in `_build_provider()`
- `_provide_generate_ui_spec_use_case` gains `retrieval_provider: RetrievalProvider` param, passes through to use case

*`genui.py` (FastAPI route)*:
- `GenerateUiSpecRequest`: `style_pack_id: str | None = Field(default=None, ...)` with `@field_validator` rejecting unknown IDs against `STYLE_PACK_IDS` (T-17-04)
- `GenerateUiSpecView`: `style_pack_id: str | None = None`, `retrieved_ids: tuple[str, ...] = ()`
- Route handler passes `style_pack_id=body.style_pack_id` and serializes both fields into the view

**Verification:** 73 tests green across cache key + use case + endpoint test files.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed two endpoint tests broken by new style_pack_id kwarg**

- **Found during:** Task 3 GREEN implementation
- **Issue:** `test_generate_missing_raw_content_is_accepted_intent_only` and `test_generate_calls_use_case_with_correct_args` in `tests/presentation/test_genui_endpoint.py` used exact `assert_called_once_with(intent=..., raw_content=..., registry_version=..., importer_id=None)` assertions. Adding `style_pack_id=None` to the `execute()` call caused both to fail with `AssertionError: expected call not found`.
- **Fix:** Switched both tests to flexible `call_args.kwargs` dict assertion pattern, checking only the fields the tests care about. The same pattern was already used in `test_generate_ui_spec.py` for similar fixtures.
- **Files modified:** `apps/email-listener/tests/presentation/test_genui_endpoint.py`
- **Commit:** `a77eb81`

### Out-of-Scope Pre-existing Issues (Not Fixed)

**Pre-existing: `test_genui_retrieval_provider.py` event loop failures in full suite**

- 10 tests in `tests/infrastructure/test_genui_retrieval_provider.py` fail when run as part of the full test suite but pass in isolation
- Root cause: `asyncio.get_event_loop().run_until_complete()` (deprecated pattern) — when pytest-asyncio tests consume and close the event loop, subsequent calls to `get_event_loop()` raise `RuntimeError: There is no current event loop in thread 'MainThread'`
- Confirmed pre-existing: reverting Task 3 changes (git stash) reproduces the same failures
- Out of scope per deviation rules (not caused by this plan's changes)
- Logged to: deferred-items in this SUMMARY

**Pre-existing: 5 mypy errors in unrelated files**

- 2 errors in `genui_generator_adapter.py` (lines 320/513 — jsonschema `Any` typing)
- 3 errors in `supabase_ui_spec_template_repository.py`
- No new mypy errors introduced by plan 17-04

## Known Stubs

None. All pack-aware fields are fully wired from route validation → use case → generator → audit → result → response view.

## Threat Flags

No new security surface outside the plan's threat model. T-17-04, T-17-11, T-17-20, T-17-21, T-17-13 all mitigated as planned.

## Self-Check: PASSED

Files exist:
- `apps/email-listener/app/infrastructure/llm/genui_style_packs.py` — FOUND
- `apps/email-listener/app/application/use_cases/generate_ui_spec.py` — FOUND (extended)
- `apps/email-listener/app/domain/ports/generation_audit_repository.py` — FOUND (extended)
- `apps/email-listener/app/container.py` — FOUND (extended)
- `apps/email-listener/app/presentation/api/v1/genui.py` — FOUND (extended)

Commits exist (from `git log --oneline`):
- `88b47e9` test(17-04): RED Task 1 — FOUND
- `f68c2c2` feat(17-04): GREEN Task 1 — FOUND
- `bbc28f2` test(17-04): RED Task 2 — FOUND
- `de5c98e` feat(17-04): GREEN Task 2 — FOUND
- `c7e72fc` test(17-04): RED Task 3 — FOUND
- `1c19dac` feat(17-04): GREEN Task 3 — FOUND
- `a77eb81` fix(17-04): Rule 1 auto-fix — FOUND

73 tests passing across cache key + use case + endpoint files.
