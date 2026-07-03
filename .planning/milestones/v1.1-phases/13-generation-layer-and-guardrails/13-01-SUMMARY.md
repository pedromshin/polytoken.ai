---
phase: 13-generation-layer-and-guardrails
plan: "01"
subsystem: packages/genui
tags: [allowlists, zod, bedrock, artifacts, tdd, security, genui]
dependency_graph:
  requires:
    - "12-catalog-spec-schema-and-trusted-interpreter (SpecRootSchema, RegisteredTypeSchema, COMPONENT_REGISTRY, REGISTRY_VERSION)"
  provides:
    - DataBindingSchema (procedure allowlist + UUID-rejection refine)
    - ActionSchema (navigate/setState/mutate discriminated union)
    - ALLOWED_PROCEDURES (9 query-only tRPC procedures)
    - SAFE_FALLBACK_SPEC (fail-closed static SpecRoot)
    - spec.schema.json (Bedrock JSON Schema artifact, 22x additionalProperties:false)
    - genui-prompt.json (compact catalog + procedures + REGISTRY_VERSION for Python prompt)
  affects:
    - "13-02 (audit table schema — shares ALLOWED_PROCEDURES constant)"
    - "13-03 (Python generator — consumes spec.schema.json + genui-prompt.json)"
    - "13-04 (web proxy binding layer — consumes DataBindingSchema + ActionSchema)"
tech_stack:
  added:
    - "zod-to-json-schema@3.25.2 (devDependency, Zod→JSON Schema conversion)"
  patterns:
    - "TDD RED/GREEN with per-phase RED commit before implementation"
    - "z.never() for empty enum seam (SEAM-02 mutate branch)"
    - "z.discriminatedUnion for ActionSchema navigate/setState/mutate"
    - "$refStrategy:none for Bedrock-compatible inline schema (no external $ref)"
    - "Pure buildGenuiPromptPayload() shared by emit script + freshness test"
key_files:
  created:
    - packages/genui/src/generation/allowed-procedures.ts
    - packages/genui/src/generation/artifact-builder.ts
    - packages/genui/src/generation/index.ts
    - packages/genui/src/schema/data-binding-schema.ts
    - packages/genui/src/schema/action-schema.ts
    - packages/genui/src/schema/allowlists.ts
    - packages/genui/src/schema/safe-fallback-spec.ts
    - packages/genui/src/schema/__tests__/allowlists.test.ts
    - packages/genui/src/generation/__tests__/artifacts.test.ts
    - packages/genui/scripts/emit-bedrock-artifacts.ts
    - packages/genui/artifacts/spec.schema.json
    - packages/genui/artifacts/genui-prompt.json
  modified:
    - packages/genui/src/schema/spec-schema.ts (onClick + bindings fields added)
    - packages/genui/src/schema/index.ts (Phase 13 symbols exported)
    - packages/genui/src/index.ts (generation barrel added)
    - packages/genui/package.json (zod-to-json-schema devDep + gen:artifacts script)
decisions:
  - "D-13b: ALLOWED_PROCEDURES is query-only hand-curated list (9 procedures); no wildcards"
  - "D-14/SEAM-02: ALLOWED_MUTATIONS=[] as const; AllowedMutationSchema=z.never() so mutate branch is present in grammar but accepts no value"
  - "D-14: Navigate href validation is startsWith('/') AND regex rejection of absolute/protocol-relative schemes — two guards, not one"
  - "D-23: onClick added as NEW field on ButtonNodeSchema, not overloading Phase-12 action:string (ActionRegistry key)"
  - "D-22: $refStrategy:none inlines all sub-schemas for Bedrock; recursive nodes (card.children, list.itemTemplate) become 'any' in the JSON Schema"
  - "Artifact idempotency: JSON.stringify with 2-space indent + trailing newline ensures byte-identical re-runs"
metrics:
  started: "2026-06-27T00:00:00Z"
  completed: "2026-06-27T08:15:00Z"
  duration_minutes: 495
  tasks_completed: 2
  tasks_total: 2
  files_created: 12
  files_modified: 4
  tests_added: 52
  tests_total: 148
---

# Phase 13 Plan 01: genui TypeScript Contract Layer Summary

**One-liner:** Three Zod allowlists (component type, tRPC procedure, action href) with UUID-rejection refine, fail-closed SAFE_FALLBACK_SPEC, and Bedrock-compatible committed artifacts emitting from a single TS source of truth.

## What Was Built

### Task 1: Three Allowlist Schemas + DataBinding/Action + Safe-Fallback

Established the complete TypeScript contract layer at the Zod schema level:

**`generation/allowed-procedures.ts`** — `ALLOWED_PROCEDURES` as a readonly const tuple of 9 query-only tRPC procedures (D-13b). No wildcards, no admin procedures, no mutation procedures.

**`schema/data-binding-schema.ts`** — `DataBindingSchema`: strict object with `procedure: AllowedProcedureSchema` and `params?: z.record(z.string(), z.union([string,number,boolean]))` plus a `.refine(noUuidValues)` that rejects any param value matching the RFC-4122 UUID regex (GR-15/D-13a). Prevents literal row IDs from leaking across users via model-generated specs.

**`schema/action-schema.ts`** — `ActionSchema = z.discriminatedUnion("type", [navigate, setState, mutate])`. Navigate enforces two guards: `startsWith("/")` AND regex rejection of `^([a-z][a-z0-9+-.]*:|//)` (catches javascript:, data:, https://, //, etc). SetState accepts a key (max 64 chars) and primitive value. Mutate uses `AllowedMutationSchema = z.never()` with `ALLOWED_MUTATIONS = [] as const` — the branch is grammar-present but binds no live procedure (SEAM-02).

**`schema/safe-fallback-spec.ts`** — `SAFE_FALLBACK_SPEC: SpecRoot` is a static, deeply-frozen object: `{ v:1, root: { type: "alert", title: "Could not generate a view for this request" } }`. No data, state, bindings, or actions. SpecRootSchema.safeParse validates it successfully (GEN-03/D-07).

**`schema/spec-schema.ts` (modified)** — `ButtonNodeSchema` gains `onClick: ActionSchema.optional()` (NEW field, not overloading Phase-12 `action:string`). `SpecRootSchema` gains `bindings: z.record(z.string(), DataBindingSchema).optional()`. Phase-12 MAX_SPEC_NODES/MAX_SPEC_DEPTH refines unchanged (SAFE-06).

**`schema/__tests__/allowlists.test.ts`** — 40 tests covering all 6 acceptance criteria + bounds regression.

### Task 2: Bedrock Artifact Emit Script + Committed Artifacts + CI Freshness Test

**`generation/artifact-builder.ts`** — Pure functions: `buildSpecSchema()` converts `SpecRootSchema` via `zodToJsonSchema(SpecRootSchema, { name: "SpecRoot", $refStrategy: "none", target: "jsonSchema7" })` then applies `ensureAdditionalPropertiesFalse()` post-processor. `buildGenuiPromptPayload()` returns `{ registryVersion, components: toCompactCatalog(NAUTA_CATALOG), allowedProcedures: [...ALLOWED_PROCEDURES], actionRules }`. Both are pure (no filesystem) — shared by the emit script and freshness test.

**`scripts/emit-bedrock-artifacts.ts`** — Calls the pure functions and writes `artifacts/spec.schema.json` + `artifacts/genui-prompt.json`. Idempotent (byte-identical re-runs).

**`artifacts/spec.schema.json`** — 22 occurrences of `additionalProperties:false`. Contains the component-type enum (all 10 registered types) and the ALLOWED_PROCEDURES enum. Recursive nodes (card.children, list.itemTemplate, conditional.then/else) resolve to `any` with `$refStrategy:none` — this is acceptable for Bedrock which treats `any` as unconstrained.

**`artifacts/genui-prompt.json`** — Compact catalog (10 entries), 9 allowed procedures, REGISTRY_VERSION content-hash, action-rules summary text.

**`generation/__tests__/artifacts.test.ts`** — 12-test CI drift gate: verifies committed files deep-equal freshly generated payloads; checks additionalProperties:false presence; verifies component-type enum; verifies no external $ref; verifies allowedProcedures match constant.

## Test Results

```
src/__tests__/demo-specs.test.ts        (25 tests)  20ms
src/__tests__/manifest.test.ts          (30 tests)  18ms
src/schema/__tests__/allowlists.test.ts (40 tests)  24ms
src/__tests__/render-node.test.tsx      (41 tests)  407ms
src/generation/__tests__/artifacts.test.ts (12 tests) 17ms
Test Files  5 passed (5)
      Tests  148 passed (148)
```

Typecheck: 0 errors.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| DataBindingSchema rejects non-allowlisted procedure | PASS (test 1-5 in allowlists suite) |
| DataBindingSchema rejects UUID-shaped param value | PASS (test 6-10) |
| Navigate rejects javascript:/external/non-slash href | PASS (test 11-20) |
| Mutate cannot name any procedure (ALLOWED_MUTATIONS empty) | PASS (test 21-25) |
| SAFE_FALLBACK_SPEC passes SpecRootSchema.safeParse | PASS (test 26-30) |
| Unregistered node type fails safeParse | PASS (test 31-40) |
| spec.schema.json + genui-prompt.json emitted from Zod | PASS |
| CI drift gate fails if artifacts stale | PASS (artifacts.test.ts) |
| additionalProperties:false >= 2 occurrences | PASS (22 occurrences) |
| No external $ref in spec.schema.json | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion for root additionalProperties:false was too strict**
- **Found during:** Task 2 GREEN phase (first test run)
- **Issue:** Test checked `schema["additionalProperties"] === false` on the wrapper object `{ "$ref": "#/definitions/SpecRoot", "definitions": {...} }` — the wrapper does not have the property; the inner `SpecRoot` definition does.
- **Fix:** Updated the test to check either the wrapper or `definitions.SpecRoot` has the property (the test now reflects the actual zod-to-json-schema `{ name }` output format).
- **Files modified:** `packages/genui/src/generation/__tests__/artifacts.test.ts`
- **Commit:** `37da20a` (part of GREEN commit)

**2. [Rule 3 - Blocking] generation/index.ts initially referenced non-existent artifact-builder**
- **Found during:** Task 1 (pre-existing from session context)
- **Issue:** `generation/index.ts` exported from `./artifact-builder` which did not exist in Task 1 scope — TypeScript threw TS2307.
- **Fix:** Stripped artifact-builder exports from `generation/index.ts` during Task 1; re-added in Task 2 once `artifact-builder.ts` was created.
- **Files modified:** `packages/genui/src/generation/index.ts`
- **Commits:** `56fedca` (Task 1), `37da20a` (Task 2)

### Out-of-scope observations (deferred)

Recursive references in SpecRootSchema (card.children, list.itemTemplate, conditional.then/else) produce `"any"` in the JSON Schema with `$refStrategy:none`. This is Bedrock-safe (unconstrained slots) but means Bedrock cannot enforce structural constraints on nested nodes via constrained decoding. This is a known limitation of the `$refStrategy:none` approach and is acceptable for v1.1.

## TDD Gate Compliance

- RED: `test(13-01): add RED failing artifacts freshness drift-gate tests` — commit `b511caa` (12 tests, all FAIL due to missing artifact files)
- GREEN: `feat(13-01): Bedrock artifact emit script + committed artifacts + CI freshness test` — commit `37da20a` (12 tests, all PASS after `pnpm gen:artifacts`)
- REFACTOR: No refactor needed — code is clean from GREEN.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns beyond what the plan documented. The artifact files are static committed build outputs.

## Self-Check: PASSED

Files created/exist:
- packages/genui/src/generation/allowed-procedures.ts: FOUND
- packages/genui/src/schema/data-binding-schema.ts: FOUND
- packages/genui/src/schema/action-schema.ts: FOUND
- packages/genui/src/schema/allowlists.ts: FOUND
- packages/genui/src/schema/safe-fallback-spec.ts: FOUND
- packages/genui/src/generation/artifact-builder.ts: FOUND
- packages/genui/scripts/emit-bedrock-artifacts.ts: FOUND
- packages/genui/artifacts/spec.schema.json: FOUND
- packages/genui/artifacts/genui-prompt.json: FOUND
- packages/genui/src/schema/__tests__/allowlists.test.ts: FOUND
- packages/genui/src/generation/__tests__/artifacts.test.ts: FOUND

Commits exist:
- 56fedca: feat(13-01): three allowlist schemas + DataBinding/Action + safe-fallback — FOUND
- b511caa: test(13-01): add RED failing artifacts freshness drift-gate tests — FOUND
- 37da20a: feat(13-01): Bedrock artifact emit script + committed artifacts + CI freshness test — FOUND
