---
phase: 17-tier-a-design-token-theme-layer-style-packs-assembly-rag
reviewed: 2026-06-28T03:00:00Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - apps/email-listener/app/application/use_cases/cache_key.py
  - apps/email-listener/app/application/use_cases/generate_ui_spec.py
  - apps/email-listener/app/container.py
  - apps/email-listener/app/domain/ports/generation_audit_repository.py
  - apps/email-listener/app/domain/ports/retrieval_provider.py
  - apps/email-listener/app/infrastructure/llm/exemplars/__init__.py
  - apps/email-listener/app/infrastructure/llm/genui_exemplars.py
  - apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
  - apps/email-listener/app/infrastructure/llm/genui_retrieval_provider.py
  - apps/email-listener/app/infrastructure/llm/genui_style_packs.py
  - apps/email-listener/app/presentation/api/v1/genui.py
  - apps/email-listener/scripts/genui_eval/compare_reports.py
  - apps/email-listener/scripts/genui_eval/judge_adapter.py
  - apps/email-listener/scripts/genui_eval/report.py
  - apps/email-listener/scripts/genui_eval/rubric.py
  - apps/email-listener/scripts/genui_eval/run_eval.py
  - apps/email-listener/scripts/genui_eval/style_metrics.py
  - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
  - packages/api-client/src/router/genui/generate.ts
  - packages/genui/src/renderer/spec-renderer.tsx
  - packages/genui/src/schema/allowlists.ts
  - packages/genui/src/schema/index.ts
  - packages/genui/src/schema/spec-schema.ts
  - packages/genui/src/schema/token-props-schema.ts
  - packages/genui/src/theme/index.ts
  - packages/genui/src/theme/packs.ts
  - packages/genui/src/theme/themed-wrapper.tsx
  - packages/genui/src/theme/tokens.ts
  - packages/genui/artifacts/spec.schema.json
findings:
  critical: 2
  warning: 5
  info: 5
  total: 12
status: resolved
---

# Phase 17: Code Review Report

**Reviewed:** 2026-06-28T03:00:00Z
**Depth:** standard
**Files Reviewed:** 29
**Status:** issues_found

## Summary

Phase 17 adds a design-token/style-pack layer (6 DTCG packs), assembly RAG (lexical retrieval with exemplars and catalog), and eval extensions (brand/a11y/retrieval metrics). The review covered all 29 changed source files at standard depth.

The token allowlist enforcement, CSS injection safety, and per-request injection boundaries are sound. `ThemedRoot` uses the React `style` prop (object form) from curated `resolvedVars`, never `dangerouslySetInnerHTML`. `TokenPropsSchema` correctly derives a strict Zod object from `TOKEN_ALIASES`, rejecting raw hex, `calc()`, `url()`, and unknown keys. The web re-validation layer in `generate.ts` re-runs `SpecRootSchema.safeParse` before returning any spec to the client. The eval purity contract is met: `style_metrics.py` and `rubric.py` contain no network or Bedrock imports.

Two blockers were found: (1) cache hit responses never propagate `style_pack_id` back to the API caller, so the client always sees `style_pack_id: null` on hits regardless of the pack originally requested; (2) the `list_history` endpoint documents D-15 best-effort error handling but does not implement it — exceptions escape as 500s. Five warnings follow, covering eval report JSON serialization omitting style aggregates (breaking `compare_reports.py`), private function imports in `rubric.py`, shallow copy of exemplar specs, double SHA-256 during cache key computation, and unenforced mutual exclusion in the eval CLI.

---

## Critical Issues

### CR-01: Cache hit does not propagate `style_pack_id` to the API caller

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:157`

**Issue:** When the exact-match cache returns a hit, the use case returns:

```python
return GenerateUiSpecResult(spec=cached.spec_json, cache_hit=True, outcome="ok")
```

`GenerateUiSpecResult.style_pack_id` defaults to `None`. The API layer in `genui.py` reads `result.style_pack_id` and puts it in the response envelope. On every cache hit the client receives `style_pack_id: null` regardless of what pack was requested. This is a correctness failure: the studio provenance badge will show no theme on cache hits, and client-side theming that depends on the returned `style_pack_id` field will silently downgrade to the default pack even when the user selected a non-default pack.

**Fix:**

```python
return GenerateUiSpecResult(
    spec=cached.spec_json,
    cache_hit=True,
    outcome="ok",
    style_pack_id=style_pack_id,   # propagate the requested pack
)
```

---

### CR-02: `list_history` endpoint does not implement its documented best-effort contract

**File:** `apps/email-listener/app/presentation/api/v1/genui.py:200`

**Issue:** The `list_history` endpoint's docstring asserts a D-15 best-effort contract: "Returns [] on errors rather than raising." The implementation unconditionally awaits `repo.list_recent(...)` without any `try/except`. Any repository error (connection drop, query timeout, serialization failure) will propagate as an unhandled exception and produce a 500 response to the caller. The documented contract is entirely unimplemented.

This is an observable behavioral discrepancy between documentation and code, not merely a style issue: callers that depend on the [] fallback (e.g., the studio history panel) will receive an error state instead of an empty list, breaking the UI graceful-degradation design.

**Fix:**

```python
try:
    summaries = await repo.list_recent(
        limit=limit, offset=offset, importer_id=importer_id
    )
except Exception:
    log.warning("genui_list_history_failed", exc_info=True)
    summaries = []
```

---

## Warnings

### WR-01: Eval JSON report omits additive style aggregates — `compare_reports.py` always sees `None`

**File:** `apps/email-listener/scripts/genui_eval/report.py:186-200`

**Issue:** `write_report` builds `report_dict` by hand and lists only the five core aggregate keys. The three additive style aggregates (`mean_brand_score`, `mean_distinctiveness`, `mean_retrieval_overlap`) are present on the `EvalReport` dataclass but are never written into the JSON file.

`compare_reports.py` then reads those same keys from the JSON (lines 100-123). Since they are absent from the serialized file, `baseline.get(key)` always returns `None`, so the "Style Signals" section of the comparison output always shows `N/A` for all signals, even when a styled run was performed. The style regression detection mechanism is silently broken end-to-end.

**Fix:** Include the additive fields in `report_dict` before serialization:

```python
report_dict: dict[str, Any] = {
    ...existing core fields...,
    "prompt_reports": [asdict(pr) for pr in report.prompt_reports],
    # Additive style aggregates (D-15)
    "mean_brand_score": round(report.mean_brand_score, 4) if report.mean_brand_score is not None else None,
    "mean_distinctiveness": round(report.mean_distinctiveness, 4) if report.mean_distinctiveness is not None else None,
    "mean_retrieval_overlap": round(report.mean_retrieval_overlap, 4) if report.mean_retrieval_overlap is not None else None,
}
```

---

### WR-02: `rubric.py` imports private underscore-prefixed functions from `genui_generator_adapter`

**File:** `apps/email-listener/scripts/genui_eval/rubric.py` (import block)

**Issue:**

```python
from app.infrastructure.llm.genui_generator_adapter import (
    _count_nodes,
    _validate_spec,
)
```

Both `_count_nodes` and `_validate_spec` are underscore-prefixed, indicating they are module-private implementation details. Importing private symbols across module boundaries violates encapsulation. If these functions are refactored, renamed, inlined, or moved during a future `genui_generator_adapter` change, `rubric.py` will raise an `ImportError` at eval runtime — a silent eval breakage with no warning at import time in non-strict environments.

`_count_nodes` and `_validate_spec` are pure functions with no adapter-specific state. They belong in a shared utility module that both the adapter and the rubric can depend on without coupling.

**Fix:** Move `_count_nodes` and `_validate_spec` to a shared utility module (e.g., `app/infrastructure/llm/genui_spec_utils.py`) with public names, then import from there in both `genui_generator_adapter.py` and `rubric.py`.

---

### WR-03: `--style-pack` and `--all-packs` CLI flags have undocumented priority — missing enforced mutual exclusion

**File:** `apps/email-listener/scripts/genui_eval/run_eval.py`

**Issue:** The argparse help text implies `--style-pack` and `--all-packs` are alternatives, but neither `add_mutually_exclusive_group()` nor any explicit runtime check prevents passing both simultaneously. When both are passed, `all_packs` silently takes priority (based on the conditional order in the argument-handling logic). A user who passes `--style-pack linear-clean --all-packs` expecting to run only `linear-clean` will instead run all packs, with no warning or error.

**Fix:** Use an argparse mutually exclusive group:

```python
pack_group = parser.add_mutually_exclusive_group()
pack_group.add_argument("--style-pack", ...)
pack_group.add_argument("--all-packs", ...)
```

---

### WR-04: Exemplar spec shallow copy — nested mutable dicts are shared references

**File:** `apps/email-listener/app/infrastructure/llm/genui_exemplars.py`

**Issue:** `load_exemplars()` stores each spec with:

```python
spec=dict(spec_asset)
```

`dict()` creates a shallow copy. The `root`, `data`, and `state` values inside each exemplar dict are still the original mutable objects from the `EXEMPLAR_ASSETS` module constant. If any downstream code mutates the `spec` dict of a returned `Exemplar` (e.g., adds a key to `spec["root"]`), it corrupts the shared module-level constant for all future callers, including subsequent calls that read from the `@lru_cache`-memoized result.

The project's immutability rules (CLAUDE.md) require new objects throughout. The fix is a deep copy.

**Fix:**

```python
import copy

spec=copy.deepcopy(dict(spec_asset))
```

Alternatively, mark the exemplar spec field with a type annotation that makes mutation obviously wrong, and add a test asserting the shared constant is not mutated after a retrieval call.

---

### WR-05: Double SHA-256 computation on cache key path — misleading WR-03 comment

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:136-145`

**Issue:** Lines 136-137 pre-compute `canonical_intent` and `data_shape_hash` "to avoid a redundant SHA-256 call (WR-03)". However, `compute_cache_key` (line 138-145) is called with `intent=intent` and `raw_content=raw_content` (the originals), not with the pre-computed values. Inside `compute_cache_key`, `canonicalize_intent(intent)` and `compute_data_shape_hash(raw_content)` are called again, performing the SHA-256 hashes a second time.

The comment documents an optimization that does not exist. The pre-computed `canonical_intent` and `data_shape_hash` are used only on the persist path (further down the function). The optimization described by the WR-03 comment was never implemented for the cache key itself.

This is a WARNING rather than a BLOCKER because both calls produce the same result (correctness is preserved). The risk is that future readers will trust the comment as evidence of an optimization that avoids redundant work on the hot cache path, leading to confusion during profiling or debugging.

**Fix:** Pass the pre-computed values to `compute_cache_key` if the function signature supports it, or remove the misleading comment and pre-computation if those values are only used on the persist path. The most direct fix is to update the call:

```python
cache_key = compute_cache_key(
    canonical_intent=canonical_intent,    # use pre-computed
    data_shape_hash=data_shape_hash,       # use pre-computed
    registry_version=registry_version,
    importer_id=importer_id,
    catalog_id=catalog_id,
    style_pack_id=style_pack_id,
)
```

This requires updating `compute_cache_key`'s signature to accept pre-computed values as an overload or replacing the internal calls when the pre-computed values are provided.

---

## Info

### IN-01: WCAG threshold constant is `0.03928` — spec value is `0.04045`

**File:** `apps/email-listener/scripts/genui_eval/style_metrics.py:76`

**Issue:** The `_linearise` function uses the threshold `0.03928` to decide between the two branches of the WCAG 2.1 linearization formula. The WCAG 2.1 specification (IEC 61966-2-1) uses `0.04045`. The value `0.03928` was present in an earlier draft and some implementations, but `0.04045` is the adopted standard. For very dark colors near the threshold boundary the contrast ratio calculation may differ by a tiny amount from the canonical WCAG reference implementation. This does not affect pass/fail for well-separated colors but could produce marginally incorrect results for near-boundary pairs.

**Fix:** Change `0.03928` to `0.04045` in `_linearise`.

---

### IN-02: `judge_adapter.py` — `_parse_response` and `_parse_brand_response` are near-duplicates

**File:** `apps/email-listener/scripts/genui_eval/judge_adapter.py`

**Issue:** Both functions parse a JSON blob from an LLM response looking for a float score in a specific key (`"score"` vs `"brand_score"`). The extraction logic, error handling, and clamping are structurally identical (copy-paste with a different key name). This is a maintenance burden: if the parsing logic needs to change (e.g., to handle non-JSON responses), both functions must be updated in sync.

**Fix:** Extract a shared helper:

```python
def _extract_score(text: str, key: str) -> float | None:
    ...

def _parse_response(text: str) -> float | None:
    return _extract_score(text, "score")

def _parse_brand_response(text: str) -> float | None:
    return _extract_score(text, "brand_score")
```

---

### IN-03: `LexicalRetrievalProvider` constructed without `templates_source` in production container — template arm permanently inactive

**File:** `apps/email-listener/app/container.py`

**Issue:**

```python
def _provide_lexical_retrieval_provider() -> RetrievalProvider:
    return LexicalRetrievalProvider()
```

`LexicalRetrievalProvider` accepts an optional `templates_source` argument that enables the template-retrieval scoring arm. In the production DI container it is always `None`, so the template arm is permanently inactive regardless of whether templates exist in the database. This is not a bug per se (the code is intentionally designed as optional/best-effort), but the gap between "feature implemented" and "feature wired in production" is undocumented at the container level and may cause confusion when templates accumulate but retrieval never uses them.

**Fix:** Add a comment at the provider construction site explaining that `templates_source` is intentionally deferred and noting the tracking item (or link to the relevant design decision / backlog entry). If the intent is for template retrieval to be active, wire in a `TemplatesSource` adapter here.

---

### IN-04: `pickSurprisePack` uses `Math.random()` — non-cryptographic but adequate for this use case

**File:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx:102-104`

**Issue:**

```python
const idx = Math.floor(Math.random() * STYLE_PACK_IDS.length);
return STYLE_PACK_IDS[idx] as StylePackId;
```

`Math.random()` is not cryptographically secure. For this use case (selecting a surprise visual theme for a studio sandbox) this is acceptable — there is no security-sensitive outcome. However, `Math.random()` can produce `1.0` in theory in some JavaScript engines under specific conditions (practically never, but technically possible), which would produce an out-of-bounds index. The `Math.floor` result would be `STYLE_PACK_IDS.length`, and `STYLE_PACK_IDS[length]` is `undefined`, which would then be cast to `StylePackId`, causing the tRPC input validator to reject the request.

**Fix:** Clamp the index:

```typescript
const idx = Math.floor(Math.random() * STYLE_PACK_IDS.length) % STYLE_PACK_IDS.length;
```

Or use the more common `Math.floor(Math.random() * n)` pattern with an explicit bounds check on the result.

---

### IN-05: `report.py` Markdown render does not include additive style aggregate rows

**File:** `apps/email-listener/scripts/genui_eval/report.py:208-251`

**Issue:** The `_render_markdown` function builds the aggregate score table for `mean_overall`, `mean_valid_spec`, `mean_composed`, `mean_on_intent`, and `mean_a11y`, but does not include `mean_brand_score`, `mean_distinctiveness`, or `mean_retrieval_overlap` in the rendered table. When reviewing a Phase 17 styled eval run's Markdown report, the style signal aggregates are invisible unless the reviewer inspects the JSON directly (and even there they are absent — see WR-01).

**Fix:** After the `a11y` row, append style aggregate rows when present:

```python
if report.mean_brand_score is not None:
    lines.append(f"| brand score | {report.mean_brand_score:.3f} |")
if report.mean_distinctiveness is not None:
    lines.append(f"| distinctiveness | {report.mean_distinctiveness:.3f} |")
if report.mean_retrieval_overlap is not None:
    lines.append(f"| retrieval overlap | {report.mean_retrieval_overlap:.3f} |")
```

---

_Reviewed: 2026-06-28T03:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
