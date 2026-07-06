---
phase: 25-anticipatory-prompting-spike
plan: 02
subsystem: python-application
tags: [anticipatory-prompting, spike, appropriateness-eval, frequency-cap, explicit-accept, gate-chain]

# Dependency graph
requires:
  - "Plan 25-01: ANTICIPATORY_PROMPTING_ENABLED flag + settings tunables, AnticipatoryCandidate/AnticipatoryStateSnapshot/AnticipatoryLifecycleEvent contracts, run_triggers"
provides:
  - "AppropriatenessJudge + AnticipatoryCapStore domain ports (app.domain.ports.anticipatory_ports) — D-08 independent gate ports"
  - "BedrockAppropriatenessJudgeAdapter — Haiku forced-tool-use appropriateness judge, fail-toward-suppress (D-07/D-09)"
  - "InMemoryAnticipatoryCapStore — D-14 no-new-table frequency-cap spike adapter"
  - "StubAppropriatenessJudge — deterministic test double for fixture-driven tests (D-09)"
  - "EvaluateAnticipatoryCandidates use case — the gate-chain + to_proposal_card_declaration + record_candidate_outcome (D-08/D-11/D-13)"
  - "Dark DI wiring in container.py — AppropriatenessJudge/AnticipatoryCapStore/EvaluateAnticipatoryCandidates registered, flag OFF (D-01/D-12)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Independent gate ordering as a cost optimization, not a substitution (D-08): the free frequency-cap check runs BEFORE the paid appropriateness-eval call so a capped candidate never bills a Bedrock call, but a cap denial is never overridden by what the eval would have said — proven by a dedicated 'independence' test asserting all three outcomes for the SAME candidate."
    - "Fail-toward-suppress inversion of the code-island judge's fail-toward-first-candidate posture: BedrockAppropriatenessJudgeAdapter returns AppropriatenessScore(score=0.0, reason='judge_error_suppress') on ANY error/timeout/invalid output — the opposite safe default from GenuiCodeJudgeAdapter's best_index=0, because the two judges' failure directions carry opposite risk (a missed rank vs. an unwanted interruption)."
    - "Test-local Fake doubles instead of importing infrastructure adapters into application-layer tests (mirrors test_submit_widget_interaction.py's FakeChatWidgetInteractionRepository) — FakeAnticipatoryCapStore is defined inside test_evaluate_anticipatory_candidates.py rather than importing InMemoryAnticipatoryCapStore, keeping the 'Application does not import infrastructure' lint-imports contract clean; the real adapter is exercised only via container DI resolution in the infra test."
    - "D-11 explicit-accept mapping reuses the Phase-24 proposal-card shape verbatim (to_proposal_card_declaration -> derive_declared_response_schema('proposal_cards', ...)) with zero changes to run_chat_turn_widgets.py — the candidate's proposed_prompt_text becomes both the card's prompt (what the user reads) and the single option's value (what a click resolves to)."

key-files:
  created:
    - apps/email-listener/app/domain/ports/anticipatory_ports.py
    - apps/email-listener/app/domain/anticipatory/stubs.py
    - apps/email-listener/app/infrastructure/llm/anticipatory_judge_adapter.py
    - apps/email-listener/app/infrastructure/anticipatory/__init__.py
    - apps/email-listener/app/infrastructure/anticipatory/in_memory_cap_store.py
    - apps/email-listener/app/application/use_cases/evaluate_anticipatory_candidates.py
    - apps/email-listener/app/application/use_cases/__tests__/test_evaluate_anticipatory_candidates.py
    - apps/email-listener/app/infrastructure/llm/__tests__/test_anticipatory_judge_adapter.py
    - .planning/phases/25-anticipatory-prompting-spike/deferred-items.md
  modified:
    - apps/email-listener/app/container.py

key-decisions:
  - "D-14 (planner decision, executed as written): NO new DB table. Candidate lifecycle is recorded as AnticipatoryLifecycleEvent records mirroring ChatRunEvent's type+data shape and emitted via structlog only; the frequency cap's D-10 'survives reload' requirement is satisfied architecturally by the AnticipatoryCapStore PORT (a production adapter would project chat_run_events; the spike's InMemoryAnticipatoryCapStore is the minimal in-process stand-in, with seed() simulating a reloaded conversation)."
  - "Dismissal cooldowns are a flat set[TriggerId] passed by the caller into both record_candidate_outcome(...) and evaluate(..., cooldowns=...) rather than a new stateful registry class — the simplest shape that satisfies the plan's literal signature and the single-conversation test scope; a cooldown-suppressed candidate is filtered out BEFORE its 'proposed' event is even recorded (no seventh lifecycle token needed)."
  - "BedrockAppropriatenessJudgeAdapter's constructor 'threshold' parameter is stored and logged (would_pass=clamped>=threshold) for observability, but the actual pass/fail decision lives in EvaluateAnticipatoryCandidates.evaluate() (appropriateness_threshold is caller-supplied, per-call) — the adapter never makes the gating decision itself, keeping D-08's two independent gates cleanly separated at the use-case layer."

requirements-completed: [ANTIC-02]

# Metrics
duration: ~23min
completed: 2026-07-06
---

# Phase 25 Plan 02: Anticipatory Prompting Gate Chain (Appropriateness Eval + Frequency Cap) Summary

**Two independent gates — a Bedrock Haiku appropriateness judge that fails toward suppression (D-07) and an in-memory multi-window/day frequency cap (D-10) — both must pass before an `AnticipatoryCandidate` maps onto the unchanged Phase-24 proposal-card explicit-accept path (D-11), with every transition recorded as an ordered lifecycle event (D-13) and the whole pipeline dark by default (D-12) yet fully DI-constructible (D-01).**

## Performance

- **Duration:** ~23 min
- **Tasks:** 3/3 completed (Task 1 `type="auto"`; Task 2 `type="auto" tdd="true"`, RED then GREEN; Task 3 `type="auto"`)
- **Files created:** 9 (2 domain modules, 1 infra adapter + package marker, 1 in-memory cap store, 1 use case, 2 test files, 1 deferred-items log)
- **Files modified:** 1 (`container.py`)

## Accomplishments

- **Task 1 — Gate ports + Bedrock appropriateness judge + in-memory cap store + stub judge:** `anticipatory_ports.py` defines two domain-pure `Protocol`s — `AppropriatenessJudge` (gate #1, `score()` returning a frozen `AppropriatenessScore(score, reason)`) and `AnticipatoryCapStore` (gate #2, `count_shown()`/`record_shown()`, plus a frozen `CapDecision(allowed, reason)` result type used by the use case). `BedrockAppropriatenessJudgeAdapter` mirrors `GenuiCodeJudgeAdapter`'s forced-tool-use posture (hand-written `score_appropriateness` tool, `temperature=0`, `asyncio.timeout`, non-streaming `messages.create`, real-usage capture via a mirrored `_extract_usage`) with the one deliberate inversion the plan called for: on ANY error, timeout, or invalid output it returns `AppropriatenessScore(score=0.0, reason="judge_error_suppress")` — never the "safe default = first candidate" posture the code-island judge uses. `InMemoryAnticipatoryCapStore` is the D-14 no-new-table spike adapter (`conversation_id -> list[float]` shown timestamps, plus a `seed()` helper for fixture-driven "reloaded conversation" tests). `StubAppropriatenessJudge` gives deterministic fixture tests a scriptable judge double with zero Bedrock calls (D-09).

- **Task 2 — EvaluateAnticipatoryCandidates gate chain (TDD, D-08/D-10/D-11/D-12/D-13):** Wrote `test_evaluate_anticipatory_candidates.py` first (RED — confirmed via a real `ModuleNotFoundError`, commit `9e8910a`), then implemented `evaluate_anticipatory_candidates.py` (GREEN, commit `adcd969`). `EvaluateAnticipatoryCandidates.evaluate()` short-circuits to an empty result before even calling `run_triggers` when `enabled=False` (D-12). For every candidate `run_triggers` proposes (minus any trigger_id already in the caller-supplied `cooldowns` set), it appends a `proposed` event, then checks the frequency cap FIRST — a free check, both the per-window and per-day ceilings independently enforced — and only calls the paid Bedrock judge when the cap has room; a cap denial never bills the judge and is never overridden by what the eval would have said (the module docstring documents this ordering as a cost optimization, not a substitution, per D-08). `to_proposal_card_declaration()` maps a survivor onto `{"options": [{"id": "opt-0", "title": ..., "value": candidate.proposed_prompt_text}], "prompt": candidate.proposed_prompt_text}`, verified to round-trip through the UNCHANGED `derive_declared_response_schema("proposal_cards", ...)` from `run_chat_turn_widgets.py`. `record_candidate_outcome()` appends `accepted`/`dismissed` events; a `dismissed` outcome mutates the caller's `cooldowns` set so a later `evaluate()` call for the same conversation skips that trigger_id entirely. 9 tests cover: both gates pass -> shown + `record_shown` called once; cap-full suppresses even with a passing score; a below-threshold score suppresses even with cap room; a single "independence" test proving the SAME candidate resolves to all three outcomes purely as a function of which input changes; the daily ceiling suppressing even with window room; the proposal-card round-trip; accepted/dismissed recording + the dismissal cooldown suppressing a subsequent evaluation; and the flag-OFF short-circuit (using judge/cap-store doubles that raise `AssertionError` if ever called).

- **Task 3 — Judge adapter unit tests + light DI wiring + dark-pipeline boot smoke test (D-01):** Added `test_anticipatory_judge_adapter.py` (12 tests) asserting the `score_appropriateness` tool's Bedrock-valid schema (`type: object`, `additionalProperties: false`, no root `$ref`), score parsing + clamping into `[0, 1]`, and — critically — that a raised exception AND a timeout both resolve to `AppropriatenessScore(score=0.0, reason="judge_error_suppress")` rather than propagating. Added `_extract_usage()` to the adapter (mirroring `GenuiCodeJudgeAdapter`'s D-22 idiom, not present in the initial Task 1 cut) so `response.usage` is read and logged on every parse branch, including the no-tool-use fallback — verified by patching the module logger and inspecting `input_tokens`/`output_tokens` in the log kwargs. Registered `_provide_anticipatory_judge` (-> `AppropriatenessJudge`), `InMemoryAnticipatoryCapStore` (-> `AnticipatoryCapStore`, one APP-scoped singleton), and `_provide_evaluate_anticipatory_candidates` (-> `EvaluateAnticipatoryCandidates`) in `container.py`, mirroring the existing `_provide_genui_code_judge_adapter` factory pattern. A boot smoke test resolves all three from `create_container()` (patching `get_supabase_client`/`get_anthropic_client`/`boto3`, the existing `tests/test_container.py` convention) and asserts `get_settings().ANTICIPATORY_PROMPTING_ENABLED is False`. Separately verified via a direct script that `app.main.create_app()` itself boots cleanly with the dark pipeline registered and the flag OFF. Confirmed the two existing widget-interaction regression suites (`test_run_chat_turn_interactive_widget.py`, `test_submit_widget_interaction.py`) and the full `tests/test_container.py` suite stay green (102 tests total across `app/` + `tests/test_container.py`).

## Task Commits

Each task was committed atomically:

1. **Task 1: gate ports + judge/cap-store adapters + stub judge** — `75ca918` (feat)
2. **Task 2 RED: failing tests for the gate chain** — `9e8910a` (test)
2. **Task 2 GREEN: EvaluateAnticipatoryCandidates implementation** — `adcd969` (feat)
3. **Task 3: judge unit tests + DI wiring** — `d861c7c` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

Task 2 carries `tdd="true"`. Gate sequence verified in `git log --oneline`: `test(25-02): add failing tests for EvaluateAnticipatoryCandidates gate chain` (`9e8910a`) precedes `feat(25-02): implement EvaluateAnticipatoryCandidates gate chain` (`adcd969`), with no intervening unrelated commits. RED was confirmed via a real collection error (`ModuleNotFoundError: No module named 'app.application.use_cases.evaluate_anticipatory_candidates'`) before any implementation existed. No REFACTOR-phase commit was needed (the GREEN implementation needed no follow-up cleanup). Compliant. (Tasks 1 and 3 have no `tdd` attribute — single `feat` commits are correct per the plan.)

## Files Created/Modified

- `apps/email-listener/app/domain/ports/anticipatory_ports.py` — `AppropriatenessJudge`/`AnticipatoryCapStore` Protocols + `AppropriatenessScore`/`CapDecision` frozen result types
- `apps/email-listener/app/domain/anticipatory/stubs.py` — `StubAppropriatenessJudge` deterministic test double
- `apps/email-listener/app/infrastructure/llm/anticipatory_judge_adapter.py` — `BedrockAppropriatenessJudgeAdapter` (fail-toward-suppress, D-07/D-09)
- `apps/email-listener/app/infrastructure/anticipatory/__init__.py` — new package marker
- `apps/email-listener/app/infrastructure/anticipatory/in_memory_cap_store.py` — `InMemoryAnticipatoryCapStore` (D-14 spike adapter)
- `apps/email-listener/app/application/use_cases/evaluate_anticipatory_candidates.py` — `EvaluateAnticipatoryCandidates` + `AnticipatoryPipelineResult` + `to_proposal_card_declaration` + `record_candidate_outcome`
- `apps/email-listener/app/application/use_cases/__tests__/test_evaluate_anticipatory_candidates.py` — 9 tests (incl. a local `FakeAnticipatoryCapStore` double)
- `apps/email-listener/app/infrastructure/llm/__tests__/test_anticipatory_judge_adapter.py` — 12 tests (schema, parsing, fail-toward-suppress, usage capture, container boot smoke test)
- `apps/email-listener/app/container.py` — `_provide_anticipatory_judge` + `_provide_evaluate_anticipatory_candidates` factories, 3 new provider registrations
- `.planning/phases/25-anticipatory-prompting-spike/deferred-items.md` — logs 12 pre-existing, out-of-scope mypy errors surfaced transitively via `container.py`'s import graph

## Decisions Made

See `key-decisions` in frontmatter. Summarized: D-14 executed exactly as the planner specified (no new DB table, lifecycle events + structlog only, cap state behind the port); dismissal cooldowns are a plain caller-owned `set[TriggerId]` rather than a new stateful registry class; the judge adapter's `threshold` constructor param is observability-only (logged, not gating) — the actual appropriateness-threshold decision stays in the use case per D-08's separation of concerns.

## Deviations from Plan

**1. [Rule 2 - missing critical functionality] Added real-usage capture (`_extract_usage`) to `BedrockAppropriatenessJudgeAdapter`, not called out in Task 1's action text.**
- **Found during:** Task 3, while writing the acceptance-criteria-mandated test "assert `response.usage` is read when present."
- **Issue:** Task 1's action text specified the judge's error-handling inversion in detail but never mentioned reading `response.usage` — yet Task 3's own acceptance criteria explicitly requires it (mirroring the code-island judge's D-22 usage-capture posture referenced in the plan's `<interfaces>` block).
- **Fix:** Added a module-level `_extract_usage()` (byte-for-byte mirroring `GenuiCodeJudgeAdapter`'s idiom) and threaded `input_tokens`/`output_tokens` into every log call in `_parse_response` (success, invalid-score, parse-failed, and no-tool-use branches) — no new fields on `AppropriatenessScore` itself (kept exactly as Task 1's port defined it: `score` + `reason` only); usage is observability-only, not part of the gating contract.
- **Files modified:** `apps/email-listener/app/infrastructure/llm/anticipatory_judge_adapter.py`
- **Commit:** `d861c7c`

**2. [Rule 1 - bug/contract fix] Test-local `FakeAnticipatoryCapStore` instead of importing `InMemoryAnticipatoryCapStore` into the application-layer test.**
- **Found during:** Task 2, running `uv run lint-imports` after the first GREEN pass.
- **Issue:** `test_evaluate_anticipatory_candidates.py` (under `app.application.use_cases.__tests__`) initially imported `InMemoryAnticipatoryCapStore` from `app.infrastructure.anticipatory` — this broke the "Application does not import infrastructure" contract (`lint-imports` reported it as BROKEN), a contract the plan's own acceptance criteria for Task 2 requires clean.
- **Fix:** Defined `FakeAnticipatoryCapStore` locally in the test file (identical behavior, no cross-layer import), mirroring `test_submit_widget_interaction.py`'s existing `FakeChatWidgetInteractionRepository` convention. The real `InMemoryAnticipatoryCapStore` is still exercised — via Task 3's container DI-resolution test.
- **Files modified:** `apps/email-listener/app/application/use_cases/__tests__/test_evaluate_anticipatory_candidates.py`
- **Commit:** `adcd969`

## Issues Encountered

None beyond the two deviations above (both resolved inline, no blockers).

## User Setup Required

None. No new dependencies; the feature flag stays OFF (`ANTICIPATORY_PROMPTING_ENABLED=False` by default, confirmed via both `get_settings()` and a live `create_app()` boot) — no environment variable needs to be set for this plan's code to stay dark in every deployed environment.

## Known Stubs

None that block ANTIC-02. This plan is deliberately "real but dark" (D-01) — the gate chain, judge adapter, and cap store are fully working code, not stubs; `StubAppropriatenessJudge` is an intentional, documented test double for deterministic fixture-driven tests (D-09), not a placeholder standing in for missing production code. The one deliberately non-production piece is `InMemoryAnticipatoryCapStore` itself (D-14, explicitly planner-approved): it does not survive a process restart. This is documented as the persistence seam Plan 25-03's findings must call out, not hidden.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated — all six dispositions implemented exactly as planned:
- T-25-01 — a shown candidate only ever becomes a `to_proposal_card_declaration()` return value; nothing in this plan invokes a turn or any side effect beyond the two gate ports. Proven by `test_flag_off_short_circuits_everything` and the fact that `record_candidate_outcome` is the only path that ever appends `accepted`.
- T-25-02 — flag OFF -> zero judge calls (`test_flag_off_short_circuits_everything` uses judge/cap-store doubles that raise `AssertionError` if called); the free cap check runs before the paid judge call; `max_tokens=256` + `asyncio.timeout` on the judge (D-09).
- T-25-03 — `_build_context_summary()` passes only counts/booleans (never `last_user_text` or any message body) to the judge; verified by reading the implementation and by the fact no test constructs a summary containing raw fixture user text.
- T-25-04 — accepted, as planned (spike-level structlog + returned events; no `chat_run_events` write path in this plan).
- T-25-07 — the independence test (`test_independence_same_candidate_three_outcomes`) proves the SAME candidate resolves to all three outcomes purely as a function of (score, cap) — no substitution path exists.
- T-25-SC — no package-manager installs in this plan; reuses the existing `anthropic`/Bedrock client and `structlog`.

## Next Phase Readiness

- Plan 25-03's findings harness can construct `EvaluateAnticipatoryCandidates` directly with `StubAppropriatenessJudge` + `InMemoryAnticipatoryCapStore` (both first-class importable modules) to drive the full gate chain deterministically against the Plan 25-01 fixtures, and read back `AnticipatoryPipelineResult.events` for the false-positive-rate evidence.
- The `InMemoryAnticipatoryCapStore` persistence seam (D-14) is the one item Plan 25-03's findings doc must explicitly call out as deferred to a real chat_run_events projection.
- `packages/genui/src/renderer/spec-renderer.tsx` and `apps/web/**` confirmed untouched across every commit in this plan (`git diff --stat` empty for both paths across the full commit range) — trivially satisfied since this plan is backend-only.
- 12 pre-existing mypy errors (unrelated to this plan, surfaced only because `container.py` transitively imports the affected modules) are logged in `deferred-items.md` for a future cleanup pass — confirmed present before this plan's changes via `git stash`.

---
*Phase: 25-anticipatory-prompting-spike*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 9 created files + 1 modified file confirmed present on disk. All 4 commits
(`75ca918`, `9e8910a`, `adcd969`, `d861c7c`) confirmed present in
`git log --oneline`. `apps/email-listener` targeted pytest: 21/21 green
(9 gate-chain + 12 judge-adapter tests, `--no-cov` per project convention);
broader regression run (`app/` + `tests/test_container.py`) — 102/102 green.
`uv run ruff check app/` clean. `uv run lint-imports` — 3 contracts kept, 0
broken. `uv run mypy` on this plan's own new/modified files reports only 12
pre-existing errors in unrelated files reached transitively via
`container.py`'s import graph (confirmed present before this plan via
`git stash`; logged in `deferred-items.md`, not fixed per SCOPE BOUNDARY).
`create_app()` boots live with the dark pipeline registered and
`ANTICIPATORY_PROMPTING_ENABLED` confirmed `False`. `packages/genui` and
`apps/web` confirmed untouched (`git diff --stat` empty across the full
commit range).
