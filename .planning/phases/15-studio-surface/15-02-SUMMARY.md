---
phase: 15
plan: "02"
subsystem: studio-surface
tags: [studio, catalog, nextjs, client-island, ssr-false, tabs]
dependency_graph:
  requires: ["15-01"]
  provides: ["/studio landing route", "CatalogBrowserIsland", "StudioTabs", "shared SpecRendererIsland"]
  affects: ["apps/web/src/app/studio/", "apps/web/src/components/app-sidebar.tsx"]
tech_stack:
  added: []
  patterns:
    - "Client island pattern (dynamic ssr:false) for Zod/React-ref-containing catalog"
    - "Server component REGISTRY_VERSION consumption with client boundary exclusion (T-12-15)"
    - "Shared 'use client' island to enforce single dynamic wrapper (STDO-02)"
key_files:
  created:
    - apps/web/src/app/studio/_components/spec-renderer-island.tsx
    - apps/web/src/app/studio/_components/studio-tabs.tsx
    - apps/web/src/app/studio/_components/catalog-browser-island.tsx
    - apps/web/src/app/studio/page.tsx
  modified:
    - apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
    - apps/web/src/components/app-sidebar.tsx
decisions:
  - "D-07: SpecRendererIsland lifted to studio/_components/ so exactly one dynamic(ssr:false) wrapper exists under apps/web/src/app/studio (STDO-02); preview/_components/ re-exports from parent"
  - "D-10: NAUTA_CATALOG imported directly in CatalogBrowserIsland client island; not passed as server props (Zod schemas and React refs cannot serialize across the server->client boundary)"
  - "D-14: sidebar Studio nav href repointed from /studio/preview to /studio (Showcase is now a tab affordance inside /studio)"
  - "T-12-15: REGISTRY_VERSION imported only in apps/web/src/app/studio/page.tsx (server component); excluded from all 'use client' modules"
  - "D-15: No eval / Function / dangerouslySetInnerHTML in any new studio file"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-27T13:40:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 2
---

# Phase 15 Plan 02: Studio Surface — /studio Route, StudioTabs, CatalogBrowserIsland

**One-liner:** /studio landing with server REGISTRY_VERSION header, Tabs client shell (Catalog | Sandbox | Showcase-link), and CatalogBrowserIsland listing all 10 NAUTA_CATALOG entries with type chip, live SpecRendererIsland preview, describePropsSchema prop table, and slot chips.

## Tasks

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Lift SpecRendererIsland + sidebar repoint | d500614 | DONE |
| 2 | /studio server shell + StudioTabs | 43a4010 | DONE |
| 3 | CatalogBrowserIsland | a441861 | DONE |

## What Was Built

### Task 1 — Lift SpecRendererIsland + sidebar repoint (d500614)

- **`apps/web/src/app/studio/_components/spec-renderer-island.tsx`** (CREATED): Canonical shared `"use client"` island holding the single `dynamic(ssr:false)` SpecRenderer wrapper. Both `/studio` and `/studio/preview` import from this location (STDO-02: exactly one wrapper under `apps/web/src/app/studio`).
- **`apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx`** (MODIFIED): Replaced full definition with re-exports (`export type { SpecRendererIslandProps }` + `export { SpecRendererIsland }`) from `../../_components/spec-renderer-island`. Existing imports in `preview/page.tsx` continue to resolve without change.
- **`apps/web/src/components/app-sidebar.tsx`** (MODIFIED): Studio nav `href` changed from `/studio/preview` to `/studio` (D-14). `isActiveRoute` already handled both paths via `pathname.startsWith(`${href}/`)`.

### Task 2 — /studio server shell + StudioTabs (43a4010)

- **`apps/web/src/app/studio/page.tsx`** (CREATED): Server component. `export const metadata` sets title/description. `main` with h-12 header (`<h1>Studio</h1>`) + ml-auto chip group (`<Badge>v1</Badge>` + `<Badge>Registry {REGISTRY_VERSION.version.slice(0,8)}</Badge>`). `REGISTRY_VERSION` imported here only — never in any client module (T-12-15). Below header: `<StudioTabs />`.
- **`apps/web/src/app/studio/_components/studio-tabs.tsx`** (CREATED): `"use client"` Tabs component. TabsList with Catalog + Sandbox `TabsTrigger`s + `next/link` to `/studio/preview` styled as the Showcase affordance (aria-label="Open Component Showcase"). TabsContent `value="catalog"` (aria-label="Component catalog") renders `<CatalogBrowserIsland />`. TabsContent `value="sandbox"` (aria-label="Generation sandbox") renders placeholder div "Sandbox — coming in 15-03".

### Task 3 — CatalogBrowserIsland (a441861)

- **`apps/web/src/app/studio/_components/catalog-browser-island.tsx`** (CREATED): `"use client"` island. Imports `NAUTA_CATALOG` directly (D-10). Filter `<input type="search">` with aria-label="Filter catalog components" and live `useState` filtering. Card grid with `aria-live="polite"` and no-results message. Per-entry `CatalogEntryCard` with four facets:
  1. `EntryCardHeader`: `Badge variant="secondary" font-mono` type chip + description `<p>`.
  2. `EntryLiveExample`: `role="region" aria-label="Live example: {type}"` wrapping shared `<SpecRendererIsland>` with `buildWrappedExample` spec `{ v:1, root: { type, props: entry.example, children:[] } }`.
  3. `EntryPropTable`: `role="region" aria-label="Props for {type}"` with `<table>` from `describePropsSchema({ propsSchema, lockedProps })` — name / typeLabel / required / locked columns.
  4. `EntrySlotChips`: `Badge variant="outline" font-mono` per slot name (null when no slots).

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit` in `apps/web`: **clean** (no errors, empty output) — verified before each commit and after all three tasks.
- STDO-02 anti-stub: `grep -rn "ssr: false" apps/web/src/app/studio/` returns exactly one code-level match (line 37 of `studio/_components/spec-renderer-island.tsx`). All others are in comments.
- D-15 no-eval: `grep -rn "dangerouslySetInnerHTML\|eval(\|new Function" apps/web/src/app/studio/` returns only the comment in `catalog-browser-island.tsx` — zero actual calls.
- T-12-15: `grep -rn "REGISTRY_VERSION" apps/web/src/app/studio/_components/` returns only comments — no actual import in any client module.
- All 10 NAUTA_CATALOG entries (text, badge, button, card, key-value-list, separator, alert, table, stack, grid) are rendered by `CatalogBrowserIsland` via `Object.values(NAUTA_CATALOG)`.

## Known Stubs

**Sandbox tab** — `apps/web/src/app/studio/_components/studio-tabs.tsx` TabsContent `value="sandbox"` renders:
```tsx
<div className="...">Sandbox — coming in 15-03</div>
```
This is an intentional placeholder per the plan ("TabsContent "sandbox" renders a placeholder"). Plan 15-03 will replace it with `GenerationSandboxIsland`. The plan's goal (Catalog tab fully wired) is fully achieved.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes were introduced. All changes are UI-layer read-only rendering of local catalog data.

## Self-Check: PASSED

- [x] `apps/web/src/app/studio/_components/spec-renderer-island.tsx` — created in Task 1, committed d500614
- [x] `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx` — modified to re-export, committed d500614
- [x] `apps/web/src/components/app-sidebar.tsx` — href repointed, committed d500614
- [x] `apps/web/src/app/studio/page.tsx` — created in Task 2, committed 43a4010
- [x] `apps/web/src/app/studio/_components/studio-tabs.tsx` — created in Task 2, committed 43a4010
- [x] `apps/web/src/app/studio/_components/catalog-browser-island.tsx` — created in Task 3, committed a441861
- [x] All three commits exist in git log: d500614, 43a4010, a441861
