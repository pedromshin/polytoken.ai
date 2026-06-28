---
phase: 17
plan: "03"
subsystem: genui/theme
tags:
  - design-tokens
  - themed-root
  - css-variables
  - trpc
  - style-packs
  - studio-sandbox
dependency_graph:
  requires:
    - "17-01"  # token contract + pack definitions
    - "17-02"  # STYLE_PACKS, STYLE_PACK_IDS, getStylePack
  provides:
    - ThemedRoot CSS-variable wrapper component
    - SpecRenderer ThemedRoot integration (style_pack_id branch)
    - stylePackId tRPC input field + FastAPI style_pack_id forwarding
    - Studio sandbox style-pack dropdown + Auto/Surprise + provenance badge
  affects:
    - packages/genui/src/theme/
    - packages/genui/src/renderer/spec-renderer.tsx
    - packages/api-client/src/router/genui/generate.ts
    - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
tech_stack:
  added:
    - ThemedRoot component (packages/genui/src/theme/themed-wrapper.tsx)
    - pickSurprisePack() helper (generation-sandbox-island.tsx)
  patterns:
    - CSS custom property scoping via inline style object (no !important, no eval)
    - Conditional ThemedRoot wrap in SpecRenderer (style_pack_id branch, outermost position)
    - D-08: "auto" sentinel resolved to concrete StylePackId before tRPC call
    - TDD: RED (test) commit → GREEN (feat) commit per task
key_files:
  created:
    - packages/genui/src/theme/themed-wrapper.tsx
    - packages/genui/src/theme/__tests__/themed-wrapper.test.tsx
  modified:
    - packages/genui/src/theme/index.ts
    - packages/genui/src/renderer/spec-renderer.tsx
    - packages/api-client/src/router/genui/generate.ts
    - packages/api-client/src/router/genui/__tests__/generate.test.ts
    - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
decisions:
  - "ThemedRoot uses inline style object (not CSS class injection) — CSS custom properties scoped to .nauta-themed div without global cascade contamination"
  - "ThemedRoot is outermost wrapper in SpecRenderer — ActionRegistryContext.Provider is nested inside so ThemedRoot contains the full rendered subtree"
  - "Backward-compat: when spec.style_pack_id is absent/null, SpecRenderer returns innerTree directly with zero extra DOM elements"
  - "D-08 compliant: pickSurprisePack() always returns concrete StylePackId; 'auto' sentinel never forwarded to FastAPI"
  - "StylePack.label (not .name) — confirmed field name from tokens.ts type definition"
  - "api-client dist is gitignored; types resolved from src directly via workspace exports default field"
metrics:
  duration: "~45 minutes (context-resumed)"
  completed: "2026-06-28"
  tasks_completed: 3
  tasks_deferred: 1
  files_created: 2
  files_modified: 5
  commits: 5
---

# Phase 17 Plan 03: ThemedRoot CSS-Variable Wrapper + tRPC Threading + Studio Dropdown Summary

**One-liner:** ThemedRoot component scopes 21 W3C-DTCG CSS custom properties via inline style object; SpecRenderer conditionally wraps with it; tRPC genui.generate validates stylePackId at web boundary; studio sandbox adds 6-pack Select dropdown with Auto/Surprise sentinel that resolves to concrete pack before tRPC call.

## Tasks Completed

| Task | Name | Type | Commits | Status |
|------|------|------|---------|--------|
| 1 | ThemedRoot CSS-variable wrapper + SpecRenderer integration | TDD | 988749f (RED), 0a4cdbf (GREEN) | COMPLETE |
| 2 | Thread stylePackId through tRPC genui.generate | TDD | db64f21 (RED), 10c05de (GREEN) | COMPLETE |
| 3 | Studio sandbox style-pack dropdown + Auto/Surprise | auto | 015c5a7 | COMPLETE |
| 4 | Visual verification checkpoint | checkpoint:human-verify | — | DEFERRED (see below) |

## Task 1: ThemedRoot CSS-Variable Wrapper

### What was built

`ThemedRoot` (`packages/genui/src/theme/themed-wrapper.tsx`) — a `"use client"` React component that:

- Calls `getStylePack(packId)` to retrieve the curated pack (T-17-04: unknown ids fall back to nauta-teal, never throw).
- Constructs a `Record<string, string>` of `{ "--varName": value }` pairs from `pack.resolvedVars`.
- Renders a single `<div className="nauta-themed" style={...}>` wrapper.

`SpecRenderer` extended to conditionally wrap output with `ThemedRoot` when `spec.style_pack_id` is set:
- ThemedRoot is outermost; `ActionRegistryContext.Provider` is nested inside it.
- When `style_pack_id` is absent/null: zero extra DOM elements (backward compat verified by test).

### Tests (13 passing)

Tests in `packages/genui/src/theme/__tests__/themed-wrapper.test.tsx` using `react-dom/client` + `createRoot` + `act` (no `@testing-library/react` — not installed in packages/genui).

Key contracts verified:
- Renders children, `.nauta-themed` className present
- CSS vars from `resolvedVars` match exactly (T-17-02 curated-only values)
- T-17-04: unknown packId → fallback to default pack without throwing
- GR-01: no `dangerouslySetInnerHTML` — structured DOM, not HTML injection
- All 6 packs render without error
- SpecRenderer: no `.nauta-themed` without `style_pack_id`; wraps with it when present
- Actions + style_pack_id together: ThemedRoot still outermost

## Task 2: stylePackId tRPC Threading

### What was built

`packages/api-client/src/router/genui/generate.ts`:
- Added `stylePackId: z.enum(STYLE_PACK_IDS as [string, ...string[]]).optional()` to `GenerateInput` schema — Zod validates at web boundary, unknown ids rejected before reaching FastAPI.
- Forwards `style_pack_id: input.stylePackId ?? null` in the FastAPI request body (snake_case, D-08).

### Tests (5 new, 21 total, all passing)

New describe block "genui.generate — stylePackId threading (D-08/T-17-04/Phase 17-03)":
- D-17-01/02/03: concrete pack ids forwarded correctly; omitted → `null`
- D-17-04: invalid packId rejected by Zod at runtime
- D-17-05: all STYLE_PACK_IDS accepted (dynamic loop)

## Task 3: Studio Sandbox Style-Pack Dropdown

### What was built

`apps/web/src/app/studio/_components/generation-sandbox-island.tsx`:

- `AUTO_SENTINEL = "auto"` constant — never sent to FastAPI (D-08).
- `PACK_OPTIONS`: `[{ "auto", "Auto / Surprise" }, ...STYLE_PACK_IDS.map(id => { id, STYLE_PACKS[id].label })]`
- `pickSurprisePack()` (exported): `Math.floor(Math.random() * STYLE_PACK_IDS.length)` — uniform random, always returns concrete `StylePackId`.
- `selectedPack` state (default: `DEFAULT_PACK_ID = "nauta-teal"`).
- `queryPackId` state — the concrete pack id actually sent to tRPC; resolved in `handleGenerate` via `pickSurprisePack()` when `selectedPack === AUTO_SENTINEL`.
- `<Select>` dropdown (from `@nauta/ui/select`) — all 6 packs + Auto/Surprise; disabled during generation.
- `GenerationResult` interface extended with `resolvedPackId: StylePackId` — tracks which pack was actually used.
- Pack provenance `<Badge>` displayed above rendered output showing `STYLE_PACKS[resolvedPackId].label`.

### TypeScript

`tsc --noEmit` passes clean in `apps/web`.

## Task 4: Visual Verification (Deferred — Autonomous Mode)

**Type:** `checkpoint:human-verify`

**Deferred item:** Verify ThemedRoot CSS variable scoping visually in the studio sandbox. Navigate to `/studio`, enter an intent, select a non-default pack (e.g. "Warm Editorial"), click Generate, and confirm the rendered output uses the expected color/font theming distinct from nauta-teal.

Expected visual signals per pack:
- `linear-clean`: muted blue-grey tones, Inter/system font
- `warm-editorial`: warm amber/cream tones, serif display font
- `brutalist`: near-black on white, monospace font
- `corporate-saas`: cool blue corporate palette
- `playful-rounded`: soft violet/coral with rounded corners

**Not blocking.** Deferred to UAT / next human-review session.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `StylePack.name` does not exist — should be `.label`**
- **Found during:** Task 3 typecheck
- **Issue:** `STYLE_PACKS[id].name` used in two places; `StylePack` type defines `label` not `name` (confirmed via tokens.ts)
- **Fix:** Changed both occurrences to `.label`
- **Files modified:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
- **Commit:** 015c5a7

**2. [Rule 3 - Blocking] api-client dist stale — `stylePackId` missing from tRPC input types in dist**
- **Found during:** Task 3 typecheck
- **Issue:** `packages/api-client/dist/router/genui/generate.d.ts` pre-dated the Phase 17-03 `stylePackId` addition; tRPC input type in web reported unknown property
- **Fix:** Ran `tsc` in `packages/api-client` to regenerate dist; confirmed `"default": "./src/index.ts"` in exports means the web resolves from source directly, so the dist rebuild resolved the type-only resolution for strict tsc checks
- **Outcome:** `tsc --noEmit` passes clean after rebuild (dist is gitignored, not committed)

**3. [Rule 3 - Blocking] `@testing-library/react` not installed in `packages/genui`**
- **Found during:** Task 1 test authoring
- **Issue:** `@testing-library/react` not in `packages/genui/package.json` — standard test utilities unavailable
- **Fix:** Wrote tests using `react-dom/client` (`createRoot`) + `act` from `react-dom/test-utils`; `jsdom` already configured in vitest.config.ts
- **Commit:** 988749f (RED)

**4. [Rule 1 - Bug] TypeScript TS2578 (unused @ts-expect-error) in themed-wrapper.test.tsx**
- **Found during:** Task 1 GREEN run
- **Issue:** `ThemedRoot` accepts `string` (not just `StylePackId`), so `@ts-expect-error` before unknown pack string was incorrect (error never raised)
- **Fix:** Removed the directive; passed the unknown string directly
- **Commit:** 0a4cdbf

**5. [Rule 1 - Bug] TypeScript TS2578 (unused @ts-expect-error) in generate.test.ts**
- **Found during:** Task 2 GREEN run
- **Issue:** tRPC infers types from Zod at runtime but the invalid `stylePackId` compiles without error at TS level; the @ts-expect-error was unused
- **Fix:** Cast via `as unknown as Parameters<typeof caller.genui.generate>[0]` to bypass TS and test runtime Zod rejection
- **Commit:** 10c05de

## Security Review

- GR-01 confirmed: `ThemedRoot` uses `style={}` object for CSS custom properties; no `eval`, no `new Function`, no `dangerouslySetInnerHTML` anywhere on the renderer path. Test `GR-01: no dangerouslySetInnerHTML used` passes.
- T-17-02 confirmed: all CSS values in `ThemedRoot` style come exclusively from `pack.resolvedVars` (curated at build time). Test verifies `curatedValues.has(value)` for every style declaration.
- T-17-04 confirmed: `getStylePack(unknownId)` falls back to default pack — `ThemedRoot` never throws.
- D-08 confirmed: `pickSurprisePack()` always returns concrete `StylePackId`; `AUTO_SENTINEL` ("auto") is never sent to FastAPI.
- T-14-17 / T-06-07 confirmed: `EMAIL_LISTENER_API_KEY` remains server-side only via `getListenerConfig()`.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced in this plan.

## Known Stubs

None — all 3 completed tasks are fully wired with real data sources.

## Self-Check: PASSED

Files exist:
- `packages/genui/src/theme/themed-wrapper.tsx`: FOUND
- `packages/genui/src/theme/__tests__/themed-wrapper.test.tsx`: FOUND
- `packages/genui/src/theme/index.ts` (ThemedRoot export): FOUND
- `packages/genui/src/renderer/spec-renderer.tsx` (ThemedRoot import + conditional wrap): FOUND
- `packages/api-client/src/router/genui/generate.ts` (stylePackId field): FOUND
- `packages/api-client/src/router/genui/__tests__/generate.test.ts` (5 new tests): FOUND
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` (dropdown + badge): FOUND

Commits exist:
- 988749f (RED Task 1): FOUND
- 0a4cdbf (GREEN Task 1): FOUND
- db64f21 (RED Task 2): FOUND
- 10c05de (GREEN Task 2): FOUND
- 015c5a7 (feat Task 3): FOUND
