# Track 3 — Design B: the clean-architecture cut

> Angle: build the **right long-lived architecture**, not the smallest diff. A durable-execution
> **seam the capability registry drives** (ingestion is task #1, `deep_research` task #2, future
> capabilities register the same way); a **worker co-location that scales past one task**; and a
> **first-class `Workspace → Canvas → Node` data model** with real FKs, indexes, cascade-delete
> edges, and RLS matching the 0047 member-visibility pattern. Correctness of the data model and a
> clean seam beat expedient hacks.
>
> Every step is tagged **[BUILD-IN-TREE + gate]** (authorable and verifiable in a checkout, ships
> via existing CI) or **[NEEDS LIVE / PEDRO / INFRA]** (Terraform apply, prod DB apply, or a live
> reachability fact). Sourced from scout docs 01–05, the master plan, and the cited code.

---

## 0. The two decisions that shape everything below

1. **Durability is a queue + retry + DLQ *around* the unchanged Python pipeline, not a rewrite of
   it.** The pipeline is Python end-to-end (`ingest_inbound_email.py:168-322`, dishka DI, poppler
   OCR, multi-Bedrock). The Node worker owns the *durable record* (the job row) and calls back
   into Python over HTTP. Nobody ports OCR/Bedrock to Node. (Scout 02 §4.4.)

2. **One generic durable-execution seam, many tasks.** Rather than a bespoke `enqueue_ingest_job`
   wrapper, we install **one** `public.enqueue_job(identifier, payload, max_attempts)` SECURITY
   DEFINER wrapper and a **Node `taskList` keyed by identifier**. `ingest_inbound_email` is the
   first identifier; `deep_research` is the second; each new durable capability adds a handler +
   an internal Python route, not new SQL. This is the seam the master plan's "event-source the
   long money-burning loops" (`00-MASTER-PLAN.md:65,173`) plugs into, and it is why the worker
   scales past a single task.

---

# PART A — Track 3a: graphile-worker durable runtime

## A1. graphile schema install — hybrid (library owns its schema; we own the seam)

**Decision: do NOT vendor graphile's `graphile_worker` schema. Install it with an explicit
one-shot; vendor only the tiny stable `public.enqueue_job` wrapper.** (Scout 02 §2.4.)

- graphile-worker's internal schema (`_private_jobs`, migrations, the `jobs` view) is explicitly
  *not a public interface* and shifts across minor versions (the v0.13→0.14 / v0.15→0.16
  restructures). Owning that SQL is a permanent maintenance tax.
- Install path: a one-shot Node step calling `runMigrations({ connectionString })` (equiv. CLI
  `graphile-worker --schema-only`) run **as the `postgres` owner over
  `POSTGRES_URL_NON_POOLING`** — the exact role/URL `packages/db/src/migrate.ts:10-15` already
  uses. Wire it as a discrete script `apps/worker/src/install-schema.ts` and a
  `packages/db`-adjacent npm script, sequenced **before** the wrapper migration (the wrapper
  references `graphile_worker.add_job`).
- **[BUILD-IN-TREE + gate]** the `install-schema.ts` script + a CI job (Track 2's ephemeral
  Postgres) that runs it then asserts `graphile_worker.jobs` exists.
- **[NEEDS LIVE / PEDRO]** running `--schema-only` against staging/prod is a DB apply Pedro runs
  (migrations/schema installs are files-only in this workflow).

## A2. The Python enqueue seam — one wrapper, `rpc()` call shape

**The wall (scout 02 §1.2–1.3):** `graphile_worker.add_job` needs database-owner privileges;
supabase-py authenticates as `service_role` (not owner); and PostgREST only exposes the `public`
schema so `graphile_worker.*` is unreachable via `.rpc()`. The fix is a `public` SECURITY DEFINER
wrapper owned by `postgres`, EXECUTE-granted to `service_role`.

**Migration `0051_graphile_enqueue_wrapper.sql`** (custom SQL — `migration:generate:custom
--name=graphile_enqueue_wrapper`; files-only). One generic wrapper, not one-per-task:

```sql
-- Requires the graphile_worker schema to already exist (A1 one-shot runs first).
-- NOTE deviation from repo RPC convention: existing RPCs (0009/0017) are SECURITY
-- INVOKER so RLS applies. add_job REQUIRES owner privileges, so this wrapper is
-- SECURITY DEFINER. It is an internal enqueue seam called only by service_role
-- (which already bypasses RLS); callers do their OWN authorization BEFORE enqueue
-- (SNS is SES-sourced; deep_research/canvas enqueues assert ownership in tRPC first).
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_identifier   text,
  p_payload      jsonb,
  p_max_attempts integer DEFAULT 8,
  p_job_key      text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, graphile_worker
AS $$
DECLARE v_id bigint;
BEGIN
  -- Optional hardening: allowlist identifiers so service_role cannot enqueue
  -- an arbitrary task name. Extend as tasks are added.
  IF p_identifier NOT IN ('ingest_inbound_email', 'deep_research') THEN
    RAISE EXCEPTION 'enqueue_job: unknown identifier %', p_identifier;
  END IF;
  SELECT (graphile_worker.add_job(
    p_identifier,
    p_payload::json,
    max_attempts := p_max_attempts,
    job_key      := p_job_key
  )).id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, integer, text) TO service_role;
```

**Python call site** — reuses the existing cached supabase client (`app/infrastructure/supabase/
client.py:35`), zero new deps, zero new connection, zero new secret on the Python side:

```python
supabase.rpc("enqueue_job", {
    "p_identifier": "ingest_inbound_email",
    "p_payload": {"ses_message_id": meta["message_id"], "recipients": list(meta["recipients"])},
    "p_max_attempts": 8,
    "p_job_key": f"ingest:{meta['message_id']}",   # dedupe: at-most-one live job per email
}).execute()
```

**Clean-arch touch:** wrap this behind a domain **port** so the SNS handler / reprocess / backfill
/ chat-turn all enqueue through one seam, not raw `.rpc()`:

- New port `app/domain/ports/job_enqueuer.py`: `class JobEnqueuer(Protocol): async def enqueue(self, identifier: str, payload: Mapping[str, object], *, max_attempts: int = 8, job_key: str | None = None) -> int`.
- Infra adapter `app/infrastructure/jobs/supabase_job_enqueuer.py` calling the rpc above, `.execute()` **wrapped in `asyncio.to_thread`** (supabase-py is sync — same rule as A6).
- Wired in the dishka container (an `infra` provider group post-`container.py` split, master plan Track 2).

**[BUILD-IN-TREE + gate]** the port + adapter + wrapper migration; pytest asserting the adapter
issues the correct rpc args and awaits `to_thread`; the ephemeral-Postgres CI job applies 0051 and
asserts a row lands in `graphile_worker.jobs`.
**[NEEDS LIVE]** confirm the `sb_secret_…` key maps to `service_role` and that `GRANT EXECUTE …
TO service_role` suffices (scout 02 §6). Verify against live; do not assume.

## A3. What the SNS handler enqueues — and the correctness upgrade

Rewrite `sns_inbound.py:57-64`. Today the whole pipeline runs inline and the handler **returns 200
even on failure** (silent permanent loss). New shape:

```python
if msg_type == "Notification":
    try:
        meta = parse_ses_notification(str(payload["Message"]))
    except Exception:
        logger.exception("sns_parse_error", ...)
        return Response(status_code=status.HTTP_200_OK)   # unparseable envelope: 200, unchanged

    try:
        enqueuer: JobEnqueuer = await request.app.state.dishka_container.get(JobEnqueuer)
        await enqueuer.enqueue(
            "ingest_inbound_email",
            {"ses_message_id": meta["message_id"], "recipients": list(meta["recipients"])},
            job_key=f"ingest:{meta['message_id']}",
        )
    except Exception:
        logger.exception("email_enqueue_error", message_id=meta["message_id"])
        return Response(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)  # <-- KEY CHANGE
    return Response(status_code=status.HTTP_200_OK)
```

**The sharp change: return 5xx if the *enqueue itself* fails, so SNS retries.** Returning 200 on a
failed enqueue would re-create the exact silent-loss bug in miniature. The enqueue is a tiny cheap
insert; a retry storm on it is harmless, and `job_key='ingest:<message_id>'` makes the retried
enqueue idempotent (graphile replaces the pending job in place). Pipeline failures no longer reach
this handler at all — they live on the job row (A5).

**What travels in the payload (scout 01 §5b–5c): a pointer, never the bytes.** `{ses_message_id,
recipients}` are exactly the two args of `IngestInboundEmailUseCase.execute(ses_message_id,
recipients)` (`ingest_inbound_email.py:168`). SES already durably wrote the MIME to S3; the key is
derivable (`raw_email_store.py:21-23`). `recipients` must travel — it anchors the forwarding-token
→ owning-user resolution (`ingest_inbound_email.py:177`). Everything else (`importer_id`,
`thread_id`, attachment/page ids) is re-derived deterministically, and the upsert keys
(`(importer_id, message_id)`, uuid5 attachment ids) make at-least-once delivery safe.

The identical treatment converts `backfill_reprocess.py` from "run 25 pipelines inline under the
ALB timeout" to "enqueue N jobs, return an ack" — the `max_length=25` cap dissolves (scout 01 §4).

**[BUILD-IN-TREE + gate]** the handler rewrite + backfill rewrite; pytest: (a) enqueue called with
the right payload → 200; (b) enqueue raises → 500; (c) parse failure → 200.

## A4. The worker task-handler seam — Node worker → Python pipeline over HTTP

The heavy pipeline stays Python and DI-wired; the Node handler calls back into it. **A new
internal endpoint is required** — no existing route runs `execute()` from a bare
`{ses_message_id, recipients}` (scout 02 §4.3).

**New Python route `POST /v1/emails/ingest-job`** (`presentation/api/v1/ingest_job.py`):
- Guarded by the existing `require_api_key` dependency (`middleware/auth.py:16-27`); `API_KEY` is
  already a task secret (`ecs.tf:82-83`) so the co-located worker can present it.
- Body `{ses_message_id, recipients}`; body → `use_case.execute(ses_message_id, recipients=…)`.
- **Returns 5xx on any pipeline failure** (unlike the SNS handler) so graphile sees the failure and
  retries. Returns 200 on success.
- Long timeout budget — must sit **off the public ALB idle-timeout path**. In the co-located shape
  (A5) the worker calls `localhost:8000`, bypassing the ALB entirely.
- **Watch the fail-open branch** `auth.py:20-22` (empty key + `development` disables auth) — a
  prod misconfig risk, flagged by master-plan Track 4; irrelevant in prod but note it.

**Node worker `apps/worker`** (new npm workspace — the daemon (`apps/daemon`) is the precedent for
a `tsx` Node workspace):
```ts
// apps/worker/src/tasks.ts — the registry the seam is built around
const INTERNAL = process.env.LISTENER_INTERNAL_URL ?? "http://localhost:8000";
async function callPython(path: string, body: unknown, helpers: Helpers) {
  const res = await fetch(`${INTERNAL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.API_KEY! },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`); // throw => graphile retries
}
export const taskList: TaskList = {
  ingest_inbound_email: (payload, helpers) => callPython("/v1/emails/ingest-job", payload, helpers),
  deep_research:        (payload, helpers) => callPython("/v1/research/run-job", payload, helpers), // A7
};
```
`apps/worker/src/index.ts` runs `run({ connectionString, taskList, concurrency, ... })`. The
`taskList` **is** the seam that scales past one task — new durable capabilities add a key here + an
internal route, nothing else.

**[BUILD-IN-TREE + gate]** the `apps/worker` package + the internal route. Gate: an integration
test (ephemeral Postgres + graphile schema installed) enqueues via `enqueue_job`, boots the worker
with `taskList` pointed at a stub HTTP server, and asserts the stub received `{ses_message_id,
recipients}`; a stub returning 500 leaves the job with incremented `attempts`.

## A5. Co-location / Dockerfile — Shape B (two containers, one task) recommended

Master-plan hard constraint (i): co-locate in the existing listener container **or** a scheduled
task — **not** a new always-on Fargate service. Scout 05 §2 gives two Terraform-shaped attach
points; Scout 02 §3 the two process shapes.

For the clean-arch, scale-past-one-task angle I recommend **Shape B: a second container in the
*same* ECS task definition** (`ecs.tf:37-87`, add a second element to `container_definitions`),
`essential = false` (a worker crash doesn't kill the API), running a **separate small Node image**
(`apps/worker`, new `ecr.tf` repo). Rationale:

- The Python image stays Python-only (`python:3.11-slim`) and the Node image stays Node-only —
  clean single-responsibility, no supervisor, no two-runtimes-in-one-image bloat (contrast Shape A
  which bakes Node into the Python image and needs supervisord/honcho — scout 02 §3.2).
- Same task = **one Fargate bill**; satisfies constraint (i) (it is not a new *service*).
- A resident always-on poller is the natural fit for a durable queue and gives near-real-time
  ingestion *and* handles many task identifiers (ingest + deep_research + future) without the
  EventBridge 1-min cron granularity of the scheduled `--once` alternative.
- The uvicorn `HEALTHCHECK` (`ecs.tf:79-85`) stays valid for the API; add a lightweight worker
  liveness later.
- Worker → Python is a `localhost:8000` hop, off the ALB idle-timeout path (A4).

**Fallback: Shape A (Node baked into the Python image + supervisor)** if Pedro prefers the single
image / smaller Terraform diff. **Cheaper alternative: scheduled `graphile-worker --once` via
EventBridge → `RunTask`** — but there is *no* EventBridge/scheduler scaffolding to reuse (scout 05
§3), it is entirely net-new Terraform, and the ephemeral task has no uvicorn so its callback must
cross to the listener service (harder seam). Reject unless sub-minute latency is unacceptable *and*
cost dominates.

**The one load-bearing infra gap (all shapes): the worker needs a direct SESSION-mode Postgres
connection** for `LISTEN/NOTIFY`. The transaction pooler (:6543, `prepare:false`) the web app uses
**does not support LISTEN** (scout 02 §3.4). The Supabase direct host is IPv6-only; Fargate
egresses IPv4. So the worker connection string is a **live-infra decision** (likely the Supavisor
*session* pooler), delivered as a **new ECS secret** — a `terraform apply` on
`ecs.tf`/`iam.tf`/`variables.tf`, **gated behind Track 1** (scout 05 §4).

**[BUILD-IN-TREE + gate]** `apps/worker` Dockerfile + `ecr.tf` repo + the second-container block in
`ecs.tf` (authored, not applied); the image builds in CI.
**[NEEDS LIVE / INFRA / Track 1]** the `terraform apply` adding the container + the
`GRAPHILE_WORKER_CONNECTION_STRING` secret + `secretsmanager:GetSecretValue` in `iam.tf`; and the
[NEEDS LIVE] confirmation of *which* pooler LISTEN-works from this VPC.

## A6. Retries / DLQ

- **Retries + backoff (source, scout 02 §4.1):** on a thrown handler error graphile fails the job
  and reschedules with exponential backoff `exp(least(10, attempt)) * interval '1s'`. Default
  `max_attempts = 25` spans days; **override down to 8** in `enqueue_job` so a genuinely poison
  email dead-letters in hours, not a week.
- **DLQ = a generated column, no separate table (scout 02 §4.2):** `is_available =
  (locked_at IS NULL AND attempts < max_attempts)`. When `attempts = max_attempts` the row flips
  unavailable forever and is never auto-deleted — **that surviving row is the dead-letter record**,
  with `last_error` populated. Successful jobs are deleted.
- **Ops surface (A8):** read/re-drive through the sanctioned `graphile_worker.jobs` view +
  `reschedule_jobs` / `permanently_fail_jobs` / `DELETE_PERMAFAILED_JOBS` admin functions.

## A7. deep_research durability — the second task, driven by the same seam

`deep_research` is a "long money-burning loop" the master plan says to event-source into the worker
(`00-MASTER-PLAN.md:65,173`), and it already emits `ChatRunEvent`s via an optional injected `emit`
port (`deep_research.py:302-320`, `EmitEvent` at `:217-223`). This is the seam that proves the
runtime is a general capability driver, not an ingestion special-case.

- **The interactive chat turn stays in-process** (`run_chat_turn.py`) — durability's serialization
  cost would hurt the sub-5-min turn (`00-MASTER-PLAN.md:173`). Only the *research sub-loop* is
  enqueued.
- When a turn invokes deep research, instead of running `DeepResearch.run(...)` inline it
  **enqueues** `{conversation_id, run_id, question, question_id, importer_id, budget}` under
  identifier `deep_research` (ownership already asserted in the chat turn). A `chat_runs` row is
  created up front (status `started`) so the UI has something to attach to.
- Worker → `POST /v1/research/run-job`; that route resolves `DeepResearch` from DI and calls
  `run(..., emit=append_chat_run_event)` where `emit` **durably appends `chat_run_events` rows**
  (the append-only log, `(run_id, seq)` unique — `chat-run-events.ts:56-62` — a natural idempotent
  ON CONFLICT DO NOTHING target). The trace UI renders it with no new event type (scout 01 §6;
  `deep_research.py` progress-streaming docstring).
- Idempotency: `job_key = f"research:{run_id}"`; the append is keyed on `(run_id, seq)`; a retried
  job re-runs the loop and re-appends — acceptable because the report is recomputed and the event
  log dedupes on seq. (A retried research job re-spends budget; bound `max_attempts` to 2–3 for
  deep_research — money-burning, unlike a cheap ingest.)

**[BUILD-IN-TREE + gate]** the enqueue-instead-of-inline change at the deep-research call site + the
`/v1/research/run-job` route + the `emit`→`chat_run_events` adapter; pytest with a fake
`ChatProvider`/`ToolExecutor` asserting events are appended and `max_attempts` is low.

## A8. DLQ ops surface — web/tRPC over the direct Postgres connection

The `graphile_worker.jobs` view + admin functions live in the non-`public` `graphile_worker`
schema → **not PostgREST-exposed**, so a Python/supabase-py dashboard can't read them (scout 02
§4.2). But the **web app already holds a direct `postgres`-role connection** (`packages/db/src/
client.ts`). Build a small `jobsRouter` in `packages/api-client` (admin-only) that reads
`graphile_worker.jobs WHERE attempts >= max_attempts AND locked_at IS NULL` for the DLQ list and
calls `reschedule_jobs(...)` to re-drive. This is the natural home and needs no second public
wrapper.

**[BUILD-IN-TREE + gate]** the router + a vitest against a fake Drizzle chain; the real read is a
[NEEDS LIVE] verification.

## A9. `to_thread` wrapping plan (the interim + defensive fix)

Even after A4, the pipeline runs inside the `/v1/emails/ingest-job` HTTP handler on the **same
uvicorn event loop** that serves the in-process chat turn. So the master-plan mandate to wrap the
~93 blocking ingest-path `.execute()` calls in `to_thread` still stands — one slow email must not
freeze the loop (scout 01 §3).

- **Mechanism:** supabase-py's `Client` is synchronous; ingest repos call `.execute()` directly on
  the loop inside `async def`. Wrap each at the call site: `await asyncio.to_thread(lambda:
  self._client.table(...).…​.execute())`. The newer chat/genui/cost repos already do this (WR-06,
  e.g. `supabase_chat_message_repository.py:114`) — copy that pattern into the ingest-path repos.
- **Targets (scout 01 §3):** every ingest-path repo `.execute()` (`component_repository.py`,
  `email_repository.py`, `attachment_repository.py`, `entity_instance_repository.py`,
  `knowledge_graph_repository.py`, `entity_type_repository.py`, `thread_repository.py`,
  `importer_repository.py`, `forwarding_address_repository.py`, `entity_type_correction_repository.py`,
  `extraction_repository.py`); `S3RawEmailStore.fetch`'s `get_object` (`raw_email_store.py:27`);
  and `EntityResolutionRepository.find_candidates` (`resolve_ingest_entities.py:190`) which is
  additionally a **sync `def` not even awaited** — wrap and await it.
- **CPU targets:** `parse_mime` (`ingest_inbound_email.py:171`) and `html_to_text` (`:437`) →
  `to_thread`.
- **Leave as-is:** pdfminer/pdf2image/Textract (already `ThreadPoolExecutor`/`run_in_executor`);
  all `AsyncAnthropicBedrock` LLM calls (truly async httpx).
- The new `SupabaseJobEnqueuer` (A2) follows the same rule.

**[BUILD-IN-TREE + gate]** the wrapping; `uv run pytest` stays green; add a focused test asserting
a representative ingest repo awaits `asyncio.to_thread` (monkeypatch `to_thread` and assert called),
plus `uv run lint-imports` unaffected.

---

# PART B — Track 3b: `Workspace → Canvas → Node` rows

## B0. Model decision

Promote the `chat_canvas_layouts` JSONB blob to three first-class tables. Board-level state
(`viewport`, `shared_state`, `node_registry_version`) stays a single row on `canvases`; **nodes and
edges become rows** with real referential integrity. The conversation canvas and the home board
become two `kind`s of `canvas`, retiring the `scope='home'` bolt-on (scout 03 §4, scout 04 §4).

Three deliberate correctness moves the blob cannot make:

1. **Edges FK to nodes with `ON DELETE CASCADE`** — deleting a node auto-detaches its edges,
   replacing the manual `edges.filter(...)` in `canvas-mutations.ts:316-322`.
2. **The agent write path becomes per-row insert/delete** — it no longer round-trips the whole
   board, which **closes the known whole-row LWW race** (`canvas-mutations.ts:31-37`) the blob
   design caused (scout 03 §2.3, §6 invariant 8).
3. **Canonical `type:ref` node ids become a real unique key** (`unique(canvas_id, node_key)`),
   making agent idempotency and client/server id agreement a DB invariant, not a convention
   (scout 03 §6 invariant 11).

Ownership sits on the **direct-`user_id` / owner-container** side (like `workspaces`/`documents`),
not the importer-anchored side (scout 04 §4.1). **Denormalize `owner_user_id` onto `canvases`**
(house-consistent direct anchor, `workspaces.ts:42-44` precedent) **and** carry `workspace_id` for
containment + member-visibility RLS.

## B1. The Drizzle schema (migration `0052_canvas_node_promotion`)

Next sequential prefix is **0052** (journal ends at 0050; 0051 is the 3a enqueue wrapper). New
files: `packages/db/src/schema/canvases.ts`, `canvas-nodes.ts`, `canvas-edges.ts`; barrel-export
them in `schema/index.ts` after `resource-shares` (dependency order). RLS + the partial-unique
predicates + the enum extension are hand-appended in the generated `.sql` (house pattern, scout 04
§5.3).

### `canvases`
```ts
export const Canvases = pgTable("canvases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull()
    .references(() => Workspaces.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").notNull()          // denormalized direct anchor
    .references(() => AuthUsers.id, { onDelete: "cascade" }),
  // A canvas backs exactly one conversation (kind='conversation') OR is a user's
  // home board (kind='home'). conversationId NULL for home boards.
  conversationId: uuid("conversation_id")
    .references(() => ChatConversations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),                          // 'conversation' | 'home'
  name: text("name").notNull().default("Untitled canvas"),
  viewport: jsonb("viewport"),                           // { x, y, zoom } | null
  sharedState: jsonb("shared_state").notNull().default({}),      // panels.*/shared.* bag (+home.panels)
  nodeRegistryVersion: text("node_registry_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  canvasesWorkspaceIdx: index("idx_canvases_workspace_id").on(t.workspaceId),
  canvasesOwnerIdx: index("idx_canvases_owner_user_id").on(t.ownerUserId),
  // one canvas per conversation (partial: home boards carry NULL conversation_id)
  canvasesConversationUx: uniqueIndex("idx_canvases_conversation")
    .on(t.conversationId).where(sql`${t.conversationId} IS NOT NULL`),
  // one home board per user (mirrors chat_canvas_layouts' home partial-unique)
  canvasesHomeUx: uniqueIndex("idx_canvases_home_owner")
    .on(t.ownerUserId).where(sql`${t.kind} = 'home'`),
  // kind ↔ conversationId discriminator (successor to the 0046 scope CHECK)
  canvasesKindDiscriminator: check("canvases_kind_discriminator",
    sql`(${t.kind} = 'conversation' AND ${t.conversationId} IS NOT NULL)
        OR (${t.kind} = 'home' AND ${t.conversationId} IS NULL)`),
}));
```

### `canvas_nodes`
```ts
export const CanvasNodes = pgTable("canvas_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  canvasId: uuid("canvas_id").notNull()
    .references(() => Canvases.id, { onDelete: "cascade" }),
  // The canonical `type:ref` id (chat:<convId>, genui-panel:<msg>:<part>, …) — the
  // idempotency + client/server-agreement key, now a DB unique (scout 03 §6.11).
  nodeKey: text("node_key").notNull(),
  type: text("type").notNull(),                          // one of the 13 registered types (or unknown)
  position: jsonb("position").notNull(),                 // { x, y }
  width: real("width"),
  height: real("height"),
  // node.data verbatim — refs, plus the two content-carrying types (source url/title/
  // excerpt, directory entries preview). NEVER genui spec content (D-05) — enforced
  // at the write boundary by CanvasSnapshotSchema, not the column.
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  canvasNodesCanvasIdx: index("idx_canvas_nodes_canvas_id").on(t.canvasId),
  canvasNodesKeyUx: uniqueIndex("idx_canvas_nodes_canvas_key").on(t.canvasId, t.nodeKey),
}));
```

### `canvas_edges`
```ts
export const CanvasEdges = pgTable("canvas_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  canvasId: uuid("canvas_id").notNull()
    .references(() => Canvases.id, { onDelete: "cascade" }),
  // FK both endpoints → cascade delete replaces manual edge filtering (B0.1)
  sourceNodeId: uuid("source_node_id").notNull()
    .references(() => CanvasNodes.id, { onDelete: "cascade" }),
  targetNodeId: uuid("target_node_id").notNull()
    .references(() => CanvasNodes.id, { onDelete: "cascade" }),
  sourcePath: text("source_path").notNull(),             // dotted-path grammar (guarded at write time)
  targetKey: text("target_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  canvasEdgesCanvasIdx: index("idx_canvas_edges_canvas_id").on(t.canvasId),
  canvasEdgesUx: uniqueIndex("idx_canvas_edges_unique")
    .on(t.canvasId, t.sourceNodeId, t.targetNodeId, t.sourcePath, t.targetKey), // matches connect() dedupe
}));
```

### RLS (hand-appended; mirror `workspaces_member_authenticated`, scout 04 §4.2)
Member-visibility (a canvas must be visible to every member of its workspace), **not** the flat
`documents` owner idiom. `canvas_nodes`/`canvas_edges` use nested `EXISTS` through the parent
canvas — defense-in-depth only (app connects as superuser/service_role and bypasses RLS; the app
boundary is the real wall).
```sql
ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all_canvases_anon" ON "canvases"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "canvases_member_authenticated" ON "canvases"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "workspace_members" m
                 WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM "workspace_members" m
                      WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()));

ALTER TABLE "canvas_nodes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all_canvas_nodes_anon" ON "canvas_nodes"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "canvas_nodes_member_authenticated" ON "canvas_nodes"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "canvases" c JOIN "workspace_members" m
                   ON m.workspace_id = c.workspace_id
                 WHERE c.id = "canvas_nodes".canvas_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM "canvases" c JOIN "workspace_members" m
                   ON m.workspace_id = c.workspace_id
                 WHERE c.id = "canvas_nodes".canvas_id AND m.user_id = auth.uid()));
-- canvas_edges: identical nested-EXISTS via canvas_id.
```

### Sharing (extend the polymorphic machinery, scout 04 §4.3)
```sql
ALTER TYPE "public"."shared_resource_type" ADD VALUE 'canvas';   -- own statement; ADD VALUE can't run in a txn with its use
```
Then add the `canvas` branch to `resolveResourceOwner` (`access-control.ts:158-196`) returning
`Canvases.ownerUserId`, and widen the `SharedResourceType` union type (`access-control.ts:61`). No
churn to `resource_shares` itself — the whole point of the polymorphic table.

**[BUILD-IN-TREE + gate]** schema files + `drizzle-kit generate` + hand-appended RLS/enum; gates:
`db:check` (drizzle-kit check), the Track-2 ephemeral-Postgres migrate-from-scratch job, a vitest
`canvases-schema.test.ts` (mirrors `workspaces-schema.test.ts`), and the Track-2 real-Postgres
tenant-isolation job exercising the new RLS.

## B2. The data migration / backfill (same 0052 file, custom SQL — files only)

Each conversation's canvas migrates into a canvas in an **auto-created "personal" workspace** per
user (research doc §3; scout 04 §4.4). Order inside 0052 after table+RLS creation:

1. **Seed one personal workspace per user that owns a canvas layout**, plus the owner
   `workspace_members` row (workspaces seed the owner as a member — `workspaces.ts:10-16`). Derive
   the owning `user_id`: for conversation rows via `chat_canvas_layouts.conversation_id →
   chat_conversations.user_id`; for home rows the direct `chat_canvas_layouts.user_id`.
2. **Insert `canvases`**: one per `chat_canvas_layouts` row. `kind='conversation'` +
   `conversation_id` for conversation rows; `kind='home'` for home rows. Copy `viewport`,
   `shared_state`, `node_registry_version`; set `owner_user_id`, `workspace_id`.
3. **Explode `nodes` → `canvas_nodes`** via `jsonb_array_elements(nodes)`: `node_key = elem->>'id'`,
   `type = elem->>'type'`, `position = elem->'position'`, `data = elem->'data'`,
   `width/height` from the element. `unique(canvas_id, node_key)` dedupes.
4. **Explode `edges` → `canvas_edges`**, mapping the string `source`/`target` (node_key) to the
   new node `id`s via a join to the just-inserted `canvas_nodes` on `(canvas_id, node_key)`.
   Edges whose endpoints didn't resolve are dropped (a dangling edge in the blob was already dead).

The node_key→id remap in step 4 is the only fiddly part; do it in one CTE keyed on the unique
`(canvas_id, node_key)`. **Preserved verbatim:** unknown node types (stored with original
type/data, heal-on-restore intact), the two content-carrying types (`source`, `directory` — their
inline payload lives in `data`), `shared_state` incl. the home board's `home.panels` key.

**[BUILD-IN-TREE + gate]** the backfill SQL; gate: a vitest/integration test that seeds a
representative `chat_canvas_layouts` fixture (conversation + home + an unknown-type node + a
`source` node + one edge), runs 0052 against ephemeral Postgres, and asserts the assembled snapshot
(B4) round-trips byte-equivalent through `CanvasSnapshotSchema`.
**[NEEDS LIVE / PEDRO]** applying 0052 to staging/prod is a Pedro-run deploy (files-only workflow);
it is a data migration over live canvas rows — stage it, verify counts, keep the blob columns until
B5 phase 3.

## B3. The single write path — a `CanvasRepository` seam in `packages/db`

Mirror the intent of today's `createCanvasMutationStore` ("the binding must stay THE single write
path", `canvas-mutations.ts:232-235`): one repository both tRPC and the agent store call, so there
are never two divergent decompositions.

```ts
// packages/db/src/canvas-repository.ts (Drizzle handle first param — test-injectable, like ownership.ts)
assembleSnapshot(db, canvasId): Promise<CanvasSnapshot>       // nodes+edges rows → the wire snapshot
applySnapshot(db, canvasId, snapshot): Promise<void>          // diff decompose: upsert changed nodes,
                                                              //   delete removed, upsert/delete edges (in a tx)
addNode(db, canvasId, type, data, position?): Promise<{nodeKey; created}>   // per-row, idempotent on node_key
connect(db, canvasId, source, target, sourcePath, targetKey) // per-row, idempotent on the edge unique
removeNode(db, canvasId, nodeKey)                             // delete node; edges cascade
```
- `assembleSnapshot` re-imposes `withDefaultChatNode` semantics server-side is NOT needed — the
  client still synthesizes the default chat node on restore (`use-canvas-persistence.ts:216-232`);
  assemble just returns stored rows. Keep the client heal/reconcile pipeline unchanged.
- `applySnapshot` runs `CanvasSnapshotSchema.parse` FIRST (preserves every write-time security gate
  — D-05 no-spec, prototype-pollution guards, per-type url/vault gates — scout 03 §6.10) then diffs
  against current rows in a transaction. Caps become per-canvas `COUNT` checks
  (`MAX_CANVAS_NODES=200`, `MAX_CANVAS_EDGES=400`; `shared_state` 100k on the canvas row).
- `addNode` is the agent path — one insert, idempotent on `(canvas_id, node_key)` → **the LWW race
  is gone** (no whole-board round-trip).

**[BUILD-IN-TREE + gate]** the repository + vitest with a fake Drizzle chain (the existing
`db: fake as never` idiom) covering assemble/apply-diff/addNode-idempotency/removeNode-cascade.

## B4. tRPC + web-canvas cutover — wire-compatible, staged

**The compatibility principle: keep `CanvasSnapshotSchema` as the wire contract unchanged, so
`apps/web` needs no change to keep working.** Only the *procedure bodies* swap from blob I/O to
`CanvasRepository` calls. All web consumers (`useCanvasPersistence`, `ChatCanvas`,
`TranscriptPanelHost`, `HomeBoard`, `useSendTo` — scout 03 §2.5) keep calling the same procedures.

Cut the procedures over to resolve a **canvasId from the conversationId/home key** (a canvas now
exists per conversation post-backfill; auto-create on first save if missing), then:
- `getCanvasLayout(conversationId)` → resolve canvasId → `assembleSnapshot` → return the same
  `{nodes, edges, viewport, sharedState, nodeRegistryVersion}` shape the row returned before.
- `saveCanvasLayout(conversationId, snapshot)` → resolve/create canvasId → `applySnapshot` (diff).
- `getHomeCanvasLayout` / `saveHomeCanvasLayout` → same, keyed on `(ownerUserId, kind='home')`.
- `addCanvasNode` / `connectCanvasNodes` / `removeCanvasNode` → `CanvasRepository.addNode/connect/
  removeNode` (per-row). Ownership assert stays first (`assertConversationOwnership`, or the new
  `assertCanvasOwnership`).

**Staged cutover to de-risk the live data move:**
- **Phase 1 (in-tree):** add tables + backfill + `CanvasRepository`; **shadow-write** —
  `saveCanvasLayout`/`addCanvasNode` write BOTH the blob (unchanged) AND the rows. Reads still come
  from the blob. Zero user-visible change; rows accumulate in parallel for verification.
- **Phase 2 (in-tree, after backfill applied + verified live):** flip **reads** to
  `assembleSnapshot`; keep shadow-writing the blob as a rollback safety net.
- **Phase 3 (later migration `0053`):** drop `chat_canvas_layouts.nodes/edges/viewport/
  shared_state/node_registry_version` (or the whole table) once rows are the sole source of truth.

**Preserved invariants (scout 03 §6):** the 13 node types + `unknown-node-type` degrade (data
stored verbatim → heal-on-restore works); the `source`/`directory` content-carrying payloads; the
canonical id scheme (now a DB unique); the additive-never-clobber discipline (now structural, not
convention); the per-type write gates (re-run in `applySnapshot`); the caps. The **home board**
model improves: it stops overloading a `scope` column and becomes a `kind='home'` canvas whose
`home.panels` lives in `shared_state` exactly as today (`home-board.tsx:80-96`).

**Ownership helper:** add `assertCanvasOwnership(db, canvasId, userId)` to `ownership.ts` (owner via
`Canvases.ownerUserId`, mirroring `assertDocumentOwnership`), and once `'canvas'` is in the enum
(B1) route shareable reads through `assertCanAccess(db, userId, "canvas", canvasId, need)`.

**[BUILD-IN-TREE + gate]** the procedure rewrites + shadow-write; gates: existing
`__tests__/canvas.test.ts` (unchanged wire contract must still pass) + new assemble/decompose
tests; and — because jsdom proves nothing visual (CLAUDE.md) — the **real-browser gates**:
`npm run test:geometry` and `npm run screenshot:review` against an already-running server on 3000,
to confirm the canvas still renders identically post-cutover.

---

# PART C — step-ordered build sequence

Ordering respects: 3a and 3b are independent (parallelizable); within each, seams precede
consumers; every live/infra apply is Track-1-gated and Pedro-run.

**Track 3a**
1. **Job seam port + adapter** (`JobEnqueuer` + `SupabaseJobEnqueuer`, `to_thread`-wrapped) + DI
   wiring. **[BUILD-IN-TREE + gate: pytest adapter args + to_thread]**
2. **`0051_graphile_enqueue_wrapper.sql`** (generic `enqueue_job`, SECURITY DEFINER, GRANT to
   service_role) + `apps/worker/src/install-schema.ts`. **[BUILD-IN-TREE + gate: ephemeral-PG job
   installs graphile schema, applies 0051, asserts enqueue → `graphile_worker.jobs` row]**
3. **SNS handler rewrite** (enqueue; **500 on enqueue failure**) + `backfill_reprocess` → enqueue-N.
   **[BUILD-IN-TREE + gate: pytest 200/500/parse-fail cases]**
4. **Internal `POST /v1/emails/ingest-job`** (`require_api_key`, 5xx on pipeline failure, long
   timeout). **[BUILD-IN-TREE + gate: pytest execute() + 5xx-on-failure]**
5. **`apps/worker`** Node package (`taskList={ingest_inbound_email, deep_research}`, throw→retry).
   **[BUILD-IN-TREE + gate: integration — enqueue → worker → stub HTTP receives payload; 500 →
   attempts++]**
6. **`to_thread` wrap** the ~93 ingest-path `.execute()` + S3 fetch + `parse_mime` + `html_to_text`
   + `find_candidates`. **[BUILD-IN-TREE + gate: `uv run pytest` green + to_thread assertion test]**
7. **deep_research durability** — enqueue instead of inline at the chat-turn call site (turn stays
   in-process); `POST /v1/research/run-job` with `emit`→`chat_run_events`; low `max_attempts`.
   **[BUILD-IN-TREE + gate: pytest fake provider asserts events appended + budget-capped retries]**
8. **DLQ ops** — admin `jobsRouter` reading `graphile_worker.jobs` over the direct PG connection.
   **[BUILD-IN-TREE + gate: vitest fake chain]**
9. **Dockerfile/`apps/worker` image + `ecr.tf` + second-container block in `ecs.tf` + worker
   session-mode secret.** Authored in tree; image builds in CI.
   **[NEEDS LIVE / INFRA / Track 1: `terraform apply`; NEEDS LIVE: which Supavisor pooler LISTEN-works
   from Fargate IPv4; confirm `sb_secret` role = service_role + GRANT suffices]**
10. **Apply 0051 + `--schema-only` install to staging→prod.** **[NEEDS PEDRO: files-only deploy]**

**Track 3b** (parallel to 3a)
11. **Schema** `canvases`/`canvas_nodes`/`canvas_edges` + barrel export + `generate`. **[BUILD-IN-TREE
    + gate: `db:check` + `canvases-schema.test.ts`]**
12. **`0052` hand-append** — RLS (member-visibility, nested-EXISTS), partial-uniques, `kind` CHECK,
    `ALTER TYPE … ADD VALUE 'canvas'`. **[BUILD-IN-TREE + gate: ephemeral-PG migrate-from-scratch +
    real-PG tenant-isolation job]**
13. **`0052` backfill** — personal workspace per user → canvases → explode nodes/edges (node_key→id
    remap). **[BUILD-IN-TREE + gate: seed-fixture → migrate → assembled snapshot round-trips
    `CanvasSnapshotSchema`]**
14. **`CanvasRepository`** (assemble/applySnapshot-diff/addNode/connect/removeNode) + access helpers
    (`assertCanvasOwnership`, `resolveResourceOwner` canvas branch). **[BUILD-IN-TREE + gate: vitest
    fake chain — assemble, diff, idempotency, cascade]**
15. **tRPC cutover Phase 1 (shadow-write)** — procedures write blob + rows, read blob. **[BUILD-IN-TREE
    + gate: `canvas.test.ts` unchanged + new decompose tests]**
16. **Apply 0052 to staging→prod; verify row counts vs blob.** **[NEEDS PEDRO: files-only deploy,
    data migration — stage + verify]**
17. **tRPC cutover Phase 2** — flip reads to `assembleSnapshot`; keep shadow-write.
    **[BUILD-IN-TREE + gate: `test:geometry` + `screenshot:review` on a running server — canvas
    renders identically]**
18. **`0053` drop the blob columns** once rows are sole source of truth. **[BUILD-IN-TREE authoring;
    NEEDS PEDRO to apply]**

---

## Open decisions for Pedro
- **Co-location shape:** Shape B (two containers/one task, recommended) vs Shape A (Node-in-Python-
  image + supervisor) vs scheduled `--once` (cheapest, net-new EventBridge). All Track-1-gated for
  the DB secret. (Master-plan Decision 5.)
- **Worker connection:** which Supabase session-mode pooler LISTEN-works from the Fargate VPC
  (IPv4). A live fact, not a code choice.
- **Canvas sharing now or later:** ship the `'canvas'` enum + owner resolver in 0052 (cheap,
  additive) so canvases are shareable when Track 5/7 wants it, even if no UI drives it yet.
- **`deep_research` retry budget:** confirm `max_attempts=2–3` — each retry re-spends the research
  token budget.
