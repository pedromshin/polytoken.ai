# Track 3a scout — graphile-worker ↔ Python enqueuer integration & co-location

**Scope:** the crux design risk for Track 3a (durable runtime). A Node/Postgres job queue
(graphile-worker) has to be driven by a **Python** enqueuer and co-run with a **Python**
uvicorn pipeline, under the master-plan hard constraint that the worker **not** become a new
always-on Fargate service (`00-MASTER-PLAN.md:65`, constraint i).

**Read-only.** No live DB, no `terraform apply`, no prod connection. Every repo claim below is
`file:line`. Every graphile-worker claim is a cited doc/source URL. Items that need the live
stack to confirm are flagged **[NEEDS-LIVE]**.

---

## TL;DR — the six sharpest findings

1. **Python cannot call `graphile_worker.add_job` today, by two independent blocks.** The
   listener has **no Postgres connection at all** — `requirements.txt` pins `supabase>=2.15.0`
   and **no** `psycopg`/`asyncpg` (`apps/email-listener/requirements.txt:8`), and the only DB
   access is the PostgREST-over-HTTP supabase-py client (`.../supabase/client.py:14,35`). ECS
   injects only `SUPABASE_URL` + `SUPABASE_SECRET_KEY`, **no `POSTGRES_URL`**
   (`infrastructure/aws/ecs.tf:71-79`). Block 1: no connection. Block 2: even with the supabase
   client, **PostgREST only exposes the `public` schema**, so `graphile_worker.add_job` is
   unreachable via `.rpc()`. Both are solvable but neither is free.

2. **The enqueue seam that fits the existing architecture is a `public.enqueue_*` SECURITY
   DEFINER wrapper** that internally calls `graphile_worker.add_job`, `GRANT EXECUTE` to
   `service_role`, called from Python as `client.rpc("enqueue_ingest_job", {...})`. This reuses
   the existing supabase client + secret, needs **no new Python dependency, no new connection,
   no new secret**, and sidesteps the "add_job requires database owner privileges"
   restriction. The wrapper is *your* stable interface; graphile's internal schema stays the
   library's.

3. **Schema install: don't vendor graphile's internal schema.** graphile-worker installs/updates
   its own `graphile_worker` schema automatically on worker boot (and via `--schema-only` /
   `runMigrations()`), and the docs explicitly say the internal tables are **"not a public
   interface"** and shift between minor/major versions (`_private_jobs`, the v0.13→0.14 /
   v0.15→0.16 renames). Vendor **only** the tiny stable `public.enqueue_*` wrapper into
   `packages/db`; let the library own its volatile schema via an explicit one-shot migrate step.

4. **Co-location has a hidden runtime cost: the listener image is `python:3.11-slim` with no
   Node** (`apps/email-listener/Dockerfile:2,13`). A Node graphile-worker cannot ride along
   without adding a Node runtime + the worker's `node_modules` to the image. This is the real
   Dockerfile change, not a one-liner.

5. **The worker's own connection needs SESSION mode, not the transaction pooler** — graphile
   polls with `LISTEN/NOTIFY` and session state, which Supabase's transaction pooler (:6543,
   `prepare:false`) does not support. On Supabase the session-mode *direct* host is IPv6-only
   and Fargate egresses IPv4 (`packages/db/src/client.ts:34-42`), so the worker connection is a
   live-infra question, not a code question. **[NEEDS-LIVE]**

6. **The worker handler must call back into the Python pipeline over HTTP; it cannot
   reimplement it.** The pipeline is Python end-to-end (MIME parse, poppler/pdf2image OCR,
   multi-Bedrock, dishka DI, ~93 supabase writes). The honest design is: SNS handler enqueues
   `{message_id, recipients}` and returns 200; the Node worker POSTs those to a **new internal**
   `IngestInboundEmailUseCase` endpoint; non-2xx/timeout → handler throws → graphile retries.
   Durability comes from the **job row + retry + never-deleted-on-permafail**, *not* from moving
   compute out of Python. If the Node-runtime + cross-language seam is judged too costly,
   `procrastinate` (Python/Postgres, same design as graphile-worker) removes both — named as the
   honest fork even though the decision already picked graphile-worker.

---

## 0. What runs inline today (the thing being replaced)

`POST /v1/emails/inbound-sns` is the only live ingestion trigger. It runs the **entire** heavy
pipeline inside the HTTP handler and **always returns 200**, so any failure permanently loses
the email:

```python
# apps/email-listener/app/presentation/api/v1/sns_inbound.py:57-64
try:
    use_case: IngestInboundEmailUseCase = await request.app.state.dishka_container.get(
        IngestInboundEmailUseCase
    )
    await use_case.execute(meta["message_id"], recipients=meta["recipients"])
except Exception:
    logger.exception("email_ingest_error", message_id=meta["message_id"])
return Response(status_code=status.HTTP_200_OK)
```

Two facts that shape the whole design:

- **The durable unit of work is tiny to enqueue.** The handler already reduces the email to
  exactly `(message_id, recipients)` before running the pipeline (`sns_inbound.py:61`). That
  two-field tuple is the entire job payload. Everything heavy (`S3 fetch → MIME parse → OCR →
  Bedrock → ~93 supabase writes`) happens *inside* `IngestInboundEmailUseCase.execute`
  (`.../use_cases/ingest_inbound_email.py:168-322`), keyed idempotently by
  `(importer_id, message_id)` with deterministic attachment ids
  (`ingest_inbound_email.py:106-107,184,201`). **Idempotent-by-construction is the single
  biggest de-risker** — at-least-once delivery + graphile retries are safe against it.

- **The pipeline is Python and DI-wired.** It is resolved from the dishka container
  (`sns_inbound.py:58-60`, `main.py:85`) and depends on 12 injected ports
  (`ingest_inbound_email.py:134-166`). No part of this is portable to a Node handler without a
  full rewrite.

---

## 1. Enqueue API — `graphile_worker.add_job` and how Python reaches it

### 1.1 Exact function shape (from source, not prose)

From graphile-worker's own installed schema (`__tests__/schema.sql`, main branch):

```sql
CREATE FUNCTION graphile_worker.add_job(
  identifier   text,
  payload      json        DEFAULT NULL::json,
  queue_name   text        DEFAULT NULL::text,
  run_at       timestamptz DEFAULT NULL::timestamptz,
  max_attempts integer     DEFAULT NULL::integer,
  job_key      text        DEFAULT NULL::text,
  priority     integer     DEFAULT NULL::integer,
  flags        text[]      DEFAULT NULL::text[],
  job_key_mode text        DEFAULT 'replace'::text
) RETURNS graphile_worker._private_jobs
```
Source: https://github.com/graphile/worker/blob/main/__tests__/schema.sql ,
https://worker.graphile.org/docs/sql-add-job

`identifier` is the task name (maps to a handler key in the worker's `taskList`); `payload` is a
JSON object (or array for batch). Example call with a JSON payload:

```sql
SELECT graphile_worker.add_job(
  'ingest_inbound_email',
  json_build_object('message_id', $1, 'recipients', $2::json)
);
```
Source: https://worker.graphile.org/docs/sql-add-job (examples section).

A bulk variant `graphile_worker.add_jobs(specs graphile_worker.job_spec[], ...)` exists (useful
for the backfill fan-out — see §4.4). Source: `__tests__/schema.sql` (same URL).

### 1.2 The privilege wall

> "`graphile_worker.add_job(...)` **requires database owner privileges to execute**." … "wrap it
> inside a PostgreSQL function marked as `SECURITY DEFINER` so that it will run with the same
> privileges as the more powerful user that defined it. Be sure that this function performs any
> access checks that are necessary."
> — https://worker.graphile.org/docs/sql-add-job

On Supabase, the supabase-py client authenticates as **`service_role`** (the `sb_secret_...`
key, `client.py:26-35`, injected from Secrets Manager `ecs.tf:83-85`). `service_role` is **not**
the database owner. So a raw `SELECT graphile_worker.add_job(...)` as `service_role` fails on
privilege — the SECURITY DEFINER wrapper is mandatory, not optional, for the supabase-py path.

### 1.3 The PostgREST wall — why the wrapper must live in `public`

Supabase's PostgREST exposes **only the `public` schema** (plus any explicitly added to
`db-schemas`). Anything in the `graphile_worker` schema is invisible to `.rpc()`:

> "Currently, PostgREST only exposes tables/functions/views in the public schema, so creating a
> new schema will hide it from the public PostgREST API."
> — https://github.com/orgs/supabase/discussions/3269 (and Supabase API docs,
> https://supabase.com/docs/guides/api/securing-your-api)

Therefore the wrapper is defined **in `public`**, owned by the `postgres` role (so SECURITY
DEFINER runs with owner rights and can call `graphile_worker.add_job`), with EXECUTE granted to
`service_role`:

```sql
-- lives in packages/db as a normal migration (files-only; applied as postgres owner)
CREATE OR REPLACE FUNCTION public.enqueue_ingest_job(
  p_message_id text,
  p_recipients json
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, graphile_worker
AS $$
  SELECT (graphile_worker.add_job(
    'ingest_inbound_email',
    json_build_object('message_id', p_message_id, 'recipients', p_recipients),
    max_attempts := 8            -- see §4.1: shorter than the default 25 for a poison email
  )).id;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_ingest_job(text, json) TO service_role;
```

Python (reuses the existing cached client, zero new deps):

```python
# reuses app/infrastructure/supabase/client.py get_supabase_client()
supabase.rpc("enqueue_ingest_job", {
    "p_message_id": meta["message_id"],
    "p_recipients": meta["recipients"],
}).execute()
```

**Cost of this path:** one extra PostgREST HTTP round-trip on the SNS hot path (sub-millisecond
DB work behind it). Acceptable — the SNS handler currently does *seconds* of inline pipeline;
replacing that with one enqueue RPC is the whole point.

**[NEEDS-LIVE]** the exact role that the `sb_secret_...` key maps to (assumed `service_role`)
and that `GRANT EXECUTE … TO service_role` is sufficient — verify against the live DB, do not
apply blind.

### 1.4 The alternative Python path (direct SQL) — why it is worse here

Path B = add `psycopg`/`asyncpg` + a Postgres URL to the listener and run
`SELECT graphile_worker.add_job(...)` directly. It removes the wrapper (connect as the `postgres`
owner → privilege satisfied) but adds four liabilities:

- a **new runtime dependency** and a **new connection pool** to manage inside the async app
  (today there is none — all DB is HTTP);
- a **new ECS secret** (`POSTGRES_URL...`) where none exists (`ecs.tf:71-85`);
- the Supabase **direct host is IPv6-only** and Fargate egresses IPv4 (`client.ts:34-42`), so
  the enqueue would have to go through the **transaction pooler** (:6543, `prepare:false`,
  `client.ts:105-115`) — fine for a one-statement `add_job`, but it means the enqueue and the
  *worker's* connection have different requirements (§3.4);
- it couples the listener to the volatile `graphile_worker` schema name.

**Recommendation: Path A (public SECURITY DEFINER wrapper via supabase-py).** It is the only
option that adds zero new infra to the Python side.

---

## 2. Schema install — three options, one recommendation

### 2.1 How graphile installs its schema

graphile-worker manages the `graphile_worker` schema itself. It **auto-migrates on worker boot**,
and also exposes install-then-exit entry points:

- CLI `--schema-only` — "Install/upgrade the schema then exit without running jobs."
  (https://worker.graphile.org/docs/cli , https://worker.graphile.org/docs/cli/run)
- Library `runMigrations(options)` — "Equivalent to running the CLI with the --schema-only
  option. Runs the migrations and then resolves." / `WorkerUtils.migrate()`.
  (https://worker.graphile.org/docs/library/run ,
  https://deepwiki.com/graphile/worker/3.2-migrations)
- "When Graphile Worker starts, it automatically handles database migrations to ensure the
  schema is up-to-date." (https://deepwiki.com/graphile/worker/2-getting-started)

Installing the schema does `CREATE SCHEMA` + `CREATE FUNCTION` etc. → needs a **superuser / owner
connection**. In this repo that is exactly the connection `packages/db/src/migrate.ts` already
uses: `POSTGRES_URL_NON_POOLING` as the `postgres` role (`migrate.ts:10-15,65`).

The docs are emphatic that the internal schema is not yours to depend on:

> "Do not use the various tables (`_private_jobs`, `_private_job_queues`, `_private_known_crontabs`,
> `_private_tasks`, `migrations`) directly." … the jobs table was restructured across the
> "v0.13 ➡️ v0.14 or v0.15 ➡️ v0.16 big shifts."
> — https://worker.graphile.org/docs/schema

### 2.2 Option (a) — let the Node worker's boot create it

Simplest: the worker runs migrations on first boot. **But** the Python enqueuer (or the
`public.enqueue_ingest_job` wrapper, which references `graphile_worker.add_job`) will **fail if
it runs before the worker has ever booted**. On a fresh deploy that is a real ordering race, and
worse under the scheduled-task shape (§3.3) where the worker is *not* always resident. Also the
worker's connection must then have owner rights just to migrate.

### 2.3 Option (b) — vendor graphile's migration SQL into `packages/db`

Deterministic: the schema exists before any enqueue, applied by the existing files-only migrate
path as `postgres`. **But** you now own SQL the library explicitly says will change between
versions, and you must hand-sync it on every graphile-worker upgrade (the `_private_jobs` rename
is the cautionary tale). This trades a boot-order race for a permanent maintenance tax on
volatile internals. Not recommended.

### 2.4 Recommended — hybrid: library owns its schema, you own the seam

1. **Install graphile's schema with an explicit one-shot** `--schema-only` /
   `runMigrations()` step, run as the `postgres` owner over `POSTGRES_URL_NON_POOLING` — wired
   into the deploy/migrate sequence (a CI migrate job or a container init step), **decoupled**
   from the always-on/scheduled worker so there is no first-boot race. Do **not** vendor it.
2. **Vendor only the stable `public.enqueue_*` wrapper + GRANT** (§1.3) into `packages/db` as a
   normal Drizzle migration file. This is *your* interface: tiny, stable, safe to own, and it is
   where the master-plan "migrations are files only, nobody applies to prod in this workflow"
   rule keeps working.
3. **Sequence matters:** step 1 must run before step 2 (the wrapper references
   `graphile_worker.add_job`). Encode that ordering explicitly; the wrapper migration should
   fail loudly if the `graphile_worker` schema is absent.

This keeps the volatile internal schema owned by the library and the durable seam owned by you —
the same separation the codebase already applies to the capability registry (one declaration,
stable surface).

---

## 3. Co-location — worker in the listener container / scheduled task

Constraint i (`00-MASTER-PLAN.md:65`): the worker **must** live in the existing listener
container **or a scheduled task** — **not** a new always-on Fargate service (a second always-on
service doubles the ~$34/mo fixed compute and "adds constant Supabase poll load").

### 3.1 The runtime gap nobody has priced

The listener image is **Python-only**:

```dockerfile
# apps/email-listener/Dockerfile
FROM python:3.11-slim AS builder      # :2
...
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]   # final line
```

There is **no Node runtime and no `node_modules`** in this image. graphile-worker is a Node
package (`npm install --save graphile-worker`, https://worker.graphile.org/docs/cli). Co-locating
it means **adding Node to the image** — a multi-stage copy of the Node binary + the worker's
`node_modules` + a small `worker.js`, or a combined base. This is the actual, non-trivial
Dockerfile change. (The repo *does* have Node tooling elsewhere — `apps/daemon` is a `tsx`
workspace, `apps/daemon/package.json:6` — so the pattern exists, just not in this image.)

### 3.2 Option 1 — supervisor / two processes in the one container (always-on)

Run `uvicorn` **and** `node worker.js` in the same task under a tiny supervisor (supervisord, or
an entrypoint that backgrounds both, or `honcho`). Both always resident.

- **Pros:** literally satisfies "in the existing container"; lowest ingestion latency (worker is
  always polling); the worker→pipeline call is a `localhost:8000` hop (§4.3); one task, no new
  always-on compute.
- **Cons:** two runtimes (Python + Node) in one image; the container's single-responsibility
  blurs; you need a supervisor to restart either process on crash; the ECS healthcheck
  (`Dockerfile` HEALTHCHECK → `/health`) covers only uvicorn, so a dead worker is invisible
  unless you add a check; **the always-on worker is the "constant Supabase poll load" the master
  plan warns about.**

Dockerfile sketch:
```dockerfile
# add a node stage
FROM node:20-slim AS node_worker
WORKDIR /worker
COPY apps/email-listener/worker/package*.json ./
RUN npm ci --omit=dev            # installs graphile-worker
COPY apps/email-listener/worker/ ./

# in the runtime stage, bring node + the worker in
COPY --from=node_worker /usr/local/bin/node /usr/local/bin/node
COPY --from=node_worker /worker /worker
# replace CMD with a supervisor that runs both uvicorn and `node /worker/worker.js`
```

### 3.3 Option 2 — scheduled `--once` RunTask on the SAME image (recommended fit)

EventBridge Scheduler → ECS `RunTask` on a cron (e.g. every 1–5 min), command-override running
`graphile-worker --once` ("Run all available jobs then exit", https://worker.graphile.org/docs/cli/run
). No second always-on service; you pay only per drain.

- **Pros:** matches constraint i's explicit "**or a scheduled task**" clause and the cost lane's
  event-driven-ingress framing (`00-MASTER-PLAN.md:169`); **no constant poll** — the worker only
  connects when it runs; drains the backlog then exits.
- **Cons:** ingestion latency up to the cron interval (EventBridge min granularity 1 min); a Node
  cold start per run; and the re-entry seam is harder — the ephemeral task has **no uvicorn**, so
  its HTTP call-back (§4.3) must target the always-on listener service (internal DNS/ALB), not
  `localhost`, OR the ephemeral task must also boot uvicorn. This coupling is the price of the
  cheaper shape.

### 3.4 The worker connection landmine (applies to both options)

graphile's *worker* (not the enqueue) needs `LISTEN/NOTIFY` and session state to pick jobs
promptly. Supabase's **transaction pooler (:6543, `prepare:false`) does not support LISTEN/NOTIFY
or session state** — that is the pooler the web app is forced onto (`client.ts:44-52,105-115`).
So the worker must use a **session-mode** connection (direct :5432 or Supavisor session pooler).
On Supabase the *direct* session host is **IPv6-only**, and Fargate egresses IPv4
(`client.ts:34-42` documents exactly this class of failure for Vercel). Net: **the worker's
connection string is a live-infra decision** — likely the Supavisor **session** pooler, but the
reachability from this VPC is unverified. **[NEEDS-LIVE]** Do not assume the web app's
`POSTGRES_URL` (transaction pooler) will work for the worker — it will not for LISTEN.

Set the worker connection via `-c` / `DATABASE_URL` / `GRAPHILE_WORKER_CONNECTION_STRING`
(https://worker.graphile.org/docs/cli) as a **new ECS secret** — separate from anything the
Python app has today.

### 3.5 Recommendation

If ingestion within ~1 minute is acceptable, **Option 2 (scheduled `--once`, same image)** is the
best fit: it is the only shape that both satisfies constraint i literally *and* delivers the cost
lane's "remove the always-on inline pipeline" win without a new always-on poller. Accept the
per-run cold start and solve the re-entry target (call the always-on listener service, §4.3).
If near-real-time ingestion is required, fall back to **Option 1 (supervisor)** and accept the
constant poll. This is Pedro's Decision 5 (`00-MASTER-PLAN.md:185`).

---

## 4. Retries, dead-letter, and the worker↔Python seam (the big question)

### 4.1 Retries + backoff (from source)

- **Default `max_attempts = 25`**, on the job row itself:
  `max_attempts smallint DEFAULT 25 NOT NULL` (`__tests__/schema.sql`,
  https://github.com/graphile/worker/blob/main/__tests__/schema.sql).
- On a thrown handler error the job "is failed and scheduled for retries with exponential
  back-off" (https://worker.graphile.org/docs/error-handling), incrementing `attempts` and
  storing the message in `last_error`.
- **Backoff formula:** `exp(least(10, attempt)) * interval '1 second'`
  (https://worker.graphile.org/docs/exponential-backoff). The `least(10, …)` caps the base at
  `exp(10) ≈ 22026s ≈ 6.1h` between late attempts; 25 attempts span **days**.
- **Design note:** for ingestion, override `max_attempts` **down** (e.g. 5–8) in the enqueue
  wrapper (§1.3) so a genuinely poison email dead-letters in hours, not days. A permanent parse
  failure retried 25× over a week is pure waste and delays the operator seeing it.

### 4.2 Dead-letter — there is no DLQ table; the mechanism is a generated column

graphile has **no separate dead-letter table**. Successful jobs are **deleted** from the queue;
failed jobs are retried; a job that exhausts `max_attempts` **stays in `_private_jobs`
permanently** with its `last_error` populated. The gate is a stored generated column:

```sql
-- __tests__/schema.sql
is_available boolean GENERATED ALWAYS AS
  (((locked_at IS NULL) AND (attempts < max_attempts))) STORED NOT NULL
```
Source: https://github.com/graphile/worker/blob/main/__tests__/schema.sql

Once `attempts = max_attempts`, `is_available` flips **false** forever → the row is never picked
again and is never auto-deleted. **That surviving row *is* the dead-letter record.** Confirmed by
the docs: successful jobs are deleted; permanently failed jobs "remain in the table until
explicitly deleted using administrative functions" (https://worker.graphile.org/docs/cli/run,
https://deepwiki.com/graphile/worker/2-getting-started).

**Monitoring / re-drive surface** — via the public `graphile_worker.jobs` VIEW (the sanctioned
read interface, not the private table):
```sql
-- the "DLQ": permanently failed, not locked
SELECT id, task_identifier, attempts, max_attempts, last_error, run_at
FROM graphile_worker.jobs
WHERE attempts >= max_attempts AND locked_at IS NULL;
```
Admin functions to operate it (https://worker.graphile.org/docs/admin-functions):
- `graphile_worker.reschedule_jobs(ARRAY[…], run_at := …, attempts := 0, max_attempts := …)` —
  **re-drive** a fixed email (reset attempts, re-arm).
- `graphile_worker.permanently_fail_jobs(ARRAY[…], 'reason')` — force-dead-letter (sets
  `attempts = max_attempts`).
- `graphile_worker.complete_jobs(ARRAY[…])` — mark done without running.
- cleanup task `DELETE_PERMAFAILED_JOBS` — "Deletes any unlocked jobs that will never be
  reattempted" (purge the DLQ).

**Seam wrinkle for the operator UI:** the `jobs` view and admin functions live in the
`graphile_worker` schema → **not PostgREST-exposed** (§1.3), so a DLQ dashboard cannot read them
via supabase-py. **But the web app already has a direct `postgres`-role connection**
(`packages/db/src/client.ts`), so build the DLQ read/re-drive view in the **web/tRPC layer
reading `graphile_worker.jobs` directly**, not through the Python listener. This is the natural
home and avoids another public wrapper.

### 4.3 The worker handler: HTTP re-entry into Python (not a Node reimplementation)

graphile task handlers are **Node** async functions `(payload, helpers) => {...}` keyed by
identifier (https://worker.graphile.org/docs/library/run). The heavy pipeline is **Python**
(`ingest_inbound_email.py`, dishka DI, poppler/pdf2image OCR via
`Dockerfile:...poppler-utils`, Bedrock, ~93 supabase writes). **Reimplementing it in Node is off
the table** — it would discard the entire Clean-Architecture listener.

So the Node handler must **call back into the Python app**. Recommended shape:

```
SNS → sns_inbound (enqueue {message_id, recipients} via public.enqueue_ingest_job) → 200
                                   │  (durable job row now owns the work)
graphile worker (Node) picks job ─┘
   handler: POST http://<listener>/v1/emails/ingest-job  {message_id, recipients}
            headers: X-API-Key: <API_KEY>            # existing container secret
   ├─ 2xx → handler returns → job deleted (success)
   └─ non-2xx / timeout / network → handler THROWS → graphile retries w/ backoff (§4.1)
```

Requirements this imposes:

1. **A NEW internal endpoint is needed.** No existing route runs `IngestInboundEmailUseCase`
   from a bare `{message_id, recipients}`: `/inbound` takes a full JSON email
   (`inbound_email.py:60-69`), `/backfill` takes raw MIME base64 (`backfill_email.py:62-103`),
   and `/inbound-sns` runs it **inline** (`sns_inbound.py:57-64`). The new endpoint is
   essentially the `sns_inbound.py` try-block lifted into an authenticated route that just calls
   `use_case.execute(message_id, recipients=recipients)` — and, unlike the SNS handler, it
   **returns non-2xx on failure** so graphile can see it and retry.
2. **Auth is already available:** guard the new endpoint with the existing `require_api_key`
   dependency (`middleware/auth.py:16-27`, pattern per `inbound_email.py:16`). `API_KEY` is
   already a container secret (`ecs.tf:82-83`), so the localhost worker can present it. (Watch
   the fail-open branch `auth.py:20-22` — empty key in `development` disables auth; irrelevant in
   prod, flagged by the master plan Track 4.)
3. **Timeout budget:** this internal endpoint must allow the pipeline's real duration
   (seconds→minutes for OCR+Bedrock). It must **not** sit behind the 30-ish-second public ALB
   idle timeout that already forces the backfill path to batch at 25 (`00-MASTER-PLAN.md:95`).
   In Option 1 (same container) the call is `localhost` and bypasses the ALB entirely — a real
   advantage. In Option 2 (scheduled task) the call crosses to the listener service and must use
   an internal path with a long timeout, not the public ALB listener.
4. **Idempotency makes the retries safe:** `IngestInboundEmailUseCase` upserts by
   `(importer_id, message_id)` with deterministic ids (`ingest_inbound_email.py:106-107,184,201`),
   so at-least-once delivery + retry cannot double-insert. This is why the seam is acceptable.

### 4.4 Honest appraisal of the seam

The uncomfortable truth: enqueue → worker → **HTTP re-entry** puts the heavy pipeline **back
inside an in-process HTTP handler** — superficially the very thing durability was meant to move
off the request path. The win is real but it is **not** "compute moved out of Python." The win
is:

- the SNS webhook now returns in ~1 RPC instead of running the pipeline (SNS retry storms gone);
- the **job row is the durable record** — a crash mid-pipeline leaves the job locked; the lock
  expires; graphile re-drives it, instead of the email being **silently lost forever** as today
  (`sns_inbound.py:62-64`);
- retries + backoff + a permanent DLQ record replace the current bare `except: return 200`.

So: **graphile-worker supplies a durable queue + retry + dead-letter *around* the unchanged
Python pipeline; it does not replace the pipeline.** State this plainly to the downstream
designer so nobody expects the pipeline to migrate to Node.

**The fork worth naming (Decision-shaped):** if the Node runtime in the image (§3.1) + the
cross-language HTTP seam are judged too costly, **`procrastinate`** is the Python/Postgres job
queue with the same architecture as graphile-worker (Postgres-backed, `LISTEN/NOTIFY`,
`add_job`-style enqueue, retries/backoff). Choosing it would: keep the image Python-only, let the
worker `import` and run `IngestInboundEmailUseCase` **in-process with no HTTP hop**, and reuse the
same dishka container — eliminating both the runtime gap and the re-entry seam. The master plan
already selected graphile-worker (repo Task #7, `00-MASTER-PLAN.md:63-65`); this doc's job is to
be honest that the two hardest costs here (Node-in-image, cross-language callback) are **created
by that choice** and would not exist with the Python-native analog. If graphile-worker is kept
(e.g. to share one queue with future Node/`apps/web` producers), those two costs are the price.

---

## 5. Recommended end-to-end architecture (for the downstream designer)

1. **Enqueue:** `sns_inbound.py` replaces the inline `use_case.execute(...)` (`:57-64`) with a
   single `supabase.rpc("enqueue_ingest_job", {message_id, recipients})` and returns 200. (Keep
   the `SubscriptionConfirmation` branch as-is; Track 4 S1 hardens SNS signature verification
   separately.)
2. **Seam function:** `public.enqueue_ingest_job(text, json)` — SECURITY DEFINER, owned by
   `postgres`, `GRANT EXECUTE … TO service_role`, body calls `graphile_worker.add_job(...)` with
   `max_attempts := 8`. Vendored as a `packages/db` migration (files-only).
3. **graphile schema:** installed by an explicit one-shot `runMigrations()` / `--schema-only`
   step as `postgres` over `POSTGRES_URL_NON_POOLING`, sequenced **before** the wrapper migration.
   Not vendored.
4. **Worker:** Node `graphile-worker` with `taskList = { ingest_inbound_email: handler }`, where
   the handler POSTs `{message_id, recipients}` + `X-API-Key` to a **new internal**
   `/v1/emails/ingest-job` route and throws on non-2xx. Connection = a **session-mode** Supabase
   URL (new ECS secret) — **[NEEDS-LIVE]** which pooler.
5. **Co-location:** default to **Option 2** (EventBridge → `RunTask` `graphile-worker --once` on
   the existing image with a Node stage added); fall back to **Option 1** (supervisor,
   uvicorn + node in one task) if sub-minute latency is required.
6. **New Python endpoint:** `POST /v1/emails/ingest-job`, `require_api_key`, calls
   `IngestInboundEmailUseCase.execute(message_id, recipients=...)`, **returns 5xx on failure**
   (so graphile retries), long timeout, off the public-ALB idle-timeout path.
7. **DLQ ops:** built in **web/tRPC** reading `graphile_worker.jobs` over the existing direct
   `postgres` connection; re-drive via `reschedule_jobs`, purge via `DELETE_PERMAFAILED_JOBS`.
8. **Scope guard (master plan):** durability wraps **ingestion + deep_research only**; the
   interactive chat turn stays in-process (`00-MASTER-PLAN.md:65,173`). Do not enqueue the chat
   turn.

---

## 6. What cannot be verified without the live stack

- **[NEEDS-LIVE]** the DB role the `sb_secret_...` key maps to (assumed `service_role`) and that
  `GRANT EXECUTE … TO service_role` on the public wrapper is sufficient.
- **[NEEDS-LIVE]** which Supabase connection the **worker** can actually use for `LISTEN/NOTIFY`
  from Fargate (IPv4) — direct :5432 is IPv6-only (`client.ts:34-42`); the Supavisor **session**
  pooler is the likely answer but its VPC reachability + LISTEN support must be confirmed. The
  transaction pooler (:6543) will **not** work for the worker.
- **[NEEDS-LIVE]** exact graphile-worker version to pin and its minimum Postgres version
  (v0.16-era needs modern Postgres; Supabase 15+ satisfies it, but pin explicitly). The
  `getting-started` doc page 404'd at fetch time; confirm min-version against the release notes
  (https://worker.graphile.org/releases) before pinning.
- **[NEEDS-LIVE]** whether the ECS task role / execution role can be granted the new
  `POSTGRES/GRAPHILE_WORKER_CONNECTION_STRING` secret, and whether EventBridge Scheduler →
  `RunTask` (Option 2) is permitted by the account's IAM — all gated behind Track 1 (Terraform
  remote state) before any `apply`.
- Latency of `graphile-worker --once` cold start on the listener image (Node stage size) —
  measurable only once the image exists.

---

## Sources

- add_job SQL API + privileges + SECURITY DEFINER: https://worker.graphile.org/docs/sql-add-job
- Installed schema (function sig, `_private_jobs` columns, `is_available`, `jobs` view, `add_jobs`):
  https://github.com/graphile/worker/blob/main/__tests__/schema.sql
- Schema is not a public interface / version renames: https://worker.graphile.org/docs/schema
- Migrations / auto-migrate on boot / `--schema-only` / `runMigrations`:
  https://worker.graphile.org/docs/library/run , https://deepwiki.com/graphile/worker/3.2-migrations ,
  https://deepwiki.com/graphile/worker/2-getting-started
- CLI (`-c`, `DATABASE_URL`, `GRAPHILE_WORKER_CONNECTION_STRING`, `--once`, `--schema-only`,
  `--schema`, `--crontab`): https://worker.graphile.org/docs/cli , https://worker.graphile.org/docs/cli/run
- Error handling / retries: https://worker.graphile.org/docs/error-handling
- Exponential backoff formula: https://worker.graphile.org/docs/exponential-backoff
- Admin functions (reschedule/permanently_fail/complete/cleanup): https://worker.graphile.org/docs/admin-functions
- PostgREST exposes only `public`: https://github.com/orgs/supabase/discussions/3269 ,
  https://supabase.com/docs/guides/api/securing-your-api
- npm package: https://www.npmjs.com/package/graphile-worker
