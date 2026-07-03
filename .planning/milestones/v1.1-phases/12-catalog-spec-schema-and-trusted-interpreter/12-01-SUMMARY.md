---
phase: 12-catalog-spec-schema-and-trusted-interpreter
plan: "01"
subsystem: genui
tags: [schema, zod, typescript, discriminated-union, catalog, genui]
dependency_graph:
  requires: []
  provides:
    - "@nauta/genui/catalog — SpecNodeType, ManifestEntry<TProps>, ComponentRegistry"
    - "@nauta/genui/schema — SpecNodeSchema, SpecRootSchema, StateDeclarationSchema, ChildrenSchema, countNodes, specDepth, MAX_SPEC_NODES, MAX_SPEC_DEPTH, SpecNode, SpecRoot, StateDeclaration"
  affects:
    - "12-02 (imports SpecNodeType, ManifestEntry, ComponentRegistry from catalog/types.ts)"
    - "12-03 (imports SpecNode, SpecRoot, SpecNodeSchema, ChildrenSchema from schema/spec-schema.ts)"
    - "12-04 (imports SpecRootSchema for fixture validation)"
    - "Phase 13 (Bedrock-compatible: .strict() everywhere, no external $ref, v:z.literal(1) seam)"
tech_stack:
  added:
    - "@nauta/genui workspace package (packages/genui)"
    - "zod ^3.25.0 (v3 mandatory — v4 Bedrock-incompatible, D-09)"
  patterns:
    - "ZodDiscriminatedUnion with z.lazy proxy pattern (_specNodeSchemaRef forwarded after construction)"
    - "Explicit z.ZodType<SpecNode[]> annotation on ChildrenSchema (SPEC-RENDERER §9 Pitfall 1 avoidance)"
    - "Every z.object().strict() — Bedrock additionalProperties:false (D-22/COST-02)"
    - "Bound seam via .refine() + walker functions countNodes/specDepth (D-24/SAFE-06)"
key_files:
  created:
    - packages/genui/package.json
    - packages/genui/tsconfig.json
    - packages/genui/src/catalog/types.ts
    - packages/genui/src/catalog/index.ts
    - packages/genui/src/schema/spec-schema.ts
    - packages/genui/src/schema/index.ts
  modified: []
decisions:
  - "Zod v3 only (^3.25.0) — v4 breaks Bedrock structured output grammar (D-09/CURRENCY-2026)"
  - "z.lazy proxy via module-level _specNodeSchemaRef avoids circular TypeScript errors in ZodDiscriminatedUnion"
  - "ChildrenSchema defined AFTER SpecNodeSchema with explicit z.ZodType<SpecNode[]> annotation (SPEC-RENDERER §9 Pitfall 1)"
  - "table.caption and alert.title are required (not .optional()) — a11y enforcement at schema level (D-04)"
  - "StateDeclarationSchema mutation enum restricted to exactly 5 values (toggle/set/reset/increment/decrement) — no eval surface (SPEC-04)"
  - "_plan leading field reserved for Bedrock chain-of-thought, stripped before render in Phase 13 (D-22)"
  - "v:z.literal(1) at spec root — exact version enforcement, stale/forged specs fail parse (SEAM-01/D-10)"
  - "MAX_SPEC_NODES=200, MAX_SPEC_DEPTH=8 authored at seam as .refine() + walker functions (D-24/SAFE-06)"
metrics:
  duration: "~45 minutes (continuation across context reset)"
  completed_date: "2026-06-27"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 0
---

# Phase 12 Plan 01: @nauta/genui Foundation — Package Scaffold, Catalog Types, and Spec Schema Summary

Scaffolded the `@nauta/genui` workspace package and authored the two pure-contract foundation layers: `catalog/types.ts` (vocabulary types) and `schema/spec-schema.ts` (full Zod discriminated-union spec tree), both Bedrock-structured-output-compatible from day one.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold @nauta/genui workspace package | e65a23c | packages/genui/package.json, packages/genui/tsconfig.json |
| 2 | Author catalog/types.ts | 1d84766 | packages/genui/src/catalog/types.ts, packages/genui/src/catalog/index.ts |
| 3 | Author schema/spec-schema.ts | bef6dbc | packages/genui/src/schema/spec-schema.ts, packages/genui/src/schema/index.ts |

## What Was Built

**Task 1 — @nauta/genui package scaffold:**
- `package.json` with name `@nauta/genui`, version `0.1.0`, private, type `module`
- Five subpath exports: `.`, `./catalog`, `./schema`, `./registry`, `./renderer` (registry/renderer point at files Plans 02/03 create — intentional)
- `zod: "^3.25.0"` pinned to v3 (Bedrock-structured-output-compatible)
- `tsconfig.json` with `moduleResolution: bundler`, `jsx: preserve`, `strict: true`, paths aliases

**Task 2 — catalog/types.ts:**
- `SpecNodeType` — 12-member string union: text, badge, button, card, key-value-list, separator, alert, table, stack, grid, list, conditional
- `ManifestEntry<TProps>` — readonly interface per SPEC-RENDERER §4.1: type, description, example, propsSchema, lockedProps?, slots?, acceptsChildren?, component
- `AnyManifestEntry` and `ComponentRegistry` erasure types for the keyed registry map
- `catalog/index.ts` re-exporting all types

**Task 3 — schema/spec-schema.ts:**
- 12 node schemas (7 leaf + 5 container), each `z.object({...}).strict()` — 20 total `.strict()` calls
- Recursive container schemas (card, stack, grid, list, conditional) use `z.lazy(() => _specNodeSchemaRef)` proxy pattern to avoid circular TypeScript errors — container variables remain `ZodObject` instances (required by `z.discriminatedUnion`) while recursive fields are cast to `z.ZodTypeAny` at field level only
- `SpecNodeSchema = z.discriminatedUnion("type", [...12 schemas...])` assembled last, then `_specNodeSchemaRef` wired immediately
- `ChildrenSchema: z.ZodType<SpecNode[]> = z.lazy(() => z.array(SpecNodeSchema))` — explicit annotation per SPEC-RENDERER §9 Pitfall 1
- `StateDeclarationSchema` with 5-mutation restricted enum: toggle, set, reset, increment, decrement (no eval surface, SPEC-04)
- `SpecRootSchema` with: `_plan?` (reasoning field, stripped Phase 13), `v: z.literal(1)` (SEAM-01), `data?`, `state?`, `root` — all `.strict()`
- Bound refinements: `countNodes(root) <= 200` and `specDepth(root) <= 8` via `.refine()` + pure walker functions
- `table.caption` and `alert.title` are `z.string()` (NOT optional) — a11y enforcement at schema level (D-04)
- `schema/index.ts` re-exporting all schemas, types, constants, and walkers including `ChildrenSchema`

## Success Criteria Verification

- SPEC-01: typed Zod discriminated-union spec tree with layout, leaves, list, conditional. PASS
- SEAM-01: spec envelope carries `v: z.literal(1)` at the root. PASS
- SPEC-04/SPEC-05 (schema side): state primitives + dataRef strings are validated schema, no executable code representable. PASS
- COST-02 / D-22 / D-24: every object .strict(), no external $ref, bounds authored in. PASS
- tsc typecheck: `npm run typecheck -w @nauta/genui` exits clean (0 errors). PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript circular reference in initial spec-schema.ts implementation**
- **Found during:** Task 3 (first write attempt)
- **Issue:** Initial approach annotated container schema variables as `z.ZodType<SpecNode>` directly. This caused TypeScript errors: `TS2502: 'ChildrenSchema' is referenced directly or indirectly in its own type annotation`, `TS7022: implicitly has type 'any'`, `TS2456: Type alias 'SpecNode' circularly references itself`. Root cause: when a container schema variable is `z.ZodType`, it no longer satisfies `ZodDiscriminatedUnionOption<"type">` (which requires `ZodObject`), causing cascading `any` inference.
- **Fix:** Rewrote `spec-schema.ts` using a module-level proxy (`_specNodeSchemaRef: z.ZodTypeAny = z.any()`) and a `lazySpecNode` callback. Container schemas cast only individual FIELDS (not the schema variable) to `z.ZodTypeAny` via `z.lazy(lazySpecNode) as z.ZodTypeAny`. The schema variable itself remains `ZodObject`. `_specNodeSchemaRef` is wired to `SpecNodeSchema` immediately after construction. `ChildrenSchema` is defined AFTER `SpecNodeSchema` with the explicit `z.ZodType<SpecNode[]>` annotation per SPEC-RENDERER §9 Pitfall 1.
- **Files modified:** `packages/genui/src/schema/spec-schema.ts`
- **Commit:** bef6dbc

## Threat Surface Scan

No new security surface beyond what the plan's threat model covers:
- T-12-01 (Tampering via extra keys): mitigated — 20 `.strict()` calls on all schemas
- T-12-02 (DoS via deep/wide tree): mitigated — `countNodes <= 200` and `specDepth <= 8` `.refine()` + walkers
- T-12-03 (EoP via action/dataRef as code): mitigated — all `action`, `dataRef`, `valueRef` typed `z.string()` only
- T-12-04 (Spoofing via version): mitigated — `v: z.literal(1)` at root
- T-12-SC (npm install audit): no new third-party packages installed (zod/react/vitest already in monorepo)

No new threat flags found beyond plan's register.

## Self-Check: PASSED

- [x] `packages/genui/package.json` exists and name=`@nauta/genui`
- [x] `packages/genui/tsconfig.json` exists with jsx:preserve + moduleResolution:bundler
- [x] `packages/genui/src/catalog/types.ts` exists with SpecNodeType, ManifestEntry, ComponentRegistry
- [x] `packages/genui/src/catalog/index.ts` exists re-exporting types
- [x] `packages/genui/src/schema/spec-schema.ts` exists with z.literal(1), ZodType<SpecNode[]>, 20 .strict() calls, MAX_SPEC_NODES=200, MAX_SPEC_DEPTH=8, _plan, toggle/increment/decrement
- [x] `packages/genui/src/schema/index.ts` exists re-exporting all schemas + ChildrenSchema
- [x] Commits e65a23c, 1d84766, bef6dbc all present in git log
- [x] `npm run typecheck -w @nauta/genui` exits 0 (clean)
