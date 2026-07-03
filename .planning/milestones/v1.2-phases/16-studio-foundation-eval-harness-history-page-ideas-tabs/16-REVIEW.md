---
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
reviewed: 2026-06-27T21:30:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - apps/email-listener/app/domain/ports/ui_spec_template_repository.py
  - apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py
  - apps/email-listener/app/presentation/api/v1/genui.py
  - packages/api-client/src/router/genui/history.ts
  - packages/api-client/src/router/genui/index.ts
  - packages/api-client/src/router/genui/__tests__/history.test.ts
  - apps/web/src/app/studio/_components/history-island.tsx
  - apps/web/src/app/studio/_components/page-ideas-island.tsx
  - apps/web/src/app/studio/_components/studio-tabs.tsx
  - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
  - apps/email-listener/scripts/genui_eval/judge_adapter.py
  - apps/email-listener/scripts/genui_eval/rubric.py
  - apps/email-listener/scripts/genui_eval/report.py
  - apps/email-listener/scripts/genui_eval/compare_reports.py
  - apps/email-listener/scripts/genui_eval/run_eval.py
  - packages/genui/src/eval/index.ts
findings:
  critical: 3
  warning: 8
  info: 0
  total: 11
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-06-27T21:30:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 16 implements the Studio history spine (FastAPI endpoints + tRPC procedures + React island), the Page Ideas island, and the genui eval harness (judge, rubric, report, run). The overall architecture is sound: the FastAPI repository is parameterized, pagination is correctly bounded, and the eval harness uses Bedrock IAM auth (no hardcoded keys).

Three critical defects were identified. The most serious is a cross-tenant data disclosure: the `/v1/genui/history` endpoint omits mandatory `importer_id` enforcement, so any holder of the single shared API key can retrieve every tenant's spec history. Second, the eval asset cast (`as PageIdea[]`) silently bypasses `.strict()` schema validation, meaning schema-drift in the JSON files is invisible at runtime. Third, `historyByIdProcedure` returns `null` on parse failure instead of `SAFE_FALLBACK_SPEC`, deviating from the D-17 requirement documented in the plan; the UI-layer compensation in `history-island.tsx` only works when `detail` is non-null.

Eight warnings cover UI state bugs (stale selection, empty-state pagination display, silent network errors), rubric coupling to production internals, eval report immutability violation, missing schema validation on compare-reports JSON input, and a mis-recorded judge model ID in the report.

---

## Critical Issues

### CR-01: Cross-tenant data disclosure — no importer_id enforcement on history list endpoint

**File:** `apps/email-listener/app/presentation/api/v1/genui.py:~90`
**Issue:** `GET /v1/genui/history` accepts `importer_id` as an optional filter but does not require it. The service uses a single shared `X-API-Key` for all callers. Any authenticated caller that omits `importer_id` receives spec history rows for all tenants. The repository's `importer_id` filter is only applied when the parameter is present; there is no default scope to the requesting tenant. This is a real information-disclosure vulnerability regardless of whether individual rows contain credentials.

**Fix:** Either (a) require `importer_id` in the query parameters (remove `default=None`) and reject requests that omit it, or (b) derive the authorized `importer_id` from the API key authentication context and ignore any caller-supplied value. Option (b) requires a key-to-importer mapping; option (a) is the minimal safe fix:

```python
# Option A — make importer_id mandatory
@router.get("/history", response_model=ApiResponse[list[HistoryRowView]])
async def list_history(
    importer_id: str = Query(...),   # no default — required
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    repo: UiSpecTemplateRepository = FromDishka(),
) -> ApiResponse[list[HistoryRowView]]:
    ...
```

---

### CR-02: eval/index.ts — type assertion bypasses Zod `.strict()` schema validation on PAGE_IDEAS and GOLDEN_SET

**File:** `packages/genui/src/eval/index.ts:~1-20`
**Issue:** Both `PAGE_IDEAS` and `GOLDEN_SET` are cast with `as PageIdea[]` instead of being parsed through `PageIdeaSetSchema.parse(...)`. The `PageIdeaSchema` uses `.strict()`, meaning any extra or misspelled field in the JSON files would be silently accepted at runtime when using a type assertion. Schema drift (e.g., a renamed field in the JSON) will not be caught until the consuming code tries to access the expected field and gets `undefined`.

```typescript
// Current (bypasses validation):
export const PAGE_IDEAS: readonly PageIdea[] = pageIdeasJson as PageIdea[];
export const GOLDEN_SET: readonly PageIdea[] = goldenSetJson as PageIdea[];
```

**Fix:** Parse through the schema at module load time. If the JSON is malformed, fail immediately with a clear error rather than silently producing wrong data:

```typescript
import { PageIdeaSetSchema } from "./page-ideas-schema";

export const PAGE_IDEAS: readonly PageIdea[] = Object.freeze(
  PageIdeaSetSchema.parse(pageIdeasJson),
);

export const GOLDEN_SET: readonly PageIdea[] = Object.freeze(
  PageIdeaSetSchema.parse(goldenSetJson),
);
```

---

### CR-03: historyByIdProcedure returns null on schema parse failure instead of SAFE_FALLBACK_SPEC (D-17 violation)

**File:** `packages/api-client/src/router/genui/history.ts:~200-240`
**Issue:** The plan (16-03-PLAN.md) explicitly required that when `FastApiHistoryDetailSchema.safeParse` fails, the procedure must return `SAFE_FALLBACK_SPEC` wrapped in the detail shape — following D-17 (re-validate at web boundary, degrade to safe fallback). The implementation instead returns `null`. The UI-layer `parseSpecSafe()` in `history-island.tsx` only compensates when `detail` is non-null, so a malformed stored spec silently shows "Generation not found or no longer available" rather than the intended safe fallback rendering.

The SUMMARY acknowledged this as an "architectural deviation" but did not downgrade the D-17 requirement; the plan design decision is still active.

**Fix:** In `historyByIdProcedure`, on `FastApiHistoryDetailSchema.safeParse` failure, construct and return a detail object with `specJson` set to `SAFE_FALLBACK_SPEC`:

```typescript
import { SAFE_FALLBACK_SPEC } from "@nauta/genui";

// inside historyByIdProcedure, on parse failure:
const parsed = FastApiHistoryDetailSchema.safeParse(json.data);
if (!parsed.success) {
  logError("genui.historyById", "schema_parse_failure", parsed.error.flatten());
  return mapDetail({
    ...json.data,
    spec_json: SAFE_FALLBACK_SPEC,
  });
}
```

Alternatively, apply `SpecRootSchema.safeParse` to `parsed.data.spec_json` after the envelope parse succeeds and substitute `SAFE_FALLBACK_SPEC` only for the spec_json field on failure — this is the stricter D-17 interpretation.

---

## Warnings

### WR-01: history-island.tsx — network errors on historyById silently display as "not found"

**File:** `apps/web/src/app/studio/_components/history-island.tsx:~140-175`
**Issue:** The `HistoryDetailView` component destructures `{ data: detail, isLoading }` from `api.genui.historyById.useQuery(...)` but does not destructure `isError`. When the tRPC procedure throws (e.g., the EMAIL_LISTENER_URL env var missing, a TRPCClientError), the query enters an error state but the component falls through to the `null` branch and displays "Generation not found or no longer available." The user cannot distinguish a genuine 404 from a network or configuration failure.

**Fix:**
```tsx
const { data: detail, isLoading, isError } = api.genui.historyById.useQuery(...);

if (isLoading) return <Skeleton />;
if (isError) return <ErrorCard message="Could not load generation details. Please try again." />;
if (!detail) return <EmptyState message="Generation not found or no longer available." />;
```

---

### WR-02: history-island.tsx — pagination display shows "1–0" when list is empty or loading

**File:** `apps/web/src/app/studio/_components/history-island.tsx:~95-115`
**Issue:** The pagination display renders `{offset + 1}–{offset + (rows?.length ?? 0)}`. When the list is empty (`rows.length === 0`) or during the initial load (`rows` is `undefined`), this renders "1–0" which is a nonsensical range. The "Previous" / "Next" button logic is correct (disabled when rows is empty), but the display text is wrong.

**Fix:**
```tsx
const displayStart = rows && rows.length > 0 ? offset + 1 : 0;
const displayEnd = offset + (rows?.length ?? 0);
// Render: {displayStart}–{displayEnd} or "No results"
```

---

### WR-03: history-island.tsx — selectedId not reset when user navigates pages

**File:** `apps/web/src/app/studio/_components/history-island.tsx:~55-75`
**Issue:** `selectedId` is stateful at the `HistoryIsland` level. When the user clicks "Next" or "Previous" to change the page, the `offset` state updates but `selectedId` is not cleared. The `historyById` query remains enabled for the stale ID (from the previous page), and the detail panel continues to display the previously selected item even though it is no longer visible in the list. The user sees a detail panel that does not correspond to any highlighted row in the current page.

**Fix:** Reset `selectedId` to `""` whenever `offset` changes:
```tsx
function handleNextPage() {
  setOffset((prev) => prev + PAGE_SIZE);
  setSelectedId("");
}
function handlePrevPage() {
  setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  setSelectedId("");
}
```

---

### WR-04: rubric.py — imports private underscore-prefixed functions from production adapter

**File:** `apps/email-listener/scripts/genui_eval/rubric.py:~1-20`
**Issue:** `rubric.py` imports `_count_nodes` and `_validate_spec` (underscore-prefixed, module-private by convention) directly from `app.infrastructure.llm.genui_generator_adapter`. This creates tight coupling between the eval script and production internals. If these functions are refactored or removed, the eval harness breaks silently at import time (ImportError only surfaces at runtime). Additionally, `_collect_all_nodes` in `rubric.py` traverses non-`children` dict values in addition to the `children` list, which risks double-counting nodes that appear in both `children` and an auxiliary dict key.

**Fix:** Extract `count_nodes` and `validate_spec` (without underscore prefix) as public utilities into a shared `app/domain/services/spec_utils.py` module that both `genui_generator_adapter.py` and `rubric.py` import from. This also resolves the double-counting risk by having a single canonical traversal.

---

### WR-05: report.py — mutable list inside frozen dataclass (immutability violation)

**File:** `apps/email-listener/scripts/genui_eval/report.py:~30-50`
**Issue:** `EvalReport` is declared with `@dataclass(frozen=True)` but the `prompt_reports` field is typed as `list[PromptReport]`. Python's `frozen=True` prevents reassignment of the field reference, but the list itself is still mutable — callers can do `report.prompt_reports.append(...)`. This violates the immutability contract that `frozen=True` is intended to enforce and contradicts the project's "Immutable only" rule.

**Fix:** Use a tuple for `prompt_reports` or freeze the list at construction:
```python
@dataclass(frozen=True)
class EvalReport:
    prompt_reports: tuple[PromptReport, ...]  # immutable sequence
    ...
```
Update `build_report()` to pass `tuple(reports)` instead of a list. Update any iteration sites (no changes needed — `for r in report.prompt_reports` works on tuples).

---

### WR-06: compare_reports.py — no schema validation on loaded JSON files

**File:** `apps/email-listener/scripts/genui_eval/compare_reports.py:~20-45`
**Issue:** `_load_report()` reads a JSON file and returns it as a raw `dict[str, Any]` without parsing through `EvalReport` or a Pydantic/dataclass validator. If a malformed or outdated report file is passed (e.g., a report generated before a schema change), the downstream diff logic will produce KeyErrors or silently wrong comparisons. This violates CLAUDE.md: "Validate inputs at system boundaries (Zod/Pydantic)."

**Fix:** Deserialize through the `EvalReport` dataclass (or a Pydantic model) with explicit field validation:
```python
def _load_report(path: Path) -> EvalReport:
    raw = json.loads(path.read_text())
    # Use dacite or a Pydantic model to validate structure
    return EvalReport(
        run_id=raw["run_id"],
        model_id=raw["model_id"],
        timestamp=raw["timestamp"],
        prompt_reports=tuple(
            PromptReport(**pr) for pr in raw["prompt_reports"]
        ),
        aggregate=AggregateScores(**raw["aggregate"]),
    )
```

---

### WR-07: run_eval.py — judge model ID not recorded in EvalReport

**File:** `apps/email-listener/scripts/genui_eval/run_eval.py:~80-120`
**Issue:** The `JudgeAdapter` is constructed with `model_id=settings.genui_escalation_model_id` (the judge/escalation model), but `EvalReport` is populated with `model_id=settings.genui_model_id` (the generator model). The report therefore records which model generated the spec but not which model judged it. This makes historical comparisons ambiguous — a change in judge model would not be visible in stored reports.

**Fix:** Add a `judge_model_id` field to `EvalReport` and populate it from `settings.genui_escalation_model_id`:
```python
report = build_report(
    run_id=run_id,
    model_id=settings.genui_model_id,
    judge_model_id=settings.genui_escalation_model_id,
    prompt_reports=completed,
)
```

---

### WR-08: judge_adapter.py — intent string interpolated directly into LLM user message (prompt injection surface)

**File:** `apps/email-listener/scripts/genui_eval/judge_adapter.py:~95-130`
**Issue:** The `intent` string from the eval prompt is interpolated directly into the user message sent to the Bedrock judge. For the current use case (golden set of trusted prompts), this is low risk. However, if `run_eval.py` is ever adapted to accept user-supplied prompts or external corpus inputs, this becomes a prompt injection surface — a crafted intent string could instruct the judge to return a specific score regardless of the spec.

**Fix:** Add a brief comment documenting the injection surface and the constraint that `intent` must come from the trusted golden set only. If external inputs are ever added, wrap the intent in explicit delimiter markers:
```python
user_content = (
    f"<intent>{intent}</intent>\n"
    f"<spec>{json.dumps(spec_json)}</spec>\n"
    "Score this spec against the intent using the score_intent_match tool."
)
```
The XML delimiters instruct the model to treat the intent as data, not instructions.

---

_Reviewed: 2026-06-27T21:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
