---
phase: 17
plan: "05"
subsystem: genui-eval
tags: [style-metrics, wcag-a11y, brand-judge, eval-harness, tdd]
dependency_graph:
  requires: [17-04]
  provides: [style_metrics, brand-judge, all-packs-runner]
  affects: [rubric.py, judge_adapter.py, report.py, compare_reports.py, run_eval.py]
tech_stack:
  added: [style_metrics.py]
  patterns: [WCAG-AA contrast, Jaccard distinctiveness, RAG-02 retrieval overlap, forced tool_choice brand judge]
key_files:
  created:
    - apps/email-listener/scripts/genui_eval/style_metrics.py
    - apps/email-listener/tests/test_genui_eval_style.py
  modified:
    - apps/email-listener/scripts/genui_eval/rubric.py
    - apps/email-listener/scripts/genui_eval/judge_adapter.py
    - apps/email-listener/scripts/genui_eval/report.py
    - apps/email-listener/scripts/genui_eval/compare_reports.py
    - apps/email-listener/scripts/genui_eval/run_eval.py
decisions:
  - "style_metrics.py uses stdlib logging (not structlog) to preserve purity guarantee — no network imports"
  - "a11y() extended with backward-compat pack_token_values=None default — existing callers unaffected"
  - "brand judge result NOT folded into mean_overall (D-17 custom-not-generic separation)"
  - "docstring wording changed from naming network libs to 'No network library imports' to pass purity test"
metrics:
  duration_minutes: 90
  completed_date: "2026-06-28"
  tasks_completed: 3
  tasks_deferred: 1
  files_created: 2
  files_modified: 5
---

# Phase 17 Plan 05: Style Metrics, Brand Judge, and All-Packs Runner Summary

WCAG-AA contrast gate (D-09), Jaccard distinctiveness (D-16), brand alignment judge at temp=0 (D-17), additive style fields on EvalReport (D-15), a11y HARD-regression flag in compare_reports (D-18), and `--all-packs` runner with `aggregate_all_packs()` (D-19) — all implemented offline with 40 unit tests passing.

## Tasks Completed

| # | Task | Type | Commit | Status |
|---|------|------|--------|--------|
| 1 | WCAG-AA contrast metrics + a11y gate | TDD | RED: 56c4207, GREEN: b5afb33 | Done |
| 2 | Brand judge `score_brand()` | TDD | RED: 56c4207, GREEN: b5afb33 | Done |
| 3 | `--all-packs` runner + compare style signals | TDD | RED: 56c4207, GREEN: b5afb33 | Done |
| 4 | Connected-env live `--all-packs` eval | checkpoint | N/A | Deferred |

## Implementation Details

### Task 1 — style_metrics.py + rubric.py a11y gate

`style_metrics.py` is a pure deterministic module (no network imports):

- `wcag_contrast_ratio(fg_hsl, bg_hsl)` — relative luminance via HSL -> sRGB -> linear -> WCAG formula. Symmetric, range [1.0, 21.0].
- `passes_aa(fg_hsl, bg_hsl, *, large)` — checks ≥4.5:1 (normal) or ≥3.0:1 (large text).
- `resolve_node_contrast_pairs(spec, pack_token_values)` — walks spec nodes, finds fg/bg token alias pairs, resolves to HSL strings.
- `distinctiveness_score(spec_a, spec_b)` — Jaccard distance averaged over token-alias Counter and node-type Counter. Returns [0,1].
- `retrieval_overlap_ratio(spec, retrieved_ids)` — fraction of retrieved IDs whose type substring matches any node type in spec (len ≥ 3).
- `assert_retrieval_influence(*, ratio, floor, prompt_id)` — logs stdlib warning when below floor (0.25). Never raises.

`rubric.py` `a11y()` extended with `pack_token_values: dict[str, str] | None = None` (backward-compatible). When provided, resolves contrast pairs and fails immediately (score=0.0) if any pair fails AA — D-09 HARD gate.

### Task 2 — judge_adapter.py score_brand()

`score_brand(*, intent, spec, style_pack_id)` is a separate `JudgeAdapter` method with:

- Static system prompt `_BRAND_JUDGE_SYSTEM_PROMPT` — trusted content only, never f-string interpolated (T-17-31)
- Forced tool_choice `{"type": "tool", "name": "score_brand_alignment"}` with score [0,1] + rationale fields
- temperature=0 via escalation model (`_ESCALATION_MODEL_ID`)
- asyncio.timeout wrapper; score clamped to [0.0, 1.0]; returns `_FAILED_RESULT` on any exception — never raises
- Intent + spec go ONLY in the user turn (T-17-31 security constraint)
- Result NOT folded into mean_overall (D-17 custom-not-generic)

### Task 3 — report.py, compare_reports.py, run_eval.py

`PromptReport` gained 5 additive optional fields: `style_pack_id`, `a11y_contrast_passed`, `brand_score`, `distinctiveness`, `retrieval_overlap`. `EvalReport` gained 3 additive optional aggregate fields: `mean_brand_score`, `mean_distinctiveness`, `mean_retrieval_overlap`. Core 5 mean_* fields and JSON keys unchanged (D-15).

`compare_reports.py` adds:
- D-09/D-18 a11y HARD-regression flag: any negative a11y delta triggers `## A11Y HARD REGRESSION DETECTED` block (blocking)
- Style Signals section: brand score, distinctiveness, retrieval overlap delta table (shown only when data present)

`run_eval.py` adds:
- `aggregate_all_packs(prompt_reports)`: groups by `style_pack_id`, computes per-pack `mean_overall` + `cross_pack_mean_distinctiveness`
- `--style-pack PACK_ID` / `--all-packs` CLI args
- `_eval_prompt()` now threads `style_pack_id`, calls `retrieval_overlap_ratio`, calls `score_brand()` when pack known
- `run()` loops over all 6 `STYLE_PACK_IDS` when `all_packs=True`

## Deferred Items

### DEF-17-05-01: Connected-env live --all-packs evaluation

**Status:** Deferred (requires live Bedrock access + seeded DB)

**Command:**
```bash
cd apps/email-listener && uv run python -m scripts.genui_eval.run_eval \
  --all-packs --label style-pack-win-baseline --no-judge
```

Or with brand judge active (requires escalation model access):
```bash
cd apps/email-listener && uv run python -m scripts.genui_eval.run_eval \
  --all-packs --label style-pack-win-baseline
```

**STYLE-04 pass bar:**
- No a11y regression vs. previous baseline (any negative delta = HARD FAIL per D-09)
- Positive or neutral lift on `mean_composed` and `mean_on_intent`
- `cross_pack_mean_distinctiveness` > 0.0 (packs are not identical)
- No retrieval overlap below floor warning on >50% of prompts

**Blocking on:** Bedrock credentials in env, default importer seeded (fixed UUID `00000000-…-0001`), at least one style pack with token values in DB.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed structlog-style kwargs in stdlib logger**
- **Found during:** Task 1 test run (TestRetrievalOverlapRatio::test_assert_retrieval_influence_logs_inert)
- **Issue:** `assert_retrieval_influence()` called `logger.warning("event", prompt_id=..., ratio=..., floor=...)` — structlog keyword syntax. But `style_metrics.py` uses `logging.getLogger(__name__)` (Python stdlib), which passes kwargs to `LogRecord` and raises `TypeError: Logger._log() got unexpected keyword argument 'prompt_id'`.
- **Fix:** Changed to positional format string args: `logger.warning("genui_eval_inert_retrieval prompt_id=%s ratio=%.2f floor=%.2f — ...", prompt_id, ratio, floor)`
- **Files modified:** `style_metrics.py`
- **Commit:** b5afb33

**2. [Rule 1 - Bug] Fixed purity guard docstring triggering false test failure**
- **Found during:** Task 1 test run (TestStyleMetricsPurityGuard::test_style_metrics_no_anthropic_import)
- **Issue:** The docstring said `"No import from anthropic, boto3, supabase..."` — the test does `assert "anthropic" not in source` and matched the docstring text.
- **Fix:** Changed docstring to `"No network library imports (LLM clients, database drivers, cloud SDKs)"` — same intent, no false positive.
- **Files modified:** `style_metrics.py`
- **Commit:** b5afb33

**3. [Rule 1 - Bug] Fixed ruff linting errors**
- **Found during:** Post-implementation ruff check
- **Issues:** Unused `math` import, ambiguous variable name `l` (WCAG spec uses `l` for lightness), unused `# noqa: E501` directive, `if/else` block replaceable with ternary.
- **Fix:** Removed `math` import, renamed `l` -> `lum`/`lum_fg_in`/`lum_bg_in`, removed noqa, converted to ternary.
- **Files modified:** `style_metrics.py`, `judge_adapter.py`, `run_eval.py`
- **Commit:** b5afb33

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | 56c4207 | PASS — ModuleNotFoundError + TypeError confirmed before implementation |
| GREEN (feat) | b5afb33 | PASS — 40/40 tests passing |
| REFACTOR | N/A | Not needed |

## Known Stubs

None — all functions are fully implemented. The `score_brand()` brand judge requires live Bedrock access (deferred to DEF-17-05-01) but the implementation is complete; the mock-based unit tests cover the full code path.

## Threat Flags

No new security-relevant surface introduced. `score_brand()` uses static system prompt only (T-17-31). Intent/spec go in user turn. No new network endpoints or schema changes.

## Self-Check: PASSED

- [x] `apps/email-listener/scripts/genui_eval/style_metrics.py` — exists
- [x] `apps/email-listener/tests/test_genui_eval_style.py` — exists (RED commit 56c4207)
- [x] RED commit 56c4207 — confirmed in git log
- [x] GREEN commit b5afb33 — confirmed in git log
- [x] 40 tests pass (uv run pytest tests/test_genui_eval_style.py --no-cov)
- [x] ruff check — all checks passed
- [x] mypy style_metrics.py — no issues found
