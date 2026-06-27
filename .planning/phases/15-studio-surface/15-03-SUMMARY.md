---
phase: 15
plan: "03"
subsystem: studio-surface
tags:
  - genui
  - studio
  - generation-sandbox
  - four-state-chrome
  - spec-renderer-island
dependency_graph:
  requires:
    - 15-02  # SpecRendererIsland shared island, StudioTabs shell, CatalogBrowserIsland
    - 15-01  # deriveGenerationState helper, GenerateOutputSchema flat shape
    - 13-04  # buildActionRegistry, api.genui.generate tRPC procedure
  provides:
    - GenerationStateChrome (four-state visual chrome driven by deriveGenerationState)
    - GenerationSandboxIsland (intent -> generate -> 55/45 render+JSON split)
    - SpecRendererIsland extended with optional actions prop
  affects:
    - apps/web/src/app/studio/ (sandbox tab replaces placeholder)
tech_stack:
  added: []
  patterns:
    - "enabled:false + await refetch() manual query trigger (D-06)"
    - "buildActionRegistry with minimal declaredState seam for sandbox context (SEAM-02)"
    - "55/45 ResizablePanelGroup mirroring /studio/preview/page.tsx (D-09)"
    - "deriveGenerationState driving four-state aria-annotated chrome (UI-SPEC §9)"
key_files:
  created:
    - apps/web/src/app/studio/_components/generation-state-chrome.tsx
    - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
  modified:
    - apps/web/src/app/studio/_components/spec-renderer-island.tsx
    - apps/web/src/app/studio/_components/studio-tabs.tsx
decisions:
  - "Minimal declaredState seam { state: {}, dispatch: () => void } passed to buildActionRegistry — SpecRenderer materialises declared state internally via useDeclaredState; the sandbox layer does not need to read or write it (D-08 / SEAM-02)"
  - "Sandbox TabsContent className changed from overflow-y-auto to flex flex-col flex-1 min-h-0 to support GenerationSandboxIsland's internal flex layout"
  - "GenerationStateChrome renders all four kinds via early return branches driven by deriveGenerationState — no inline ternaries for state mapping (D-04)"
  - "fallback kind uses role=alert (not aria-live=polite) to provide an immediate interruption announcement for screen readers (UI-SPEC §11)"
  - "Empty state shown only when !showChrome (no pending, no prior result); chrome + 55/45 split shown only after first generate trigger"
metrics:
  duration: "~35 minutes (plus context recovery overhead)"
  completed_date: "2026-06-27T13:56:25Z"
  tasks_completed: 3
  files_changed: 4
  files_created: 2
---

# Phase 15 Plan 03: Generation Sandbox + Four-State Chrome — Summary

**One-liner:** Four-state chrome driven by `deriveGenerationState` + 55/45 sandbox with `enabled:false` tRPC query + `buildActionRegistry` actions wired to `SpecRendererIsland`.

## What Was Built

### Task 1 — GenerationStateChrome + SpecRendererIsland actions prop (commit adad843)

Created `generation-state-chrome.tsx` — a thin "use client" chrome row implementing UI-SPEC §9's four visually distinct states:

- **in_progress:** `Loader2 animate-spin` + "Generating…" (`aria-live="polite"` on container; copy is "Generating…" NOT "Streaming" — D-02 honesty)
- **fallback:** destructive-tinted column (`bg-destructive/5 border-destructive/30`); `AlertTriangle` + "Validation failed — showing a safe fallback"; `role="alert"` override overrides aria-live for immediate screen-reader announcement; reason rendered as `text-xs text-muted-foreground` below when present
- **cache_hit:** teal `Badge` with `bg-primary/10 text-primary border-primary/30` — "Cache hit · 0 LLM cost" (middle dot U+00B7)
- **cold / cold+escalated:** `variant="secondary"` Badge — "Cold generation" / "Cold · escalated to Sonnet"

All four states are derived by calling `deriveGenerationState({ isPending, outcome, cacheHit, reason })` from `@nauta/genui/studio` — no inline conditionals for the mapping (D-04).

Extended `spec-renderer-island.tsx` additively with `readonly actions?: ActionRegistry` prop forwarded to `SpecRendererDynamic` (D-08). No behavioral change when `actions` is omitted — the existing showcase and catalog paths are unaffected.

### Task 2 — GenerationSandboxIsland + studio-tabs wiring (commits d034c1b, c3c23d7)

Created `generation-sandbox-island.tsx`:

- Controlled `<Textarea>` for intent input with `Enter` (no Shift) keyboard shortcut
- `<Button>` showing spinner + "Generating" while `q.isFetching`, disabled when intent is empty
- `api.genui.generate.useQuery({ intent }, { enabled: false })` — never fires automatically (D-06)
- `await q.refetch()` on Generate click — precedent from `inbox-three-pane.tsx` lines 232-246
- `buildActionRegistry({ router, trpcUtils, declaredState: { state: {}, dispatch: () => undefined } })` — minimal declaredState seam (D-08 / SEAM-02); SpecRenderer materialises declared state internally
- Empty state ("Enter an intent above…") before first generation (`!showChrome`)
- `<GenerationStateChrome>` chrome row shown once `q.isFetching || lastResult !== undefined`
- 55/45 `ResizablePanelGroup` mirroring `/studio/preview/page.tsx` verbatim (D-09):
  - Left `defaultSize={55} minSize={30}`: `SpecRendererIsland` with `actions` wired (STDO-02 / STDO-04)
  - `<ResizableHandle />` (no withHandle)
  - Right `defaultSize={45} minSize={25}`: `bg-muted` panel with "Spec JSON" heading + `ScrollArea` + `<pre>` (STDO-03)

Updated `studio-tabs.tsx`:
- Added `GenerationSandboxIsland` import
- Replaced placeholder div "Sandbox — coming in 15-03" with `<GenerationSandboxIsland />`
- Changed sandbox `TabsContent` className from `overflow-y-auto` to `flex flex-col flex-1 min-h-0` to support the island's internal flex layout

### Task 3 — Automated verification (this plan)

See section below.

## Automated Verification Results

### Typecheck (apps/web)
`tsc --noEmit` — **PASSED** (0 errors)

### Tests
- `@nauta/genui`: **180/180 passed** (includes derive-generation-state, render-node, artifacts drift gate)
- `@nauta/api-client`: **118/118 passed** (includes genui.generate contract tests CR-01/CR-02)

### Build
`next build` in `apps/web` — **PASSED** (green). `/studio` compiles as static (14.6 kB first load JS).

### Security gates
- **No-eval gate** (`eval(` / `new Function` / `dangerouslySetInnerHTML`) — **CLEAN** in all studio `_components/`. Only comments found, zero functional matches (D-15 / T-15-10 / GR-01).
- **SEAM-02** (`mutate` handler) — **CLEAN** in studio components. Only comment reference in sandbox island. `buildActionRegistry` intentionally omits mutate (verified in action-handlers.ts).
- **D-02 honesty** ("Streaming" literal) — **CLEAN**. Only appears in comment "NOT 'Streaming'" in generation-state-chrome.tsx. Rendered copy is "Generating…".
- **T-12-15** (`REGISTRY_VERSION` in client modules) — **CLEAN**. Only appears in comments in studio-tabs.tsx and catalog-browser-island.tsx. Never imported in any "use client" studio component.
- **NEXT_PUBLIC_ secret leak** — **CLEAN**. Only in comments. `EMAIL_LISTENER_API_KEY` is server-side only via `getListenerConfig()` in `generate.ts`.

### Deferred — Human Visual Verification

Per the plan's additional context directive ("DO NOT BLOCK"), the browser visual verification for Task 3 is deferred for the user to confirm at their convenience. Suggested verification steps:

1. Run `pnpm dev` in `apps/web` (or `cd apps/web && npx next dev`)
2. Visit `http://localhost:3000/studio`
3. Click the "Sandbox" tab
4. Verify the empty state displays: "Enter an intent above and click Generate to preview the rendered spec."
5. Enter an intent (e.g. "Show top 5 open threads grouped by sender with reply button")
6. Click "Generate" — verify the Generate button shows spinner + "Generating" text while pending
7. Verify `GenerationStateChrome` appears above the split with the appropriate state badge
8. Verify the 55/45 split renders: left = live SpecRenderer output, right = Spec JSON panel with scrollable `<pre>`
9. Verify the four chrome states by crafting inputs that produce fallback/cache-hit/cold/escalated outcomes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong tRPC import alias in generation-sandbox-island.tsx**
- **Found during:** Task 3 (build verification)
- **Issue:** `import { api } from "@/trpc/react"` caused "Module not found: Can't resolve '@/trpc/react'" — the correct alias in apps/web is `~/trpc/react` (tilde, not at-sign). All other web components use `~/trpc/react`.
- **Fix:** Changed import to `import { api } from "~/trpc/react"`. Build passed immediately.
- **Files modified:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
- **Commit:** c3c23d7

## Known Stubs

None. `GenerationSandboxIsland` wires the real `api.genui.generate` tRPC procedure (backed by the real FastAPI generation pipeline from Phase 13-14). `SpecRendererIsland` uses the real `COMPONENT_REGISTRY` (NAUTA_CATALOG). `buildActionRegistry` is the real handler binding. The 55/45 layout mirrors the production `/studio/preview` verbatim. STDO-02 confirmed: no stub renderer anywhere in the studio route.

## Threat Flags

No new threat surface introduced by this plan. All new files are "use client" components:
- No new network endpoints
- No new auth paths
- No new server-side file access
- No new schema changes
- All external data flows through the existing `api.genui.generate` tRPC procedure (validated at the tRPC layer by `GenerateOutputSchema`, re-validated by `SpecRootSchema.safeParse` — D-08)

## Self-Check: PASSED

Files created/exist:
- FOUND: apps/web/src/app/studio/_components/generation-state-chrome.tsx
- FOUND: apps/web/src/app/studio/_components/generation-sandbox-island.tsx
- FOUND (modified): apps/web/src/app/studio/_components/spec-renderer-island.tsx
- FOUND (modified): apps/web/src/app/studio/_components/studio-tabs.tsx

Commits exist:
- adad843: feat(15-03): add GenerationStateChrome and extend SpecRendererIsland with actions prop
- d034c1b: feat(15-03): build GenerationSandboxIsland with 55/45 split wired to genui.generate
- c3c23d7: fix(15-03): correct tRPC import path from @/trpc/react to ~/trpc/react
