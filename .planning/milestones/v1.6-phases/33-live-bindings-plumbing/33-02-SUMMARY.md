---
phase: 33-live-bindings-plumbing
plan: 02
subsystem: chat-canvas, knowledge-graph
tags: [genui, data-bindings, trpc, tanstack-query, cache-invalidation, tdd]
dependency-graph:
  requires:
    - "apps/web/src/app/chat/_canvas/use-data-bindings.ts (33-01)"
  provides:
    - "apps/web/src/app/chat/_canvas/genui-panel-node.tsx: GenuiPanelNodeBody merges live binding data into panelData"
    - "apps/web/src/app/knowledge/_components/knowledge-graph.tsx: promoteEdge() — fetch + BIND-02 invalidation orchestration"
  affects:
    - "Phase 41 (Knowledge-preview canvas node) — will consume live-bound panels"
tech-stack:
  added: []
  patterns:
    - "immutable spread merge for live-data precedence ({ ...panelData, ...liveBindingData })"
    - "extract fetch+cache-invalidation orchestration into a standalone exported async function so ReactFlow-hosted logic is unit-testable without mounting the canvas (mirrors mergeGraph/tierAllowsEdge's existing pure-helper convention in this file)"
key-files:
  created:
    - apps/web/src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx
  modified:
    - apps/web/src/app/chat/_canvas/genui-panel-node.tsx
    - apps/web/src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx
decisions:
  - "Extracted handlePromote's inline fetch+invalidate logic into a standalone exported promoteEdge(edgeId, importerId, utils) function in knowledge-graph.tsx, rather than testing the plan's literal inline version via a full KnowledgeGraph render — this repo has no ResizeObserver/DOMMatrixReadOnly jsdom polyfills and no existing test mounts the real <ReactFlow> (panel-data-flow.test.tsx and interactive-widget-canvas.test.tsx both establish the precedent of reproducing a production seam locally rather than mounting the ReactFlow-hosted component); all 3 original behavior paths (success/error-toast/thrown-exception) are preserved verbatim in handlePromote, which now just calls promoteEdge and branches on its outcome"
  - "Reused the component's existing `const utils = api.useUtils();` (already declared for expandNode, line ~365) rather than adding a second declaration as the plan's action text literally suggested — a duplicate `const utils` in the same function scope would be a syntax error; handlePromote's useCallback dependency array gained `utils`"
metrics:
  duration: "~35 minutes"
  completed: 2026-07-08
---

# Phase 33 Plan 02: Wire useDataBindings + promotion invalidation Summary

Wired 33-01's standalone `useDataBindings` hook into `GenuiPanelNodeBody` (live binding data now merges over `panelData` before reaching the locked `GenuiPartBoundary`/`SpecRenderer` chain) and added event-driven `knowledge.byId`/`knowledge.graph` cache invalidation to the real `/knowledge` promotion success path — closing both BIND-01 and BIND-02, with the 3 locked renderer files proven byte-identical via an explicit `git diff --stat` check.

## What Was Built

**Task 1 — `genui-panel-node.tsx` wiring (BIND-01):**
`GenuiPanelNodeBody` now calls `useDataBindings({ specJson, isStreaming, panelData })` right after `usePanelData`, and the non-interactive-widget `GenuiPartBoundary` branch's `data` prop changed from `data={panelData}` to `data={{ ...panelData, ...liveBindingData }}` — an immutable spread merge where live binding values win on key collision (freshest source). The `InteractiveWidgetBoundary` branch (a separate D-08 surface) is untouched. Extended `panel-data-flow.test.tsx` with a `BoundPanelHarness` that reproduces `GenuiPanelNodeBody`'s exact production wiring (`usePanelData` → `useDataBindings` → merge → `GenuiPartBoundary`) over the real `CanvasStoreProvider`/`GenuiPartBoundary` seam, mocking only `~/trpc/react`'s `api.useQueries` (same `FAKE_T` proxy convention as 33-01's `use-data-bindings.test.tsx`). Two new tests: collision precedence (a `conditional` spec node observes that the live binding's value, not `panelData`'s own same-keyed value, drives the rendered branch) and a zero-bindings regression guard (no `bindings` field declared → `useDataBindings` returns `{}` → merged data renders identically to plain `panelData`).

**Task 2 — `knowledge-graph.tsx` promotion invalidation (BIND-02) + SC2 verification:**
Extracted the fetch + cache-invalidation orchestration from `handlePromote`'s inline body into a standalone exported `promoteEdge(edgeId, importerId, utils)` async function. On a successful `/api/knowledge/edges/{id}/promote` response it calls `utils.knowledge.byId.invalidate()` then `utils.knowledge.graph.invalidate()` (both no-input, invalidating every cached variant since a bound chat panel's specific id/importerId is unknown to this call site — T-33-07, accepted risk per the plan's threat register) before returning `{ ok: true }`. On a non-ok response it returns `{ ok: false, errorMessage }` WITHOUT ever touching the invalidate calls (T-33-06's core mitigation — invalidation strictly gated behind the success branch). `handlePromote` now calls `promoteEdge` with the component's pre-existing `api.useUtils()` instance and branches on the outcome; the 3 original behavior paths (optimistic edge tier patch on success / error toast on 4xx / error toast + log on thrown exception) are preserved verbatim. New `knowledge-graph-invalidate.test.tsx` (3 tests): both invalidate mocks called exactly once after a successful `fetch`; neither invalidate mock called on a `!ok` response; default error-message fallback when the `!ok` response body has no `error` field.

## Verification

- `cd apps/web && npx vitest run src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx` — 3/3 green.
- `cd apps/web && npx vitest run src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx` — 3/3 green.
- Both files run together — 6/6 green, no cross-file interference.
- `npm run typecheck -w apps/web` (`tsc --noEmit`) — clean.
- **SC2 proof artifact** — from the repo root:
  ```
  $ git diff --stat -- packages/genui/src/renderer/spec-renderer.tsx packages/genui/src/renderer/render-node.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx
  ```
  Output: **empty** (zero lines) — the 3 locked renderer files are byte-identical to their pre-plan state.
- **SC5 proof artifact** — `grep -n "\"emails.list\"\|\"emails.byId\"\|\"entityTypes.list\"\|\"knowledge.list\"" packages/genui/src/generation/allowed-procedures.ts`:
  ```
  24:  "emails.list",
  25:  "emails.byId",
  29:  "entityTypes.list",
  31:  "knowledge.list",
  ```
  All 4 non-wired entries present unchanged, confirming `ALLOWED_PROCEDURES` still lists exactly its original 9 entries.
- `git diff --stat -- package.json package-lock.json apps/web/package.json packages/genui/package.json packages/api-client/package.json` — empty (zero new npm dependencies).
- Cumulative plan diff (`git diff --stat` across both task commits) touches exactly 4 files: the 3 authoritative `files_modified` entries plus the one new test file the plan's Task 2 explicitly permitted creating.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `handlePromote`'s inline fetch+invalidate logic is untestable via a full `KnowledgeGraph` render in this repo's current test infrastructure**
- **Found during:** Task 2, planning the promote-flow test.
- **Issue:** The plan's Task 2 test spec describes mounting the promote flow and asserting on `api.useUtils()`'s invalidate mocks — implying a render of the actual `KnowledgeGraph` component (or its promote button). `KnowledgeGraph` internally mounts `<ReactFlowJSX>` (`@xyflow/react`), and this package's `vitest.config.ts` has no `setupFiles` (no `ResizeObserver`/`DOMMatrixReadOnly` jsdom polyfills). This repo's OWN existing test suite already establishes the pattern of never mounting the real `<ReactFlow>` in a unit test — `panel-data-flow.test.tsx` and `interactive-widget-canvas.test.tsx` both explicitly document reproducing a "module-private... needs React Flow context" component's wiring locally instead of rendering the ReactFlow-hosted parent.
- **Fix:** Extracted `handlePromote`'s fetch + `!response.ok` branch + invalidate calls into a standalone exported `promoteEdge(edgeId, importerId, utils)` async function (narrow `PromoteEdgeUtils` structural type, mirrors 33-01's own narrow-structural-type convention for `api.useQueries`). `handlePromote` itself is unchanged in behavior — it now delegates to `promoteEdge` and branches on the returned outcome. This mirrors `knowledge-graph.tsx`'s OWN established convention of extracting pure/testable helpers (`mergeGraph`, `tierAllowsEdge`, `shapeExplicitEdgeRow` in sibling Phase-30/32 work) rather than testing logic embedded in a ReactFlow-hosted closure.
- **Files modified:** `apps/web/src/app/knowledge/_components/knowledge-graph.tsx`.
- **Commit:** e33e4fb.

**2. [Rule 1 - Bug] Plan's literal "add `const utils = api.useUtils();`" instruction would create a duplicate declaration**
- **Found during:** Task 2, reading `knowledge-graph.tsx` before editing.
- **Issue:** The plan's action text instructs adding a new `const utils = api.useUtils();` — but `knowledge-graph.tsx` already declares `const utils = api.useUtils();` at line ~365 (for `expandNode`'s `utils.knowledge.expandNode.fetch`). A second declaration in the same function scope is a JS syntax error (`SyntaxError: Identifier 'utils' has already been declared`).
- **Fix:** `handlePromote` reuses the existing `utils` binding; its `useCallback` dependency array gained `utils` (previously it only used `selectedPopoverEdge`/`setEdges`).
- **Files modified:** `apps/web/src/app/knowledge/_components/knowledge-graph.tsx`.
- **Commit:** e33e4fb.

No architectural deviations (Rule 4) — no user decision required.

## Known Stubs

None. Both tasks wire real behavior end-to-end (live binding data reaching the render path; real invalidate calls on the real `api.useUtils()` proxy) — no placeholder/mock data reaches production code paths.

## Threat Flags

None. All security-relevant surface (invalidation-without-input's information-disclosure posture T-33-07, the SC2 locked-file drift mitigation T-33-05, the invalidate-only-after-success guard T-33-06) is exactly what the plan's `<threat_model>` already anticipated and this plan implements as specified — no new surface introduced beyond the threat register.

## Self-Check: PASSED

- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` — FOUND, contains `useDataBindings`
- `apps/web/src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx` — FOUND, contains `BoundPanelHarness`
- `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` — FOUND, contains `promoteEdge`
- `apps/web/src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx` — FOUND
- Commit `157b491` (Task 1) — FOUND in `git log --oneline`
- Commit `e33e4fb` (Task 2) — FOUND in `git log --oneline`
- `npx vitest run src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx` — 3/3 passed
- `npx vitest run src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx` — 3/3 passed
- `npm run typecheck -w apps/web` — clean
- `git diff --stat` for the 3 locked renderer files — empty (SC2 confirmed)
- `ALLOWED_PROCEDURES` grep — original 9 entries unchanged (SC5 confirmed)
