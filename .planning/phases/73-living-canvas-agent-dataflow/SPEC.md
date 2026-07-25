---
phase: 73-living-canvas-agent-dataflow
milestone: vNEXT-living-canvas
status: in-progress
build_log:
  - "Wave A SHIPPED 2026-07-25 (web a2393f2 + listener 203a8b5): the agent can now
     DRAW nodes and WIRE data-edges on the canvas. LCAN-01/02/06 green. Listener
     tools emit_canvas_node/emit_canvas_connect behind CANVAS_EMIT_TOOL_ENABLED
     (default OFF, fail-closed); web reconcile materializes the parts."
  - "Wave B SHIPPED 2026-07-25 (core c2139f7 + fan-out 00f19db): the wire now
     CARRIES DATA. projectForPublish (bounded JSON projection) + useCanvasPublish
     write to shared.published.{nodeId}; agent edges rewrite the model's friendly
     sourcePath to the physical published path so the unchanged usePanelData
     engine resolves it live. Publish port wired into 11 source nodes (usage
     reference + 10 fan-out). LCAN-03/04 green; LCAN-05 client-live proven (test),
     DB-row/real-browser assertion still owed. Wave C (named recipes + durable
     after-close recompute, LCAN-07/09) remains."
size: XL
depends_on: [66]
requirements: [LCAN-01, LCAN-02, LCAN-03, LCAN-04, LCAN-05, LCAN-06, LCAN-07, LCAN-08, LCAN-09]
---
# Phase 73 — Agent-authored live dataflow recipes on the canvas   ·   BANGER: one sentence builds a graph that keeps itself alive

## Goal
The user types one sentence — "watch my landlord thread and keep a live rent board" — and the agent
**assembles a running dataflow on the canvas**: it drops the source node(s), drops the derived node(s),
**wires them with data edges** (`sourcePath -> targetKey`), and the derived nodes **recompute when the
upstream source changes**. The graph is a **named, persisted recipe** that survives reload and keeps
recomputing after the turn ends. The canvas stops being a place where the agent *shows you* material and
becomes a place where the agent *builds you a living instrument*.

## Why this is a banger (and why now)
Every AI canvas today is a **whiteboard**: the agent can draw boxes, maybe draw arrows, but the arrows
are decoration — nothing flows through them and nothing recomputes. This phase makes the arrows **load-
bearing**. Only *this* architecture can do it cheaply because the three hard parts already exist as
first-class, tested substrate and just aren't joined up:

1. **The wiring verb is already a real capability.** `canvas.connect` is declared once
   (`packages/capabilities/src/canvas.ts:346`), server-bound through the same ownership-gated,
   idempotent, additive-never-clobbering store the UI's own save uses
   (`packages/api-client/src/router/chat/canvas-mutations.ts:250`), and persisted per-row into
   `canvas_edges` (`packages/db/src/schema/canvas-edges.ts:43`) with `{sourcePath, targetKey}` as a
   first-class jsonb payload (`canvas-edges.ts:61`).
2. **The live-recompute engine already exists.** `usePanelData`
   (`apps/web/src/app/chat/_canvas/canvas-store-context.tsx:243`) overlays a target panel's `targetKey`
   with `resolveCanvasPath(state.values, edge.sourcePath)` and re-resolves **on every store change** via
   a zustand `useShallow` selector (`canvas-store-context.tsx:272`) — genuinely reactive dataflow,
   already shipped, already tested for the infinite-loop hazards.
3. **The durable graph substrate already landed.** The Workspace→Canvas→Node/Edge rows + graphile-worker
   runtime shipped as Task 7 foundation; `CanvasRepository` is the single per-row write path
   (`packages/db/src/canvas-repository.ts:1`) and closes the whole-row LWW race under
   `CANVAS_ROW_MODEL=read_rows`.

The compounding-graph payoff: because the recipe is rows in the personal graph (not a chat transcript),
the SAME sentence that builds a rent board today becomes a **standing asset** — a named recompute graph
the morning-board phase (74), a "recipes gallery", and cross-conversation reuse all read from. The wedge
being built right now (agent emits `canvas_add_node`, web materializes it) is exactly one third of the
loop. This phase adds the other two thirds — **connect** and **recompute** — and names the result.

## What already exists — the plumbing (file:line evidence, be exhaustive)

### The three canvas verbs (declared once, INV-1)
- `packages/capabilities/src/canvas.ts:309` — `canvasAddNodeCapability` (`canvas.addNode`), `risk:"write"`,
  idempotent per referenced object; input schema validates `nodeType` against the 27-type allowlist
  `CANVAS_NODE_DATA_SCHEMAS` (`canvas.ts:100`) and rejects unknown types at the boundary (`canvas.ts:392`).
- `packages/capabilities/src/canvas.ts:346` — **`canvasConnectCapability` (`canvas.connect`)** — the verb
  this phase turns on for the agent. Input `canvasConnectInputSchema` (`canvas.ts:270`) already carries
  `sourceNodeId`, `targetNodeId`, optional `sourcePath` (default `"data"`, `canvas.ts:236`), optional
  `targetKey` (default `"input"`, `canvas.ts:237`), forbidden-path-segment guarded (`canvas.ts:253`),
  self-loop rejected (`canvas.ts:288`). Output `{edgeId, created}` (`canvas.ts:410`).
- `packages/capabilities/src/canvas.ts:378` — `canvasRemoveNodeCapability`, explicitly reversible,
  returns the removed node + detached edges (the undo payload).
- `packages/capabilities/src/canvas.ts:471` — `CANVAS_CAPABILITIES` array; `CanvasMutationStore` PORT at
  `canvas.ts:436`; fail-closed default `canvas.ts:453` (unbound ⇒ every verb refuses, INV-5).

### The server binding (control plane, ownership-gated)
- `packages/api-client/src/router/chat/canvas-mutations.ts:277` — `connectCanvasNodes` procedure:
  `protectedProcedure`, `assertOwnedOrNotFound(assertConversationOwnership(...))` FIRST
  (`canvas-mutations.ts:281`), then the capability by id. Backend chosen by `CANVAS_ROW_MODEL`
  (`canvas-mutations.ts:291`): `read_rows` → `connectRow` (per-row, race-free); else blob via
  `runCanvasCapability("canvas.connect", …)`.
- `packages/api-client/src/router/chat/canvas-mutations.ts:170` — `createCanvasMutationStore.connect`:
  loads snapshot, validates both endpoints exist (`canvas-mutations.ts:184` BAD_REQUEST if missing),
  dedupes on `(source,target,sourcePath,targetKey)` (`canvas-mutations.ts:195`), enforces
  `MAX_CANVAS_EDGES` (`canvas-mutations.ts:206`), appends `{id, source, target, data:{sourcePath,
  targetKey}}` and persists through the SAME `chat_canvas_layouts` upsert `saveCanvasLayout` uses
  (`canvas-mutations.ts:161` `persistSnapshot`).
- `packages/api-client/src/router/chat/canvas-store-backend.ts:394` `writeConversationRow` /
  `connectRow` — the `read_rows` per-row path delegating to `CanvasRepository`.

### The durable row substrate (Task 7 foundation)
- `packages/db/src/schema/canvas-edges.ts:43` — `CanvasEdges`: `edgeKey` idempotency (unique per canvas,
  `canvas-edges.ts:69`), `sourceKey`/`targetKey` as TEXT-not-FK (tolerates healed/not-yet-persisted node
  keys, `canvas-edges.ts:57`), **`data` jsonb = `{sourcePath, targetKey}`** (`canvas-edges.ts:61`).
- `packages/db/src/schema/canvas-nodes.ts:51` — `CanvasNodes`: `nodeKey` canonical `type:ref`
  idempotency, `type`/`position`/`data` (ref-only, no spec).
- `packages/db/src/canvas-repository.ts:1` — `addNode`/`connect`/`removeNode`/`applySnapshot`/
  `assembleSnapshot`, the SINGLE row-model write path both tRPC and the agent path call; `canonicalNodeId`
  mirrored (`canvas-repository.ts` header) so agent adds stay idempotent per object.

### The live-recompute engine (already reactive)
- `apps/web/src/app/chat/_canvas/canvas-store.ts:171` — `createCanvasStore`: one vanilla zustand store per
  conversation, flat `values` bag under `panels.{id}.{key}` / `shared.{key}`, bounded 5-mutation enum,
  `resolveCanvasPath` (`canvas-store.ts:74`) dotted-path read, `setCanvasPath` immutable write.
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx:243` — `usePanelData(panelId, incomingEdges)`:
  the STATE-02 seam. `data` = the panel's own slice **overlaid** with each incoming edge's
  `resolveCanvasPath(state.values, edge.sourcePath)` written at `edge.targetKey` (`canvas-store-context.tsx:272`),
  re-resolved on every store change (`useShallow` guards the infinite-loop hazard, `canvas-store-context.tsx:262`).
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx:186` — `CanvasEdgesProvider` builds the live
  `target panelId -> incoming edges[]` map, recomputed whenever the `edges` array changes.
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx:1345` — the host derives `edges → DataCarryingEdge[]` and
  threads it into `CanvasEdgesProvider`; `chat-canvas.tsx:295` `toFlowEdge` (type `"data-edge"`,
  `markerEnd`, never animated).
- `apps/web/src/app/chat/_canvas/data-edge.tsx:132` — `DataEdge` renders the always-visible
  `{sourcePath} → {targetKey}` label pill; `edge-payload-schema.ts:24` `EdgePayloadSchema` is the
  connect-time gate mirroring the persist-time gate (no drift).
- `apps/web/src/app/chat/_canvas/use-canvas-persistence.ts:326` — `buildSnapshot` persists `sharedState`
  (the store's `values` bag) verbatim so cross-panel wiring survives reload (D-10); `use-canvas-
  persistence.ts:512` restores edges via `toFlowEdge`.

### The materialization wedge (being built now — this phase's launch pad)
- The `canvas_add_node` message-part reconcile reuses the genui-panel live-reconcile path
  (`use-canvas-persistence.ts:129` `buildExpectedGenuiPanelSpecs` / Pass-2 auto-placement,
  `chat-canvas.tsx:485` reconcile effect) and the listener `emit_canvas_node` tool sits behind
  `CANVAS_EMIT_TOOL_ENABLED`. `MessagePart` union at
  `apps/web/src/app/chat/_hooks/use-chat-stream.ts:98` is where a new `canvas_connect` part slots.
- Listener capability registry (`apps/email-listener/app/application/capabilities/registry.py:1`,
  mirror of `packages/capabilities`) + read-only chat tools
  (`apps/email-listener/app/infrastructure/tools/`) — where an `emit_canvas_connect` tool registers.

## The gap (what's missing to make it real)
Three seams, per layer. **Only wiring is missing — no new persistence or reactivity engine.**

1. **Agent can `addNode` but not `connect` (listener + web wedge).**
   - *listener*: no `emit_canvas_connect` tool. Add one alongside the (in-flight) `emit_canvas_node`,
     behind the SAME `CANVAS_EMIT_TOOL_ENABLED` flag; register in `registry.py`; it emits a
     `canvas_connect` message part carrying `{sourceNodeKey, targetNodeKey, sourcePath, targetKey}`.
   - *apps/web*: add a `canvas_connect` arm to `MessagePart` (`use-chat-stream.ts:98`) and a client
     reconcile pass that materializes it as a `data-edge` via `toFlowEdge` (`chat-canvas.tsx:295`),
     idempotent on the same `(source,target,sourcePath,targetKey)` key `connect` already dedupes on
     (`canvas-mutations.ts:195`) so a live-materialized edge is not double-placed when the post-turn
     `getCanvasLayout` refetch restores the persisted row.
   - The **server verb is already complete** — this seam only carries the intent from model → canvas.

2. **Non-genui nodes don't publish values into the store (the recompute gap).** Today ONLY genui panels
   write to the store (`usePanelData.dispatch`, `genui-panel-node.tsx`). The 11 new tRPC-backed node types
   (entity/brief/email-thread/spreadsheet/…) fetch their data via owner-scoped reads and never write a
   `sourcePath`-addressable value into `values`, so an agent-wired edge FROM one of them carries
   `undefined`. **The seam**: a tiny **publish port** — each source-capable node writes a summarized,
   bounded projection of its fetched data to `shared.published.{nodeKey}` (via the existing
   `mutate("set", …)` bounded enum, `canvas-store.ts:112`) whenever its tRPC query settles. The edge's
   `sourcePath` then resolves to it through the UNCHANGED `resolveCanvasPath` engine — no new reactivity.

3. **Recipes aren't persisted/named, and recompute doesn't survive the turn (db + api-client).** A wired
   graph today is anonymous rows in `canvas_nodes`/`canvas_edges`. **The seam**: a `canvas_recipes` row
   (name + the node/edge key-set + a `sourceRef` the durable graphile-worker runtime can re-poll) so the
   recipe (a) shows a name/badge on the canvas, (b) is listable/reusable, and (c) the Task-7 worker can
   re-run the source read on a schedule and bump the published value server-side, so "keep a live rent
   board" keeps recomputing after the tab closes. MVP can prove client-live recompute; the durable
   after-close half is the named live-verification seam.

## Vertical slice / MVP (the smallest demo that proves it)
**User types:** "Add my rent spreadsheet, add a total-due tile, and keep the tile in sync with the sheet."

**What happens (one turn, no extra clicks):**
1. Agent calls `emit_canvas_node` twice → a `spreadsheet` node and a `brief`/tile node materialize live
   (the wedge).
2. Agent calls `emit_canvas_connect` once → a `data-edge` draws between them with the visible
   `total → input` label pill (this phase, seam 1).
3. The spreadsheet node publishes its computed total to `shared.published.{spreadsheetNodeKey}.total`
   when its query settles (seam 2); the tile's `usePanelData` overlay resolves it at `targetKey:"input"`
   and renders the number — with **zero** bespoke reactivity, through the shipped
   `resolveCanvasPath`/`useShallow` engine.
4. The user edits a cell → the spreadsheet query refetches → the published value changes → the tile
   **updates itself**. Reload the page → the edge, the wiring, and the last value are all still there
   (persisted `sharedState` + `canvas_edges`).

The "holy shit": one sentence produced a **wired, self-updating instrument**, not three static cards.

## Success criteria (testable / UAT)
Gate-able here (unit / geometry / real-browser):
- [x] **LCAN-01** A `canvas_connect` message part materializes exactly one `data-edge` between the two
      named node keys; re-materializing the same part (post-turn refetch) is an idempotent no-op (no
      duplicate edge). (vitest on the reconcile pass; parity with `connect` dedup key.) — SHIPPED a2393f2
      (`collectAgentEdges` + `agent-canvas-reconcile.test.ts`).
- [x] **LCAN-02** `emit_canvas_connect` is registered in the listener capability registry ONLY when
      `CANVAS_EMIT_TOOL_ENABLED` is set; fails closed / absent otherwise. (`uv run pytest`.) — SHIPPED
      203a8b5 (structural-omission wiring + `TestCanvasEmitExposureGate`).
- [x] **LCAN-03** A source-capable node publishes a **bounded** projection (size-capped, no spec content,
      prototype-pollution-guarded) to `shared.published.{nodeKey}` through the bounded 5-mutation enum —
      never an arbitrary reducer, never over the `sharedState` size bound. (vitest + the existing
      `sharedState` size gate.) — SHIPPED c2139f7 (`projectForPublish` + `useCanvasPublish` +
      `canvas-publish.test.ts`; wired into 11 source nodes).
- [x] **LCAN-04** With a wired edge `published.{src}.total → input`, changing the source's published
      value re-renders the target's overlaid value within one store tick (no manual refresh). (vitest on
      `usePanelData`, extending `panel-data-flow.test.tsx`.) — SHIPPED c2139f7 (`canvas-publish-flow.test.tsx`,
      zero-mock publish→edge→live-target re-resolution) + the friendly→physical sourcePath rewrite.
- [~] **LCAN-05** A wired recipe round-trips reload: edge + `sharedState` published value restore exactly
      (D-06/D-10) — asserted against the DB row, not terminal output. (geometry/real-browser gate on an
      already-running :3000 server.) — PARTIAL: client-live round-trip proven in vitest + edges/wiring
      reconstruct from history; the DB-row/real-browser assertion is still owed (needs a running :3000).
- [x] **LCAN-06** The data edge stays **neutral** — no tier hue is introduced by wiring (Law 1;
      `data-edge.tsx:17` invariant preserved). (canvas-node-law test.) — SHIPPED a2393f2 (agent edges
      reuse `toFlowEdge` verbatim; no styling added at the wiring seam).
- [ ] **LCAN-07** A `canvas_recipes` row persists name + node/edge key-set; a recipe badge/name renders
      on the canvas grouping its member nodes. (db round-trip test + geometry gate.)
- [ ] **LCAN-08** Tenancy: every new procedure is `protectedProcedure` with ownership asserted FIRST;
      a non-owned conversation surfaces NOT_FOUND before any read/write (mirrors `canvas-mutations.ts:281`).

Needs a **live loop** (named, not gate-able in CI):
- [ ] **LCAN-09** Durable after-close recompute: the Task-7 graphile-worker re-polls the recipe's
      `sourceRef`, recomputes, and bumps the published value server-side while the tab is closed; on next
      open the tile shows the newer value. (Manual/live verification against a running worker + DB;
      SES/outbound not involved.)

## Build sketch (waves → plans)
**Wave A (parallel-safe — the connect wedge):**
- *Plan 73-01 — listener `emit_canvas_connect`* (`apps/email-listener`): a write-capable emit tool behind
  `CANVAS_EMIT_TOOL_ENABLED`, registered in `registry.py`, emitting a `canvas_connect` part.
  Must-haves: (a) flag-gated registration; (b) part shape mirrors `canvasConnectInputSchema`; (c) fails
  closed when flag unset.
- *Plan 73-02 — web `canvas_connect` reconcile* (`apps/web`): `MessagePart` arm + a reconcile pass
  materializing it as a `data-edge`. Must-haves: (a) idempotent on the connect dedup key; (b) reuses
  `toFlowEdge`, never a new edge path; (c) survives the post-turn `getCanvasLayout` refetch without
  duplicating.

**Wave B (depends on A — makes the wire carry data):**
- *Plan 73-03 — the publish port* (`apps/web`): source-capable nodes publish a bounded projection to
  `shared.published.{nodeKey}` on query-settle. Must-haves: (a) bounded enum + size cap + pollution guard;
  (b) `usePanelData` overlay resolves it unchanged; (c) reactive within one store tick.

**Wave C (depends on B — names + durability):**
- *Plan 73-04 — named recipes* (`packages/db` + `packages/api-client` + `apps/web`): `canvas_recipes` row,
  ownership-gated CRUD, on-canvas name/badge. Must-haves: (a) protected + ownership-first; (b) round-trips
  reload; (c) additive-never-clobber the layout.
- *Plan 73-05 — durable recompute (live-verified)* (`packages/api-client` graphile-worker task): the
  Task-7 worker re-polls a recipe `sourceRef` and bumps the published value server-side. Must-haves:
  (a) per-recipe job idempotent; (b) failure is retryable/durable (never silently swallowed); (c) named
  live verification, NOT a CI gate.

## Risks & landmines
- **LWW canvas race (recorded, `canvas-mutations.ts` header).** The blob path's debounced whole-row save
  can clobber an agent delta when the canvas is mounted-and-idle. This phase's edges + published values
  ride the SAME row, so a live-materialized edge must be idempotent AND the phase should run under
  `CANVAS_ROW_MODEL=read_rows` (per-row, race-free) for durability — flip only behind the shadow-compare
  parity gate the backend header describes (P8→P10). Do not assume `read_rows` in tests.
- **No Terraform apply / SES sandbox / listener redeploy (CLAUDE.md live-infra landmines).** LCAN-09 uses
  the graphile-worker runtime, which is DB-backed and **does not touch SES, `magnitudetech.com.br`, or
  `nauta-*`**; introduce no outbound-mail dependency. The listener change (Plan 73-01) ships on the same
  redeploy discipline — a merge redeploys the listener, so the emit tool must be flag-gated
  (`CANVAS_EMIT_TOOL_ENABLED`) and fail closed.
- **`sharedState` is a bounded blob.** Publishing must project a SUMMARY, never the source's full dataset
  (`panel-overlay.ts:24` documents the bound). A source node that dumps rows will blow the cap and get the
  whole save refused (`canvas-mutations.ts` PRECONDITION_FAILED) — cap + summarize at the publish port.
- **Neutral-wire law (`data-edge.tsx:17`).** Someone will want to color a "live" edge green. A data wire
  confirms nothing — LCAN-06 pins it neutral.
- **Prototype-pollution / dotted-path safety.** `sourcePath`/`targetKey`/published keys all flow through
  FORBIDDEN_KEYS-guarded paths (`canvas-store.ts:48`, `edge-payload-schema.ts:8`, `canvas.ts:253`); the
  publish port must write through `mutate` (which re-guards) — never a raw object assign.
- **Tenancy.** Every recipe/connect procedure is `protectedProcedure`, ownership asserted FIRST
  (LCAN-08); the model-authored node keys are untrusted for identity — the server re-validates endpoints
  exist (`canvas-mutations.ts:184`).
- **Needs-live seam.** LCAN-09 (after-close recompute) is only verifiable against a running graphile-worker
  + DB; it must be named as a live-verification item, never asserted green from a jsdom suite (CLAUDE.md:
  "verify against the DB, not terminal output").

## Dependencies & sequencing
- **`depends_on: [66]`** — needs the Task-7 durable graphile-worker + Workspace→Canvas→Node/Edge row
  foundation (landed via the files-vault/foundation line at phase 66) for the row substrate LCAN-05/07/09
  build on, and the in-flight `canvas_add_node`/`emit_canvas_node` wedge as its launch pad. It does NOT
  need any other vNEXT banger.
- **This is THE foundation for the milestone.** It turns `canvas.connect` + the recompute engine into an
  agent-drivable loop and coins the recipe substrate. Phase 74 (self-assembling morning board) and any
  "recipes gallery" / cross-conversation reuse banger build directly on the `shared.published.*` publish
  port and the `canvas_recipes` row this phase introduces. Wave A (connect wedge) is the smallest shippable
  slice and unblocks everything downstream even before Waves B/C land.
