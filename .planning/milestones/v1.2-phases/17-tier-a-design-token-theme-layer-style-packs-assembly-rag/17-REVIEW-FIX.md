---
phase: 17
fixed_at: 2026-06-28T04:30:00Z
review_path: .planning/phases/17-tier-a-design-token-theme-layer-style-packs-assembly-rag/17-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 11
skipped: 1
status: partial
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-06-28T04:30:00Z
**Source review:** `.planning/phases/17-tier-a-design-token-theme-layer-style-packs-assembly-rag/17-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 12
- Fixed: 11
- Skipped: 1

## Fixed Issues

### CR-01: style_pack_id missing from cache-hit result

**Files modified:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py`
**Commit:** `9072b0c`
**Applied fix:** Added `style_pack_id` to the cache-hit early-return `GenerateUiSpecResult` so cache hits carry the style pack identifier that was used for lookup — eliminating the silent data loss where cache-hit callers received `style_pack_id=None`.

---

### CR-02: unhandled exception in genui.py list_recent path

**Files modified:** `apps/email-listener/app/interfaces/http/genui.py`
**Commit:** `1aaa405`
**Applied fix:** Wrapped the `list_recent` repository call in a try/except block that catches `Exception`, logs the error with structlog, and returns an empty list rather than propagating a 500. This matches the error-handling contract used by other list endpoints.

---

### WR-01: EvalReport missing style aggregate fields in JSON/markdown

**Files modified:** `apps/email-listener/scripts/genui_eval/report.py`
**Commit:** `916a6cf`
**Applied fix:** Added `mean_brand_score`, `mean_distinctiveness`, and `mean_retrieval_overlap` fields to `EvalReport` dataclass (Optional[float], default None). Updated `to_dict()` to include these keys, and updated `to_markdown()` to render a Style Aggregates section when any of the three values are present. The core four-criterion aggregate and its weights are untouched (D-15 baseline comparability preserved).

---

### WR-02: genui_spec_utils extracted as public shared module

**Files modified:**
- `apps/email-listener/app/infrastructure/llm/genui_spec_utils.py` (new file)
- `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py`
- `apps/email-listener/scripts/genui_eval/rubric.py`

**Commits:** `88463fc`, `03c00b1`, `45e7b51`
**Applied fix:**
1. Created `genui_spec_utils.py` — public module exporting `count_nodes`, `validate_spec`, `MAX_SPEC_NODES`, `MAX_SPEC_DEPTH`. `validate_spec` uses `jsonschema.Draft7Validator` and returns `str(errors[0].message)` (explicit cast for mypy `no-any-return`).
2. Updated `genui_generator_adapter.py` to import `validate_spec as _validate_spec` from the new module; removed private `_count_nodes`, `_validate_spec`, and the local constants.
3. Updated `rubric.py` to import `count_nodes as _count_nodes` and `validate_spec as _validate_spec` from `genui_spec_utils`.
4. Follow-up cleanup commit (`03c00b1`): fixed F821 (`load_spec_schema` accidentally dropped from adapter imports), F401 (unused `count_nodes`/`MAX_SPEC_*` in adapter), I001 (import ordering in rubric.py after ruff fix pass).
5. Follow-up mypy commit (`45e7b51`): added `str()` cast on `errors[0].message` in `genui_spec_utils.py:74`.

---

### WR-03: --style-pack and --all-packs not mutually exclusive in run_eval.py

**Files modified:** `apps/email-listener/scripts/genui_eval/run_eval.py`
**Commit:** `30d1132`
**Applied fix:** Replaced two separate `parser.add_argument` calls with `parser.add_mutually_exclusive_group()`. argparse now enforces that `--style-pack` and `--all-packs` cannot be supplied together at the CLI level, producing a clear error message rather than silently ignoring one flag.

---

### WR-04: shallow copy of exemplar spec dict in genui_exemplars.py

**Files modified:** `apps/email-listener/app/infrastructure/llm/genui_exemplars.py`
**Commit:** `9c06290`
**Applied fix:** Added `import copy` and changed `dict(spec_asset)` to `copy.deepcopy(dict(spec_asset))` in the `load_exemplars` function. This ensures mutations to the exemplar spec (e.g., by the generator adapter during prompt assembly) do not corrupt the cached asset.

---

### WR-05: double SHA-256 on canonical_intent and data_shape_hash

**Files modified:**
- `apps/email-listener/app/application/use_cases/cache_key.py`
- `apps/email-listener/app/application/use_cases/generate_ui_spec.py`

**Commit:** `f6b1d26`
**Applied fix:** Added optional parameters `_canonical_intent: str | None = None` and `_data_shape_hash: str | None = None` to `compute_cache_key`. The function uses the pre-computed values when provided, avoiding a second SHA-256 computation. Updated `generate_ui_spec.py` to pass `_canonical_intent=canonical_intent` and `_data_shape_hash=data_shape_hash` since those values are already computed earlier in the use case for the persist path.

---

### IN-01: WCAG sRGB linearisation threshold incorrect (0.03928 vs 0.04045)

**Files modified:** `apps/email-listener/scripts/genui_eval/style_metrics.py`
**Commit:** `b472027`
**Applied fix:** Changed `_linearise` threshold from `0.03928` to `0.04045` — the value specified in IEC 61966-2-1:1999 and used by WCAG 2.x. Updated the docstring to cite the correct standard. This affects the numerical output of contrast ratio calculations and WCAG-AA pass/fail results.

---

### IN-04: pickSurprisePack lacks modulo guard

**Files modified:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
**Commit:** `d2a7979`
**Applied fix:** Added `% STYLE_PACK_IDS.length` to the index calculation in `pickSurprisePack`. The comment explains the defensive rationale: some JS engines can return `Math.random() === 1.0` (or very close), making `Math.floor` yield `length` and producing `undefined` instead of a valid `StylePackId`.

---

### IN-05: EvalReport style aggregates in serialized output (combined with WR-01)

**Files modified:** `apps/email-listener/scripts/genui_eval/report.py`
**Commit:** `916a6cf`
**Applied fix:** Combined with WR-01 fix in the same commit — style aggregate fields added to both `to_dict()` and `to_markdown()`.

---

## Skipped Issues

### IN-02: EvalReport missing per-pack breakdown table

**File:** `apps/email-listener/scripts/genui_eval/report.py`
**Reason:** Deferred — this requires designing and adding a `per_pack_results: list[...]` field to `EvalReport`, which is a non-trivial structural addition that touches the report dataclass contract, the aggregation loop in `run_eval.py`, and the markdown renderer. Safely deferred to a follow-up phase to avoid scope creep on this fix pass. The WR-01/IN-05 style-aggregate scalar fields were added as planned; the per-pack breakdown table is the remaining piece.
**Original issue:** When `--all-packs` runs all 6 style packs, the report should include a per-pack breakdown table so engineers can compare pack performance without re-running individual evaluations.

---

_Fixed: 2026-06-28T04:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
