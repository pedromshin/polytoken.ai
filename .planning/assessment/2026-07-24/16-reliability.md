# Reliability & Scalability — where polytoken breaks first, and worst

Assessment date: 2026-07-24 · Branch: `claude/polytoken-email-infra-cont-qi9q5g`
Scope: ingestion durability, request-tied generation, SPOFs, query scaling, CI-parallelism ceiling.
Every claim cites `file_path:line` in committed code.

## Bottom line

There is **no queue anywhere in the system today** (confirmed: `grep graphile-worker` → 0 hits in
`package-lock.json`; `grep -rn "create_task|BackgroundTasks|add_task"` over `apps/email-listener/app`
→ 0 hits). Every unit of durable work — inbound-email ingestion and every LLM generation — runs
**inline inside an HTTP request handler**, on a **single uvicorn worker** inside a **single ECS task**
(`prod_desired_count` default `1`, `infrastructure/aws/variables.tf:39`), talking to Postgres through a
**synchronous, event-loop-blocking** client. The chosen mitigation (graphile-worker, Task 5) exists only
on paper — it is not installed. The system works because it currently serves ~one user; it will break the
day it serves concurrent load, and the first thing it loses is **inbound email, silently and permanently.**

Breaks FIRST: SNS ingestion (silent email loss + event-loop starvation).
Breaks WORST: same path — lost mail is unrecoverable and invisible.

---

## Finding 1 — CRITICAL: SNS ingestion swallows every failure and returns 200 → silent, permanent email loss

`apps/email-listener/app/presentation/api/v1/sns_inbound.py` is the production mail entry point. Its
design contract (module docstring line 4) is **"Always returns HTTP 200 to prevent SNS retry storms."**
The entire ingestion pipeline runs inline inside that handler and is wrapped in a bare `except Exception`
that logs and returns 200 regardless:

```
sns_inbound.py:57-64
    try:
        use_case = await request.app.state.dishka_container.get(IngestInboundEmailUseCase)
        await use_case.execute(meta["message_id"], recipients=meta["recipients"])
    except Exception:
        logger.exception("email_ingest_error", message_id=meta["message_id"])
    return Response(status_code=status.HTTP_200_OK)
```

What `execute()` does synchronously before returning (`ingest_inbound_email.py:168-322`): fetch raw MIME
from S3 (`:170`), parse MIME (`:171`), several DB round-trips (`:184,:221`), then per-attachment OCR/parse
dispatch (`:238-250`, Textract for images/PDFs), region proposal (`:265`), entity-type suggestion
(`:277`, Bedrock), and ingest-time entity resolution (`:293`, Bedrock). That is multiple network hops and
**several LLM calls on the critical path of a webhook**.

The failure mode is not theoretical:
- If any hard failure occurs (S3 fetch, DB, DI misconfig), the `except` at `:62` swallows it, returns 200,
  and **SNS never redelivers** — the email is gone with only a log line.
- If the pipeline is merely *slow* (large PDF + several Bedrock calls), the SNS→ALB→FastAPI request can
  exceed the SNS delivery timeout / ALB idle timeout; SNS then sees a failed delivery and retries, but
  each retry **re-runs the full OCR+LLM pipeline** (idempotent on the DB row per the docstring, but not on
  compute or spend). Timeout + retry storm on the most expensive path in the system.

The internal isolation is thorough (`_finalize_parse_status`, `ingest_inbound_email.py:324-369`, records
`parse_status='failed'/'degraded'`) — but that only helps for emails that got *far enough to persist a
row*. A failure at `:170` (S3) or `:221` (first save) persists nothing and returns 200: the email leaves
no trace at all. **There is no DLQ, no retry marker, no outbox.** This is the single worst reliability
defect in the codebase.

Fix vector: this is exactly the durable-runtime work in Task 5. The SNS handler must do the minimum
durable write (enqueue `{message_id, recipients}` into a graphile-worker job / an inbox table) and return
200; the heavy pipeline runs off a worker with retries + a dead-letter after N attempts. Enqueue-then-200
keeps the anti-retry-storm property **while making loss impossible.**

---

## Finding 2 — CRITICAL: single event loop + blocking DB client → one slow email freezes the whole service

Three facts compound into a system-wide stall:

1. **One ECS task.** `prod_desired_count` defaults to `1` (`infrastructure/aws/variables.tf:36-40`);
   `deployment_minimum_healthy_percent = 100` (`infrastructure/aws/ecs.tf:113`). One task = one process =
   a hard SPOF and no horizontal headroom.
2. **One uvicorn worker.** `apps/email-listener/Dockerfile:52` launches
   `uvicorn app.main:app --host 0.0.0.0 --port 8000` with **no `--workers` flag** → a single event loop
   serves all traffic (SNS ingestion, chat SSE streams, web API reads).
3. **Synchronous DB client on the hot path.** `get_supabase_client()`
   (`infrastructure/supabase/client.py:19`) returns the **blocking** `supabase-py` client. The ingest-path
   repositories declare `async def` but call the sync client's `.execute()` **directly, with no
   `asyncio.to_thread`** — e.g. `email_repository.py:82-85` (`save`), `:88`, `:106-109`, and the
   `component_repository`/`attachment_repository`/`entity_instance_repository` families. Count:
   **139 `.execute()` calls in `infrastructure/supabase/*.py`, only 46 wrapped in `to_thread`** — and the
   ones that *are* wrapped are the chat repos, not the ingest repos.

Consequence: every DB call the ingest pipeline makes **blocks the single event loop**. Because ingestion
itself runs inline in a request (Finding 1) and includes Textract + Bedrock, a single inbound email with a
few PDF pages can hold the one worker's event loop for seconds — during which **every concurrent chat
stream stalls, every web API read stalls, and every other inbound SNS delivery stalls.** This is the
first place the system falls over under genuine multi-user load, and it degrades everything at once rather
than just the slow request. Fixing Finding 1 (move ingestion off the request) removes most of the blast
radius; wrapping the remaining ingest-path `.execute()` calls in `to_thread` (or moving to an async
Postgres driver) removes the rest.

---

## Finding 3 — HIGH: generation is request-tied; it survives a client disconnect but not a deploy or crash

The chat SSE path handles the *client*-disconnect case genuinely well: `stream_run_events`
(`chat_stream.py:132-166`) polls `request.is_disconnected()` every 100 ms and `task.cancel()`s the run so
`RunChatTurn`'s `except asyncio.CancelledError` persists the partial as `'stopped'`
(`chat_stream.py:136-145`). That is correct and worth keeping.

But the run **lives entirely in the FastAPI process.** There is no server-side job, so:
- An **ECS deploy replaces the single task** (desired_count=1 → the task *is* rolled) — any in-flight
  stream dies mid-generation with no resumption. With one task, every deploy is a guaranteed mid-flight
  kill for active users.
- A **process crash / OOM** loses the run outright; the SSE client just sees the socket drop.

`genui/generate` (`genui.py:180-212`) is worse than chat: it is **fully synchronous** — the dual-LLM
quarantine→generate pipeline with a repair loop (≤3) plus Sonnet escalation (docstring `:188-193`) all run
inside the request, and **nothing about the in-flight work is persisted**. A client disconnect there
doesn't cancel-and-save; it just abandons paid LLM work with no record. Same for `retheme` (`:220-248`).

This is the second half of the Task 5 argument: durable generation runs (a `chat_runs`/job row the worker
owns) so a deploy or crash resumes or cleanly re-drives, instead of silently dropping the user's turn.

---

## Finding 4 — HIGH: the chosen durable runtime (graphile-worker, Task 5) does not exist yet

`grep -rl graphile` over all non-vendored `package.json` → **no matches**; `grep -c graphile-worker
package-lock.json` → **0**. There is no worker process, no job table migration (latest migration is
`packages/db/migrations/0050_purge_maritime_data.sql`; nothing job-queue-shaped), and no enqueue call
site. Task 5 is a decision, not an implementation. Every risk in Findings 1–3 is therefore **fully
unmitigated in-tree today.** This is the highest-leverage single piece of work: it is the common fix for
the FIRST-breakage (ingestion loss) and the WORST-breakage (unrecoverable mail) simultaneously.

---

## Finding 5 — MEDIUM: bulk reprocess runs the full OCR+LLM pipeline inline and races the ALB idle timeout

`backfill_reprocess.py` re-runs the entire ingestion pipeline (OCR/segmentation/entity resolution) per
email, **synchronously inside the request**, batched at `email_ids ... max_length=25`
(`backfill_reprocess.py:36`). Its own docstring admits the design constraint: *"so a caller can pace
reprocessing … and stay under the ALB idle timeout"* (`:14-16`). This is a reliability trap: the endpoint
is one Textract/Bedrock hiccup away from exceeding the ALB idle timeout mid-batch, and because it runs on
the same single worker (Finding 2) a real backfill starves live traffic. This is the same
"heavy work belongs on a worker" story; once Task 5 lands, reprocess should enqueue N jobs and return
immediately.

---

## Finding 6 — MEDIUM: the visual-verification gate cannot parallelize — a CI throughput ceiling

`playwright.geometry.config.ts:48-49` and `playwright.screenshot.config.ts:23-24` hard-set
`fullyParallel: false, workers: 1`. This is **required, not incidental**: every test seeds a GoTrue
session for the *same* seed user, and minting a magic link invalidates prior tokens (documented at
`playwright.geometry.config.ts:33`), so the suite must run serially. Because CLAUDE.md makes
`screenshot:review` / `test:geometry` the mandatory gate for any visual work (jsdom proves nothing), the
gate's wall-clock is `surfaces × viewports × 2 themes`, serialized — it grows linearly and cannot be
sharded. Not a production risk, but a real scaling limit on the team's *ability to ship UI reliably*: as
surface count grows the gate becomes slow enough to be skipped, which is how visual regressions slip.
Mitigation is a design change (per-worker distinct seed users so `workers > 1` becomes safe), not a config
tweak.

---

## Finding 7 — LOW/MEDIUM: multi-importer email listing sorts outside its index; one unbounded internal path

The emails table is well-indexed for the single-importer case: composite
`idx_emails_importer_id_received_at` and `idx_emails_thread_id` (`packages/db/src/schema/emails.ts:80-86`).
But the cross-importer list path `list_by_importer_ids` uses
`.in_("importer_id", importer_ids).order("received_at", desc=True)`
(`email_repository.py:116-124`): an `IN` predicate plus an `ORDER BY received_at` that the
`(importer_id, received_at)` composite **cannot serve as a pre-sorted scan** — Postgres falls to a bitmap
heap scan + explicit sort. Fine at one-importer-per-user scale; degrades as importers-per-user grows.
Separately, `list_by_importer(None, …)` (`:105-110`) has an **unfiltered all-emails** branch ordered by
`received_at` (no standalone index on `received_at`); it is only reachable internally today (the HTTP
endpoint always scopes to owned importers, `emails.py:143-151`), but it is a latent full-table scan if any
future caller passes `None`. N+1 is *not* a problem in the list path — attachment counts are correctly
batched via `count_by_email_ids` (`emails.py:152`, `attachment_repository.py:57`).

---

## Prioritized plan (maps to Task 5)

1. **Land graphile-worker (Task 5) and move ingestion off the SNS request.** SNS handler does one durable
   enqueue + returns 200; worker runs S3/parse/OCR/LLM with retries + DLQ after N attempts. Kills Findings
   1, 4, and most of 2's blast radius. *Highest leverage in the entire assessment.*
2. **Move generation to durable runs.** Chat + genui runs become worker-owned rows so a deploy/crash
   resumes or re-drives instead of dropping the turn (Finding 3). Keep the existing client-disconnect
   `'stopped'` handling.
3. **Unblock the event loop:** wrap the remaining ingest-path `.execute()` calls in `to_thread` (or adopt
   an async PG driver) so no single request can freeze the worker (Finding 2). Cheap, independent of Task 5.
4. **Raise `prod_desired_count` to ≥2 and add worker replicas** once ingestion/generation are off-request,
   so the service stops being a single-task SPOF (Finding 2). Requires 1–3 first (multiple tasks all
   pulling the SNS-inline pipeline would multiply the blocking problem, not fix it).
5. **Convert reprocess + any backfill to enqueue-and-return** on the new worker (Finding 5).
6. **Later, lower priority:** per-worker seed users to lift the Playwright `workers:1` ceiling (Finding 6);
   revisit the cross-importer sort + close the `list_by_importer(None)` unbounded branch (Finding 7).

## Live-production landmines (Part C) intersecting this lane

- Renaming `nauta-services` infra is **out of scope** for all of the above — the queue/worker work touches
  application code and adds a job table; it does not require touching the S3 bucket / SNS topic / SES rule
  names. Keep "add durable runtime" and "rename infra" as separate tasks (landmine #1).
- Adding a worker service is a **new ECS task definition / process**, not a Terraform SES change — it does
  not go near the out-of-band `polytoken-ses-forwarder` Lambda or the personal-forward receipt rule
  (landmine #2). Do not fold worker rollout into a broad `terraform apply`.
