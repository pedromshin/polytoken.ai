---
phase: "18-tier-a-catalog-expansion"
plan: "18-01"
subsystem: "genui/catalog"
tags: ["catalog", "spec-schema", "renderer", "tdd", "phase-18"]
dependency_graph:
  requires: []
  provides:
    - "SpecNodeType union extended with 6 new literals (avatar, input, nav, feed-item, tabs, section)"
    - "Wire schemas for all 6 new types in spec-schema.ts discriminated union"
    - "colSpan field on all 18 wire node schemas"
    - "Grid colSpan rendering: children wrapped in div style.gridColumn span N"
    - "Section manifest entry: NAUTA_CATALOG now has 11 entries"
  affects:
    - "packages/genui/src/catalog/types.ts"
    - "packages/genui/src/schema/spec-schema.ts"
    - "packages/genui/src/renderer/render-node.tsx"
    - "packages/genui/src/catalog/manifest.ts"
    - "packages/genui/src/__tests__/render-node.test.tsx"
    - "packages/genui/src/__tests__/manifest.test.ts"
tech_stack:
  added:
    - "SectionComponent: house-built React.createElement <section> with flex flex-col layout"
    - "NAV_ABSOLUTE_OR_SCHEME regex guard inlined in spec-schema.ts"
    - "z.lazy(lazySpecNode) recursive children for SectionNodeSchema and TabsNodeSchema"
  patterns:
    - "Zod discriminatedUnion: all options must be ZodObject (no ZodEffects — GOTCHA-2)"
    - "inputType field (not type) for input variant to avoid discriminant collision (GOTCHA-1)"
    - "colSpan bounded clamped integer 1-12, applied via React style only (GR-01 zero-eval guarantee)"
    - "CSS-variable Tailwind tokens: text-foreground, text-muted-foreground (CTLG-09)"
key_files:
  created: []
  modified:
    - "packages/genui/src/catalog/types.ts"
    - "packages/genui/src/schema/spec-schema.ts"
    - "packages/genui/src/renderer/render-node.tsx"
    - "packages/genui/src/catalog/manifest.ts"
    - "packages/genui/src/__tests__/render-node.test.tsx"
    - "packages/genui/src/__tests__/manifest.test.ts"
decisions:
  - "FeedItemNodeSchema omits .refine() in wire schema (discriminatedUnion requires ZodObject, not ZodEffects)"
  - "input node uses inputType (not type) for variant field to avoid collision with discriminant key"
  - "SectionNodeSchema children use z.lazy(lazySpecNode).array() as z.ZodTypeAny for recursion compatibility"
  - "colSpan added to ALL 18 wire schemas (not just grid children) so wire safeParse never rejects a grid child"
  - "Nav href guard regex inlined in spec-schema.ts instead of importing from action-schema.ts (avoids circular import)"
  - "Section manifest example omits children (build-catalog-example-spec.ts injects children for acceptsChildren entries)"
  - "SectionComponent uses h2 for heading (not h3) — section is a top-level HTML landmark"
metrics:
  duration: "~90 minutes"
  completed: "2026-07-01T03:17:21Z"
  tasks_completed: 2
  files_modified: 6
---

# Phase 18 Plan 01: Tier-A Catalog Expansion — Wire Schemas + colSpan + Section Primitive Summary

SpecNodeType extended with 6 new literals, 6 Zod discriminated-union wire schemas added with a11y-required fields and SAFE-04 nav href guard, colSpan added to all 18 wire schemas, grid colSpan renderer wired via bounded style.gridColumn span N (zero eval), and section layout primitive shipped to NAUTA_CATALOG (11 entries total).

## Tasks Completed

| # | Description | Commit | Files |
|---|-------------|--------|-------|
| 1 | Extend SpecNodeType union and add 6 wire node schemas | 6d7fc98 | types.ts, spec-schema.ts, render-node.test.tsx |
| 2 | Wire grid colSpan and ship section layout primitive | 2f95147 | manifest.ts, render-node.tsx, manifest.test.ts, render-node.test.tsx |

## What Was Built

**Task 1 — SpecNodeType + wire schemas:**

- `packages/genui/src/catalog/types.ts`: Added 6 new `SpecNodeType` literals (`avatar`, `input`, `nav`, `feed-item`, `tabs`, `section`). Union now has 18 members.
- `packages/genui/src/schema/spec-schema.ts`: Added `colSpan: z.number().int().min(1).max(12).optional()` to all 10 existing node schemas. Added Section 4b with `AvatarNodeSchema`, `InputNodeSchema`, `NavNodeSchema`, `FeedItemNodeSchema`, `TabsNodeSchema`, `SectionNodeSchema`. Extended `SpecNodeSchema` discriminated union to include all 6 new schemas (18 total).

Key design decisions enforced:
- `AvatarNodeSchema`: `alt` required (a11y D-04)
- `InputNodeSchema`: `label` required; `inputType` field (not `type`) to avoid discriminant collision (GOTCHA-1)
- `NavNodeSchema`: `aria-label` required; nav items `href` must start with `/` and pass `navHrefIsSafe` (rejects `http://`, `//`, etc.) (SAFE-04)
- `FeedItemNodeSchema`: plain `.object().strict()` with NO `.refine()` — ZodEffects breaks discriminatedUnion (GOTCHA-2)
- `TabsNodeSchema`: `aria-label` required; tab content uses `z.lazy(lazySpecNode)` for recursive node support
- `SectionNodeSchema`: `children` uses `z.lazy(lazySpecNode).array() as z.ZodTypeAny` for recursion; variable remains ZodObject for discriminatedUnion compatibility (GOTCHA-3)

**Task 2 — colSpan rendering + section manifest:**

- `packages/genui/src/renderer/render-node.tsx`: `renderPositionalChildren` now wraps children with `colSpan` in a `<div style={{ gridColumn: "span N" }}>`. Props extraction loop excludes `"colSpan"` key so it never reaches `propsSchema.safeParse` (renderer lockstep).
- `packages/genui/src/catalog/manifest.ts`: Added `SectionProps` type, `SectionComponent` (house-built `<section>` element with `flex flex-col`, optional `<h2>` heading with `text-foreground` token, gap classes). Added `section` entry to NAUTA_CATALOG. Header comment updated: "11 catalog entries", "3 layout primitives: stack, grid, section".
- `packages/genui/src/__tests__/manifest.test.ts`: Updated `REGISTERED_TYPES has exactly 10 entries` to `11`.

## Verification Results

All tests pass:

- `npx tsc --noEmit`: 0 errors
- `npx vitest run src/__tests__/render-node.test.tsx`: 64/64 passed
- `npx vitest run src/__tests__/manifest.test.ts`: 31/31 passed

## Deviations from Plan

None — plan executed exactly as written. All GOTCHAs documented in the plan were anticipated and handled correctly on first attempt.

## Security Audit (GR-01 / SAFE-04)

- Zero-eval guarantee maintained: colSpan applied exclusively via `React.createElement("div", { style: { gridColumn: \`span ${colSpan}\` } }, ...)` — no eval, no Function, no dangerouslySetInnerHTML anywhere on renderer path.
- Nav href guard: `NAV_ABSOLUTE_OR_SCHEME` regex `/^([a-z][a-z0-9+\-.]*:|\/\/)/i` inlined in spec-schema.ts rejects all absolute and protocol-relative URLs. Relative-only paths enforced at wire schema level.
- colSpan bounded clamped: `Math.max(1, Math.min(12, Math.floor(rawColSpan)))` before use — no injection surface.

## Known Stubs

None — all 6 new wire schemas fully real (no stubs). The 5 new catalog components (avatar, input, nav, feed-item, tabs) are wire-schema-only in this plan (no manifest entries yet); they are scheduled for Plan 18-02 through 18-06.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes introduced in this plan. Nav href guard (SAFE-04) is a defense-in-depth addition, not a new attack surface.

## Self-Check: PASSED

- `packages/genui/src/catalog/types.ts` — FOUND (confirmed: 18 SpecNodeType literals)
- `packages/genui/src/schema/spec-schema.ts` — FOUND (confirmed: 18-entry discriminated union)
- `packages/genui/src/renderer/render-node.tsx` — FOUND (confirmed: colSpan wrapper + strip)
- `packages/genui/src/catalog/manifest.ts` — FOUND (confirmed: 11 entries, SectionComponent)
- Task 1 commit 6d7fc98 — FOUND
- Task 2 commit 2f95147 — FOUND
