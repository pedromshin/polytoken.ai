---
phase: 16
fixed_at: 2026-06-28T00:38:00Z
review_path: .planning/phases/16-studio-foundation-eval-harness-history-page-ideas-tabs/16-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-06-28T00:38:00Z
**Source review:** `.planning/phases/16-studio-foundation-eval-harness-history-page-ideas-tabs/16-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-02, CR-03, WR-01, WR-02, WR-03, WR-05)
- Fixed: 6
- Skipped: 0

> CR-01 was explicitly excluded by orchestrator decision (documented known-limitation: single-shared-key sandbox, history must list all generations — requiring importer_id would break the Studio History tab).
> WR-04, WR-06, WR-07, WR-08 were explicitly excluded (accepted/low-priority).

---

## Fixed Issues

### CR-02: Unsafe `as` casts bypass Zod `.strict()` at eval module load

**Files modified:** `packages/genui/src/eval/index.ts`, `packages/genui/src/__tests__/eval-schema-parse-enforcement.test.ts`
**Commit:** `5860aa4`
**Applied fix:** Replaced `pageIdeasJson as PageIdea[]` and `goldenSetJson as PageIdea[]` casts with `PageIdeaSetSchema.parse()` calls. Both constants are now also wrapped in `Object.freeze()` for runtime immutability. Regression test (7 assertions) verifies: frozen arrays, `.strict()` rejection of extra fields, missing fields, invalid enums, and valid fixture acceptance.

---

### CR-03: `historyById` returns `null` on schema parse failure instead of SAFE_FALLBACK_SPEC

**Files modified:** `packages/api-client/src/router/genui/history.ts`, `packages/api-client/src/router/genui/__tests__/history.test.ts`
**Commit:** `360004e`
**Applied fix:** When `FastApiHistoryDetailSchema.safeParse()` fails (malformed spec_json or missing fields), the procedure now extracts surviving envelope fields from `dataField` with safe defaults and substitutes `SAFE_FALLBACK_SPEC` for `spec_json`, returning a valid `HistoryDetail` rather than `null`. `null` is still returned only for 404 and network failures (D-15). Four regression tests (Tests 15–18) cover: malformed envelope → fallback detail with `specJson.v === 1`, valid envelope with missing `use_count` → fallback, 5xx → null, ECONNREFUSED → null.

---

### WR-01: `isError` not surfaced — network/5xx shows same UI as "not found"

**Files modified:** `apps/web/src/app/studio/_components/history-island.tsx`
**Commit:** `30117cf`
**Applied fix:** `HistoryDetailView` destructures `isError` from the `useQuery` result and renders a distinct error card (`role="alert"`, `text-destructive`) before the null check. Users now see "Could not load generation details. Please try again." on network or 5xx failures instead of the "not found" empty state.

---

### WR-02: Pagination range shows "1–0" when history list is empty

**Files modified:** `apps/web/src/app/studio/_components/history-island.tsx`
**Commit:** `a7a9adc` (subsequently superseded by `e99cc91`)
**Applied fix:** Replaced unconditional `{offset + 1}–{offset + (rows?.length ?? 0)}` with a conditional: shows `"0"` when `rows` is undefined or empty, and `${offset + 1}–${offset + rows.length}` otherwise.

---

### WR-03: Page change does not reset `selectedId` — stale detail pane persists across pages

**Files modified:** `apps/web/src/app/studio/_components/history-island.tsx`
**Commit:** `e99cc91`
**Applied fix:** Added `onPageChange: () => void` to `MasterListProps` interface. Both `handlePrev` and `handleNext` call `onPageChange()` before updating `offset`. `HistoryIsland` passes `handlePageChange = () => setSelectedId(undefined)` as the callback, so navigating to a different page always clears the detail pane selection.

---

### WR-05: `EvalReport.prompt_reports` is a `list` inside a `frozen=True` dataclass

**Files modified:** `apps/email-listener/scripts/genui_eval/report.py`, `apps/email-listener/tests/test_genui_eval_rubric.py`
**Commit:** `11fb71a`
**Applied fix:** Changed `EvalReport.prompt_reports` field type from `list[PromptReport]` to `tuple[PromptReport, ...]`. Updated `build_report()` to accept `list[PromptReport] | tuple[PromptReport, ...]` and materialise to a tuple via `reports_tuple = tuple(prompt_reports)` before constructing `EvalReport`. Call sites in `run_eval.py` are unaffected (they pass a list, which `build_report()` accepts and converts). Five regression tests verify: `isinstance(tuple)`, list input coercion, tuple input passthrough, frozen field reassignment raises, and correct completed/failed counts from tuple content.

---

## Skipped Issues

None — all 6 in-scope findings were fixed successfully.

---

## Verification Results

All required suites passed after all fixes:

| Suite | Result |
|-------|--------|
| `npm test -w @nauta/genui` | 241 passed (12 test files) |
| `npm run typecheck -w @nauta/genui` | Clean |
| `npm test -w @nauta/api-client` | 136 passed (13 test files) |
| `npm run typecheck -w @nauta/api-client` | Clean |
| `pytest tests/test_genui_eval_rubric.py` | 25 passed, 1 skipped (integration gate) |
| `npm run web:build` | Build successful, all 9 routes generated |

---

_Fixed: 2026-06-28T00:38:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
