---
phase: 77-capability-registry-mcp-server
milestone: vNEXT-living-canvas
status: proposed
size: L
depends_on: [73]
requirements: [MCPX-01, MCPX-02, MCPX-03, MCPX-04, MCPX-05, MCPX-06, MCPX-07, MCPX-08, MCPX-09]
---
# Phase 77 — Your life as an MCP tool surface   ·   BANGER: your own Claude Code calls `polytoken.searchMyKnowledge` and your compounding personal graph answers

## Goal
Stand up a **self-hosted, expose-only MCP server** that projects the capability registry's read side —
`knowledge.search`, `entities.list`, `search.omnibox` (and, once phase 73 lands, `canvas.addNode`) — as
live MCP tools. Pedro adds one `mcpServers` entry to his OWN Claude Code / desktop config and, from any
agent session, calls `polytoken.searchMyKnowledge` / `polytoken.listEntities` / `polytoken.searchEverything`
and gets grounded, cited answers **from his own polytoken graph** — the same owner-scoped reads the web app
runs, with the same tenancy gate, exposed over stdio. The personal graph stops being a thing you visit and
becomes **tools every agent you use can wield**.

## Why this is a banger (and why now)
Everyone's Claude Code can read files and hit public APIs. **Nobody's can query the compounding, confirmed,
entity-resolved personal knowledge graph that polytoken has been silently building out of your mail.** That
graph is the moat, and today it is trapped behind the web UI. This phase is the cheapest possible unlock
because the hard parts are already built as *first-class, tested substrate that just isn't pointed outward*:

1. **The registry was DESIGNED to be pointed outward.** `capability.ts` is explicit: "one capability,
   declared once, read by four consumers … the registry pointed OUTWARD" (`capability.ts:9-14`, `:109-131`).
   `source`/`trust`/`risk`/`describe` are already the exact axes an MCP tool catalogue needs — `describe` is
   literally documented as "what an LLM reads to decide whether to call it" (`capability.ts:96`). An MCP
   projection is the **fifth consumer**, not a new architecture — exactly what master-plan Track 7 names
   ("project the capability registry as a self-hosted MCP server … expose-first only", MASTER-PLAN.md:108).
2. **The read procedures already exist, already owner-scoped, already tested.** `knowledge.search`,
   `entities.list`, and `search.omnibox` are shipped `protectedProcedure`s whose tenancy is enforced by ONE
   central helper (`userOwnedImporterIds` + `resolveListScope`); an owner-less caller gets empty results with
   zero queries. The MCP server does not re-implement any of this — it calls the SAME `appRouter` through the
   SAME `createCaller` factory the tests use.
3. **The self-hosted Node-service pattern already shipped.** `apps/worker` is a co-located Node package that
   boots a long-lived process against the same DB (`apps/worker/src/index.ts`). An MCP server is the same
   shape: a new workspace package with a `main()` that speaks a protocol instead of draining a queue.
4. **The Zod→JSON-Schema bridge is already vendored.** MCP tools need a JSON-Schema `inputSchema`; the read
   procedures carry Zod input schemas (`searchKnowledgeInputSchema`, `listInputSchema`, `omniboxSearchInputSchema`),
   and `zod-to-json-schema@3.25.2` is already a dependency (`packages/genui/package.json:42`). No new bridge tech.

The compounding payoff: because the tools are a *projection of the registry*, every capability the product
grows — every new read procedure, every new node type — becomes a tool Pedro's external agents can call the
day it ships, with `describe`/`risk`/`source`/`trust` carried through for free. And the **security posture is a
feature, not an afterthought**: this is EXPOSE-ONLY and NEVER consumes an external MCP server, so no untrusted
external tool description ever enters polytoken's own LLM context (the quarantine Track 7 mandates).

## What already exists — the plumbing (file:line evidence, be exhaustive)

### The registry, already projected "outward" (the thing this exposes)
- `packages/capabilities/src/capability.ts:76-106` — `Capability` descriptor: frozen `id`/`describe`/`risk`/
  `cost`/`source`/`trust` metadata half + `input`/`output` Zod schemas. `describe` is documented as the
  LLM-facing purpose string (`capability.ts:96`) — verbatim MCP tool description material.
- `capability.ts:113-116` — `CapabilityMeta` (`Pick` of the consumer-agnostic fields); `:122-131`
  `CapabilityManifestEntry` (`id`/`describe`/`risk`/`reversibility`/`cost`/`source`/`trust`) — the "registry
  pointed outward … Nothing here can execute" projection (`:118-121`). This IS the MCP catalogue row shape.
- `capability.ts:146-183` — `createCapabilityRegistry(...).list()` returns the frozen manifest projection;
  `:186-188` `defineCapability` freezes descriptors. Duplicate-id throw (`:157`) = stable tool names.
- `capability.ts:47-51` — `source: "builtin"|"external"`, `trust: "first-party"|…` — the trust axis an MCP
  server annotates each exposed tool with (all builtins are `builtin`/`first-party` today).

### The manifest mirror + four-face projection map (read-side identification)
- `packages/api-client/src/router/capabilities/builtin-manifest.ts:61-393` — `BUILTIN_CAPABILITY_MANIFEST`,
  the honest static mirror of every builtin's `CapabilityManifestEntry` + `origin`
  (`daemon`|`chat`|`control-plane`, `:50-59`). The **`risk:"read"`** entries are exactly the expose-safe set:
  `lookup_entity` (`:333`), `search_emails` (`:345`), `search_knowledge` (`:357`), `web_search` (`:369`),
  `deep_research` (`:381`), plus daemon `fs.read`/`fs.list`/`dir.*` and `desktop.attach`.
- `packages/api-client/src/router/capabilities/projection-map.ts:99-135` — the four declared faces per
  capability incl. `ToolProjection` (`status:"live"|"declared"` + `declaringSource`). `:320-364` marks
  `lookup_entity`/`search_emails`/`search_knowledge` as `liveTool(CHAT_REGISTRY)` — real tool defs today.
  The MCP server adds a **fifth face** (`mcp`) or, more cheaply, reads this map to know which ids are safe.
- `packages/api-client/src/router/capabilities/index.ts:37-45` — `capabilitiesRouter.manifest`
  (`protectedProcedure.query(() => BUILTIN_CAPABILITY_MANIFEST)`): the catalogue is already a served read.

### The read procedures the MVP exposes (owner-scoped, tested)
- `packages/api-client/src/router/knowledge/search.ts:128-158` — `knowledge.search`: trgm search over
  ACTIVE, EXTRACTED-tier knowledge nodes; scope from `userOwnedImporterIds` + `resolveListScope`
  (`:136-141`); input `searchKnowledgeInputSchema` (`:48-52`, `query 2..200`, optional `importerId`, `limit 1..50`).
- `packages/api-client/src/router/entities/gallery.ts:115-305` — `entities.list`: importer-scoped paginated
  gallery; `source='email_extracted'` always (`:148`), owned-scope (`:131-140`), input `listInputSchema`
  (`:34-44`). Returns `{items, hasMore, nextOffset}`.
- `packages/api-client/src/router/search/index.ts:181-392` — `search.omnibox`: five-arm cross-surface search
  (entity/email/conversation/knowledge/file), every arm owner-scoped, per-arm degradation guard
  (`settleArm`, `:152-162`), input `omniboxSearchInputSchema` (`:87-90`). Returns `{results}` typed by kind.

### The caller factory + context contract (how the MCP server invokes them, unchanged)
- `packages/api-client/src/index.ts:4-20` — `createCaller = createCallerFactory(appRouter)`, exported
  alongside `createTRPCContext`. `packages/api-client/src/root.ts:18-34` — `appRouter` mounts
  `knowledge`/`entities`/`search`/`capabilities`. The MCP server is a NEW caller of this exact surface.
- `packages/api-client/src/trpc.ts:26-48` — `SessionUser = { id; email? }`, `createTRPCContext({headers,
  user})` — identity is a plain injected value; the module "never reads identity from procedure input"
  (`:7-9`). `:93-103` — `protectedProcedure` throws `UNAUTHORIZED` when `ctx.user` is null. **This is the
  single seam the MCP server must fill with a server-verified principal.**
- `apps/web/src/app/api/trpc/[trpc]/route.ts:1-33` — the web reference for filling that seam:
  `supabase.auth.getUser()` → `createTRPCContext({ user: { id, email } })`. The MCP server fills it from a
  self-hosted principal instead (see gap), never from tool input.
- `packages/db/src/ownership.ts:1-60` — `userOwnedImporterIds` / `assertConversationOwnership`: the ONE
  fail-closed tenancy helper every scoped read already runs through; `_scope.ts:26-42` `resolveListScope`.

### The self-hosted Node-service precedent (the package shape to copy)
- `apps/worker/package.json:1-30` — a private workspace Node package (`@polytoken/worker`, graphile-worker),
  `start: node dist/index.js`, deps on the DB via connection string only.
- `apps/worker/src/index.ts:1-52` — the long-lived `main()` pattern: read a required env (fail loudly if
  absent, `:11-22`), boot the runtime, `await runner.promise`, `process.exit(1)` on fatal. An MCP stdio
  server is the same skeleton with `StdioServerTransport` in place of `run(...)`.

### The Zod→JSON-Schema bridge (already in the tree)
- `packages/genui/package.json:42` — `zod-to-json-schema@3.25.2`. MCP `tools/list` needs each tool's
  `inputSchema` as JSON Schema; the read procedures' exported Zod input schemas convert directly.

### The write tool the banger's headline names (rides on phase 73)
- `packages/capabilities/src/canvas.ts` `canvasAddNodeCapability` (`canvas.addNode`, `risk:"write"`,
  idempotent per referenced object) + its control-plane binding
  `packages/api-client/src/router/chat/canvas-mutations.ts` (`protectedProcedure`, conversation ownership
  asserted FIRST). Exposing `polytoken.addCanvasNode` is the write half — see Dependencies for why it waits on 73.

## The gap (what's missing to make it real)
No MCP projection server exists anywhere (`grep` for `@modelcontextprotocol`/`mcpServer` finds ONLY vendored
Anthropic SDK types under `apps/email-listener/.venv`). The missing seams, per layer:

- **New package `apps/mcp-server` (or `packages/mcp-server`) — the whole server is net-new.** Add
  `@modelcontextprotocol/sdk` as the ONLY new runtime dep; a `main()` mirroring `apps/worker/src/index.ts`
  that wires a `Server` + `StdioServerTransport`. No such package exists today.
- **Principal resolution (the `createTRPCContext.user` seam).** The web fills `user` from a Supabase cookie;
  a self-hosted stdio MCP server has no request cookie. It must resolve a **fixed, server-verified principal**
  — Pedro's own `user.id` — from a local secret (an env var `POLYTOKEN_MCP_USER_ID` + a required local bearer
  `POLYTOKEN_MCP_TOKEN`, both fail-closed if absent, mirroring `apps/worker`'s "required env or throw"
  posture). The id is NEVER derived from tool input (the `trpc.ts:7-9` invariant). Optionally verify the id
  against Supabase admin on boot so a stale id fails fast.
- **Capability → MCP-tool projection (the catalogue).** No code maps `CapabilityManifestEntry` → an MCP tool
  definition. Need a small pure module that: (a) reads an **explicit expose-allowlist** of `risk:"read"` ids
  (NOT "everything read" — an intentional, auditable set: `search_knowledge`→`polytoken.searchMyKnowledge`,
  `lookup_entity`→`polytoken.listEntities`, plus `search.omnibox`→`polytoken.searchEverything`); (b) pulls the
  `describe` string verbatim from the manifest for the tool description; (c) converts the procedure's exported
  Zod input schema via `zod-to-json-schema` into the MCP `inputSchema`. This mapping is the analogue of
  `projection-map.ts` for the fifth face and should be drift-guarded the same way (a test asserting every
  exposed id exists in `BUILTIN_CAPABILITY_MANIFEST` with `risk:"read"`).
- **Tool dispatch → `appRouter` caller.** No code turns an MCP `tools/call` into a `createCaller(ctx).knowledge.search(...)`
  invocation. Need a dispatch table id→`(caller, args)=>result` that re-parses args against the SAME Zod
  schema before calling (defense in depth), maps the typed result to MCP `content` (text blocks with the
  cited items), and maps a thrown `TRPCError` (e.g. `UNAUTHORIZED`) to an MCP error, never a crash.
- **Simplified tool surface (ergonomics).** The raw procedures take `importerId`/`offset`/`sort` — noise for
  an external agent. The exposed tools should present a **thin, query-first** input (`{ query, limit }`) and
  let the server default the rest; `importerId` stays server-defaulted to the full owned set (the safe path).
- **Expose-only guardrail (a stated non-goal, enforced).** There must be NO `mcpServers`/external-MCP client
  code in this package — a lint/test asserting the package never imports an MCP *client* transport, so the
  "never consume external MCP" mandate is machine-checked, not just documented.

## Vertical slice / MVP (the smallest demo that proves it)
**Pedro adds to his Claude Code `mcpServers` config:**
```
"polytoken": { "command": "node", "args": ["apps/mcp-server/dist/index.js"],
  "env": { "POLYTOKEN_MCP_USER_ID": "<his uuid>", "POLYTOKEN_MCP_TOKEN": "<local secret>",
           "POSTGRES_URL_NON_POOLING": "<local db>" } }
```
**He types in his own Claude Code:** *"search my polytoken knowledge for what I know about my landlord."*

**What happens:** Claude Code lists the polytoken tools (`tools/list` → `polytoken.searchMyKnowledge` with the
registry's own `describe` as its description), calls `polytoken.searchMyKnowledge({ query: "landlord" })`; the
server resolves Pedro's principal from env, builds `createTRPCContext({ user })`, invokes
`caller.knowledge.search({ query: "landlord", limit: 10 })` — the SAME owner-scoped, EXTRACTED-tier-only,
cited read the web runs — and returns the confirmed knowledge nodes as MCP text content. **His external agent
just answered from his own compounding graph, and nobody else's graph was reachable.**

The "holy shit": one config line turned months of silently-accreted personal knowledge into a tool any agent
he uses can call — and it's read-only, single-principal, and never lets an external tool description near
polytoken's own model.

## Success criteria (testable / UAT)
Gate-able here (unit / integration against a test DB, no browser):
- [ ] **MCPX-01** `tools/list` returns exactly the expose-allowlisted tools; every listed id exists in
      `BUILTIN_CAPABILITY_MANIFEST` with `risk:"read"`, and each tool's `description` equals the manifest
      `describe` verbatim (drift test, parity with `projection-map.test.ts` discipline).
- [ ] **MCPX-02** Each tool's `inputSchema` is the JSON-Schema conversion of the procedure's exported Zod
      input schema (`zod-to-json-schema`); a tool with no valid Zod source is refused at registration.
- [ ] **MCPX-03** `tools/call polytoken.searchMyKnowledge` dispatches to `caller.knowledge.search` and returns
      the SAME items an equivalent direct `appRouter.createCaller(ctx)` call returns (integration test reusing
      the `createCaller` pattern from `search.test.ts`/`knowledge-user-scoping.test.ts`).
- [ ] **MCPX-04** Tenancy: with a principal owning NO importers, every read tool returns an empty result and
      issues zero unscoped queries (mirrors `resolveListScope` fail-closed); tool input can NEVER name the
      acting identity — `user.id` comes only from the server principal.
- [ ] **MCPX-05** Principal resolution fails closed: missing `POLYTOKEN_MCP_USER_ID` or `POLYTOKEN_MCP_TOKEN`
      makes the server refuse to start (throw, like `apps/worker`'s required-env), never boot with a null user.
- [ ] **MCPX-06** A thrown `TRPCError` (e.g. `UNAUTHORIZED`, or a bad-arg Zod failure) maps to a structured MCP
      tool error — the server process never crashes on a bad call.
- [ ] **MCPX-07** Args are re-parsed against the procedure's Zod schema at the dispatch boundary before the
      caller runs (defense in depth; a malformed `limit` is rejected as an MCP error, not passed through).
- [ ] **MCPX-08** Expose-only guardrail: a test asserts the package imports NO MCP *client*/external-server
      transport and declares no `mcpServers` — the "never consume external MCP" mandate is machine-checked.

Needs a **live loop** (named, not gate-able in CI):
- [ ] **MCPX-09** End-to-end from Pedro's REAL Claude Code: the `mcpServers` entry connects, `tools/list` shows
      the polytoken tools, and `polytoken.searchMyKnowledge` returns grounded cited results from his live graph.
      (Manual/live verification against a running local DB with real owned importers; not a jsdom/CI assertion —
      verify against the DB, not terminal output.)

## Build sketch (waves → plans)
**Wave A (parallel-safe — the catalogue projection, pure/testable, no server yet):**
- *Plan 77-01 — the expose-allowlist + tool projection* (`packages/api-client` or the new package's `src/catalogue.ts`):
  a pure module mapping an explicit allowlisted read-capability id → `{ toolName, description(from manifest),
  inputSchema(from Zod via zod-to-json-schema), dispatch(callerId+procedurePath) }`. Must-haves: (a) every
  entry's id is in `BUILTIN_CAPABILITY_MANIFEST` with `risk:"read"`; (b) description === manifest `describe`
  verbatim; (c) drift test in the projection-map style.

**Wave B (depends on A — the server + principal + dispatch):**
- *Plan 77-02 — the MCP server package + principal* (`apps/mcp-server`): new workspace package, `@modelcontextprotocol/sdk`
  + `StdioServerTransport`, `main()` mirroring `apps/worker/src/index.ts`; principal resolved from
  `POLYTOKEN_MCP_USER_ID`/`POLYTOKEN_MCP_TOKEN` (fail-closed). Must-haves: (a) refuses to start on missing env;
  (b) builds `createTRPCContext({ user })` with a server principal, never tool input; (c) `main()` fatal-exit
  discipline copied from the worker.
- *Plan 77-03 — dispatch + result mapping* (same package): `tools/call` → re-parse args (Zod) → `createCaller(ctx)[router][proc](args)`
  → MCP `content`; `TRPCError` → MCP error. Must-haves: (a) re-parse before call; (b) never crash on bad
  input; (c) result carries the cited items as text content.

**Wave C (depends on Wave B AND phase 73 — the write tool):**
- *Plan 77-04 — expose `polytoken.addCanvasNode`* (catalogue + dispatch): project `canvas.addNode` as a write
  tool once phase 73's recipe/dataflow substrate makes an externally-authored node land in a durable canvas.
  Must-haves: (a) conversation ownership asserted FIRST (via the existing `canvas-mutations.ts` binding, never
  a new write path); (b) write tools are behind a SEPARATE, default-OFF expose flag from the read tools
  (`POLYTOKEN_MCP_WRITE_ENABLED`); (c) named live verification, not a CI gate.

## Risks & landmines
- **Expose-only is a HARD invariant, not a preference (Track 7 / MASTER-PLAN.md:108).** "30–82% of public MCP
  servers are exploitable; external tool descriptions flow into the LLM and must be quarantined." This package
  must NEVER contain an MCP *client* or connect to any external server — MCPX-08 machine-checks it. Do not let
  a future "let polytoken use external MCP tools" idea land in THIS package.
- **Principal secret handling.** `POLYTOKEN_MCP_TOKEN`/`POLYTOKEN_MCP_USER_ID` are local-only secrets; the
  server is single-principal by construction. It must fail closed (MCPX-05) and must NEVER accept an identity
  from tool input (`trpc.ts:7-9`, MCPX-04). Multi-user exposure is explicitly out of scope for this phase — a
  single self-hosted principal is the whole point (and sidesteps the SES-sandbox / multi-user landmines).
- **CLAUDE.md live-infra landmines are NOT touched — keep it that way.** This server is DB-read-only over
  `POSTGRES_URL_NON_POOLING`; it does NOT touch SES, `magnitudetech.com.br`, `nauta-*`, Terraform, or the
  listener. No `terraform apply`, no listener redeploy, no outbound mail. Introduce no such dependency. (Unlike
  phase 73's listener change, this phase adds NO email-listener code — it is a standalone read caller.)
- **npm workspaces, not pnpm (CLAUDE.md).** The new package is an `apps/*` (or `packages/*`) npm workspace;
  `@modelcontextprotocol/sdk` installs via `npm`. Node >= 20.12 already satisfied.
- **Result-size bound.** Read tools can return large result sets; cap `limit` at the procedures' own Zod
  maxima (`knowledge.search` limit ≤ 50, omnibox `limitPerKind` ≤ 20) and don't inflate — an unbounded dump
  bloats the external agent's context.
- **Tenancy re-verification.** The read procedures already fail-closed via `userOwnedImporterIds` +
  `resolveListScope`; the MCP server adds NO new scoping logic — it relies on the SAME procedures. Any new
  procedure exposed later must be `protectedProcedure` with ownership FIRST (the `canvas-mutations.ts:281`
  discipline) before it may join the allowlist.
- **Needs-live seam.** MCPX-09 is only real against Pedro's actual Claude Code + a local DB with real owned
  importers; it must be named as live verification, never asserted from a jsdom/unit suite (CLAUDE.md: "verify
  against the DB, not terminal output").

## Dependencies & sequencing
- **`depends_on: [73]`** — the READ-only slice (Waves A+B: `searchMyKnowledge`/`listEntities`/`searchEverything`)
  has NO hard code dependency and could ship independently against today's `main` (the read procedures + caller
  factory + manifest all exist). It is sequenced behind 73 because the **headline write tool**
  `polytoken.addCanvasNode` (Wave C) — the half that makes this "your agent BUILDS in your graph, not just
  reads it" — only becomes a *living instrument* target once phase 73's `canvas.connect` + recompute + named
  recipe substrate lands; before 73, an externally-authored node is an anonymous card. Ship Waves A+B early as
  the standalone read-expose win; gate Wave C on 73.
- **What it unblocks / compounds:** every future read procedure and node type auto-qualifies for the expose
  allowlist, so the tool surface grows with the product for free. It is orthogonal to phases 74/75/76 (no
  shared code seam) and is the canonical home for the Track-7 "expose-first" mandate — any later "expose
  capability X to my agents" work extends THIS package's allowlist rather than reinventing a server.
