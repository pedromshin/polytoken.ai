---
phase: 14-exact-cache-and-template-store
verified: 2026-06-27T08:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 14: Exact Cache and Template Store — Verification Report

**Phase Goal:** Every generated spec is persisted to a Drizzle/Postgres template store, and repeat intents with identical context hit a SHA-256 exact-match cache that returns a re-bound spec with no Bedrock call — and a registry version bump automatically invalidates affected cache entries.
**Verified:** 2026-06-27T08:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A validated generated spec is persisted to `ui_spec_templates` (intent, registry_version, validation_status, metadata) immediately after successful generation | VERIFIED | `generate_ui_spec.py` cold path: `TemplateToPersist` built with all required fields, `templates.persist()` called when `outcome != "fallback"`; `ON CONFLICT (cache_key)` upsert in adapter |
| 2 | A second identical intent returns the cached spec with ZERO Bedrock calls — cache check is step 0, before quarantine/generate/audit | VERIFIED | Lines 123-144 of `generate_ui_spec.py`: `compute_cache_key()` → `find_by_cache_key()` precedes ALL downstream calls; hit returns `GenerateUiSpecResult(spec=cached.spec_json, cache_hit=True)` immediately — `quarantine.extract`, `generator.generate`, and `audit.record` are never reached |
| 3 | A registry-version increment auto-invalidates old-version cache keys (stale specs never served without re-generation) | VERIFIED | `compute_cache_key` in `cache_key.py`: `registry_version` is one of 4 fields joined by `_FIELD_SEP` (`\x1f`) before SHA-256 hashing; a different `registry_version` produces a different 64-char hex digest; old rows become permanently unreachable (lazy invalidation, D-13) |

**Score:** 3/3 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0022_right_firedrake.sql` | `ui_spec_templates` DDL with UNIQUE cache_key, CHECK constraint, RLS | VERIFIED | 14-column table, `UNIQUE INDEX idx_ui_spec_templates_cache_key`, `CHECK (validation_status IN ('validated'))`, `ENABLE ROW LEVEL SECURITY`, two RESTRICTIVE deny-all policies for anon + authenticated |
| `packages/db/src/schema/ui-spec-templates.ts` | Drizzle schema with UNIQUE cache_key, indexes | VERIFIED | `UiSpecTemplates` pgTable with all 14 columns, `uniqueIndex("idx_ui_spec_templates_cache_key")`, `index("idx_ui_spec_templates_importer_catalog")`, `index("idx_ui_spec_templates_registry_version")` |
| `apps/email-listener/app/application/use_cases/cache_key.py` | Pure stdlib cache key computation — canonicalize, shape hash, compute key with registry_version | VERIFIED | `canonicalize_intent` (NFC+strip+lower+collapse ws), `compute_data_shape_hash` (value-free recursive shape, `∅` for empty, `"text"` for non-JSON), `compute_cache_key` (4 fields joined by `\x1f`, SHA-256 hex). Zero infra imports. |
| `apps/email-listener/app/domain/ports/ui_spec_template_repository.py` | Port protocol with frozen DTOs — `CachedTemplate`, `TemplateToPersist`, `UiSpecTemplateRepository(Protocol)` | VERIFIED | Frozen dataclasses, Protocol with 3 async methods, no infra imports |
| `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py` | Adapter — validity-filtered find, ON CONFLICT upsert, asyncio.to_thread, best-effort swallow+log | VERIFIED | `find_by_cache_key` filters `.eq("validation_status", "validated")`; `persist` uses `upsert(..., on_conflict="cache_key")`; all 3 methods wrapped in `asyncio.to_thread`; exceptions logged, never re-raised |
| `apps/email-listener/app/application/use_cases/generate_ui_spec.py` | Step-0 cache check before quarantine/generate/audit; validated-only persist; cache_hit on result | VERIFIED | Cache check at lines 123-144 (step 0); cold persist at lines 184-198 (outcome != "fallback" guard); `GenerateUiSpecResult(cache_hit=True)` on hit, `cache_hit=False` on miss |
| `apps/email-listener/app/container.py` | DI wiring — `_provide_ui_spec_template_repository` registered, `templates` arg in use-case factory | VERIFIED | `_provide_ui_spec_template_repository` factory at line 401 returns `SupabaseUiSpecTemplateRepository(client=client)`; registered at line 524 `provider.provide(..., provides=UiSpecTemplateRepository)`; `_provide_generate_ui_spec_use_case` takes `templates: UiSpecTemplateRepository` and passes it to `GenerateUiSpecUseCase` |
| `apps/email-listener/app/presentation/api/v1/genui.py` | `GenerateUiSpecView` has `cache_hit: bool = False`; endpoint passes `result.cache_hit` | VERIFIED | `GenerateUiSpecView(BaseModel)` at line 71 has `cache_hit: bool = False`; endpoint returns `ApiResponse.ok(GenerateUiSpecView(spec=result.spec, cache_hit=result.cache_hit))` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `generate_ui_spec.py` | `cache_key.py` | `compute_cache_key`, `canonicalize_intent`, `compute_data_shape_hash` imports | WIRED | All three functions imported and called at step 0 and at cold persist |
| `generate_ui_spec.py` | `UiSpecTemplateRepository` port | `self._templates.find_by_cache_key`, `persist`, `increment_use_count` | WIRED | Port injected via constructor `templates: UiSpecTemplateRepository`; all 3 methods called |
| `container.py` | `SupabaseUiSpecTemplateRepository` | `_provide_ui_spec_template_repository` → `GenerateUiSpecUseCase` factory | WIRED | Factory registered with `provider.provide(..., provides=UiSpecTemplateRepository)`; use-case factory receives it as `templates` |
| `supabase_ui_spec_template_repository.py` | `ui_spec_templates` table | Supabase client `.table("ui_spec_templates").select/upsert/update` | WIRED | All 3 methods target `_TABLE = "ui_spec_templates"`; `find_by_cache_key` filters by BOTH `cache_key` AND `validation_status='validated'` (D-15) |
| `genui.py` endpoint | `GenerateUiSpecUseCase` | `result.cache_hit` → `GenerateUiSpecView.cache_hit` | WIRED | `cache_hit` flows from `GenerateUiSpecResult` → `GenerateUiSpecView` → API response |

---

### Data-Flow Trace (Level 4)

| Path | Data Variable | Source | Produces Real Data | Status |
|------|---------------|--------|--------------------|--------|
| Cache hit path | `cached.spec_json` | `supabase_ui_spec_template_repository.find_by_cache_key` → `.select("id, spec_json").eq("cache_key", ...).eq("validation_status", "validated").limit(1)` | Yes — Supabase DB row | FLOWING |
| Cache miss / persist path | `gen_result.spec` | `generator.generate(...)` → Bedrock LLM (mocked in tests) | Yes — generated spec | FLOWING |
| `TemplateToPersist` write | all fields | `generate_ui_spec.py` assembles from use-case inputs + `compute_cache_key` | Yes — real fields from caller | FLOWING |

---

### Behavioral Spot-Checks (Test Suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| cache_key.py pure functions | `pytest tests/application/test_cache_key.py --no-cov -q` | Part of 45-test run | PASS |
| generate_ui_spec step-0 cache check (hit returns before quarantine) | `pytest tests/application/test_generate_ui_spec.py --no-cov -q` | Part of 45-test run | PASS |
| Supabase adapter best-effort, ON CONFLICT, validity filter | `pytest tests/test_supabase_ui_spec_template_repository.py --no-cov -q` | Part of 45-test run | PASS |
| Full authorized suite | `uv run pytest tests/application/test_generate_ui_spec.py tests/application/test_cache_key.py tests/test_supabase_ui_spec_template_repository.py --no-cov -q -p no:cacheprovider` | **45 passed, 0 failed, 1 warning in 1.49s** | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CACHE-01 | 14-01, 14-03 | `ui_spec_templates` Drizzle table + migration with UNIQUE cache_key, CHECK, RLS | SATISFIED | Migration `0022_right_firedrake.sql` + Drizzle schema `ui-spec-templates.ts` both present and substantive |
| CACHE-02 | 14-02, 14-03 | Deterministic `compute_cache_key` with canonicalization, value-free shape, registry_version | SATISFIED | `cache_key.py` — all three functions implemented, stdlib-only, registry_version is field #3 in the 4-field key |
| CACHE-03 | 14-03 | Step-0 cache hit returns before quarantine/generate/audit; validated-only persist | SATISFIED | `generate_ui_spec.py` step-0 check verified; `outcome != "fallback"` guard before persist; audit call comes after persist |
| CACHE-04 | 14-02, 14-03 | Registry-version in key ensures version bump = new key = miss = cold regen | SATISFIED | `registry_version` is a positional field in `compute_cache_key`; different version → different SHA-256 digest → guaranteed miss |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase_ui_spec_template_repository.py` | `increment_use_count` | `use_count` column is NOT incremented — only `updated_at` is updated | INFO | `use_count` is a soft v1.2 promotion metric. 14-03 SUMMARY explicitly accepts this as "use_count is a soft metric". Does not affect any success criterion or REQUIREMENTS ID. |

No `TBD`, `FIXME`, or `XXX` markers found in Phase 14 modified files. No stubs. No empty return values on live data paths.

---

### Human Verification Required

None. This is a pure backend phase with no visual UI components. All success criteria are machine-verifiable:

- SC1 (persist): verified via code trace + test suite
- SC2 (zero Bedrock on hit): verified via step-0 code trace; quarantine/generate/audit are dead code on the hit path
- SC3 (registry-version invalidation): verified via key composition in `cache_key.py`

---

### Gaps Summary

No gaps. All 3 ROADMAP success criteria are materially true in the shipped code.

**Explicitly NOT gaps (as instructed):**
- Migration `0022_right_firedrake.sql` applied to local Supabase only — staging/prod deploy is a deploy-time concern
- Bedrock calls mocked offline in tests — offline mocking is the correct test strategy for an LLM dependency
- `use_count` not incremented in `increment_use_count` (only `updated_at` updated) — accepted deviation in 14-03 SUMMARY; does not affect any binding success criterion

---

_Verified: 2026-06-27T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
