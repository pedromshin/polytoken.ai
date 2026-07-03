---
phase: 12-catalog-spec-schema-and-trusted-interpreter
plan: "04"
subsystem: genui-demo
tags: [genui, demo-specs, studio-preview, ssr-island, sidebar-nav, d-17, d-18, d-19, d-20, spec-06]
dependency_graph:
  requires: ["12-01", "12-02", "12-03"]
  provides: ["SHOWCASE_SPEC", "MALFORMED_SPEC", "/studio/preview", "Studio nav"]
  affects: ["apps/web", "packages/genui"]
tech_stack:
  added:
    - "@nauta/genui/demo subpath export (./demo: ./src/demo/index.ts)"
  patterns:
    - "TDD RED/GREEN (test commit + implementation commit per task)"
    - "dynamic(ssr:false) island pattern (mirrors knowledge-graph-island)"
    - "Server component passes serializable SpecRoot to client island; COMPONENT_REGISTRY stays client-side via default prop"
    - "REGISTRY_VERSION consumed server-side only (Node.js crypto must not enter browser bundle)"
key_files:
  created:
    - packages/genui/src/demo/showcase-spec.ts
    - packages/genui/src/demo/malformed-spec.ts
    - packages/genui/src/demo/index.ts
    - packages/genui/src/__tests__/demo-specs.test.ts
    - apps/web/src/app/studio/preview/page.tsx
    - apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
  modified:
    - packages/genui/package.json
    - apps/web/package.json
    - apps/web/src/components/app-sidebar.tsx
decisions:
  - "D-22 strict schemas require removing all non-schema fields: aria-label, aria-hidden, and label were absent from StackNodeSchema, SeparatorNodeSchema, KeyValueListNodeSchema respectively"
  - "COMPONENT_REGISTRY excluded from server-to-island prop to avoid Next.js serialization error (Zod schema classes are not serializable); SpecRenderer default param handles it internally"
  - "Task 4 browser visual verification deferred — user asleep during autonomous overnight run; automated gates (85 tests, typecheck, web:build) all green"
metrics:
  duration: "~19 minutes (03:17 RED commit to 03:36 Task 3 commit)"
  completed: "2026-06-27"
  tasks_completed: 4
  tasks_total: 4
  files_created: 6
  files_modified: 3
---

# Phase 12 Plan 04: Showcase Specs + /studio/preview Route + Studio Nav Summary

Hardcoded SHOWCASE_SPEC + MALFORMED_SPEC exported from @nauta/genui/demo, validated by 25 TDD tests; /studio/preview server page mounts the SpecRenderer ssr:false island side-by-side with the read-only JSON inspector; Studio live nav item added to AppSidebar — all verified by 85/85 tests passing, typecheck clean, and Next.js production build green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing demo-specs tests | 859da3a | packages/genui/src/__tests__/demo-specs.test.ts |
| 1 (GREEN) | SHOWCASE_SPEC + MALFORMED_SPEC + ./demo export | 350632e | showcase-spec.ts, malformed-spec.ts, demo/index.ts, package.json |
| 2 | /studio/preview route + SpecRenderer island | a06f124 | page.tsx, spec-renderer-island.tsx, apps/web/package.json |
| 3 | Studio live sidebar nav item | 450e092 | app-sidebar.tsx |
| 4 | Automated verification (deferred browser visual) | — | No new files |

## Verification Results

### Automated (all green)

- **85/85 tests** pass across 3 test files: demo-specs.test.ts (25), manifest.test.ts (30), render-node.test.tsx (30)
- **genui typecheck**: `tsc --noEmit` clean
- **apps/web typecheck**: `tsc --noEmit` clean
- **web:build**: Next.js production build green; `/studio/preview` emits as `○ (Static)` 3.92 kB / 130 kB First Load JS

### Deferred — Human Visual Verification

Task 4 was a `checkpoint:human-verify` requiring browser inspection. The user explicitly directed the autonomous overnight run to NOT block and to defer visual verification. The following checks are outstanding for morning review:

1. Start dev server: `cd apps/web && npm run dev` (or `pnpm dev` from repo root)
2. Visit http://localhost:3000/studio/preview
3. Confirm sidebar shows "Studio" (FlaskConical icon) as a live nav item; active-highlight applies
4. LEFT pane: confirm real @nauta/ui components render — text heading, badge, separator, button, alert, card with key-value-list, table, grid, list, conditional
5. RIGHT pane: confirm spec JSON displayed in monospace; header chip reads "Registry " + 8 hex chars
6. Drag resize handle — panes redistribute
7. (Optional) Wire MALFORMED_SPEC to a separate view to confirm one-node error isolation while siblings render normally (automated proof already in render-node.test.tsx)

The automated build/typecheck/test gates confirm no regressions and the route compiles correctly. Visual confirmation is the only remaining step.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unrecognized fields from SHOWCASE_SPEC (strict schema enforcement)**
- **Found during:** Task 1 GREEN — `SpecRootSchema.safeParse(SHOWCASE_SPEC).success` was false
- **Issue:** SHOWCASE_SPEC initially included `aria-label` on stack/grid/button nodes, `aria-hidden` on the separator node, and a `label` field on key-value-list. All Zod schemas use `.strict()` (D-22) — any unrecognized key causes parse failure.
- **Fix:** Removed `aria-label`, `aria-hidden`, and `label` fields from their respective nodes in showcase-spec.ts. Audit of spec-schema.ts confirmed none of these fields are declared in the strict schemas.
- **Files modified:** packages/genui/src/demo/showcase-spec.ts
- **Commit:** 350632e

**2. [Rule 1 - Bug] Removed COMPONENT_REGISTRY from server-to-client prop**
- **Found during:** Task 2 — web:build failed with `Error occurred prerendering page "/studio/preview"` — "Only plain objects... can be passed to Client Components... Classes or null prototypes are not supported"
- **Issue:** COMPONENT_REGISTRY was initially imported in page.tsx and passed as a `registry` prop to SpecRendererIsland. COMPONENT_REGISTRY contains Zod schema instances (class instances with methods) which Next.js cannot serialize across the server/client boundary.
- **Fix:** Removed COMPONENT_REGISTRY import from page.tsx entirely. Removed `registry` prop from SpecRendererIslandProps. SpecRenderer already defaults to `registry = COMPONENT_REGISTRY` internally, so the island works without it being passed as a prop.
- **Files modified:** apps/web/src/app/studio/preview/page.tsx, apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
- **Commit:** a06f124

**3. [Rule 2 - Bug] Fixed ComponentRegistry import path**
- **Found during:** Task 2 — TypeScript error `'"@nauta/genui/registry"' has no exported member named 'ComponentRegistry'`
- **Issue:** ComponentRegistry type is exported from @nauta/genui/catalog, not @nauta/genui/registry (registry exports COMPONENT_REGISTRY the value, catalog exports ComponentRegistry the type).
- **Fix:** Corrected import path. Ultimately eliminated when registry prop was removed entirely (deviation 2).
- **Files modified:** apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
- **Commit:** a06f124

## Known Stubs

None — SHOWCASE_SPEC is fully wired data (not placeholder values). The SpecRenderer renders real @nauta/ui components. The JSON inspector renders the actual spec. No deferred data sources.

The only deferred item is the browser visual verification in Task 4 (autonomous run — user asleep), documented above.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. T-12-15 mitigated: REGISTRY_VERSION consumed in server page.tsx (uses Node.js crypto) and NOT passed to the client island. T-12-14 mitigated: demo specs flow through the createElement-only interpreter (no eval path). T-12-16 accepted: JSON inspector shows hardcoded generic showcase data (no PII/secrets).

## TDD Gate Compliance

- RED gate: commit 859da3a (`test(12-04): add failing demo-specs tests for SHOWCASE_SPEC + MALFORMED_SPEC`)
- GREEN gate: commit 350632e (`feat(12-04): author SHOWCASE_SPEC + MALFORMED_SPEC demo specs + ./demo export`)

Both gates present. RED-first discipline confirmed.

## Self-Check: PASSED

Files created/modified:
- [x] packages/genui/src/demo/showcase-spec.ts — FOUND
- [x] packages/genui/src/demo/malformed-spec.ts — FOUND
- [x] packages/genui/src/demo/index.ts — FOUND
- [x] packages/genui/src/__tests__/demo-specs.test.ts — FOUND (from RED commit 859da3a)
- [x] apps/web/src/app/studio/preview/page.tsx — FOUND
- [x] apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx — FOUND
- [x] apps/web/src/components/app-sidebar.tsx — FOUND (FlaskConical + Studio entry)

Commits:
- [x] 859da3a — test(12-04): add failing demo-specs tests (RED)
- [x] 350632e — feat(12-04): author SHOWCASE_SPEC + MALFORMED_SPEC + ./demo export (GREEN)
- [x] a06f124 — feat(12-04): /studio/preview route (D-19/D-20)
- [x] 450e092 — feat(12-04): add Studio live nav item (UI-SPEC §7)
