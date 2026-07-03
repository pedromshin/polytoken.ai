---
phase: 15-studio-surface
fixed_at: 2026-06-27T14:35:00Z
review_path: .planning/phases/15-studio-surface/15-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
skipped: 1
status: partial
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-06-27T14:35:00Z
**Source review:** `.planning/phases/15-studio-surface/15-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (WR-01, WR-02, WR-03, IN-01, IN-03)
- Fixed: 4
- Skipped: 1 (IN-02, per original instruction: skip unless clean local fix)

## Fixed Issues

### WR-01 + WR-02: Silent failure + `as any` cast in GenerationSandboxIsland

**Files modified:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
**Commit:** `bfe2ca3`
**Applied fix:**
- Added `lastError: string | undefined` state; cleared on each new generation attempt, set to "Generation failed. Please try again." when `q.refetch()` returns no data but has an error.
- Rendered a `role="alert"` div with `text-destructive` class when `lastError` is set (conditional on `!showChrome && lastError !== undefined`).
- Added `import type { SpecRoot } from "@nauta/genui/schema"`.
- Changed `GenerationResult.spec` from `unknown` to `SpecRoot` — valid because `q.data.spec` is already `SpecRoot` at the tRPC output boundary (validated by `GenerateOutputSchema`).
- Removed `as any` cast from `specToRender`; now typed as `SpecRoot | undefined` without any cast.

### WR-03: Bare `console.error` calls in `generate.ts`

**Files modified:** `packages/api-client/src/router/genui/generate.ts`
**Commit:** `e3ad282`
**Applied fix:**
- Added `logError(event: string, detail: unknown): void` function using `process.stderr.write(JSON.stringify({...}) + "\n")` — no new dependencies.
- Replaced all 5 `console.error` calls with `logError()` using stable event names:
  - `genui_generate_network_error`
  - `genui_generate_non2xx_response`
  - `genui_generate_json_parse_error`
  - `genui_generate_missing_spec_field`
  - `genui_generate_revalidation_failed`
- Each log line includes `{ procedure, event, detail, ts }` for log correlation.

### IN-03: Single-peel `unwrapOptional` fails for double-wrapped schemas

**Files modified:** `packages/genui/src/studio/describe-props-schema.ts`, `packages/genui/src/studio/__tests__/describe-props-schema.test.ts`
**Commit:** `936c634`
**Applied fix:**
- Replaced the single-peel `if`-based `unwrapOptional` with a `while (true)` loop that peels all `ZodOptional` and `ZodDefault` layers until reaching the inner type.
- Added a new test suite "double-wrapped optional (IN-03)" with two tests:
  - `z.string().optional().default("x")` → `ZodDefault(ZodOptional(ZodString))` resolves to `typeLabel: "string"`, `required: false`
  - `z.string().default("x").optional()` → `ZodOptional(ZodDefault(ZodString))` resolves to `typeLabel: "string"`, `required: false`

### IN-01: Case-insensitive catalog filter

**Files modified:** `apps/web/src/app/studio/_components/catalog-browser-island.tsx`
**Commit:** `88daa37`
**Applied fix:**
- Changed `e.type.includes(filter.toLowerCase())` to `e.type.toLowerCase().includes(filter.toLowerCase())` — now both sides are lowercased before comparison.

## Skipped Issues

### IN-02: No structured logging in `genui.py` Python endpoint

**File:** `apps/email-listener/app/presentation/api/v1/genui.py`
**Reason:** Skipped per original instruction — "skip unless it's a clean local fix." This finding involves Python server-side structured logging changes that interact with the FastAPI app's logging configuration. Deferred to a dedicated Python logging improvement task.
**Original issue:** The Python endpoint uses bare `logger.error()` calls without structured fields for event correlation.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npm run test -w @nauta/genui` | 182 tests, 8 files — all passing (includes 2 new IN-03 double-wrap tests) |
| `npm run test -w @nauta/api-client` | 118 tests, 12 files — all passing |
| TypeScript `tsc --noEmit` (web) | Clean |
| TypeScript `tsc --noEmit` (api-client) | Clean |
| TypeScript `tsc --noEmit` (genui) | Clean |
| `npm run web:build` | Passes — all 9 pages generated, no errors |
| No-eval grep (studio `_components/`) | Clean — zero functional matches |
| Python mypy typecheck | 4 pre-existing errors in unrelated files (confirmed pre-existing before this fix run) |

---

_Fixed: 2026-06-27T14:35:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
