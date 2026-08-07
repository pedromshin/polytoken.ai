# Phase 78 — Track 3a Durable-Worker Cutover: Runsheet Pack (CUT-02 / 05 / 06 / 07 / 08 / 09 / 10)

Produced 2026-08-07 by P-lane 0a (read-only pass over the repo). **Nothing here has been
executed.** Every sheet is copy-pasteable by Pedro (or a later allow-listed run) with
placeholders marked `<LIKE_THIS>`. Sources: `docs/DURABLE-WORKER-RUNBOOK.md` (P1–P5),
`infrastructure/aws/{ecs,variables,locals,iam,ecr,outputs,ses}.tf`, `terraform.tfvars`,
`.github/workflows/deploy-email-listener{,-staging}.yml`, `deploy-migrate-prod.yml`,
`infrastructure/scripts/redrive-inbound.sh`, `apps/worker/src/install-schema.ts`,
`apps/worker/Dockerfile`, `apps/email-listener/app/presentation/api/v1/sns_inbound.py`,
`app/settings.py`, `packages/db/migrations/0053|0054|0061`.

---

## 0. HARD ORDERING (load-bearing — violating it breaks loudly or silently)

```
[ORD-1] Worker image IN ECR (:staging / :latest)          ── before ANY tfvars arn apply
[ORD-2] graphile_worker schema install (per-env DB)       ── install-schema.js, owner role
[ORD-3] Drizzle migrations through 0061 (0053→0054→0061)  ── each has a guard that RAISEs
                                                             if [ORD-2] didn't happen
[ORD-4] Worker container enabled + GREEN (CUT-05/CUT-07)  ── no worker_fatal, polling
[ORD-5] STAGING flip  INGEST_ENQUEUE_ENABLED (CUT-06)     ── full verification loop green
[ORD-6] PROD flip     INGEST_ENQUEUE_ENABLED (CUT-08)     ── only after staging soak
```

Why each edge holds:
- **ORD-1 before arn apply**: `essential=false` does NOT cover an unpullable image — a
  missing tag fails every task start and trips the deployment circuit breaker
  (`ecs.tf` comment, runbook §P4 step 2).
- **ORD-2 before ORD-3**: migrations 0053/0054/0061 each open with
  `IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='graphile_worker') THEN RAISE`
  (`packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql:24-29`).
- **ORD-4 before ORD-5**: flag ON with no worker draining = jobs enqueue and sit (no loss,
  but nothing processes; runbook §P5).
- **ORD-5 before ORD-6**: standing deploy discipline — staging first, always.

## 0.1 Constants (resolved from the repo — no placeholders)

| Thing | Value |
|---|---|
| AWS account / region | `271369143207` / `us-east-1` |
| ECR registry | `271369143207.dkr.ecr.us-east-1.amazonaws.com` |
| Worker ECR repo | `nauta-services-email-worker` (`:latest` prod, `:staging` staging) |
| ECS cluster | `nauta-services-email-listener` |
| Prod service / task family | `nauta-services-email-listener` (512 CPU / 1024 MB) |
| Staging service / task family | `nauta-services-email-listener-staging` (256 CPU / 512 MB) |
| Log groups | `/ecs/nauta-services-email-listener`, `/ecs/nauta-services-email-listener-staging` |
| Log stream prefixes | `email-listener`, `email-worker` |
| ALB | `nauta-services-email-listener-2115368239.us-east-1.elb.amazonaws.com` (prod `:80`, staging `:8080`) |
| Supabase refs | staging `fyfwkjvbcrmjqjysdyqw`, prod `dazyccjijdahxyciptkp` |
| Terraform dir | `infrastructure/aws` (S3 remote state LIVE since 2026-08-06 — verify `terraform init` reports the s3 backend, never local) |
| Redrive script | `infrastructure/scripts/redrive-inbound.sh` (NOT `scripts/` — path in the phase brief has drifted) |
| Staging inbound recipient | `agent-staging@magnitudetech.com.br` → S3 `inbound/staging/` |
| Prod inbound recipient | `agent@magnitudetech.com.br` (+ domain catch-all) → S3 `inbound/prod/` |
| GitHub repo | `pedromshin/polytoken.ai` |

Terraform binary note (Windows): Git Bash may not see the winget install —
`export TERRAFORM_BIN="$LOCALAPPDATA/Microsoft/WinGet/Packages/Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe/terraform.exe"`
(the redrive script does exactly this). Sheets below write `terraform`; substitute `$TERRAFORM_BIN` as needed.

## 0.2 The universal ZERO-CHURN GATE (applies to every `terraform plan` in this pack)

Read the whole plan before any apply. **ALLOWED** resource lines are enumerated per sheet.
**STOP-LIST — if the plan touches ANY of these, do NOT apply (mail-outage class):**

- `aws_ses_receipt_rule.*` / anything in `ses.tf` or `ses-forwarder.tf`
- `aws_sns_topic.*` / `aws_sns_topic_subscription.*`
- `aws_s3_bucket.ses_inbound` (or any resource on the inbound bucket)
- `aws_lb.*`, `aws_lb_listener.*`, `aws_lb_target_group.*`
- the OTHER environment's `aws_ecs_task_definition.service[...]` / `aws_ecs_service.service[...]`
- security groups, subnets, route tables, anything DNS
- **any `destroy` line at all** → stop, re-read, escalate to Pedro

---

## CUT-02 — Staging ECS scale-up  **[PEDRO — AWS creds]**

Staging idles at `desired_count = 0` (`variables.tf:42-46`). The ECS service has
`lifecycle { ignore_changes = [desired_count] }` (`ecs.tf:211-213`), so **the AWS CLI is the
sanctioned lever** — Terraform deliberately does not reconcile this attribute. Do NOT edit
`staging_desired_count` in tfvars for this (it would be ignored anyway).

```bash
# 1. Snapshot current state
aws ecs describe-services \
  --cluster nauta-services-email-listener \
  --services nauta-services-email-listener-staging \
  --query 'services[0].{desired:desiredCount,running:runningCount,taskDef:taskDefinition,rollout:deployments[0].rolloutState}' \
  --region us-east-1

# 2. Scale up
aws ecs update-service \
  --cluster nauta-services-email-listener \
  --service nauta-services-email-listener-staging \
  --desired-count 1 \
  --region us-east-1

# 3. Wait for a running, healthy task
aws ecs wait services-stable \
  --cluster nauta-services-email-listener \
  --services nauta-services-email-listener-staging \
  --region us-east-1

# 4. Smoke — staging listens on ALB :8080
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 \
  "http://nauta-services-email-listener-2115368239.us-east-1.elb.amazonaws.com:8080/health"
# expect: 200
```

**Scale-down (end of staging soak, cost hygiene):** same `update-service` with
`--desired-count 0`. Do this only AFTER CUT-06 verification is complete — a scaled-down
staging drains no jobs.

---

## CUT-05 — Staging worker enable  **[PEDRO — AWS creds; INFRA-GATED]**

### CUT-05.0 — Image-in-ECR gate (ORD-1; blocking)

```bash
aws ecr describe-images \
  --repository-name nauta-services-email-worker \
  --image-ids imageTag=staging \
  --region us-east-1
```

- `imageDetails` returned → proceed to CUT-05.2.
- `RepositoryNotFoundException` → the worker Terraform (merged 2026-08-06) has not been
  APPLIED yet → run CUT-05.1 first.
- `ImageNotFoundException` → repo exists, tag missing → run CUT-05.1 step B only.

### CUT-05.1 — One-time additive infra + manual :staging image push

**A. Create the (empty) ECR repo if absent** — purely additive, allowed by the gate:

```bash
terraform -chdir=infrastructure/aws plan -out=cut05-ecr.tfplan
```

ALLOWED plan lines (creates only): `aws_ecr_repository.email_worker`,
`aws_ecr_lifecycle_policy.email_worker`, `aws_iam_role_policy.github_deploy` update in-place
(EcrPush widened to the worker repo ARN — `iam.tf:168-172`). Anything else → STOP-LIST rules.

```bash
terraform -chdir=infrastructure/aws apply cut05-ecr.tfplan
```

**B. Build + push `:staging` manually.** ⚠️ Known gap: `deploy-email-listener-staging.yml`
builds ONLY the listener image — it has no worker build/push step (unlike the prod workflow).
Until that workflow grows worker steps, the staging worker image is a manual push
(build context = repo root, per `apps/worker/Dockerfile` header):

```bash
cd /c/Users/pc/Desktop/nauta.services.email-listener    # repo root, Git Bash

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 271369143207.dkr.ecr.us-east-1.amazonaws.com

docker build -f apps/worker/Dockerfile \
  -t 271369143207.dkr.ecr.us-east-1.amazonaws.com/nauta-services-email-worker:staging .

docker push 271369143207.dkr.ecr.us-east-1.amazonaws.com/nauta-services-email-worker:staging
```

Re-run the CUT-05.0 gate; it must now return the image.

### CUT-05.2 — Create the Secrets Manager secret (SESSION-MODE URL)

> ⚠️ **THE URL MUST BE SESSION-MODE (non-pooling, port 5432).** graphile-worker's core loop
> is Postgres `LISTEN/NOTIFY`, and **a transaction-pooled URL silently breaks LISTEN/NOTIFY**
> — the worker looks healthy but never hears NOTIFY; at best jobs limp in on the 2 s poll,
> at worst the LISTEN connection errors in ways that don't surface. Concretely:
> - ✅ direct: `db.fyfwkjvbcrmjqjysdyqw.supabase.co:5432` (user `postgres`)
> - ✅ Supabase *session* pooler: `aws-1-us-east-1.pooler.supabase.com:5432`
>   (user `postgres.fyfwkjvbcrmjqjysdyqw`) — session mode keeps LISTEN alive
> - ❌ **NEVER port 6543** (transaction pooler), ❌ never the pooled `POSTGRES_URL`
>
> Use the SAME URL `packages/db` migrations use — `POSTGRES_URL_NON_POOLING` from
> `.env.staging` (that equivalence is the design: runbook §2, `ecs.tf:40`).
> SSL note (from `deploy-migrate-prod.yml` header): if the URL goes through a
> `*.pooler.supabase.com` host, node-postgres needs
> `?uselibpqcompat=true&sslmode=require` appended, or it fails with
> `SELF_SIGNED_CERT_IN_CHAIN`. Bake it into the secret value.

```bash
aws secretsmanager create-secret \
  --region us-east-1 \
  --name staging/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING \
  --description "Session-mode (non-pooling, port 5432) Postgres URL for graphile-worker LISTEN/NOTIFY - staging. NEVER a transaction-pooled (6543) URL." \
  --secret-string 'postgresql://postgres:<STAGING_DB_PASSWORD>@db.fyfwkjvbcrmjqjysdyqw.supabase.co:5432/postgres?sslmode=require' \
  --query ARN --output text
# CAPTURE the printed ARN — it ends in a random 6-char suffix, e.g.
# arn:aws:secretsmanager:us-east-1:271369143207:secret:staging/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING-Ab12Cd
```

(Naming mirrors the existing `staging/nauta-services/API_KEY-…` convention in
`terraform.tfvars`. DB password: memory says all DB passwords are stale/Pedro-gated —
resolve from the `.planning/AUTH-RECIPES.md` stores, never re-ask.)

### CUT-05.3 — tfvars line

Append to `infrastructure/aws/terraform.tfvars`:

```hcl
worker_db_url_secret_arn_staging = "arn:aws:secretsmanager:us-east-1:271369143207:secret:staging/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING-<6CHAR_SUFFIX>"
```

(Variable declared in `ecs.tf:45-49`, default `""` = ship-dark.)

### CUT-05.4 — `terraform plan` — ZERO-CHURN GATE checklist

```bash
terraform -chdir=infrastructure/aws plan -out=cut05.tfplan
```

**ALLOWED — the plan must contain EXACTLY these three changes and nothing else:**

- [ ] `aws_ecs_task_definition.service["staging"]` — **replaced** (new revision; the forcing
      diff is `container_definitions`, and the only content change is the appended
      `email-worker` container: image `…email-worker:staging`, `essential=false`,
      `dependsOn` listener-HEALTHY, env `LISTENER_INTERNAL_URL/WORKER_CONCURRENCY/
      WORKER_POLL_INTERVAL_MS/MORNING_BOARD_ENABLED=false/RECIPE_RECOMPUTE_ENABLED=false`,
      secrets `GRAPHILE_WORKER_CONNECTION_STRING` + the same `API_KEY` ARN)
- [ ] `aws_ecs_service.service["staging"]` — **update in-place** (`task_definition` → new revision)
- [ ] `aws_iam_role_policy.ecs_execution_secrets` (`read-secrets`) — **update in-place**
      (the new secret ARN added to the `secretsmanager:GetSecretValue` resource list)

**STOP-LIST (do not apply on ANY of):** any SES receipt rule, any SNS topic/subscription,
the inbound S3 bucket, any ALB/listener/target-group line, the `["production"]` task-def or
service, any destroy. These are mail-outage class. See §0.2.

### CUT-05.5 — Apply + first-roll memory watch

```bash
terraform -chdir=infrastructure/aws apply cut05.tfplan

aws ecs wait services-stable \
  --cluster nauta-services-email-listener \
  --services nauta-services-email-listener-staging \
  --region us-east-1

# Worker boot check — healthy = graphile-worker startup lines, then quiet polling;
# `worker_fatal` = DB URL missing/unreachable (fix the secret, force a new deployment)
aws logs tail /ecs/nauta-services-email-listener-staging \
  --log-stream-name-prefix email-worker --since 15m --follow --region us-east-1
```

**Memory watch (first 30–60 min).** The staging task is **256 CPU / 512 MB shared by
listener + worker** — OOM is the expected first-roll failure mode:

```bash
STOPPED=$(aws ecs list-tasks --cluster nauta-services-email-listener \
  --service-name nauta-services-email-listener-staging \
  --desired-status STOPPED --query 'taskArns' --output text --region us-east-1)
[ -n "$STOPPED" ] && aws ecs describe-tasks --cluster nauta-services-email-listener \
  --tasks $STOPPED \
  --query 'tasks[].{stopped:stoppedReason,containers:containers[].{name:name,exit:exitCode,reason:reason}}' \
  --region us-east-1
# OOM signature: "OutOfMemoryError: Container killed due to memory usage"
```

**The bump command (if OOM):** memory is task-level in `locals.tf`, so the bump is a
one-line Terraform edit, NOT a console action. In `infrastructure/aws/locals.tf` staging
block change `memory = 512` → `memory = 1024` (valid pairing with `cpu = 256` on Fargate),
then:

```bash
terraform -chdir=infrastructure/aws plan -out=membump.tfplan
# GATE: ONLY ["staging"] task-def replaced + ["staging"] service in-place
terraform -chdir=infrastructure/aws apply membump.tfplan
```

---

## CUT-07 — Prod worker enable (mirror of CUT-05)  **[PEDRO — AWS creds; INFRA-GATED]**

Preconditions: CUT-05 green in staging AND prod DB prepared in order (ORD-2 → ORD-3):

```bash
# ORD-2 (prod): one-shot schema install — from a host that reaches prod Postgres
# (GitHub runner or Pedro's machine; the agent sandbox has 443-only egress)
export POSTGRES_URL_NON_POOLING='<PROD_SESSION_MODE_URL>'   # same value as GitHub secret PROD_POSTGRES_URL_NON_POOLING
node apps/worker/dist/install-schema.js
# expect: "graphile_worker schema installed/upgraded"   (idempotent — safe to re-run)

# ORD-3 (prod): drizzle through 0061 — either locally:
npm run db:migrate:prod        # needs repo-root .env.production with POSTGRES_URL_NON_POOLING
# …or the guarded GitHub workflow (drizzle only — it does NOT run install-schema):
gh workflow run deploy-migrate-prod.yml --repo pedromshin/polytoken.ai -f confirm=MIGRATE-PROD

# Post-check (prod psql):
#   SELECT proname FROM pg_proc WHERE proname='enqueue_job';       -- 1 row
#   SELECT public.enqueue_job('not_a_real_task','{}'::jsonb);      -- must RAISE "unknown identifier"
```

**CUT-07.1 — image `:latest` (ORD-1).** Sanctioned route = the prod deploy workflow, which
already builds + Trivy-scans the worker every run and pushes it once the repo variable is set
(`deploy-email-listener.yml:131-133`):

```bash
gh variable set WORKER_DEPLOY_ENABLED --body true --repo pedromshin/polytoken.ai
gh workflow run deploy-email-listener.yml --repo pedromshin/polytoken.ai
gh run watch --repo pedromshin/polytoken.ai    # or check Actions UI
# Manual fallback (same as CUT-05.1B with :latest):
#   docker build -f apps/worker/Dockerfile -t 271369143207.dkr.ecr.us-east-1.amazonaws.com/nauta-services-email-worker:latest .
#   docker push 271369143207.dkr.ecr.us-east-1.amazonaws.com/nauta-services-email-worker:latest
aws ecr describe-images --repository-name nauta-services-email-worker \
  --image-ids imageTag=latest --region us-east-1        # gate: must return imageDetails
```

**CUT-07.2 — prod secret:**

```bash
aws secretsmanager create-secret \
  --region us-east-1 \
  --name prod/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING \
  --description "Session-mode (non-pooling, port 5432) Postgres URL for graphile-worker LISTEN/NOTIFY - production. NEVER a transaction-pooled (6543) URL." \
  --secret-string 'postgresql://postgres:<PROD_DB_PASSWORD>@db.dazyccjijdahxyciptkp.supabase.co:5432/postgres?sslmode=require' \
  --query ARN --output text
```

Same session-mode/6543/SSL warnings as CUT-05.2, verbatim. The value should equal the
`PROD_POSTGRES_URL_NON_POOLING` GitHub `production`-environment secret.

**CUT-07.3 — tfvars:**

```hcl
worker_db_url_secret_arn_prod = "arn:aws:secretsmanager:us-east-1:271369143207:secret:prod/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING-<6CHAR_SUFFIX>"
```

**CUT-07.4 — plan gate (mirror):** ALLOWED = exactly
`aws_ecs_task_definition.service["production"]` replaced +
`aws_ecs_service.service["production"]` in-place + `read-secrets` policy in-place.
STOP-LIST identical (§0.2) — and here it REALLY matters: this roll touches the live mail
receiver's task. The roll itself is zero-downtime (`minimum_healthy_percent=100`,
`maximum_percent=200`, circuit breaker with auto-rollback), but schedule a low-traffic window.

**CUT-07.5 — apply + watch:** as CUT-05.5, with
`--services nauta-services-email-listener` and log group
`/ecs/nauta-services-email-listener`. Prod task is 512/1024 — more headroom, same OOM check;
bump path is the prod `memory` line in `locals.tf` if ever needed.

---

## CUT-06 — Staging `INGEST_ENQUEUE_ENABLED` flip + live verification  **[PEDRO]**

### The sanctioned flip mechanism (determined from ecs.tf — read before flipping)

The flag lives on the **listener** (`app/settings.py:272`, `INGEST_ENQUEUE_ENABLED: bool =
False`, read in `sns_inbound.py::_process_notification`). The listener's env block is
**hardcoded in `ecs.tf` (lines 83–92) and carries no such entry today**, and `ecs.tf` states
the constitution outright: *"CI deploys by forcing a new deployment after pushing a new image
tag; **task definition revisions only change via Terraform**"* (`ecs.tf:209-210`). Therefore:

- ❌ **NOT** a console/CLI `register-task-definition` hand-edit — it drifts from state and is
  clobbered/flagged at the next `terraform plan`.
- ✅ **Sanctioned = a tfvars-gated env entry in `ecs.tf`**, exactly mirroring the worker's own
  ship-dark `worker_db_url_secret_arn_*` pattern. This requires the small files-only wiring
  diff in **Appendix A** to land on `main` first **[safe/anyone]** — after that, every flip
  (and every rollback) is a one-line tfvars change + gated apply, no code deploy.

The Appendix A wiring emits the env entry ONLY when true (`concat(...cond ? [entry] : [])`),
so with the flag false the rendered task definition stays **byte-identical** — merging the
wiring itself is a plan/apply no-op.

### Preconditions (hard ordering — all must be checked)

- [ ] ORD-2 staging: `SELECT 1 FROM pg_namespace WHERE nspname='graphile_worker';` → 1 row
- [ ] ORD-3 staging: `npm run db:migrate:staging` applied through **0061** (needs
      `.env.staging` `POSTGRES_URL_NON_POOLING`); verify:
      `SELECT public.enqueue_job('not_a_real_task','{}'::jsonb);` → RAISEs "unknown identifier"
- [ ] ORD-4: CUT-05 applied, worker log shows clean boot, no `worker_fatal`
- [ ] Appendix A flip wiring merged to `main` and present in the checkout terraform runs from
- [ ] CUT-02 done (staging `desired_count = 1`, `/health` 200)

### Flip

```hcl
# infrastructure/aws/terraform.tfvars
ingest_enqueue_enabled_staging = true
```

```bash
terraform -chdir=infrastructure/aws plan -out=cut06.tfplan
# ZERO-CHURN GATE — ALLOWED, exactly and only:
#   [ ] aws_ecs_task_definition.service["staging"] replaced — sole content diff:
#       listener env gains { INGEST_ENQUEUE_ENABLED = "true" }
#   [ ] aws_ecs_service.service["staging"] update in-place (new revision)
# No read-secrets change this time. No prod. STOP-LIST per §0.2.
terraform -chdir=infrastructure/aws apply cut06.tfplan

aws ecs wait services-stable \
  --cluster nauta-services-email-listener \
  --services nauta-services-email-listener-staging \
  --region us-east-1
```

### Live verification loop (run all six)

**1. Inject one email** — either fresh send to `agent-staging@magnitudetech.com.br`, or
redrive an existing raw MIME (Git Bash; script reads topic ARN + bucket from terraform
outputs, so it needs the remote-state-initialized `infrastructure/aws` and aws CLI + python):

```bash
./infrastructure/scripts/redrive-inbound.sh staging --list
./infrastructure/scripts/redrive-inbound.sh staging <SES_MESSAGE_ID>
```

**2. Job row appears** (staging DB via the session-mode URL; graphile-worker 0.17 —
`graphile_worker.jobs` is the supported view, never touch `_private_*` tables):

```sql
SELECT id, task_identifier, key, attempts, max_attempts, last_error, created_at
FROM   graphile_worker.jobs
WHERE  key = 'ingest:<SES_MESSAGE_ID>';
-- expect exactly 1 row, within seconds of the SNS delivery
```

**3. Worker drains it:**

```sql
SELECT count(*) FROM graphile_worker.jobs;   -- trends to 0
SELECT key, attempts, last_error FROM graphile_worker.jobs WHERE attempts > 0;
-- rising attempts + recurring last_error = a genuine pipeline failure being DURABLY
-- retried (working as designed), not a cutover problem (runbook §P5)
```

```bash
aws logs tail /ecs/nauta-services-email-listener-staging \
  --log-stream-name-prefix email-worker --since 10m --region us-east-1
# expect one "POST /v1/emails/ingest-job" per drained job
```

**4. Terminal `parse_status` against the emails table.** ⚠️ TRAP: `emails.message_id` is the
**RFC 5322** Message-ID (`packages/db/src/schema/emails.ts:46`), NOT the SES message id. The
SES id is only in `raw_storage_key` (S3 key `inbound/staging/<SES_MESSAGE_ID>`):

```sql
SELECT id, subject, parse_status, parse_error, parsed_at, created_at
FROM   emails
WHERE  raw_storage_key LIKE '%<SES_MESSAGE_ID>%'
ORDER  BY created_at DESC;
-- terminal success: parse_status = 'parsed' with parsed_at stamped
-- stuck at 'received' with the queue empty = the drain never ran the pipeline — investigate
```

**5. Listener logs — no enqueue errors:**

```bash
aws logs tail /ecs/nauta-services-email-listener-staging \
  --log-stream-name-prefix email-listener --since 10m --region us-east-1 \
  | grep -E 'email_received|email_enqueue_error'
# expect email_received present, email_enqueue_error ABSENT
# (an enqueue failure returns 500 → SNS retries — by design, but it must not be steady-state)
```

**6. Idempotency probe:** redrive the SAME `<SES_MESSAGE_ID>` again while a job is pending →
step-2 query still shows ONE row for the key (`job_key` replaces, never duplicates). After
completion a redrive creates a fresh job that re-runs — safe: ingestion is idempotent on
`(importer_id, message_id)` (unique index `emails_importer_id_message_id_unique`).

---

## CUT-08 — Prod flip + verification  **[PEDRO]**

Preconditions: CUT-06 all six checks green over an agreed staging soak; CUT-07 green
(prod worker booted, no `worker_fatal`); low-traffic window chosen.

```hcl
# infrastructure/aws/terraform.tfvars
ingest_enqueue_enabled_prod = true
```

```bash
terraform -chdir=infrastructure/aws plan -out=cut08.tfplan
# GATE — ALLOWED exactly: ["production"] task-def replaced (env +INGEST_ENQUEUE_ENABLED=true)
#        + ["production"] service in-place. NOTHING else. STOP-LIST §0.2.
terraform -chdir=infrastructure/aws apply cut08.tfplan

aws ecs wait services-stable \
  --cluster nauta-services-email-listener \
  --services nauta-services-email-listener \
  --region us-east-1
```

Verification = the same six-step loop against **prod**:

```bash
./infrastructure/scripts/redrive-inbound.sh prod --list
./infrastructure/scripts/redrive-inbound.sh prod <SES_MESSAGE_ID>
# or send a real email to agent@magnitudetech.com.br
```

- SQL steps 2–4 against the PROD DB; step 4 key prefix is `inbound/prod/<SES_MESSAGE_ID>`.
- Log commands with group `/ecs/nauta-services-email-listener`.
- Then watch the first hour of REAL traffic: step-5 grep stays clean, queue count keeps
  trending to 0, and no prod task restarts (memory watch from CUT-05.5, prod names).
- Rehearse rollback awareness: confirm CUT-10 sheet is at hand before leaving the window.

---

## CUT-09 — Dead-letter / redrive check design (around `infrastructure/scripts/redrive-inbound.sh`)

**Mechanism.** A failed pipeline call (non-2xx from `POST /v1/emails/ingest-job`) throws in
the worker task → graphile-worker retries with exponential backoff up to `max_attempts`
(8, the `enqueue_job` default). After the final failure the row **stays** in
`graphile_worker.jobs` with `attempts = max_attempts` and `last_error` set — that row IS the
dead-letter. Nothing deletes it; nothing is lost.

**Check queries** (run per env; cadence bounded below):

```sql
-- A. DEAD-LETTER: permanently failed, needs human eyes
SELECT id, key, task_identifier, attempts, max_attempts, last_error, created_at, run_at
FROM   graphile_worker.jobs
WHERE  attempts >= max_attempts
ORDER  BY created_at;

-- B. RETRYING: not dead yet; recurring last_error here predicts tomorrow's dead-letter
SELECT key, attempts, max_attempts, last_error, run_at
FROM   graphile_worker.jobs
WHERE  attempts > 0 AND attempts < max_attempts;

-- C. DEPTH/AGE: alarm-worthy if oldest pending > 15 min while the worker is up
SELECT count(*) AS depth, min(created_at) AS oldest FROM graphile_worker.jobs;
```

**Cadence is bounded by the S3 lifecycle:** raw MIME lives 30 days under
`inbound/<env>/` — the job payload is only a `{ses_message_id, recipients}` **pointer**, so a
dead letter older than ~30 days can no longer be redriven (the MIME is gone). **Run query A
at least weekly**; treat any dead letter as a ≤30-day fuse.

**Redrive procedure for a dead-lettered ingest job** (`key = 'ingest:<SES_MESSAGE_ID>'`):

```bash
# 1. Confirm the raw MIME still exists (script fails fast on a missing object)
./infrastructure/scripts/redrive-inbound.sh <prod|staging> --list
# or directly:
aws s3api head-object \
  --bucket "$(terraform -chdir=infrastructure/aws output -raw ses_inbound_bucket)" \
  --key "inbound/<prod|staging>/<SES_MESSAGE_ID>" --region us-east-1

# 2. Redrive — republishes the synthetic SNS notification; the listener re-enqueues with the
#    SAME job_key, which REPLACES the exhausted row (attempts reset) rather than duplicating
./infrastructure/scripts/redrive-inbound.sh <prod|staging> <SES_MESSAGE_ID>
```

```sql
-- 3. If the key row did NOT reset (verify with the CUT-06 step-2 query), clear then redrive:
SELECT graphile_worker.remove_job('ingest:<SES_MESSAGE_ID>');   -- owner role
-- then re-run step 2, then the full CUT-06 verification loop for this message
```

(Replace-on-failed-row semantics should be **rehearsed once on staging** during the soak —
force a dead letter by pointing at a bogus message id is NOT possible via this path since
head-object gates it; instead temporarily stop the staging listener… simplest rehearsal:
enqueue a job while the worker is up but the listener scaled to 0 is not possible either
[worker depends on listener HEALTHY]. Practical rehearsal: pick a staging email whose
pipeline genuinely fails, let it exhaust 8 attempts, then run this procedure.)

**Script environment notes** (from the script itself): bash (Git Bash on this machine),
`terraform` on PATH or `TERRAFORM_BIN` exported (winget path fallback is built in), `aws`
CLI, `python` on PATH; identifiers come from terraform outputs
(`ses_inbound_topic_arns[<env>]`, `ses_inbound_bucket`) — never hardcode them. Redriving is
safe to repeat: ingestion is idempotent on `(importer_id, message_id)`.

**Proposed (files-only, later):** a weekly CI job or local script wrapping query A per env +
a CloudWatch metric filter on `email_enqueue_error` (listener) — flagged as follow-up, not
part of this cutover.

---

## CUT-10 — Rollback runsheet + bridge-flag disposition  **[PEDRO]**

### A. Flag back OFF (the reversible switch — no code deploy)

```hcl
# infrastructure/aws/terraform.tfvars — set false or delete the line (default false)
ingest_enqueue_enabled_prod = false          # or _staging, per env being rolled back
```

```bash
terraform -chdir=infrastructure/aws plan -out=rollback.tfplan
# GATE — ALLOWED exactly: that env's task-def replaced (INGEST_ENQUEUE_ENABLED entry
#        REMOVED → listener default False) + that env's service in-place. STOP-LIST §0.2.
terraform -chdir=infrastructure/aws apply rollback.tfplan

aws ecs wait services-stable \
  --cluster nauta-services-email-listener \
  --services <nauta-services-email-listener | nauta-services-email-listener-staging> \
  --region us-east-1
```

Effect: the SNS receiver resumes the **inline path immediately** — byte-identical to
pre-cutover behavior. Every tfvars apply is a rolling deploy under the circuit breaker; a
bad revision auto-rolls back to the previous one.

### B. Queue drain disposition

- **Leave the worker container enabled and running.** Flag-off stops only NEW enqueues;
  every job already in `graphile_worker.jobs` is durable and keeps draining. Nothing is lost.
- Monitor to empty: `SELECT count(*) FROM graphile_worker.jobs;` → 0. **Do NOT delete rows.**
- If the rollback was caused by enqueue failures (`email_enqueue_error` → 500s): SNS was
  retrying those deliveries; post-rollback redeliveries process inline. But SNS's HTTP retry
  policy is finite — for any message that exhausted retries during the broken window,
  diff S3 `inbound/<env>/` listings against `emails.raw_storage_key` rows and redrive the
  gaps with `./infrastructure/scripts/redrive-inbound.sh` (30-day S3 window applies).

### C. Full worker de-provision (only if the worker itself is the problem)

After the queue is empty (or accepting that pending jobs wait): blank the env's
`worker_db_url_secret_arn_*` in tfvars → plan (GATE: that env's task-def reverts to
listener-only + service in-place + `read-secrets` policy shrink) → apply. Optionally
`gh variable set WORKER_DEPLOY_ENABLED --body false --repo pedromshin/polytoken.ai` to stop
CI worker pushes. **DB stays as-is**: the `graphile_worker` schema and `public.enqueue_job`
are additive and inert with the flag off — leave them (runbook §4; expand-only migration
discipline, `docs/DEPLOY.md §2/§7`).

### D. Disposition memo — `INGEST_BACKGROUND_ENABLED` fast-200 bridge

**Current state:** code-only listener flag (`app/settings.py:289`), default `False`, and it
was **never wired into the ECS task-def env** (`ecs.tf` listener env has no such entry) — so
it is OFF in both deployed environments today. Its branch in
`sns_inbound.py::_process_notification` is structurally unreachable while
`INGEST_ENQUEUE_ENABLED` is ON (the enqueue check comes first).

**Keep through the soak window.** It is rung 2 of the rollback ladder:
durable OFF + bridge ON = fast-200 without any infra (accepts the documented
restart-loses-the-task / pre-persist-log-only gap). Cheap insurance while CUT-08 beds in.

**Retire WHEN:** after CUT-08 has run green for an agreed soak (suggest 2–4 weeks of prod
traffic including ≥1 heavy-PDF email and ≥1 exercised dead-letter/redrive) with no rollback.

**Retire HOW** (files-only code phase, **[safe/anyone]**, conventional commit
`refactor: retire INGEST_BACKGROUND_ENABLED fast-200 bridge (durable worker live)`):
remove the `INGEST_BACKGROUND_ENABLED` field from `app/settings.py`, the
`if settings.INGEST_BACKGROUND_ENABLED` branch and `_run_ingest_background` from
`sns_inbound.py`, and their tests. **Keep `INGEST_INLINE_RETRY_ON_FAILURE`** — different
concern (fail-loud on the inline path, which post-cutover exists only as the rollback path);
decision for Pedro: at retirement time, consider wiring `INGEST_INLINE_RETRY_ON_FAILURE=true`
into the listener env via the same Appendix-A pattern so any future rollback window has no
silent-200 loss.

---

## Appendix A — Flip wiring diff (files-only prerequisite for CUT-06/08/10) **[safe/anyone]**

`infrastructure/aws/ecs.tf` — add beside the existing `worker_db_url_secret_arn_*` blocks:

```hcl
variable "ingest_enqueue_enabled_prod" {
  description = "Track 3a cutover flag (runbook §P5): true adds INGEST_ENQUEUE_ENABLED=true to the production listener env. False/absent = entry omitted -> listener settings default False (inline path); rendered task def stays byte-identical."
  type        = bool
  default     = false
}

variable "ingest_enqueue_enabled_staging" {
  description = "Track 3a cutover flag (runbook §P5): true adds INGEST_ENQUEUE_ENABLED=true to the staging listener env."
  type        = bool
  default     = false
}

locals {
  ingest_enqueue_enabled = {
    production = var.ingest_enqueue_enabled_prod
    staging    = var.ingest_enqueue_enabled_staging
  }
}
```

…and change the **listener** container's `environment` (ecs.tf lines 83–92) to:

```hcl
      environment = concat([
        { name = "ENVIRONMENT", value = each.value.environment },
        { name = "DEBUG", value = "false" },
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = tostring(var.service_port) },
        { name = "LOG_LEVEL", value = "INFO" },
        { name = "LOG_JSON", value = "true" },
        { name = "SUPABASE_URL", value = each.value.supabase_url },
        { name = "BEDROCK_REGION", value = each.value.bedrock_region },
        ],
        # Track 3a cutover (runbook §P5) — present ONLY when flipped ON so the rendered
        # task definition stays byte-identical while the flag is false (ship-dark,
        # mirrors the worker container's own gate below).
        local.ingest_enqueue_enabled[each.key] ? [
          { name = "INGEST_ENQUEUE_ENABLED", value = "true" }
        ] : [],
      )
```

pydantic-settings parses `"true"`/`"1"` as `True`. Merging this with both vars false is a
plan/apply **no-op** (conditional emits nothing) — safe to land ahead of flip day; verify
with a plan showing "No changes".

## Appendix B — Known gaps / open questions surfaced by this pass

1. **Staging deploy workflow never builds the worker image** —
   `deploy-email-listener-staging.yml` lacks the `test-worker` job and worker build/push
   steps the prod workflow has. Until it's extended, `:staging` worker updates are the
   manual push in CUT-05.1B. Follow-up: mirror the prod workflow's worker steps with
   `IMAGE_TAG: staging` (files-only).
2. **Redrive script path drift**: it lives at `infrastructure/scripts/redrive-inbound.sh`,
   not `scripts/redrive-inbound.sh` as the phase brief says.
3. **`raw_storage_key` equality**: assumed equal to the S3 key
   `inbound/<env>/<SES_MESSAGE_ID>`; the CUT-06 step-4 SQL uses `LIKE '%<id>%'` to be safe —
   confirm exact format once on staging, then tighten to `=`.
4. **Worker Terraform applied vs merged**: the runbook marks the TF as merged (2026-08-06)
   but apply state is unknown — CUT-05.0/05.1 detect and handle either case.
5. **DB passwords stale everywhere** (memory, Pedro-gated) — secret values in CUT-05.2/07.2
   need fresh credentials from the AUTH-RECIPES stores before any create-secret runs.
6. **`job_key` replace-on-permanently-failed semantics** (graphile-worker 0.17): expected to
   reset the exhausted row on re-add; rehearse once on staging (CUT-09) — `remove_job`
   fallback is in the sheet.
7. **CUT numbering**: CUT-01/03/04 (assumed: build, schema install, migrations) are covered
   here only as ordering preconditions (§0, CUT-06/07 precondition blocks) since the brief
   scoped this pack to 02/05/06/07/08/09/10.
