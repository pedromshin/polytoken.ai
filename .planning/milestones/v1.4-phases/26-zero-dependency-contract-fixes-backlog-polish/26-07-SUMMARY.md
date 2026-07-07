---
phase: 26-zero-dependency-contract-fixes-backlog-polish
plan: 07
subsystem: genui
tags: [python, bedrock, prompt-engineering, genui, declared-state, pytest]

# Dependency graph
requires:
  - phase: 26-zero-dependency-contract-fixes-backlog-polish (plans 01-06)
    provides: FIX-01..11 UI chrome corrections on /chat + /studio (no overlap with this plan's files)
provides:
  - Generator system prompt teaches dataRef-bound list/conditional state display
  - Generator system prompt clarifies setState absolute-vs-increment semantics
  - Regression test locking the prompt-guidance contract (RED->GREEN)
affects: [genui-generator, future-generation-quality-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generator-prompt-only fix: teach a schema affordance that already exists in the
      (locked) renderer/schema instead of touching renderer/schema code"

key-files:
  created: []
  modified:
    - apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
    - apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py

key-decisions:
  - "Left packages/genui/artifacts/genui-prompt.json untouched (plan marked this discretionary/optional) — all acceptance criteria satisfied via _SYSTEM_PROMPT_TEXT alone"
  - "Renamed the new test to test_system_prompt_teaches_dataref_state_binding (lowercase) to satisfy ruff N802; pytest -k matching is case-insensitive so the plan's -k dataRef_state_binding verify command still resolves it"

patterns-established:
  - "Deterministic prompt-content assertion as a proxy for live-LLM behavioral tests: when the real assertion requires a live Bedrock call (out of offline-CI scope), assert the guidance text itself is present in the built system prompt block instead"

requirements-completed: [POLISH-01]

# Metrics
duration: ~15min
completed: 2026-07-06
---

# Phase 26 Plan 07: Generator dataRef State-Binding Prompt Summary

**Taught the declarative genui generator's system prompt to bind declared-state display through `dataRef`-bound `list`/`conditional` nodes instead of an uninterpolated `{{mustache}}` text literal, and clarified `setState`'s absolute-vs-increment semantics — a prompt-only fix with zero renderer/schema changes.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-06T22:07:16Z
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- `_SYSTEM_PROMPT_TEXT` now explicitly instructs the generator: to reflect a `state` value,
  bind through a `dataRef: 'state.<name>'`-bound `list` (iterate an array) or `conditional`
  (branch via `eq`/`neq`/`gt`/`lt`/`truthy`/`falsy`, each branch a plain `text` node with
  realistic static copy) — and NEVER put a `{{mustache}}` placeholder inside a `text`
  node's `content` (the renderer never interpolates it).
- Clarified `setState` semantics: a `state` entry's `actions[]` array declares named
  mutations (`toggle`/`set`/`reset`/`increment`/`decrement`); a button's
  `onClick: {type:'setState', key, value}` fires the action named `key` (must match
  `actions[].name`, NOT the state's own `name`); `increment`/`decrement` always change
  by exactly ±1 and ignore any `value` on the button; `set` uses the button's `value` if
  given, else the action's own configured `value`; the display node's `dataRef` must
  target the same `state.<name>` the setState action mutates.
- Added a RED->GREEN regression test (`test_system_prompt_teaches_dataref_state_binding`)
  that asserts the built `_build_system_blocks()` text contains this guidance — a
  deterministic proxy for the live "counter bound to state renders live, not as a static
  literal" behavior (which requires a live Bedrock call, out of offline-CI scope).
- Full `test_genui_generator_adapter.py` suite: 25/25 passing, including the pre-existing
  byte-identical pack-agnostic `test_build_system_blocks_identical_regardless_of_pack` —
  confirming the new guidance is static and doesn't invalidate the `cache_control`
  ephemeral prefix (COST-01/D-21/T-17-21).
- Zero changes to `spec-renderer.tsx`, `render-node.tsx`, or `spec-schema.ts` — verified via
  `git diff --name-only | grep -Ec "spec-renderer|render-node|spec-schema"` returning `0`.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression test for declared-state binding guidance** - `6b4f637` (test)
2. **Task 2: GREEN — enrich the generator prompt with dataRef binding + setState semantics** - `3d3fb2d` (feat)

**Plan metadata:** (this commit) `docs(26-07): complete plan`

_Note: this is a plan-level TDD sequence (test -> feat), not per-task TDD; Task 1 committed the
failing test, Task 2 committed the prompt enrichment that turns it GREEN._

## Files Created/Modified

- `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` — `_SYSTEM_PROMPT_TEXT`
  extended with two new bullet rules (declared-state display via dataRef, setState semantics)
- `apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py` — new regression
  test `test_system_prompt_teaches_dataref_state_binding`

## Decisions Made

- **Skipped the optional `genui-prompt.json` catalog-reference mirror.** The plan marked this
  "discretionary" — all `must_haves`/acceptance criteria (grep for `dataRef`/`setState`/
  `conditional|list` in the adapter file, RED->GREEN test) are satisfiable via
  `_SYSTEM_PROMPT_TEXT` alone, so the second artifact was left untouched to minimize footprint
  and avoid touching a second trusted-content file unnecessarily.
- **Renamed the test function to lowercase** (`..._dataref_state_binding` instead of the plan's
  suggested `..._dataRef_state_binding`) to satisfy ruff's `N802` (function names must be
  lowercase) — this is a Rule-1 auto-fix scoped strictly to the new test I introduced. Verified
  `pytest -k dataRef_state_binding` (the plan's literal verify command, mixed-case) still
  resolves the renamed test — `-k` keyword matching is case-insensitive.
- **Split one compound `assert X and Y` in the new test into two asserts** to satisfy ruff's
  `PT018` (assertion should be broken into multiple parts) — again scoped only to lines I added;
  a pre-existing `PT018` violation elsewhere in the same test file (line 646, unrelated to this
  task) was left as-is per the scope-boundary rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint] Renamed new test function + split compound assertion to satisfy ruff**
- **Found during:** Task 1 (writing the RED regression test)
- **Issue:** `test_system_prompt_teaches_dataRef_state_binding` (mixed-case, as suggested by the
  plan's example name) triggers ruff `N802`; a compound `assert "increment" in x and "decrement"
  in x` triggers ruff `PT018`. Both violations were introduced only by my new test code.
- **Fix:** Renamed to `test_system_prompt_teaches_dataref_state_binding` (confirmed `pytest -k
  dataRef_state_binding` still matches, case-insensitively); split the compound assertion into
  two separate `assert` statements.
- **Files modified:** `apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py`
- **Verification:** `uv run ruff check` on both modified files shows zero *new* violations (the
  adapter file is fully ruff-clean; the test file's remaining ruff findings — PT023/PT001/N811/
  UP037/SIM105/one pre-existing PT018 at line 646 — all predate this plan and are out of scope
  per the executor's scope-boundary rule).
- **Committed in:** `6b4f637` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 lint, Rule 1)
**Impact on plan:** Purely cosmetic — no behavioral or test-coverage impact. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This is a pure prompt-content change to an
existing, already-deployed adapter; it takes effect on the next generator call with no
migration/config step.

## Next Phase Readiness

- POLISH-01 (999.8 option (a)) is complete. 999.8 option (b) — a `SpecRenderer` affordance for
  declared-state text interpolation — remains explicitly out of v1.4 scope (touches the locked
  renderer) per `26-UI-SPEC.md`.
- This was the last plan in Phase 26 (Zero-Dependency Contract Fixes + Backlog Polish, 7/7 plans
  complete: FIX-01..11 + POLISH-01). POLISH-02 (canvas auto-layout) was folded into an earlier
  plan per the phase's plan breakdown — confirm via `.planning/ROADMAP.md`/`STATE.md` before
  transitioning the phase.
- No blockers. The live-Bedrock behavioral verification (does a real "counter" generation now
  actually emit a `dataRef`-bound `conditional`/`list` node instead of `{{count}}`) remains a
  connected-env verification, consistent with this project's existing pattern of deferring
  live-LLM assertions (see STATE.md's Deferred Items from prior phases).

---
*Phase: 26-zero-dependency-contract-fixes-backlog-polish*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
- FOUND: apps/email-listener/tests/infrastructure/test_genui_generator_adapter.py
- FOUND: .planning/phases/26-zero-dependency-contract-fixes-backlog-polish/26-07-SUMMARY.md
- FOUND: commit 6b4f637 (test(26-07): RED regression test)
- FOUND: commit 3d3fb2d (feat(26-07): GREEN prompt enrichment)
