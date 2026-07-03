---
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
plan: "05"
subsystem: web/studio-history
tags: [studio, history, tRPC, genui, spec-renderer, read-only, reuse]
dependency_graph:
  requires: [16-03, 16-04]
  provides: [STDO-05, STDO-06]
  affects: [apps/web/studio]
tech_stack:
  added: []
  patterns: [tRPC-useQuery, ResizablePanelGroup-55-45, SpecRendererIsland-reuse, offset-pager, Zod-safeParse-boundary]
key_files:
  created:
    - apps/web/src/app/studio/_components/history-island.tsx
  modified:
    - apps/web/src/app/studio/_components/studio-tabs.tsx
    - packages/api-client/dist/router/genui/history.d.ts  # rebuilt — was stale pre-16-03
decisions:
  - "Read-only detail omits actions prop entirely — SpecRendererIsland defaults to empty ActionRegistryContext (noop); no buildActionRegistry in History (D-18)"
  - "Removed keepPreviousData option from historyList.useQuery — React Query v5 (tRPC v11) removed this option; pagination state managed locally via offset useState"
  - "api-client dist must be rebuilt after each new tRPC procedure addition — recurring pattern, dist is gitignored but type declarations are only present after tsc compiles the package"
metrics:
  duration_minutes: 10
  completed_date: "2026-06-28T00:10:43Z"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 2
requirements: [STDO-05, STDO-06]
---

# Phase 16 Plan 05: History Tab UI Summary

History tab UI for `/studio` — newest-first paginated master list backed by `genui.historyList` + a read-only 55/45 shared-renderer detail backed by `genui.historyById`, reusing the single production `SpecRendererIsland` (STDO-02 reuse contract intact).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | history-island.tsx — master list + read-only detail | cb69109 | apps/web/src/app/studio/_components/history-island.tsx (+474 lines) |
| 2 | Wire HistoryIsland into studio-tabs History slot | a8c163e | apps/web/src/app/studio/_components/studio-tabs.tsx (+5/-19 lines) |

## What Was Built

**Task 1 — history-island.tsx (474 lines):**

- `HistoryIsland` ("use client", named export): outer shell with `selectedId: string | undefined` state; fixed w-80 master column + flex-1 detail area
- `HistoryMasterList`: `api.genui.historyList.useQuery({ limit: PAGE_SIZE=20, offset })` with offset-based pager (Prev/Next buttons); next disabled when `rows.length < PAGE_SIZE`; `<ScrollArea>` wrapping `<ul role="list">` of `HistoryRow` buttons
- `HistoryDetailView`: `api.genui.historyById.useQuery({ id: selectedId }, { enabled: selectedId.length > 0 })`; calls `parseSpecSafe(detail.specJson)` — `SpecRootSchema.safeParse` with `SAFE_FALLBACK_SPEC` fallback (D-17 / T-16-05-T); renders 55/45 `ResizablePanelGroup` with `<SpecRendererIsland spec={spec} />` (no `actions` — read-only / D-18 / T-16-05-E) + JSON `ScrollArea/pre`
- Sub-components (all named exports, all <50 lines): `HistoryRow`, `HistoryListSkeleton`, `HistoryListEmpty`, `HistoryListError`, `DetailSkeleton`, `DetailEmpty`, `FallbackNotice` (amber `role="alert"` shown when `fallback===true`)
- Utilities: `formatRelativeTime(isoString)`, `truncate(text, maxLength)`, `parseSpecSafe(specJson)`

**Task 2 — studio-tabs.tsx slot swap:**

- Removed `HistoryPlaceholder` function (16-04 placeholder, no longer needed)
- Added `import { HistoryIsland } from "./history-island"`
- Replaced `<HistoryPlaceholder />` with `<HistoryIsland />` in History `TabsContent`
- All 16-04 controlled-Tabs wiring preserved intact (activeTab, pendingIntent, handleUseIdea, handleTabChange)

## Security / Constraint Verification

| Gate | Status |
|------|--------|
| GR-01: no eval/Function/dangerouslySetInnerHTML | CLEAN — confirmed via tsc and grep |
| STDO-02: exactly ONE dynamic(ssr:false) SpecRenderer wrapper | CLEAN — only in spec-renderer-island.tsx; History imports it as a component, no second dynamic() |
| D-18: detail is read-only — no actions prop, no Generate button | CLEAN — grep confirms no `actions=` or `genui.generate` in history-island.tsx |
| T-16-05-T: storedSpec re-parsed at web boundary | CLEAN — parseSpecSafe calls SpecRootSchema.safeParse, returns SAFE_FALLBACK_SPEC on failure |
| T-16-05-I: EMAIL_LISTENER_API_KEY server-side only | CLEAN — all calls via tRPC proxy; no direct fetch from client |
| T-16-05-E: no action surface in detail | CLEAN — actions prop omitted; SpecRendererIsland ActionRegistryContext defaults to {} |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] api-client dist was stale — historyList/historyById types missing**
- **Found during:** Task 1 verification (`tsc --noEmit`)
- **Error:** `Property 'historyList' does not exist on type 'DecorateRouterRecord<...>'` at history-island.tsx:268,270,352
- **Root cause:** `packages/api-client/dist/` was compiled before 16-03 added `history.ts`. The dist had no `history.d.ts` type declarations, so the tRPC client had no typed `genui.historyList`/`genui.historyById` procedures
- **Fix:** Rebuilt dist by running `npx --prefix packages/api-client tsc -p packages/api-client/tsconfig.json` — produced `dist/router/genui/history.d.ts` and `history.js`
- **Note:** This is a recurring pattern in this repo. Whenever new tRPC procedures are added to api-client, the dist must be rebuilt before the web app can see the new types. No code change to source files.

**2. [Rule 1 - Bug] `keepPreviousData` removed in React Query v5 — query data typed as `{}`**
- **Found during:** Task 1 verification (second `tsc --noEmit` after fixing deviation 1)
- **Error:** `'rows' is possibly 'null'` and `Property 'length' does not exist on type '{}'` at lines 274, 289, 292, 294, 327
- **Root cause:** Passed `{ keepPreviousData: true }` as the second arg to `api.genui.historyList.useQuery`. React Query v5 (used by tRPC v11) removed `keepPreviousData` — the unknown option caused the query options type to fail, making `data` resolve as `{}` instead of `HistoryRow[]`
- **Fix:** Removed the options object entirely. Pagination state is managed locally via `offset` useState, so `keepPreviousData` was unnecessary
- **Files modified:** `apps/web/src/app/studio/_components/history-island.tsx`
- **Commit:** cb69109 (included in the task commit)

## Deferred (human/connected-env)

### Task 3 — Browser-Verify the History Tab

**Status:** DEFERRED — autonomous run cannot exercise a live browser or backend.

**What was built:** The History tab is fully implemented in code — master list, pager, row-click detail via the shared production `SpecRendererIsland` in 55/45 split, safe-fallback degrade, and read-only enforcement (no Generate, no edit controls).

**Why deferred:** Task 3 (`type="checkpoint:human-verify"`, `gate="blocking"`) requires a running FastAPI backend (16-03 endpoints `/v1/genui/history` + `/v1/genui/history/{id}`), a populated `ui_spec_templates` table, and a browser. An autonomous run has none of these.

**How to verify when connected:**

1. Ensure the email-listener FastAPI service is running locally with `EMAIL_LISTENER_URL` + `EMAIL_LISTENER_API_KEY` set in `apps/web/.env.local` (same config as the Sandbox tab)
2. Ensure `ui_spec_templates` has at least one row — if empty, generate something in the Sandbox tab first
3. `cd apps/web && npm run dev`, open `http://localhost:3000/studio`, click the **History** tab
4. Confirm the master list shows past generations newest-first with intent text (truncated with full-text `title` attr), a relative timestamp ("X minutes ago"), an 8-char registry-version Badge, use_count, and a validation_status Badge
5. Confirm the Prev/Next pager works; Next is disabled when fewer than 20 rows returned; empty state ("No generations yet.") shows when the list is empty
6. Click a row — confirm the detail re-renders the stored spec on the left and its spec JSON on the right in the 55/45 split, identical in look to the Sandbox output, with NO Generate button and NO edit controls (read-only)
7. Confirm that a row whose stored spec no longer parses under the current schema degrades to the safe fallback (amber `FallbackNotice` shown at the top of the detail) rather than crashing
8. Confirm STDO-02: the rendered spec is the same component quality as the Sandbox (same `SpecRendererIsland` instance, same catalog registry)

**Resume signal:** Type `"approved"` once verified, or describe issues found.

## Known Stubs

None — all data is wired to live `api.genui.historyList` and `api.genui.historyById` tRPC procedures. No hardcoded arrays, no placeholder text in the rendered content. The "No generations yet." empty state and "Select a row to inspect its rendered spec." prompt are permanent UX copy, not data stubs.

## Threat Flags

None — no new network endpoints, no new auth paths, no new file access patterns, no schema changes introduced in this plan. All history data access flows through existing 16-03 tRPC procedures (server-side proxy, EMAIL_LISTENER_API_KEY never exposed to client).

## Self-Check: PASSED

- [x] `apps/web/src/app/studio/_components/history-island.tsx` exists (474 lines)
- [x] `apps/web/src/app/studio/_components/studio-tabs.tsx` modified — contains `HistoryIsland` import + usage
- [x] Commit cb69109 exists in git log
- [x] Commit a8c163e exists in git log
- [x] `tsc --noEmit` exit code 0 (verified during execution)
- [x] `next build` green — `/studio` at 28.8 kB (verified during execution)
- [x] STDO-02: exactly one `dynamic(` in `spec-renderer-island.tsx` (verified via grep during execution)
- [x] No `keepPreviousData` in final history-island.tsx (deviation 2 fixed)
