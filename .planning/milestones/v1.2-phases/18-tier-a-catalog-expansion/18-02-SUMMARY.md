---
phase: "18"
plan: "02"
subsystem: genui/catalog
tags: [catalog, avatar, input, nav, feed-item, tabs, a11y, tdd, wire-render-lockstep]
dependency_graph:
  requires: ["18-01"]
  provides: ["avatar-catalog", "input-catalog", "nav-catalog", "feed-item-catalog", "tabs-catalog"]
  affects: ["genui/renderer", "genui/artifacts", "bedrock-prompt"]
tech_stack:
  added: ["@nauta/ui/avatar", "@nauta/ui/input", "@nauta/ui/tabs"]
  patterns: ["wire-render-lockstep", "css-variable-theming", "react-create-element", "strict-zod-schemas", "relative-href-guard"]
key_files:
  created: []
  modified:
    - packages/genui/src/catalog/manifest.ts
    - packages/genui/src/__tests__/manifest.test.ts
    - packages/genui/src/studio/__tests__/catalog-example-render.test.tsx
    - packages/genui/artifacts/spec.schema.json
    - packages/genui/artifacts/genui-prompt.json
decisions:
  - "Tabs content rendered as text fallback (Phase-19 deferral): TabsComponent reads content.content or content string — full renderNode wiring deferred to Phase 19 to avoid circular dependency between catalog and renderer"
  - "NAV_ABSOLUTE_OR_SCHEME regex inlined in manifest.ts (mirrors spec-schema.ts) to avoid circular import between catalog and action-schema"
  - "FeedItem .refine() is on the manifest propsSchema only (not wire schema) to enforce avatarAlt co-presence with avatarSrc at render time without touching spec-schema.ts"
  - "All 5 new propsSchemas match wire NodeSchemas field-for-field (wire/render lockstep, Phase-17 lesson)"
  - "TabItem.content typed as z.infer<typeof SpecNodeSchema> — SpecNodeSchema imported from spec-schema.ts (no circular dependency: spec-schema.ts does not import manifest.ts)"
  - "readOnly:true on Input defaultValue — value prop treated as display hint, not controlled state; interactive wiring deferred to Phase 19"
metrics:
  duration_seconds: 2334
  completed_at: "2026-07-01T03:29:14Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 18 Plan 02: Avatar, Input, Nav, Feed-Item, Tabs Catalog Entries Summary

Five fully-real domain catalog entries (avatar, input, nav, feed-item, tabs) added to NAUTA_CATALOG with strict Zod schemas matching wire NodeSchemas field-for-field, real React components using CSS-variable theming, and CI-validated examples.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Avatar + Input entries (TDD GREEN) | 559b511 | manifest.ts, manifest.test.ts, catalog-example-render.test.tsx, artifacts/* |
| 2 | Nav + Feed-Item + Tabs entries (TDD GREEN) | 559b511 | manifest.ts (same commit — all 5 entries share one atomic implementation) |

Note: Both tasks were committed together because all 5 entries modify the same manifest.ts file and splitting would create an intermediate broken state where tests fail on partial entries.

## What Was Built

**avatar** (`@nauta/ui/avatar` wrapper):
- `alt` required (D-04); `src` optional; `size` enum sm/md/lg with Tailwind className map
- AvatarFallback shows first 2 chars of `alt` when `src` absent or broken
- CSS-variable classes: `text-foreground`, `bg-muted`

**input** (`@nauta/ui/input` + `<label>` wrapper):
- `label` and `name` both required; `inputType` enum matches `InputNodeSchema`
- `id` derived from `name` slug for `htmlFor` association
- `value` prop sets `defaultValue` (read-only at render time; Phase-19 wires interactive state)

**nav** (house-built `<nav><ul><li><a>`):
- `aria-label` required (landmark identification)
- `items[].href` must start with `/` and must not match `_NAV_ABSOLUTE_OR_SCHEME` regex (inlined from spec-schema.ts pattern)
- `active:true` → `aria-current="page"` + highlighted bg-muted styling
- Runtime safety: absolute URLs stripped to `/` before rendering

**feed-item** (house-built flex-row card):
- `title` required; `avatarSrc`+`avatarAlt` co-presence enforced via `.refine()`
- Optional leading Avatar (uses AvatarImage + AvatarFallback)
- `unread:true` → `bg-muted` background + `font-semibold` title
- Uses `Badge` from `@nauta/ui/badge` for optional badge prop

**tabs** (`@nauta/ui/tabs` wrapper):
- `aria-label` required; `tabs[].value` + `tabs[].label` + `tabs[].content: SpecNodeSchema` required
- `defaultValue` defaults to `tabs[0].value` when absent
- Content rendered as text string in Phase 18 (Phase-19 deferral documented)
- No `onValueChange` (presentational-only per PATTERNS.md spec)

## Test Results

All tests pass after implementation:
- `catalog-example-render.test.tsx`: 33 tests passed (1 count + 16 SpecRootSchema + 16 render — zero `[!]` fallback markers)
- `manifest.test.ts`: 43 tests passed (16 example→propsSchema validations + 7 new D-04 negative tests + registry hash tests)
- `tsc --noEmit`: no errors
- Bedrock artifacts re-emitted: `spec.schema.json` and `genui-prompt.json` updated to reflect 16 entries

## Deviations from Plan

### PLAN.md Wire Schema Discrepancies (auto-corrected per wire/render lockstep rule)

The actual wire schemas in `spec-schema.ts` (18-01) differ from the PLAN.md descriptions in several fields. The render propsSchemas were written to match the ACTUAL wire schemas (ground truth), not the PLAN.md descriptions:

**1. [Rule 1 - Bug] Avatar: no `fallback` field in wire schema**
- PLAN.md described: `{alt, src?, size?, fallback?}`
- ACTUAL wire schema (AvatarNodeSchema): `{alt, src?, size?}` — NO `fallback`
- Fix: propsSchema has `{alt, src?, size?}`; fallback text derived from `alt.slice(0,2)` in component
- Files modified: manifest.ts

**2. [Rule 1 - Bug] Input: `name` required, uses `inputType` not `type`**
- PLAN.md described: `{label, defaultValue?, inputType?, ...}`
- ACTUAL wire schema (InputNodeSchema): `{label, name, inputType?, placeholder?, value?, disabled?}`
- Fix: propsSchema has `{label, name, inputType?, placeholder?, value?, disabled?}`; `name` is required
- Files modified: manifest.ts

**3. [Rule 1 - Bug] Nav: `active` (not `current`), no `orientation`**
- PLAN.md described: `{aria-label, items[{label, href, icon?, current?}], orientation?}`
- ACTUAL wire schema (NavNodeSchema): `{aria-label, items[{label, href, icon?, active?}]}` — `active` not `current`, NO `orientation`
- Fix: propsSchema uses `active: z.boolean().optional()`; no `orientation`
- Files modified: manifest.ts

**4. [Rule 1 - Bug] FeedItem: `body`/`timestamp`/`badge`/`unread` (no `meta`, no `avatarFallback`)**
- PLAN.md described: `{title, subtitle?, meta?, avatarSrc?, avatarFallback?, ...}`
- ACTUAL wire schema (FeedItemNodeSchema): `{title, subtitle?, body?, timestamp?, avatarSrc?, avatarAlt?, badge?, unread?}` — NO `meta`, NO `avatarFallback`; `avatarAlt` instead of `avatarFallback`
- Fix: propsSchema matches actual wire schema exactly
- Files modified: manifest.ts

**5. [Rule 1 - Bug] Tabs: `defaultValue` (not `active`), `content` is SpecNode (not string)**
- PLAN.md described: `{aria-label, tabs[{value, label, content: string}], active?}`
- ACTUAL wire schema (TabsNodeSchema): `{aria-label, tabs[{value, label, content: z.lazy(lazySpecNode)}], defaultValue?}`
- Fix: propsSchema uses `content: SpecNodeSchema`; prop is `defaultValue`
- Files modified: manifest.ts

### Auto-added: Artifact Re-emission

The plan did not explicitly call for running `gen:artifacts` but the Bedrock artifacts (spec.schema.json, genui-prompt.json) must reflect the 16-entry catalog for the generation prompt to include new components. Re-emitted as part of the commit.

## Phase-19 Deferrals (Presentational-Only)

Per PATTERNS.md Section 5 and plan spec:
- **Tabs**: `TabsContent` renders SpecNode content as a text string fallback. Full `renderNode(tab.content)` wiring deferred to Phase 19 to avoid a circular dependency between `catalog/manifest.ts` and `renderer/render-node.tsx`.
- **Nav**: No active-state management (presentational only). Phase 19 will wire router-aware `active` detection.
- **Input**: No controlled state, no `onChange`. Phase 19 will wire form state management.

## Known Stubs

None — all 5 entries render real content from their props. The Tabs "text fallback" for `content` is intentional and documented as a Phase-19 deferral, not a stub blocking plan completion. The plan goal (5 catalog entries with correct propsSchemas, real components, CI-validated examples) is fully achieved.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. The nav href relative-guard (`_NAV_ABSOLUTE_OR_SCHEME` regex) mitigates open-redirect at render time.

## Self-Check: PASSED

- [x] `packages/genui/src/catalog/manifest.ts` — modified (11→16 entries, 5 new type declarations, 5 new components, 5 new NAUTA_CATALOG entries)
- [x] `packages/genui/src/__tests__/manifest.test.ts` — modified (count 11→16, 7 new D-04 negative tests)
- [x] `packages/genui/src/studio/__tests__/catalog-example-render.test.tsx` — modified (count 10→16)
- [x] `packages/genui/artifacts/spec.schema.json` — updated (16-entry wire schema)
- [x] `packages/genui/artifacts/genui-prompt.json` — updated (16-entry catalog prompt)
- [x] Commit `559b511` exists in git log
- [x] All 33 catalog-example-render tests pass
- [x] All 43 manifest tests pass
- [x] `tsc --noEmit` clean
