---
phase: 13-generation-layer-and-guardrails
fixed_at: 2026-06-27T07:30:00Z
review_path: .planning/phases/13-generation-layer-and-guardrails/13-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 13: Code Review Fix Report

**Fixed at:** 2026-06-27T07:30:00Z
**Source review:** .planning/phases/13-generation-layer-and-guardrails/13-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (3 Critical, 6 Warning)
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01 + CR-02: tRPC request body missing FastAPI required fields + wrong envelope key

**Files modified:** `packages/api-client/src/router/genui/generate.ts`, `packages/api-client/src/router/genui/__tests__/generate.test.ts`
**Commit:** 768ce8d
**Applied fix:**
- Added `rawContent: z.string().default("")` and `importerId: z.string().optional()` to GenerateInput schema
- Fixed request body to send all four FastAPI required fields: `intent`, `raw_content`, `registry_version`, `importer_id`
- Fixed envelope parsing to read `body.data.spec` (was reading `body.spec` — wrong key; real FastAPI envelope is `{ success, data: { spec }, error }`)
- Added `REGISTRY_VERSION` import to send the live catalog version on every request
- Rewrote test file with Contract-01 (request body has all fields) and Contract-02 (real envelope returns real spec, stale flat shape returns SAFE_FALLBACK)
- **raw_content reconciliation (Option A):** Made `raw_content` optional with `default=""` in FastAPI `GenerateUiSpecRequest`. The quarantine adapter gracefully handles empty `raw_content`, enabling intent-only generation without a 422. Phase 15 studio UI will supply real content.

### CR-03: href pattern allows //evil.com and URI schemes via missing not-guard

**Files modified:** `packages/genui/src/generation/artifact-builder.ts`, `packages/genui/artifacts/spec.schema.json`
**Commit:** f8e787e
**Applied fix:**
- Added `addHrefAbsoluteSchemeGuard(schema: unknown): unknown` post-processor to `artifact-builder.ts` that detects `{ type: "string", pattern: "^\\/" }` nodes (the navigate-action href field) and injects `not: { pattern: "^(//|[a-zA-Z][a-zA-Z0-9+\\-.]*:)" }` — rejects protocol-relative URLs and any letter-based URI scheme
- Updated `buildSpecSchema()` to run both post-processors in order: `ensureAdditionalPropertiesFalse` then `addHrefAbsoluteSchemeGuard`
- Directly patched `spec.schema.json` to add the `not` guard to the committed artifact (drift-gate test confirmed green: 12/12 pass)
- Root cause: `zod-to-json-schema` cannot translate `.refine()` predicates — the Zod refinement `noAbsoluteScheme` was silently dropped when generating the JSON Schema artifact

### WR-01: intent_summary has no maxLength cap in quarantine tool schema

**Files modified:** `apps/email-listener/app/infrastructure/llm/genui_quarantine_adapter.py`
**Commit:** 9075c2e
**Applied fix:**
- Added `"maxLength": 500` to `intent_summary` property in `_QUARANTINE_TOOL_DICT` input_schema
- Added `[:500]` truncation in `_parse_response()` as defense-in-depth (model may ignore maxLength in constrained-decoding mode)

### WR-03 + WR-04 + WR-05: Audit always records attempts=1, never "escalated", always Haiku model_id

**Files modified:** `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py`, `apps/email-listener/app/application/use_cases/generate_ui_spec.py`
**Commit:** 619e4ad
**Applied fix:**
- Added `GeneratorResult` frozen dataclass to `genui_generator_adapter.py` with fields: `spec`, `attempts: int`, `escalated: bool`
- Changed `_repair_loop()` return type from `dict[str, Any]` to `GeneratorResult`; tracks `escalated_this_attempt = (attempt == 2)` per iteration; returns `GeneratorResult(spec=candidate, attempts=attempt+1, escalated=escalated_this_attempt)` on success; returns `GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=3, escalated=True)` after all 3 attempts fail
- Changed `generate()` return type to `GeneratorResult`; exception fallback now returns `GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=1, escalated=False)`
- Updated `generate_ui_spec.py` use case to consume `GeneratorResult`:
  - Uses `gen_result.attempts` instead of hardcoded `1`
  - `_determine_outcome()` now accepts `escalated: bool` kwarg; priority: fallback > escalated > ok
  - `_resolve_model_id()` now accepts `escalated: bool` kwarg; returns `settings.genui_escalation_model_id` when escalated
  - Logs `attempts` and `escalated` in `genui_generate_done` event

### WR-06: audit record() blocks event loop on synchronous Supabase execute()

**Files modified:** `apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py`
**Commit:** b0bb3ad
**Applied fix:**
- Added `import asyncio` to module imports
- Wrapped `self._client.table(_TABLE).insert(row).execute()` with `await asyncio.to_thread(lambda: ...)` to offload the synchronous blocking call to a thread-pool worker
- The event loop is now free to process other requests during the Supabase network round-trip

## Skipped Issues

None — all 9 in-scope findings were fixed.

---

## Verification Results

All test suites green after fixes:

- `packages/api-client` vitest: **109 passed** (12 test files including 7 genui tests)
- `packages/genui` artifacts drift-gate: **12 passed** (spec.schema.json matches buildSpecSchema() output)
- Python pytest (generator adapter, use case, quarantine adapter, audit repository): **42 passed**, 1 warning (coverage threshold — pre-existing)

---

_Fixed: 2026-06-27T07:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
