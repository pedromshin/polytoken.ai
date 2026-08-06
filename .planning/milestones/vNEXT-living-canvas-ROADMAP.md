# Milestone vNEXT — The Living Canvas

**Status:** 🚧 CODE-COMPLETE (opened via orchestrator run 2026-07-25; **all five phases 73–77 built
on `main` as of 2026-08-06** — remaining work = human-gated LIVE seams only). Live per-slice detail:
**`ORCHESTRATOR-STATE.md`** ⭐ CURRENT block (this ROADMAP is the structural tracker; the ledger is
the source of truth for what shipped when).
**Phases:** 73–77 (the five "bangers")
**Requirements:** 41 (LCAN 9 + MORN 7 + CPF 6 + BTAP 10 + MCPX 9)
**Depends on:** Phase 66 (durable graphile-worker + Workspace→Canvas→Node/Edge row substrate,
shipped 2026-07-17) and the just-shipped 11 canvas node types + the in-flight `canvas.addNode`
agent-draws-node wedge.
**Source of the arc:** ORCHESTRATOR-STATE.md "BANGER DIRECTION (Pedro's vision Q, 2026-07-25)" +
the five `SPEC.md` files under `.planning/phases/73..77-*/`; master-plan Track 3a (durable runtime)
and Track 7 (expose-first MCP).

---

## ✅ SHIPPED STATUS — reconciled 2026-08-06 (orchestrator run)

> Shipped = code on `main`, gates green at integration (2026-08-06 matrix: worker 34 · mcp-server
> 32/32 · web 461 targeted + tsc · drizzle-kit check · api-client 59 (entities) · listener targeted
> suites + mypy 318 + lint-imports; FULL listener pytest + the full TS matrix were still running at
> reconcile time — assume green unless the ledger notes otherwise). These were built as an
> orchestrator run, NOT the full GSD discuss→plan→execute→verify ceremony — there are no per-plan
> PLAN.md/VERIFICATION.md trails; the honest trail is the `ORCHESTRATOR-STATE.md` ledger + the git
> history. Live-seam checkboxes below stay UNTICKED until a human runs them.

- [x] **Phase 73 — Living-canvas agent dataflow · Waves A + B + C CODE-COMPLETE.** Wave A
  (`a2393f2` web + `203a8b5` listener): the agent draws nodes + wires data-edges
  (`canvas_add_node`/`canvas_connect` parts behind `CANVAS_EMIT_TOOL_ENABLED`, default-OFF).
  Wave B (`c2139f7` + `00f19db`): the publish port — `projectForPublish` + `useCanvasPublish` →
  `shared.published.{nodeId}`, wired into 12 source nodes. Wave C backend (`e1da907`/`de8137e`,
  2026-07-27): `canvas_recipes` table (0058) + CRUD + badge. Wave C close (2026-08-06): the recipe
  creation seam `emit_canvas_recipe` + web reconcile (`f0510ee5`, fixes `a19aba67` —
  all-or-nothing planning, sourceRef sanitize) + worker `recompute_canvas_recipe` /
  `dispatch_recipe_recomputes` (`1d1391a2`, dark behind `RECIPE_RECOMPUTE_ENABLED`; migration
  **0061** widens the task allowlist — pending prod).
  - [ ] LCAN-05 / LCAN-09 **live** — HUMAN-GATED (worker provisioned + 0061 on prod +
    `RECIPE_RECOMPUTE_ENABLED` flipped + a DB-verified after-close recompute).
- [x] **Phase 74 — Self-assembling morning board · CODE-COMPLETE (dark).** `/chat` "Assemble
  board" (`f573c3d`) + `/home` HomeCanvas paint (`f5eef75`); overnight composer + worker cron
  gated on `MORNING_BOARD_ENABLED` (`1fe5b80` + listener).
  - [ ] MORN-07 **live** — HUMAN-GATED (flag flipped + worker provisioned + a real overnight run +
    `screenshot:review`).
- [x] **Phase 75 — Correction-propagation flywheel · CODE-COMPLETE (both halves).** Visible half
  (`32b21c6`, CPF-05/06): a merge repaints every placed EntityNode live + cascade-highlight ring.
  SERVER cascade (2026-08-06): wired into ConfirmMerge behind `CASCADE_CORRECTION_ENABLED`
  (byte-dark OFF) + `POST /v1/emails/relabel-job` (`d5c5b1d2`) + worker `cascade_relabel`
  (`1d1391a2`); `correction_propagations` ledger migration 0060 applied to prod 2026-07-28.
  - [ ] CPF **live** — HUMAN-GATED (flag flip + a live confirmed-merge → re-label fan-out on
    real mail).
- [x] **Phase 76 — Bespoke code-islands · CODE-COMPLETE.** Data channel `7866c10` · node+table
  `b64c56c` · the "Build a tool from these" summon loop `a24febb` · **`0055 code_islands` on prod
  (2026-07-26)** · 76-05 agent `emit_code_island` (2026-07-27, flag-gated) · **76-02b** listener
  consumes the typed-inputs manifest in the generator prompt (`87f4daf5`, hardening `08c336a7` —
  delimiter-breakout escape + bool rowCount, 2026-08-06).
  - [ ] BTAP-07 **live** — HUMAN-GATED (agent authors an app end-to-end on the live stack with
    `CANVAS_EMIT_TOOL_ENABLED` flipped).
- [x] **Phase 77 — MCP tool surface · CODE-COMPLETE.** Waves A+B (`d1dd3bd`, 2026-07-27):
  `apps/mcp-server` expose-only stdio server, 3 owner-scoped read tools through
  appRouter+createCaller, fixed principal fail-closed. Runtime close (2026-08-06, `58213cfc`):
  esbuild runtime bundle (`dist` boots; stdio `tools/list` smoke green) + Windows expose-only fix
  (32/32) + daemon-protocol suite into CI.
  - [ ] MCPX-09 **live** — HUMAN-GATED (Pedro's real Claude Code: `mcpServers` entry +
    `POLYTOKEN_MCP_*` env; `searchMyKnowledge` returns grounded results from the real graph).

---

## Thesis

**The canvas stops being a whiteboard the agent draws *on* and becomes a living substrate the agent
*builds*.** Today every AI canvas — ours included until this milestone — is decoration: the agent
can drop a box, maybe draw an arrow, but nothing flows through the arrow and nothing recomputes. The
compounding personal graph (entities, merges, cost ledger, inbox threads, knowledge tiers, generated
documents) plus the capability spine (`canvas.connect` declared once, read by four consumers) plus
the durable overnight runtime mean the SAME agent that draws a node live in `/chat` can wire it,
recompute it, run headless on a cron, ground a sandboxed app in it, and project it as a tool to
Pedro's own Claude Code. Five bangers, one move: **the agent authors running instruments over the
graph the product has silently accreted out of your mail.**

The payoff is the capability spine cashing in. v1.11 built the registry (`packages/capabilities`) as
"one declaration, four consumers — the registry pointed OUTWARD." This milestone is what OUTWARD was
for: the canvas verbs (`canvas.addNode`/`canvas.connect`/`canvas.removeNode`), the read procedures
(`knowledge.search`/`entities.list`/`search.omnibox`), and the code-island generator all become
things the *agent drives* and things *external agents call* — because they were each declared once,
ownership-gated once, and tested once. Nothing generic can do any of these five: each requires a
piece of substrate (the reactive publish-overlay engine, the durable per-user scheduler, the
human-gated trust ladder, the opaque-origin jailed generator, the owner-scoped tenancy helper) that
already exists in-tree and *just isn't joined up*.

---

## The five phases (one-liners · size · dependency order)

| # | Phase | The banger | Size | Depends on |
|---|-------|-----------|------|-----------|
| **73** | Living-canvas agent dataflow | One sentence builds a *wired, self-updating instrument* on the canvas — the agent drops nodes, wires them with data-edges (`sourcePath→targetKey`), and the derived nodes recompute when upstream changes; the graph is a **named, persisted recipe** that survives reload and keeps recomputing after the turn ends. | **XL** | 66 |
| **74** | Self-assembling morning board | You open your laptop and a board about *your day* is already there — a scheduled headless agent run drew the `home` board (pending merges, brief, "3 need a reply", spend meter, inbox treemap) at 5am off last night's email, before you ever opened `/home`. | **L** | 73 |
| **75** | Correction-propagation flywheel | Fix the AI **once** on a canvas node (confirm a merge) and the correction **cascades live**: suggestion edges promote to canon, past emails re-point onto the survivor, every downstream node re-renders — one click, propagated everywhere, made visible. | **L** | 73 |
| **76** | Bespoke disposable apps (code-islands over your data) | "Cursor for life-admin" — select two data nodes, say "build me a reconciler," and the agent generates a **real sandboxed mini-app** wired to your actual rows as typed inputs; edit a source cell and it recomputes; delete it when done. Generated code the network can't leak, computing over data the model never saw in full. | **L** | 73 |
| **77** | Your life as an MCP tool surface | Pedro adds one `mcpServers` line to his OWN Claude Code and calls `polytoken.searchMyKnowledge` / `polytoken.listEntities` / `polytoken.searchEverything` — his compounding personal graph answers, owner-scoped, cited, over stdio. Expose-only, single-principal, never consumes external MCP. | **L** | 73 (read slice standalone) |

**Dependency shape: 73 is the trunk; 74–77 are four independent branches off it.** Phase 73 turns
`canvas.connect` + the `usePanelData` recompute engine into an agent-drivable loop and coins two new
pieces of substrate every downstream banger consumes: the **`shared.published.{nodeKey}` publish
port** and the **`canvas_recipes` row**. 74/75/76/77 share no code seam with each other — they are
parallel-safe once 73's foundation (specifically its Wave A connect wedge + Wave B publish port)
lands. Phase 77's read-only slice (Waves A+B) has *no hard code dependency* and could ship against
today's `main`; it is sequenced behind 73 only so its headline write tool `polytoken.addCanvasNode`
(Wave C) has a living-instrument target.

---

## What the just-shipped wedge already delivers toward the arc (esp. Phase 73)

The current session shipped the launch pad. Concretely, already on `main`:

- **11 new canvas node types** (canvas is now ~24 types: `entity`, `knowledge-search`,
  `review-queue`, `rule-suggestions`, `pipeline-health`, `brief`, `usage`, `documents`,
  `references`, `search-all`, `conversations`). Every one is **user-placeable AND agent-droppable via
  `canvas.addNode`**, ref-only, owner-scoped, degrading to a placeholder on unknown type. These are
  the *vocabulary* 73 wires, 74 places headless, and 75/76 re-render — the render surfaces exist; only
  the joining-up is missing.
- **The `canvas.addNode` agent-draws-node wedge** (`emit_canvas_node` listener tool behind
  `CANVAS_EMIT_TOOL_ENABLED` + the web `canvas_add_node` message-part reconcile reusing the
  genui-panel live-reconcile path). This is **exactly one third of Phase 73's loop** — the `addNode`
  verb. Phase 73 adds the other two thirds: **`connect`** (Wave A) and **recompute/publish** (Wave B).
- **`canvas.connect` is already a complete, tested server verb** — declared once
  (`packages/capabilities/src/canvas.ts:346`), ownership-gated and idempotent through the same store
  the UI's own save uses, persisted per-row into `canvas_edges` with `{sourcePath, targetKey}` as
  first-class jsonb. 73's Wave A only carries the *intent* model→canvas; the write path is done.
- **The live-recompute engine already ships and is reactive** — `usePanelData` overlays a target's
  `targetKey` with `resolveCanvasPath(state.values, edge.sourcePath)` and re-resolves on every store
  change via a `useShallow` selector (infinite-loop hazards already tamed). 73 doesn't build a
  reactivity engine; it makes non-genui nodes *publish into* the one that exists.
- **The durable graphile-worker runtime + Workspace→Canvas→Node/Edge rows** (Track 3a / Phase 66,
  Task #7) — the scheduler substrate 74's cron rides, the durable re-poll 73's LCAN-09 rides, and the
  fan-out re-label 75 rides. Co-located, in-process `crontab`, no new infra.

Net: **the wedge already delivers `addNode` + the render vocabulary + the reactive engine + the
durable runtime.** The whole milestone is connective tissue over already-built spines — which is
precisely why five bangers are simultaneously in reach.

---

## The single highest-leverage first slice — Phase 73 flagship

**Wave A of Phase 73: the "connect wedge"** — Plan 73-01 (`apps/email-listener` `emit_canvas_connect`
tool behind `CANVAS_EMIT_TOOL_ENABLED`, registered in `registry.py`, emitting a `canvas_connect`
message part) + Plan 73-02 (`apps/web` `MessagePart` arm + a reconcile pass that materializes it as a
`data-edge` via the existing `toFlowEdge`, idempotent on `connect`'s own dedup key).

Why this slice first:

- It is the **smallest shippable increment that changes the product's category** — the moment the
  agent can *wire* two nodes it already drops, the arrows become load-bearing. That is the "holy shit"
  in one turn, on top of the wedge that already draws.
- It **unblocks everything downstream even before 73's Waves B/C land** — 74 (headless assembly),
  75's visible cascade, 76's data-wired island, and 77's write tool all ride the connect channel.
- The **server verb is already complete**, so the slice is pure intent-carrying (a listener tool + a
  web reconcile arm) — minimal, flag-gated, fail-closed, no new persistence or reactivity.
- It de-risks the milestone's one recurring landmine (the LWW canvas row race) at the smallest
  possible surface: a live-materialized edge must be idempotent against the post-turn
  `getCanvasLayout` refetch, and proving that here settles it for 74/75/76.

Ship Wave A, then fan out. Waves B (the publish port) and C (named recipes + durable recompute) of 73
follow, and 74/75/76/77 open in parallel behind them.

---

## Sequencing (recommended build order)

1. **Phase 73, Wave A** (connect wedge) — the flagship first slice above. Ship it standalone.
2. **Phase 73, Wave B** (the publish port: source-capable nodes write a bounded projection to
   `shared.published.{nodeKey}` on query-settle) — makes the wire carry data; unblocks 76.
3. **Phase 73, Wave C** (named `canvas_recipes` row + durable after-close recompute) — coins the
   recipe substrate 74 and any "recipes gallery" read from; LCAN-09 is a named live-verification seam.
4. **Then 74 / 75 / 76 / 77 in parallel** — four independent branches, no shared code seam. Within
   each, the backend waves are parallel-safe and the web/visible wave lands last:
   - **77 read slice (Waves A+B)** can actually start *earliest* — no hard 73 dependency — as a
     standalone read-expose win; only its write tool (Wave C) gates on 73.
   - **75's backend cascade (Waves 1–2)** likewise needs no 73; only its *visible* cascade (75-05)
     reuses 73's reconcile channel.
   - **74** needs 73's per-node emit + reconcile to exist first (it runs that same drawing capability
     headless on a cron).
   - **76** is meaningless without 73's publish port + connect wedge + `usePanelData` overlay — gate
     it on 73 Waves A+B.

**Live-verification seams to carry to the milestone runsheet (never CI-gated):** LCAN-09 (durable
after-close recompute against a running worker), MORN-07 (a real overnight run + `screenshot:review`),
CPF's re-label fan-out (needs migrations 0038/0039 + the new `correction_propagations` migration
applied live — inheriting Phase 57's still-deferred live legs), BTAP-07 (agent authored the app
end-to-end), MCPX-09 (Pedro's real Claude Code connecting). Every one is DB/worker/browser-verified,
never asserted from jsdom (CLAUDE.md: verify against the DB, not terminal output).

**Standing landmines across all five (from the specs' Risks sections):** no `terraform apply` (no
remote state → mail-outage trap); every listener change ships flag-gated + fail-closed because a merge
redeploys the listener; the LWW canvas row race (prefer `CANVAS_ROW_MODEL=read_rows` behind the
shadow-compare parity gate, never assumed in tests); `sharedState` is a bounded blob (publish/inject
SUMMARIES, never full datasets); the data-edge stays neutral (Law 1); every new procedure is
`protectedProcedure` with ownership asserted FIRST. None of the five touches SES,
`magnitudetech.com.br`, `nauta-*`, or outbound mail — keep it that way.
