---
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
plan: "02"
subsystem: genui-eval-harness
tags: [eval, rubric, deterministic, llm-as-judge, golden-set, bedrock]
dependency_graph:
  requires: [16-01]
  provides: [EVAL-03, EVAL-05]
  affects: [phases/17, phases/18, phases/19, phases/20]
tech_stack:
  added: []
  patterns:
    - "Pure deterministic rubric reusing production schema/bounds from genui_generator_adapter"
    - "LLM-as-judge via forced tool-use Bedrock call (escalation model, temperature=0)"
    - "Deferred infrastructure imports in CLI scripts (noqa: PLC0415)"
    - "Coverage scope fence: scripts/ outside --cov=app; runner does not affect 80% gate"
    - "Integration smoke test gated behind RUN_GENUI_EVAL=1 env var"
key_files:
  created:
    - apps/email-listener/scripts/__init__.py
    - apps/email-listener/scripts/genui_eval/__init__.py
    - apps/email-listener/scripts/genui_eval/rubric.py
    - apps/email-listener/scripts/genui_eval/judge_adapter.py
    - apps/email-listener/scripts/genui_eval/report.py
    - apps/email-listener/scripts/genui_eval/compare_reports.py
    - apps/email-listener/scripts/genui_eval/run_eval.py
    - apps/email-listener/scripts/genui_eval/reports/.gitkeep
    - apps/email-listener/tests/test_genui_eval_rubric.py
  modified: []
decisions:
  - "Deferred infrastructure imports inside run() and helpers with # noqa: PLC0415 to avoid Supabase/Bedrock initialization at import time"
  - "Integration smoke test uses skipif(not RUN_GENUI_EVAL) so it is collected-but-skipped in CI offline, passable with env var for harness wiring verification"
  - "Task 4 (live Bedrock baseline recording) deferred to connected-env run — harness is complete, no fake data recorded"
metrics:
  duration_minutes: 60
  completed_date: "2026-06-27"
  tasks_completed: 3
  tasks_deferred: 1
  files_created: 9
  files_modified: 0
  commits: 5
---

# Phase 16 Plan 02: Eval Harness Summary

Pure deterministic rubric (valid-spec, composed-not-placeholder, a11y, fixed weights 0.30/0.30/0.25/0.15) + LLM-as-judge adapter (escalation model, forced tool-use) + standalone runner driving the real GenerateUiSpecUseCase over the golden set, with report writer and compare helper; all unit/import-tested offline.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Pure rubric core tests | 3415615 | tests/test_genui_eval_rubric.py |
| 1 (GREEN) | Implement deterministic rubric | 7237ae7 | rubric.py, scripts/__init__.py, genui_eval/__init__.py |
| 2 | Judge adapter + report + compare | c35d526 | judge_adapter.py, report.py, compare_reports.py |
| 3 | Eval runner + integration smoke | b304fa5 | run_eval.py, reports/.gitkeep, test file updated |
| 3 (fix) | Gate smoke test behind env var | 20abda1 | tests/test_genui_eval_rubric.py |

## Deferred (human/connected-env)

**Task 4: Record eval baseline against live Bedrock**

This task requires live Bedrock credentials (ECS task role / IAM) which are not available in the autonomous offline run.

**What to do when credentials are available:**
```bash
cd apps/email-listener
# Full baseline run (all golden prompts, LLM-as-judge):
uv run python -m scripts.genui_eval.run_eval --label baseline

# Optional fast pass (no judge, deterministic only):
uv run python -m scripts.genui_eval.run_eval --label baseline --no-judge

# Optional smoke subset first:
uv run python -m scripts.genui_eval.run_eval --label baseline --limit 5
```

**Verify:** `scripts/genui_eval/reports/` contains `<date>-baseline.json` + `<date>-baseline.md` with registry_version, judge model id, weights/thresholds, per-prompt rows, and run aggregates.

**Then commit the baseline report** — it is the artifact Phases 17-20 measure against (D-12/D-13: recorded, NOT a hard CI gate).

The harness itself is fully built and offline-verified. Only the live-Bedrock run is pending.

## Verification Results

- `uv run pytest tests/test_genui_eval_rubric.py -v --no-cov`: 20 passed, 1 skipped (integration smoke gated)
- `RUN_GENUI_EVAL=1 uv run pytest tests/test_genui_eval_rubric.py::test_run_eval_offline_writes_report -v --no-cov`: 1 passed
- `uv run pytest -q --cov=app --cov-fail-under=80`: 87.02% coverage - gate holds
- `uv run ruff check scripts/genui_eval/*.py tests/test_genui_eval_rubric.py`: All checks passed
- `uv run python -c "import scripts.genui_eval.run_eval; ..."`: all imports OK
- grep create_container in run_eval.py: present
- grep registryVersion in run_eval.py: present
- grep genui_escalation_model_id in judge_adapter.py: present
- grep Semaphore in run_eval.py: present
- grep "consider breaking this into components" in rubric.py: present
- grep "anthropic\|supabase\|boto3" in rubric.py: none (pure module, D-11)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ruff F401 unused imports in rubric.py**
- **Found during:** Task 1 GREEN
- **Issue:** `load_spec_schema`, `MAX_SPEC_DEPTH`, `MAX_SPEC_NODES` imported but unused (they're internal to `_validate_spec`)
- **Fix:** Removed the three unused imports, keeping only `_count_nodes` and `_validate_spec` which are directly used
- **Files modified:** rubric.py
- **Commit:** 7237ae7

**2. [Rule 1 - Bug] Ruff RUF001 Unicode dash characters in judge_adapter.py**
- **Found during:** Task 2
- **Issue:** EN DASH and EM DASH in string literals triggered RUF001
- **Fix:** Replaced with ASCII hyphens
- **Files modified:** judge_adapter.py
- **Commit:** c35d526

**3. [Rule 1 - Bug] Ruff PLC0415 top-level json import in judge_adapter.py**
- **Found during:** Task 2
- **Issue:** `import json` was inside `_call_model()` method body
- **Fix:** Moved to module-level imports
- **Files modified:** judge_adapter.py
- **Commit:** c35d526

**4. [Rule 1 - Bug] Ruff UP017 timezone.utc in report.py**
- **Found during:** Task 2
- **Issue:** `datetime.now(tz=timezone.utc)` used deprecated form
- **Fix:** Changed import to `from datetime import UTC, datetime` and used `UTC` directly
- **Files modified:** report.py
- **Commit:** c35d526

**5. [Rule 2 - Missing critical] Integration smoke test skipif gate**
- **Found during:** Task 3 verification
- **Issue:** Plan specifies test should be "SKIPPED unless RUN_GENUI_EVAL=1" per acceptance criteria; initial implementation ran unconditionally
- **Fix:** Added `@pytest.mark.skipif(not _RUN_EVAL, reason="Set RUN_GENUI_EVAL=1 ...")` decorator and `_RUN_EVAL` module constant
- **Files modified:** tests/test_genui_eval_rubric.py
- **Commit:** 20abda1

## Known Stubs

None — all rubric logic is fully implemented with production-identical semantics. The judge adapter, report writer, and compare helper are complete. The only deferred item is the live Bedrock baseline recording (Task 4), which is an operational action, not a code stub.

## Threat Flags

No new security-relevant surface introduced beyond what is in the plan's threat model. The eval harness:
- Makes no writes to the production database
- Has no HTTP endpoints
- Is a standalone script (not imported by app code)
- Reads only trusted corpus files (golden-set.json) and environment-provided settings

## Self-Check: PASSED

Files exist:
- apps/email-listener/scripts/genui_eval/rubric.py: FOUND
- apps/email-listener/scripts/genui_eval/judge_adapter.py: FOUND
- apps/email-listener/scripts/genui_eval/report.py: FOUND
- apps/email-listener/scripts/genui_eval/compare_reports.py: FOUND
- apps/email-listener/scripts/genui_eval/run_eval.py: FOUND
- apps/email-listener/scripts/genui_eval/reports/.gitkeep: FOUND
- apps/email-listener/tests/test_genui_eval_rubric.py: FOUND

Commits exist:
- 3415615: FOUND (test(16-02): add failing tests for rubric core)
- 7237ae7: FOUND (feat(16-02): implement deterministic rubric core)
- c35d526: FOUND (feat(16-02): add judge adapter, report writer, and compare helper)
- b304fa5: FOUND (feat(16-02): add eval runner with integration smoke test)
- 20abda1: FOUND (fix(16-02): gate integration smoke test behind RUN_GENUI_EVAL=1)
