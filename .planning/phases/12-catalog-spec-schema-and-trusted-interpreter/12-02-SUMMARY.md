---
phase: "12"
plan: "02"
subsystem: "@nauta/genui/catalog + @nauta/genui/registry"
tags: [catalog, component-registry, manifest, a11y, vitest, content-hash, zod]
dependency_graph:
  requires: ["12-01"]
  provides: ["NAUTA_CATALOG", "COMPONENT_REGISTRY", "REGISTRY_VERSION", "CTLG-04-CI-gate"]
  affects: ["12-03", "12-04"]
tech_stack:
  added:
    - "jsdom ^25 (vitest jsdom environment)"
  patterns:
    - "Object.freeze() for catalog immutability"
    - "React.createElement (no JSX) to keep .ts not .tsx"
    - "SHA-256 content-hash over stable JSON surface (not Zod objects)"
    - "Allowlist schema: z.enum(Object.keys(COMPONENT_REGISTRY))"
    - "compactEntry()/toCompactCatalog() SEAM for COST-03 subsetting"
key_files:
  created:
    - "packages/genui/src/catalog/manifest.ts"
    - "packages/genui/src/registry/component-registry.ts"
    - "packages/genui/src/registry/registry-version.ts"
    - "packages/genui/src/registry/index.ts"
    - "packages/genui/vitest.config.ts"
    - "packages/genui/src/__tests__/manifest.test.ts"
  modified:
    - "packages/genui/src/catalog/index.ts"
    - "packages/genui/package.json"
    - "package.json"
    - "package-lock.json"
decisions:
  - "React.createElement used in manifest.ts (not JSX) to keep file as .ts and avoid tsx compiler config"
  - "NAUTA_CATALOG uses Object.freeze at module level; COMPONENT_REGISTRY is an alias for the same object"
  - "computeRegistryHash serializes type/description/example/slots/acceptsChildren/lockedProps — not Zod schema (non-serializable)"
  - "jsdom installed at both root and packages/genui: vitest resolves env from root node_modules"
  - "SeparatorComponent passes decorative:true to underlying Separator (which owns aria-hidden internally) while accepting aria-hidden:true in locked propsSchema"
metrics:
  duration: "~45 minutes (across two sessions)"
  completed: "2026-06-27"
  tasks_completed: 3
  files_created: 6
  files_modified: 4
  tests: 30
---

# Phase 12 Plan 02: NAUTA_CATALOG Manifest + Component Registry Summary

**One-liner:** 10-entry depth-first NAUTA_CATALOG manifest with strict Zod propsSchemas, SHA-256 content-hash REGISTRY_VERSION, and 30-test CTLG-04 CI gate covering a11y hard-fail, allowlist, and hash sensitivity.

## What Was Built

### Task 1: NAUTA_CATALOG Manifest (`91ab872`)

`packages/genui/src/catalog/manifest.ts` — 10 real ManifestEntry objects covering all non-control-flow SpecNodeTypes:

| Entry | Key a11y constraint | Notable locked props |
|---|---|---|
| `text` | — | — |
| `badge` | — | — |
| `button` | `aria-label` (required, z.string()) | `type`, `onClick` |
| `card` | — | named slots: header, footer |
| `key-value-list` | `label` (required, z.string()) | — |
| `separator` | `aria-hidden: z.literal(true)` (required literal) | `aria-hidden` |
| `alert` | `title` (required, z.string()) | — |
| `table` | `caption` (required, z.string()) | — |
| `stack` | — | acceptsChildren: true |
| `grid` | — | acceptsChildren: true |

`list` and `conditional` are interpreter control-flow nodes — intentionally excluded from catalog.

All propsSchemas use `.strict()` (Bedrock additionalProperties:false — D-22/COST-02). No `dangerouslySetInnerHTML`, `ref`, or `key` in any propsSchema. Components implemented with `React.createElement` (no JSX, keeps file as `.ts`).

SEAM comment inserted at `toCompactCatalog()` call site for COST-03/D-23 subsetting.

### Task 2: COMPONENT_REGISTRY + REGISTRY_VERSION (`87abd55`)

`packages/genui/src/registry/component-registry.ts`:
- `COMPONENT_REGISTRY: ComponentRegistry = NAUTA_CATALOG` — alias for O(1) keyed lookup
- `REGISTERED_TYPES: ReadonlyArray<string>` — derived from `Object.keys`
- `RegisteredTypeSchema = z.enum(REGISTERED_TYPES)` — allowlist for validation boundary (D-06)
- `UnknownComponentPlaceholder` — role="alert" fallback, never throws (D-06/Pitfall 2)

`packages/genui/src/registry/registry-version.ts`:
- `computeRegistryHash(registry)` — SHA-256 over sorted keys + stable JSON surface
- `REGISTRY_VERSION: { catalogId: "global", version: <64-hex> }` — shape per D-21/SEAM-03

Serialization surface: `{type, description, example, slots, acceptsChildren, lockedProps}` per entry (Zod objects are not JSON-serializable; this covers all user-visible catalog surface).

### Task 3: Vitest Config + CTLG-04 CI Gate Tests (`df7fecd`)

`packages/genui/vitest.config.ts` — jsdom environment (D-20: catalog entries reference React components).

`packages/genui/src/__tests__/manifest.test.ts` — 30 tests across 4 blocks:

**Block 1 (CTLG-04):** 10 `it` tests — one per catalog entry — assert `entry.propsSchema.safeParse(entry.example).success === true`. Surfaces Zod error details on failure for fast debugging.

**Block 2 (D-04 a11y negative):** 6 tests asserting hard-fail on missing a11y props:
- button without `aria-label` → fails
- alert without `title` → fails
- table without `caption` → fails
- key-value-list without `label` → fails
- separator with `aria-hidden: "true"` (string) → fails (must be literal `true`)
- separator with `aria-hidden: true` → passes (positive case verification)

**Block 3 (D-06 allowlist):** 7 tests — RegisteredTypeSchema accepts all 10 REGISTERED_TYPES; rejects `"data-table"`, `"list"`, `"conditional"`, `""`. Asserts REGISTERED_TYPES.length === 10.

**Block 4 (D-07 content-hash):** 7 tests — determinism (same output twice), 64-char hex format, description change flips hash, added entry flips hash, REGISTRY_VERSION.catalogId === "global", version matches computeRegistryHash output, version is 64-char hex.

## Verification

- `npm run typecheck -w @nauta/genui` — exits 0, no TypeScript errors
- `npx vitest run` (from packages/genui) — 30/30 tests pass, 1 test file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jsdom not installed in workspace**
- **Found during:** Task 3 test run
- **Issue:** Vitest resolves jsdom from root `node_modules`, not the workspace package's local `node_modules`. The package wasn't installed at the root level.
- **Fix:** Added `jsdom ^25.0.1` to both `packages/genui/package.json` devDependencies (for explicitness) and installed it at the root (`npm install -D jsdom` from repo root, where vitest resolution actually looks).
- **Files modified:** `packages/genui/package.json`, root `package.json`, `package-lock.json`
- **Commit:** `df7fecd`

## Known Stubs

None. All 10 catalog entries have fully-wired React component implementations. No placeholder text, no hardcoded empty returns, no TODO props. The SEAM comment for COST-03 subsetting is intentional design documentation (the `toCompactCatalog()` export is the wire point for Phase N when catalog exceeds threshold — currently it sends all 10 entries, which is correct behavior).

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. All surface is client-side component rendering. The `computeRegistryHash` uses Node.js built-in `crypto` (no third-party dependency). No user input flows through catalog or registry.

## Self-Check: PASSED

Files exist:
- `packages/genui/src/catalog/manifest.ts` — FOUND
- `packages/genui/src/registry/component-registry.ts` — FOUND
- `packages/genui/src/registry/registry-version.ts` — FOUND
- `packages/genui/src/registry/index.ts` — FOUND
- `packages/genui/vitest.config.ts` — FOUND
- `packages/genui/src/__tests__/manifest.test.ts` — FOUND

Commits exist:
- `91ab872` feat(12-02): author NAUTA_CATALOG — FOUND
- `87abd55` feat(12-02): assemble COMPONENT_REGISTRY + REGISTRY_VERSION — FOUND
- `df7fecd` test(12-02): add vitest jsdom config + CTLG-04 manifest CI gate — FOUND
