---
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
plan: "04"
subsystem: studio-ui
tags: [page-ideas, weighted-sampler, studio-tabs, tdd, client-island]
dependency_graph:
  requires: ["16-01"]
  provides: ["pick-page-idea sampler", "PageIdeasIsland", "controlled StudioTabs", "sandbox initialIntent prop"]
  affects: ["apps/web/studio", "packages/genui/studio"]
tech_stack:
  added: []
  patterns: ["seedable weighted sampler (injected RNG)", "controlled-Tabs lift", "pendingIntent seam (D-21)", "static direct-import pattern (IDEA-01)"]
key_files:
  created:
    - packages/genui/src/__tests__/pick-page-idea.test.ts
    - packages/genui/src/studio/pick-page-idea.ts
    - apps/web/src/app/studio/_components/page-ideas-island.tsx
  modified:
    - packages/genui/src/studio/index.ts
    - apps/web/src/app/studio/_components/studio-tabs.tsx
    - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
decisions:
  - "Seedable sampler injects RNG as a parameter — pure function, deterministic in tests, Math.random at call sites only"
  - "pendingIntent string + setActiveTab are the only coordination between Page-Ideas and Sandbox (D-21 minimal lift, no global store)"
  - "initialIntent useEffect does NOT call refetch — D-06 manual Generate preserved"
  - "History TabsContent is a placeholder HistoryPlaceholder component; 16-05 replaces its child only"
  - "Page-Ideas island uses @nauta/ui/select (Select/SelectTrigger/SelectContent/SelectItem) for filter dropdowns"
metrics:
  duration: "~55 minutes"
  completed: "2026-06-27T23:56:00Z"
  tasks_completed: 3
  tasks_total: 4
  files_modified: 6
---

# Phase 16 Plan 04: Page-Ideas Tab + Weighted Sampler + Studio-Tabs Lift Summary

Pure seedable weighted sampler (curveball 3x/Tier-B 2x/Tier-A 1x), a browse/filter grid for the 76-entry real corpus (IDEA-01), and minimal controlled-Tabs lift (D-21) with pendingIntent seam to sandbox (D-06 no auto-generate).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for pickPageIdea weighted sampler | 9381383 | `packages/genui/src/__tests__/pick-page-idea.test.ts` |
| 1 (GREEN) | Implement pure seedable weighted sampler | 274eddd | `pick-page-idea.ts`, `studio/index.ts` |
| 2 | PageIdeasIsland — browse/filter 76-entry corpus | 573e09f | `page-ideas-island.tsx` |
| 3 | StudioTabs controlled lift + sandbox initialIntent | 94aa96e | `studio-tabs.tsx`, `generation-sandbox-island.tsx` |

## Verification Results

- `cd packages/genui && npx vitest run src/__tests__/pick-page-idea.test.ts` — 14/14 tests pass
- `cd apps/web && npx tsc --noEmit` — clean (no errors)
- `cd apps/web && npx next build` — success; /studio route 25.6 kB first load
- grep: zero `Math.random` calls inside `pick-page-idea.ts` (only in JSDoc comments)
- grep: zero `useQuery/fetch` in `page-ideas-island.tsx` (direct static import only)
- grep: `pendingIntent` appears 7 times in `studio-tabs.tsx`
- grep: `refetch` in `generation-sandbox-island.tsx` is ONLY in the existing `handleGenerate` handler — the new `useEffect` does NOT call refetch (D-06 preserved)
- grep: no `eval()` / `dangerouslySetInnerHTML` / unsafe `Function()` in `page-ideas-island.tsx`

## Deviations from Plan

None — plan executed exactly as written. The History tab trigger value in the plan was labelled "pageideas" in the action block but the canonical tab value used is "page-ideas" (with hyphen) throughout — this is consistent with the pattern used for TabsContent aria-label and the type alias `TabValue`, and is not a behavioral deviation.

## Deferred (Human/Connected-Environment Required)

### Browser checkpoint (checkpoint:human-verify, gate: blocking)

**What to verify:**
1. `cd apps/web && npm run dev`, open `http://localhost:3000/studio`
2. Click "Page Ideas" tab — confirm grid of real prompts with category/complexity/tier/curveball chips
3. Use filters (category, complexity, tier select + curveball-only toggle) — confirm grid narrows correctly
4. Click "Surprise me" several times — confirm it jumps to Sandbox tab with textarea pre-filled; curveballs/Tier-B should appear more frequently over several clicks
5. Click "Use this idea" on a card — confirm Sandbox opens with that prompt and NO generation fires (user must click Generate — D-06)
6. Confirm "History" tab trigger present (placeholder content); "Catalog" + "Sandbox" tabs still work

**Status:** DEFERRED — needs a running dev server and browser.

## Known Stubs

- `HistoryPlaceholder` in `studio-tabs.tsx` renders a "coming in Phase 16-05" message. This is intentional — 16-05 is the plan that wires the real history island. The stub does not block the plan's goal (Page-Ideas tab is fully functional).

## Threat Flags

None — all new surface (static-import island + controlled Tabs) was covered by the plan's threat model. No new endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

Files confirmed created/modified:
- `packages/genui/src/__tests__/pick-page-idea.test.ts` — exists
- `packages/genui/src/studio/pick-page-idea.ts` — exists
- `packages/genui/src/studio/index.ts` — modified (export added)
- `apps/web/src/app/studio/_components/page-ideas-island.tsx` — exists
- `apps/web/src/app/studio/_components/studio-tabs.tsx` — modified
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` — modified

Commits confirmed:
- 9381383 (RED test commit)
- 274eddd (GREEN implementation + barrel export)
- 573e09f (PageIdeasIsland)
- 94aa96e (StudioTabs lift + sandbox initialIntent)
