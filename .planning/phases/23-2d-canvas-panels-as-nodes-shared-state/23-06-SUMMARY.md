---
phase: 23-2d-canvas-panels-as-nodes-shared-state
plan: 06
subsystem: web-ui, canvas, state-management, genui-catalog
tags: [genui, action-registry, zustand, canvas, gap-closure]

# Dependency graph
requires:
  - phase: 23-2d-canvas-panels-as-nodes-shared-state
    plan: 05
    provides: createCanvasStore/CANVAS_STORE_MUTATIONS, usePanelData/CanvasStoreProvider, EdgePayloadSchema/DataEdge/EdgeCreationPicker
provides:
  - ButtonComponent onClick/action -> ActionRegistryContext dispatch (packages/genui catalog trigger half)
  - buildPanelActionRegistry/usePanelActionRegistry — the STATE-01 write bridge (apps/web canvas handler half)
  - panelFieldOptions/sharedFieldOptions now exported from edge-creation-picker.tsx (verbatim, no behavior change)
  - panel-data-flow.test.tsx — the end-to-end unmocked proof VERIFICATION.md demanded
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ButtonComponent mirrors FormComponent's exact ActionRegistry consumption contract: useContext(ActionRegistryContext) + registry[key]?.(payload) in try/catch, imported from the standalone action-registry-context.ts (never spec-renderer.tsx) to avoid the manifest<->renderer cycle"
    - "panel-action-bridge.ts registers ONLY setState (navigate/query-refresh omitted — a memoized canvas node body shouldn't carry router/tRPC deps and STATE-01/02 doesn't require them; unresolved action IDs already resolve to SpecRenderer's safe noop default). The mutation argument passed to either dependency is ALWAYS the literal \"set\" string — never smuggles an arbitrary reducer"
    - "shared.-prefix namespace routing: a setState key starting with \"shared.\" routes to the raw store's mutate(); any other key routes to the panel-scoped usePanelData().dispatch() — this is the ONLY namespace-selection logic in the bridge"
    - "zustand v5's useShallow (replacing the deprecated 3-arg useStore equality-fn form) is REQUIRED wherever a selector allocates a new object (e.g. usePanelData's incoming-edges overlay) — omitting it breaks useSyncExternalStore's snapshot-stability contract and infinite-loops on the very first render"
    - "A file with 'use client' JSX must explicitly `import * as React from \"react\"` even when only named hooks are used — Next.js's SWC automatic-JSX-runtime tolerates the omission, but vitest's plain esbuild transform (no @vitejs/plugin-react in this repo's vitest.config.ts) does not, and fails with a runtime ReferenceError only when a test actually mounts the component"

key-files:
  created:
    - packages/genui/src/__tests__/button-action.test.tsx
    - apps/web/src/app/chat/_canvas/panel-action-bridge.ts
    - apps/web/src/app/chat/_canvas/__tests__/panel-action-bridge.test.ts
    - apps/web/src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx
  modified:
    - packages/genui/src/catalog/manifest.ts
    - apps/web/src/app/chat/_components/genui-part-boundary.tsx
    - apps/web/src/app/chat/_canvas/genui-panel-node.tsx
    - apps/web/src/app/chat/_canvas/edge-creation-picker.tsx
    - apps/web/src/app/chat/_canvas/canvas-store-context.tsx

key-decisions:
  - "onClick (the Phase-13 ActionSchema object) takes precedence over the legacy string `action` ActionRegistry key when a button node somehow carries both — onClick is checked first, action is only consulted when onClick is undefined"
  - "The bridge's ONLY registered handler is setState — navigate/mutate/query-refresh are intentionally absent (mutate is unreachable anyway since ALLOWED_MUTATIONS=[] / SEAM-02); documented in the file header so a future reader doesn't mistake this for an oversight"
  - "Two pre-existing bugs in 23-05's canvas-store-context.tsx were found live while writing the Task 3 end-to-end test and fixed as Rule-1/Rule-3 auto-fixes (not part of this plan's stated file list, but directly blocking the task): (1) missing `import * as React from \"react\"` — the file's JSX only ever ran under Next's SWC auto-runtime and had never been mounted by a vitest test before; (2) usePanelData's incoming-edges overlay branch always allocated a new object every selector call, breaking useSyncExternalStore's snapshot-stability contract and infinite-looping ANY target panel with a live incoming edge in the real running app, not just in this test — fixed with zustand v5's useShallow plus a stable EMPTY_PANEL_DATA constant for the never-written-yet case"
  - "The plan's phase-level <verification> item 1 literally greps for the substring `\\.dispatch\\(`; this implementation instead destructures `dispatch` as a bare identifier and threads it through `usePanelActionRegistry(dispatch)`, so that literal substring only appears in a docstring. The SUBSTANTIVE claim — a production call site outside test files invoking the store's write mutation — is independently confirmed via the exact pattern the ORIGINAL verifier's failing probe used (`mutate(` outside canvas-store.ts/canvas-store-context.tsx/__tests__): `panel-action-bridge.ts:90` (`store.getState().mutate(mutation, path, value)`) is a genuine hit. Task 2's own acceptance criteria (`grep -c \"dispatch\"` >= 1, no dot required) are satisfied exactly as written. No code was renamed purely to chase the literal grep text."

requirements-completed: [STATE-01, STATE-02]

# Metrics
duration: ~55min
completed: 2026-07-05
---

# Phase 23 Plan 06: Gap Closure — Panel Action Write Bridge (STATE-01/02) Summary

**A genui-spec button's `onClick`/`action` now fires through `ActionRegistryContext` into a new per-panel `setState`-only bridge that routes writes through the existing bounded 5-mutation grammar — closing the verifier's "zero production call site" gap and proving, with an unmocked end-to-end test, that one panel's click populates the store, the picker's own field-discovery lists it, and a data-carrying edge live-feeds the target panel across successive writes.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed (all `type="auto" tdd="true"`, each with a RED commit followed by a GREEN commit)
- **Files created:** 4 (1 genui test, 1 bridge module + its test, 1 end-to-end test)
- **Files modified:** 5 (manifest.ts, genui-part-boundary.tsx, genui-panel-node.tsx, edge-creation-picker.tsx, canvas-store-context.tsx)

## Accomplishments

- **Task 1 — ButtonComponent wired to the ActionRegistry seam (the trigger half, TDD):** `packages/genui/src/catalog/manifest.ts`'s `ButtonComponent` no longer discards its validated `onClick`/`action` props. It now imports `ActionRegistryContext` from the standalone `action-registry-context.ts` module (never `spec-renderer.tsx`, avoiding the manifest↔renderer import cycle — the same precedent `form-component.tsx` already established) and mirrors that file's exact consumption contract: `registry[onClick.type]?.(onClick)` — or, when `onClick` is absent, `registry[action]?.()` for the legacy string key — inside a `try/catch` so a throwing handler can never crash the button. `onClick` takes precedence over `action` when both are present. Five tests in `button-action.test.tsx` mount the REAL `SpecRenderer` (not a mock) with a valid `SpecRoot` button node and click the rendered DOM button via `createRoot` + `act` + native `.click()` — proving the object-action dispatch, the legacy string-key dispatch, onClick-over-action precedence, and two safe-default cases (no `actions` prop; a throwing handler). RED (`76bc886`) → GREEN (`d054b78`). Full genui suite: 472/472 green; `tsc --noEmit` clean; `spec-renderer.tsx` byte-identical (git status empty, last touching commit still `ecc7a46` from Phase 19).

- **Task 2 — Panel action bridge + canvas wiring (the handler half, TDD):** New `apps/web/src/app/chat/_canvas/panel-action-bridge.ts` exports `buildPanelActionRegistry(deps)` (pure) and `usePanelActionRegistry(dispatch)` (hook). The registry has exactly one key, `setState`, whose handler narrows the payload (mirrors `action-handlers.ts`'s own setState narrowing: non-null object, `key` a non-empty string) and routes by namespace prefix — a `shared.`-prefixed key calls `deps.mutateShared("set", key, value)` (the raw store's `mutate`), any other key calls `deps.dispatchPanel("set", key, value)` (`usePanelData().dispatch`, scoped to `panels.{panelId}.*`). The mutation argument passed to either dependency is ALWAYS the literal `"set"` string. `genui-part-boundary.tsx` gained an additive `actions?: ActionRegistry` prop forwarded verbatim to all 3 existing `SpecRenderer` call sites (finalized / streaming-full-parse / streaming-partial-tree). `genui-panel-node.tsx`'s `GenuiPanelNodeBody` now destructures `dispatch` (previously silently discarded) and builds `usePanelActionRegistry(dispatch)`, threading the resulting registry into `GenuiPartBoundary`. Ten unit tests (`panel-action-bridge.test.ts`) cover panel-routing, shared-routing, six shapes of malformed payload (all no-op, never throw), the frozen single-key registry, and the always-`"set"` mutation invariant. RED (`935e3ed`) → GREEN (`4c5165f`). Full `apps/web` chat suite: 94/94 green (84 pre-existing + 10 new); `tsc --noEmit` clean.

- **Task 3 — End-to-end proof (TDD, non-TDD additive pre-step):** `edge-creation-picker.tsx`'s module-private `panelFieldOptions`/`sharedFieldOptions` were exported verbatim (two `export` keywords added, zero body changes — confirmed via `git diff`, exactly two changed lines) so the new test asserts against the picker's OWN field-discovery functions, not a reimplementation. `panel-data-flow.test.tsx` builds one real `createCanvasStore()`, mounts a `SourcePanelHarness` (mirrors `GenuiPanelNodeBody`'s exact production wiring: `usePanelData` → `usePanelActionRegistry` → `GenuiPartBoundary`) and a `TargetPanelHarness` (`usePanelData("panel-b", [{sourcePath:"panels.panel-a.choice", targetKey:"input"}])`) under one `CanvasStoreProvider`, and proves, with zero mocks: (1) baseline — `panelFieldOptions` returns `[]` before any interaction; (2) clicking "Pick B7" writes `panels.panel-a.choice` = `"B7"`; (3) `panelFieldOptions` now returns exactly `["panels.panel-a.choice"]`; (4) the target panel's `data.input` resolves to `"B7"` live, with NO remount; (5) clicking "Pick C2" re-resolves the SAME target span to `"C2"` — proving a live subscription, not a one-shot snapshot. A manual negative control (temporarily withholding the `actions` prop from the source harness) confirmed the test genuinely fails without the bridge wired, then was restored — not part of the committed diff. RED (`cd7b299`) → GREEN (`a0a50f7`).

  **Two pre-existing bugs surfaced live while writing this test and were fixed as Rule-1/Rule-3 auto-fixes in `canvas-store-context.tsx`** (see Deviations below) — both were latent defects in 23-05's shipped code that this plan's first-ever direct React-mount of these hooks/providers exposed.

  Final gates: `apps/web` chat suite 95/95 green; `packages/genui` suite 472/472 green; both `tsc --noEmit` clean; `next build` compiles (`/chat` route unchanged at 124 kB / 330 kB First Load JS); no-eval grep on `_canvas` (excl. `__tests__`) = 0 matches; `spec-renderer.tsx` untouched (`git status --porcelain` empty; `git log` shows no Phase-23/23-06 commit touching it).

## Task Commits

Each task was committed atomically (RED then GREEN):

1. **Task 1 RED: add failing test for button action dispatch** — `76bc886` (test)
1. **Task 1 GREEN: wire button onClick/action to the ActionRegistry seam** — `d054b78` (feat)
2. **Task 2 RED: add failing test for panel action bridge** — `935e3ed` (test)
2. **Task 2 GREEN: bridge panel actions into the canvas store write path** — `4c5165f` (feat)
3. **Task 3 RED: add failing end-to-end panel-write-to-edge data-flow test** — `cd7b299` (test)
3. **Task 3 GREEN: prove end-to-end panel write -> edge -> live target resolution** — `a0a50f7` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

All 3 tasks carry `tdd="true"`. Gate sequence verified in git log for each: a `test(...)` commit (RED) precedes a `feat(...)` commit (GREEN) with no intervening unrelated commits. No REFACTOR-phase commit was needed for any task (implementations were minimal and clean on first pass). Compliant.

## Files Created/Modified

- `packages/genui/src/__tests__/button-action.test.tsx` — 5 tests proving the real SpecRenderer→ButtonComponent→ActionRegistry path
- `packages/genui/src/catalog/manifest.ts` — `ButtonComponent` now consumes `ActionRegistryContext`; `onClick`/`action` wired to `handleClick`
- `apps/web/src/app/chat/_canvas/panel-action-bridge.ts` — `buildPanelActionRegistry`, `usePanelActionRegistry`, `PanelActionBridgeDeps`
- `apps/web/src/app/chat/_canvas/__tests__/panel-action-bridge.test.ts` — 10 unit tests
- `apps/web/src/app/chat/_components/genui-part-boundary.tsx` — additive `actions` prop forwarded to all 3 `SpecRenderer` call sites
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` — `GenuiPanelNodeBody` now consumes `dispatch` via `usePanelActionRegistry`
- `apps/web/src/app/chat/_canvas/edge-creation-picker.tsx` — `panelFieldOptions`/`sharedFieldOptions` exported (2-line additive change only)
- `apps/web/src/app/chat/_canvas/__tests__/panel-data-flow.test.tsx` — the end-to-end unmocked proof
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx` — added explicit `React` import; wrapped `usePanelData`'s selector in `useShallow` + a stable `EMPTY_PANEL_DATA` constant (bug fixes, see Deviations)

## Decisions Made

See `key-decisions` in frontmatter. Summarized: `onClick` beats the legacy string `action` key on precedence; the bridge registers ONLY `setState` (navigate/mutate/query-refresh intentionally absent, documented in the file header); two pre-existing `canvas-store-context.tsx` bugs (missing React import, unstable `useSyncExternalStore` snapshot) were found and fixed live during Task 3; the phase-level verification's literal `\.dispatch\(` grep text doesn't match this implementation's naming (bare `dispatch` identifier, not a dotted call), but the equivalent original-verifier probe pattern (`mutate(` outside definition/tests) is independently confirmed to hit real production code, and Task 2's own looser `grep -c "dispatch"` acceptance criterion passes exactly as written — no code was renamed purely to chase grep text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `canvas-store-context.tsx` had no explicit `React` import**
- **Found during:** Task 3, first time any test directly mounted `<CanvasStoreProvider>` in a live React tree
- **Issue:** The file's JSX (`<CanvasStoreContext.Provider>`, `<CanvasEdgesContext.Provider>`) compiled fine under Next.js's SWC automatic-JSX-runtime in the real app, but crashed with `ReferenceError: React is not defined` under vitest's plain esbuild transform (this repo's `vitest.config.ts` has no `@vitejs/plugin-react`, so `.tsx` files fall back to esbuild's classic JSX transform, which requires `React` in scope)
- **Fix:** Added `import * as React from "react";` alongside the existing named-hook imports — zero behavior change, matches the convention every other JSX-bearing file in this codebase already follows (`genui-part-boundary.tsx`, `form-component.tsx`, etc.)
- **Files modified:** `apps/web/src/app/chat/_canvas/canvas-store-context.tsx`
- **Commit:** `a0a50f7`

**2. [Rule 1 - Bug] `usePanelData`'s incoming-edges overlay branch allocated an unstable snapshot, infinite-looping any target panel with a live edge**
- **Found during:** Task 3, mounting `TargetPanelHarness` (a panel WITH an incoming edge) for the first time
- **Issue:** `{ ...own, ...overlay }` allocates a brand-new object on EVERY selector invocation, regardless of whether the underlying values actually changed. `useSyncExternalStore` (which `zustand`'s `useStore` is built on) requires the snapshot getter to return a reference-stable value when nothing changed, or it re-renders forever chasing a "changed" snapshot — this is a genuine pre-existing production bug from 23-05, not a test-only artifact: ANY `GenuiPanelNode` with a live incoming data-carrying edge would have hit this the moment it rendered twice in a row.
- **Fix:** Wrapped the selector in zustand v5's `useShallow` (the modern replacement for the deprecated 3-arg `useStore(api, selector, equalityFn)` form) so a shallow-equal recomputation returns the PREVIOUS reference instead of a new one; also introduced a module-level `EMPTY_PANEL_DATA` constant for the "panel has never written anything yet" case (the same class of bug, simpler root cause — `?? {}` allocates a fresh literal every call).
- **Files modified:** `apps/web/src/app/chat/_canvas/canvas-store-context.tsx`
- **Commit:** `a0a50f7`

---

**Total deviations:** 2 auto-fixed pre-existing bugs (both in `canvas-store-context.tsx`, both Rule 1/3, both directly blocking Task 3's end-to-end test, both documented with root cause and fix above) — no scope creep, no architectural changes, no files touched outside the plan's stated `files_modified` list except this one (which was a necessary, minimal, zero-architecture-change bug fix in a file the plan's own Task 2/3 already depend on and partially describe).

## Issues Encountered

None beyond the two auto-fixed bugs documented above.

## User Setup Required

None. No new dependencies, no schema changes, no env vars — this plan is pure application-code wiring on top of 23-05's already-deployed-locally store/edge mechanism.

## Known Stubs

None. Every artifact this plan touches is fully wired and exercised by a real, unmocked test.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated (T-23-14 ButtonComponent click dispatch, T-23-15 panel-action-bridge setState routing, T-23-16 click-storm DoS accepted, T-23-SC no new packages) — all implemented exactly as dispositioned:
- T-23-14 — clicks resolve ONLY via `registry[key]` lookup (default `{}` → noop); no eval/Function; try/catch so a throwing handler can't crash the tree; `ALLOWED_MUTATIONS` stays `[]`.
- T-23-15 — the bridge emits ONLY the literal `"set"` mutation into the store's bounded `mutate`; paths confined to `panels.{panelId}.*`/`shared.*`; `FORBIDDEN_KEYS` segments no-op inside `mutate` (canvas-store.ts, unchanged); values constrained to primitives by `ActionSchema` at spec-validation time.
- T-23-16 — writes flow through the zustand store; only subscribed panels re-render via `usePanelData` selectors (now correctly memoized via `useShallow`) — never `setNodes`/full-canvas relayout.
- T-23-SC — no new packages installed this plan.

## Next Phase Readiness

- **Phase 23 (2D Canvas + Panels-as-Nodes + Shared State) is now genuinely, observably complete.** All 5 ROADMAP success criteria (CANVAS-01..04, STATE-01/02) are satisfied end-to-end, not just at the plumbing level — 23-VERIFICATION.md's two `missing:` items are both closed by this plan's Tasks 1–3.
- The `usePanelActionRegistry`/`buildPanelActionRegistry` bridge pattern (spec-authored action → allowlisted registry key → the ONE bounded write surface) is now the reusable template for any future phase wiring a NEW spec-authored trigger into ANY state store (e.g. Phase 24's dual-channel widget round-trips) — never a second ad-hoc write path.
- The `useShallow` fix is a general lesson for this codebase: any future `usePanelData`-style selector that allocates a computed (non-identity) object MUST wrap in `useShallow` or an equivalent memoized-equality selector, or it will silently infinite-loop the moment a real UI component mounts it (unit tests over the pure store logic alone will never catch this class of bug — only a live React-mount test will).

---
*Phase: 23-2d-canvas-panels-as-nodes-shared-state*
*Completed: 2026-07-05*
