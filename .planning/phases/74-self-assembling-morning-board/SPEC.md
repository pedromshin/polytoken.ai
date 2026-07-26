---
phase: 74-self-assembling-morning-board
milestone: vNEXT-living-canvas
status: in-progress
size: L
depends_on: [73]
requirements: [MORN-01, MORN-02, MORN-03, MORN-04, MORN-05, MORN-06, MORN-07]
build_log:
  - "MVP client-triggered board SHIPPED 2026-07-25 (f573c3d): a canvas Add-node
     'Assemble board' action drops the same brief+review-queue+usage node set in one
     click — the self-assembling board, user-triggered, visible NOW on /chat."
  - "Overnight backend SHIPPED 2026-07-25 (worker 1fe5b80 + listener <pending>): the
     durable substrate. Worker cron (0 5 UTC, gated on MORNING_BOARD_ENABLED) →
     dispatch_morning_boards fan-out → one idempotent assemble_morning_board job per
     home-board owner → listener POST /v1/home/assemble-job (api-key, raise-on-fail,
     flag-gated) → deterministic composer → tenancy-safe service-role home writer.
     MORN-01..06 green; migration 0054 additive (allowlist). Ships DARK: worker cron
     omitted + listener route no-ops until MORNING_BOARD_ENABLED flips at both ends."
  - "GAP for the full banger (MORN-07): /home is a fixed 4-panel grid, NOT a canvas —
     it does NOT render node-types today, so a server-composed node set is written but
     not painted. Making the overnight board VISIBLE needs /home to mount canvas-node
     rendering (home-scoped persistence + reconcile). Tracked as the remaining Phase 74
     web slice; the /chat MVP (f573c3d) delivers the visible capability meanwhile."
# Phase 74 — The morning board that builds itself   ·   BANGER: you open your laptop and a board about *your day* is already there — the agent drew it at 5am off last night's email.

## Goal
Overnight, a scheduled agent run composes (and each morning refreshes) the user's `home`-scoped canvas: pending merges, a brief, "3 need a reply", a spend meter, and a "what's eating your inbox" treemap — materialized as real canvas nodes on the pinned home board **before the user ever opens `/home`**. The user's first interaction of the day is not an empty inbox but a live, wired situation report the machine assembled while they slept.

## Why this is a banger (and why now)
Every other "AI summary" product makes you *ask*. This board **exists before you ask** — the compounding personal graph (entities, merges, cost ledger, inbox threads, generated documents) plus the capability spine (canvas nodes are declared once and consumed by four surfaces) means the same agent that draws a node live in `/chat` (the Phase 73 wedge) can run headless on a cron and draw the *whole board*. Nothing generic can do this: it requires (a) a durable per-user overnight scheduler, (b) a canvas persistence model that a *server-side agent* (no browser session) can write into, and (c) eleven live node types that already render real router data. All three now exist in-tree — this phase is the seam that connects the scheduler to the agent to the home canvas. The "holy shit" is temporal: the value is delivered in your absence.

## What already exists — the plumbing (file:line evidence, be exhaustive)

### The home canvas persistence — a server-writable, owner-keyed board
- **`packages/api-client/src/router/chat/home-canvas.ts:50-75`** — `chat.getHomeCanvasLayout` / `chat.saveHomeCanvasLayout`. Both `protectedProcedure`, keyed STRICTLY on `ctx.user.id` (home board owned by construction — no client id to check, comment at `:15-23`). `saveHomeCanvasLayout` takes a bare `{ snapshot }` (`:43-48`) and calls `writeHomeCanvasLayout(ctx.db, ctx.user.id, input.snapshot)`.
- **`packages/db/migrations/0046_home_canvas_scope.sql`** — the `scope` discriminator. A home row = `(user_id, scope='home')` with NULL `conversation_id`; partial unique index `idx_chat_canvas_layouts_home_user ON user_id WHERE scope='home'` (`:line` in file) → exactly **one home board per user** (the upsert target). CHECK `chat_canvas_layouts_scope_discriminator` makes conversation/home shapes mutually exclusive. RLS policy `chat_canvas_layouts_home_owner_authenticated` is owner-scoped but the app-boundary `user_id` filter is the primary wall (Drizzle connects as superuser, bypasses RLS).
- **`packages/api-client/src/router/chat/canvas-store-backend.ts:160-209`** — `readHomeBlob` / `writeHomeBlob`: the blob upsert with the inline `targetWhere: sql\`${ChatCanvasLayouts.scope} = 'home'\`` literal (`:199`, preserved verbatim so the partial-unique-index match survives prepared statements). `:305-333` `ensureHomeCanvasId` — the RowStore auto-create path (`kind='home'`, find-or-create personal workspace via `ensurePersonalWorkspace` `:225-248`). `:520-548` the `readHomeCanvasLayout`/`writeHomeCanvasLayout` orchestrators branch on `CANVAS_ROW_MODEL` (`off`/`dual_write`/`read_rows`, `:74-83`), blob authoritative in every mode (D10).
- **`packages/api-client/src/router/chat/canvas-mutations.ts:373-476`** — `addCanvasNode` / `connectCanvasNodes` / `removeCanvasNode` (the per-node agent single-op path). Ownership FIRST via `assertConversationOwnership` (`:385-387`), then `addNodeRow(...)` (`canvas-store-backend.ts:438-452`) under `read_rows`, else `runCanvasCapability("canvas.addNode", ...)`. **Note the gap below: these key on `conversationId`, NOT the home scope.**
- **`packages/api-client/src/router/chat/canvas-schema.ts`** — `CanvasSnapshotSchema` (nodes/edges/viewport/sharedState/nodeRegistryVersion), the wire contract shared by conversation and home boards unchanged.

### The eleven live node types the agent will place
- **`apps/web/src/app/chat/_canvas/node-types.ts:44-88`** — the `nodeTypes` React Flow map: `entity`, `knowledge-search`, `review-queue`, `rule-suggestions`, `pipeline-health`, `brief`, `usage`, plus (files present in `_canvas/`) `documents-node`, `references-node`, `search-all-node`, `conversations-node`. Unknown types degrade to `UnknownNodeTypePlaceholder` (`:88`) — a board the agent draws never blanks even if a node type is renamed.
- **`apps/web/src/app/home/_lib/morning-brief.ts:96-152`** — `shapeMorningBrief`: the PURE fold of `emails.listThreads` + `entities.reviewQueue` + `documents.list` into the render-ready `MorningBrief`. The module doc (`:14-16`) explicitly anticipates THIS phase: *"when the CH-03 scheduled synthesis turn lands, it can persist a pre-computed brief and this same shape renders it — the scheduling is a HANDOFF, the shape is stable."* This is the load-bearing seam: the content shaping is done; only the *scheduling that runs it server-side and persists nodes* is missing.
- **`apps/web/src/app/home/_components/morning-brief-panel.tsx:27-124`** — the thin presentational render over `MorningBrief`; owns no fetching (the board hands it the shaped brief). The `brief` node type maps to `BriefNode` (`node-types.ts:63`), so the same content renders as a canvas node.
- **Spend meter** — `packages/api-client/src/router/chat/cost.ts:1-40` (`chat.sessionCost` reads `chat_cost_ledger`, display-only) + the `usage` node (`node-types.ts:64` → `UsageNode`). **What's-eating-your-inbox treemap** — the emails treemap surface (Task #1 shipped) + a `pipeline-health`/`usage`-style node projection.

### The durable overnight scheduler substrate (Track 3a — built, co-located, NOT yet driving a morning job)
- **`apps/worker/src/index.ts:1-50`** — the co-located graphile-worker runtime. Runs as a NON-essential second container in the existing ECS task (comment `:1-6`), LISTENs on the durable queue, drains `taskList`, `concurrency` from `WORKER_CONCURRENCY` (`:34-44`).
- **`apps/worker/src/tasks.ts:11-44`** — `taskList` today = `{ ingest_inbound_email }`, each handler POSTs the job payload to the co-located Python listener over `localhost:8000` (`INTERNAL_URL`, `:13-14`) with `x-api-key` (`:23`); non-2xx throws → graphile retries → dead-letter (`:27-31`). The comment at `:37-44` names the allowlist as *"the seam that scales past a single task."*
- **`packages/db/migrations/0053_graphile_enqueue_wrapper.sql:26-47`** — `public.enqueue_job(p_identifier, p_payload, p_max_attempts, p_job_key)`, SECURITY DEFINER, with an **identifier allowlist** currently `('ingest_inbound_email','deep_research')` (`:36`, comment `-- allowlist; extend per task`). `job_key` makes a re-enqueue idempotent (replaces the pending job).
- **`apps/email-listener/app/domain/ports/job_enqueuer.py:14-49`** — the `JobEnqueuer` port (`enqueue(identifier, payload, *, max_attempts, job_key)`); concrete adapter `app/infrastructure/jobs/supabase_job_enqueuer.py`. The docstring (`:2-5`) names *"later the chat turn's deep-research sub-loop"* as a future caller — the same seam a morning job uses.
- **`apps/email-listener/app/presentation/api/v1/ingest_job.py:36-49`** — the internal worker re-entry route pattern: `POST /v1/emails/ingest-job`, `Depends(require_api_key)`, does NOT swallow failures (raises → 500 → worker retries). This is the exact template for a new `/v1/home/assemble-job` route.

### The agent that composes (the "run the agent" seam)
- **`apps/email-listener/app/application/use_cases/run_chat_turn.py:331-486`** — `RunChatTurn.execute(*, conversation_id, importer_id, importer_ids, ...)` yields typed `ChatRunEvent`s; the widget/genui emit path is `run_chat_turn_widgets.py`. This is the agent loop the Phase 73 `emit_canvas_node` listener tool hangs off — a headless invocation of the same loop (or a purpose-built assembly use case that reuses its context-gathering) is what the morning job triggers.
- **`apps/web/src/app/chat/_canvas/use-canvas-persistence.ts:153-189`** — `reconcileNodesFromHistory`: the PURE restore+reconcile pass. Pass 1 restores every saved node exactly (unknown types degrade, `:166-174`); Pass 2 materializes genui parts CURRENT history expects with no node yet, dagre-seeded (`:176-189`). The Phase 73 web reconcile that materializes `canvas_add_node` message parts reuses THIS path — the home board's first paint of agent-drawn nodes rides the same reconcile.

### The anticipatory spike settings (the "should we, and how loud" governor — currently OFF)
- **`apps/email-listener/app/settings.py:252-276`** — `ANTICIPATORY_PROMPTING_ENABLED: bool = False` (`:257`, the single global off switch — `run_triggers` short-circuits to `[]` when False). Tunables: `ANTICIPATORY_APPROPRIATENESS_THRESHOLD=0.75` (`:267`, bias hard toward NOT prompting), `ANTICIPATORY_JUDGE_MODEL_ID` (Haiku default, `:268`+`:346-348`), frequency cap `CAP_PER_WINDOW=1`/`CAP_WINDOW_MINUTES=10`/`CAP_PER_DAY=3` (`:274-276`).
- **`apps/email-listener/app/application/use_cases/evaluate_anticipatory_candidates.py:1-40`** — the ANTIC-02 two-gate chain (appropriateness judge + frequency cap, independent, D-08). `enabled=False` short-circuits everything. The morning job reuses this posture: an empty-brief night should draw a *calm* board, not noise — the appropriateness/cap machinery is the model for "don't assemble a board about nothing."
- **`apps/email-listener/app/domain/anticipatory/triggers.py:1-60`** — deterministic, side-effect-free triggers; `run_triggers` gated on `enabled`. The morning cron is a NEW deterministic trigger class (time-based), sibling to `detect_idle_after_genui`.

## The gap (what's missing to make it real)
Per layer, with the exact plug points:

1. **Scheduler → job (worker / db).** graphile-worker supports cron (`parseCronItems` / `crontab` option to `run()`), but `apps/worker/src/index.ts:34-44` passes **no `crontab`** — nothing fires on a schedule today. GAP: add a `crontab` entry (e.g. `0 5 * * *` per-day) that enqueues a new `assemble_morning_board` identifier, and add that identifier to (a) `taskList` in `apps/worker/src/tasks.ts:42-44` and (b) the `enqueue_job` allowlist in `0053_graphile_enqueue_wrapper.sql:36` (a new forward migration — do NOT edit 0053 in place). **Per-user fan-out:** the cron fires once; the handler must enumerate active users and enqueue one `assemble_morning_board` job per user (`job_key = "morning:<userId>:<yyyy-mm-dd>"` for idempotency, per the `job_enqueuer.py:41-44` contract).

2. **Internal route → agent (listener).** No `/v1/home/assemble-job` route exists. GAP: a new route mirroring `ingest_job.py:36-49` (`Depends(require_api_key)`, raise-on-failure), taking `{ user_id }`, that (a) gathers the same three inputs `shapeMorningBrief` folds (threads/reviews/documents) plus cost + inbox-treemap projections, and (b) drives an assembly use case that composes the node set. The use case reuses `RunChatTurn`'s context-gathering (`run_chat_turn.py:416-486`) or a purpose-built deterministic composer — Claude's discretion at plan time (deterministic composer is lower-risk for the MVP; the agentic version is the follow-up).

3. **Server-side write into the home board (api-client / db).** The **critical missing seam.** `saveHomeCanvasLayout` and the per-node `addCanvasNode` are `protectedProcedure` — they need a browser session (`ctx.user.id`). A worker→listener job has **no user session**. `addCanvasNode` also keys on `conversationId` (`canvas-mutations.ts:386`), not the home scope, so there is **no server-side "add node to a user's home board" entry today**. GAP options: (a) the listener writes directly to Postgres via a service-role home-scope writer that mirrors `writeHomeBlob`/`writeHomeRow` (`canvas-store-backend.ts:177-209`, `:427-434`) stamping `user_id` from the job payload (NOT a session) — lowest-latency, keeps LWW blob authoritative; or (b) an internal-api-key-guarded tRPC/HTTP mutation that accepts an explicit `userId` and asserts it against the api-key trust boundary. **The whole snapshot LWW write (`writeHomeBlob`) is the safest MVP** — one home board per user, one overnight writer, no concurrent browser save at 5am → the last-write-wins race the per-row model exists to close is not exercised here.

4. **First-paint of agent-drawn nodes (apps/web).** `getHomeCanvasLayout` already returns the persisted snapshot; the home board renders it. GAP: confirm the home board (`apps/web/src/app/home/`) reconcile picks up server-written nodes on load exactly as `reconcileNodesFromHistory` does for `/chat` — likely zero web change if the board reuses the persistence hook, but needs a real-browser gate (jsdom can't prove it).

5. **Governor (listener settings).** GAP: a `MORNING_BOARD_ENABLED` flag (sibling to `ANTICIPATORY_PROMPTING_ENABLED`, `settings.py:257`) defaulting False, so the feature ships dark and flips on per-tester — mirroring the anticipatory spike's single-off-switch discipline.

## Vertical slice / MVP (the smallest demo that proves it)
Manually enqueue one `assemble_morning_board` job for the seed user (via `enqueue_job` or a dev button). The worker drains it → POSTs `/v1/home/assemble-job` → the listener shapes the brief from real threads/reviews/documents and writes a home snapshot containing a `brief` node + a `review-queue` node + a `usage` (spend) node via the service-role home writer. The tester loads `/home` in a fresh browser (no prior interaction that morning) and **the board is already populated** — brief, merges-to-review, spend meter — with a "assembled 5:03am" timestamp. One `enqueue → agent → screen` loop, no typing.

## Success criteria (testable / UAT)
Gate-able here (no live loop needed):
- [x] **MORN-01** A new `assemble_morning_board` identifier is accepted by the `enqueue_job` allowlist (a new forward migration) and present in `apps/worker/src/tasks.ts` `taskList`; an unknown-identifier enqueue still raises (existing allowlist test extended).
- [x] **MORN-02** The worker `crontab` config enqueues `assemble_morning_board` on schedule AND fans out one job per active user with an idempotent `job_key` (unit test on the fan-out enqueuer: N users → N jobs, re-run same day replaces, does not duplicate).
- [x] **MORN-03** `/v1/home/assemble-job` raises (→ 5xx) on any failure (mirrors `ingest_job.py`; a swallow-to-200 regression test) and is api-key-guarded.
- [x] **MORN-04** The service-role home writer persists a snapshot keyed on the job's `user_id` (NOT a session), stamps `scope='home'`, and is tenancy-safe: a write for user A can never land on user B's home row (unit test asserts the `user_id`/`scope` filter, mirroring the `home-canvas.ts:15-23` ownership invariant).
- [x] **MORN-05** The composed snapshot validates against `CanvasSnapshotSchema` and every node type it emits resolves in `node-types.ts` (or degrades to the placeholder — no blank canvas).
- [x] **MORN-06** `MORNING_BOARD_ENABLED=False` fully darkens the path (no cron enqueue, no assembly) — the ship-dark switch (settings test).

Needs a live loop (name it — real overnight run against real email + a real browser):
- [ ] **MORN-07 (LIVE)** After an actual scheduled run against the seed user's real inbox, loading `/home` in a fresh browser shows the pre-assembled board with correct counts and a generation timestamp — a `screenshot:review` capture (jsdom does no layout; per CLAUDE.md this MUST be a real-browser gate, not a vitest assertion).

## Build sketch (waves → plans)

**Wave 1 (parallel-safe — disjoint files):**
- **Plan 74-01 · Scheduler + fan-out (worker/db).** (1) New forward migration extends the `enqueue_job` allowlist with `assemble_morning_board` (do NOT edit 0053). (2) `apps/worker/src/tasks.ts` gains the `assemble_morning_board` handler (POST `/v1/home/assemble-job`). (3) `apps/worker/src/index.ts` gains a `crontab`. (4) A per-user fan-out enqueuer (cron fires one dispatcher job that enumerates users → one job each, idempotent `job_key`). Truths: allowlist accepts the id; crontab enqueues; fan-out = N jobs, idempotent.
- **Plan 74-02 · Governor flag (listener settings).** `MORNING_BOARD_ENABLED=False` in `settings.py` sibling to the anticipatory switch; short-circuit test. Truths: flag defaults False; False fully darkens.

**Wave 2 (depends on 74-01's route contract):**
- **Plan 74-03 · Assembly use case + internal route (listener).** New `/v1/home/assemble-job` (mirrors `ingest_job.py`, raise-on-failure, api-key). A use case that gathers threads/reviews/documents/cost/inbox-treemap and composes the node set (deterministic composer for MVP; reuse `shapeMorningBrief`'s selection logic conceptually). Truths: route raises on failure; composes a schema-valid snapshot; empty-night → calm minimal board (not noise).
- **Plan 74-04 · Service-role home writer (api-client/db).** A home-scope snapshot writer callable WITHOUT a session, taking an explicit `userId`, mirroring `writeHomeBlob`/`writeHomeRow` and stamping `scope='home'`. Truths: writes keyed on payload `userId`; cross-tenant write structurally impossible; blob stays authoritative (LWW whole-snapshot).

**Wave 3 (depends on all — the paint):**
- **Plan 74-05 · Home first-paint + live gate (apps/web).** Confirm `/home` renders server-written nodes on load (reuse the persistence/reconcile path); `test:geometry`/`screenshot:review` against a running server. Truths: pre-assembled nodes appear on cold load; screenshot proves it.

## Risks & landmines
- **No server-side "add node to home board" exists today (the #3 gap).** `addCanvasNode` is conversation-scoped + session-bound; do NOT try to reuse it from the worker. Build the explicit-`userId` home writer instead. Getting this wrong is a **cross-tenant write** — MORN-04 is the guard.
- **LWW canvas caveat.** The overnight writer does a whole-snapshot `writeHomeBlob` (last-write-wins). This is safe *because* one board per user + a single 5am writer + no concurrent browser save — but if a user IS awake and editing at 5am, the agent write could clobber their in-flight layout. Mitigate: the assembly should be additive/idempotent (reconcile against the existing snapshot, don't blindly overwrite user-placed nodes) OR run under `read_rows` per-node adds once Phase 73's per-row path is proven. Name this as a live-verification seam.
- **CLAUDE.md live-infra landmines.** (a) **No Terraform remote state** — the worker is a co-located container in the EXISTING ECS task; do NOT `terraform apply` to add scheduling infra until shared state exists and every live SES resource is imported, or mail outage. Prefer graphile-worker's in-process `crontab` (code, not infra) over an EventBridge/cloud cron that touches TF. (b) **Listener redeploy on merge** — the new `/v1/home/assemble-job` route ships in the listener image; a merge redeploys the SNS receiver → coordinate. (c) **SES sandbox** is irrelevant here (no outbound mail) — the morning board is READ-only over the user's own graph.
- **`enqueue_job` allowlist is SECURITY DEFINER** (`0053:32`) — adding an identifier is a privileged-function change; the new migration is FILES-ONLY (applied to live DB by Pedro per the 0053 comment `:13`), never `apply`ed by this workflow.
- **Per-user fan-out cost.** Enumerating "active users" and running an agent per user nightly is a cost multiplier — the anticipatory frequency-cap posture (`settings.py:274-276`) and a cheap-model/deterministic composer keep it bounded. Do NOT run the full interactive chat turn per user; the master plan (`00-MASTER-PLAN.md:65`) is explicit that durability applies to the long loops, and the interactive turn stays in-process — the morning composer should be a bounded deterministic pass, not an unbounded agentic loop, for the MVP.
- **Needs-live-verification seams:** the real overnight schedule firing (MORN-07), first-paint against a real browser (jsdom does no layout — CLAUDE.md), and the LWW clobber window.

## Dependencies & sequencing
- **depends_on: [73]** — Phase 73 is the dataflow foundation: the `emit_canvas_node` listener tool + the web reconcile pass that materializes `canvas_add_node` parts into home/canvas nodes. This phase runs that same drawing capability *on a schedule, headless*, so 73's per-node emit + reconcile must exist first (and its `CANVAS_EMIT_TOOL_ENABLED` seam is the natural home for the assembly composer's node emission).
- **Rides on shipped foundations:** Track 3a graphile-worker (Task #7, done) is the scheduler substrate; the home-canvas scope (mig-0046) is the write target; the eleven node types are the vocabulary; `shapeMorningBrief` is the content shape (its module doc already names this phase's scheduling as the handoff).
- **Unblocks:** a general "scheduled agent composes a surface" pattern — once the morning board proves the worker→listener→home-canvas loop, the same seam drives any recurring board (a weekly review board, a per-project status board). It also gives the anticipatory spike (`ANTICIPATORY_PROMPTING_ENABLED`) its first *proactive-output* consumer that isn't a chat interruption.
