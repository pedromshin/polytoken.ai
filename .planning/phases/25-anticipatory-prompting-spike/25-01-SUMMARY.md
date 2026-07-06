---
phase: 25-anticipatory-prompting-spike
plan: 01
subsystem: python-domain
tags: [anticipatory-prompting, spike, triggers, heuristics]

# Dependency graph
requires: []
provides:
  - "ANTICIPATORY_PROMPTING_ENABLED feature flag (default False, D-12) + 8 spike tunables in settings.py"
  - "AnticipatoryCandidate / AnticipatoryStateSnapshot / AnticipatoryLifecycleEvent / SourceStateRef frozen contracts (D-05/D-06/D-13)"
  - "3 scripted AnticipatoryStateSnapshot fixtures (D-02): idle_after_genui / completed_artifact / ambiguous_intent"
  - "3 deterministic triggers + flag-gated run_triggers entry (D-04/D-06/D-12)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Domain-pure, settings-agnostic trigger layer: triggers.py and fixtures.py import nothing from app.settings — the caller (a future use case) resolves settings.ANTICIPATORY_* and passes plain enabled/idle_threshold_seconds kwargs, mirroring widget_result_validator.py's zero-app.infrastructure posture"
    - "Tuple-only collections on AnticipatoryStateSnapshot enforce D-06 read-only observation at the type level, not just convention — a trigger has no mutable collection to mutate even by accident"
    - "AnticipatoryTrigger Protocol gives every trigger the SAME call signature (snapshot, *, idle_threshold_seconds) even though 2 of 3 triggers ignore the threshold — lets run_triggers loop over TRIGGERS uniformly with no per-trigger dispatch table"
    - "Ambiguous-intent detection is fully deterministic (D-04, no ML): a frozen vague-phrase set OR a token-count floor, either sufficient alone"

key-files:
  created:
    - apps/email-listener/app/domain/anticipatory/__init__.py
    - apps/email-listener/app/domain/anticipatory/candidate.py
    - apps/email-listener/app/domain/anticipatory/fixtures.py
    - apps/email-listener/app/domain/anticipatory/triggers.py
    - apps/email-listener/app/domain/anticipatory/__tests__/__init__.py
    - apps/email-listener/app/domain/anticipatory/__tests__/test_fixtures.py
    - apps/email-listener/app/domain/anticipatory/__tests__/test_triggers.py
  modified:
    - apps/email-listener/app/settings.py

key-decisions:
  - "Idle threshold (45.0s) and appropriateness threshold (0.75) hardcoded rationale documented inline in settings.py per the plan's discretion notes, mirroring the D-04/D-10 requirement to document chosen numbers"
  - "fixtures.py hardcodes IDLE_THRESHOLD_SECONDS=45.0 (mirroring, not importing, settings.ANTICIPATORY_IDLE_THRESHOLD_SECONDS's default) to keep the fixture module domain-pure per its own acceptance criteria (imports only app.domain.anticipatory.candidate)"
  - "Every trigger shares one Protocol call signature (idle_threshold_seconds always present) rather than three different signatures, trading a few unused kwargs for a uniform TRIGGERS tuple + loop in run_triggers"

requirements-completed: [ANTIC-01]

# Metrics
duration: ~15min
completed: 2026-07-05
---

# Phase 25 Plan 01: Anticipatory Prompting Trigger/Heuristic Layer Summary

**A read-only observation surface over a fixture-shaped chat+canvas state snapshot, a typed `AnticipatoryCandidate` proposal contract, and three deterministic (no-ML) triggers — idle-after-genui, completed-artifact, ambiguous-intent — each proposing but never firing a candidate, all gated dark behind `ANTICIPATORY_PROMPTING_ENABLED=False`.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3/3 completed (Task 1 `type="auto"`; Task 2 `type="auto"`; Task 3 `type="auto" tdd="true"`, RED then GREEN)
- **Files created:** 7 (1 package `__init__`, 1 contracts module, 1 fixtures module, 1 triggers module, 1 tests-package `__init__`, 2 test files)
- **Files modified:** 1 (`settings.py`)

## Accomplishments

- **Task 1 — Feature flag + spike settings + candidate/snapshot/lifecycle contracts:** Added a single anticipatory block to `BaseAppSettings` — `ANTICIPATORY_PROMPTING_ENABLED: bool = False` (D-12 global off switch) plus 7 spike tunables (idle threshold, appropriateness threshold, judge model/max-tokens/timeout, per-window/per-day frequency caps), each with an inline rationale comment, and an `anticipatory_judge_model_id` property resolving to `DEFAULT_GENUI_MODEL_ID` (Haiku) when unset, mirroring `genui_code_judge_model_id`'s exact pattern. New `app/domain/anticipatory/candidate.py` defines four frozen dataclasses — `SourceStateRef`, `AnticipatoryStateSnapshot` (every collection a `tuple`, never a `list` — D-06 enforced at the type level), `AnticipatoryCandidate` (D-05 typed proposal), `AnticipatoryLifecycleEvent` (D-13, mirrors `ChatRunEvent`'s type+data shape) — plus the `AnticipatoryLifecycleType` Literal (exactly the six D-13 tokens) and `TriggerId` Literal (the three trigger ids). Zero imports from `app.application`/`app.infrastructure`; `__all__` exports every public name.

- **Task 2 — Three scripted chat+canvas state fixtures (D-02):** `fixtures.py` exports `idle_after_genui_snapshot`, `completed_artifact_snapshot`, `ambiguous_intent_snapshot` — each a frozen `AnticipatoryStateSnapshot` built from a shared reproducible `_base_now()` reference epoch (never wall-clock time). The idle fixture's `last_activity_epoch_s` sits `IDLE_THRESHOLD_SECONDS + 15s` before `now_epoch_s`; the completed-artifact fixture carries one `settled` canvas panel with a `next_best_action` string; the ambiguous-intent fixture's `last_user_text` is `"make it better"` (3 tokens, also a frozen vague phrase). `test_fixtures.py` (9 tests) asserts each builder's firing invariant, that every collection field is a tuple, and that each snapshot is genuinely frozen (`dataclasses.FrozenInstanceError` on attempted mutation).

- **Task 3 — Three deterministic triggers + flag-gated `run_triggers` entry (TDD, D-04/D-06/D-12):** Wrote `test_triggers.py` first (RED — confirmed via `ModuleNotFoundError: No module named 'app.domain.anticipatory.triggers'`, commit `614ef13`), then implemented `triggers.py` (GREEN, commit `4276997`). `detect_idle_after_genui` fires only when the latest run_event is `completed` with `emitted_part_type` in `{genui_spec, interactive_widget}` AND idle time exceeds the threshold. `detect_completed_artifact` fires only when a `settled` canvas panel carries a `next_best_action`. `detect_ambiguous_intent` fires only when `last_user_text` is short (≤4 tokens) or matches a frozen vague-phrase set — fully deterministic, no LLM. All three share one `AnticipatoryTrigger` Protocol call signature; `TRIGGERS` is a module-level tuple; `run_triggers(snapshot, *, enabled, idle_threshold_seconds)` returns `[]` immediately when `enabled=False` (`if not enabled: return []` is the first statement) and otherwise collects every trigger's non-None candidate. 11 tests cover: each fixture yields exactly one candidate of the right `trigger_id` with non-empty `proposed_prompt_text`/`rationale`/`source_refs`; each fixture does NOT fire the other two triggers; `enabled=False` always returns `[]` (parametrized across all three fixtures); a hand-built "quiet" snapshot (recent activity, no panel, long non-vague text) yields `[]` even when enabled; `run_triggers` never mutates its input snapshot (`snapshot == dataclasses.replace(snapshot)` before/after).

## Task Commits

Each task was committed atomically:

1. **Task 1: feature flag + candidate/snapshot/lifecycle contracts** — `31d656c` (feat)
2. **Task 2: three scripted fixtures (D-02)** — `af1ce89` (feat)
3. **Task 3 RED: failing tests for triggers + run_triggers** — `614ef13` (test)
3. **Task 3 GREEN: three deterministic triggers + run_triggers** — `4276997` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

Task 3 carries `tdd="true"`. Gate sequence verified in `git log --oneline`: `test(25-01): add failing tests for triggers + run_triggers` (`614ef13`) precedes `feat(25-01): implement three deterministic triggers + flag-gated run_triggers` (`4276997`), with no intervening unrelated commits. RED was confirmed via a real collection error (`ModuleNotFoundError`, not merely "test written") before any implementation existed. No REFACTOR-phase commit was needed. Compliant. (Tasks 1 and 2 have no `tdd` attribute — single `feat` commits are correct per the plan.)

## Files Created/Modified

- `apps/email-listener/app/settings.py` — `ANTICIPATORY_*` block (8 fields) + `anticipatory_judge_model_id` property
- `apps/email-listener/app/domain/anticipatory/__init__.py` — new package marker
- `apps/email-listener/app/domain/anticipatory/candidate.py` — `SourceStateRef`/`AnticipatoryStateSnapshot`/`AnticipatoryCandidate`/`AnticipatoryLifecycleEvent` + `AnticipatoryLifecycleType`/`TriggerId` Literals
- `apps/email-listener/app/domain/anticipatory/fixtures.py` — `idle_after_genui_snapshot`/`completed_artifact_snapshot`/`ambiguous_intent_snapshot` + `IDLE_THRESHOLD_SECONDS`
- `apps/email-listener/app/domain/anticipatory/triggers.py` — `detect_idle_after_genui`/`detect_completed_artifact`/`detect_ambiguous_intent` + `AnticipatoryTrigger` Protocol + `TRIGGERS` + `run_triggers`
- `apps/email-listener/app/domain/anticipatory/__tests__/__init__.py` — new test-package marker
- `apps/email-listener/app/domain/anticipatory/__tests__/test_fixtures.py` — 9 tests
- `apps/email-listener/app/domain/anticipatory/__tests__/test_triggers.py` — 11 tests

## Decisions Made

See `key-decisions` in frontmatter. Summarized: spike tunable values (45s idle, 0.75 appropriateness, 1-per-10min/3-per-day caps) are documented inline in settings.py per the plan's own discretion notes; `fixtures.py` and `triggers.py` deliberately hardcode/mirror rather than import `app.settings` values to satisfy their own domain-purity acceptance criteria; every trigger shares one Protocol signature for a uniform `run_triggers` loop.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria (grep checks, ruff/mypy/lint-imports, pytest) passed on first attempt with no auto-fixes required.

## Issues Encountered

None.

## User Setup Required

None. No new dependencies (pure stdlib + existing domain types, per the plan's own T-25-SC disposition). The feature flag defaults OFF — no environment variable needs to be set for this plan's code to stay dark in every deployed environment.

## Known Stubs

None. This plan is deliberately "real but dark" (D-01) — every trigger is a fully working pure function, not a stub; the only thing gating it from ever running in production is `ANTICIPATORY_PROMPTING_ENABLED=False`, which is the intended spike posture, not a gap.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated — all three dispositions implemented exactly as planned:
- T-25-05 — `AnticipatoryStateSnapshot` is frozen with tuple-only collections; `run_triggers` is proven not to mutate its input snapshot via a dedicated test.
- T-25-06 — the flag gate (`if not enabled: return []`) is the first statement in `run_triggers`; confirmed via grep and via a parametrized test across all three fixtures.
- T-25-SC — no package-manager installs in this plan.

## Next Phase Readiness

- Plan 25-02 can build the appropriateness-eval + frequency-cap gate chain directly on top of `AnticipatoryCandidate`/`AnticipatoryStateSnapshot`/`AnticipatoryLifecycleEvent` and the `ANTICIPATORY_*` settings block — no further contract or settings work needed before that plan starts.
- Plan 25-03's findings harness can import `fixtures.py`'s three builders and `triggers.py`'s `run_triggers` directly (both are first-class importable modules, not test-local helpers) to drive the full gate chain deterministically.
- `packages/genui/src/renderer/spec-renderer.tsx` confirmed untouched across every commit in this plan (`git diff --stat` empty) — trivially satisfied since this plan is backend-only.

---
*Phase: 25-anticipatory-prompting-spike*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk. All 4 commits (`31d656c`,
`af1ce89`, `614ef13`, `4276997`) confirmed present in `git log --oneline`.
`apps/email-listener` pytest: 20/20 green (9 fixture + 11 trigger tests,
`--no-cov` per project convention for targeted test runs). `uv run ruff check`,
`uv run mypy`, and `uv run lint-imports` all clean across every new/modified
file (8 source files total). Feature flag confirmed default OFF via grep
(`ANTICIPATORY_PROMPTING_ENABLED: bool = False` — 1 match).
