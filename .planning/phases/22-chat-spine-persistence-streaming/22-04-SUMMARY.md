---
phase: 22-chat-spine-persistence-streaming
plan: 04
subsystem: cost-governance
tags: [cost-ledger, circuit-breaker, decimal, fail-closed, genui, bedrock, supabase]

# Dependency graph
requires:
  - phase: 22-01 (chat data model)
    provides: chat_cost_ledger table (conversation_id/run_id SET NULL, execution_locus CHECK)
  - phase: 22-02 (multi-provider model system)
    provides: CHAT_MODEL_REGISTRY / ChatModel (price_in_per_mtok, price_out_per_mtok, execution_locus)
provides:
  - CostLedgerRepository port + SupabaseCostLedgerRepository adapter over chat_cost_ledger
    (best-effort record(), fail-closed sum_for_run/sum_for_conversation/sum_for_importer_day)
  - CostCircuitBreaker domain service — fail-closed pre-turn ALLOW/BLOCK gate + pure
    mid-stream should_abort signal, config-only caps (D-20/D-21)
  - COST_CAP_PER_TURN_USD / COST_CAP_PER_SESSION_USD / COST_CAP_PER_DAY_USD settings
  - D-22 usage-capture fix: GeneratorResult (declarative Call B) and GenuiCodeJudgeAdapter
    (JudgeResult) now carry real token usage into the existing GenerationEvent audit columns
affects: [22-06 (chat orchestration agent — wires CostCircuitBreaker into the turn loop),
  22-07 (SSE streaming endpoint — mid-stream should_abort check), cost-ledger-reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed cost gate: ambiguity or a ledger-sum error BLOCKs, never ALLOWs (T-22-14)"
    - "Config-only caps: CostCircuitBreaker's public methods accept zero cap parameters —
      raising a cap is exclusively a settings/env change (D-21)"
    - "Cumulative repair-loop usage capture: every real (billed) Bedrock call across a
      multi-attempt repair loop contributes to the turn's reported token total, not just
      the call that ultimately succeeds"
    - "int-shaped result → dataclass upgrade without breaking callers: JudgeResult replaces
      a bare int return, but call sites/tests were updated in the same commit rather than
      papered over with a magic int subclass"

key-files:
  created:
    - apps/email-listener/app/domain/ports/cost_ledger_repository.py
    - apps/email-listener/app/domain/services/cost_circuit_breaker.py
    - apps/email-listener/app/infrastructure/supabase/supabase_cost_ledger_repository.py
    - apps/email-listener/tests/test_cost_ledger_repository.py
    - apps/email-listener/tests/test_cost_circuit_breaker.py
  modified:
    - apps/email-listener/app/settings.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
    - apps/email-listener/app/infrastructure/llm/genui_code_judge_adapter.py
    - apps/email-listener/app/application/use_cases/generate_ui_spec.py
    - apps/email-listener/app/application/use_cases/generate_code_island.py
    - apps/email-listener/tests/infrastructure/test_genui_code_judge_adapter.py
    - apps/email-listener/tests/application/test_generate_code_island.py

key-decisions:
  - "Test files placed at the FLAT tests/ level (test_cost_ledger_repository.py,
    test_cost_circuit_breaker.py), not the plan's literal tests/unit/ path — repeats the
    same deviation 22-02 already made and documented: no tests/unit/ directory exists
    anywhere in this codebase; the established convention is flat tests/test_*.py for
    domain services/supabase adapters. Followed the precedent for consistency."
  - "sum_for_run/sum_for_conversation/sum_for_importer_day fetch rows and sum cost_usd in
    Python (Decimal) rather than a Postgres-side SUM aggregate — no existing supabase-py
    call in this codebase does server-side aggregation (only .rpc() for two bespoke
    functions elsewhere), and the ledger tables are small/per-importer-scoped, so a
    client-side sum is simple, portable, and easy to keep fail-closed (a query error
    propagates as an exception either way)."
  - "check_pre_turn's per-cap logic was split into private _session_cap_breached/
    _day_cap_breached helpers to satisfy ruff PLR0911 (too many returns) without
    changing behavior — pure refactor for readability, not a plan deviation."
  - "D-22 fix widened beyond the plan's literal files_modified list: the adapters alone
    exposing real usage on their result objects does not close the gap end-to-end — the
    calling use cases (generate_ui_spec.py, generate_code_island.py) were still discarding
    that usage before this plan (only quarantine's Call A tokens ever reached
    GenerationEvent). Updated both use cases to sum extraction + generator/judge tokens
    into the audit row, per the plan's own must_haves truth ('genui generator + judge
    token usage is no longer dropped') and Task 3's action text ('so the calling use
    cases populate GenerationEvent...with REAL counts'). Documented as a Rule 2
    (missing critical functionality) deviation below."
  - "GenuiCodeJudgeAdapter.rank() return type changed from a bare int to a frozen
    JudgeResult(best_index, input_tokens, output_tokens) dataclass — the only way to
    surface real usage on 'the adapter's result object' per the task's own wording,
    since rank() previously had no result object to attach tokens to. All call sites
    (generate_code_island.py) and the existing test suites (test_genui_code_judge_adapter.py,
    test_generate_code_island.py) were updated in the same commit; all pre-existing
    test assertions were preserved 1:1 (only `result == N` → `result.best_index == N`)."
  - "genui_code_generator_adapter.py's own usage-capture gap (noted as an aside in the
    plan's <interfaces> section: 'streams but also drops usage') is explicitly OUT OF
    SCOPE for Task 3 — the plan's action/read_first/acceptance_criteria name only
    genui_generator_adapter.py and genui_code_judge_adapter.py. Left untouched;
    GenerateCodeIslandUseCase's audit row therefore still under-counts the code-island
    winning candidate's own generation tokens (the largest spend in that pipeline)."

requirements-completed: [STREAM-03]

# Metrics
duration: ~25min
completed: 2026-07-03
---

# Phase 22 Plan 04: Cost Circuit Breaker Summary

**A fail-closed application-level cost circuit breaker (ledger port + Supabase adapter + CostCircuitBreaker domain service, config-only $0.50/$2.00/$5.00 per-turn/session/day caps) plus the D-22 fix that stops the genui declarative generator and code-island judge from silently dropping real token usage into the audit ledger.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03T16:50:00-03:00 (approx)
- **Completed:** 2026-07-03T17:15:04-03:00
- **Tasks:** 3/3 completed
- **Files modified:** 13 (5 created, 8 modified)

## Accomplishments

- **CostLedgerRepository port + SupabaseCostLedgerRepository adapter** over `chat_cost_ledger`: `record()` is best-effort (mirrors the generation-audit repo's swallow-and-log contract); `sum_for_run`/`sum_for_conversation`/`sum_for_importer_day` deliberately **propagate** errors (T-22-14 fail-closed) instead of swallowing them, so the breaker can never mistake a failed query for a zero-cost turn.
- **CostCircuitBreaker domain service**: `estimate_turn_cost` (registry per-Mtok pricing), `check_pre_turn` (fail-closed ALLOW/BLOCK with the specific breached cap name — `per_turn`/`per_session`/`per_day` — checked in that order, cheapest-first), and a pure `should_abort(running_cost)` mid-stream signal. Caps are constructor-only (from settings); no public method accepts a cap parameter (D-21 — verified both by the plan's own grep check and a structural test asserting no method signature contains a "cap" parameter).
- **Cap settings**: `COST_CAP_PER_TURN_USD`/`COST_CAP_PER_SESSION_USD`/`COST_CAP_PER_DAY_USD` (defaults 0.50/2.00/5.00, D-20), env-overridable, wired through Dishka.
- **D-22 usage-capture fix**: `GeneratorResult` (the declarative Call B path) now accumulates real `input_tokens`/`output_tokens` across every repair-loop attempt (up to 3 real Bedrock calls per turn) instead of defaulting to 0. `GenuiCodeJudgeAdapter.rank()` now returns a `JudgeResult` carrying the ranking call's real usage. Both `GenerateUiSpecUseCase` and `GenerateCodeIslandUseCase` were updated to actually sum this into `GenerationEvent.input_tokens/output_tokens` — closing the gap all the way to the audit row, not just on the adapter's return value.

## Task Commits

Each task was committed atomically:

1. **Task 1: Cost ledger port + Supabase adapter + cap settings** - `604e663` (feat)
2. **Task 2: CostCircuitBreaker — fail-closed pre-turn gate + mid-stream abort check** - `589edc1` (feat)
3. **Task 3: Close the D-22 usage-capture gap in the genui generator + judge adapters** - `dd91dd2` (fix)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/email-listener/app/domain/ports/cost_ledger_repository.py` - `UsageEvent` frozen dataclass + `CostLedgerRepository` Protocol (record + 3 sum methods)
- `apps/email-listener/app/infrastructure/supabase/supabase_cost_ledger_repository.py` - Supabase adapter over `chat_cost_ledger`; `asyncio.to_thread` offload; best-effort insert, fail-closed sums
- `apps/email-listener/app/domain/services/cost_circuit_breaker.py` - `CostCircuitBreaker` + `PreTurnDecision` + `estimate_prompt_tokens` heuristic helper
- `apps/email-listener/app/settings.py` - three `COST_CAP_*_USD` settings
- `apps/email-listener/app/container.py` - Dishka factories for `CostLedgerRepository` and `CostCircuitBreaker`
- `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` - `GeneratorResult.input_tokens/output_tokens` (cumulative across repair-loop attempts) + `_extract_usage` helper
- `apps/email-listener/app/infrastructure/llm/genui_code_judge_adapter.py` - `JudgeResult` dataclass replaces `rank()`'s bare-int return; `_extract_usage` helper
- `apps/email-listener/app/application/use_cases/generate_ui_spec.py` - audit event now sums extraction + generator tokens
- `apps/email-listener/app/application/use_cases/generate_code_island.py` - `_select_winner` returns judge tokens too; audit event sums extraction + judge tokens
- `apps/email-listener/tests/test_cost_ledger_repository.py` - 12 tests (insert mapping, browser-locus $0 cost, best-effort swallow vs. fail-closed propagate)
- `apps/email-listener/tests/test_cost_circuit_breaker.py` - 17 tests (estimate math, ALLOW/BLOCK per cap, ledger-failure fail-closed, should_abort boundary, no-cap-parameter structural guards)
- `apps/email-listener/tests/infrastructure/test_genui_code_judge_adapter.py` - updated to `JudgeResult.best_index`; 2 new usage-capture tests
- `apps/email-listener/tests/application/test_generate_code_island.py` - updated judge mocks to `JudgeResult`; asserts judge tokens reach the audit event

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:
- Test files follow this codebase's established flat `tests/test_*.py` convention (repeating 22-02's precedent) rather than the plan's literal `tests/unit/` path.
- Ledger sums are computed client-side in Python (`Decimal`) over selected rows rather than a Postgres-side aggregate, matching every other supabase-py query in this codebase.
- The D-22 fix was carried through to the use-case audit-event wiring (not just the adapters), because the plan's own must-have truth requires the gap closed, not merely exposed.
- `GenuiCodeJudgeAdapter.rank()`'s return type changed from `int` to `JudgeResult` — the cleanest way to attach usage to "the adapter's result object" without a magic int-subclass hack; all callers/tests updated in the same commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md/convention alignment] Test files placed at the flat `tests/` level, not `tests/unit/`**
- **Found during:** Task 1 (before writing the first test file)
- **Issue:** Plan frontmatter/`<verify>` specified `tests/unit/test_cost_ledger_repository.py` and `tests/unit/test_cost_circuit_breaker.py`, but no `tests/unit/` directory exists anywhere in this codebase (already documented as a repeat pattern in 22-02-SUMMARY.md).
- **Fix:** Created `tests/test_cost_ledger_repository.py` and `tests/test_cost_circuit_breaker.py` instead, and ran every plan-specified verification command against the equivalent path.
- **Files affected:** the two new test files.
- **Verification:** All plan-level `<verify>`/`<acceptance_criteria>` pytest commands re-run against the actual paths — all pass (12 + 17 new tests).
- **Committed in:** `604e663`, `589edc1`.

**2. [Rule 2 - Missing critical functionality] D-22 fix widened to the calling use cases**
- **Found during:** Task 3
- **Issue:** The plan's action text named only `genui_generator_adapter.py` + `genui_code_judge_adapter.py` in `files_modified`, but reading `generate_ui_spec.py`/`generate_code_island.py` showed both use cases were hardcoded to only forward the quarantine (Call A) extraction's tokens into `GenerationEvent` — even after the adapters started exposing real usage, that usage would still never reach the audit row, leaving the plan's own must-have truth ("genui generator + judge token usage is no longer dropped") unmet.
- **Fix:** Updated `GenerateUiSpecUseCase` to sum `extraction.input_tokens/output_tokens + gen_result.input_tokens/output_tokens`; updated `GenerateCodeIslandUseCase`'s `_select_winner` to also return the judge's real tokens and sum them with the extraction's into the audit event.
- **Files modified:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py`, `apps/email-listener/app/application/use_cases/generate_code_island.py` (plus their existing test suites, updated to match).
- **Verification:** `tests/application/test_generate_ui_spec.py` (already tolerant via `>=` assertions) and `tests/application/test_generate_code_island.py` (new explicit `event.input_tokens == 10 + 200` assertion) both pass; full targeted suite green (96 tests).
- **Committed in:** `dd91dd2` (Task 3 commit).

**3. [Rule 1 - Bug/structural fix] `rank()` return type changed from `int` to `JudgeResult`**
- **Found during:** Task 3
- **Issue:** `GenuiCodeJudgeAdapter.rank()` returns a bare `int` (`best_index`) with no result object to attach usage to. The plan's action text says to "surface [usage] on the adapters' result objects" — a bare int has none.
- **Fix:** Introduced a frozen `JudgeResult(best_index, input_tokens=0, output_tokens=0)` dataclass as `rank()`'s return type. Updated the one call site (`generate_code_island.py::_select_winner`) and both existing test files (`test_genui_code_judge_adapter.py`, `test_generate_code_island.py`) — every pre-existing test assertion was preserved 1:1 (`result == N` → `result.best_index == N`; `return_value=N` → `return_value=JudgeResult(best_index=N)`), so behavioral coverage is unchanged, only the access pattern.
- **Files modified:** `apps/email-listener/app/infrastructure/llm/genui_code_judge_adapter.py`, `apps/email-listener/app/application/use_cases/generate_code_island.py`, `apps/email-listener/tests/infrastructure/test_genui_code_judge_adapter.py`, `apps/email-listener/tests/application/test_generate_code_island.py`.
- **Verification:** All 22 judge-adapter tests + all `generate_code_island` tests pass; `uv run ruff check` + `uv run mypy` clean on both production files.
- **Committed in:** `dd91dd2` (Task 3 commit).

---

**Total deviations:** 3 auto-fixed (1 test-path convention repeat, 2 missing-critical-functionality/correctness fixes required to actually close the D-22 gap end-to-end). No architectural changes; no scope creep beyond what was needed to make the plan's own must-have truths true.
**Impact on plan:** All three deviations were necessary to satisfy the plan's explicit must_haves and acceptance intent — none introduce new features beyond what STREAM-03/D-22 already called for.

## Issues Encountered

- `mypy app/infrastructure/supabase/supabase_cost_ledger_repository.py` initially failed on `_sum_cost_column`'s parameter type (`list[dict[str, Any]] | None` vs. postgrest-py's actual `list[JSON]` return type). Fixed by typing the parameter `Any` with an explanatory docstring — the same underlying postgrest `JSON` typing gap already causes 3 pre-existing mypy errors in `supabase_ui_spec_template_repository.py` (confirmed pre-existing via a diff against the pre-Task-3 file state; out of scope per the Scope Boundary rule).
- `ruff` flagged `PLR0911` (too many returns) on the first draft of `check_pre_turn`; refactored the session/day cap checks into two private helper methods (`_session_cap_breached`/`_day_cap_breached`) — pure readability refactor, no behavior change.
- Confirmed (via `git show` against the pre-existing commit) that one `genui_generator_adapter.py` mypy error (`error_msg: str | None` assignment) predates this plan's changes entirely — not touched, left as-is (Scope Boundary).

## User Setup Required

None — no external service configuration required. All work is local/unit-tested against fakes/mocks (no live Bedrock/Supabase calls), consistent with this milestone's offline-testable autonomous-session pattern.

## Threat Flags

None beyond what the plan's `<threat_model>` already enumerated (T-22-12 through T-22-15) — all implemented exactly as dispositioned:
- T-22-12: per-turn/session/day caps enforced pre-turn (`check_pre_turn`) AND mid-stream (`should_abort`), independent of the AWS budget alert.
- T-22-13: no cap-parameter exists anywhere on `CostCircuitBreaker`'s public surface (verified by a structural test, not just a grep).
- T-22-14: every ledger sum-query failure blocks rather than allows; `record()`'s best-effort swallow is isolated to the write path only.
- T-22-15: `UsageEvent` carries `run_id` + `model_id` + `execution_locus` for provenance (FOUND-5), matching the schema's existing columns.

## Next Phase Readiness

- `CostCircuitBreaker` and `CostLedgerRepository` are DI-resolvable and ready for the chat orchestration agent (22-06) to call `check_pre_turn` before starting a turn and `should_abort` during streaming, then `record()` the real usage afterward.
- The D-22 gap is now closed for the declarative generator + code-island judge paths (audit rows carry real tokens); `genui_code_generator_adapter.py`'s own usage gap remains open and is explicitly out of this plan's scope — a future plan should close it the same way (accumulate usage in `CodeGeneratorResult`, thread into `GenerateCodeIslandUseCase`'s audit event).
- Chat-side adapters (`BedrockChatAdapter`/`OpenRouterChatAdapter` from 22-02) already capture usage natively via their own `UsageDelta` — the streaming turn loop (22-06/22-07) is the natural place to translate those deltas into `UsageEvent`/`CostLedgerRepository.record()` calls and to invoke `should_abort` per streamed chunk.

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 13 created/referenced source+test files confirmed present on disk; all three task commits (`604e663`, `589edc1`, `dd91dd2`) confirmed present in `git log --oneline --all`.
