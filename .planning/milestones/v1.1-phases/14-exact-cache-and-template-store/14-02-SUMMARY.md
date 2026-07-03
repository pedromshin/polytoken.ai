---
phase: 14-exact-cache-and-template-store
plan: "02"
subsystem: email-listener/application
tags: [cache, sha256, determinism, tdd, pure-python]
dependency_graph:
  requires: []
  provides:
    - app.application.use_cases.cache_key.canonicalize_intent
    - app.application.use_cases.cache_key.compute_data_shape_hash
    - app.application.use_cases.cache_key.compute_cache_key
  affects:
    - apps/email-listener/app/application/use_cases/cache_key.py
    - apps/email-listener/tests/application/test_cache_key.py
tech_stack:
  added: []
  patterns:
    - Pure stdlib Python (hashlib, json, re, unicodedata) — no infrastructure imports
    - TDD RED/GREEN with pytest.mark.unit()
    - Value-free recursive shape descriptor (sorted keys + type names only)
    - 0x1f unit-separator field delimiter for collision-free key composition
key_files:
  created:
    - apps/email-listener/app/application/use_cases/cache_key.py
    - apps/email-listener/tests/application/test_cache_key.py
  modified: []
decisions:
  - "compute_cache_key uses keyword-only args to prevent argument-order bugs"
  - "bool check precedes int check in _type_name/_extract_shape (isinstance(True, int) is True in Python)"
  - "depth cap of 8 (_MAX_SHAPE_DEPTH) per D-06 Claude's Discretion; nodes at cap return type name only"
  - "Array element shapes are deduped+sorted via json.dumps round-trip for deterministic mixed-type arrays"
  - "importer_id=None and importer_id='__system__' produce the same key (None IS the system sentinel per D-08)"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-27"
  tasks_completed: 2
  files_count: 2
---

# Phase 14 Plan 02: cache_key — Deterministic SHA-256 Cache Key Module Summary

SHA-256 exact-match cache key module with value-free data shape hashing, NFC intent canonicalization, and 0x1f-delimited field composition — stdlib-only, infra-free, TDD GREEN.

## What Was Built

A pure, deterministic Python module (`app/application/use_cases/cache_key.py`) implementing three named functions:

**`canonicalize_intent(intent: str) -> str`** (D-05)
- NFC Unicode normalization → strip → lower → collapse `\s+` to single space
- "  Show   Invoice  " → "show invoice"; "Show invoice" == "show  Invoice"

**`compute_data_shape_hash(raw_content: str) -> str`** (D-06)
- SHA-256 over the VALUE-FREE structural shape of `raw_content`
- JSON input: recursive descriptor — sorted object keys + type names (never values)
- Opaque non-JSON: `"text"` sentinel; empty/whitespace: `"∅"` sentinel
- Depth-capped at 8; list element types deduped+sorted for determinism
- Identical shapes with different values → identical hash (CACHE-03 foundation)

**`compute_cache_key(*, intent, raw_content, registry_version, importer_id, catalog_id) -> str`** (D-04/D-08)
- SHA-256 over `canonical_intent ‖ 0x1f ‖ data_shape_hash ‖ 0x1f ‖ registry_version ‖ 0x1f ‖ context_descriptor`
- `context_descriptor = f"{importer_id or '__system__'}|{catalog_id}"`
- Returns 64-character lowercase hex digest

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `733dcc8` test(14-02): add failing cache_key tests | PASS — ModuleNotFoundError confirmed before impl |
| GREEN | `8571fd5` feat(14-02): implement deterministic cache_key module | PASS — 15/15 tests pass |

## Verification Results

```
tests/application/test_cache_key.py  15 passed
ruff check app/application/use_cases/cache_key.py  — All checks passed!
mypy app/application/use_cases/cache_key.py        — Success: no issues found
grep -c "app.infrastructure" cache_key.py          — 0 (lint-imports clean)
```

## Success Criteria Coverage

| Criterion | Test | Status |
|-----------|------|--------|
| CACHE-02: deterministic 64-char lowercase hex | `test_cache_key_is_deterministic_and_64_lowercase_hex` | PASS |
| D-05: whitespace/case intent normalization | `test_canonicalize_intent_*` (3 tests) | PASS |
| D-06: value-free shape hash (CACHE-03) | `test_data_shape_hash_same_shape_different_values_are_equal` | PASS |
| Key-order independence | `test_data_shape_hash_key_order_independent` | PASS |
| Opaque text vs empty sentinel distinction | `test_data_shape_hash_opaque_text_vs_empty_are_distinct` | PASS |
| CACHE-04: registry_version change → new key | `test_cache_key_registry_version_change_yields_different_key` | PASS |
| D-08/T-14-05: tenant isolation | `test_cache_key_importer_id_change_yields_different_key` | PASS |
| D-08: None→__system__ sentinel | `test_cache_key_importer_id_none_folds_system_sentinel_deterministically` | PASS |
| T-14-06: delimiter anti-collision | `test_cache_key_delimiter_anti_collision` | PASS |
| CACHE-03: same shape, different values → same key | `test_cache_key_same_shape_different_values_hit_same_key` | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed dict comprehension using undeclared variable `v`**
- **Found during:** Task 2 first test run (10 tests failed)
- **Issue:** `_extract_shape` dict branch used `{k: _extract_shape(v, depth+1) for k in sorted(value.keys())}` — `v` was never defined; should be `value[k]`
- **Fix:** Changed to `{k: _extract_shape(value[k], depth + 1) for k in sorted(value.keys())}`
- **Files modified:** `apps/email-listener/app/application/use_cases/cache_key.py`
- **Commit:** included in `8571fd5`

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This module is a pure computation helper with no I/O. All four STRIDE threats targeted by this plan (T-14-05..T-14-08) are mitigated by the implementation and verified by tests.

## Known Stubs

None — all three functions are fully implemented.

## Self-Check: PASSED

- [x] `apps/email-listener/app/application/use_cases/cache_key.py` exists
- [x] `apps/email-listener/tests/application/test_cache_key.py` exists
- [x] Commit `733dcc8` exists (RED)
- [x] Commit `8571fd5` exists (GREEN)
- [x] 15/15 tests pass; ruff clean; mypy clean; 0 infra imports
