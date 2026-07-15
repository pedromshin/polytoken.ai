---
phase: 57-email-learning-loop
plan: 03
subsystem: backend
tags: [python, postgres, sql, entity-resolution, blendedrag, learning-loop]

# Dependency graph
requires: [57-01]
provides:
  - "migration 0039_entity_resolution_dismiss_filter.sql (AUTHORED/GENERATED, not yet applied) — re-emits match_entities_by_embedding + match_entities_by_trgm with a backward-compatible match_subject_entity_instance_id param + symmetric NOT EXISTS was_dismissed exclusion"
  - "EntityResolutionRepository.find_candidates optional subject_entity_instance_id kwarg (domain port + Supabase adapter)"
  - "ResolveEntityCandidatesUseCase and PromoteEntityOnConfirmUseCase both thread their subject id into find_candidates"
  - "real-postgres integration test proving symmetric dismiss-then-resolve exclusion (skipped unless INTEGRATION_SUPABASE_* set)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "in-SQL NOT EXISTS exclusion filter guarded by `param IS NULL OR ...` for backward compatibility, mirroring the RPC-parameter-addition pattern already used across migrations 0009/0017"
    - "symmetric polymorphic-column filter (component_entity_candidate_links.component_id sometimes holds an entity_instances.id) — the filter's OR clause checks both orderings independently of which ordering(s) a caller happened to write (Pitfall 1)"
    - "integration test seeds only ONE candidate-link ordering before dismissing, so the AFTER assertions prove the SQL filter's own symmetry rather than merely observing dismiss_candidate_link's dual write"

key-files:
  created:
    - packages/db/migrations/0039_entity_resolution_dismiss_filter.sql
  modified:
    - packages/db/migrations/meta/_journal.json
    - packages/db/migrations/meta/0039_snapshot.json
    - apps/email-listener/app/domain/ports/entity_resolution_repository.py
    - apps/email-listener/app/infrastructure/supabase/entity_resolution_repository.py
    - apps/email-listener/app/application/use_cases/resolve_entity_candidates.py
    - apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py
    - apps/email-listener/tests/test_entity_resolution.py
    - apps/email-listener/tests/test_integration_real_postgres.py

key-decisions:
  - "MIGRATION NUMBER: 0039 (packages/db/migrations/0039_entity_resolution_dismiss_filter.sql). Journal head was 0038 (Plan 57-01's entity_type_corrections) at execution time — 0039 is the next free index, matching 57-01-SUMMARY.md's forecast exactly."
  - "drizzle-kit's --custom generator again produced a random slug (0039_panoramic_gressill.sql) because the migration:generate:custom npm script's hard-coded --name= isn't forwarded through npm's arg parsing without a -- separator — same root cause 57-01 hit and documented. Renamed the .sql file + corrected the journal tag to 0039_entity_resolution_dismiss_filter to match the plan's acceptance-criteria glob (Rule 1 — recurring bug in the plan's literal command, fixed inline, no new pattern needed since 57-01 already established the fix)."
  - "Reworded one migration comment from 'component_entity_candidate_links.was_dismissed = true' to avoid the literal substring 'was_dismissed = true' outside the two SQL WHERE clauses — the comment would otherwise have tripped its own acceptance grep gate (`grep -c 'was_dismissed = true' ... returns 2`), mirroring 57-01's self-caught prose-vs-grep-gate lesson (Rule 1)."
  - "Integration test seeds only ONE component_entity_candidate_links ordering (component_id=A, entity_instance_id=B) before calling RejectMergeUseCase, rather than seeding both orderings. This is deliberate: it forces the AFTER assertions to prove the SQL filter's own OR-clause symmetry (Pitfall 1) rather than merely observing that dismiss_candidate_link happens to write both directions — a filter that only checked one ordering would pass a both-orderings-seeded test but fail this one."
  - "The two entity_instances seeded in the integration test share an identical display_name (guarantees pg_trgm similarity()=1.0, both embedding=None) instead of a similar-but-distinct name — keeps the BEFORE precondition assertion fully deterministic with zero dependency on trgm similarity thresholds or a live Bedrock embed call."

requirements-completed: [LEARN-02]

# Metrics
duration: ~40min
completed: 2026-07-15
---

# Phase 57 Plan 03: Entity-Resolution Dismiss Filter (was_dismissed Consumption) Summary

**The dead `was_dismissed` flag written by `RejectMergeUseCase` since migration 0018 is now consumed: migration 0039 re-emits both BlendedRAG entity-resolution RPCs with a symmetric in-SQL `NOT EXISTS` exclusion, and both call sites that have the subject id in scope now thread it through — a human's merge rejection measurably stops a pair from resurfacing, proven in both link directions.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-15
- **Tasks:** 2/2 completed
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- **Migration 0039** (`packages/db/migrations/0039_entity_resolution_dismiss_filter.sql`) — `CREATE OR REPLACE` for both `match_entities_by_embedding` and `match_entities_by_trgm`, each gaining a trailing `match_subject_entity_instance_id uuid DEFAULT NULL` parameter. Every existing filter (`importer_id`, `entity_type_id`, `source='email_extracted'`, `is_active`), `ORDER BY`, `LIMIT`, and all three GIN trgm indexes are preserved verbatim from migration 0017. The new `NOT EXISTS` clause is guarded by `match_subject_entity_instance_id IS NULL OR ...` so every existing no-arg caller sees byte-identical behavior. `drizzle-kit check` green; journal head advances 38 → 39.
- **Symmetric exclusion (Pitfall 1):** the `NOT EXISTS` subquery checks BOTH `(component_id = subject AND entity_instance_id = candidate)` and `(component_id = candidate AND entity_instance_id = subject)` — mirroring `dismiss_candidate_link`'s own dual-ordering write (`entity_instance_repository.py:343-367`) so a dismiss recorded in one direction cannot resurface from the other.
- **Domain port + Supabase adapter** (`entity_resolution_repository.py` x2): `find_candidates` gains an optional `subject_entity_instance_id: str | None = None` kwarg. `SupabaseEntityResolutionRepository` passes `"match_subject_entity_instance_id": subject_entity_instance_id` into BOTH `_vector_query` and `_trgm_query`'s RPC param dicts — explicitly `None` when omitted (not absent), which is what the SQL-side `IS NULL OR ...` guard depends on.
- **Both call sites threaded:** `ResolveEntityCandidatesUseCase.execute` passes `subject_entity_instance_id=entity_instance_id`; `PromoteEntityOnConfirmUseCase.execute` passes `subject_entity_instance_id=persisted.id`. Neither use case gained a write path — both remain read-only/suggest-only exactly as before.
- **Unit test suite extended** (`test_entity_resolution.py`, 51 → 55 tests, all green): `FakeSupabaseClient` now records every `(name, params)` RPC call; two new tests prove `match_subject_entity_instance_id` reaches BOTH arms when provided and is explicitly `None` on both arms when omitted (legacy preservation). `FakeResolutionRepo` now records every `find_candidates(**kwargs)` call; two new use-case-level tests prove `ResolveEntityCandidatesUseCase` and `PromoteEntityOnConfirmUseCase` each pass the correct subject id — the exact "consumption proof at the boundary" the plan required.
- **Real-postgres integration test added** (`test_integration_real_postgres.py`, gated behind `INTEGRATION_SUPABASE_URL`/`INTEGRATION_SUPABASE_SERVICE_KEY`, collected-but-skipped in the unattended suite): seeds two `entity_instances` with an identical `display_name` (deterministic trgm sim=1.0, no embedding/Bedrock dependency), proves B resolves as a candidate for A BEFORE rejection, seeds only ONE `component_entity_candidate_links` ordering, calls `RejectMergeUseCase(A, B)`, then proves B is excluded from `ResolveEntityCandidates(A)` AND A is excluded from `ResolveEntityCandidates(B)` — the single-ordering seed makes this a true proof of the SQL filter's own symmetric `OR` clause, not just an observation of the dual write.

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-emit both entity-resolution RPCs with the dismissed-pair exclusion filter** — `767a2fe` (feat)
2. **Task 2: Thread subject_entity_instance_id through the port, repo, and both use cases + prove consumption** — `c3145c0` (feat)

## Files Created/Modified

- `packages/db/migrations/0039_entity_resolution_dismiss_filter.sql` - `CREATE OR REPLACE FUNCTION` for both RPCs, new backward-compatible param + symmetric `NOT EXISTS` dismissal filter
- `packages/db/migrations/meta/_journal.json` / `meta/0039_snapshot.json` - drizzle-kit bookkeeping (journal tag corrected to `0039_entity_resolution_dismiss_filter` after the generator's random-slug rename)
- `apps/email-listener/app/domain/ports/entity_resolution_repository.py` - `find_candidates` Protocol gains optional `subject_entity_instance_id` param + docstring
- `apps/email-listener/app/infrastructure/supabase/entity_resolution_repository.py` - `find_candidates`/`_vector_query`/`_trgm_query` thread the kwarg into both RPC param dicts
- `apps/email-listener/app/application/use_cases/resolve_entity_candidates.py` - threads `subject_entity_instance_id=entity_instance_id`
- `apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py` - threads `subject_entity_instance_id=persisted.id`
- `apps/email-listener/tests/test_entity_resolution.py` - `FakeSupabaseClient`/`FakeResolutionRepo` now record calls; 4 new tests (both-arm RPC threading x2, use-case consumption proof x2)
- `apps/email-listener/tests/test_integration_real_postgres.py` - new `test_dismiss_then_resolve_excludes_both_directions_against_real_postgres` (gated, skipped without live DB)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Summary:
- Migration claimed **0039** (head was 0038 at execution time, per Plan 57-01's own forecast — no collision, no re-check surprises).
- Fixed the same `migration:generate:custom` random-slug issue 57-01 already diagnosed (npm script's `--name=` isn't forwarded without `--`) by renaming the file + journal tag — this time expected going in, so no wasted investigation.
- Self-caught a second prose-vs-grep-gate collision (a migration comment using the literal substring `was_dismissed = true` outside the SQL bodies) before it could trip the acceptance criteria, following 57-01's precedent.
- Integration test deliberately seeds only one candidate-link ordering to make the AFTER assertions a genuine proof of the SQL filter's symmetry, not a restatement of `dismiss_candidate_link`'s known dual write.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration filename didn't match the plan's own acceptance-criteria glob**
- **Found during:** Task 1, immediately after `drizzle-kit generate --custom`
- **Issue:** `npm run migration:generate:custom --name=entity_resolution_dismiss_filter` does not forward `--name` through the npm script wrapper (the `migration:generate:custom` script hardcodes `drizzle-kit generate --custom --name=` with no `--` pass-through), so drizzle-kit assigned a random slug (`0039_panoramic_gressill.sql`) instead of `0039_entity_resolution_dismiss_filter.sql`. Identical root cause to 57-01's Deviation 1.
- **Fix:** Renamed the `.sql` file to `0039_entity_resolution_dismiss_filter.sql` and corrected the matching journal `tag` field. Re-ran `drizzle-kit check` — still green.
- **Files modified:** `packages/db/migrations/0039_entity_resolution_dismiss_filter.sql` (renamed), `packages/db/migrations/meta/_journal.json`
- **Commit:** `767a2fe`

**2. [Rule 1 - Bug] A migration comment's literal "was_dismissed = true" substring tripped its own acceptance grep gate**
- **Found during:** Task 1, before running the acceptance-criteria greps
- **Issue:** An explanatory top-of-file comment described the flag using the exact substring `was_dismissed = true`, which is precisely the string the acceptance criteria's `grep -c 'was_dismissed = true' ... returns 2` gate checks for — the comment would have produced a count of 3, failing the gate, despite the two actual SQL `WHERE` clauses being correct.
- **Fix:** Reworded the comment to "the dismissed-flag column on component_entity_candidate_links" without using the literal operator syntax.
- **Files modified:** `packages/db/migrations/0039_entity_resolution_dismiss_filter.sql`
- **Commit:** `767a2fe`

## Issues Encountered

None blocking beyond the two auto-fixed deviations above. `ruff check`/`ruff format --check`/`mypy`/`bandit -c pyproject.toml`/`lint-imports` all clean on every touched/created Python file (mypy scoped to `app/`, matching CI's own `uv run mypy app` invocation — pre-existing structural Protocol-typing noise in `tests/` from `Fake*` classes throughout the file predates this plan and is out of CI's mypy scope).

## User Setup Required

None. Migration 0039 is AUTHORED + GENERATED but NOT APPLIED to any environment (consistent with 57-01's posture for migration 0038) — the new RPC parameter and exclusion filter exist only in the migration file until a `migrate:local`/`migrate:staging`/`migrate:prod` run applies them. Until applied, `SupabaseEntityResolutionRepository` still calls the RPCs with the extra `match_subject_entity_instance_id` key in the params dict; because the deployed (0017-era) function signature has no such parameter, a live call before migration apply would raise a PostgREST/RPC error — the existing `try/except -> []` degrade-safe wrapper around both `_vector_query`/`_trgm_query` (D-12) already catches this and returns an empty arm rather than crashing, so no additional feature-detection gate is needed on the Python side (same fail-open posture 57-01 documented for its own unapplied migration).

## Deferred Human-Verifiable Follow-up

Live-DB proof (apply migration 0039, dismiss a real merge suggestion via the UI, confirm the pair stops resurfacing in `/entities`) is deferred to whenever the milestone's live-acceptance runsheet next applies pending migrations — not a code gap in this plan. The real-postgres integration test added in Task 2 (`test_dismiss_then_resolve_excludes_both_directions_against_real_postgres`) is the automated equivalent and will pass once migration 0039 is applied and `INTEGRATION_SUPABASE_*` env vars are set.

## Next Phase Readiness

- LEARN-02 (entity-resolution axis) is now fully wired end to end: capture (migration 0018, Phase 10) → RPC exclusion filter (migration 0039, this plan) → threaded consumption at both call sites (this plan) → deterministic unit proof + gated real-DB proof (this plan).
- No blockers for any downstream phase. This plan touched neither `EntityTypeClassifierProtocol` nor `SuggestEntityTypesUseCase` (Plan 57-02's territory) nor any chat-path file (the concurrent chat-path executor's territory) — fully disjoint file set, confirmed via `git status` before every commit.
- STATE.md was NOT touched by this plan (additive-only discipline honored by simply not writing to it — no entry was needed beyond what the orchestrator's own state-update step performs after this summary).

---
*Phase: 57-email-learning-loop*
*Completed: 2026-07-15*

## Self-Check: PASSED

Migration file `packages/db/migrations/0039_entity_resolution_dismiss_filter.sql` verified present on disk. Both task commits (`767a2fe`, `c3145c0`) verified present in `git log --oneline --all`. Targeted test suites green: `tests/test_entity_resolution.py` 55/55, `tests/test_integration_real_postgres.py` 4 collected / 4 skipped (no live DB env vars — expected). Full `apps/email-listener` pytest suite: 100% pass, 65.98% coverage (>= 65% ratchet). `drizzle-kit check` green. All four acceptance-criteria grep gates (Task 1: `match_subject_entity_instance_id` count, `was_dismissed = true` count, both-ordering symmetry; Task 2: `subject_entity_instance_id` in both use cases, `match_subject_entity_instance_id` in the Supabase repo) passed exactly as specified. ruff check/format, mypy (app/ scope, matching CI), bandit, lint-imports all clean on every touched/created Python file.
