---
phase: 35-cost-eval-scaffolding
plan: 02
subsystem: eval
tags: [typescript, zod, vitest, eval-harness, genui, tdd]

# Dependency graph
requires:
  - phase: 16-genui-eval-harness (existing Phase-16 eval harness convention)
    provides: "packages/genui/src/eval/ golden-set.json + page-ideas-schema.ts + index.ts + eval-assets.test.ts pattern (FOUND-7)"
provides:
  - "RETRIEVAL_GOLDEN_SET (7 seed entries) + INJECTION_FIXTURES (4 canary fixtures) registered into the EXISTING Phase-16 eval harness, schema-validated at module load"
  - "scoreRetrievalAtK / validateCitationEnvelope / citationRouteMatchesTemplate / CITATION_FAITHFULNESS_RUBRIC / extractCanary / scoreInjectionResistance — pure scorer functions re-exported from eval/index.ts"
  - "EVAL-DIMENSIONS.README.md documenting the scoring contracts AND the Python<->TS bridge path contract Plan 35-03 depends on"
affects: [35-03-python-eval-bridge, 36-thin-wrapper-tools, 37-knowledge-search-python-read-side, 38-quarantine-adversarial-eval]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ONE schema module per new asset family (eval-dimensions-schema.ts), mirroring page-ideas-schema.ts's precedent, generalized to 3 shapes (retrieval golden entry, injection fixture, citation envelope entry)"
    - "[CANARY:token] bracket-embedding convention inside retrievedText — the ONLY canary encoding, extracted via regex, no separate JSON field"

key-files:
  created:
    - packages/genui/src/eval/eval-dimensions-schema.ts
    - packages/genui/src/eval/retrieval-golden-set.json
    - packages/genui/src/eval/injection-fixtures.json
    - packages/genui/src/eval/EVAL-DIMENSIONS.README.md
    - packages/genui/src/__tests__/eval-dimensions-assets.test.ts
    - packages/genui/src/eval/retrieval-scorer.ts
    - packages/genui/src/eval/citation-scorer.ts
    - packages/genui/src/eval/injection-scorer.ts
    - packages/genui/src/eval/__tests__/scorers.test.ts
  modified:
    - packages/genui/src/eval/index.ts

key-decisions:
  - "Resumed-execution reconciliation: Task 1 (fixtures/schema/README/assets-test) had already landed in commit 5e2ae05 from the prior session and needed no changes — verified against the plan's acceptance criteria before treating it as done."
  - "Task 2's test file (scorers.test.ts) existed uncommitted from the killed prior session but its three implementation targets (retrieval-scorer.ts/citation-scorer.ts/injection-scorer.ts) did not exist on disk — wrote all three fresh against the test file's exact expectations (RED was already there; verified GREEN before committing) rather than rewriting the test."
  - "citationRouteMatchesTemplate uses an exhaustive switch on the 3-value kind enum (no default branch) so a future 4th kind fails typecheck instead of silently falling through."

patterns-established:
  - "Scorer-mirrors-README contract: EVAL-DIMENSIONS.README.md's documented formulas (recall@k/precision@k math, canonical route templates, canary regex) are the source of truth Plan 35-03's Python scorers replicate verbatim."

requirements-completed: [EVAL-06, EVAL-07]

# Metrics
duration: ~25min (reconciliation session)
completed: 2026-07-08
---

# Phase 35 Plan 02: Eval Dimensions (Retrieval/Citation/Injection) Summary

**Two new eval-harness fixture families (retrieval golden set, injection canary fixtures) plus a structural citation checker, registered into the EXISTING Phase-16 `packages/genui/src/eval/` harness with schema-validated JSON, a CI-gating assets test, and three pure scorer functions — no parallel mechanism (FOUND-7).**

## Performance

- **Duration:** ~25 min (this reconciliation session; Task 1 originated in the prior killed session)
- **Completed:** 2026-07-08T19:19:03-03:00
- **Tasks:** 2 completed (Task 1 pre-existing from commit 5e2ae05, verified; Task 2 written fresh this session)
- **Files touched this session:** 5 (3 new scorer modules, 1 test file adopted, index.ts extended)

## Accomplishments
- `eval-dimensions-schema.ts` — three `.strict()` Zod schemas (`RetrievalGoldenEntrySchema`, `InjectionFixtureSchema`, `CitationSchema`) with LOCKED field names (`expected_ids`/`notes` snake_case) per 35-CONTEXT.md
- `retrieval-golden-set.json` — 7 seed entries (within the 5-10 range), all 3 `kind` values present, 3 entries with multi-element `expected_ids`
- `injection-fixtures.json` — 4 canary fixtures, one per named category (`delimiter-breakout`/`role-confusion`/`encoded-override`/`nested-tool-call-request`), every `retrievedText` embeds a `[CANARY:token]` marker
- `EVAL-DIMENSIONS.README.md` — scoring contracts for all 3 dimensions plus the Python↔TS bridge path contract naming `apps/email-listener/tests/evals/_paths.py` (consumed by Plan 35-03)
- `retrieval-scorer.ts` — `scoreRetrievalAtK(actualIds, expectedIds, k=5)` computing `{recallAtK, precisionAtK}`, never divides by zero
- `citation-scorer.ts` — `citationRouteMatchesTemplate` (exhaustive switch over 3 kinds), `validateCitationEnvelope` (route-template + envelope-membership structural checks), `CITATION_FAITHFULNESS_RUBRIC` (plain-text LLM-judge stub, explicitly not connected)
- `injection-scorer.ts` — `extractCanary` (regex capture), `scoreInjectionResistance` (canary-substring leak check against visible text)
- `eval/index.ts` extended (append-only) to re-export `RETRIEVAL_GOLDEN_SET`, `INJECTION_FIXTURES`, all 3 new schemas/types, and all 6 scorer functions/types/constants — existing `PAGE_IDEAS`/`GOLDEN_SET`/`PageIdeaSchema`/`PageIdeaSetSchema` exports unchanged (diff-verified empty against `golden-set.json`/`page-ideas.json`/`page-ideas-schema.ts`)

## Task Commits

1. **Task 1: Fixture schemas + JSON seed data + registration + assets test** - `5e2ae05` (feat) — landed in the prior session before it was killed by the session limit
2. **Task 2: Pure scorer functions** - `caafc9e` (feat) — written and committed this session

_Note: both tasks were plan-specified `tdd`/spec-first; Task 2's test file (`scorers.test.ts`) already existed uncommitted from the killed session with 12 test cases matching the plan's `<behavior>` block verbatim — it was adopted as-is (RED confirmed by absence of its 3 import targets) and the 3 scorer implementation files were written fresh against it, then verified GREEN before committing together._

## Files Created/Modified
- `packages/genui/src/eval/eval-dimensions-schema.ts` - shared Zod schemas (pre-existing, commit 5e2ae05)
- `packages/genui/src/eval/retrieval-golden-set.json` - 7 seed entries (pre-existing, commit 5e2ae05)
- `packages/genui/src/eval/injection-fixtures.json` - 4 canary fixtures (pre-existing, commit 5e2ae05)
- `packages/genui/src/eval/EVAL-DIMENSIONS.README.md` - scoring contracts + bridge path contract (pre-existing, commit 5e2ae05)
- `packages/genui/src/__tests__/eval-dimensions-assets.test.ts` - 12 structural CI-gate assertions (pre-existing, commit 5e2ae05)
- `packages/genui/src/eval/retrieval-scorer.ts` - `scoreRetrievalAtK` + `RetrievalScore` type (new, commit caafc9e)
- `packages/genui/src/eval/citation-scorer.ts` - `validateCitationEnvelope` + `citationRouteMatchesTemplate` + `CITATION_FAITHFULNESS_RUBRIC` (new, commit caafc9e)
- `packages/genui/src/eval/injection-scorer.ts` - `extractCanary` + `scoreInjectionResistance` + `CANARY_PATTERN` (new, commit caafc9e)
- `packages/genui/src/eval/__tests__/scorers.test.ts` - 12 tests across 4 `describe` blocks (adopted from killed session, verified GREEN, commit caafc9e)
- `packages/genui/src/eval/index.ts` - extended with scorer re-exports (commit caafc9e)

## Decisions Made
- Reconciled the killed prior session's partial state by diffing against the plan's acceptance criteria file-by-file rather than assuming either "everything's done" or "start over": Task 1's 6 files were verified present, correctly shaped, and passing before being trusted; Task 2's lone uncommitted file (the test) was verified to genuinely be RED (missing imports) before writing implementations against it.
- `citationRouteMatchesTemplate`'s switch has no `default` case — TypeScript's exhaustiveness checking on the 3-value `kind` union means a future 4th kind is a compile error here, not a silent pass-through.

## Deviations from Plan

None — Task 1's committed shape matches the plan's field names/counts exactly (7 entries within the 5-10 range vs the plan's example showing 3; 4 injection fixtures matching the plan's exact 4 named examples verbatim). Task 2's implementations were written to satisfy the plan's `<action>` spec and the pre-existing test file's assertions simultaneously; both were consistent with each other, so no scorer formula needed adjustment from what the plan specified.

## Issues Encountered

The prior session was killed mid-Task-2: `scorers.test.ts` existed on disk uncommitted, importing from three files (`../retrieval-scorer`, `../citation-scorer`, `../injection-scorer`) that did not exist. This was NOT a case of finished-but-uncommitted work — it was a RED test with no GREEN implementation yet. Wrote all three scorer modules from the plan's `<action>` spec, ran the test file, got 12/12 green immediately (no iteration needed — the plan's math spec and the test's assertions were already in agreement), then ran the full package suite (28 files / 501 tests) to confirm zero regressions before committing.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- EVAL-06/EVAL-07's TS-side scorer contract is complete and CI-gated: `npm run test -w @nauta/genui` (28/28 files, 501/501 tests) and `npm run typecheck -w @nauta/genui` both clean.
- `packages/genui/src/eval/EVAL-DIMENSIONS.README.md` documents the exact Python bridge path contract (`apps/email-listener/tests/evals/_paths.py`) that Plan 35-03 implements against.
- Ready for 35-03 (Python pytest bridge loading these same JSON fixtures via monorepo-relative path, scored against Phase 34's `EchoToolExecutor`) — no blockers.

---
*Phase: 35-cost-eval-scaffolding*
*Completed: 2026-07-08*

## Self-Check: PASSED

All 10 files (6 from Task 1 pre-existing + 4 from Task 2 this session) confirmed present on disk.
Both task commits (`5e2ae05`, `caafc9e`) confirmed present in `git log`. Full package suite (28 test
files, 501 tests) and typecheck both clean as of this session.
