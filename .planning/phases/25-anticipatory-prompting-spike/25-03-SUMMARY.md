---
phase: 25-anticipatory-prompting-spike
plan: 03
subsystem: python-application
tags: [anticipatory-prompting, spike, findings, go-no-go, evidence-harness]

# Dependency graph
requires:
  - "Plan 25-01: ANTICIPATORY_PROMPTING_ENABLED flag + settings tunables, AnticipatoryCandidate/AnticipatoryStateSnapshot/AnticipatoryLifecycleEvent contracts, 3 fixtures, run_triggers"
  - "Plan 25-02: EvaluateAnticipatoryCandidates gate chain, StubAppropriatenessJudge, to_proposal_card_declaration, record_candidate_outcome"
provides:
  - "test_anticipatory_spike_harness.py — deterministic end-to-end fixture x scenario evidence matrix (16 tests, build_spike_outcome_matrix())"
  - "25-SPIKE-FINDINGS.md — the phase's D-03 exit criterion: an explicit go/no-go verdict (ship-with-conditions) + evidence + named seams + honest limitations"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-local FakeAnticipatoryCapStore (mirrors InMemoryAnticipatoryCapStore) rather than importing app.infrastructure.anticipatory into an app.application test file — the 'Application does not import infrastructure' import-linter contract covers files under app/application/**, including __tests__ subpackages, so this convention (established in 25-02) had to be repeated here."
    - "A single _run_scenario(fixture_name, scenario_name) helper parametrized both the fine-grained per-cell pytest matrix AND the build_spike_outcome_matrix() evidence-generation function, avoiding two divergent code paths for the same pipeline invocation."
    - "The terminal outcome of a pipeline run is read off the LAST lifecycle event's type (or 'none' when events is empty) — a single _terminal_outcome() helper is the one place the harness interprets AnticipatoryPipelineResult.events into the matrix's outcome vocabulary."

key-files:
  created:
    - apps/email-listener/app/application/use_cases/__tests__/test_anticipatory_spike_harness.py
    - .planning/phases/25-anticipatory-prompting-spike/25-SPIKE-FINDINGS.md
  modified: []

key-decisions:
  - "Verdict = ship-with-conditions, not a plain ship or don't-ship: the evidence proves the MECHANISM is sound and false-positive-averse, but does not touch live model behavior, durable persistence, or live UI wiring — none of which this spike attempted to build (D-02's own scope). The findings state this distinction explicitly rather than overclaiming readiness."
  - "The evidence table's four scenarios (A/B/C/D) map 1:1 to the plan's own scenario definitions rather than reusing Plan 25-02's daily-ceiling test scenario — the harness's job was breadth across all 3 fixtures for the plan-specified scenarios, not depth on every cap edge case Plan 25-02 already covered in its own unit tests."
  - "Seven seams enumerated in the findings (not the plan's literal minimum of five) — cross-conversation context and learned/ML triggers were added from the CONTEXT Deferred Ideas list because they are directly relevant to 'is this ready to ship' even though they weren't in the plan's action-text seam list."

requirements-completed: [ANTIC-01, ANTIC-02]

# Metrics
duration: ~20min
completed: 2026-07-06
---

# Phase 25 Plan 03: Anticipatory Prompting SPIKE Findings — Deterministic Harness + Go/No-Go Verdict Summary

**A deterministic end-to-end harness proves the trigger→independent-gate-chain→explicit-accept pipeline behaves exactly as designed across all three fixtures, and `25-SPIKE-FINDINGS.md` delivers the phase's exit criterion: an explicit `ship-with-conditions` verdict naming the seven seams a real feature would need before the flag is ever flipped on.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed (Task 1 `type="auto"`; Task 2 `type="auto"`)
- **Files created:** 2 (1 test module, 1 findings doc)
- **Files modified:** 0

## Accomplishments

- **Task 1 — End-to-end spike harness (the go/no-go evidence matrix):** `test_anticipatory_spike_harness.py` drives the REAL `EvaluateAnticipatoryCandidates` gate chain (Plan 25-02) over each of the three Plan-25-01 fixtures (`idle_after_genui`, `completed_artifact`, `ambiguous_intent`) across a 4-scenario matrix — A (score=0.9, empty cap → `shown`), B (score=0.9, cap seeded at the per-window limit → `suppressed_by_cap`), C (score=0.3, empty cap → `suppressed_by_eval`), D (`enabled=False` → zero candidates/events). A local `FakeAnticipatoryCapStore` mirrors `InMemoryAnticipatoryCapStore` exactly but is defined test-locally (not imported from `app.infrastructure`) to keep the application-layer test file lint-imports-clean, following the exact convention Plan 25-02's own test established. 12 parametrized fine-grained cell assertions (`test_gate_chain_matrix_outcome`) plus 3 per-fixture tests proving the `shown` path round-trips through the unchanged Phase-24 `to_proposal_card_declaration()`/`derive_declared_response_schema` and that `record_candidate_outcome(..., "dismissed")` registers a cooldown that silences a later `evaluate()` call passed the same cooldown set, plus 1 top-level test that runs `build_spike_outcome_matrix()`, asserts every cell against the expected outcome, and prints a formatted fixture×scenario table (visible with `-s`) — 16 tests total, all green, no live Bedrock call, `uv run ruff check`/`uv run mypy`/`uv run lint-imports` all clean.

- **Task 2 — `25-SPIKE-FINDINGS.md` (D-03 exit criterion):** Wrote the phase's actual deliverable. `## Verdict` states `ship-with-conditions` with a 4-sentence justification: the mechanism is sound and structurally false-positive-averse (both gates default to suppression, a judge error suppresses, the flag defaults OFF, independence is proven), but live measurement, durable persistence, and live UI wiring are unproven. `## What was built` names every file across Plans 25-01/25-02 and ties each to its D-XX decision. `## Evidence (fixture matrix)` transcribes the Task-1 harness's exact 3×4 outcome table (dated 2026-07-06, citing `test_build_spike_outcome_matrix_matches_expected_and_prints_evidence`) plus prose on false-positive-suppression behavior, cap independence/cost posture, and intrusiveness posture. `## Seams a shippable feature needs` numbers 7 concrete deferrals (live-Bedrock scoring, durable cap/lifecycle persistence, the live observation adapter, live web wiring, dismissal-cooldown durability, cross-conversation context, learned triggers), each traced to a CONTEXT Deferred Idea or a D-XX decision. `## Risks & open questions` documents the chosen tuning values (0.75 appropriateness threshold, 45s idle threshold, 1-per-10min + 3-per-day caps) with their settings.py-documented rationale, plus judge-cost-at-scale and cap-persistence risk. A final `## What this spike did NOT prove` section states plainly: no live Bedrock call was ever made, no real false-positive rate was measured, the choice of the three starter triggers was never validated against usage data, and no UI/UX was ever rendered to a browser.

## Task Commits

Each task was committed atomically:

1. **Task 1: deterministic end-to-end spike harness** — `8d960fa` (test)
2. **Task 2: 25-SPIKE-FINDINGS.md go/no-go verdict** — `3638e07` (docs)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/email-listener/app/application/use_cases/__tests__/test_anticipatory_spike_harness.py` — 16 tests: 12-cell parametrized matrix (`test_gate_chain_matrix_outcome`), 3-fixture proposal-card/cooldown test, 1 evidence-matrix print/assert test; exports `build_spike_outcome_matrix()`
- `.planning/phases/25-anticipatory-prompting-spike/25-SPIKE-FINDINGS.md` — the D-03 deliverable: verdict + what-was-built + evidence table + 7 named seams + risks + what-was-not-proven

## Decisions Made

See `key-decisions` in frontmatter. Summarized: verdict is `ship-with-conditions` (not a bare `ship`) because the mechanism proof and the live-readiness proof are different claims and only the first is substantiated; the harness's scenario set matches the plan's literal A/B/C/D definitions rather than re-deriving Plan 25-02's daily-ceiling edge case; the findings name 7 seams (2 more than the plan's literal minimum of 5) by also surfacing the CONTEXT deferred ideas on cross-conversation context and learned triggers, since both are directly relevant to a ship/no-ship call even though the plan's action text didn't enumerate them.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria (pytest matrix green with `-s` print, `25-SPIKE-FINDINGS.md`'s structural grep checks, ruff/mypy/lint-imports clean, `packages/genui/src/renderer/spec-renderer.tsx` untouched) passed on first attempt with no auto-fixes required.

## Issues Encountered

None.

## User Setup Required

None. No new dependencies; no settings changes. `ANTICIPATORY_PROMPTING_ENABLED` remains `False` — this plan only adds a test module and a findings document, neither of which touches runtime code paths.

## Known Stubs

None that block ANTIC-01/ANTIC-02's spike-level completion. This plan's own findings doc explicitly and honestly documents what is NOT production-ready (the in-memory cap store, the stubbed judge, the absence of a live observation adapter and live web wiring) — these are named, tracked seams in `25-SPIKE-FINDINGS.md`'s "Seams a shippable feature needs" section, not hidden gaps. The spike's exit criterion (D-03) is a documented decision, not a shipped guarantee, and this plan delivers exactly that.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated:
- T-25-08 — `25-SPIKE-FINDINGS.md` cites only fixture-derived, synthetic outcomes (the harness's `build_spike_outcome_matrix()`) — no real user chat content or PII anywhere in the findings doc.
- T-25-SC — no package-manager installs in this plan; the harness composes only existing Plan 25-01/25-02 modules.

## Next Phase Readiness

- **Phase 25 (ANTIC-01, ANTIC-02) is now fully complete.** All three plans (25-01, 25-02, 25-03) executed; the SPIKE's exit criterion (D-03 — a documented go/no-go recommendation) is met via `25-SPIKE-FINDINGS.md`'s `ship-with-conditions` verdict.
- **v1.3 milestone (Phases 22-25) has all plans executed.** This was the last plan of the last phase in the v1.3 roadmap — the milestone is ready for milestone-level verification/audit, not further phase planning.
- The 7 named seams in `25-SPIKE-FINDINGS.md` are the concrete backlog for a future "ship anticipatory prompting for real" phase, should the project choose to act on the `ship-with-conditions` verdict: (1) live-Bedrock appropriateness scoring + false-positive-rate study, (2) durable cap/lifecycle persistence off `chat_run_events`, (3) a live observation adapter over real Phase-22/23/24 state, (4) live web wiring into the Phase-24 proposal-card emit path, (5) dismissal-cooldown durability across reload, (6) cross-conversation context, (7) learned/ML trigger models.
- `packages/genui/src/renderer/spec-renderer.tsx` confirmed untouched across both commits in this plan (`git status --short` empty for that path) — trivially satisfied since this plan only adds a Python test file and a markdown findings doc.

---
*Phase: 25-anticipatory-prompting-spike*
*Completed: 2026-07-06*

## Self-Check: PASSED

Both created files confirmed present on disk (`test_anticipatory_spike_harness.py`,
`25-SPIKE-FINDINGS.md`). Both commits (`8d960fa`, `3638e07`) confirmed present in
`git log --oneline`. `apps/email-listener` targeted pytest:
`app/application/use_cases/__tests__/test_anticipatory_spike_harness.py` — 16/16 green
(`--no-cov -s`, matrix printed). Full `app/` regression suite — 146/146 green (`--no-cov`).
`uv run ruff check`, `uv run mypy`, and `uv run lint-imports` all clean on the new test file.
`25-SPIKE-FINDINGS.md` structural checks confirmed: `## Verdict` section present, first
content line is exactly `ship-with-conditions`; `## Evidence (fixture matrix)` section
present with a markdown table naming all three fixtures; `## Seams a shippable feature
needs` section present with 7 numbered items; zero fenced code blocks in the document.
`packages/genui/src/renderer/spec-renderer.tsx` confirmed untouched (`git status --short`
empty for that path across this plan's commits).
