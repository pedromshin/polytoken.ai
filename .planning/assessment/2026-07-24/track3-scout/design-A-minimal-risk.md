# Track 3 — Design A: Minimal Blast Radius, Ship-Incrementally

> Angle: smallest blast radius, ship-incrementally, reversibility, **protect the live mail
> pipeline above all**. This design gets durability (3a) + the row model (3b) in with the
> fewest live-DB / live-infra risks. Two load-bearing bets:
> 1. **3a:** the Node worker calls back into the *unchanged* Python pipeline over HTTP — no
>    reimplementation, the Python `IngestInboundEmailUseCase` stays the one source of truth.
> 2. **3b:** an *additive* Canvas/Node schema sits **behind the existing `CanvasSnapshotSchema`
>    tRPC contract**, with dual-write + a compatibility read path over the blob, so the blob
>    stays the source of truth until the rows are proven — and the blob is never dropped
>    (only demoted), so every step is reversible.
>
> Every step below is tagged **[BUILD-IN-TREE + gate]** (code/migration files, mergeable now,
> verifiable by a named gate) or **[LIVE / PEDRO / INFRA]** (needs the live stack, a Terraform
> apply gated behind Track 1, or a migration/backfill Pedro runs out of band).
>
> Sourced from the five Track-3 scout docs (01–05) + master plan §62–69, §169. Cites are
> `file:line`. Analysis/design only — no source edits made producing this doc.

---

## 0. Decisions at a glance

| # | Question | Decision (minimal-risk) |
|---|----------|------------------------|
| D1 | graphile schema install | **Hybrid.** Library owns the volatile `graphile_worker` schema via an explicit one-shot `runMigrations()`/`--schema-only`. Vendor **only** the tiny stable `public.enqueue_*` SECURITY DEFINER wrapper into `packages/db` (migration `0051`). Never vendor graphile's internal schema. |
| D2 | Python enqueue seam | **Path A: `supabase.rpc("enqueue_ingest_job", …)`** through a `public` SECURITY DEFINER wrapper. Zero new Python deps, zero new connection, zero new secret on the Python side — reuses the existing supabase-py client + `SUPABASE_SECRET_KEY`. |
| D3 | What SNS enqueues | `{ses_message_id, recipients}` — a **pointer, not the bytes** (SES already durably wrote the MIME to S3; the key is derivable). Exactly the two args of `execute(ses_message_id, recipients)`. |
| D4 | Worker → pipeline seam | Node handler **POSTs back into a new internal Python route** `/v1/emails/ingest-job` (guarded by the existing `require_api_key`), which calls `IngestInboundEmailUseCase.execute(...)` and **returns 5xx on failure** so graphile retries. No Node reimplementation of the pipeline. |
| D5 | Co-location shape | **Second container in the *same* ECS task** (Shape B), `essential=false`, sharing the image with a command override running `graphile-worker`. A worker crash **cannot** kill the SNS webhook receiver (protects mail); still one task / one Fargate bill; fully reversible (delete the container block). |
| D6 | Retries / DLQ | `max_attempts=8` set in the wrapper (poison email dead-letters in hours, not the 25-attempt default's days). "DLQ" = permafailed rows surviving in `graphile_worker._private_jobs`, read via the `graphile_worker.jobs` view **from web/tRPC over the direct `postgres` connection**, not through Python. |
| D7 | `to_thread` wrapping | Ship it **first and independently** (pure app code, zero infra) — it protects the in-process chat turn on the shared uvicorn loop today, and still matters after 3a because the internal endpoint runs the pipeline on that same loop. |
| D8 | Cutover gating | Every live flip is behind an **env flag** (reversible without a code redeploy) and a failed enqueue returns **non-200** (SNS retries) — strictly safer than today's silent 200-loss. |
| D9 | 3b schema | **Additive** `canvases` / `canvas_nodes` / `canvas_edges` (migration `0051`… same file or `0052`), never touching `chat_canvas_layouts`. Rows live **behind the unchanged `CanvasSnapshotSchema` tRPC contract**, so the 13 node types, heal-on-restore, caps, and write-time gates are all preserved for free. |
| D10 | 3b cutover | Dual-write → shadow-compare read → Pedro-run idempotent backfill → flip web to rows → keep blob as demoted fallback for N releases. Blob is never dropped. |

---

## PART 3a — DURABLE RUNTIME

### 3a.1 The graphile schema install decision (D1)

**Decision: hybrid — library owns its schema, we own the seam.** (02-doc §2.4.)

- The `graphile_worker` internal schema (`_private_jobs`, `migrations`, the `jobs` view, the
  `add_job`/`add_jobs`/admin functions) is **not a public interface** and shifts across minor
  versions (the `v0.13→0.14` / `v0.15→0.16` `_private_jobs` renames). **Do NOT vendor it** into
  `packages/db` — that would be a permanent maintenance tax on volatile internals (02-doc §2.3).
- Install it with an explicit **one-shot** `runMigrations()` (library) or `graphile-worker
  --schema-only` (CLI), run as the `postgres` owner over `POSTGRES_URL_NON_POOLING` — the exact
  connection `packages/db/src/migrate.ts` already uses. Decouple this from the always-on/scheduled
  worker so there is no first-boot race (02-doc §2.2).
- **Vendor only** the stable `public.enqueue_*` wrapper (§3a.2) as a normal `packages/db`
  migration file. That is *our* interface: tiny, stable, safe to own, and it keeps working under
  the "migrations are files only, nobody applies to prod in this workflow" rule.
- **Ordering:** the graphile schema install must run **before** the wrapper migration (the wrapper
  references `graphile_worker.add_job`). The wrapper migration should `RAISE` loudly if the
  `graphile_worker` schema is absent.

**[BUILD-IN-TREE + gate]** the wrapper migration file + a tiny `packages/db` script
`install-graphile-schema.ts` that calls `runMigrations({connectionString})`.
Gate: the Track-2 ephemeral-Postgres CI job runs `install-graphile-schema` then applies every
migration from scratch (master plan §55) — a green run proves the ordering and the wrapper compile.
**[LIVE / PEDRO]** actually *running* `install-graphile-schema` + `db:migrate` against
staging/prod is a deploy step Pedro runs — migrations are files-only here (04-doc §5.5).

### 3a.2 The Python enqueue seam — exact SQL call shape (D2, D3)

**The wrapper** (vendored into `packages/db/migrations/0051_enqueue_ingest_job.sql`, custom SQL):

```sql
-- Requires the graphile_worker schema to already exist (installed one-shot, §3a.1).
CREATE OR REPLACE FUNCTION public.enqueue_ingest_job(
  p_ses_message_id text,
  p_recipients     json
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER                          -- runs as the owner (postgres); service_role is NOT db owner
SET search_path = public, graphile_worker
AS $$
  SELECT (graphile_worker.add_job(
    'ingest_inbound_email',
    json_build_object('ses_message_id', p_ses_message_id, 'recipients', p_recipients),
    max_attempts := 8                     -- D6: poison email dead-letters in hours, not days
  )).id;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_ingest_job(text, json) TO service_role;
```

Why this exact shape:
- `graphile_worker.add_job` **requires database-owner privileges**; `service_role` (the
  `sb_secret_…` key the listener authenticates as) is not the owner → the SECURITY DEFINER
  wrapper is **mandatory**, not optional (02-doc §1.2).
- PostgREST exposes **only the `public` schema**, so the wrapper must live in `public` to be
  reachable via `.rpc()` (02-doc §1.3).
- Task identifier `'ingest_inbound_email'` maps to the worker's `taskList` key (§3a.4).

**The Python call** (in `sns_inbound.py`, replacing the inline `use_case.execute(...)` at
`sns_inbound.py:57-64`) — reuses the existing cached supabase client, **zero new deps**:

```python
# feature-flagged for a reversible cutover (D8)
if settings.INGEST_ENQUEUE_ENABLED:
    client = get_supabase_client()           # app/infrastructure/supabase/client.py — already cached
    await asyncio.to_thread(                  # supabase-py .execute() is sync; keep it off the loop
        lambda: client.rpc("enqueue_ingest_job", {
            "p_ses_message_id": meta["message_id"],   # BARE ses id (reprocess double-prefix landmine, 01-doc §5d)
            "p_recipients": meta["recipients"],
        }).execute()
    )
    return Response(status_code=status.HTTP_200_OK)
# else: fall through to today's inline path (unchanged), so the flag OFF == current behavior
```

**Safety improvement baked in (D8):** wrap the enqueue in a `try/except`; on enqueue failure
return **500**, not 200. Today the handler returns 200 on every failure → SNS never retries →
**permanent loss** (01-doc §1a). Returning 500 on a *transient* enqueue failure makes SNS retry —
strictly safer than today. Keep the 200-return only for genuinely unprocessable inputs (bad JSON,
unparseable SES `Message`) to avoid retry storms (`sns_inbound.py:29-31, 43-45`).

**What SNS enqueues (D3):** just `{ses_message_id, recipients}` — a pointer. SES already durably
persisted the raw MIME to S3; `S3RawEmailStore.key_for(message_id)` derives the key
(`raw_email_store.py:21-23`), and the worker re-fetches inside `execute()`
(`ingest_inbound_email.py:170`). Do **not** enqueue the bytes. `recipients` must travel (it
anchors forwarding-token → user attribution, `ingest_inbound_email.py:177`); everything else is
re-derived deterministically inside `execute()` (01-doc §5c). Idempotency is guaranteed by
`(importer_id, message_id)` upsert + `uuid5` attachment ids, so at-least-once delivery is safe
(01-doc §5d).

**Optional bulk wrapper** for backfill fan-out: `public.enqueue_ingest_jobs(specs json)` calling
`graphile_worker.add_jobs(...)`, so `backfill_reprocess.py`'s 25-cap (an ALB-idle-timeout dodge,
01-doc §4) dissolves into "enqueue N cheap rows, return an ack immediately."

**[BUILD-IN-TREE + gate]** the wrapper migration + the `sns_inbound.py` flagged rewrite +
`INGEST_ENQUEUE_ENABLED` setting (default **false**). Gate: `uv run pytest` on a new
`test_sns_inbound_enqueue.py` asserting (a) flag-on calls `rpc("enqueue_ingest_job", …)` once and
returns 200, (b) enqueue raising returns 500, (c) flag-off preserves the inline path.
**[LIVE / PEDRO]** confirm `sb_secret_…` maps to `service_role` and that `GRANT EXECUTE … TO
service_role` suffices — verify against the live DB, do not apply blind (02-doc §6, **[NEEDS-LIVE]**).

### 3a.3 The new internal Python endpoint — the worker's re-entry target (D4)

No existing route runs `IngestInboundEmailUseCase` from a bare `{ses_message_id, recipients}`:
`/inbound` takes a full JSON email, `/backfill` takes raw MIME, `/inbound-sns` runs it inline
(02-doc §4.3). Add one route — essentially the `sns_inbound.py` try-block lifted into an
authenticated endpoint that **returns non-2xx on failure** so graphile can see it:

```python
# apps/email-listener/app/presentation/api/v1/ingest_job.py  (NEW)
router = APIRouter(prefix="/v1/emails", tags=["emails-internal"],
                   dependencies=[Depends(require_api_key)])   # existing dep; API_KEY already a container secret

class IngestJobIn(BaseModel):
    ses_message_id: str = Field(min_length=1, max_length=998)
    recipients: list[str] = Field(default_factory=list)

@router.post("/ingest-job", status_code=200)
@inject
async def run_ingest_job(payload: IngestJobIn,
                         use_case: FromDishka[IngestInboundEmailUseCase]) -> ApiResponse[dict]:
    # NO bare-except-return-200 here: let it raise → FastAPI 500 → worker throws → graphile retries.
    email = await use_case.execute(payload.ses_message_id, recipients=tuple(payload.recipients))
    return ApiResponse.ok({"email_id": str(email.id), "parse_status": email.parse_status})
```

Requirements this imposes (02-doc §4.3):
- **Auth:** guard with the existing `require_api_key` (`middleware/auth.py:16-27`). `API_KEY` is
  already a container secret (`ecs.tf:82-83`), so the co-located worker can present it. (Watch the
  `auth.py:20-22` dev fail-open — irrelevant in prod, hardened separately by Track 4.)
- **Long timeout, off the public ALB:** OCR+Bedrock is seconds→minutes; this route must not sit
  behind the ~30s ALB idle timeout that forces the backfill 25-cap. In Shape B (§3a.5) the worker
  calls it over **`localhost:8000`** (same-task awsvpc network namespace) — the ALB is bypassed
  entirely.
- **Idempotency makes retries safe:** `execute()` upserts by `(importer_id, message_id)` with
  deterministic ids, so at-least-once + retry cannot double-insert (`ingest_inbound_email.py:184`).

**[BUILD-IN-TREE + gate]** the route + register it in `app/main.py` (mirrors `sns_inbound_router`
at `main.py:30,69`). Gate: `uv run pytest` asserting 200 on success and **5xx when `execute`
raises** (the property graphile depends on), plus `uv run lint-imports` (Clean-Architecture
boundary) and `uv run mypy app`.

### 3a.4 The Node worker task handler seam (D4)

```js
// apps/email-listener/worker/worker.js  (NEW — small standalone Node package)
const { run } = require("graphile-worker");
const LISTENER_URL = process.env.LISTENER_INTERNAL_URL || "http://localhost:8000";

async function ingest_inbound_email(payload) {
  const res = await fetch(`${LISTENER_URL}/v1/emails/ingest-job`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.API_KEY },
    body: JSON.stringify({ ses_message_id: payload.ses_message_id, recipients: payload.recipients }),
    // no artificial timeout shorter than the pipeline's real duration
  });
  if (!res.ok) {
    // THROW → graphile marks the job failed + schedules exponential-backoff retry (§3a.6)
    throw new Error(`ingest-job ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

run({
  connectionString: process.env.GRAPHILE_WORKER_CONNECTION_STRING,  // session-mode; see §3a.5 landmine
  concurrency: 3,               // modest — one uvicorn worker / one loop serves these back-calls
  noHandleSignals: false,
  taskList: { ingest_inbound_email },
}).catch((e) => { console.error(e); process.exit(1); });
```

The honest framing (02-doc §4.4): graphile-worker supplies a **durable queue + retry + permanent
dead-letter *around* the unchanged Python pipeline** — it does not move compute out of Python. The
win is (a) the SNS webhook returns in one RPC (retry storms gone), (b) the **job row is the durable
record** — a crash mid-pipeline leaves the job locked, the lock expires, graphile re-drives, instead
of the email being silently lost forever, (c) retries+backoff+DLQ replace the bare `except: return
200`.

**[BUILD-IN-TREE + gate]** the worker package (`worker/package.json` pinning `graphile-worker` at a
specific version + `worker.js`), added either as a new npm workspace `apps/email-listener/worker`
or standalone. Precedent: `apps/daemon` is already a `tsx`/npm Node workspace
(`apps/daemon/package.json`). Gate: `node --check worker.js` + a vitest unit test that stubs
`fetch` and asserts a non-2xx response **throws** (so graphile retries) and a 2xx resolves.
**[LIVE / PEDRO]** pin the exact graphile-worker version + confirm its min-Postgres against the
release notes before pinning (02-doc §6, **[NEEDS-LIVE]**).

### 3a.5 Co-location / Dockerfile shape (D5)

**Decision: Shape B — a second container in the same ECS task**, `essential=false`, sharing the
listener image with a command override (`node /worker/worker.js`). Rationale under the minimal-risk
angle:
- **Protects mail:** `essential=false` on a *separate* container means a worker crash never kills
  the `email-listener` container that receives the SNS webhook. (Shape A — supervisord running both
  processes in one container — couples them; a supervisor fault can take down mail. 05-doc §2.)
- **Smallest AWS footprint / reversible:** still **one task, one Fargate bill**, no new always-on
  service (honors master-plan constraint i, §65), no net-new EventBridge/RunTask Terraform (none
  exists to copy — 05-doc §3). Reverting = delete the second container block from `ecs.tf`.
- **localhost re-entry:** in Fargate `awsvpc` mode, containers in one task share the network
  namespace, so the worker reaches the API over `localhost:8000` — off the ALB idle-timeout path
  (§3a.3).

Rejected: Option 2 (scheduled `graphile-worker --once` via EventBridge→RunTask) — it is the cheaper
long-run shape but it is **net-new Terraform with no existing pattern**, adds a cold-start per run,
and complicates the re-entry target (an ephemeral task has no local uvicorn). Higher blast radius
now; revisit as a later cost move (05-doc §3.5).

**Dockerfile change** (multi-stage; `apps/email-listener/Dockerfile` is Python-only today,
`Dockerfile:2,12,52` — no Node — 05-doc §1):

```dockerfile
# NEW stage: build the worker's node_modules
FROM node:20-slim AS node_worker
WORKDIR /worker
COPY apps/email-listener/worker/package*.json ./
RUN npm ci --omit=dev            # installs graphile-worker + pg
COPY apps/email-listener/worker/ ./

# in the existing python:3.11-slim runtime stage, bring node + the worker in:
COPY --from=node:20-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node_worker  /worker /worker
# CMD for the API container is UNCHANGED (uvicorn). The worker container overrides
# command to ["node","/worker/worker.js"] in the ECS task def, sharing this same image.
```

The image change ships through the **existing CI path** (`deploy-email-listener.yml` build → push
`:latest` → `update-service --force-new-deployment`) with **no Terraform apply** — image contents
are not Terraform-managed (05-doc §1, §5).

**[BUILD-IN-TREE + gate]** the Dockerfile multi-stage change + worker package. Gate: `docker build
-f apps/email-listener/Dockerfile .` succeeds locally and the image contains a runnable `node`
(`docker run … node --version`).
**[LIVE / PEDRO / INFRA — Track 1-gated]** the `ecs.tf` second-container block (`essential=false`,
command override) + the new `GRAPHILE_WORKER_CONNECTION_STRING` secret in `ecs.tf:secrets[]` +
`iam.tf` `GetSecretValue` + `variables.tf` ARN var. This is a `terraform apply`, **forbidden until
Track 1** stands up remote state and imports live resources (05-doc §4, §5; CLAUDE.md landmine).

### 3a.6 Retries + DLQ (D6)

- **Retries/backoff:** on a thrown handler error graphile fails the job and schedules an
  exponential-backoff retry, `exp(least(10, attempt)) * interval '1s'`, incrementing `attempts`
  and storing `last_error` (02-doc §4.1). Default `max_attempts=25` spans days; we set **8** in the
  wrapper so a poison email dead-letters in hours.
- **DLQ is a generated column, not a table.** Successful jobs are **deleted**; a job that exhausts
  `max_attempts` has `is_available` flip false forever and **survives** in `graphile_worker._private_jobs`
  with `last_error` — *that surviving row is the dead-letter record* (02-doc §4.2).
- **Monitoring / re-drive surface:** read the sanctioned `graphile_worker.jobs` **view** (not the
  private table): `SELECT id, task_identifier, attempts, max_attempts, last_error FROM
  graphile_worker.jobs WHERE attempts >= max_attempts AND locked_at IS NULL`. Re-drive with
  `graphile_worker.reschedule_jobs(ARRAY[…], attempts := 0, …)`; purge with `DELETE_PERMAFAILED_JOBS`.
- **Where the DLQ UI lives:** the `jobs` view is in the non-`public` `graphile_worker` schema →
  **not** PostgREST-reachable. But the **web app already holds a direct `postgres` connection**
  (`packages/db/src/client.ts`). So build the DLQ read/re-drive in the **web/tRPC layer over that
  direct connection**, not through the Python listener (02-doc §4.2).
- **Optional hardening — a "received" marker:** `execute()` writes nothing before
  `email_repo.save` (`ingest_inbound_email.py:221`), so a marker row written at **enqueue** time
  makes in-flight/failed ingests visible (feeds the existing `pipeline_health` read model) and
  gives the DLQ something to reconcile against (01-doc §5e). Not required for the minimal seam.

**[BUILD-IN-TREE + gate]** a `packages/api-client` tRPC `graphileJobs` router (list-permafailed /
reschedule / purge) over the direct `postgres` connection; unit-tested against the ephemeral-Postgres
CI job with graphile schema installed. **[LIVE / PEDRO]** operating the real DLQ (rescheduling a
genuinely stuck prod email) is a live action.

### 3a.7 The `to_thread` wrapping plan (D7)

**Ship first, independently — pure app code, zero infra, and valuable today.** The single uvicorn
loop also serves the in-process interactive chat turn (`run_chat_turn.py`, kept in-process per
master-plan §65/§173); one slow email must not freeze it. After 3a the internal endpoint runs the
pipeline on that same loop, so this still matters (01-doc §3 note).

Wrap in `asyncio.to_thread` (or move into the worker thread where blocking is fine):
- **Blocking sync I/O on the loop:** every ingest-path repo `.execute()` — the ~93 unwrapped calls
  across `component_repository.py` (17), `email_repository.py` (10), `entity_instance_repository.py`
  (22), `knowledge_graph_repository.py` (19), `entity_type_repository.py` (12), + `attachment_`,
  `thread_`, `importer_`, `forwarding_address_`, `entity_type_correction_`, `extraction_`,
  `entity_resolution_` repos (01-doc §3 table). Plus `S3RawEmailStore.fetch`'s sync
  `get_object` (`raw_email_store.py:27`).
- **Sync-and-not-even-awaited (worst offender):** `EntityResolutionRepository.find_candidates`
  (`entity_resolution_repository.py:122`, called at `resolve_ingest_entities.py:190`) — plain `def`
  issuing 2× `.execute()`; needs an `await asyncio.to_thread(...)` wrapper.
- **Blocking CPU on the loop:** `parse_mime` (`ingest_inbound_email.py:171`) and `html_to_text`
  (`ingest_inbound_email.py:437`).
- **Leave as-is (already offloaded / truly async):** pdfminer/pdf2image/Textract
  (`ThreadPoolExecutor`/`run_in_executor`); all `AsyncAnthropicBedrock` LLM calls.

Follow the existing WR-06 precedent — the newer chat/genui/cost repos already do this
(`supabase_chat_message_repository.py:114`). This is a mechanical, per-repo change.

**[BUILD-IN-TREE + gate]** the wrapping. Gate: `uv run pytest` (unchanged behavior) + a new test
that runs a synthetic slow `.execute()` and asserts a concurrent `asyncio.sleep(0)`-style loop tick
is not starved (proves the offload) + `uv run mypy app` + `uv run lint-imports`.

### 3a.8 3a build order

| Step | What | Tag |
|------|------|-----|
| A1 | `to_thread`-wrap the ingest path (§3a.7) | **[BUILD-IN-TREE]** pytest loop-not-starved test |
| A2 | New internal `/v1/emails/ingest-job` route, 5xx-on-failure (§3a.3) | **[BUILD-IN-TREE]** pytest 5xx-on-raise + lint-imports |
| A3 | `0051_enqueue_ingest_job.sql` wrapper + `install-graphile-schema.ts` (§3a.1–2) | **[BUILD-IN-TREE]** ephemeral-PG CI applies clean |
| A4 | `sns_inbound.py` flagged enqueue, 500-on-enqueue-fail, flag default OFF (§3a.2) | **[BUILD-IN-TREE]** pytest flag on/off/fail |
| A5 | Node `worker/` package + Dockerfile Node stage (§3a.4–5) | **[BUILD-IN-TREE]** `docker build` + `node --check` + vitest |
| A6 | web/tRPC `graphileJobs` DLQ router (§3a.6) | **[BUILD-IN-TREE]** ephemeral-PG unit tests |
| A7 | Install graphile schema + apply `0051` on staging/prod | **[LIVE / PEDRO]** files-only workflow |
| A8 | `ecs.tf` 2nd container + `GRAPHILE_WORKER_CONNECTION_STRING` secret | **[LIVE / INFRA — Track 1]** terraform apply |
| A9 | Flip `INGEST_ENQUEUE_ENABLED=true` (env only, reversible) | **[LIVE / PEDRO]** env flip, watch DLQ + pipeline_health |

A1–A6 land and are green **in tree** with the worker inert. A7–A9 are the live flips, each small and
reversible (A9 is an env var). The worker connection landmine — graphile needs `LISTEN/NOTIFY` +
session state, which Supabase's transaction pooler (:6543) does **not** support; the direct :5432 is
IPv6-only and Fargate egresses IPv4 — makes the exact connection string a **[LIVE / INFRA
NEEDS-LIVE]** call (likely the Supavisor *session* pooler; 02-doc §3.4, 05-doc §4). Do not assume
the web app's transaction-pooler URL works — it will not for `LISTEN`.

---

## PART 3b — WORKSPACE → CANVAS → NODE ROWS

### 3b.1 The stable-contract bet (why this is minimal-risk)

The whole 3b risk is that `chat_canvas_layouts` powers shipped features via a web-side
save/restore pipeline with 13 node types, a heal-on-restore contract, per-type write gates, caps,
and a known LWW race (03-doc §6). The minimal-risk move: **keep `CanvasSnapshotSchema`
(`canvas-schema.ts:156-164`) as the tRPC wire contract unchanged**, and swap only the *persistence
backend* behind the existing procedures. The row model becomes an implementation detail. This
means the 13 node types, `originalTypeFor`/`originalDataFor` heal path, the 200/400/100k caps, and
the write-time security gates are **preserved for free** — the web client never sees the change
during dual-write. The blob is never dropped, only demoted → every step reversible.

### 3b.2 The additive schema (D9)

New Drizzle tables (barrel-exported from `schema/index.ts`; DDL + RLS hand-appended in migration
`0052_canvas_nodes.sql`, custom — next number after 3a's `0051`; 04-doc §5). **Additive only — this
migration does not touch `chat_canvas_layouts`.**

**`canvases`** — Canvas is first-class; a conversation canvas and a home board are two *instances*
(closes the `scope='home'` bolt-on strain, 03-doc §4):
```
id                    uuid PK default gen_random_uuid()
workspace_id          uuid NOT NULL → workspaces(id) ON DELETE CASCADE      -- containment
owner_user_id         uuid NOT NULL → auth.users(id) ON DELETE CASCADE       -- denormalized direct anchor (house style, 04-doc §4.2 opt B)
conversation_id       uuid → chat_conversations(id) ON DELETE CASCADE        -- nullable: home canvas has none
kind                  text NOT NULL                                          -- 'conversation' | 'home'
name                  text NOT NULL default 'Untitled canvas'
is_default            boolean NOT NULL default false
viewport              jsonb                                                  -- {x,y,zoom}; per-board (was blob col)
shared_state          jsonb NOT NULL default '{}'                           -- panels.*/shared.* bag; 100k-char cap enforced app-side
node_registry_version text NOT NULL                                         -- per-board (D-04); incl. home 'home-v1' sentinel
created_at / updated_at timestamptz NOT NULL default now()

UNIQUE idx_canvases_conversation_id (conversation_id)                        -- one canvas per conversation (NULLs distinct → home rows never collide)
PARTIAL UNIQUE idx_canvases_home_owner (owner_user_id) WHERE kind='home'     -- one home board per user (mirrors chat-canvas-layouts:117-121)
INDEX idx_canvases_workspace_id (workspace_id)
CHECK ((kind='conversation') = (conversation_id IS NOT NULL))                -- discriminator, mirrors 0046 shape
```

**`canvas_nodes`** — a node is a row, but its identity stays the **canonical `type:ref` string** so
idempotency and edge references survive without remapping (03-doc §6 items 4, 11):
```
id            uuid PK default gen_random_uuid()
canvas_id     uuid NOT NULL → canvases(id) ON DELETE CASCADE
workspace_id  uuid NOT NULL → workspaces(id) ON DELETE CASCADE               -- denormalized → flat RLS
node_key      text NOT NULL                                                  -- the canonical id: chat:${convId}, genui-panel:${msgId}:${part}, source:${ledgerId}, …
type          text NOT NULL                                                  -- one of the 13; unknown types round-trip via 'unknown-node-type'
position      jsonb NOT NULL                                                 -- {x,y}
width / height real                                                          -- optional (client omits; schema allows)
data          jsonb NOT NULL default '{}'                                    -- ref-only for 11 types; source/directory carry inline payload (03-doc §3.4)
created_at / updated_at timestamptz NOT NULL default now()

UNIQUE idx_canvas_nodes_key (canvas_id, node_key)                            -- idempotent per referenced object
INDEX  idx_canvas_nodes_canvas_id (canvas_id)
```

**`canvas_edges`**:
```
id            uuid PK
canvas_id     uuid NOT NULL → canvases(id) ON DELETE CASCADE
workspace_id  uuid NOT NULL → workspaces(id) ON DELETE CASCADE
edge_key      text NOT NULL                                                  -- the edge id
source_key    text NOT NULL                                                  -- = a node_key (NOT a hard FK: allows lazy-materialized / heal nodes)
target_key    text NOT NULL
data          jsonb NOT NULL default '{}'                                    -- {sourcePath, targetKey}
created_at    timestamptz NOT NULL default now()

UNIQUE idx_canvas_edges_key (canvas_id, edge_key)
INDEX  idx_canvas_edges_canvas_id (canvas_id)
```
Edges reference node **keys as text, not FKs** — deliberate: the restore path lazily materializes
nodes (genui panels from history) and heals unknown types, so a hard FK would reject valid edges to
not-yet-persisted nodes. App-enforced referential integrity, lower risk (03-doc §3.3, §6 item 3).

**RLS** (defense-in-depth only — Drizzle connects as superuser, FastAPI as service_role; both
bypass; the app boundary is primary — 04-doc §2). Mirror the **member-visibility** idiom
(`workspaces_member_authenticated`, `0047:74-83`) so a canvas is visible to every workspace member;
`canvas_nodes`/`canvas_edges` get a **flat** policy via their denormalized `workspace_id`:
```sql
CREATE POLICY "canvases_member_authenticated" ON "canvases"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()
     OR EXISTS (SELECT 1 FROM workspace_members m
                WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()))
  WITH CHECK (owner_user_id = auth.uid());
-- + RESTRICTIVE deny_all_*_anon on all three (0047 idiom); nodes/edges: EXISTS over workspace_members via workspace_id
```

**Ownership helper** — add `assertCanvasOwnership(db, canvasId, userId)` to `ownership.ts` on the
direct-`user_id` side (mirrors `assertDocumentOwnership`, `ownership.ts:229-244`), resolving via
`canvases.owner_user_id`. Descendant node/edge scoping resolves the ancestor canvas first (the same
pattern chat descendants use through `assertConversationOwnership`).

**Sharing (DEFERRED — not in the minimal promotion):** making a canvas shareable is additive and
out of scope now — add `'canvas'` to `sharedResourceTypeEnum` (`enums.ts:108-113`) + a branch in
`resolveResourceOwner` (`access-control.ts:158-196`) later, no churn to `resource_shares` itself
(04-doc §4.3). Keeping it out keeps blast radius small.

**[BUILD-IN-TREE + gate]** the three Drizzle table files + `0052_canvas_nodes.sql` (generated DDL +
hand-appended RLS/CHECK, house pattern per `0040`/`0047`) + `_journal.json`/snapshot (auto-written
by `db:generate`, do not hand-edit) + the ownership helper. Gate: `npm run db:generate` produces a
clean diff; the Track-2 ephemeral-Postgres CI job applies `0052` from scratch;
`packages/db` schema unit tests (mirror `workspaces-schema.test.ts`).
**[LIVE / PEDRO]** applying `0052` to staging/prod (files-only workflow, 04-doc §5.5).

### 3b.3 The persistence adapter + dual-write (D10)

Introduce a `CanvasStore` backend abstraction in `packages/api-client` with two implementations
behind the **unchanged** procedures (`getCanvasLayout`/`saveCanvasLayout`/`addCanvasNode`/…,
`canvas.ts`/`home-canvas.ts`/`canvas-mutations.ts`):
- **BlobStore** — today's `chat_canvas_layouts` upsert/read, byte-for-byte unchanged (the
  additive-never-clobber discipline of `canvas-mutations.ts:19-37` preserved).
- **RowStore** — reads/writes `canvases`/`canvas_nodes`/`canvas_edges`, reconstructing /
  decomposing a `CanvasSnapshotSchema` object at its boundary (so the wire contract is identical).

**Cutover phases**, each behind a `CANVAS_ROW_MODEL` mode flag (`off` | `dual_write` | `read_rows`),
reversible without a code redeploy:
1. **`off`** (default): BlobStore only — current behavior, zero change.
2. **`dual_write`**: writes go to **both** stores; the blob write is authoritative and its result
   is returned; the row write is **best-effort** (failure logged, never breaks the blob write or
   the request). Reads still come from the blob. This lets rows accumulate under real traffic with
   no user-visible risk.
3. **`read_rows`**: reads come from RowStore, writes stay dual. Flip per-surface if desired.

A **shadow-compare** test (and optional runtime assert in `dual_write`) reconstructs a snapshot from
rows and asserts logical equality with the blob for the same conversation — the parity gate before
any `read_rows` flip.

**[BUILD-IN-TREE + gate]** the `CanvasStore` abstraction + both impls + the mode flag +
shadow-compare test. Gate: `packages/api-client` vitest — (a) dual-write leaves the blob byte-identical
to the blob-only path, (b) RowStore round-trips every one of the 13 node types incl. `unknown-node-type`
heal and the two content-carrying types (`source`, `directory`), (c) reconstruction == blob under
shadow-compare, (d) caps + write-time gates still reject hostile input.

### 3b.4 The backfill (D10)

An **idempotent** migration procedure (a tRPC admin mutation or a `packages/db` script — *not* DDL
in the migration file, so it is reversible and Pedro-run): for each `chat_canvas_layouts` row,
- ensure an auto-created **"personal" workspace** for the owning user (via the existing
  `workspaces.create` seeding, `workspaces/index.ts:81-104`);
- create/upsert a `canvases` row (`kind='conversation'` keyed on `conversation_id`, or `kind='home'`
  keyed on `owner_user_id`), copying `viewport`/`shared_state`/`node_registry_version`;
- explode `nodes[]` → `canvas_nodes` (using each node's existing string id as `node_key`), `edges[]`
  → `canvas_edges`. Home rows carry empty nodes/edges with the arrangement in
  `shared_state["home.panels"]` (03-doc §4) — copied verbatim onto the canvas row.
Idempotent by upsert on `(canvas_id, node_key)` / `(conversation_id)` — safe to re-run. The blob is
**not deleted**; rows are derived from it, so a failed backfill drops rows and leaves the blob intact.

**[BUILD-IN-TREE + gate]** the backfill procedure + a test that backfills a fixture blob and asserts
the reconstructed snapshot equals the source. **[LIVE / PEDRO]** running it against staging/prod.

### 3b.5 The web-canvas cutover

The web client (`useCanvasPersistence`, `chat-canvas.tsx`, `home-board.tsx`, `transcript-panel-host.tsx`,
`use-send-to.ts` — 03-doc §2.5) **does not change** through phases 1–3 because it consumes the same
tRPC procedures with the same `CanvasSnapshotSchema`. The only web-visible change is the eventual
**`read_rows` flip**, which is invisible to React (same shape in). Optionally, moving to per-node
rows lets the agent path close the known whole-row LWW race (`canvas-mutations.ts:31-37`) — but that
is an enhancement to sequence *after* parity, not part of the cutover.

Because the canvas is **geometric**, jsdom proves nothing (CLAUDE.md "jsdom does no layout"). The
`read_rows` flip must be gated by the **real-browser** gates against an already-running server on
:3000: `npm run test:geometry` (layout asserts) + `npm run screenshot:review` (surfaces × viewports
× themes) — read the PNGs before calling it done.

**[BUILD-IN-TREE + gate]** no web code change for phases 1–3; the `read_rows` flip is gated by
`test:geometry` + `screenshot:review` + the api-client parity suite.
**[LIVE / PEDRO]** flipping `CANVAS_ROW_MODEL=read_rows` in prod (env only, reversible).

### 3b.6 3b build order

| Step | What | Tag |
|------|------|-----|
| B1 | 3 Drizzle tables + `0052_canvas_nodes.sql` (RLS/CHECK) + `assertCanvasOwnership` (§3b.2) | **[BUILD-IN-TREE]** db:generate clean + ephemeral-PG apply + schema tests |
| B2 | `CanvasStore` abstraction + BlobStore (extract today's path, no behavior change) (§3b.3) | **[BUILD-IN-TREE]** api-client vitest byte-identical |
| B3 | RowStore + snapshot ↔ rows reconstruct/decompose + shadow-compare test (§3b.3) | **[BUILD-IN-TREE]** 13-type round-trip + parity |
| B4 | `CANVAS_ROW_MODEL` flag wired into all procedures; default `off` (§3b.3) | **[BUILD-IN-TREE]** api-client tests per mode |
| B5 | Idempotent backfill procedure + fixture test (§3b.4) | **[BUILD-IN-TREE]** backfill == source test |
| B6 | Apply `0052` on staging/prod | **[LIVE / PEDRO]** files-only |
| B7 | Flip `CANVAS_ROW_MODEL=dual_write`; let rows accumulate; watch shadow-compare | **[LIVE / PEDRO]** env flip, reversible |
| B8 | Run backfill on staging/prod | **[LIVE / PEDRO]** idempotent, blob untouched |
| B9 | Flip `read_rows` per surface; gate on test:geometry + screenshot:review | **[LIVE / PEDRO]** env flip, reversible |
| B10 | (later) stop writing blob after N releases of parity; keep column for rollback | **[LIVE / PEDRO]** demote, never drop |

---

## 4. Whole-track ordering & the reversibility ledger

**3a and 3b are independent** and can proceed in parallel (3a is Python + Node + one wrapper
migration; 3b is Drizzle + api-client). The master plan sequences both before the feature fan-out
(§62–69). Within each, the in-tree steps (A1–A6, B1–B5) all land green with the live system
unchanged; the live flips (A7–A9, B6–B9) are each small, individually reversible, and gated:

- **Every live cutover is an env flag** (`INGEST_ENQUEUE_ENABLED`, `CANVAS_ROW_MODEL`) → revert
  without a redeploy.
- **The blob is never dropped**, only demoted → 3b is reversible at every step.
- **The enqueue path fails *safe*** (500 → SNS retries) rather than today's silent 200-loss.
- **The worker cannot kill mail** (`essential=false`, separate container).
- **The only Terraform apply** is the one `ecs.tf` secret+container diff (A8), and it is correctly
  **gated behind Track 1** (remote state + import) — nothing else in 3a/3b touches live infra.

## 5. The [LIVE / PEDRO / INFRA] set, consolidated

| Item | Why it can't be in-tree | Gate |
|------|-------------------------|------|
| Confirm `sb_secret_…` ⇒ `service_role`; `GRANT EXECUTE` suffices | needs live DB | Track 1 / live verify (02-doc §6) |
| Worker connection string (session-mode pooler; IPv4 reachability + LISTEN) | live VPC/pooler fact | **NEEDS-LIVE** (02-doc §3.4, 05-doc §4) |
| Pin exact graphile-worker version + min-Postgres | needs release notes | before pinning (02-doc §6) |
| `ecs.tf`: 2nd container + `GRAPHILE_WORKER_CONNECTION_STRING` secret + `iam.tf` + `variables.tf` | `terraform apply` | **Track 1** (state import) |
| Install graphile schema + `db:migrate 0051/0052` on staging/prod | files-only workflow | Pedro deploy step |
| Flip `INGEST_ENQUEUE_ENABLED`, `CANVAS_ROW_MODEL` | live behavior change | env flip, watch DLQ / pipeline_health / parity |
| Run the 3b backfill | live data | idempotent, blob untouched |
| (later) ALB/Fargate ingress teardown — the *cost* half | separate infra project | **Track 1**, later; not required for the reliability win (05-doc §5) |

---

## Appendix — key cites
- Enqueue seam / silent-loss handler: `sns_inbound.py:57-64`; `execute(ses_message_id, recipients)` `ingest_inbound_email.py:168`.
- Wrapper privilege/PostgREST walls: 02-doc §1.2–1.3. Schema-install hybrid: 02-doc §2.4.
- Worker↔Python HTTP seam + new endpoint: 02-doc §4.3; `require_api_key` `middleware/auth.py:16-27`; inbound-route pattern `inbound_email.py:16,60-69`.
- Co-location / Dockerfile Python-only: `Dockerfile:2,12,52`; Shapes A/B: 05-doc §2; constraint i: master plan §65.
- Retries/DLQ: 02-doc §4.1–4.2. `to_thread` targets: 01-doc §3.
- Canvas blob + 13 types + preserve-list: 03-doc §1, §3.4, §6. Tenancy primitives + RLS idioms + migration conventions: 04-doc §1, §4, §5. Next migration `0051` (latest `0050_purge_maritime_data.sql`).
- Scope guard (chat turn stays in-process): master plan §65, §173.
