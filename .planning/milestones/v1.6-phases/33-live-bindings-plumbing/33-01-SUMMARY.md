---
phase: 33-live-bindings-plumbing
plan: 01
subsystem: chat-canvas
tags: [genui, data-bindings, trpc, tanstack-query, tdd]
dependency-graph:
  requires: []
  provides:
    - "apps/web/src/app/chat/_canvas/use-data-bindings.ts: useDataBindings hook + STALE_TIME_MS lookup"
  affects:
    - "apps/web/src/app/chat/_canvas/genui-panel-node.tsx (consumed by 33-02, not wired this plan)"
tech-stack:
  added: []
  patterns:
    - "compile-time switch over an allowlisted procedure union, explicit runtime default arm (not a never-cast) documented as a deliberate reviewed boundary"
    - "params-from-render-context convention for by-id procedures; explicit field-allowlist pass-through (never a blind spread) for list/graph procedures"
    - "degrade-to-{} on parse/streaming/schema failure, never throw"
key-files:
  created:
    - apps/web/src/app/chat/_canvas/use-data-bindings.ts
    - apps/web/src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx
  modified: []
decisions:
  - "api.useQueries's tuple-inferring generic signature cannot type a dynamic, runtime-length, heterogeneous query array (5 structurally different procedures) built from a streamed spec's variable binding count — narrowed api.useQueries to a hand-rolled DataBindingsQueryProxy call signature via one documented `as unknown as` cast at a single declaration site, proven safe by the test suite (not a library bug, a real generic-variance limitation of tuple-typed useQueries designed for static literal-array call sites)"
  - "Interfaces section assumed `t.<router>.<procedure>.queryOptions(input, opts)`; the installed @trpc/react-query v11 useQueries proxy calls the leaf directly (`t.<router>.<procedure>(input, opts)`, no .queryOptions sub-method) — implementation and test mock both follow the installed library's actual shape"
metrics:
  duration: "~13 minutes"
  completed: 2026-07-08
---

# Phase 33 Plan 01: use-data-bindings hook Summary

Standalone `useDataBindings` hook resolving genui `spec.bindings` into live tRPC query data via a compile-time switch over the 5 wired allowlisted procedures, with render-context-only params for the 3 by-id procedures and per-procedure staleTime tiers — built and tested in isolation, zero wiring into the renderer chain (that's 33-02).

## What Was Built

`apps/web/src/app/chat/_canvas/use-data-bindings.ts` exports:

- **`useDataBindings({specJson, isStreaming, panelData})`** — the hook. Parses `specJson`'s top-level `bindings` field via a lenient JSON parse (falling back to `attemptRepairJson`, imported from the locked `genui-part-boundary.tsx`, never modified) + `z.record(z.string(), DataBindingSchema).optional().safeParse`. Any failure at any step (malformed JSON, unrepairable truncation, schema validation) degrades to `{}` — the hook never throws. For each surviving binding entry, a compile-time `switch (binding.procedure)` dispatches to exactly 5 wired cases (`entities.byId`, `entities.list`, `emails.detail`, `knowledge.byId`, `knowledge.graph`); the `default` arm is an explicit, documented runtime skip (matches the 4 other `ALLOWED_PROCEDURES` entries that are schema-valid but not wired this phase) rather than a `never`-cast, per the plan's own Task 2 action text (which supersedes the more aspirational "never-typed default" language in the interfaces section for this installed trpc-react-query version).
- **`STALE_TIME_MS`** — `Record<WiredProcedure, number>` lookup: `knowledge.byId`/`knowledge.graph` = 10_000, `entities.byId`/`entities.list` = 30_000, `emails.detail` = 60_000.
- **`extractBindings`** (also exported, pure helper) — the JSON-parse + safeParse pipeline described above, usable standalone.
- **`UseDataBindingsArgs`** interface (`specJson`, `isStreaming`, `panelData`).

Params-from-context enforcement (BIND-01's core control):
- `entities.byId` sources `id` from `panelData.selectedEntityId`; `emails.detail` from `panelData.selectedEmailId`; `knowledge.byId` from `panelData.selectedNodeId`. When absent, the query is built with `enabled: false` (never fires) and the binding resolves to `undefined`.
- `entities.list` passes an explicit field allowlist (`search`, `sort`, `status`, `limit`, `offset`, `entityTypeId`) from `binding.params` — never a blind spread.
- `knowledge.graph` passes `includeInstances`/`includeEmails`/`nodeTypes` from `binding.params`, but `importerId` is ALWAYS `panelData.importerId ?? DEFAULT_IMPORTER_ID` (local duplicate of the constant, mirrors `knowledge-graph.tsx:130`'s own documented precedent) — `binding.params.importerId` is never read, even though `DataBindingSchema`'s UUID refine already blocks it at parse time (defense-in-depth, two independent layers, T-33-02).

Query results are merged back into a `Record<bindingName, unknown>` keyed by the original binding names, each value being the resolved query's `.data` (naturally `undefined` while loading/erroring — the "loading value inside the merged data" posture from 33-CONTEXT.md, zero new chrome).

## Key Technical Decision: the `api.useQueries` type boundary

The plan's interfaces section assumed `t.<router>.<procedure>.queryOptions(input, opts)`. The installed `@trpc/react-query@11.8.0` `useQueries` proxy (`createUseQueries`, confirmed by reading `node_modules/@trpc/react-query/src/shared/proxy/useQueriesProxy.ts`) calls the leaf function directly — `t.<router>.<procedure>(input, opts)`, no `.queryOptions` sub-method. Implementation and the test's `FAKE_T` proxy were both written against the installed library's real shape (Rule 1 — bug/API-mismatch fix, not a deviation from intent).

Separately, `api.useQueries`'s real TypeScript signature infers a fixed *positional tuple* type from the callback's return expression — designed for a statically-known literal-array call site (`api.useQueries((t) => [t.a.x(...), t.b.y(...)])`). This hook instead builds a dynamic, runtime-length array (the binding count varies with however many entries the streamed spec has declared so far) mixing 5 procedures with structurally different `TQueryFnData` generics. TypeScript's tuple inference cannot express that shape; unifying the 5 branches' distinct `UseTRPCQueryOptions<...>` instantiations into one array type failed on generic-parameter variance (specifically the `enabled` option's function-typed variant, even though every value passed here is a plain boolean). Resolution: a single, narrowly-scoped `useBindingQueries = api.useQueries as unknown as (callback: (t: DataBindingsQueryProxy) => readonly unknown[]) => readonly DataBindingsQueryResult[]` cast at one declaration site, documented in-file with the full reasoning, verified safe by the 12-test suite (the cast only erases an over-constrained compile-time generic — the underlying runtime object shape from `createUseQueries`'s proxy is unaffected).

## Verification

- `cd apps/web && npx vitest run src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx` — 12/12 green.
- `npm run typecheck -w apps/web` (`tsc --noEmit`) — clean.
- `grep -n "setInterval\|setTimeout.*poll" use-data-bindings.ts` — no matches (no bespoke polling).
- `git diff --stat` against the 3 locked renderer files (`spec-renderer.tsx`, `render-node.tsx`, `genui-part-boundary.tsx`) and `allowed-procedures.ts` — zero changes (SC2/SC5 confirmed empty diff).
- No `console.log`; named exports only; explicit types on every export.
- `package.json`/`package-lock.json` diff — clean (zero new npm dependencies).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `t.<router>.<procedure>.queryOptions(...)` does not exist in the installed trpc-react-query version**
- **Found during:** Task 2, first `npm run typecheck -w apps/web` run.
- **Issue:** The plan's interfaces section documented a `.queryOptions(input, opts)` sub-method on each router leaf handed to `api.useQueries`'s callback. The installed `@trpc/react-query@11.8.0` proxy (verified by reading its source under `node_modules/@trpc/react-query/src/shared/proxy/useQueriesProxy.ts`) calls the leaf directly: `t.<router>.<procedure>(input, opts)`.
- **Fix:** Implementation calls `t.entities.byId(...)` etc. directly (no `.queryOptions`); the test's `FAKE_T` mock was updated to match (`makeProcedureCall` returns a plain function, not `{queryOptions: fn}`).
- **Files modified:** `apps/web/src/app/chat/_canvas/use-data-bindings.ts`, `apps/web/src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx`.
- **Commit:** f8bd670.

**2. [Rule 3 - Blocking] `api.useQueries`'s tuple-typed generic signature rejects a dynamic heterogeneous query array**
- **Found during:** Task 2, `npm run typecheck -w apps/web` (multiple rounds of generic-variance errors across the 5 procedure branches).
- **Issue:** `api.useQueries`'s TypeScript signature infers a positional tuple from a literal array return expression; this hook's `entries.flatMap(...)`-built array (length varies per render, 5 structurally different procedure generics) cannot be expressed as a tuple, and unifying the branches' distinct `UseTRPCQueryOptions<...>` instantiations failed compile-time variance checks (observed on the `enabled` option specifically) despite correct runtime behavior.
- **Fix:** Added a narrow, documented `DataBindingsQueryProxy`/`DataBindingsQueryResult` structural type pair and a single `as unknown as` cast (`useBindingQueries`) at one declaration site — narrows `api.useQueries` to the hook's actual dynamic-array call pattern. Full reasoning documented in-file; correctness proven by the 12-test suite (no other file/call site uses this cast).
- **Files modified:** `apps/web/src/app/chat/_canvas/use-data-bindings.ts`.
- **Commit:** f8bd670.

**3. [Rule 1 - Bug] Test mock returned stub data for `enabled:false` queries**
- **Found during:** Task 2, first GREEN run (2/12 tests failing).
- **Issue:** The test's `useQueriesMock` returned `RESULTS[key]` regardless of a query's `enabled` flag, so a same-keyed enabled query earlier in the same test polluted a later disabled-query assertion (test bug, not implementation bug — the hook itself was correctly building `enabled:false` query descriptors).
- **Fix:** Mock now short-circuits to `{data: undefined, isLoading: false, isError: false}` whenever `q.enabled === false`, mirroring TanStack's own idiom.
- **Files modified:** `apps/web/src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx`.
- **Commit:** f8bd670.

No architectural deviations (Rule 4) — no user decision required.

## Known Stubs

None. This plan produces a standalone, fully-tested hook with no UI surface; it is not yet consumed anywhere (33-02 wires it into `genui-panel-node.tsx`), so there is no stub-data-in-UI risk to track.

## Threat Flags

None. All security-relevant surface (by-id param sourcing, importerId sourcing, malformed-input handling) is exactly what the plan's `<threat_model>` (T-33-01, T-33-02, T-33-03) already anticipated and this plan implements as specified — no new surface introduced beyond the threat register.

## Self-Check: PASSED

- `apps/web/src/app/chat/_canvas/use-data-bindings.ts` — FOUND
- `apps/web/src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx` — FOUND
- Commit `4207125` (test RED) — FOUND in `git log --oneline --all`
- Commit `f8bd670` (feat GREEN) — FOUND in `git log --oneline --all`
- `git diff --stat` for the 3 locked renderer files + `allowed-procedures.ts` — empty (zero changes)
- `npm run typecheck -w apps/web` — clean
- `npx vitest run src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx` — 12/12 passed
