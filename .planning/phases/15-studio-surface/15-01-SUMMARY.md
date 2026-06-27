---
phase: 15
plan: "01"
subsystem: genui/studio
tags: [outcome-signal, tdd, pure-helpers, studio-surface]
dependency_graph:
  requires: []
  provides:
    - outcome field on GenerateUiSpecResult (Python use-case)
    - outcome field on GenerateUiSpecView (FastAPI)
    - GenerateOutputSchema with outcome/cacheHit/reason (tRPC)
    - deriveGenerationState helper (@nauta/genui/studio)
    - describePropsSchema helper (@nauta/genui/studio)
  affects:
    - apps/email-listener/app/application/use_cases/generate_ui_spec.py
    - apps/email-listener/app/presentation/api/v1/genui.py
    - packages/api-client/src/router/genui/generate.ts
    - packages/genui/src/studio/
tech_stack:
  added: []
  patterns:
    - TDD (RED → GREEN)
    - Zod v3 _def introspection for prop type labels
    - Discriminated union GenerationState (kind field)
    - D-05 additive signal contract (no new gen/cache logic)
key_files:
  created:
    - apps/email-listener/tests/application/test_generate_ui_spec.py (4 new tests)
    - apps/email-listener/tests/presentation/test_genui_endpoint.py (2 new tests)
    - packages/api-client/src/router/genui/__tests__/generate.test.ts (5 new tests)
    - packages/genui/src/studio/derive-generation-state.ts
    - packages/genui/src/studio/describe-props-schema.ts
    - packages/genui/src/studio/index.ts
    - packages/genui/src/studio/__tests__/derive-generation-state.test.ts
    - packages/genui/src/studio/__tests__/describe-props-schema.test.ts
  modified:
    - apps/email-listener/app/application/use_cases/generate_ui_spec.py
    - apps/email-listener/app/presentation/api/v1/genui.py
    - packages/api-client/src/router/genui/generate.ts
    - packages/genui/package.json
    - packages/genui/src/index.ts
decisions:
  - "outcome field is ADDITIVE on GenerateUiSpecResult frozen dataclass — cache-hit path hardcodes outcome='ok', cold path reuses already-computed _determine_outcome() variable (D-14)"
  - "SpecRootSchema.safeParse stays authoritative web-boundary gate — overrides FastAPI outcome to 'fallback' on re-validation failure regardless of what server reported (D-08/D-15)"
  - "GenerateOutputSchema is flat z.object (not discriminatedUnion) — flat shape carries all three signals and avoids variant-specific parsing complexity"
  - "deriveGenerationState and describePropsSchema are pure, framework-free (no React/Next) — safe to import in both browser and server studio contexts"
  - "describePropsSchema uses _def.typeName string comparison (not instanceof) — avoids Zod version bundling ambiguity in monorepo"
  - "escalated outcome maps to cold + escalated=true (D-03d: escalated is a sub-flavor of cold, not a fourth kind)"
metrics:
  duration_minutes: ~120
  completed: "2026-06-27"
  tasks_completed: 3
  files_created: 8
  files_modified: 5
---

# Phase 15 Plan 01: D-05 Outcome Signal Thread-Through and Studio Helpers Summary

Threading `outcome` from Python use-case through FastAPI view and tRPC schema, and shipping two pure studio helpers `deriveGenerationState` + `describePropsSchema` in `@nauta/genui/studio`.

## What Was Built

### Task 1 — Python outcome field (TDD)

Added `outcome: Literal["ok", "fallback", "escalated"] = "ok"` to:
- `GenerateUiSpecResult` frozen dataclass (use-case layer)
- `GenerateUiSpecView` Pydantic model (FastAPI presentation layer)

Cache-hit return path hardcodes `outcome="ok"` (D-14: fallbacks are never cached).
Cold path reuses the already-computed `_determine_outcome(...)` variable — not recomputed.
No `from __future__ import annotations` added (Pydantic ForwardRef constraint respected).

**Gate:** `uv run python -m pytest tests/application/test_generate_ui_spec.py tests/presentation/test_genui_endpoint.py --no-cov -v` → 6 new tests pass.

### Task 2 — tRPC GenerateOutputSchema (TDD)

Replaced the old `discriminatedUnion` with a flat `z.object` schema:

```typescript
const GenerateOutputSchema = z.object({
  outcome: z.enum(["ok", "fallback", "escalated"]),
  spec: SpecRootSchema,
  cacheHit: z.boolean(),
  reason: z.string().optional(),
});
```

Reads `data.cache_hit` and `data.outcome` from the FastAPI envelope with null-safe guards.
`SpecRootSchema.safeParse` failure overrides to `outcome: "fallback"` (D-08/D-15 authoritative).
All fallback return paths include `cacheHit: false`.

**Gate:** 5 new D-05 tests in `generate.test.ts` — all pass.

### Task 3 — Studio helpers (TDD)

Two pure, framework-free TypeScript helpers in `packages/genui/src/studio/`:

**`deriveGenerationState(signals) → GenerationState`**
Maps (isPending, outcome, cacheHit, reason) to a discriminated state value per §9 table:
- `isPending=true` → `{ kind: "in_progress", escalated: false }` (highest priority)
- `outcome="fallback"` → `{ kind: "fallback", reason? }`
- `outcome="ok" + cacheHit` → `{ kind: "cache_hit" }`
- `outcome="ok" + !cacheHit` → `{ kind: "cold", escalated: false }`
- `outcome="escalated"` → `{ kind: "cold", escalated: true }`

**`describePropsSchema(entry) → ReadonlyArray<PropDescriptor>`**
Introspects a `ZodObject` propsSchema per §12 rules:
- Resolves `ZodString/Number/Boolean/Literal/Enum/Array/Object/Record` to human labels
- Unwraps `ZodOptional`/`ZodDefault` → `required: false`
- Surfaces `locked: true` for props in `lockedProps`
- Returns `[]` on any failure (never throws)

`./studio` subpath export added to `packages/genui/package.json`.

**Gate:** 27 tests pass (9 derive-generation-state, 18 describe-props-schema). Typecheck clean. No-eval gate clean.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | c7200f0 | feat(15-01): thread outcome through Python use-case result and FastAPI view |
| 2 | 0864f3e | feat(15-01): extend tRPC GenerateOutputSchema with outcome, cacheHit, reason (D-05) |
| 3 | be831d8 | feat(15-01): ship studio helpers deriveGenerationState and describePropsSchema |

## Deviations from Plan

None — plan executed exactly as written. All D-05 additive-only constraints respected. No new packages added.

## Known Stubs

None — all helpers are fully wired. `deriveGenerationState` consumes real tRPC output signals; `describePropsSchema` introspects real Zod propsSchema objects from the catalog.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. All new code is pure computation (no I/O).

## Self-Check: PASSED

- `packages/genui/src/studio/derive-generation-state.ts` — exists
- `packages/genui/src/studio/describe-props-schema.ts` — exists
- `packages/genui/src/studio/index.ts` — exists
- `packages/genui/src/studio/__tests__/derive-generation-state.test.ts` — exists
- `packages/genui/src/studio/__tests__/describe-props-schema.test.ts` — exists
- Commits c7200f0, 0864f3e, be831d8 — all present in git log
- 27 studio tests passing
- Typecheck: clean
- No-eval gate: clean
