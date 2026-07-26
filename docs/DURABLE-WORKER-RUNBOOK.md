# Durable email-ingest worker — provisioning + cutover runbook (Track 3a)

**Status: CODE ON `main`, NOT YET PROVISIONED.** The worker (`apps/worker`) and the
listener's enqueue path (`INGEST_ENQUEUE_ENABLED` in `sns_inbound.py`) are already merged.
This doc is the **provisioning + cutover procedure** — install the queue schema, apply the
enqueue migrations, deploy the worker container, then flip one flag — plus rollback. It ships
**no code**.

> Canonical local-stack doc is `docs/RUN-LOCAL.md`; prod-deploy patterns live in
> `docs/DEPLOY.md`. This doc governs the one-time **Track 3a cutover** and defers to both.

Each step is marked **[safe/anyone]** (a files-only or read-only action any operator can run)
or **[PEDRO — needs AWS/DB creds]** (touches live infra, prod DB, or the SES pipeline).

---

## 1. What this is / why

Inbound mail arrives as an SNS `Notification` to `POST /v1/emails/inbound-sns`. Today (flag
OFF) that handler runs the **entire** heavy pipeline — S3 fetch → MIME parse → OCR → Bedrock
enrichment — **inline**, then returns 200. Two failure modes fall out of that:

- **SNS's ~15s HTTP-delivery timeout.** A heavy PDF email enriches for *minutes* (hundreds of
  Bedrock calls). SNS gives up at ~15s and **retries**, re-running the full enrichment 2–3× per
  email → **duplicate Bedrock spend** + retry storms, while the UI sits at `received`.
- **Silent loss.** The receiver returns 200 on any inline failure (CLAUDE.md landmine), so a
  pre-persist failure permanently loses the mail — SNS never retries a 200.

**The fix (Track 3a):** the SNS receiver stops doing the work. On a `Notification` it enqueues
a durable **pointer** job (`{ses_message_id, recipients}` — the MIME is already durable in S3)
and returns fast; a *failed enqueue* returns **500** so SNS retries (no silent loss). A
co-located **graphile-worker** (`apps/worker`) drains the queue and re-enters the *unchanged*
Python pipeline over localhost. graphile-worker wraps that pipeline in **durable retries +
permanent dead-letter**: a non-2xx from the pipeline throws → the job retries up to
`max_attempts` (default 8), then becomes a dead-letter row instead of vanishing.

Nothing about the pipeline logic changes. The queue is bolted *around* it; the job row is the
durable record.

### The moving parts (all on `main`)

| Piece | Path | Role |
|-------|------|------|
| Worker entrypoint | `apps/worker/src/index.ts` | `run()` graphile-worker; LISTENs + drains |
| Task handlers | `apps/worker/src/tasks.ts` | `ingest_inbound_email` → `POST /v1/emails/ingest-job`; morning-board tasks |
| Schema installer | `apps/worker/src/install-schema.ts` | one-shot `makeWorkerUtils().migrate()` |
| Enqueue seam (port) | `apps/email-listener/app/domain/ports/job_enqueuer.py` | `JobEnqueuer` protocol |
| Enqueue adapter | `apps/email-listener/app/infrastructure/jobs/supabase_job_enqueuer.py` | calls `public.enqueue_job` RPC on the `service_role` client |
| Enqueue DI | `apps/email-listener/app/composition/job_providers.py` | binds port → adapter |
| Cutover call site | `apps/email-listener/app/presentation/api/v1/sns_inbound.py` | `INGEST_ENQUEUE_ENABLED` branch |
| Worker re-entry route | `apps/email-listener/app/presentation/api/v1/ingest_job.py` | `POST /v1/emails/ingest-job` (5xx-on-failure, no swallow) |
| Enqueue SQL wrapper | `packages/db/migrations/0053_graphile_enqueue_wrapper.sql` | `public.enqueue_job` allowlist |
| Allowlist widen | `packages/db/migrations/0054_enqueue_allowlist_morning_board.sql` | adds morning-board identifiers |

---

## 2. Prerequisites — worker env

Derived from `apps/worker/src/index.ts`, `install-schema.ts`, and `tasks.ts`. **No new
secrets are invented** — every value already exists for the listener or the DB tooling.

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `GRAPHILE_WORKER_CONNECTION_STRING` | one of these two | — | Session-mode Postgres URL for the worker's LISTEN/NOTIFY loop |
| `POSTGRES_URL_NON_POOLING` | ↑ fallback | — | Reused if the first is unset (same URL `packages/db/src/migrate.ts` uses) |
| `API_KEY` | **yes** | `""` | Sent as `x-api-key` to reach the guarded internal route; **already a listener container secret** (`ecs.tf` `API_KEY` / `each.value.api_key_arn`) |
| `LISTENER_INTERNAL_URL` | no | `http://localhost:8000` | Co-located listener base URL (shared `awsvpc` netns → localhost) |
| `WORKER_CONCURRENCY` | no | `3` | Parallel jobs (guarded parse: empty/NaN/≤0 → default) |
| `WORKER_POLL_INTERVAL_MS` | no | `2000` | Poll interval when NOTIFY is idle |
| `MORNING_BOARD_ENABLED` | no | unset (OFF) | Gates the in-process `0 5 * * *` crontab **only**; the ingest path ignores it |

Key point: the worker needs a **session-mode** (non-pooled/direct) connection — LISTEN/NOTIFY
does not survive a transaction-pooled connection. Use the non-pooling URL, never the pooled
`POSTGRES_URL`.

The worker reaches the pipeline over **localhost inside the same ECS task** — it does not need
Supabase keys, Bedrock creds, or S3 access. It only needs the DB URL (queue) and `API_KEY`
(the guarded re-entry route). All the heavy-lifting creds stay on the listener container.

---

## 3. Provisioning — ordered steps

**Ordering is load-bearing:** the graphile-worker schema MUST exist before migration 0053, or
0053's guard `RAISE`s (`graphile_worker schema is absent`). So: **install schema → migrate →
deploy worker → flip flag**.

### P1 — Build the worker  **[safe/anyone]**

```bash
npm install                         # repo root — npm workspaces, NOT pnpm (CLAUDE.md)
npm run build -w @polytoken/worker  # tsc → apps/worker/dist
```

Produces `apps/worker/dist/index.js` (the `start` entry) and `dist/install-schema.js`. No DB
or AWS contact. `npm run typecheck -w @polytoken/worker` and `npm run test -w @polytoken/worker`
(vitest — covers the fan-out/`job_key` helpers) are the local gates.

### P2 — Install the `graphile_worker` schema  **[PEDRO — needs DB creds]**

graphile-worker owns and migrates its own internal `graphile_worker` schema. Run the one-shot
installer *once*, decoupled from the always-on worker so there's no first-boot race:

```bash
# with GRAPHILE_WORKER_CONNECTION_STRING or POSTGRES_URL_NON_POOLING pointed at the target DB
node apps/worker/dist/install-schema.js
# expect: "graphile_worker schema installed/upgraded"
```

- Runs as the `postgres`/owner role over the **non-pooling** URL — the same role/URL
  `packages/db/src/migrate.ts` uses. graphile-worker's migration needs owner privileges.
- **Idempotent** — a re-run only applies any *new* graphile-worker migrations; safe to repeat.
- MUST precede P3. `install-schema.ts` documents exactly this ordering ("It MUST run BEFORE the
  `public.enqueue_job` wrapper migration").
- Sandbox note (see `docs/DEPLOY.md §8`): the agent sandbox has HTTPS-443 egress only and can't
  open a Postgres socket. Run this from a host that reaches Postgres directly (GitHub-hosted
  runner or Pedro's machine), **[PEDRO to confirm]** which transport for prod.

### P3 — Apply migrations 0053 + 0054  **[PEDRO — needs DB creds]**

Both are **forward/additive** (expand-only per `docs/DEPLOY.md §2`) — no schema drop, no data
change. Applied by drizzle, which manages `drizzle.__drizzle_migrations` itself:

```bash
npm run db:migrate:prod     # → migrate:prod -w @polytoken/db → tsx src/migrate.ts (POSTGRES_URL_NON_POOLING)
```

(`db:migrate` = local via `.env.local`; `db:migrate:staging` for staging first.)

- **`0053_graphile_enqueue_wrapper.sql`** creates `public.enqueue_job(p_identifier, p_payload,
  p_max_attempts, p_job_key) RETURNS bigint` — the single generic enqueue wrapper over
  graphile-worker's `add_job`. `SECURITY DEFINER` (add_job needs owner privileges),
  `REVOKE ALL … FROM public`, `GRANT EXECUTE … TO service_role`. Its allowlist is
  `ingest_inbound_email`, `deep_research`; an unknown identifier `RAISE`s. It **opens with an
  ordering guard** that `RAISE`s if the `graphile_worker` schema is absent → P2 must have run.
- **`0054_enqueue_allowlist_morning_board.sql`** `CREATE OR REPLACE`s the wrapper verbatim and
  only **widens** the allowlist with `assemble_morning_board` + `dispatch_morning_boards`
  (Phase 74). Additive; superseding-by-replace (do not edit 0053 in place).

After P3, verify the wrapper exists and the allowlist rejects garbage:

```sql
SELECT proname FROM pg_proc WHERE proname = 'enqueue_job';           -- 1 row
SELECT public.enqueue_job('not_a_real_task', '{}'::jsonb);           -- must RAISE "unknown identifier"
```

### P4 — Deploy the worker container  **[PEDRO — needs AWS creds; INFRA-GATED]**

Design intent (`apps/worker/src/index.ts` header): the worker runs as a **second container in
the existing ECS task, `essential = false`**, so a worker crash can never take down the SNS
receiver. It shares the task's `awsvpc` netns → reaches the listener over `localhost:8000`.

**Not yet wired.** As of this writing `infrastructure/aws/ecs.tf` defines a **single**
`email-listener` container (`essential = true`); there is **no worker container, no worker
Dockerfile, and no worker CI job**. Standing the worker up therefore requires infra changes:

1. A runtime image for the Node worker. The listener image is **Python-only** (`python:3.11-slim`,
   no Node), so the "share the listener image via a command override" note in `index.ts` needs a
   concrete plan — either a dedicated worker image or a multi-runtime image. **[PEDRO to confirm]**.
2. A second container in the task def (`essential = false`) with `command`/image pointing at the
   worker, the P2 env from §2, and the shared `API_KEY` secret.
3. **[PEDRO to confirm]** the ECR repo + image tag convention (existing listener repo is
   `nauta-services-email-listener`; see `docs/DEPLOY.md §1`).

> ⚠️ **Live-infra landmine (CLAUDE.md).** There is **no Terraform remote-state backend** (the S3
> backend is commented out in `infrastructure/aws/main.tf`). A `terraform apply` from a checkout
> lacking the imported local state can **recreate/drop live SES receipt rules → mail outage**. Do
> **not** `apply` until shared state exists and every live resource is imported — see
> `infrastructure/aws/IMPORT-RUNBOOK.md` and `infrastructure/aws/REMOTE-STATE-RUNBOOK.md`. This
> step is **hard-gated** behind that work. The worker deploy is **purely additive** at the AWS
> level (a new container + new resources, no rename of `nauta-*` / `magnitudetech.com.br`
> identities), but until remote state + imports exist, no `apply` is safe.

Once deployed, confirm the worker booted and is polling (CloudWatch logs for the worker
container; a healthy boot logs nothing fatal — `worker_fatal` on the connection string means the
DB URL is missing/unreachable).

### P5 — Cutover: flip `INGEST_ENQUEUE_ENABLED` on the listener  **[PEDRO — needs AWS creds]**

This is the reversible switch. It lives on the **listener** (`app/settings.py`
→ `INGEST_ENQUEUE_ENABLED: bool = False`), read in `sns_inbound.py::_process_notification`. It
is a plain env var — flip it via the listener's env/task-def; **no code deploy**, and the
`assemble`/pipeline handlers stay registered either way.

Set `INGEST_ENQUEUE_ENABLED=true` (or `1`) on the listener container and roll the task.

**Only flip this after P2–P4 are green.** With the flag ON but no worker draining, emails
enqueue and sit — the SNS ack still returns fast (no loss, the row is durable), but nothing
processes them until the worker is up.

When ON, a `Notification` does:

```
enqueuer.enqueue("ingest_inbound_email",
                 {"ses_message_id": <id>, "recipients": [...]},
                 job_key=f"ingest:{<id>}")     # → public.enqueue_job RPC (service_role)
```

- `job_key = ingest:<message_id>` makes the enqueue **idempotent**: an SNS redelivery *replaces*
  the still-pending job instead of duplicating it.
- A **failed enqueue → 500** so SNS retries (the whole point of 3a — no silent loss). A
  successful enqueue → 200 fast.

**Verify the enqueue path is live** (send/redrive one test email, or watch real traffic):

```sql
-- 1. jobs appear on enqueue
SELECT task_identifier, key, attempts, max_attempts, last_error
FROM   graphile_worker.jobs ORDER BY created_at DESC LIMIT 20;   -- rows keyed "ingest:<message_id>"

-- 2. the worker drains them (queue trends to empty; no rows stuck with rising `attempts`)
SELECT count(*) FROM graphile_worker.jobs;

-- 3. the email reaches a terminal parse_status (route returns {email_id, parse_status})
--    inline failures leave 'received'; a drained job runs the full pipeline → 'parsed'
```

Cross-check the listener logs: `email_received` → (no `email_enqueue_error`) and the worker
container logs one `POST /v1/emails/ingest-job` per drained job. A job whose `attempts` climbs
toward `max_attempts` with a recurring `last_error` is a genuine pipeline failure being
*durably retried* (working as designed) — not a cutover problem.

---

## 4. Rollback

The cutover is a **flag flip, reversible without a code deploy**:

- **Flip `INGEST_ENQUEUE_ENABLED` back OFF** on the listener and roll the task. The SNS receiver
  immediately resumes the **inline path** — byte-identical to `origin/main`. New mail no longer
  enqueues.
- **In-flight jobs are safe.** Any job already in `graphile_worker.jobs` keeps being drained by
  the worker (leave the worker running to bleed the queue down), or is picked up when the worker
  next runs. The job row is durable across restarts; nothing is lost by turning the flag off —
  it only stops *new* enqueues.
- **Optional intermediate fallbacks** (no worker, no infra) if you must roll back further and
  still avoid the SNS-timeout/silent-loss pain — both listener flags, both default OFF:
  - `INGEST_BACKGROUND_ENABLED` — inline path schedules ingest as a FastAPI BackgroundTask and
    200s in <1s (dodges the ~15s SNS timeout). Accepts a restart-loses-the-task gap.
  - `INGEST_INLINE_RETRY_ON_FAILURE` — inline path returns 500 on a pre-persist failure so SNS
    retries (closes the silent-200 loss for the "never even stored" cases).
- **DB/infra:** nothing to roll back. `public.enqueue_job` and the `graphile_worker` schema are
  additive and inert when the flag is OFF — leave them in place. Migrations are expand-only, so
  an app rollback never needs a schema rollback (`docs/DEPLOY.md §2/§7`).

---

## 5. Verification checklist

Provisioning (P1–P4):

- [ ] `npm run build -w @polytoken/worker` produces `dist/index.js` + `dist/install-schema.js` **[safe]**
- [ ] `install-schema.js` printed `graphile_worker schema installed/upgraded`; `graphile_worker` schema exists **[PEDRO]**
- [ ] `db:migrate` applied 0053 + 0054; `public.enqueue_job` exists; unknown identifier `RAISE`s **[PEDRO]**
- [ ] Worker container deployed (`essential = false`, co-located), env from §2 set, `API_KEY` secret wired **[PEDRO]**
- [ ] Terraform remote state + resource imports confirmed **before** any `apply` (no `nauta-*` / SES churn) **[PEDRO]**
- [ ] Worker boots without `worker_fatal`; CloudWatch shows it polling **[PEDRO]**

Cutover (P5):

- [ ] `INGEST_ENQUEUE_ENABLED=true` on the listener; task rolled **[PEDRO]**
- [ ] A test/live `Notification` creates a `graphile_worker.jobs` row keyed `ingest:<message_id>` **[PEDRO]**
- [ ] Worker drains it (`POST /v1/emails/ingest-job` in worker logs; queue trends empty) **[PEDRO]**
- [ ] The email reaches terminal `parse_status` (`parsed`), not stuck at `received` **[PEDRO]**
- [ ] No `email_enqueue_error` in listener logs; a redelivery does **not** duplicate the job (`job_key`) **[PEDRO]**
- [ ] Rollback rehearsed: flag OFF → inline path resumes; in-flight jobs still drain **[PEDRO]**
