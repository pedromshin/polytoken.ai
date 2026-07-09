# Phase 33: Live Bindings Plumbing - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous (`/gsd:autonomous` — recommendations auto-accepted and documented;
primary source is the locked research `.planning/research/v1.6-chat-knowledge/SYNTHESIS.md` → Fork 1)

<domain>
## Phase Boundary

A genui canvas panel whose spec declares `bindings` renders live product data — resolved ABOVE the
renderer via a compile-time `switch` over the 5 already-allowlisted tRPC procedures
(`entities.byId`, `entities.list`, `emails.detail`, `knowledge.byId`, `knowledge.graph`), staying
fresh through TanStack staleTime tiers plus event-driven invalidation on the existing v1.5 promotion
endpoint — with ZERO edits to the three locked renderer files
(`packages/genui/src/renderer/spec-renderer.tsx`, `packages/genui/src/renderer/render-node.tsx`,
`apps/web/src/app/chat/_components/genui-part-boundary.tsx`). TypeScript only
(`apps/web/`, `packages/`); NO DB migrations; NO expansion of `ALLOWED_PROCEDURES`; NO Python work
(Phase 34 owns `apps/email-listener/` concurrently in the same tree). This phase is v1.5-independent
and gate-free — it can ship fully standalone.

</domain>

<decisions>
## Implementation Decisions

### Bindings resolution point (locked by research — Fork 1)
- New hook `apps/web/src/app/chat/_canvas/use-data-bindings.ts`, called from `GenuiPanelNodeBody`
  (`genui-panel-node.tsx`) — ABOVE `GenuiPartBoundary`/`SpecRenderer`. It resolves each
  `{procedure, params}` entry in `spec.bindings` via a **compile-time `switch` over
  `AllowedProcedure`** (exhaustive, `never`-checked default arm) — never dynamic string dispatch.
- `GenuiPanelNodeBody` merges the hook's `Record<bindingName, unknown>` result into the existing
  `panelData` before handing it to `GenuiPartBoundary`'s `data` prop:
  `{ ...panelData, ...liveBindingData }`. Live keys win on collision (bindings are the freshest
  source). Zero renderer edits — the model learns `bindings.foo` surfaces at `data.foo` in a
  `dataRef` string purely through prompt/catalog documentation, not renderer code.
- `ALLOWED_PROCEDURES` (`packages/genui/src/generation/allowed-procedures.ts`) is NOT touched — the
  switch wires exactly the 5 existing entries; a `never`-typed default case makes any future 6th
  entry a compile error until the switch is deliberately extended (defense-in-depth on top of the
  Zod enum gate that already exists).

### Getting `spec.bindings` without touching the locked files (the "known risk" from synthesis)
- `useCanvasSpec` (`canvas-spec-context.tsx`) exposes only `{specJson, isStreaming}` — a raw string,
  never the parsed `SpecRoot`. **Decision: do NOT extend `canvas-spec-context.tsx`'s public contract.**
  Instead `use-data-bindings.ts` does its own narrow, top-level parse of `specJson` scoped to just the
  `bindings` field:
  1. `JSON.parse(specJson)` in try/catch.
  2. On failure (mid-stream truncated buffer), fall back to `attemptRepairJson` — **imported** from
     `genui-part-boundary.tsx` (it is already `export function attemptRepairJson`), never duplicated,
     never modified. Importing a locked file's exported pure function is not an edit to that file.
  3. Validate the extracted `bindings` value with
     `z.record(z.string(), DataBindingSchema).optional().safeParse(...)` (`DataBindingSchema` is
     already exported from `@nauta/genui/schema`) — NOT the full `SpecRootSchema` (the `root` subtree
     may still be incomplete while `bindings` — which the schema field-orders before `root` — has
     already fully streamed in).
  4. Any parse/validate failure at any step → treat `bindings` as `{}` (tolerate
     `spec.bindings === undefined`/absent — SC1 talks about specs that DO declare bindings; a spec
     with none, or not-yet-streamed-in bindings, must render exactly as it does today).
  - Rationale for not touching `canvas-spec-context.tsx`: that file's own docstring frames it as a
    **pure passthrough** of provenance-keyed strings — "the spec text itself... is looked up... never
    lifted". Keeping parsing responsibility colocated with where `GenuiPartBoundary` already does
    identical JSON-repair work (just reusing its exported helper) is the smaller, more coherent cut,
    and leaves one fewer file in the shared-context surface for later phases to reconcile against.

### Params-from-context convention (the other named risk — degenerate-to-parameterless gap)
- Locked convention table (documented here AND as a code comment in `use-data-bindings.ts` so the
  generator-prompt/catalog-doc phase-33-adjacent-work has one source of truth to point at):
  | procedure          | required param | render-context source                                   |
  |---------------------|----------------|----------------------------------------------------------|
  | `entities.byId`      | `id`           | `panelData.selectedEntityId` (falls back: skip binding — no query fired — if absent) |
  | `emails.detail`       | `id`           | `panelData.selectedEmailId` (same fallback)              |
  | `knowledge.byId`      | `id`           | `panelData.selectedNodeId` (same fallback)                |
  | `entities.list`        | none required  | model-authored non-ID params (`status`, `search`, `sort`, `limit`, `offset`) pass through verbatim from `binding.params` — already UUID-refined by `DataBindingSchema` |
  | `knowledge.graph`       | none required  | same as `entities.list` (`importerId`, `includeInstances`, `includeEmails`, `nodeTypes`) — `importerId` is UUID-shaped so it is ALWAYS sourced from render context (`panelData.importerId` ?? the app's `DEFAULT_IMPORTER_ID`), never from `binding.params` (which cannot carry it — GR-15 rejects UUID-shaped param values) |
  - The 3 by-id procedures never fire their query when their id source is `undefined` — `useQuery`'s
    `enabled: false` gate — matching TanStack's own idiom instead of firing an errorful call with an
    empty id.
  - `panelData` here is `usePanelData(panelId, incomingEdges).data` — the SAME per-panel store slice
    (own `panels.{panelId}.*` state overlaid with incoming STATE-02 edges) genui already threads into
    `data`. This is the only render-context source available at this seam; it is explicitly render
    context, never model-authored (satisfies BIND-01's "never model-authored" clause structurally —
    the model cannot write into `panelData`, only end-users/other panels via edges can).

### Streaming tolerance
- While `isStreaming === true` AND `bindings` hasn't parsed yet (or parses to `{}`), the hook returns
  `{}` — no live data merged, panel renders exactly as it does today (data-less). No skeleton/loading
  chrome added at the binding layer for the "haven't streamed far enough yet" case — that's visually
  indistinguishable from "no bindings declared", which is correct default behavior (D-04 "never
  breaks" ethos extended to this seam, mirroring `GenuiPartBoundary` itself).
- Once bindings ARE parsed and queries fire, per-procedure `isLoading`/`isError` states surface as a
  **loading value inside the merged data**, not a separate chrome layer: each binding's live value is
  `undefined` while loading/erroring, and returns to the SpecRenderer's existing `dataRef` →
  `undefined` → conditional/list-empty-state handling (already-existing renderer behavior, zero new
  cases). This is the minimal-surface choice — no new error UI to design, no renderer touch.

### Refresh: staleTime tiers (BIND-02)
- Values chosen (first pass — a later phase may retune from real usage, not blocking BIND-02's "no
  bespoke polling" success criterion which only requires tiers to exist and be procedure-scoped):
  | procedure         | staleTime | rationale                                                        |
  |--------------------|-----------|-------------------------------------------------------------------|
  | `knowledge.byId`     | 10s       | promotion-adjacent — tier can change underfoot, shortest tier      |
  | `knowledge.graph`     | 10s       | same — graph edges reflect promotion state                        |
  | `entities.byId`        | 30s       | matches the app-wide `query-client.ts` default (`30 * 1000`)       |
  | `entities.list`         | 30s       | same as above                                                     |
  | `emails.detail`           | 60s       | append-only email rows never mutate post-ingest — longest tier    |
- Implemented as a plain `const STALE_TIME_MS: Record<AllowedProcedure, number>` lookup consumed by
  each `useQuery({..., staleTime: STALE_TIME_MS[procedure]})` call inside the switch — not a
  TanStack global override (keeps the existing 30s app default untouched for every non-binding query).

### Refresh: event-driven invalidation (BIND-02, promotion mutation)
- **Correction to the synthesis's phrasing** ("on v1.5's promotion mutation `onSuccess`"): the actual
  v1.5 promotion call (`apps/web/src/app/knowledge/_components/knowledge-graph.tsx:handlePromote`) is
  a plain `fetch("/api/knowledge/edges/{id}/promote")` REST call, NOT a tRPC `useMutation` — there is
  no tRPC `onSuccess` hook to attach to today.
- **Decision:** add an explicit `utils.knowledge.byId.invalidate()` + `utils.knowledge.graph.invalidate()`
  call (via `api.useUtils()`) in `handlePromote`'s existing success branch, right after the current
  optimistic `setEdges` call. This is a small, in-scope edit to a `apps/web/` file (allowed — it is
  NOT one of the 3 locked renderer files). It works because `TRPCReactProvider` mounts once at
  `apps/web/src/app/layout.tsx` (root layout) — the TanStack `QueryClient` is a single browser-side
  singleton shared across EVERY route via client-side navigation, so invalidating `knowledge.*` query
  keys from the `/knowledge` page's promote handler DOES invalidate a `/chat` canvas panel's bound
  `knowledge.byId`/`knowledge.graph` query, provable as an observable refetch (SC4) without navigating
  away from `/chat` first (both routes share the one SPA-level cache once each has been visited in the
  session — verified acceptable for SC4's "observable as a refetch" bar; a full cross-tab/cross-session
  invalidation transport is explicitly out of scope).
- No other procedures get invalidation hooks this phase — `entities.*`/`emails.*` have no
  known-mutating counterpart surface wired to chat canvas panels yet (that arrives with Phase 40's
  confirm-action widgets); staleTime tiers alone satisfy BIND-02 for those three.

### Knowledge-preview canvas node (Fork 1 sub-item C)
- Explicitly OUT of scope for Phase 33 — the synthesis's own "Phase sizing" note assigns this to
  sub-phase C, "hard-blocked on v1.5 Phase 32" for its expand endpoint, and the roadmap gives it its
  own numbered phase (**Phase 41**, not 33). Phase 33 delivers ONLY the bindings plumbing (sub-phase A)
  and its refresh/invalidation half (sub-phase B) — both listed as v1.5-independent / small in the
  synthesis's sizing note, matching this phase's actual roadmap success criteria (SC1–SC5), none of
  which mention a preview node.

### Claude's Discretion
- Exact `use-data-bindings.ts` hook signature/return shape, internal helper names, and whether the
  procedure `switch` lives in one file or is split into a small per-procedure resolver map — follow
  existing repo idioms (`canvas-store-context.tsx`'s per-seam-hook style, small colocated helpers).
- Whether to add a lightweight `use-data-bindings.test.ts` unit test mocking `api.*.useQuery`, or to
  cover this seam via the existing `panel-data-flow.test.tsx` integration-style test file — planner's
  call; either satisfies the repo's TDD norm as long as the 5-procedure switch and the params-from-
  context convention are both exercised.
- Whether `entities.list`/`knowledge.graph`'s optional params pass through a raw
  `binding.params as EntitiesListInput` cast or a narrow `.safeParse` re-validation at the call site —
  prefer the safeParse (defense-in-depth matches the rest of this codebase's D-15 posture) but a cast
  is acceptable if the planner judges `DataBindingSchema`'s own upstream validation sufficient.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/genui/src/schema/spec-schema.ts:565-583` — `SpecRootSchema.bindings` field, already
  parsed, currently read by nobody (`bindings: z.record(z.string(), DataBindingSchema).optional()`).
- `packages/genui/src/schema/data-binding-schema.ts` — `DataBindingSchema` (procedure + params, UUID-
  param refine, GR-15/D-13a) — exported from `@nauta/genui/schema`.
- `packages/genui/src/generation/allowed-procedures.ts` — `ALLOWED_PROCEDURES` (9 total registered,
  but only 5 wired here per roadmap: `entities.byId/list`, `emails.detail`, `knowledge.byId/graph`),
  `AllowedProcedure` type, `AllowedProcedureSchema` — all re-exported from `@nauta/genui/schema` via
  `allowlists.ts`.
- `packages/api-client/src/router/entities/detail.ts:146` — `entities.byId` input `{id: uuid}`.
- `packages/api-client/src/router/entities/gallery.ts:32` — `entities.list` input `listInputSchema`
  (`importerId?, entityTypeId?, status, search?, sort, limit, offset` — all optional/defaulted).
- `packages/api-client/src/router/emails/detail.ts:41` — `emails.detail` input `{id: uuid}`.
- `packages/api-client/src/router/knowledge/detail.ts:30` — `knowledge.byId` input `{id: uuid}`.
- `packages/api-client/src/router/knowledge/graph.ts:64` — `knowledge.graph` input `graphInputSchema`
  (`importerId?, includeInstances?, includeEmails?, nodeTypes?`).
- `apps/web/src/trpc/react.tsx` — `api = createTRPCReact<AppRouter>()`, `api.useUtils()` — the
  established call convention (`api.entities.byId.useQuery({id})`, mirrored across
  `use-entity-curation.ts`, `use-region-edit.ts`, etc. — onMutate/onSuccess snapshot pattern for
  reference, though bindings here are query-only, no mutations).
- `apps/web/src/trpc/query-client.ts:12` — app-wide default `staleTime: 30 * 1000` — the baseline the
  per-procedure tiers deviate from.
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx:62-148` — `GenuiPanelNodeBody`: already calls
  `useCanvasSpec(provenance)` → `{specJson, isStreaming}`, `usePanelData(panelId, incomingEdges)` →
  `{data: panelData, dispatch}`, then passes `data={panelData}` into `GenuiPartBoundary`. This is the
  exact integration point — insert `useDataBindings({specJson, isStreaming, panelData})` here and
  spread its result over `panelData` before the `GenuiPartBoundary` call.
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx:228-267` — `usePanelData` returns the panel's
  own `panels.{panelId}.*` slice overlaid with `STATE-02` incoming-edge values — this IS "render
  context" for params purposes (e.g. `panelData.selectedEntityId`).
- `apps/web/src/app/chat/_components/genui-part-boundary.tsx:139` —
  `export function attemptRepairJson(raw: string): string | null` — reusable via import, file itself
  stays untouched.
- `apps/web/src/app/knowledge/_components/knowledge-graph.tsx:503-546` — `handlePromote`: the real
  promotion call site (`fetch` POST to `/api/knowledge/edges/{id}/promote`), success branch at
  `:527-538` — this is where the new `utils.knowledge.*.invalidate()` calls get added.
- `apps/web/src/app/layout.tsx:33` — `<TRPCReactProvider>` mount point, confirming the QueryClient
  singleton is shared app-wide across client-side route navigation.

### Integration Points
- `use-data-bindings.ts` sits between `canvas-spec-context.tsx` (source of `specJson`/`isStreaming`)
  and `genui-panel-node.tsx` (consumer that merges the result into `panelData`) — a new file, no
  existing file's public contract changes except `knowledge-graph.tsx`'s `handlePromote` (additive
  invalidate calls only).
- The `AllowedProcedure` compile-time switch consumes `api` from `~/trpc/react` directly (client
  component, `"use client"` — `genui-panel-node.tsx` is already `"use client"`).

### Patterns to Follow
- Immutable spread merges (`{ ...panelData, ...liveBindingData }`) — CLAUDE.md.
- Named exports only; explicit types on every exported symbol.
- `.strict()` Zod schemas already exist upstream (`DataBindingSchema`) — no new Zod schema needed
  here beyond the narrow `z.record(z.string(), DataBindingSchema).optional()` re-validation of the
  extracted `bindings` field.
- Degrade-instead-of-throw posture matches `useCanvasSpec`'s own `EMPTY_SPEC` fallback and
  `GenuiPartBoundary`'s `SAFE_FALLBACK_SPEC` gate — `use-data-bindings.ts` never throws, always
  degrades to `{}`.
</code_context>

<specifics>
## Phase-Specific Requirements

- BIND-01: compile-time `switch` over exactly the 5 named procedures; params sourced only from render
  context (`panelData`) for the 3 by-id procedures, model-authored non-ID params pass through for the
  2 list/graph procedures; `ALLOWED_PROCEDURES` untouched (SC5).
- BIND-02: per-procedure `staleTime` (table above) + `knowledge.byId`/`knowledge.graph` invalidation
  wired into the real `/api/knowledge/edges/{id}/promote` success path; no `setInterval`/polling code
  anywhere.
- SC2 (byte-identical locked files): plan must include an explicit diff-verification task/step (e.g.
  `git diff --stat` against the 3 locked paths showing zero changes) as part of execution or
  verification — not just "don't touch them" as an implicit constraint.
- UI-SPEC: SKIPPED for this phase (see below) — no new visual surface, `bindings` flow into EXISTING
  panel chrome that already renders whatever `data` it's given.

</specifics>

<deferred>
## Deferred / Out of Scope

- Knowledge-preview canvas node (Fork 1 sub-item C) — Phase 41, hard-blocked on Phase 39 +
  v1.5 Phase 32's expand endpoint (already satisfied, but Phase 41 also needs Phase 39's
  `<ProvenanceLink>` primitive which doesn't exist yet).
- Expanding `ALLOWED_PROCEDURES` beyond the current 9 (5 wired here) — explicit reviewed-gate-only
  change per D-23, not touched this phase.
- Retuning staleTime values from real production usage data — first-pass values documented above,
  revisit only if a later phase's telemetry motivates it.
- `entities.*`/`emails.*` invalidation-on-mutation — no mutating counterpart exists yet on the chat
  canvas surface; arrives with Phase 40 (confirm-action widgets).
- Loading/error skeleton chrome specific to live-bound panel data — deferred; current behavior
  (render exactly as if the binding were simply absent while loading/erroring) is judged sufficient
  for this phase's success criteria.
</deferred>

## UI-SPEC Decision: SKIPPED

Phase 33 introduces no new visual surface. `spec.bindings` resolves into the SAME `data` prop the
`SpecRenderer` already accepts and renders via its existing `dataRef`/`list`/`conditional`
interpreter primitives (unchanged, locked). There is no new component, no new node type, no new
chrome — only a new upstream data source feeding an existing render path. The roadmap's "UI hint: yes"
on Phase 33 is read here as "this phase makes UI **come alive with real data**", not "this phase adds
new UI structure" — consistent with `gsd:ui-phase`'s own scope test (new visual surface vs. wiring
existing surface to new data). Skipping is the correct call; `gsd:ui-review` (retroactive audit) can
still validate the wired-in panels visually once Phase 33 ships if desired.
