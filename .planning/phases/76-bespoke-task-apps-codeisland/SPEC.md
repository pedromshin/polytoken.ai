---
phase: 76-bespoke-task-apps-codeisland
milestone: vNEXT-living-canvas
status: proposed
size: L
depends_on: [73]
requirements: [BTAP-01, BTAP-02, BTAP-03, BTAP-04, BTAP-05, BTAP-06, BTAP-07, BTAP-08, BTAP-09, BTAP-10]
---
# Phase 76 — Bespoke disposable apps per task (code-islands over your data)   ·   BANGER: Cursor for life-admin — the agent writes you a throwaway app wired to your real files, live

## Goal
Select two data nodes on the canvas — a "3 invoices" spreadsheet and a "bank export" file — say **"build me a
reconciler,"** and the agent generates a **real, bespoke mini-app** as a canvas node: sandboxed JavaScript that
consumes *your actual rows* as typed inputs and renders a working reconciliation. Edit a source cell and the app
recomputes itself. When the task is done, delete the node — it was always disposable. This turns the shipped
jailed code-island generator (Phase 20) from a *studio toy that renders decorative widgets* into a **data-wired
instrument grounded in the personal graph**.

## Why this is a banger (and why now)
Every "AI writes you an app" demo today generates code that either (a) can't touch your real data (it's a static
sandbox), or (b) touches it by handing the model your files wholesale (a privacy fire). Polytoken already has the
**two halves nobody else has joined**: a *hardened jailed-eval code generator* (multi-candidate + judge + AST
allowlist + repair loop, opaque-origin `connect-src 'none'` frame — the model's output can NEVER exfiltrate) AND,
after Phase 73, a *reactive dataflow spine* (`shared.published.{nodeKey}` projections + `canvas.connect` data-edges
+ `usePanelData` overlay that re-resolves on every store change). This phase welds them: the code-island node
**reads its incoming data-edges** and **injects the overlaid, owner-scoped, bounded projections into the jail as
typed inputs** — the generated app operates on real data it can compute over but the network can't leak, and it
**recomputes for free** through the exact reactive engine Phase 73 shipped. Only *this* architecture can do it:
the jail makes untrusted generated code safe to run over private data, and the publish-port makes that data flow
without ever crossing to the model. The compounding payoff: because the island + its input bindings are rows in
the personal graph (not a chat transcript), a "reconciler" you built once becomes a **standing, re-openable,
re-groundable tool** — the first true *bespoke app object* in the graph, which a future "tools gallery" and
cross-conversation reuse read from.

## What already exists — the plumbing (file:line evidence, be exhaustive)

### The jailed code-island GENERATOR (Phase 20 — fully shipped, both ends)
- **web tRPC proxy**: `packages/api-client/src/router/genui/code-island.ts:72` `codeIslandGenerateProcedure`
  (`protectedProcedure`, `:72`); input `CodeIslandInput` = `{ intent, rawContent, importerId }` (`:47`); output
  `{ code, outcome, attempts, reason }` (`:56`); proxies `POST ${url}/v1/genui/code-island/generate` with the
  server-side `X-API-Key` from `getListenerConfig()` (`:76`, `:80-88`); non-2xx/network/parse all return
  `WEB_FALLBACK_CODE` (`:40-45`, `:68`) — never throws. Registered as `genui.codeIslandGenerate`
  (`packages/api-client/src/router/genui/index.ts:29`).
- **FastAPI endpoint**: `apps/email-listener/app/presentation/api/v1/genui_code.py:81` `POST /v1/genui/code-island/generate`;
  request model `GenerateCodeIslandRequest` = `{ intent, raw_content, importer_id }` (`:42-61`); `X-API-Key`
  gate on the whole router (`:33`); response `GenerateCodeIslandView` = `{ code, language, outcome, attempts,
  candidate_count }` (`:64-73`) — and the docstring at `:72` explicitly notes **"additive field; the web tRPC
  client ignores unknown/extra fields, so no web change is required"** (the extension seam for BTAP-05).
- **the pipeline**: `apps/email-listener/app/application/use_cases/generate_code_island.py:99` `execute(intent,
  raw_content, importer_id)` — Call A quarantine ONCE (`:132`), fan out N candidates CONCURRENTLY via
  `asyncio.gather` at varied temperatures (`:146-157`), judge ranks ≥2 non-fallback candidates (`:256`), audit
  best-effort (`:210-213`). No cache (code is non-deterministic, `:24`). `raw_content` is untrusted and crosses
  ONLY through Call A quarantine (SAFE-02, `:129-135`); only the structured extraction reaches the generator.

### The JAIL — the load-bearing safety substrate (@polytoken/genui/sandbox)
- `packages/genui/src/sandbox/build-island-srcdoc.ts:18` `ISLAND_SANDBOX = "allow-scripts"` — **no
  `allow-same-origin`** ⇒ opaque/null origin, no host DOM/cookies/storage, self-unsandbox impossible.
- `build-island-srcdoc.ts:26-28` `ISLAND_CSP_POLICY` = `default-src 'none'; … connect-src 'none'; base-uri
  'none'; form-action 'none';` — the SOLE, all-engines CSP; **the frame has zero network egress.** The header
  warns: do NOT add an allowed `connect-src`/img host or you open an exfil channel.
- `build-island-srcdoc.ts:101-120` `buildIslandSrcdoc(options)` — **params are ONLY `{ code, nonce, axeSource,
  hostOrigin }` (`:30-44`). There is NO data channel.** Assembles: CSP meta first (`:107`), `#island-root`
  (`:110`), harness script (`:111`), then the user `code` wrapped in try/catch (`:112`). `guardScript` neutralizes
  premature `</script>` (`:47-49`).
- `build-island-srcdoc.ts:51-75` `harnessScript` runs BEFORE user code — installs `window.__islandPost`
  (pinned-targetOrigin postMessage, `:57`), a CommonJS shim (`:63-64`), and error capture. **This is exactly
  where a frozen data global is injected (BTAP-01).**
- `packages/genui/src/sandbox/validate-island-code.ts:193` `validateIslandCode` — pre-execution AST allowlist;
  forbidden sets: `NETWORK` (fetch/XHR/WebSocket/EventSource, `:56`), `DYNAMIC_EVAL` (`:55`), `STORAGE` (`:57`),
  `HOST_ACCESS` (parent/top/opener/frames, `:58`), `REFLECTION` (`:59`), reflective props `__proto__`/`constructor`
  (`:74`). A bare read of an injected `window.__ISLAND_DATA__` is NOT in any forbidden set (`__ISLAND_DATA__`
  → `ruleFor` returns null, `:102-109`) — so a data-reading island passes the allowlist unchanged.
- `packages/genui/src/sandbox/island-message.ts:44-48` `IslandMessageSchema` (ready/runtime-error/a11y discriminated
  union); `:69-81` `isTrustedIslandMessage` = object-identity + `origin === "null"` + nonce (never origin alone).
- **render surface** (studio, the pattern the canvas node copies): `apps/web/src/app/studio/_components/code-island-frame.tsx:78`
  `CodeIslandFrame` — `startIsland` repair state machine (`:84`), fresh nonce per `code`/`attempts`/`phase`
  (`:92`), authenticates every inbound message (`:105`), rebuilds srcdoc via `buildIslandSrcdoc({ code, nonce,
  axeSource, hostOrigin })` (`:152`), **restarts the pipeline when the `code` prop changes** (`:139-141`) — the
  hook that makes reactive re-render trivial (BTAP-03).
- **studio intent→island loop** (the UX the canvas flow copies): `apps/web/src/app/studio/_components/code-sandbox-island.tsx:85`
  `api.genui.codeIslandGenerate.useQuery({ intent, rawContent }, { enabled:false })` + manual `refetch` (`:114`),
  honest fallback handling (`:122-130`), `liveHealer` re-generates with the runtime error appended (`:91-104`).

### The DATA nodes this grounds in (ref-only, owner-scoped reads — the INPUT sources)
- **spreadsheet**: node.data schema is ref-only `{ spreadsheetId, label? }` — `packages/capabilities/src/canvas.ts:210-215`
  + `apps/web/src/app/chat/_canvas/node-data-schemas.ts:126-133` (`SpreadsheetNodeDataSchema`, `.strict()`), fetched
  by `apps/web/src/app/chat/_canvas/spreadsheet-node.tsx:77` `api.spreadsheets.byId.useQuery`. Control plane:
  `packages/api-client/src/router/spreadsheets/index.ts:150` `byId` (ownership asserted FIRST, NOT_FOUND on
  missing-or-not-yours, `:153`), `:132` `list`, `:176` `create`. The columns/rows document shape is defined by
  `packages/capabilities/src/table.ts:77-96` (`tableColumnSchema`/`tableRowSchema`), bounded `MAX_TABLE_COLUMNS=64`
  / `MAX_TABLE_ROWS=5000` (`:55-56`), prototype-pollution guarded (`:37-48`, `:120`).
- **document**: `canvas.ts:142-144` `{ documentId, label? }`; router `packages/api-client/src/router/documents/index.ts:93`
  `byId` (ownership FIRST, `:16-17`), `:138` `create`.
- **file (vault)**: `canvas.ts:222-236` ref-only `{ path[], name, label? }` (safe-segment gated); router
  `packages/api-client/src/router/files/index.ts:260` `requestDownload`, `:168` `list`.
- **the 27-type node allowlist** these live in: `packages/capabilities/src/canvas.ts:126-260` `CANVAS_NODE_DATA_SCHEMAS`
  (mirrored by `apps/web/src/app/chat/_canvas/node-type-registry.ts:54` `NODE_TYPE_REGISTRY`; id-set-equality pinned
  by the apps/web drift test). **There is NO `code-island` node type** — confirmed absent from both allowlists and
  from `apps/web/src/app/chat/_canvas/` (no `code-island-node.tsx`). This is the primary structural gap.

### The DATAFLOW spine (Phase 73 — the dependency this welds onto)
- `packages/capabilities/src/canvas.ts:346` `canvasConnectCapability` (`canvas.connect`) — the data-edge verb;
  input `{ sourceNodeId, targetNodeId, sourcePath (default "data"), targetKey (default "input") }`
  (`canvas.ts:270`, defaults `:236-237`), forbidden-path guarded (`:253`).
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx:243` `usePanelData(panelId, incomingEdges)` — a target
  panel's slice **overlaid** with each edge's `resolveCanvasPath(state.values, edge.sourcePath)` written at
  `edge.targetKey` (`:272`), re-resolved on every store change via `useShallow` (`:262`); `:186`
  `CanvasEdgesProvider` builds the live `targetPanelId -> incomingEdges[]` map. **This is the seam the code-island
  node consumes to collect its typed inputs.**
- Phase 73's **publish port** (73 SPEC seam 2, `.planning/phases/73-living-canvas-agent-dataflow/SPEC.md:133-139`):
  each source-capable node writes a bounded projection to `shared.published.{nodeKey}` when its tRPC query settles,
  through the bounded 5-mutation enum (`apps/web/src/app/chat/_canvas/canvas-store.ts:112`). **BTAP consumes this
  projection as the island's input** — it must NOT re-read the full dataset.
- Phase 73's **connect wedge** (73 SPEC seam 1): the `canvas_connect` message part + reconcile pass that
  materializes a `data-edge` via `toFlowEdge` (`chat-canvas.tsx:295`), behind the in-flight
  `CANVAS_EMIT_TOOL_ENABLED` listener flag (not yet in-tree; `grep` returns nothing — it is the wedge being built
  now). BTAP's agent-authored variant (BTAP-07) rides the same flag + message-part machinery.

## The gap (what's missing to make it real)
Five seams. **The generator, the jail, and the dataflow engine all already exist — this phase adds a data channel,
a node, a table, a typed-input contract, and the grounding flow that joins them.**

1. **The jail has no data channel (`packages/genui`).** `buildIslandSrcdoc` (`build-island-srcdoc.ts:101`) takes
   no data. **Seam**: add an optional `data` param that the harness injects as a **frozen, JSON-parsed** global
   `window.__ISLAND_DATA__` **before** the user script runs (extend `harnessScript`, `:51-75`) — serialized via
   `JSON.stringify` (a *string*, never code — no `eval`), size-capped, prototype-pollution-guarded (reuse the
   `FORBIDDEN_KEYS` deep guard, `table.ts:37-48`). CSP + `sandbox` tokens are UNCHANGED (still `connect-src 'none'`);
   the data is the user's own, injected locally, so no egress surface is added. The AST allowlist is UNCHANGED
   (`__ISLAND_DATA__` is not a forbidden name).

2. **No `code-island` canvas node type (`packages/capabilities` + `apps/web`).** **Seam**: add a ref-only
   `code-island` node to BOTH allowlists — `CANVAS_NODE_DATA_SCHEMAS` (`canvas.ts:260`, before the freeze) and
   `NODE_TYPE_REGISTRY` (`node-type-registry.ts:54`) + `node-data-schemas.ts` (`:133`, sibling to
   `SpreadsheetNodeDataSchema`) — with `node.data = { islandId: uuid, label? }` (ref-only discipline: the code +
   input bindings rehydrate from a row, never ride the layout). Add `apps/web/.../code-island-node.tsx` (copies
   `spreadsheet-node.tsx`'s fetch/loading/error shape + hosts a `<CodeIslandFrame>`). Keep the apps/web ⇄
   capabilities drift test green (add the id to both).

3. **The island isn't persisted (`packages/db` + `packages/api-client`).** Generated code is non-deterministic and
   uncached (`generate_code_island.py:24`) — it must be stored to survive reload. **Seam**: a `code_islands` table
   (mirrors `spreadsheets`) = `{ id, userId, intent, code, inputBindings, createdAt }` where `inputBindings` is the
   `targetKey -> { sourceNodeKey, sourcePath }` map; an ownership-gated `codeIslands.*` router (`byId` for the node
   read, `create` as the persist side, optional `remove` for disposability) — every proc `protectedProcedure`,
   ownership asserted FIRST → NOT_FOUND (mirror `spreadsheets/index.ts:150-170`).

4. **The generator can't be grounded in typed data inputs (`code-island.ts` + `genui_code.py` +
   `generate_code_island.py`).** Today `codeIslandGenerate` takes only free text; the model has no idea what
   `window.__ISLAND_DATA__.invoices` looks like. **Seam**: add an optional bounded `inputs` manifest to
   `CodeIslandInput` (`code-island.ts:47`) — per targetKey: `{ kind, columns?, rowCount?, sample? }` (a *shape +
   tiny sample*, capped, NOT the full dataset). Forward it as `inputs` on `GenerateCodeIslandRequest`
   (`genui_code.py:42`, additive — web ignores unknown fields per its own `:72` note) into the generator prompt so
   the emitted code reads `window.__ISLAND_DATA__.{targetKey}` against the known shape. The manifest is a
   *description*, so it can safely reach the model (unlike `raw_content`, it needn't be quarantined — but cap it).

5. **No "build a tool for task X grounded in these nodes" flow (`apps/web` + optional listener).** **Seam**: a
   canvas orchestration — user multi-selects 2+ data nodes → "Build a tool…" (add-node menu / selection action) →
   client reads each selected node's `shared.published.{nodeKey}` projection (Phase 73), assembles the `inputs`
   manifest + a `targetKey -> {sourceNodeKey, sourcePath}` binding, calls `codeIslandGenerate`, persists via
   `codeIslands.create`, materializes ONE `code-island` node, and draws a `data-edge` from each source (Phase 73's
   `canvas.connect`/`canvas_connect`). The **agent-authored** variant (BTAP-07) is an `emit_code_island` listener
   tool + message part behind `CANVAS_EMIT_TOOL_ENABLED` (fails closed) — the "the agent writes you an app" line.

## Vertical slice / MVP (the smallest demo that proves it)
**Setup:** two nodes on the canvas — a `spreadsheet` node ("3 invoices": id, vendor, amount) and a second
`spreadsheet` node ("bank export": date, description, amount).

**User:** multi-selects both, clicks **"Build a tool from these,"** types *"reconcile these invoices against the
bank rows — show matched, unmatched, and the difference."*

**What happens (one flow, no hand-written code):**
1. The two source nodes have already published bounded projections to `shared.published.{srcKey}` (Phase 73 port);
   the flow reads them, builds the `inputs` manifest (`{ invoices: {columns, rowCount, sample:[…3 rows…]}, bank:
   {…} }`) and the binding `{ invoices -> {src1, published.src1}, bank -> {src2, published.src2} }`.
2. `codeIslandGenerate({ intent, inputs })` → the multi-candidate+judge pipeline emits island JS that reads
   `window.__ISLAND_DATA__.invoices` / `.bank`; `codeIslands.create` persists `{ code, inputBindings }`.
3. A `code-island` node materializes, wired by two `data-edge`s (`published.src1 → invoices`, `published.src2 →
   bank`). The node's `usePanelData` overlays both projections; it passes `{ invoices, bank }` into
   `buildIslandSrcdoc({ code, data })`; the jailed frame renders a **live reconciliation table** — matched rows,
   unmatched, total difference — computed inside the sandbox over the real numbers.
4. The user edits an invoice amount cell → the spreadsheet query refetches → its published projection changes →
   `usePanelData` re-resolves → the `code` prop is unchanged but the injected `data` changes → `CodeIslandFrame`
   re-renders the frame with the new data → **the reconciliation updates itself.** Reload → the node, its edges,
   and the persisted island code all restore; the app is exactly as it was.
5. The user drags the node to the trash → `deleteElements` drops the placement (the `code_islands` row can be
   explicitly removed) — it was disposable all along.

The "holy shit": one sentence turned two of *your* spreadsheets into a **working, self-updating, throwaway app** —
generated code the network can't leak, computing over data the model never saw in full.

## Success criteria (testable / UAT)
Gate-able here (unit / geometry / real-browser):
- [ ] **BTAP-01** `buildIslandSrcdoc({ code, data })` injects `data` as a **frozen** `window.__ISLAND_DATA__`
      global via `JSON.stringify` (a string, never executed), BEFORE the user script; over-cap or
      pollution-keyed (`__proto__`/`constructor`/`prototype`) data is rejected/stripped, and `ISLAND_CSP_POLICY`
      + `ISLAND_SANDBOX` are byte-for-byte unchanged (`connect-src 'none'` preserved). (vitest on the sandbox
      builder + a CSP-string snapshot test.)
- [ ] **BTAP-02** A `code-island` node type exists in `CANVAS_NODE_DATA_SCHEMAS` AND `NODE_TYPE_REGISTRY` with
      ref-only `node.data = { islandId, label? }` (`.strict()`), and the apps/web ⇄ capabilities node-id drift
      test stays green. (vitest + the existing drift test.)
- [ ] **BTAP-03** With two `data-edge`s wired into a `code-island` node, the node collects both overlaid inputs
      from `usePanelData` and passes `{ [targetKey]: projection }` into the sandbox; changing a source's published
      value re-renders the island within one store tick (no manual refresh). (vitest extending
      `panel-data-flow.test.tsx`, asserting the `code` prop stable while injected `data` changes.)
- [ ] **BTAP-04** `code_islands` round-trips: `codeIslands.create` then `byId` returns `{ intent, code,
      inputBindings }` for the owner; a non-owner `byId` surfaces NOT_FOUND before any read. (db round-trip +
      tenancy test, asserted against the DB row — not terminal output.)
- [ ] **BTAP-05** `codeIslandGenerate` accepts a bounded `inputs` manifest, forwards it to FastAPI, and the
      manifest is size/shape-capped (columns ≤ 64, sample rows ≤ small N, no full dataset); omitting `inputs`
      preserves today's intent-only behaviour exactly (back-compat). (vitest on the tRPC input schema + a request-
      body assertion; `uv run pytest` on the FastAPI request model accepting the additive field.)
- [ ] **BTAP-06** The "Build a tool from these" flow, given ≥2 selected data nodes, produces exactly ONE
      `code-island` node and one `data-edge` per source, idempotent on re-run of the same selection (no duplicate
      node/edges). (vitest on the orchestration + geometry gate that the node + N edges render.)
- [ ] **BTAP-08** The generated island is still gated by the shipped safety stack: `validateIslandCode` runs
      before execution and a fetch/XHR/eval/parent-access attempt is BLOCKED (never runs), even with data present;
      the frame remains opaque-origin with `connect-src 'none'`. (vitest reusing the adversarial fixtures; assert
      the data channel opens no new sink.)
- [ ] **BTAP-09** Tenancy: every new procedure (`codeIslands.*`) is `protectedProcedure` with ownership asserted
      FIRST; the generation cache posture is unchanged (auth-gate only, mirroring `code-island.ts:15-17` /
      `generate.ts:33-36`). (tenancy test.)
- [ ] **BTAP-10** Disposability: deleting the `code-island` node removes only the placement (mirrors
      `spreadsheet-node.tsx:105` `deleteElements`); the `code_islands` row survives unless explicitly removed via
      `codeIslands.remove`. (vitest + geometry gate.)

Needs a **live loop** (named, not gate-able in CI):
- [ ] **BTAP-07** Agent-authored: "build me a reconciler from these two nodes" in chat → the listener
      `emit_code_island` tool (behind `CANVAS_EMIT_TOOL_ENABLED`, fails closed when unset) emits a message part
      that runs the grounding flow and materializes the wired node live in one turn. (Manual/live verification
      against a running listener + `:3000` web + DB; the tool must be flag-gated — a merge redeploys the listener.)

## Build sketch (waves → plans)
**Wave A (parallel-safe — the two independent substrate seams):**
- *Plan 76-01 — sandbox data channel* (`packages/genui`): `buildIslandSrcdoc` gains a bounded/frozen/pollution-
  guarded `data` → `window.__ISLAND_DATA__`. Must-haves: (a) JSON-string injection, never eval; (b) CSP + sandbox
  tokens unchanged; (c) size cap + `FORBIDDEN_KEYS` guard; parallel-safe (pure package).
- *Plan 76-02 — typed inputs on the generator* (`packages/api-client` + `apps/email-listener`): optional `inputs`
  manifest on `CodeIslandInput`/`GenerateCodeIslandRequest`, forwarded into the generator prompt. Must-haves:
  (a) bounded/capped manifest; (b) additive/back-compat (omit ⇒ today's behaviour); (c) `uv run pytest` +
  `lint-imports` green (the listener change ships under redeploy discipline).

**Wave B (depends on A — the node + persistence):**
- *Plan 76-03 — the `code-island` node + `code_islands` row* (`packages/capabilities` + `packages/db` +
  `packages/api-client` + `apps/web`): new ref-only node type in both allowlists, `code_islands` table,
  ownership-gated `codeIslands.*` router, `code-island-node.tsx` hosting `<CodeIslandFrame>` fed by `usePanelData`.
  Must-haves: (a) ref-only node.data + drift test green; (b) protected + ownership-first CRUD; (c) reactive
  re-render on input change.

**Wave C (depends on B — the grounding flow + agent seam):**
- *Plan 76-04 — "Build a tool from these" flow* (`apps/web`): selection action → read published projections →
  manifest + bindings → generate → persist → materialize node + data-edges (reusing Phase 73's connect path).
  Must-haves: (a) ≥2 selected nodes required; (b) exactly one node + one edge/source; (c) idempotent on re-run.
- *Plan 76-05 — agent-authored variant (live-verified)* (`apps/email-listener` + `apps/web`): `emit_code_island`
  tool + `canvas_code_island` message part behind `CANVAS_EMIT_TOOL_ENABLED`. Must-haves: (a) flag-gated, fails
  closed; (b) part shape mirrors the flow's inputs; (c) named live verification, NOT a CI gate.

## Risks & landmines
- **The jail is the whole product — do not weaken it.** BTAP-01 must keep `ISLAND_SANDBOX` free of
  `allow-same-origin` (`build-island-srcdoc.ts:18`) and `ISLAND_CSP_POLICY` at `connect-src 'none'` (`:26-28`).
  The data channel injects the user's OWN data locally; it opens NO network sink. A CSP-string snapshot test
  (BTAP-01/BTAP-08) pins this so a later "let the app fetch prices" temptation can't silently relax the policy.
- **Injected data must be inert.** Serialize with `JSON.stringify` and read back is a *string literal* in the
  harness — never interpolate raw objects into the script body (that would be code injection). Guard `</script>`
  via the existing `guardScript` (`build-island-srcdoc.ts:47`); deep-guard `__proto__`/`constructor`/`prototype`
  (reuse `table.ts:37-48`).
- **`shared.published` is a bounded blob (Phase 73 caveat).** The manifest `sample` and the injected `data` are
  SUMMARIES/caps — dumping 5000 rows blows the `sharedState` size gate (Phase 73 LCAN-03) AND bloats the srcdoc.
  Cap rows in both the manifest (to the model) and the injection (to the frame); a large table renders a
  "showing first N" projection, never the whole set.
- **LWW canvas race (Phase 73 / `canvas-mutations.ts` header).** The node + its edges ride the same layout row;
  materialization must be idempotent (BTAP-06) and the phase should run under `CANVAS_ROW_MODEL=read_rows`
  (per-row, race-free) behind the shadow-compare parity gate — do not assume `read_rows` in tests.
- **Non-determinism = no cache (`generate_code_island.py:24`).** Two "build a reconciler" clicks yield different
  code; the `code_islands` row is the source of truth for a *given* island (persist the winning `code`, don't
  regenerate on reload). The node reads `byId`, it does NOT re-call the generator on mount.
- **Manifest is model-visible; `raw_content` still is not.** The `inputs` manifest is a *shape description* + tiny
  sample and MAY reach the model directly — but it is still capped, and it must NOT become a backdoor for the full
  dataset (which would defeat the "the model never saw your data in full" property). Keep the sample tiny; the full
  rows only ever reach the *sandbox*, never the generator.
- **Listener redeploy on merge (CLAUDE.md).** BTAP-05's FastAPI change and BTAP-07's `emit_code_island` tool ship
  on the listener; a merge redeploys it, so the emit tool MUST be `CANVAS_EMIT_TOOL_ENABLED`-gated and fail closed,
  and the `inputs` field must be additive so an old web client keeps working. **No SES / `magnitudetech.com.br` /
  `nauta-*` / outbound-mail surface is touched** — this is DB + generation only; introduce none.
- **No Terraform apply.** Nothing here needs infra changes; the `code_islands` table is a Drizzle migration
  (`npm run db:migrate`), not a TF resource — do NOT `terraform apply`.
- **Tenancy.** Model-authored node keys are untrusted for identity; `codeIslands.byId` asserts ownership FIRST
  (BTAP-09), and the grounding flow re-reads only owner-scoped projections. The generation cache stays auth-gate-
  only (cross-tenant by design, `code-island.ts:15-17`) — introduce no per-user cache coupling.
- **Needs-live seam.** BTAP-07 (agent authored the app end-to-end) is only verifiable against a running listener +
  web + DB; name it a live-verification item, never assert green from jsdom (CLAUDE.md: verify against the DB, and
  jsdom does no layout — screenshot/geometry-assert the rendered island).

## Dependencies & sequencing
- **`depends_on: [73]`** — this phase is *meaningless without the dataflow spine*: it consumes Phase 73's
  `shared.published.{nodeKey}` publish port (the island's input source), the `canvas.connect`/`canvas_connect`
  data-edge (how a source wires into the app), and the `usePanelData` overlay + reactive re-resolve (how the app
  recomputes for free). Through 73 it transitively needs 66's durable Workspace→Canvas→Node/Edge row substrate
  (the `code_islands` row sits alongside it). It also reuses the already-shipped Phase 20 code-island generator +
  jail wholesale — no dependency there, it exists.
- **What it unblocks.** The `code_islands` row is the first **bespoke-app object** in the personal graph: a future
  "tools gallery" / re-openable-tool / cross-conversation reuse banger reads from it, and the morning-board (74)
  or any recipe surface can drop a saved tool as a node. The sandbox `data` channel (BTAP-01) is reusable by ANY
  future data-wired island. Wave A (76-01 sandbox channel + 76-02 typed inputs) is independently shippable and
  de-risks the hardest seam (safe data injection) before the node/flow land.
