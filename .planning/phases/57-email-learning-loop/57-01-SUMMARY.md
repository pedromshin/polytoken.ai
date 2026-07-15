---
phase: 57-email-learning-loop
plan: 01
subsystem: backend
tags: [python, hexagonal, postgres, drizzle, entity-type-classification, learning-loop]

# Dependency graph
requires: []
provides:
  - "entity_type_corrections table (migration 0038, AUTHORED/GENERATED, not yet applied) + RLS + Drizzle schema mirror"
  - "match_entity_type_corrections_by_trgm RPC — importer-scoped ONLY (no entity_type_id filter, Pitfall 4)"
  - "EntityTypeCorrectionRepository domain port (EntityTypeCorrectionExample dataclass + Protocol: save, find_similar)"
  - "SupabaseEntityTypeCorrectionRepository adapter — save() exact-payload insert, find_similar() degrade-safe trgm retrieval"
  - "SetComponentEntityTypeUseCase's load-before-mutate correction-capture hook (best-effort, genuine-reclassification-only)"
  - "container.py DI wiring: SupabaseEntityTypeCorrectionRepository -> EntityTypeCorrectionRepository, threaded into SetComponentEntityTypeUseCase via a factory"
affects: [57-02, 57-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "load-before-mutate correction capture (D-16 idiom) mirrored from confirm_region.py's corrected_fields posture, applied to the entity-type axis instead of the field-value axis"
    - "importer_id-scoped-only retrieval (no entity_type_id filter) for a signal that must surface BEFORE classification decides the type — the one non-obvious adaptation of the existing retrieval-bias pattern (RESEARCH Pitfall 4)"
    - "best-effort capture: use-case-level try/except around repo.save() (mirrors ConfirmRegionUseCase's synthesis hook), NOT swallowed inside the repository itself — only find_similar() is internally degrade-safe (D-13 cold-start posture)"
    - "dishka factory for a defaulted-Optional collaborator param (mirrors _provide_autofill_use_case) — provider.provide(ClassName) alone does not auto-inject Optional[Port] params"
    - "dishka factory for a client: Any constructor param (mirrors _provide_retrieval) — provider.provide(ConcreteClass, provides=Port) fails GraphMissingFactoryError when the constructor's client param is typed Any instead of the concrete Client"

key-files:
  created:
    - packages/db/src/schema/entity-type-corrections.ts
    - packages/db/migrations/0038_entity_type_corrections.sql
    - apps/email-listener/app/domain/entities/entity_type_correction.py
    - apps/email-listener/app/domain/ports/entity_type_correction_repository.py
    - apps/email-listener/app/infrastructure/supabase/entity_type_correction_repository.py
    - apps/email-listener/tests/test_entity_type_correction_repository.py
    - apps/email-listener/tests/test_set_component_relationship.py
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/migrations/meta/_journal.json
    - packages/db/migrations/meta/0038_snapshot.json
    - apps/email-listener/app/application/use_cases/set_component_relationship.py
    - apps/email-listener/app/container.py

key-decisions:
  - "MIGRATION NUMBER: 0038 (packages/db/migrations/0038_entity_type_corrections.sql). Journal head was 0037 (Phase 56's chat_source_ledger/chat_context_edges) at execution time — 0038 is the next free index. Plan 57-03 must allocate 0039+."
  - "drizzle-kit generate's --name flag did not forward through the npm script wrapper (npm run migration:generate --name=X needs the -- separator the package.json script lacks) — the generator produced a random slug (0038_known_hemingway.sql). Renamed the .sql file + corrected the journal tag to 0038_entity_type_corrections.sql to match the plan's acceptance-criteria glob (*_entity_type_corrections.sql) and satisfy every grep gate; drizzle-kit check re-verified green after the rename (Rule 1 — bug in the plan's literal command, fixed inline)."
  - "Avoided the literal substring 'match_entity_type_id' in ALL prose (migration comments + Python docstrings), not just the RPC signature — an early draft's comment text ('no match_entity_type_id parameter') tripped the acceptance grep gate even though no such SQL/Python parameter exists. Reworded to 'no entity-type filter parameter' everywhere (Rule 1 — self-caught before commit)."
  - "SupabaseEntityTypeCorrectionRepository.save() does NOT swallow exceptions internally — only find_similar() does (D-13 degrade-safe). This lets SetComponentEntityTypeUseCase own the best-effort try/except at the use-case level, mirroring confirm_region.py's synthesis-hook posture exactly, per the plan's explicit behavior spec (Task 3, bullet 5)."
  - "SetComponentEntityTypeUseCase wiring required a dishka factory (_provide_set_component_entity_type_use_case), not a bare provider.provide(SetComponentEntityTypeUseCase) — confirmed via test_container.py failing with GraphMissingFactoryError on the first attempt, exactly as the existing AutofillUseCase precedent predicted for defaulted-Optional params."
  - "SupabaseEntityTypeCorrectionRepository's find_similar() also needed a factory (_provide_entity_type_correction_repository) rather than a direct provider.provide(SupabaseEntityTypeCorrectionRepository, provides=EntityTypeCorrectionRepository) binding — the constructor's client: Any param (deliberately typed to mirror retrieval_repository.py per the plan's read_first) is not resolvable by dishka directly; the factory is typed against the concrete Client, mirroring _provide_retrieval exactly (Rule 3 — blocking issue, caught by test_container.py before commit)."

requirements-completed: [LEARN-01]

# Metrics
duration: ~65min
completed: 2026-07-15
---

# Phase 57 Plan 01: Entity-Type Correction Capture + Trgm Retrieval Primitive Summary

**A genuine entity-type reclassification now writes a durable, importer-scoped `entity_type_corrections` row (prior + corrected type + provenance) instead of a silent overwrite — capture is best-effort and suggest-only; the trgm retrieval primitive Plan 57-02 will consume is fully wired end to end.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-07-15
- **Tasks:** 3/3 completed
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments

- `entity_type_corrections` table — `importer_id`/`component_id`/`previous_entity_type_id`/`corrected_entity_type_id` FKs, two indexes, RLS `ON ALL TO authenticated` importer-descendant policy (defense-in-depth; app-boundary tenancy is primary). Migration **0038** (`packages/db/migrations/0038_entity_type_corrections.sql`), Drizzle schema mirror exported from `schema/index.ts`. `drizzle-kit check` green.
- `match_entity_type_corrections_by_trgm(query_text, match_importer_id, match_count)` RPC — SECURITY INVOKER, STABLE, importer-scoped on BOTH JOINed tables (T-04-28/T-57-01), deliberately has NO `entity_type_id` filter parameter (Pitfall 4: this retrieval runs BEFORE the type is known). Reuses the existing GIN trgm index on `email_components.content_text` (migration 0009) — no new index authored.
- `EntityTypeCorrection` frozen domain entity + `EntityTypeCorrectionRepository` Protocol (`save`, `find_similar`) + `EntityTypeCorrectionExample` value object — domain-layer-only, `lint-imports` clean (0 `app.infrastructure` imports in the port).
- `SupabaseEntityTypeCorrectionRepository` — `save()` inserts the exact provenance payload (propagates exceptions, does not swallow); `find_similar()` calls the trgm RPC importer-scoped only and degrades to `[]` on any failure (D-13 cold-start-safe), never raises.
- `SetComponentEntityTypeUseCase` extended with an optional `corrections` collaborator (default `None`, backward compatible). `execute()` now captures a correction BEFORE `update_entity_type` (D-16 load-before-mutate) — ONLY when `previous_entity_type_id is not None AND entity_type_id is not None AND previous != new`. First-time classification, no-op, and clear are never captured. A capture failure is caught, logged, and the mutation still applies (best-effort, mirrors `confirm_region.py`'s synthesis hook).
- `container.py`: `SupabaseEntityTypeCorrectionRepository` bound to `EntityTypeCorrectionRepository` via a factory (`client: Any` constructor param needs a `Client`-typed factory, mirrors `_provide_retrieval`); `SetComponentEntityTypeUseCase` now provided via `_provide_set_component_entity_type_use_case` (defaulted-Optional param needs an explicit factory, mirrors `_provide_autofill_use_case`).
- Suggest-only invariant preserved and tested: `update_entity_type` is called unconditionally in every scenario (genuine correction, first-time, no-op, clear, save-failure); `extraction_status` is never touched by this use case; capture is purely additive to an existing human action.

## Task Commits

Each task was committed atomically:

1. **Task 1: entity_type_corrections table + importer-scoped trgm RPC** - `5785dc0` (feat)
2. **Task 2: EntityTypeCorrection domain entity + port + Supabase repository** - `e27a7db` (feat)
3. **Task 3: Wire best-effort correction capture into SetComponentEntityTypeUseCase** - `08bd480` (feat)

**Plan metadata:** (this commit, see below)

## Files Created/Modified

- `packages/db/src/schema/entity-type-corrections.ts` - `EntityTypeCorrections` Drizzle table + inferred types
- `packages/db/src/schema/index.ts` - barrel export appended after `component-links`
- `packages/db/migrations/0038_entity_type_corrections.sql` - `CREATE TABLE`, FKs, indexes, RLS policy, `match_entity_type_corrections_by_trgm` RPC (hand-appended after drizzle-kit's generated DDL)
- `packages/db/migrations/meta/_journal.json` / `meta/0038_snapshot.json` - drizzle-kit-generated migration bookkeeping (journal tag corrected to `0038_entity_type_corrections` after the filename rename)
- `apps/email-listener/app/domain/entities/entity_type_correction.py` - `EntityTypeCorrection` frozen dataclass
- `apps/email-listener/app/domain/ports/entity_type_correction_repository.py` - `EntityTypeCorrectionExample` dataclass + `EntityTypeCorrectionRepository` Protocol
- `apps/email-listener/app/infrastructure/supabase/entity_type_correction_repository.py` - `SupabaseEntityTypeCorrectionRepository` (`save`, `find_similar`)
- `apps/email-listener/tests/test_entity_type_correction_repository.py` - 6 tests: dataclass shape, exact insert payload, importer-scoped RPC params (no `match_entity_type_id`), row mapping, RPC-failure degrade, empty-rows degrade
- `apps/email-listener/app/application/use_cases/set_component_relationship.py` - `SetComponentEntityTypeUseCase.__init__` gains `corrections: EntityTypeCorrectionRepository | None = None`; `execute()` gains the load-before-mutate capture block
- `apps/email-listener/app/container.py` - `EntityTypeCorrectionRepository`/`SupabaseEntityTypeCorrectionRepository` imports, `_provide_entity_type_correction_repository` factory, `_provide_set_component_entity_type_use_case` factory, provider registrations
- `apps/email-listener/tests/test_set_component_relationship.py` - 7 tests: genuine reclassification (capture + mutation), first-time (no capture), no-op (no capture), clear (no capture), best-effort save-failure (mutation still applies), backward-compat without the collaborator

## Decisions Made

See `key-decisions` in frontmatter for the full list. Summary:
- Migration claimed **0038** (head was 0037 at execution time, per Phase 56).
- Fixed the plan's literal `npm run migration:generate --name=X` command producing a random-slug filename (the npm script lacks the `--` separator needed to forward the flag) by renaming the generated `.sql` + correcting the journal tag — self-caught via the acceptance-criteria glob before committing.
- Kept the correction-capture retrieval RPC strictly importer-scoped (no `entity_type_id` parameter, including in ALL prose/comments, not just the SQL signature) per RESEARCH Pitfall 4.
- Repository `save()` propagates exceptions; the use case owns the best-effort try/except, matching the plan's explicit behavior spec and `confirm_region.py`'s established posture.
- Two dishka factories were required beyond what the plan's interface sketch showed as sufficient (`_provide_entity_type_correction_repository` for the `client: Any` constructor param, `_provide_set_component_entity_type_use_case` for the defaulted-Optional collaborator) — both caught by `test_container.py`'s DI-graph-resolution test before commit, both mirror existing precedents already in `container.py`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration filename didn't match the plan's own acceptance-criteria glob**
- **Found during:** Task 1, immediately after `drizzle-kit generate`
- **Issue:** The plan's literal command `npm run migration:generate --name=entity_type_corrections` does not forward `--name` to `drizzle-kit generate` (the `migration:generate` npm script hardcodes `drizzle-kit generate` with no `--` pass-through), so drizzle-kit assigned a random slug (`0038_known_hemingway.sql`) instead of `0038_entity_type_corrections.sql`. The plan's acceptance criteria explicitly grep `packages/db/migrations/*_entity_type_corrections.sql`.
- **Fix:** Renamed the `.sql` file to `0038_entity_type_corrections.sql` and corrected the matching journal `tag` field to `0038_entity_type_corrections` (drizzle-kit's journal tag must equal the filename stem). Re-ran `drizzle-kit check` — still green.
- **Files modified:** `packages/db/migrations/0038_entity_type_corrections.sql` (renamed), `packages/db/migrations/meta/_journal.json`
- **Commit:** `5785dc0`

**2. [Rule 1 - Bug] "no match_entity_type_id parameter" prose tripped its own acceptance grep gate**
- **Found during:** Task 1 (SQL comment) and Task 2 (Python docstring)
- **Issue:** Explanatory comments describing the RPC's deliberate absence of an `entity_type_id` filter used the literal substring `match_entity_type_id`, which is exactly the string the acceptance criteria's `grep -c 'match_entity_type_id' ... returns 0` gate checks for — the comment itself would have failed the gate despite the actual SQL/Python signatures being correct.
- **Fix:** Reworded both the SQL migration comment and the Python repository docstring to say "no entity-type filter parameter" instead of naming the literal (non-existent) parameter.
- **Files modified:** `packages/db/migrations/0038_entity_type_corrections.sql`, `apps/email-listener/app/infrastructure/supabase/entity_type_correction_repository.py`
- **Commits:** `5785dc0`, `e27a7db`

**3. [Rule 3 - Blocking issue] `provider.provide(SetComponentEntityTypeUseCase)` and `provider.provide(SupabaseEntityTypeCorrectionRepository, provides=...)` both failed DI graph construction**
- **Found during:** Task 3, first `uv run pytest tests/test_container.py` run
- **Issue:** (a) `SetComponentEntityTypeUseCase`'s new `corrections: EntityTypeCorrectionRepository | None = None` param is a defaulted Optional — dishka does not auto-inject those via a bare `provider.provide(ClassName)` (same class of issue `AutofillUseCase` already hit). (b) `SupabaseEntityTypeCorrectionRepository.__init__`'s `client: Any` param (typed `Any` to mirror `retrieval_repository.py` per the plan's own `read_first` instruction) is not resolvable by dishka directly, raising `GraphMissingFactoryError`.
- **Fix:** Added `_provide_set_component_entity_type_use_case` and `_provide_entity_type_correction_repository` factory functions, mirroring the existing `_provide_autofill_use_case` and `_provide_retrieval` precedents respectively.
- **Files modified:** `apps/email-listener/app/container.py`
- **Commit:** `08bd480`

## Issues Encountered

None blocking beyond the three auto-fixed deviations above. `ruff check --fix` cleaned up 4 unnecessary quoted forward-reference type annotations in the Task 2 test file's `FakeSupabaseClient` (harmless given `from __future__ import annotations` is already present) — accepted the autofix, no manual override needed.

## User Setup Required

None. Migration 0038 is AUTHORED + GENERATED but NOT APPLIED to any environment (consistent with Phase 56-01's posture for migration 0037) — the RLS policy and RPC exist only in the migration file until a `migrate:local`/`migrate:staging`/`migrate:prod` run applies them. The capture hook's `try/except` around `corrections.save()` means an unapplied table degrades to a logged warning, never a crash — no separate feature-detection gate was needed on the Python side (matches the repo's established fail-open convention, A4 from 57-RESEARCH.md).

## Deferred Human-Verifiable Follow-up

Per the plan's suggest-only invariant, this plan is capture-only — nothing consumes the new table or RPC yet (Plan 57-02 is the consumer). Live-DB proof (apply migration 0038, reclassify a component via the UI dropdown, confirm a row lands in `entity_type_corrections`) is deferred to whenever the milestone's live-acceptance runsheet next applies pending migrations — not a code gap in this plan.

## Next Phase Readiness

- `EntityTypeCorrectionRepository.find_similar()` and the `match_entity_type_corrections_by_trgm` RPC are fully wired and tested; Plan 57-02 can consume `find_similar()` directly to build the few-shot `examples` parameter for `EntityTypeClassifierProtocol.classify()` without any further plumbing.
- Migration numbering: **next free index is 0039** — Plan 57-03 must re-check `packages/db/migrations/meta/_journal.json` at execution time rather than assuming 0039, in case a concurrent phase claims it first (same discipline this plan itself needed to apply against Phase 56's 0037).
- No blockers for 57-02 or 57-03 — this plan touched neither `EntityTypeClassifierProtocol` nor `SuggestEntityTypesUseCase` (both explicitly out of scope for Wave 1).
- STATE.md was updated additively only (no `state.advance-plan`) per the shared-file discipline in this plan's execution rules — concurrent phase executors may be running against the same checkout.

---
*Phase: 57-email-learning-loop*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 7 created source/test files verified present on disk plus this SUMMARY.md
(8/8). All 3 task commits (`5785dc0`, `e27a7db`, `08bd480`) verified present
in `git log --oneline --all`. Targeted test suites green (6/6 repository
tests, 7/7 use-case behavior tests + `test_container.py` DI graph). Full
`apps/email-listener` pytest suite: 100% pass, 66.88% coverage (>= 65%
ratchet). `drizzle-kit check` green. ruff check/format, mypy, bandit,
lint-imports all clean on every touched/created Python file.
