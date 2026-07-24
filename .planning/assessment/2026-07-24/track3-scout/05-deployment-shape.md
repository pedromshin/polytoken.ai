# Track 3 Scout — 05: Deployment Shape (the container/ECS box the worker must fit)

**Scope:** the deployment constraint on Track 3a (graphile-worker durable runtime). Maps how the Python listener is built, run, invoked, and provisioned so a downstream designer can decide the worker's exact placement. Analysis only — no source edits, no `terraform apply`, no resource renames.

**One-sentence headline:** The listener is a **single-process Python/uvicorn container** that talks to the DB **only over the Supabase REST SDK** — it holds **no direct Postgres connection at all** — so a graphile-worker (a **Node** library that requires a **direct session-mode Postgres socket** for `LISTEN/NOTIFY`) forces (a) a second language runtime into a `python:3.11-slim` image, (b) a second long-running process with no supervisor present today, and (c) a brand-new `POSTGRES_URL_NON_POOLING` secret on the ECS task definition — and **that last item is a Terraform change to `ecs.tf`, which is gated behind Track 1 (state import).**

---

## 0. Sharpest findings (read this first)

1. **The listener has zero direct DB connectivity today.** Every repository is a Supabase REST client (`supabase>=2.15.0`, `create_client(url, key)` in `app/infrastructure/supabase/client.py:35`), driven by `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (`settings.py:86-87`). `grep` for `POSTGRES_URL|psycopg|asyncpg|DATABASE_URL` across `apps/email-listener` → **nothing**. `POSTGRES_URL_NON_POOLING` lives entirely on the **Node/TS** side (`packages/db/src/client.ts:11`, `migrate.ts:15`, `drizzle.config.ts:12`). The worker's whole reason to exist (a Postgres-backed durable queue) requires a capability the container has never had.
2. **graphile-worker is Node + needs a direct Postgres socket.** It cannot run over PostgREST/Supabase REST (it uses `LISTEN/NOTIFY` and its own `graphile_worker` schema). So co-locating it means the `python:3.11-slim` runtime image (`Dockerfile:12`) gains a Node runtime, an npm dependency tree, and a second process. The current image ships exactly **one** process: `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (`Dockerfile:52`) — no `--workers`, no supervisor (no tini/supervisord/s6), single event loop.
3. **The worker can be written & merged as code now, but cannot RUN in prod until Track 1.** The enqueue-then-200 handler change, the Node worker package, and the Dockerfile multi-runtime change are all **code-in-tree** (they ride the existing CI image-build path with no infra apply). But the worker process needs `POSTGRES_URL_NON_POOLING` injected into the running task, and the task's env/secrets are defined in `ecs.tf` `container_definitions` (`ecs.tf:50-68`) — adding a secret there is a **`terraform apply`**, which is **forbidden until Track 1** stands up remote state and imports live resources (`main.tf:15-20` backend commented; CLAUDE.md landmine).
4. **There is NO existing scheduled-task / EventBridge / cron pattern to reuse.** `grep -i 'eventbridge|aws_scheduler|schedule_expression|aws_cloudwatch_event|cron('` across `infrastructure/` → **nothing**. The only non-ECS compute is the SES-forwarder **Lambda**, and it is **SES-event-invoked, not scheduled** (`ses-forwarder.tf`, `aws_lambda_permission.ses_forwarder` principal `ses.amazonaws.com`). A scheduled/RunTask worker would be **net-new Terraform**; the *only* shape that adds no new AWS resources (just a task-def env/secret diff) is an **always-on co-located process inside the existing task**.
5. **The cost convergence is real but the payoff is Track-1-gated.** Enqueue-then-200 removes the need for the inline pipeline to run inside the always-on request path — but the always-on cost is the **ALB + the `desired_count=1` Fargate task** (`variables.tf:36-40`, `locals.tf:19-20` cpu=512/mem=1024), and tearing that down to event-driven ingress edits `alb.tf`/`network.tf`/`ecs.tf` = `terraform apply` = Track 1. **Co-locating the worker in the *same* task realizes the reliability win with zero teardown; the cost win is a later, separately-gated infra move.**

---

## 1. `apps/email-listener/Dockerfile` — how the Python app is built and run

Full file is 53 lines. Two-stage build; runtime stage is `python:3.11-slim`.

**Build (builder stage, `Dockerfile:2-9`):**
```dockerfile
FROM python:3.11-slim AS builder
COPY apps/email-listener/requirements.txt .
RUN pip3 install ... --user -r requirements.txt
```
Note: the **image** installs from `requirements.txt` (pip, `--user` into `/root/.local`), even though local dev uses `uv`/`uv.lock`. `requirements.txt` is pure Python — `fastapi, uvicorn[standard], pydantic, structlog, dishka, httpx, supabase, anthropic, pypdf, pdfminer-six, pdf2image, boto3, pillow, jsonschema`. **No Node, no npm, no Postgres driver.**

**Runtime (final stage, `Dockerfile:11-52`):**
- `FROM python:3.11-slim` (`:12`) — Python-only base.
- Adds `poppler-utils` via apt for PDF rendering (`:17`) — the only non-Python system dep.
- Runs as a **non-root, no-login** user: `useradd ... -s /usr/sbin/nologin appuser` (`:22`), `USER appuser` (`:39`).
- Copies deps `/root/.local` → `/home/appuser/.local` (`:26`), the app (`:28`), and GenUI artifacts (`:37`).
- `EXPOSE 8000` (`:47`); `HEALTHCHECK` hits `http://localhost:8000/health` (`:49-50`).
- **`CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (`:52`)** — single uvicorn, single worker, one asyncio event loop. This is the "single uvicorn worker, no `--workers`" the master plan cites.

**What adding a Node runtime + a worker process requires (exact deltas):**
- **A second language runtime in the image.** `python:3.11-slim` has no Node. Options a downstream designer must choose between: (i) `apt-get install nodejs npm` in the runtime stage (bloats a "slim" image, apt Node is old); (ii) multi-stage `COPY --from=node:20-slim` of the Node runtime + a `node_modules` build of the worker; (iii) a distinct base like `nikolaik/python-nodejs`. All of these change `Dockerfile:12`/`:16-19`.
- **A worker npm package to build.** The repo's Node tooling is npm workspaces (`package.json` `workspaces: ["packages/*","apps/web","apps/daemon"]`) — `apps/email-listener` is **not** a workspace member, so a co-located worker either becomes a new workspace (e.g. `apps/worker` or `packages/worker`) whose build output is COPY'd into this image, or a small standalone `package.json` added under `apps/email-listener`. Either way the Dockerfile gains an npm-install/build stage.
- **A second process with supervision.** `CMD` runs exactly one process; ECS/Fargate restarts the *task* if the single container's entrypoint dies. Running uvicorn **and** the worker needs a process manager (tini + a launcher script, supervisord, or honcho) or the container must be split into **two containers in one task definition** (see §2). A bare `uvicorn & node worker.js` shell backgrounding is fragile (PID-1 signal handling, one dies silently).
- **A Postgres client for Node.** graphile-worker pulls `pg`; fine as an npm dep, but it needs the connection string at runtime (see §4) — which the image/task does not carry today.
- **CI already carries this image to prod with no infra apply.** `deploy-email-listener.yml:63-68` does `docker build -f apps/email-listener/Dockerfile .`, `:79-80` pushes `:latest`, `:82-87` runs `aws ecs update-service --force-new-deployment`. A Dockerfile that adds Node + a worker process **ships through this exact path** — the image contents are not Terraform-managed. **What is NOT shipped by this path: the task definition's env/secrets/cpu/memory** (see §2/§4).

---

## 2. `variables.tf` + the ECS task/service shape — where a co-located worker attaches

**`prod_desired_count` (`variables.tf:36-40`):**
```hcl
variable "prod_desired_count" {
  description = "Desired task count for the production service"
  type        = number
  default     = 1
}
```
→ **one** always-on prod task. Staging default is `0` (`variables.tf:42-46`). Because `aws_ecs_service.service` has `lifecycle { ignore_changes = [desired_count] }` (`ecs.tf:123-125`), CI never rescales; count is Terraform/console-managed.

**Task sizing (`locals.tf:12-25`, production block):** `cpu = 512`, `memory = 1024`, `image_tag = "latest"`, `desired_count = var.prod_desired_count`. Staging is `cpu=256/mem=512` (`locals.tf:31-32`). A co-located worker sharing this 0.5 vCPU / 1 GB task competes with uvicorn for CPU/RAM during OCR+multi-Bedrock pipeline runs — the designer should expect to bump `cpu`/`memory` in `locals.tf` (a Terraform change → Track 1) if the worker is heavy.

**The task definition (`ecs.tf:26-90`)** — this is the attach point:
- `family/cpu/memory` from the `local.environments` map (`ecs.tf:29-33`).
- `execution_role_arn = aws_iam_role.ecs_execution.arn` (`ecs.tf:34`) — pulls image, reads secrets, writes logs.
- `task_role_arn = aws_iam_role.ecs_task.arn` (`ecs.tf:35`) — runtime AWS perms (Bedrock, S3).
- **A single container** named `email-listener` (`ecs.tf:39`), `image = <ecr>:${image_tag}` (`ecs.tf:40`), `essential = true` (`ecs.tf:41`).
- `environment[]` (`ecs.tf:50-59`): `ENVIRONMENT, DEBUG, HOST, PORT, LOG_LEVEL, LOG_JSON, SUPABASE_URL, BEDROCK_REGION`. **No DB URL.**
- `secrets[]` (`ecs.tf:61-68`): only `API_KEY` and `SUPABASE_SECRET_KEY`, each from a Secrets Manager ARN. **No Postgres secret.**
- `logConfiguration` → CloudWatch `/ecs/<service>` (`ecs.tf:70-77`, group in `ecs.tf:17-24`, 7-day retention).
- `healthCheck` → `GET /health` (`ecs.tf:79-85`).

**Two attach shapes for a co-located worker, both Terraform:**
- **Shape A — same container, extra process.** Nothing changes in `ecs.tf`'s container list; the worker lives inside the one `email-listener` container via the Dockerfile (§1). The *only* Terraform diff is the new `POSTGRES_URL_NON_POOLING` secret entry in `secrets[]` (`ecs.tf:61-68`) — see §4. Smallest infra footprint.
- **Shape B — second container, same task.** Add a second element to the `container_definitions` `jsonencode([...])` list (`ecs.tf:37-87`) — a `worker` container, `essential = false` (so a worker crash doesn't kill the API), its own image (could be the same image with a different command override, or a separate ECR repo → new `ecr.tf` resource). This is more Terraform (a whole new container block + possibly `ecr.tf`) but cleaner process isolation and independent restart. Still one task, one Fargate bill.

**Where a *scheduled* worker would attach (if chosen instead of always-on):** there is no scaffolding for it. It would be net-new: an `aws_scheduler_schedule` / `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target` running `ecs:RunTask` against `aws_ecs_cluster.main`, a task-def variant with a worker command override, and an EventBridge-invoke IAM role. None of these files/resources exist today (§3). For a durable queue, always-on polling is also the more natural fit than cron RunTask (a queue wants a resident consumer, not a periodic batch).

---

## 3. Entrypoint + how the listener is invoked; is there a scheduled-task pattern to reuse?

**Container entrypoint:** `Dockerfile:52` → `uvicorn app.main:app`. `app/main.py:56-89` is the FastAPI factory (`create_app()`), mounting 17 routers including `sns_inbound_router` (`app/main.py:30,69`). The repo-root `apps/email-listener/main.py` is a thin re-export (`from app.main import app`) with a `__main__` uvicorn launcher for bare local runs (`main.py:1-23`) — **not** the container path.

**Invocation chain (SNS → HTTP), the durable-loss point Track 3a targets:**
1. SES writes raw MIME to S3 and publishes to an SNS topic (`outputs.tf:34-40` `ses_inbound_topic_arns`; SES/S3 wiring in `ses.tf`).
2. SNS delivers an **HTTP POST** to the ALB (`variables.tf:78-81` `alb_dns_name` "for SNS HTTP subscription").
3. ALB listener `:80` forwards to the production target group (`alb.tf:36-44`), health-checked on `/health` (`alb.tf:24-31`).
4. Target group → the Fargate task's port 8000 (`ecs.tf:107-111`, `network.tf:89-100` service SG only reachable from ALB).
5. FastAPI `POST /v1/emails/inbound-sns` (`app/presentation/api/v1/sns_inbound.py:23-24`) runs the **entire pipeline inline in the request** and **always returns 200** — including the bare-except guard around ingest:
   ```python
   # sns_inbound.py:57-64
   try:
       use_case = await request.app.state.dishka_container.get(IngestInboundEmailUseCase)
       await use_case.execute(meta["message_id"], recipients=meta["recipients"])
   except Exception:
       logger.exception("email_ingest_error", message_id=meta["message_id"])
   return Response(status_code=status.HTTP_200_OK)
   ```
   `IngestInboundEmailUseCase` does S3 fetch → MIME parse → attachment parse → `propose_regions` → `suggest_entity_types` → `resolve_ingest_entities`, all `await`ed inline (`app/application/use_cases/ingest_inbound_email.py:265,277,293`). **This is exactly what the worker must own after enqueue-then-200.** (The `to_thread`-wrapping of ~93 blocking `.execute()` calls the master plan mentions is a related but separate in-process fix.)

**Scheduled-task pattern to reuse: NONE.**
- `grep -i` across `infrastructure/**` for `eventbridge | aws_scheduler | schedule_expression | aws_cloudwatch_event | cron(` → **zero hits.**
- The infra directory is: `alb.tf, budget.tf, ecr.tf, ecs.tf, iam.tf, lambda/ses-forwarder/, locals.tf, main.tf, network.tf, outputs.tf, ses-forwarder.tf, ses.tf, variables.tf`. The **only** non-ECS compute is `aws_lambda_function.ses_forwarder` (`ses-forwarder.tf`), and it is **event-invoked by SES** (`aws_lambda_permission.ses_forwarder`, principal `ses.amazonaws.com`, invocation_type `Event` in the receipt rule's `lambda_action`) — **not a cron/EventBridge schedule.** So there is no cron scaffolding, no `RunTask` target, no scheduler role to copy. A scheduled worker is greenfield Terraform; the co-located always-on process reuses everything that already exists.

---

## 4. Env / secrets the worker needs — the load-bearing gap

**What the task carries today** (from `ecs.tf:50-68`, resolved via `settings.py`):
- Plain env: `ENVIRONMENT, DEBUG, HOST, PORT, LOG_LEVEL, LOG_JSON, SUPABASE_URL, BEDROCK_REGION`.
- Secrets (Secrets Manager ARNs): `API_KEY`, `SUPABASE_SECRET_KEY`.
- AWS API access (Bedrock, S3) is **credential-less** — it rides the **task IAM role** default chain, no keys in env. Bedrock: `aws_iam_role_policy.ecs_task_bedrock` (`iam.tf:62-86`, scoped to `anthropic.claude-*` + `titan-embed-*` foundation models and cross-region inference profiles). S3 inbound read: `aws_iam_role_policy.ecs_task_ses_inbound` (`iam.tf:90-102`, `s3:GetObject` on `<bucket>/inbound/*`).

**What the worker additionally needs:**

| Need | Present today? | How it's satisfied | Code or infra? |
|---|---|---|---|
| **Direct Postgres session connection** (`POSTGRES_URL_NON_POOLING`) for graphile schema install + `LISTEN/NOTIFY` polling | **NO** — Python is 100% Supabase REST (`client.py:35`); no PG driver anywhere | New Secrets Manager secret → new ARN var in `variables.tf` → new entry in `ecs.tf` `secrets[]` (`ecs.tf:61-68`) → new `secretsmanager:GetSecretValue` resource in `ecs_execution_secrets` (`iam.tf:26-48`) | **INFRA (Terraform → Track 1)** |
| **Enqueue capability** in the Python SNS handler | Partial | Two forks: (a) add a Python PG driver + `POSTGRES_URL` to Python (same new task secret → infra); or (b) expose a `public`-schema wrapper over `graphile_worker.add_job` and call it via the existing Supabase REST client — a **SQL migration file** (`graphile_worker` lives in a non-`public` schema PostgREST won't expose by default) | (a) INFRA; (b) CODE/migration-file |
| **`graphile_worker` schema** in the DB | NO | graphile-worker auto-migrates on boot against its connection, **or** a checked-in migration | CODE/file, but the DB apply is a **deploy step Pedro runs** (migrations are files-only in this workflow) |
| Bedrock InvokeModel (worker runs the LLM pipeline) | YES | Already on `aws_iam_role.ecs_task` (`iam.tf:62-86`) — worker shares the task role, inherits it | none |
| S3 raw-MIME read (worker fetches the email) | YES | Already on task role (`iam.tf:90-102`) | none |
| Supabase REST creds (worker persists via same repos, if worker is Python) | YES | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` already present | none |

**The crux:** whichever fork is chosen, **running the worker requires a direct Postgres connection string on the task**, and that string is a secret defined in `ecs.tf`/`iam.tf`/`variables.tf`. Changing those is `terraform apply`, and **no apply is permitted until Track 1** creates remote state and imports every live resource (`main.tf:15-20` backend commented; `IMPORT-RUNBOOK.md`; CLAUDE.md landmine). The IAM *runtime* perms the worker needs (Bedrock, S3) are already granted via the shared task role — the gap is purely the **DB connection secret**, not new AWS-service IAM.

---

## 5. Cost angle + the code-vs-infra split

**The always-on cost (master plan §169 / Track 3a "~$34/mo of always-on Fargate+ALB serving only sporadic webhooks"):**
- **Fargate:** `desired_count = 1` (`variables.tf:36-40`), `cpu=512/mem=1024` (`locals.tf:19-20`), 24/7. Container Insights is **disabled** to save ~$5/mo (`ecs.tf:6-12`).
- **ALB:** `aws_lb.main` (`alb.tf:5-13`) is billed hourly whether or not SNS is posting; it exists solely to receive the SNS HTTP POST + serve the browser BFF's calls.
- **Budget backstop is alert-only** (`budget.tf`, `$30` default `variables.tf:89-93`) — three `notification` blocks, no Budget **Action**; explicitly "an ALERT, not a hard shut-off" (`budget.tf:5-6`). Not a teardown lever, just a tripwire.

**The convergence and why the cost half waits:** enqueue-then-200 means the request path no longer *runs* the pipeline, so the compute no longer needs to be sized for / always-available-to inline OCR+Bedrock. That unlocks the cost lane's move to **event-driven ingress** (drop the always-on ALB+Fargate in front of sporadic webhooks). But that teardown edits `alb.tf` (listener/LB), `network.tf` (SGs), and `ecs.tf` (service/desired_count) — all `terraform apply`, all Track-1-gated. Co-locating the worker in the **existing** task banks the reliability + durability win **without** touching the ingress topology; the ALB/Fargate teardown is a **separate, later** infra project.

### Code-in-tree NOW (ships via existing CI, no Pedro/infra apply)
- **Enqueue-then-200** rewrite of `sns_inbound.py:57-64` — do one durable enqueue, return 200 (mergeable; only *effective* once the queue exists — fork (b) makes it fully code-only via a `public` wrapper migration).
- **The Node worker package** (new npm workspace or standalone under `apps/email-listener`) that owns the `IngestInboundEmailUseCase`-equivalent pipeline with retries + dead-letter.
- **Dockerfile multi-runtime change** — add Node + the worker process/supervisor (`Dockerfile:12-19,52`). Rides `deploy-email-listener.yml:63-87` (build → push `:latest` → force-new-deployment); the image is not Terraform-managed.
- **The `graphile_worker` schema migration file** and any `public`-schema `add_job` wrapper (`packages/db` migration, or graphile's own auto-migration) — **file only**; per workflow landmine, nobody here applies it to prod.
- **`to_thread`-wrapping** the blocking ingest `.execute()` calls — pure app code.

### Live-infra that needs Pedro (Terraform → BLOCKED on Track 1)
- **`POSTGRES_URL_NON_POOLING` secret on the task** — new Secrets Manager secret, new ARN var in `variables.tf`, new `secrets[]` entry in `ecs.tf:61-68`, new `secretsmanager:GetSecretValue` resource in `iam.tf:26-48`. **Without this the worker cannot connect and enqueue fork (a) cannot reach the DB — so the worker is inert in prod until this applies.**
- **Any `cpu`/`memory` bump** for the co-located worker (`locals.tf:19-20`, `:31-32`).
- **Shape B's second container** in `ecs.tf:37-87` (and any new `ecr.tf` repo).
- **A scheduled-worker path** (EventBridge/RunTask) if chosen — entirely net-new resources; **no pattern exists to copy** (§3).
- **The eventual ALB/Fargate ingress teardown** (the cost win) — `alb.tf`/`network.tf`/`ecs.tf`; **separate from and later than** the worker landing.
- **The DB migration *apply*** (schema install) — a deploy action Pedro runs; migrations are files-only in this workflow.

**Net:** the worker's *code* (handler, worker package, Dockerfile, migration files) is fully authorable and mergeable today; the worker's *ability to run in prod* is gated on a single Terraform change (the DB-connection secret on the task def), which is gated on Track 1. The recommended shape (co-located always-on process in the existing task) is chosen precisely because it minimizes the infra surface to that one env/secret diff and reuses the already-granted Bedrock/S3 task role, with **no** new AWS compute resources and **no** ingress teardown required to get the reliability win.

---

## Appendix — exact cite index
- `apps/email-listener/Dockerfile:12` (runtime base `python:3.11-slim`), `:16-19` (apt/poppler), `:22,39` (non-root), `:47,49-50` (expose/health), **`:52` (single-uvicorn CMD)**.
- `apps/email-listener/requirements.txt` (pure-Python deps; no Node/PG driver).
- `apps/email-listener/app/infrastructure/supabase/client.py:35` (`create_client` — REST only).
- `apps/email-listener/app/settings.py:86-87` (`SUPABASE_URL`/`SUPABASE_SECRET_KEY`; no DB URL).
- `apps/email-listener/app/main.py:30,69` (sns router), `:52,56-89` (factory/lifespan).
- `apps/email-listener/main.py:1-23` (thin re-export entrypoint).
- `apps/email-listener/app/presentation/api/v1/sns_inbound.py:23-24,57-64` (inline pipeline, always-200).
- `apps/email-listener/app/application/use_cases/ingest_inbound_email.py:265,277,293` (inline `.execute()` pipeline stages).
- `infrastructure/aws/variables.tf:16` (`project` default `nauta-services`), **`:36-40` (`prod_desired_count`=1)**, `:42-46` (staging=0), `:78-81` (`alb_dns_name` for SNS), `:89-99` (budget vars → `pedro@magnitudetech.com.br`).
- `infrastructure/aws/locals.tf:2` (`service_name`), `:12-25` (prod env: cpu=512/mem=1024/latest), `:26-38` (staging).
- `infrastructure/aws/ecs.tf:6-12` (Container Insights disabled), `:17-24` (log group), `:26-90` (task def), `:34-35` (exec/task roles), `:50-59` (env), **`:61-68` (secrets — only API_KEY + SUPABASE_SECRET_KEY)**, `:79-85` (health), `:92-128` (service), `:107-111` (LB attach), `:123-125` (`ignore_changes=[desired_count]`).
- `infrastructure/aws/alb.tf:5-13` (LB), `:15-34` (TG + `/health`), `:36-44` (`:80`→prod), `:53-64` (`:8080`→staging).
- `infrastructure/aws/network.tf:89-110` (service SG reachable only from ALB).
- `infrastructure/aws/iam.tf:15-48` (execution role + `GetSecretValue` policy), `:52-86` (task role + Bedrock), `:90-102` (task role S3 inbound read), `:104-188` (GitHub OIDC deploy role).
- `infrastructure/aws/main.tf:15-20` (**S3 backend commented — no remote state**).
- `infrastructure/aws/budget.tf:5-6` (alert-only, not a hard stop).
- `infrastructure/aws/ecr.tf` (single MUTABLE repo, keep-last-20).
- `infrastructure/aws/outputs.tf:34-40` (`ses_inbound_topic_arns`).
- `infrastructure/aws/ses-forwarder.tf` (SES-event-invoked Lambda — the only non-ECS compute; NOT scheduled).
- `.github/workflows/deploy-email-listener.yml:63-68` (docker build), `:79-80` (push `:latest`), `:82-87` (`update-service --force-new-deployment`).
- `packages/db/src/client.ts:10-11`, `migrate.ts:15`, `drizzle.config.ts:12` (`POSTGRES_URL(_NON_POOLING)` — Node/TS side only).
- No hits: `eventbridge|aws_scheduler|schedule_expression|aws_cloudwatch_event|cron(` in `infrastructure/**`; `POSTGRES_URL|psycopg|asyncpg|DATABASE_URL` in `apps/email-listener/**`.
