---
phase: 13-generation-layer-and-guardrails
plan: "02"
subsystem: audit-log
tags: [drizzle, migration, python, protocol, supabase, tdd, audit, generation]
dependency_graph:
  requires: []
  provides:
    - genui_generation_events Postgres table (local applied; staging/prod PENDING DEPLOY)
    - GenerationAuditRepository domain port (Protocol)
    - GenerationEvent frozen dataclass (D-19)
    - SupabaseGenerationAuditRepository adapter (best-effort insert)
  affects:
    - packages/db schema barrel (index.ts re-export)
    - Phase 14 CACHE-02 seam (cache hit = zero new row)
tech_stack:
  added:
    - Drizzle pgTable for genui_generation_events
    - Python Protocol for GenerationAuditRepository port
    - frozen dataclass GenerationEvent
    - structlog for swallowed-exception logging in adapter
  patterns:
    - TDD: test(RED) -> feat(GREEN) cycle
    - best-effort audit: swallow + log, never raise
    - domain purity: port imports only typing/dataclasses (lint-imports clean)
    - D-19 privacy: intent stored as hash, never raw prose
key_files:
  created:
    - packages/db/src/schema/genui-generation-events.ts
    - packages/db/migrations/0021_genui_generation_events.sql
    - packages/db/migrations/meta/0021_snapshot.json
    - apps/email-listener/app/domain/ports/generation_audit_repository.py
    - apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py
    - apps/email-listener/tests/test_supabase_generation_audit_repository.py
  modified:
    - packages/db/src/schema/index.ts (re-export appended)
    - packages/db/migrations/meta/_journal.json (0021 entry added by drizzle-kit)
decisions:
  - "Migration SQL manually edited to add IF NOT EXISTS guards and outcome CHECK constraint (drizzle-kit does not emit CHECK from text() columns)"
  - "Adapter placed at app/infrastructure/supabase/ (not app/infrastructure/persistence/ as in plan) — matches live project structure"
  - "Test file placed flat at tests/ (not tests/infrastructure/) — matches all other project tests"
metrics:
  duration: "~20 minutes (resumed from prior session)"
  completed: "2026-06-27"
  tasks_completed: 2
  files_count: 8
---

# Phase 13 Plan 02: Audit-Log Foundation for Generation Pipeline Summary

Drizzle table `genui_generation_events` + migration 0021 + Python `GenerationAuditRepository` Protocol port + `SupabaseGenerationAuditRepository` best-effort adapter, with frozen `GenerationEvent` dataclass (D-19 intent-hash privacy, T-13-11 outcome CHECK, T-13-10 swallow-never-raise).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | genui_generation_events Drizzle table + migration 0021 | 11afb5d | genui-generation-events.ts, 0021_genui_generation_events.sql, schema/index.ts |
| 2 (RED) | Failing tests for GenerationAuditRepository | 2ee7cb4 | tests/test_supabase_generation_audit_repository.py |
| 2 (GREEN) | GenerationAuditRepository port + adapter | ad0ed0a | generation_audit_repository.py, supabase_generation_audit_repository.py |

## Migration Status

| Environment | Status |
|-------------|--------|
| Local Postgres | APPLIED — 14 columns verified via information_schema |
| Staging (fyfwkjvbcrmjqjysdyqw) | PENDING DEPLOY — do not apply until Phase 14 is ready |
| Production (dazyccjijdahxyciptkp) | PENDING DEPLOY — migrations-first deploy discipline |

Verification result (local):
```
Columns: id, intent_hash, model_id, input_tokens, output_tokens, attempts, outcome,
         spec_validation_passed, spec_node_count, spec_depth, registry_version,
         latency_ms, importer_id, created_at
Row count: 14 (14 columns confirmed)
```

## Quality Gates

| Gate | Result |
|------|--------|
| tsc --noEmit (packages/db) | PASS |
| drizzle-kit generate | PASS |
| information_schema column verification | PASS (14 columns) |
| pytest -v --no-cov (4 tests) | PASS (4/4) |
| ruff check | PASS |
| mypy (2 new files) | PASS |
| bandit | PASS (0 issues) |
| lint-imports | PASS (3/3 contracts kept) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Structural] Adapter path corrected to match live project structure**
- **Found during:** Task 2 implementation
- **Issue:** Plan specified `app/infrastructure/persistence/supabase_generation_audit_repository.py` and `tests/infrastructure/test_supabase_generation_audit_repository.py`, but live project uses `app/infrastructure/supabase/` for all Supabase adapters and `tests/test_*.py` (flat) for all tests
- **Fix:** Created adapter at `app/infrastructure/supabase/supabase_generation_audit_repository.py` and test at `tests/test_supabase_generation_audit_repository.py`
- **Files modified:** As noted in commits

**2. [Rule 1 - Bug] outcome CHECK constraint added manually to migration SQL**
- **Found during:** Task 1 migration generation
- **Issue:** `drizzle-kit generate` does not emit CHECK constraints from plain `text()` columns — the T-13-11 tamper guard would have been missing
- **Fix:** Manually edited `0021_genui_generation_events.sql` post-generation to add `CONSTRAINT "genui_generation_events_outcome_check" CHECK (outcome IN ('ok', 'fallback', 'escalated'))`

**3. [Rule 1 - Bug] IF NOT EXISTS guards added manually to migration SQL**
- **Found during:** Task 1 migration generation
- **Issue:** drizzle-kit generates CREATE TABLE without IF NOT EXISTS; project precedent (0013) requires idempotency guards
- **Fix:** Added `IF NOT EXISTS` to TABLE and both INDEX statements

**4. [Rule 1 - Bug] Test 3 (frozen immutability) fixed after initial RED**
- **Found during:** GREEN phase
- **Issue:** Initial frozen test used `object.__setattr__` which bypasses the frozen guard at the C-API level and does not raise even on frozen dataclasses
- **Fix:** Changed to direct attribute assignment (`_SAMPLE_EVENT.intent_hash = "mutated"`) which correctly triggers `FrozenInstanceError(AttributeError)`. Also removed unused `AsyncMock` import (ruff F401).

## Known Stubs

None — all files are production-ready. The adapter is best-effort by design (T-13-10), not a stub.

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, or trust-boundary crossings. The new table is write-only from the generation pipeline (no read path exposed). intent stored as hash (D-19 privacy satisfied).

## Self-Check: PASSED

- packages/db/src/schema/genui-generation-events.ts: FOUND
- packages/db/migrations/0021_genui_generation_events.sql: FOUND
- apps/email-listener/app/domain/ports/generation_audit_repository.py: FOUND
- apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py: FOUND
- apps/email-listener/tests/test_supabase_generation_audit_repository.py: FOUND
- Commit 11afb5d: FOUND
- Commit 2ee7cb4: FOUND
- Commit ad0ed0a: FOUND
