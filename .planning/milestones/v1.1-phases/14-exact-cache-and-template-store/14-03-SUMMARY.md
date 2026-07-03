---
phase: 14
plan: "03"
subsystem: email-listener
tags: [cache, repository, di-wiring, use-case, fastapi]
dependency_graph:
  requires: [14-01, 14-02, 13-03]
  provides: [ui-spec-template-repository-port, supabase-ui-spec-template-adapter, cache-integrated-generate-ui-spec-use-case, cache_hit-response-field]
  affects: [generate_ui_spec.py, container.py, genui.py]
tech_stack:
  added: []
  patterns: [port-adapter, best-effort-contract, dishka-di, asyncio-to-thread, frozen-dataclass]
key_files:
  created:
    - apps/email-listener/app/domain/ports/ui_spec_template_repository.py
    - apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py
    - apps/email-listener/tests/test_supabase_ui_spec_template_repository.py
  modified:
    - apps/email-listener/app/application/use_cases/generate_ui_spec.py
    - apps/email-listener/tests/application/test_generate_ui_spec.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/presentation/api/v1/genui.py
decisions:
  - "D-02: cache CHECK is step 0 of execute() — strictly before quarantine, generator, and audit"
  - "D-11: persist only when outcome != 'fallback' — never cache SAFE_FALLBACK_SPEC"
  - "D-12: upsert with ON CONFLICT (cache_key) — concurrent-miss safe"
  - "D-15: find_by_cache_key filters by BOTH cache_key AND validation_status='validated'"
  - "D-17: best-effort contract — all three methods swallow+log exceptions, never raise"
  - "D-03: cache hit logs genui_cache_hit with cache_key[:8] prefix only, never raw intent"
  - "D-08: importer_id + catalog_id in context_descriptor for cross-tenant isolation"
  - "D-19: DI wiring mirrors 13-03 — _provide_ui_spec_template_repository factory + register"
  - "increment_use_count uses direct .update() (not RPC) — use_count is a soft metric"
  - "UiSpecTemplateRepository satisfies Protocol structurally (no explicit inheritance) — matches audit repo convention"
metrics:
  duration: "~45 minutes (across two sessions)"
  completed_date: "2026-06-27"
  tasks: 3
  files_created: 3
  files_modified: 4
---

# Phase 14 Plan 03: Exact-Match Cache Integration — Summary

Integrated a Tier-1 exact-match UI spec cache into the `GenerateUiSpecUseCase` pipeline using the port/adapter pattern from 13-02. The cache key (computed in 14-02) is now checked FIRST in every `execute()` call — a hit short-circuits quarantine, generator, and audit (zero-Bedrock-on-hit).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | UiSpecTemplateRepository port + DTOs + Supabase adapter | `6ed05f4` | `ui_spec_template_repository.py` (port), `supabase_ui_spec_template_repository.py`, `test_supabase_ui_spec_template_repository.py` |
| 2 | Integrate cache CHECK + PERSIST into GenerateUiSpecUseCase | `6a40117` | `generate_ui_spec.py`, `test_generate_ui_spec.py` |
| 3 | DI wiring + cache_hit on GenerateUiSpecView | `1107771` | `container.py`, `genui.py` |

## What Was Built

**Port layer (`ui_spec_template_repository.py`):** Two frozen dataclasses — `CachedTemplate(id, spec_json)` and `TemplateToPersist(cache_key, intent_text, data_shape_hash, registry_version, catalog_id, spec_json, ...)` — plus a `UiSpecTemplateRepository` Protocol with three async methods. Zero infrastructure imports (lint-imports contract enforced).

**Adapter (`supabase_ui_spec_template_repository.py`):** `SupabaseUiSpecTemplateRepository` satisfies the Protocol structurally. All three methods use `asyncio.to_thread()` (WR-06 — supabase-py is synchronous). Best-effort contract (D-17) applied uniformly: `find_by_cache_key` returns `None` on any exception; `persist` and `increment_use_count` swallow+log. `persist` uses `upsert(on_conflict="cache_key")` for concurrent-miss safety (D-12). `increment_use_count` uses direct `.update()` (not RPC — use_count is a soft tracking metric).

**Use case (`generate_ui_spec.py`):** Full rewrite to add:
- Step 0 (D-02): `compute_cache_key(...)` → `find_by_cache_key()` before any LLM call. HIT returns `GenerateUiSpecResult(spec=cached.spec_json, cache_hit=True)` immediately.
- `catalog_id: str = "global"` parameter added to `execute()` (D-08 cross-tenant isolation).
- Post-generation: `persist(TemplateToPersist(...))` if `outcome != "fallback"` (D-11 gate, best-effort).
- `GenerateUiSpecResult` extended with `cache_hit: bool = False` field.
- `templates: UiSpecTemplateRepository` added to constructor.

**DI wiring (`container.py`):**
- New import: `UiSpecTemplateRepository`, `SupabaseUiSpecTemplateRepository`.
- New factory: `_provide_ui_spec_template_repository(client: Client) -> UiSpecTemplateRepository`.
- Registered in `_build_provider()` with `provides=UiSpecTemplateRepository`.
- `_provide_generate_ui_spec_use_case` updated with `templates: UiSpecTemplateRepository` param.

**Endpoint (`genui.py`):**
- `GenerateUiSpecView` extended with `cache_hit: bool = False`.
- Endpoint passes `cache_hit=result.cache_hit` through to response.

## Test Coverage

- **Task 1 (adapter):** 11 unit tests — `find_by_cache_key` miss/hit/filters/exception, `persist` upsert/exception, `increment_use_count` update/exception, `_to_row` mapping, row ID type coercion.
- **Task 2 (use case):** 6 new cache tests added to the 13 existing test suite (19 total) — cache hit skips quarantine/generator/audit (D-02/D-03), cache hit increments use_count, cache miss runs full pipeline, persist called on valid spec (D-11), persist NOT called on fallback (D-11), persist error swallowed (D-17).
- **Task 3 regression:** Full suite — 624 passed, 8 skipped (credential-gated integrations). Zero new failures.

## Deviations from Plan

### Auto-fixed Issues

None. The plan was executed as written with one pre-session deviation (already resolved before this session):

During Task 1 RED→GREEN, the initial `increment_use_count` design used an RPC call (`self._client.rpc(...)`) as primary with `.update()` as fallback. The MagicMock used in tests doesn't raise on RPC calls, so `.update()` was never reached and the test `test_increment_use_count_calls_update` failed. Fixed by simplifying to always use `.update()` directly — consistent with D-17 (use_count is a soft metric, DB-side atomicity not required).

### Pre-existing Ruff Warning (Out of Scope)

`RUF001` in `app/infrastructure/llm/genui_generator_adapter.py` line 188: EN DASH character in a docstring. Pre-existing, not introduced by this plan, not fixable by `ruff check --fix`. Deferred per scope-boundary rule (pre-existing, unrelated file).

## Known Stubs

None. `cache_hit` is wired end-to-end: use case sets it, result carries it, endpoint exposes it in the response envelope.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced by this plan. The cache lookup path enforces D-08 cross-tenant isolation (importer_id + catalog_id in cache key context_descriptor) and D-03 (only 8-char prefix of cache_key logged, never raw intent).

## Self-Check: PASSED

Files exist:
- `apps/email-listener/app/domain/ports/ui_spec_template_repository.py` — FOUND
- `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py` — FOUND
- `apps/email-listener/tests/test_supabase_ui_spec_template_repository.py` — FOUND
- `apps/email-listener/app/application/use_cases/generate_ui_spec.py` (modified) — FOUND
- `apps/email-listener/app/container.py` (modified) — FOUND
- `apps/email-listener/app/presentation/api/v1/genui.py` (modified) — FOUND

Commits exist:
- `6ed05f4` — FOUND (feat(14-03): UiSpecTemplateRepository port + DTOs + Supabase adapter)
- `6a40117` — FOUND (feat(14-03): integrate exact-match cache into GenerateUiSpecUseCase)
- `1107771` — FOUND (feat(14-03): DI wiring + cache_hit on GenerateUiSpecView)

Test suite: 624 passed, 8 skipped, 0 failures.
Ruff: clean on all modified files (pre-existing RUF001 in genui_generator_adapter.py excluded).
