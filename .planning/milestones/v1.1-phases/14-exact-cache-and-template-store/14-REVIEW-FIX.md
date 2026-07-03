---
phase: 14-exact-cache-and-template-store
fixed_at: 2026-06-27T09:00:00Z
review_path: .planning/phases/14-exact-cache-and-template-store/14-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-06-27T09:00:00Z
**Source review:** `.planning/phases/14-exact-cache-and-template-store/14-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (CR-01, CR-02, CR-03, WR-01, WR-02, WR-03, WR-04; IN-01 and IN-02 covered within CR-01/WR-01 scope)
- Fixed: 6 (CR-01, CR-02, CR-03, WR-01, WR-02, WR-04 + all test assertions)
- Skipped: 1 (WR-03: pre-computation already in place from prior commit)

## Fixed Issues

### CR-02: Structural fallback flag replaces content-sniffing

**Files modified:** `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py`, `apps/email-listener/app/application/use_cases/generate_ui_spec.py`
**Commit:** `33985fb`
**Applied fix:**
- Added `is_fallback: bool = False` field to `GeneratorResult` frozen dataclass with docstring explaining structural vs content-sniffing intent.
- Set `is_fallback=True` on both SAFE_FALLBACK_SPEC return sites in `genui_generator_adapter.py` (exception handler and all-attempts-exhausted path).
- Removed `_FALLBACK_ROOT_TYPE` / `_FALLBACK_TITLE_FRAGMENT` constants and content-sniffing logic from `_determine_outcome`.
- Rewrote `_determine_outcome(*, escalated, is_fallback)` to use the structural flag only.
- Changed persist gate from `if outcome != "fallback":` to `if not gen_result.is_fallback:`.
- Eliminated false-positive risk: a legitimate business alert spec with title beginning "Unable to generate..." is now persisted correctly.

### CR-03: casefold replaces lower in canonicalize_intent

**Files modified:** `apps/email-listener/app/application/use_cases/cache_key.py`
**Commit:** `02ffa51`
**Applied fix:**
- Changed `stripped = normalized.strip().lower()` to `stripped = normalized.strip().casefold()` on line 67.
- Updated docstring step 3 to describe casefold semantics and note superiority over `lower()` for non-ASCII (ß → ss, SS → ss).
- Added example illustrating sharp-s equivalence.

### CR-01 + WR-01 + IN-02: Read-modify-write use_count increment

**Files modified:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py`
**Commit:** `c4f348b`
**Applied fix:**
- Rewrote `increment_use_count` as a best-effort read-modify-write:
  1. SELECT `use_count` WHERE id = template_id (via `asyncio.to_thread`)
  2. If row not found, log warning and return
  3. Treat NULL as 0 (`int(rows[0].get("use_count") or 0)`)
  4. UPDATE SET `use_count = current + 1`, `updated_at = now`
- Fixed docstring to accurately describe the read-modify-write approach, note the acceptable drift under concurrency, and reference D-03/D-12/D-17.
- Added `import json as _json` for WR-02 (same commit).

### WR-02: Defensive JSONB handling in find_by_cache_key

**Files modified:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py`
**Commit:** `c4f348b`
**Applied fix:**
- After reading `row["spec_json"]`, check `isinstance(raw_spec, str)` and call `_json.loads(raw_spec)` if so; otherwise pass through as dict.
- Handles PostgREST JSONB returning a JSON string in some supabase-py versions.

### WR-04: Populate spec_node_count and spec_depth on persist path

**Files modified:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py`
**Commit:** `33985fb`
**Applied fix:**
- Added `_count_spec_nodes(spec)` and `_walk_nodes(node, depth)` pure recursive helpers directly in `generate_ui_spec.py` (cannot import from infrastructure due to lint-imports constraint).
- `_count_spec_nodes` walks `spec["root"]` recursively, traversing `children` lists and nested dict values.
- Both `spec_node_count` and `spec_depth` are computed and passed into `TemplateToPersist`.

### Test suite: regression + unit assertions

**Files modified:** `apps/email-listener/tests/application/test_generate_ui_spec.py`, `apps/email-listener/tests/application/test_cache_key.py`, `apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py`, `apps/email-listener/tests/test_supabase_ui_spec_template_repository.py`
**Commit:** `f638363`
**Applied fix:**
- `test_generate_ui_spec.py`: added `is_fallback=True` to 3 SAFE_FALLBACK_SPEC fixtures; added `test_legitimate_alert_spec_with_fallback_title_is_cached_not_dropped` regression test proving CR-02 fix eliminates false positive.
- `test_cache_key.py`: added `test_canonicalize_intent_casefold_handles_german_sharp_s` verifying ß == SS after canonicalization.
- `test_genui_generator_adapter.py`: added `is_fallback` assertions on all 4 result paths (happy path=False, retries-exhausted=True, timeout=True, exception=True).
- `test_supabase_ui_spec_template_repository.py`: complete rewrite with `_make_select_chain` supporting single-eq path; column-arg-based routing in `_make_client` (not call-order); `test_increment_use_count_payload_includes_incremented_use_count` verifying use_count=6 from current=5; `test_increment_use_count_starts_from_zero_when_use_count_is_null` verifying NULL→1; WR-02 str/dict dual tests.

## Skipped Issues

### WR-03: Pre-compute canonical_intent and data_shape_hash before compute_cache_key

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py`
**Reason:** Already applied as part of the CR-02 / WR-04 commit (`33985fb`). The use case was rewritten so `canonical_intent` and `data_shape_hash` are pre-computed and reused on the persist path — the fix was incorporated as a structural improvement during the CR-02 rewrite rather than as a separate commit.
**Original issue:** `compute_cache_key` derives `canonical_intent` and `data_shape_hash` internally; these are recomputed when populating `TemplateToPersist`, violating DRY.

---

_Fixed: 2026-06-27T09:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
