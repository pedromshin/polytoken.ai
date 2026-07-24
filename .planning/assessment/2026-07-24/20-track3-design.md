# Track 3 — Canonical Implementation Design (decision-resolved)

> Synthesis of Design A (minimal blast radius) + Design B (clean architecture) + scout docs 01–05.
> This is THE design of record for Track 3: **3a graphile-worker durable runtime** and
> **3b `Workspace → Canvas → Node` rows**. Where A and B conflict, one is chosen with a stated
> reason. Every step is tagged **PART A (build in this container)** or **PART B (live/infra/Pedro)**.
>
> Sourcing convention: `file:line` for code, `NN-doc §x` for scout docs. Verified against the tree
> 2026-07-24: journal ends at `0050` → next files are `0051` (3a) / `0052` (3b) / `0053` (blob drop);
> Python DI is `app/composition/*_providers.py` + `app/container.py`; ports are `app/domain/ports/`;
> `apps/daemon` is the npm-workspace precedent; root `workspaces:["packages/*","apps/web","apps/daemon"]`.

---

## 0. Resolved decisions (the whole design in one table)

| # | Decision | Resolution | Chosen from / why |
|---|----------|-----------|-------------------|
| **D1** | graphile schema install | **Hybrid.** Library owns the volatile `graphile_worker` schema via a one-shot `runMigrations()` (`apps/worker/src/install-schema.ts`) run as `postgres` over `POSTGRES_URL_NON_POOLING`, sequenced **before** the wrapper migration. Vendor **only** the stable `public.enqueue_job` wrapper into `packages/db` (`0051`). Never vendor graphile internals. | A≡B (both agree; 02-doc §2.4). Internal schema is "not a public interface" and renames across minors. |
| **D2** | Enqueue mechanism | **B's generic seam.** One `public.enqueue_job(p_identifier text, p_payload jsonb, p_max_attempts int DEFAULT 8, p_job_key text DEFAULT NULL)` SECURITY DEFINER wrapper with an **identifier allowlist**, `GRANT EXECUTE … TO service_role`. Python calls it behind a domain **port** `JobEnqueuer` + `SupabaseJobEnqueuer` adapter (`.rpc(...).execute()` wrapped in `to_thread`). | **B over A.** Master plan §65/§173 mandates event-sourcing *ingestion + deep_research* — the seam must be many-task from day one. A's per-task `enqueue_ingest_job` would need a new wrapper per capability. `job_key` gives idempotent enqueue (A lacks it). The port keeps SNS/backfill/chat-turn enqueuing through one clean-arch seam. |
| **D3** | What SNS enqueues | `{ses_message_id, recipients}` — a **pointer, not the bytes** — with `job_key=f"ingest:{message_id}"`. Exactly the two args of `execute(ses_message_id, recipients)`. | A≡B (01-doc §5b–5d). SES already durably wrote MIME to S3; key derivable; idempotent upsert makes at-least-once safe. |
| **D4** | Worker → Python seam | Node worker's generic `taskList` (keyed by identifier) POSTs `{payload}` to a **new internal** Python route (`POST /v1/emails/ingest-job`, later `/v1/research/run-job`), guarded by existing `require_api_key`, **returns 5xx on pipeline failure → worker throws → graphile retries**. Called over `localhost:8000` (same task, awsvpc), off the ALB idle-timeout path. No Node reimplementation of the pipeline. | A≡B (02-doc §4.3–4.4). B's identifier-keyed `taskList` (not one handler) is the part that scales past one task. |
| **D5** | Co-location shape | **Shape B: two containers in ONE ECS task, worker `essential=false`, sharing ONE image (Node multi-stage-COPY'd into the existing Python image) run via a command override.** Reject a **separate** Node ECR image (B's `ecr.tf`), supervisord-in-one-container (A's rejected Shape A), and scheduled `--once` EventBridge. | **Hybrid: A's image packaging + B's two-container isolation.** `essential=false` on a separate container means a worker crash can't kill the SNS receiver (protects mail) — better than supervisord. Sharing one image (vs B's new ECR repo) keeps the **Track-1-gated Terraform diff minimal** (one container block + one secret, no new repo/CI pipeline). localhost re-entry works because awsvpc containers share the netns. Scheduled `--once` is net-new Terraform with no pattern to copy (05-doc §3) and a harder re-entry seam. |
| **D6** | Retries / DLQ | `max_attempts=8` for ingest (wrapper default), **2–3 for deep_research** (re-spends budget). "DLQ" = permafailed rows surviving in `graphile_worker._private_jobs`, read via the sanctioned `graphile_worker.jobs` **view**. Ops surface (list/reschedule/purge) built in **web/tRPC over the direct `postgres` connection** (`packages/db/src/client.ts`), not through Python (PostgREST won't expose the `graphile_worker` schema). | A≡B (02-doc §4.1–4.2). |
| **D7** | `to_thread` wrapping | Ship **first and independently** (pure app code, zero infra). Wrap the ~93 ingest-path `.execute()` + `S3RawEmailStore.fetch`'s `get_object` + `parse_mime` + `html_to_text` + `EntityResolutionRepository.find_candidates` (also add the missing `await`). `SupabaseJobEnqueuer` follows the same rule. | A≡B (01-doc §3). Protects the in-process chat turn on the shared uvicorn loop today, and the internal endpoint runs the pipeline on that same loop after 3a. |
| **D8** | 3a cutover gating | Env flag `INGEST_ENQUEUE_ENABLED` (default **false**); flag-off == today's inline path unchanged. A failed enqueue returns **500** (SNS retries) — strictly safer than today's silent 200-loss. Keep 200 only for genuinely unprocessable input (bad JSON / unparseable SES envelope). | A≡B. Reversible without redeploy. |
| **D9** | Canvas/Node schema | **Additive** `canvases`/`canvas_nodes`/`canvas_edges` (`0052`), never touching `chat_canvas_layouts`. Node identity = canonical `type:ref` **`node_key`**, `unique(canvas_id, node_key)` (a DB invariant — B). Edges reference node **keys as TEXT (`source_key`/`target_key`), NOT hard FKs** (A) — required so lazily-materialized genui-panel nodes, the client-synthesized default chat node, and healed unknown-type nodes don't fail an FK. Cascade-delete-of-edges achieved at the app layer (transactional cleanup in `CanvasRepository.removeNode`). RLS: `canvases` mirrors 0047 `workspaces_member_authenticated`; `canvas_nodes`/`canvas_edges` use **nested-EXISTS through the parent canvas** (no denormalized `workspace_id`). **Defer** the `'canvas'` share-enum. | **A's text-key edges over B's FK+cascade** — B's hard FK+`ON DELETE CASCADE` would reject valid edges to not-yet-persisted nodes and break heal-on-restore (03-doc §3.3, §6.3). **B's `node_key` DB-unique + per-row write path** adopted (closes the LWW race structurally). **B's nested-EXISTS RLS over A's denormalized `workspace_id`** — RLS is defense-in-depth only (superuser/service_role bypass), so the flat-policy speed doesn't matter and the denormalized column can drift. |
| **D10** | 3b cutover strategy | Env flag `CANVAS_ROW_MODEL` (`off`|`dual_write`|`read_rows`), reversible without redeploy. `dual_write`: blob authoritative + best-effort row write; `read_rows`: rows authoritative, still dual-write. **Blob never dropped, only demoted.** Backfill is a **separate idempotent script** (`packages/db`), NOT DDL inside `0052`, so schema creation is decoupled from the live data copy and the copy is re-runnable/verifiable. `read_rows` flip gated by the **real-browser** gates (`test:geometry` + `screenshot:review`). | **A's env-flag + separate-backfill over B's code-phase + in-migration backfill.** A is more operable/reversible; a pure-DDL `0052` applies cleanly in Track-2 ephemeral-PG CI with no data dependency. B's `CanvasRepository` single-write-path seam adopted underneath the flag. |

**Invariants both halves must not regress** (03-doc §6): the 13 node types + `unknown-node-type` heal path; the two content-carrying types (`source` url/title/excerpt, `directory` entries preview) migrate inline payload; `viewport`; `sharedState` (incl. the home board's `home.panels` key) with its 100k cap; `nodeRegistryVersion` (incl. `agent-canvas-mutation:v1`, `home-v1`); per-type write-time security gates (http(s)-only, safe vault segments, D-05 no-spec, prototype-pollution); caps (`MAX_CANVAS_NODES=200`, `MAX_CANVAS_EDGES=400`). **The interactive chat turn stays in-process** (master plan §65/§173) — only ingestion + the deep_research sub-loop are enqueued.

---

# PART A — BUILD NOW IN THIS CONTAINER

Everything here is code/migration **files**, mergeable now, each proven by a named gate that runs in a
checkout: `tsc` / `vitest` / `next build` (web+db+api-client), `uv run pytest|mypy|ruff|lint-imports`
(listener), `docker build` (image). **Migrations are files only — nobody applies them here.** 3a and 3b
are independent and parallelizable.

## Track 3a — durable runtime

### A1 — `to_thread`-wrap the ingest path *(independent, ship first)*
Pure app code; protects the shared uvicorn loop today and after 3a. Wrap at each call site (copy the
WR-06 precedent `supabase_chat_message_repository.py:114`):
- Every ingest-path repo `.execute()` (01-doc §3 table): `component_repository.py`, `email_repository.py`,
  `attachment_repository.py`, `entity_instance_repository.py`, `knowledge_graph_repository.py`,
  `entity_type_repository.py`, `entity_type_correction_repository.py`, `extraction_repository.py`,
  `forwarding_address_repository.py`, `importer_repository.py`, `thread_repository.py`.
- `S3RawEmailStore.fetch` sync `get_object` (`raw_email_store.py:27`).
- CPU: `parse_mime` (`ingest_inbound_email.py:171`), `html_to_text` (`:437`).
- **Worst offender:** `EntityResolutionRepository.find_candidates` (`entity_resolution_repository.py:122`,
  called `resolve_ingest_entities.py:190`) — sync `def`, not awaited → wrap in `await asyncio.to_thread(...)`.
- Leave alone: pdfminer/pdf2image/Textract (already `ThreadPoolExecutor`/`run_in_executor`); all
  `AsyncAnthropicBedrock` calls.

**Files:** the ~11 ingest-path repos under `apps/email-listener/app/infrastructure/supabase/`,
`.../s3/raw_email_store.py`, `.../use_cases/ingest_inbound_email.py`, `.../use_cases/resolve_ingest_entities.py`.
**Gate:** `uv run pytest` (unchanged behavior) + a new test running a synthetic slow `.execute()` and
asserting a concurrent loop tick is not starved + `uv run mypy app` + `uv run lint-imports`.

### A2 — `JobEnqueuer` port + `SupabaseJobEnqueuer` adapter + DI wiring
Clean-arch seam so SNS/backfill/chat-turn all enqueue through one place, not raw `.rpc()`.
- **Port** `app/domain/ports/job_enqueuer.py`:
  `class JobEnqueuer(Protocol): async def enqueue(self, identifier: str, payload: Mapping[str, object], *, max_attempts: int = 8, job_key: str | None = None) -> int`.
- **Adapter** `app/infrastructure/jobs/supabase_job_enqueuer.py` — reuses `get_supabase_client()` (already
  cached, `client.py:35`), calls `client.rpc("enqueue_job", {...}).execute()` **wrapped in `asyncio.to_thread`**
  (supabase-py is sync). Zero new deps, zero new connection, zero new secret on the Python side (02-doc §1.2–1.3).
- **Wire** into DI in `app/composition/repository_providers.py` (or a small new `job_providers.py`), registered
  on the container (`app/container.py`).

**Gate:** `uv run pytest` asserting the adapter issues `rpc("enqueue_job", {p_identifier, p_payload, p_max_attempts, p_job_key})`
with the right args and awaits `to_thread` (monkeypatch) + `lint-imports` (domain/application/infrastructure
boundary) + `mypy app`.

### A3 — `0051_graphile_enqueue_wrapper.sql` + `apps/worker/src/install-schema.ts`
The wrapper (custom SQL, files-only), one generic seam:
```sql
-- Requires the graphile_worker schema to already exist (install-schema.ts runs first).
-- Deviation from repo RPC convention (0009/0017 are SECURITY INVOKER so RLS applies):
-- add_job REQUIRES owner privileges, so this is SECURITY DEFINER. Internal enqueue seam,
-- called only by service_role (which already bypasses RLS); callers authorize BEFORE enqueue.
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_identifier   text,
  p_payload      jsonb,
  p_max_attempts integer DEFAULT 8,
  p_job_key      text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, graphile_worker
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_identifier NOT IN ('ingest_inbound_email', 'deep_research') THEN   -- allowlist; extend per task
    RAISE EXCEPTION 'enqueue_job: unknown identifier %', p_identifier;
  END IF;
  SELECT (graphile_worker.add_job(
    p_identifier, p_payload::json, max_attempts := p_max_attempts, job_key := p_job_key
  )).id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, integer, text) TO service_role;
```
The wrapper migration must `RAISE` loudly if the `graphile_worker` schema is absent (ordering guard).
`install-schema.ts` calls `runMigrations({ connectionString: process.env.POSTGRES_URL_NON_POOLING })` —
the exact role/URL `packages/db/src/migrate.ts` uses — decoupled from the always-on worker (no first-boot race).

**Files:** `packages/db/migrations/0051_graphile_enqueue_wrapper.sql` (+ auto `_journal.json`/snapshot via
`migration:generate:custom --name=graphile_enqueue_wrapper`), `apps/worker/src/install-schema.ts`.
**Gate:** Track-2 ephemeral-Postgres CI job runs `install-schema` then applies `0051`, then asserts an
`enqueue_job('ingest_inbound_email', …)` call lands a row in `graphile_worker.jobs`.

### A4 — `sns_inbound.py` flagged enqueue (+ `backfill_reprocess.py` → enqueue-N)
Replace the inline `use_case.execute(...)` (`sns_inbound.py:57-64`) with a flag-gated enqueue through
`JobEnqueuer`; **500 on enqueue failure**, 200 on unparseable envelope:
```python
if settings.INGEST_ENQUEUE_ENABLED:
    try:
        enqueuer = await request.app.state.dishka_container.get(JobEnqueuer)
        await enqueuer.enqueue(
            "ingest_inbound_email",
            {"ses_message_id": meta["message_id"], "recipients": list(meta["recipients"])},
            job_key=f"ingest:{meta['message_id']}",   # idempotent enqueue; retried SNS replaces pending job
        )
    except Exception:
        logger.exception("email_enqueue_error", message_id=meta["message_id"])
        return Response(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)  # SNS retries (not silent loss)
    return Response(status_code=status.HTTP_200_OK)
# else: fall through to today's inline path (flag OFF == current behavior)
```
`backfill_reprocess.py` (`:33, :68-88`): the 25-cap is an ALB-idle dodge (01-doc §4); when the flag is on,
enqueue N jobs (identifier `ingest_inbound_email`, one per `email_id`) and return an ack immediately —
ownership/authorization checks stay at enqueue time.

**Files:** `apps/email-listener/app/presentation/api/v1/sns_inbound.py`, `.../backfill_reprocess.py`,
`app/settings.py` (`INGEST_ENQUEUE_ENABLED`, default `False`).
**Gate:** `uv run pytest test_sns_inbound_enqueue.py` — (a) flag-on calls `enqueue` once + returns 200,
(b) enqueue raises → 500, (c) parse failure → 200, (d) flag-off preserves the inline path.

### A5 — new internal `POST /v1/emails/ingest-job` route
The worker's re-entry target — no existing route runs `execute()` from a bare `{ses_message_id, recipients}`
(02-doc §4.3). Essentially the `sns_inbound` try-block lifted into an authenticated route that **returns 5xx
on failure** so graphile sees it:
```python
# app/presentation/api/v1/ingest_job.py (NEW)
router = APIRouter(prefix="/v1/emails", tags=["emails-internal"],
                   dependencies=[Depends(require_api_key)])   # API_KEY already a container secret (ecs.tf:82-83)

@router.post("/ingest-job", status_code=200)
@inject
async def run_ingest_job(payload: IngestJobIn, use_case: FromDishka[IngestInboundEmailUseCase]) -> ApiResponse[dict]:
    # NO bare-except-200 here: let it raise → FastAPI 500 → worker throws → graphile retries.
    email = await use_case.execute(payload.ses_message_id, recipients=tuple(payload.recipients))
    return ApiResponse.ok({"email_id": str(email.id), "parse_status": email.parse_status})
```
Register in `app/main.py` (mirrors `sns_inbound_router` at `:30,69`). Long timeout budget; called over
`localhost` in-task so it bypasses the ALB idle timeout. Idempotency (`(importer_id, message_id)` upsert +
uuid5 attachment ids) makes at-least-once retries safe. (Note the `auth.py:20-22` dev fail-open — prod-irrelevant,
Track 4 hardens it.)

**Files:** `app/presentation/api/v1/ingest_job.py`, `app/main.py`.
**Gate:** `uv run pytest` asserting 200 on success and **5xx when `execute` raises** (the property graphile
depends on) + `lint-imports` + `mypy app`.

### A6 — `apps/worker` Node package (generic `taskList`)
New npm workspace (precedent: `apps/daemon`). The `taskList` **is** the seam that scales past one task.
```ts
// apps/worker/src/tasks.ts
const INTERNAL = process.env.LISTENER_INTERNAL_URL ?? "http://localhost:8000";
async function callPython(path: string, body: unknown) {
  const res = await fetch(`${INTERNAL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.API_KEY! },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => "")}`); // throw ⇒ retry
}
export const taskList: TaskList = {
  ingest_inbound_email: (p) => callPython("/v1/emails/ingest-job", p),
  deep_research:        (p) => callPython("/v1/research/run-job", p),   // A9
};
// apps/worker/src/index.ts → run({ connectionString, taskList, concurrency: 3, noHandleSignals: false })
```
`package.json` pins `graphile-worker` + `pg` at explicit versions. Add `apps/worker` to root
`workspaces` array. Honest framing (02-doc §4.4): graphile supplies a durable queue + retry + permanent
dead-letter **around** the unchanged Python pipeline; the job row is the durable record; it does not move
compute out of Python.

**Files:** `apps/worker/{package.json,tsconfig.json,src/index.ts,src/tasks.ts,src/install-schema.ts}`,
root `package.json` (`workspaces`).
**Gate:** `tsc --noEmit` + `node --check`/build + vitest integration — enqueue via `enqueue_job` (ephemeral
PG + graphile schema installed), boot the worker with `taskList` pointed at a stub HTTP server, assert the
stub received the payload; a stub returning 500 leaves the job with incremented `attempts`.

### A7 — Dockerfile multi-stage (Node baked into the shared image)
The listener image is Python-only (`Dockerfile:2,12,52`). Add a Node stage and bring the built `apps/worker`
into the runtime stage; the API container's `CMD` (uvicorn) is **unchanged** — the worker container overrides
`command` to run the worker (Part B, `ecs.tf`), sharing this one image.
```dockerfile
FROM node:20-slim AS node_worker
WORKDIR /worker
COPY apps/worker/package*.json ./
RUN npm ci --omit=dev
COPY apps/worker/ ./
RUN npm run build           # tsc → dist/

# in the python:3.11-slim runtime stage:
COPY --from=node:20-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node_worker  /worker /worker
# CMD unchanged (uvicorn). Worker container command override = ["node","/worker/dist/index.js"].
```
Ships via the existing CI (`deploy-email-listener.yml` build→push `:latest`→`update-service`), **no Terraform**
— image contents aren't TF-managed (05-doc §1,§5).

**Files:** `apps/email-listener/Dockerfile`.
**Gate:** `docker build -f apps/email-listener/Dockerfile .` succeeds locally and the image runs `node`
(`docker run … node --version`).

### A8 — web/tRPC `graphileJobs` DLQ ops router
The `graphile_worker.jobs` view lives in a non-`public` schema → not PostgREST-reachable; but the web app
already holds a direct `postgres` connection (`packages/db/src/client.ts`). Build an **admin-only** router:
list permafailed (`SELECT … FROM graphile_worker.jobs WHERE attempts >= max_attempts AND locked_at IS NULL`),
re-drive (`reschedule_jobs`), purge (`DELETE_PERMAFAILED_JOBS`).

**Files:** `packages/api-client/src/router/…/graphile-jobs.ts` (+ register in `root.ts`).
**Gate:** `packages/api-client` vitest (fake Drizzle chain) + an ephemeral-PG unit test with the graphile
schema installed.

### A9 — deep_research durability *(second task, proves the generic seam)*
The interactive turn stays in-process; only the research sub-loop is enqueued (01-doc §6, master plan §65/§173).
At the deep-research call site, instead of `DeepResearch.run(...)` inline, **enqueue**
`{conversation_id, run_id, question, question_id, importer_id, budget}` under identifier `deep_research`
(ownership already asserted in the chat turn), `job_key=f"research:{run_id}"`, `max_attempts=2–3` (re-spends
budget). Create the `chat_runs` row up front (status `started`) so the UI can attach. New route
`POST /v1/research/run-job` resolves `DeepResearch` from DI and calls `run(..., emit=append_chat_run_event)`
where `emit` durably appends `chat_run_events` rows (append-only, `(run_id, seq)` unique →
`ON CONFLICT DO NOTHING`). No new event type — the trace UI renders it as-is.

**Files:** the deep-research call site under `app/application/use_cases/…`, `app/presentation/api/v1/research_job.py`,
an `emit`→`chat_run_events` adapter, `app/main.py`.
**Gate:** `uv run pytest` with a fake `ChatProvider`/`ToolExecutor` asserting events are appended and
`max_attempts` is low + `lint-imports` + `mypy`.

**3a in-tree order:** A1 (independent) → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9. A1–A9 all land green with the
worker inert (flag OFF); nothing runs the queue until Part B.

## Track 3b — Workspace → Canvas → Node rows *(parallel to 3a)*

### B1 — 3 Drizzle tables + `0052` + `assertCanvasOwnership`
New files `packages/db/src/schema/{canvases,canvas-nodes,canvas-edges}.ts`, barrel-exported from
`schema/index.ts` after `resource-shares`. **Additive — `0052` does not touch `chat_canvas_layouts`.**

`canvases` (a conversation canvas and a home board are two `kind`s — retires the `scope='home'` bolt-on):
`id` PK; `workspace_id → workspaces(id) CASCADE`; `owner_user_id → auth.users(id) CASCADE` (denormalized
direct anchor, house style); `conversation_id → chat_conversations(id) CASCADE` (nullable — home has none);
`kind text` (`'conversation'|'home'`); `name`; `viewport jsonb`; `shared_state jsonb NOT NULL default '{}'`
(carries `home.panels`); `node_registry_version text`; `created_at`/`updated_at`. Constraints:
`unique(conversation_id) WHERE conversation_id IS NOT NULL`; `unique(owner_user_id) WHERE kind='home'`
(one home board/user, mirrors `chat_canvas_layouts:117-121`); CHECK
`(kind='conversation' AND conversation_id IS NOT NULL) OR (kind='home' AND conversation_id IS NULL)`
(successor to the 0046 discriminator); index on `workspace_id`, `owner_user_id`.

`canvas_nodes`: `id` PK; `canvas_id → canvases(id) CASCADE`; **`node_key text`** (canonical `type:ref` —
`chat:<convId>`, `genui-panel:<msg>:<part>`, `source:<ledgerId>`, …); `type text` (one of 13 or
`unknown-node-type`); `position jsonb`; `width real`/`height real` (optional); `data jsonb NOT NULL default '{}'`
(ref-only for 11 types; `source`/`directory` carry inline payload; **never** genui spec — enforced at the write
boundary by `CanvasSnapshotSchema`, not the column). `unique(canvas_id, node_key)` (idempotency as a DB
invariant); index on `canvas_id`.

`canvas_edges`: `id` PK; `canvas_id → canvases(id) CASCADE`; `edge_key text`; **`source_key text`** /
**`target_key text`** (= node keys, **NOT FKs** — lets restore reference lazily-materialized/healed nodes);
`data jsonb` (`{sourcePath, targetKey}`); `created_at`. `unique(canvas_id, edge_key)`; index on `canvas_id`.

RLS (hand-appended in `0052`, defense-in-depth only — app connects as superuser/service_role):
`canvases` mirrors 0047 `workspaces_member_authenticated` —
`USING (owner_user_id = auth.uid() OR EXISTS member) WITH CHECK (owner_user_id = auth.uid())` + RESTRICTIVE
`deny_all_…_anon`. `canvas_nodes`/`canvas_edges` — nested `EXISTS (canvases JOIN workspace_members …)` via
`canvas_id`, + anon-deny.

`assertCanvasOwnership(db, canvasId, userId)` added to `ownership.ts` (mirrors `assertDocumentOwnership:229-244`,
resolves via `Canvases.ownerUserId`). Descendant node/edge scoping resolves the ancestor canvas first.

**Deferred (documented one-liner for Track 5/7, not built now):** canvas sharing = add `'canvas'` to
`sharedResourceTypeEnum` (its own `ALTER TYPE … ADD VALUE` statement, a txn hazard) + a `canvas` branch in
`resolveResourceOwner` (`access-control.ts:158-196`). Kept out of `0052` to keep the promotion migration a
clean DDL apply with zero current consumer.

**Files:** the 3 schema files, `schema/index.ts`, `packages/db/migrations/0052_canvas_node_promotion.sql`
(generated DDL + hand-appended RLS/partial-uniques/CHECK; `_journal.json`/snapshot auto-written), `ownership.ts`.
**Gate:** `npm run db:generate` clean diff + Track-2 ephemeral-Postgres apply-from-scratch + Track-2
real-Postgres tenant-isolation job exercising the new RLS + `canvases-schema.test.ts` (mirrors
`workspaces-schema.test.ts`).

### B2 — `CanvasRepository` (the single row write path) in `packages/db`
Drizzle-handle-first (test-injectable, like `ownership.ts`). One repository both tRPC and the agent path call
→ no two divergent decompositions:
- `assembleSnapshot(db, canvasId)` → nodes+edges rows → a `CanvasSnapshotSchema`-shaped object (client still
  synthesizes the default chat node on restore — `use-canvas-persistence.ts:216-232` — so assemble just returns
  stored rows).
- `applySnapshot(db, canvasId, snapshot)` → **`CanvasSnapshotSchema.parse` FIRST** (preserves every write-time
  gate — D-05 no-spec, prototype-pollution, per-type url/vault gates), then diff against current rows in a
  transaction (upsert changed nodes, delete removed, upsert/delete edges). Caps become per-canvas `COUNT`
  checks (`MAX_CANVAS_NODES=200`, `MAX_CANVAS_EDGES=400`; `shared_state` 100k on the canvas row).
- `addNode(db, canvasId, type, data, position?)` → one insert, idempotent on `(canvas_id, node_key)` — **the
  agent path; closes the whole-row LWW race** (`canvas-mutations.ts:31-37`).
- `connect(db, canvasId, source, target, sourcePath, targetKey)` → per-row, idempotent on `(canvas_id, edge_key)`.
- `removeNode(db, canvasId, nodeKey)` → delete node **and** its edges in one transaction (app-layer equivalent
  of B's rejected FK cascade — `DELETE canvas_edges WHERE source_key=? OR target_key=?`).

**Files:** `packages/db/src/canvas-repository.ts`.
**Gate:** `packages/db` vitest (fake Drizzle chain, existing `db: fake as never` idiom) — assemble; apply-diff;
`addNode` idempotency; `removeNode` edge-cleanup; 13-type round-trip incl. `unknown-node-type` heal + the two
content-carrying types (`source`, `directory`).

### B3 — `CANVAS_ROW_MODEL` flag + BlobStore/RowStore behind unchanged procedures
Keep `CanvasSnapshotSchema` (`canvas-schema.ts:156-164`) as the tRPC wire contract **unchanged**; swap only the
persistence backend. Two backends behind the existing procedures (`getCanvasLayout`/`saveCanvasLayout`/
`getHomeCanvasLayout`/`saveHomeCanvasLayout`/`addCanvasNode`/`connectCanvasNodes`/`removeCanvasNode`):
- **BlobStore** — today's `chat_canvas_layouts` upsert/read, extracted byte-for-byte (additive-never-clobber
  discipline of `canvas-mutations.ts:19-37` preserved).
- **RowStore** — delegates to `CanvasRepository` (B2), resolving a `canvasId` from `conversationId` or the home
  key (auto-create on first save if missing).

Flag `CANVAS_ROW_MODEL` (`off` default | `dual_write` | `read_rows`), reversible without redeploy:
`off` = BlobStore only; `dual_write` = blob authoritative + returned, row write **best-effort** (logged, never
breaks the request), reads from blob; `read_rows` = reads from RowStore, writes stay dual. A **shadow-compare**
test reconstructs a snapshot from rows and asserts logical equality with the blob — the parity gate before any
`read_rows` flip. Web consumers (`useCanvasPersistence`, `ChatCanvas`, `TranscriptPanelHost`, `HomeBoard`,
`useSendTo` — 03-doc §2.5) **do not change**; the eventual `read_rows` flip is invisible to React (same shape in).

**Files:** `packages/api-client/src/router/chat/{canvas,home-canvas,canvas-mutations}.ts` (+ a small
`canvas-store-backend.ts` housing BlobStore/RowStore + the flag).
**Gate:** `packages/api-client` vitest per mode — (a) `dual_write` leaves the blob byte-identical to the
blob-only path, (b) RowStore round-trips all 13 types incl. heal + `source`/`directory`, (c) reconstruction ==
blob under shadow-compare, (d) caps + write-time gates still reject hostile input; existing `canvas.test.ts`
(unchanged wire contract) still passes.

### B4 — idempotent backfill script *(separate from the migration)*
A `packages/db` script (or admin tRPC mutation) — NOT DDL in `0052`, so the schema apply is decoupled from the
live data copy and the copy is re-runnable/verifiable. For each `chat_canvas_layouts` row: ensure an
auto-created **personal workspace** for the owning user (via `workspaces.create` seeding, `workspaces/index.ts:81-104`,
which seeds the owner `workspace_members` row); upsert a `canvases` row (`kind='conversation'` keyed on
`conversation_id`, or `kind='home'` keyed on `owner_user_id`) copying `viewport`/`shared_state`/`node_registry_version`;
explode `nodes[] → canvas_nodes` (`node_key = elem.id`, `type/position/data/width/height` from the element),
`edges[] → canvas_edges` (`source_key`/`target_key` = the string node ids verbatim — no id remap needed since
keys are preserved). Idempotent by upsert on `(canvas_id, node_key)` / `(canvas_id, edge_key)` / `(conversation_id)`.
The blob is **not deleted**; rows are derived from it → a failed backfill drops rows and leaves the blob intact.
Owning `user_id`: conversation rows via `conversation_id → chat_conversations.user_id`; home rows via the direct
`chat_canvas_layouts.user_id`.

**Files:** `packages/db/scripts/backfill-canvas-rows.ts` (or an admin mutation in `packages/api-client`).
**Gate:** vitest/integration — seed a representative `chat_canvas_layouts` fixture (conversation + home +
unknown-type node + `source` node + one edge), run the backfill against ephemeral Postgres, assert the
assembled snapshot round-trips byte-equivalent through `CanvasSnapshotSchema`.

**3b in-tree order:** B1 → B2 → B3 → B4 (B4's test depends on B1 schema + B2 assemble). All land green with
`CANVAS_ROW_MODEL=off` (zero runtime change).

---

# PART B — REQUIRES LIVE STACK / PEDRO / INFRA (ordered runbook)

Every infra apply is **gated behind Track 1** (remote state + import all live resources + empty plan). Every
migration/schema-install is **files-only in this workflow → a Pedro-run deploy step**. Every runtime cutover is
an **env flag** (revert without redeploy).

| # | Action | Kind / gate |
|---|--------|-------------|
| **P0** | **Track 1 lands** — S3 remote state, `terraform import` every live resource (SES rules, forwarder Lambda, S3, SNS, ECS, ALB), verify an empty/acceptable plan. **Nothing infra below may apply until this is green.** | **INFRA prerequisite** (master plan Track 1) |
| **P1** | **[NEEDS-LIVE]** Verify against the live DB: the `sb_secret_…` key maps to `service_role`, and `GRANT EXECUTE … TO service_role` on `public.enqueue_job` suffices. Do not apply blind (02-doc §6). | live DB verify |
| **P2** | **[NEEDS-LIVE]** Determine the worker's **session-mode** connection string (LISTEN/NOTIFY + session state). The transaction pooler (:6543, `prepare:false`) will **not** work; the Supabase direct host is IPv6-only and Fargate egresses IPv4 → likely the **Supavisor session pooler** — confirm VPC reachability + LISTEN. Pin the exact `graphile-worker` version + min-Postgres. (02-doc §3.4, 05-doc §4) | live VPC/pooler fact |
| **P3** | **[Pedro / files-only]** Run `apps/worker install-schema` (`--schema-only`/`runMigrations`) as `postgres` over `POSTGRES_URL_NON_POOLING` against staging → prod (installs `graphile_worker`), **then** `db:migrate` `0051` (enqueue wrapper). Sequence: schema install **before** `0051`. Verify `graphile_worker.jobs` exists and `enqueue_job` is callable as service_role. | DB deploy step |
| **P4** | **[INFRA / terraform apply — Track-1-gated]** `ecs.tf`: add the **second container** (`essential=false`, `command=["node","/worker/dist/index.js"]`, shared image) + new `GRAPHILE_WORKER_CONNECTION_STRING` secret in `secrets[]`; `iam.tf` `secretsmanager:GetSecretValue`; `variables.tf` ARN var. (Optional `locals.tf` cpu/mem bump.) Then ship the Node-baked image via `deploy-email-listener.yml` (build→push→`--force-new-deployment`; image not TF-managed). | terraform apply + CI image deploy |
| **P5** | **[Pedro env flip, reversible]** `INGEST_ENQUEUE_ENABLED=true`. Watch the DLQ (`graphile_worker.jobs` via the A8 router) + `pipeline_health`. Roll back = flip off (returns to the inline path). | runtime cutover |
| **P6** | **[Pedro env flip]** Enable `deep_research` enqueue (after ingestion is proven). `max_attempts=2–3`; watch `chat_run_events` append + budget. | runtime cutover |
| **P7** | **[Pedro / files-only]** Apply `0052` (canvas tables + RLS) to staging → prod (pure DDL, no data dependency). | DB deploy step |
| **P8** | **[Pedro env flip, reversible]** `CANVAS_ROW_MODEL=dual_write`. Rows accumulate under real traffic; watch shadow-compare. Blob stays authoritative. | runtime cutover |
| **P9** | **[Pedro]** Run the **B4 backfill script** against staging → prod (idempotent, blob untouched); verify canvas/node/edge row counts vs blob. | data migration |
| **P10** | **[Pedro env flip, reversible]** `CANVAS_ROW_MODEL=read_rows` **per surface**, gated by the **real-browser** gates against an already-running server on :3000 (`npm run test:geometry` + `npm run screenshot:review` — read the PNGs; jsdom proves nothing geometric). The whole-row LWW race closes here (agent writes go per-row via `CanvasRepository`). | runtime cutover + visual gate |
| **P11** | **[later / files-only `0053` + Pedro apply]** After N releases of parity, stop writing the blob and drop `chat_canvas_layouts.nodes/edges/viewport/shared_state/node_registry_version` (or the table). Keep the columns until confident — demote, never drop early. | DB deploy step |
| **P12** | **[later, separately Track-1-gated]** ALB/Fargate **ingress teardown** — the **cost half** (`alb.tf`/`network.tf`/`ecs.tf`). **Not required for the reliability win** and **not on Track 3's critical path**; serialize behind Track 1 as its own infra project. | terraform apply (separate) |

**Reversibility ledger:** every live cutover is an env flag (`INGEST_ENQUEUE_ENABLED`, `CANVAS_ROW_MODEL`);
the enqueue path fails *safe* (500 → SNS retries) vs today's silent 200-loss; the worker cannot kill mail
(`essential=false`, separate container); the blob is never dropped, only demoted; the only Track-3 `terraform
apply` is the P4 container+secret diff (Track-1-gated) — nothing else in 3a/3b touches live infra.

---

## Appendix — key cites
- Silent-loss handler / enqueue seam: `sns_inbound.py:57-64`; `execute(ses_message_id, recipients)` `ingest_inbound_email.py:168`.
- Enqueue privilege/PostgREST walls + hybrid schema install: 02-doc §1.2–1.3, §2.4.
- Worker↔Python HTTP seam + new endpoint + honest appraisal: 02-doc §4.3–4.4; `require_api_key` `middleware/auth.py:16-27`.
- Co-location shapes / Dockerfile Python-only / no scheduler pattern: 05-doc §1–3; Shapes A/B 05-doc §2.
- `to_thread` targets: 01-doc §3. deep_research event source: 01-doc §6; `chat_run_events` append-only.
- Canvas blob + 13 types + heal + preserve-list + LWW race: 03-doc §1,§3.3–3.5,§6.
- Tenancy primitives + RLS idioms + migration conventions: 04-doc §1,§4,§5. Journal ends 0050 → `0051`/`0052`/`0053`.
- DI layout: `app/composition/*_providers.py` + `app/container.py`; ports `app/domain/ports/`. Workspace precedent `apps/daemon`.

---

## Adversarial critique + go/no-go

> Reviewer stance: refute, not rubber-stamp. Every verdict below is grounded in what actually
> ran (or refused to run) in THIS container on 2026-07-24, plus source re-verification. The
> design's structure is sound and the Part B runbook is correctly Track-1-gated; the problems are
> (a) the Part-A **gates** it names largely do not exist and several **cannot** run here, (b) the
> listener half ships to **live prod on merge**, not "at Part B", and (c) **A9 mislabels a
> live-stack UX cutover as a clean seam proof.**

### What I actually verified in this container (the facts the verdicts rest on)

| Probe | Result | Consequence for the plan |
|---|---|---|
| `node`/`npm` | v22.22.2 / 10.9.7 | tsc/vitest/build gates run. ✅ |
| `uv` + listener `.venv` | present | `uv run pytest\|mypy\|ruff\|lint-imports` run. ✅ |
| **Docker daemon** | **CLI present, daemon DOWN** (`/var/run/docker.sock` absent) | **A7's only gate (`docker build`) CANNOT run here.** The clean pgvector-Postgres harness (a `pgvector/pgvector` container) is also unavailable. ❌ |
| `postgres` 16 binary + `psql` | present, but **`initdb`/`pg_ctl` refuse to run as root** (container is uid 0); `runuser` present | A real local PG is only reachable via `runuser` to a non-root user + bare pg16. Feasible for graphile (no pgvector needed); must be *built*, not "wired". ⚠ |
| **pgvector for pg16** | **absent** (`vector.so`, `vector.control` missing); **9 migrations require `vector`/`halfvec`** | **No "apply-all-migrations-from-scratch" gate can run here** — neither the bare pg16 nor PGlite (which also lacks pgvector) can replay 0000→0052. ❌ |
| PGlite (`@electric-sql/pglite`) | present; used by exactly **one** test (`entity-resolution-dismiss.test.ts`) that loads **one** `.sql` file, and its own comment says PGlite ships **no** pgvector/halfvec | The only real-SQL DB pattern in the repo is "one migration file against a hand-seeded schema", not a full-chain apply. RLS + `auth.uid()` are unavailable here. ❌ |
| npm registry | reachable; `graphile-worker@0.17.3` resolvable | The Node worker package is installable/buildable. ✅ |
| `deploy-email-listener.yml` trigger | **`push: branches:[main], paths:[apps/email-listener/**]`** → `docker build → push :latest → ecs update-service --force-new-deployment` on `nauta-services-email-listener` | **Merging any A1/A4/A5/A7/A9 file to main auto-rolls a new image onto the LIVE mail-receiving task.** "Worker inert until Part B" is true of queue *behavior*, false of the *image rollout*. 🔴 |
| `run_chat_turn.py:245,1632` | `_TOOL_TIMEOUT_OVERRIDES={"deep_research":600.0}`; the tool executor is **awaited inline** in the turn's tool loop | **deep_research is a mid-turn tool, not a discrete call site.** A9's "enqueue the sub-loop" = detach from the streaming turn + re-attach the UI to `chat_runs` — a change to the interactive turn the master plan says to keep in-process. 🔴 |
| Non-web canvas writers | `grep chat_canvas_layouts` across `apps/email-listener` → **none**; all readers/writers are the 7 tRPC procedures in `packages/api-client` (+ web hooks) | **Axis-5 clear:** no Python/other writer a TS-only RowStore cutover would silently drop. B3's flag genuinely covers every writer. ✅ |
| Source spot-checks | `execute(self, ses_message_id, recipients=())` `ingest_inbound_email.py:168` ✅; `app/domain/ports/` ✅; `app/composition/*_providers.py`+`container.py` ✅; `require_api_key` `auth.py:16` ✅; journal ends `0050_purge_maritime_data` ✅ | D2/D3/A2/A3/A5 code anchors are real. ✅ |

### Per-Part-A-step verdict

**Legend.** *CONFIRMED-BUILDABLE* = code **and** its gate run green in THIS container now. *NEEDS-GUARDRAIL* = file/code buildable now, but its named gate cannot fully run here (missing harness / live dependency) — ship it only with the stated guard. *RECLASSIFY* = the step (or a load-bearing part of it) is not a Part-A "build-and-gate" item at all and belongs in Part B.

| Step | Gate runs here? | Verdict | Why |
|---|---|---|---|
| **A1** to_thread wrap | `uv run pytest/mypy/ruff/lint-imports` — **yes** | **CONFIRMED-BUILDABLE** | Pure, behavior-preserving app code. Only nit: the "loop-tick-not-starved" test is timing-based (keep it tolerant). |
| **A2** JobEnqueuer port + adapter + DI | pytest monkeypatch/mypy/lint-imports — **yes** | **CONFIRMED-BUILDABLE** | Adapter reuses the cached supabase client; the test monkeypatches `.rpc`, so **no live Supabase needed**. |
| **A4** sns_inbound flagged enqueue + backfill enqueue-N | pytest — **yes** | **CONFIRMED-BUILDABLE** (guard: depends on A2; ships live on merge) | Flag default `false` = today's path. 500-on-enqueue-failure is strictly safer than the current silent-200. Verify a mis-wired/unregistered `JobEnqueuer` yields 500, not a swallowed loss. |
| **A5** internal `POST /v1/emails/ingest-job` | pytest (200 ok / 5xx on raise) — **yes** | **CONFIRMED-BUILDABLE** | The 5xx-on-failure property (the thing graphile depends on) is unit-assertable with a stub use-case. |
| **A3** `0051` wrapper SQL + `install-schema.ts` | file-gen **yes**; **integration gate (install graphile schema → apply 0051 → assert `enqueue_job` lands a row) — NO existing harness; needs a `runuser` local pg16 (no pgvector required)** | **NEEDS-GUARDRAIL** | The `SECURITY DEFINER` wrapper + the `(add_job(...)).id` shape are **only proven once run against the real installed `graphile_worker` schema**. It ships as a files-only migration Pedro later applies to prod → the in-container graphile gate is **mandatory**, and must use a real pg cluster, **not PGlite** (graphile needs `LISTEN/NOTIFY`). Add the loud "schema absent" `RAISE` guard as specified. |
| **A6** `apps/worker` Node package | tsc/build/unit — **yes**; **worker↔pg↔stub integration — same missing pg harness as A3** | **NEEDS-GUARDRAIL** | `tsc --noEmit` + `node --check` + the stub-HTTP unit logic run now; the "boot worker against real graphile schema, 500→attempts++" assertion needs the `runuser` cluster. Adding `apps/worker` to root `workspaces` re-resolves the root lockfile — run a full `npm install` + a `tsc` across *existing* workspaces to prove no collateral. |
| **A8** `graphileJobs` DLQ tRPC router | fake-Drizzle vitest — **yes**; **SQL-vs-real-`graphile_worker.jobs`-view — same missing harness** | **NEEDS-GUARDRAIL** | The permafailed/reschedule/purge SQL is only validated against the real graphile view; the fake-Drizzle chain proves shape, not that the view columns exist. |
| **A7** Dockerfile multi-stage (Node in image) | **`docker build` gate CANNOT run — daemon down** | **NEEDS-GUARDRAIL + partial RECLASSIFY** | Two problems. (1) Its **only** gate can't execute here, so it is not "build-and-gated in this container." (2) The step's prose "**Ships via the existing CI … push `:latest` → update-service**" describes a **live prod rollout of the mail receiver**, which `deploy-email-listener.yml` fires **on merge to main**. **Split it:** the Dockerfile *file* + a build that (when a daemon exists) asserts **uvicorn still boots** (not just `node --version`) is Part A; the **image rollout is Part B P4 (Pedro)** — correct the Part-A sentence that says it ships via CI. |
| **A9** deep_research durability | isolated pytest (fake ChatProvider) — **yes, but it proves the wrong thing** | **RECLASSIFY (the cutover) / partial** | The enqueue **plumbing** (JobEnqueuer call, `deep_research` taskList entry, `POST /v1/research/run-job`, `emit→chat_run_events` adapter) is Part-A buildable and unit-gateable. But deep_research today is **awaited inline as a 600 s mid-turn tool** in `run_chat_turn` (`:245,1632`), streaming research-trace into the live turn. Making it durable = **detaching that tool from the streaming turn and re-attaching the web UI to `chat_runs`** — a change to the interactive turn (which §65/§173 says stays in-process) whose only real proof is the **live streaming turn + a real-browser trace-render gate**. The isolated pytest cannot see that regression. **Build the plumbing in Part A; move the `run_chat_turn` detach + UI reattach to Part B (with P6), behind the flag.** Do not mark A9 "proven" from the unit test alone. |

### Per-3b-step verdict

| Step | Gate runs here? | Verdict | Why |
|---|---|---|---|
| **B1** 3 tables + `0052` + `assertCanvasOwnership` | `db:generate` clean-diff **yes**; `canvases-schema.test.ts` (fake-Drizzle) **yes**; **"ephemeral-PG apply-from-scratch" NO (needs pgvector for 0000–0050); "real-PG tenant-isolation RLS" NO (needs full schema + `auth.uid()`/`auth.users`)** | **CONFIRMED-BUILDABLE (files) + NEEDS-GUARDRAIL (RLS unverifiable here)** | The schema/migration files, the offline generate-diff, and the fake-Drizzle schema test run now. The **hand-appended nested-EXISTS RLS + partial-uniques + CHECK are the highest-risk portion and CANNOT be proven in this container** (no pgvector, no Supabase `auth` schema). Because the app connects as superuser/service_role (RLS = defense-in-depth only, 04-doc §2), a wrong policy won't break function — it silently fails to *protect* a future authenticated path. Gate the RLS in Track-2 CI on a pgvector+`auth`-shim Postgres before P7 applies it. |
| **B2** `CanvasRepository` (single write path) | packages/db vitest (fake-Drizzle) — **yes** | **CONFIRMED-BUILDABLE** | Cleanest 3b step. Drizzle-handle-first + fake chain covers assemble/apply-diff/addNode-idempotency/removeNode-edge-cleanup/13-type+heal round-trip with no DB. |
| **B3** `CANVAS_ROW_MODEL` flag + Blob/Row stores | api-client vitest per mode — **yes** | **CONFIRMED-BUILDABLE** | Flag default `off` = zero runtime change; wire contract unchanged; **verified no non-TS writer exists**, so the flag covers all consumers. Caveat: the "shadow-compare parity" test is an in-code reconstruction, not real-DB parity — real dual-write parity under traffic is **P8 (Part B)**, correctly. |
| **B4** idempotent backfill script | seeded-fixture round-trip **buildable**; **faithful "apply-from-scratch then backfill" NO (pgvector)** | **NEEDS-GUARDRAIL** | The script + a round-trip test against a hand-seeded minimal schema build now; a faithful full-chain apply needs a pgvector Postgres (Track-2 CI). Design is safe by construction: rows derived from the blob, **blob never deleted**, idempotent upserts. Real backfill is **P9 (Pedro)**. |

### Landmine audit (clean, with one correction)

- **No nauta/magnitude rename** in any Part-A step. A7 reuses the existing `nauta-services-email-listener` ECR/cluster/service names verbatim — good. ✅
- **No `terraform apply`, no prod-DB connection, no live-email/S3/Lambda read** in Part A. ✅
- **Migrations stay files-only**; the only in-container DB touch I did was a throwaway cluster attempt (which root-refused) — nothing touched Supabase. ✅
- **Correction (not a violation, but a mislabel):** A7's "ships via existing CI … update-service" and the master claim that A1–A9 "land green with the worker inert; nothing runs until Part B" **understate that merging the listener half to `main` auto-deploys the live mail receiver.** Behavior is flag-protected; the **image is not** — a broken Node multi-stage image rolls to the live task on merge. Treat every listener merge as a live deploy.

### The safe ordering (what makes the live halves non-destructive)

- **3a mail-pipeline safety.** A1 (behavior-preserving) first, anytime. A2→A4→A5→A6→A8 build the inert enqueue path (flag `off`). **A7 is the dangerous merge** — its image rollout is live; require a real `docker build` + **uvicorn-boot smoke** on a machine with a daemon, and land the rollout as **P4 (Pedro)**, not on a blind merge. Then the ordered live cutover is exactly the design's P0(Track1)→P1/P2(NEEDS-LIVE verifies)→P3(schema install **before** 0051)→P4(container+secret, Track-1-gated)→P5(`INGEST_ENQUEUE_ENABLED=true`, revert=flag-off). This ordering is **correct**.
- **3b canvas-data safety.** Additive-first (`0052` touches nothing existing) → `dual_write` (blob authoritative, P8) → **separate** idempotent backfill (rows derived from blob, blob untouched, P9) → `read_rows` per-surface gated by the real-browser gates + shadow-compare (P10) → demote-never-drop `0053` (P11). This ordering is **correct and safe**; the only unproven-here link is `0052`'s RLS (guardrail above).

### FINAL — confirmed safe to build-and-gate in THIS container right now (ordered)

This is the list the implementation workflow should execute. Every item's **gate runs green here today**; items are ordered by dependency.

1. **A1** — `to_thread`-wrap the ingest path. *(pytest/mypy/ruff/lint-imports)*
2. **A2** — `JobEnqueuer` port + `SupabaseJobEnqueuer` + DI wiring. *(pytest monkeypatch/mypy/lint-imports)*
3. **A4** — `sns_inbound` flag-gated enqueue (default off) + `backfill_reprocess` enqueue-N. *(pytest; needs A2)*
4. **A5** — internal `POST /v1/emails/ingest-job` (5xx-on-failure). *(pytest)*
5. **B2** — `CanvasRepository` single row write path. *(packages/db fake-Drizzle vitest)*
6. **B3** — `CANVAS_ROW_MODEL` flag + Blob/Row stores behind unchanged procedures (default off). *(api-client per-mode vitest; needs B2)*
7. **B1(files)** — 3 schema files + `0052` + `assertCanvasOwnership`, gated by the **offline** `db:generate` clean-diff + `canvases-schema.test.ts` fake-Drizzle test **only**. *(RLS + apply-from-scratch NOT gated here — see guardrail.)*

**Buildable now but only fully gated once a real Postgres harness is stood up in-container** (via `runuser`+bare pg16 for graphile; the pgvector-dependent proofs require Track-2 CI, not this box): **A3, A6, A8** (graphile integration) and **B4** + **B1's RLS/apply-from-scratch** half. Build these, but do **not** report their DB-integration gate as green until the harness exists.

**Explicitly NOT clean Part-A build-and-gate items:** **A7's image rollout** (→ Part B P4) and **A9's `run_chat_turn` detach + UI reattach** (→ Part B, with P6). A7's Dockerfile *file* and A9's *plumbing* may be authored in Part A, but neither is "proven" here — A7 because the `docker build` daemon is down, A9 because the only real proof is the live streaming turn.

### Top 3 risks

1. **Merge-to-main auto-deploys the live mail receiver.** `deploy-email-listener.yml` fires on push to `main` for `apps/email-listener/**` and runs `docker build → push :latest → ecs update-service --force-new-deployment` on `nauta-services-email-listener`. The design's "worker inert until Part B" protects queue *behavior*, not the *image*: A7's Node multi-stage (or any A1/A4/A5/A9 file) rolls to the live task on merge. A broken image = **inbound-mail outage**. Mitigation: land listener changes behind a non-auto-deploy branch/gate, make the A7 build assert **uvicorn still boots**, and treat the rollout as P4 (Pedro), not a merge side-effect.

2. **The DB-integration gates the design leans on don't exist and mostly can't run here.** "Track-2 ephemeral-Postgres apply-from-scratch" and "real-Postgres tenant-isolation" are unrunnable in this container (pgvector absent; 9 prior migrations need it; PGlite lacks it; Docker daemon down so no pgvector image; bare pg16 refuses root). Consequence: **`0051`'s `SECURITY DEFINER` SQL and `0052`'s hand-appended RLS/CHECK ship as files Pedro applies to prod with their correctness unproven in-container** unless a `runuser` graphile harness (for A3/A6/A8) and a Track-2 pgvector CI (for B1-RLS/B4) are actually built. This is the real gap between "buildable" and "gated" — do not let a green fake-Drizzle suite stand in for it.

3. **A9 mislabels a live-stack UX cutover as a clean seam proof.** deep_research is a 600 s mid-turn tool awaited inline in `run_chat_turn`, streaming research-trace into the live turn — not a discrete call site. Enqueuing it detaches from the streaming turn and re-attaches the web UI to `chat_runs`, changing the interactive turn (which §65/§173 mandates stays in-process) in a way only a **live streaming turn + real-browser trace-render gate** can validate. Building A9 as if the isolated pytest "proves the seam" risks shipping a research flow that silently regresses the live trace UX. Build the plumbing; defer the turn-detach to Part B.
