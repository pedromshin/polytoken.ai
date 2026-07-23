# 2026-07-23 — Terraform import + drift report (SES forwarder lane)

Executed 2026-07-23 from `infrastructure/aws/` with Terraform v1.9.8
(providers: hashicorp/aws v5.100.0, hashicorp/archive v2.8.0) against AWS
account `271369143207`, us-east-1. Runbook followed:
`infrastructure/aws/IMPORT-RUNBOOK.md` (imports before any plan; **no
`terraform apply` was run and none must be run off this state without
reading "Do not apply" below**).

## 1. State backend determination

- `main.tf` declares NO active backend — the `backend "s3"` block
  (`nauta-services-terraform-state` / `email-listener/terraform.tfstate`) is
  commented out.
- No `terraform.tfstate` existed anywhere in the repo (and `*.tfstate` is
  gitignored at repo root).
- Conclusion: state was local-only and effectively missing → per the lane
  instructions, ran `terraform init` (fresh local state) and then the
  runbook's five import commands.
- The local state produced by this run lives at
  `infrastructure/aws/terraform.tfstate` in the working copy only
  (gitignored, NOT committed). Until the S3 backend is enabled and this
  state is migrated (`terraform init -migrate-state` after uncommenting the
  backend block), every fresh clone starts stateless again.

## 2. Imports executed (all five succeeded)

| # | Resource address | Import ID | Result |
|---|------------------|-----------|--------|
| 1 | `aws_iam_role.ses_forwarder` | `polytoken-ses-forwarder-role` | imported |
| 2 | `aws_iam_role_policy.ses_forwarder` | `polytoken-ses-forwarder-role:forwarder-policy` | imported |
| 3 | `aws_lambda_function.ses_forwarder` | `polytoken-ses-forwarder` | imported |
| 4 | `aws_lambda_permission.ses_forwarder` | `polytoken-ses-forwarder/ses-invoke` | imported |
| 5 | `aws_ses_receipt_rule.personal_forward` | `nauta-services-inbound:personal-forward` | imported |

### Config fixes required to get there (committed)

1. **`ses.tf` — `aws_sns_topic_policy.ses_inbound` for_each bug.** It
   iterated `for_each = aws_sns_topic.ses_inbound` (a resource map), which is
   unknown-until-apply against an empty/partial state and hard-failed every
   `plan`/`import` with "Invalid for_each argument" — the first import could
   not even run. Rewritten to static keys
   `toset(["prod","staging","local"])` with
   `aws_sns_topic.ses_inbound[each.key].arn`. Instance addresses are
   unchanged, so this is a no-op for any existing state.
2. **`ses-forwarder.tf` — real drift found and codified.** The first
   post-import plan showed the live Lambda env
   `MAIL_FROM = "forward@magnitudetech.com.br"` while the config default
   (an operator assumption — live values were never read at drift-capture
   time) said `no-reply@magnitudetech.com.br`. Per the runbook this means
   "fix the variables"; `var.forwarder_mail_from` default now matches live
   (`forward@`). Runbook text updated to match. Re-plan confirms the
   environment block now shows **no diff** (BUCKET / PREFIX / FORWARD_TO
   already matched live).
3. `infrastructure/aws/.gitignore` — added `*.auto.tfvars` (a local
   `drift-check.auto.tfvars` supplies the two no-default variables
   `github_repository` and `alb_dns_name` for planning; not committed).

## 3. Drift plan (`terraform plan -detailed-exitcode`)

Exit code **2** (changes present). Bottom line:
`Plan: 49 to add, 3 to change, 0 to destroy.`

### Verdict per resource

#### Imported — IN-SYNC (no diff at all)

| Resource | Verdict |
|----------|---------|
| `aws_iam_role.ses_forwarder` | in-sync |
| `aws_lambda_permission.ses_forwarder` | in-sync |

#### Imported — in-sync modulo expected/no-op churn (the "3 to change")

| Resource | Plan diff | Assessment |
|----------|-----------|------------|
| `aws_iam_role_policy.ses_forwarder` | `policy → (known after apply)` | NOT real drift. The policy templates `aws_s3_bucket.ses_inbound.arn`, and that bucket is not yet in state, so the whole JSON goes unknown. The live policy shown in the diff (`s3:GetObject` on `arn:aws:s3:::nauta-services-ses-inbound-emails/inbound/personal/*`, `ses:SendRawEmail *`, logs) is exactly what the template renders once the bucket is imported. Resolves to no-op after the S3 bucket import. |
| `aws_lambda_function.ses_forwarder` | `+filename`, `+source_code_hash`, `+publish=false`, `last_modified → known after apply` | Expected per runbook warning 4: vendored source is byte-identical but the `archive_file` zip hashes differently than the live upload, so the first apply would re-upload the same code. Environment block: NO diff after the MAIL_FROM fix (§2.2). |
| `aws_ses_receipt_rule.personal_forward` | `+after = "agent-prod"` | Positional no-op. SES receipt-rule import does not capture chain position; live order already is `… agent-prod → personal-forward → forwarding-catchall`, which is exactly what `after = "agent-prod"` asserts. |

**MAIL_FROM was the only genuine live-vs-config drift found in the imported
set, and it is now codified (config changed to match live; live untouched).**

#### NOT-IMPORTED (49 creates — everything else in the module)

The rest of the stack has no state, so plan proposes creating all of it.
Several of these demonstrably exist live (evidence: the receipt-rule import
succeeded against rule set `nauta-services-inbound`; the live IAM policy
references bucket `nauta-services-ses-inbound-emails`), so applying this
plan would collide with live resources. Verdict for each: **not-imported**.

- `aws_budgets_budget.monthly_cost`
- `aws_cloudwatch_log_group.service["production"|"staging"]`
- `aws_ecr_lifecycle_policy.email_listener`, `aws_ecr_repository.email_listener`
- `aws_ecs_cluster.main`, `aws_ecs_service.service[*]`, `aws_ecs_task_definition.service[*]`
- `aws_iam_role.ecs_execution|ecs_task|github_deploy`,
  `aws_iam_role_policy.ecs_task_bedrock|ecs_task_ses_inbound|github_deploy`,
  `aws_iam_role_policy_attachment.ecs_execution_managed`
- `aws_vpc.main`, `aws_subnet.public[0|1]`, `aws_internet_gateway.main`,
  `aws_route_table.public`, `aws_route_table_association.public[0|1]`,
  `aws_security_group.alb|service`
- `aws_lb.main`, `aws_lb_listener.http|staging`, `aws_lb_target_group.service[*]`
- `aws_s3_bucket.ses_inbound` (+ lifecycle configuration + bucket policy) — **known to exist live**
- `aws_ses_domain_identity.main`, `aws_ses_receipt_rule_set.main` — **rule set known to exist live** —
  `aws_ses_active_receipt_rule_set.main`
- `aws_ses_receipt_rule.local|staging|prod|forwarding_catchall` — **exist live per runbook's captured chain order**
- `aws_sns_topic.ses_inbound["prod"|"staging"|"local"]` (+ topic policies)
- `aws_sns_topic_subscription.prod|staging`
- data sources deferred to apply: `data.aws_iam_policy_document.ecs_task_ses_inbound`,
  `data.aws_iam_policy_document.github_deploy` (depend on unknown ARNs — same
  not-imported root cause)

### Do not apply

`terraform apply` was NOT run (lane rule) and MUST NOT be run against this
plan: the 49 creates would collide with live resources (name collisions at
best, duplicate mail-routing infrastructure at worst). Next lane of work is
importing the remainder (bucket, rule set + remaining rules, SNS topics,
VPC/ALB/ECS/ECR/IAM) before any apply is thinkable. Note `alb_dns_name` was
planned with a placeholder value — it only feeds the not-imported SNS HTTP
subscriptions; supply the real ALB DNS before importing those.

## 4. Supabase schema drift check — procedure for Pedro (NOT run here; prod DB blocked in this environment)

Goal: confirm the prod Supabase `public` schema matches what
`packages/db/migrations/` (Drizzle, 43 SQL files `0000`…`0042`) produces.

All commands below run from repo root on your machine. Prod connection
string: use the **non-pooling / session-mode** URL (same var migrations use:
`POSTGRES_URL_NON_POOLING` from `.env.production` — port 5432, NOT the 6543
transaction pooler; PgBouncer transaction mode breaks dumps and DDL alike).

### 4a. Dump prod schema (read-only)

Supabase CLI (preferred — matching server version guaranteed):

```sh
supabase db dump \
  --db-url "$POSTGRES_URL_NON_POOLING" \
  --schema public \
  -f /tmp/prod-schema.sql
```

or plain pg_dump (pin the client to the server's major version; mismatched
pg_dump changes output formatting and poisons the diff):

```sh
pg_dump "$POSTGRES_URL_NON_POOLING" \
  --schema-only --schema=public \
  --no-owner --no-privileges --no-comments \
  -f /tmp/prod-schema.sql
```

### 4b. Build the "expected" schema from migrations

Apply every migration to a scratch database, then dump it with the SAME tool
and flags. Using the local Supabase stack's postgres (already running via
`supabase start`, see docs/RUN-LOCAL.md) with a throwaway database:

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c 'CREATE DATABASE drift_check;'

# Run the Drizzle migrator against the scratch DB (same entrypoint prod uses)
POSTGRES_URL_NON_POOLING="postgresql://postgres:postgres@127.0.0.1:54322/drift_check" \
  npx tsx packages/db/src/migrate.ts

pg_dump "postgresql://postgres:postgres@127.0.0.1:54322/drift_check" \
  --schema-only --schema=public \
  --no-owner --no-privileges --no-comments \
  -f /tmp/expected-schema.sql
```

(If `migrate.ts` insists on the full env schema, use the package's own
wiring instead: `POSTGRES_URL_NON_POOLING=... npm run migrate:local -w
@polytoken/db` after pointing the var at `drift_check` — it calls the same
`migrate(db, { migrationsFolder: "migrations" })`.)

### 4c. Diff

```sh
# Normalize whitespace/ordering noise, then diff
diff <(grep -v -E '^(--|$|SET |SELECT pg_catalog)' /tmp/expected-schema.sql) \
     <(grep -v -E '^(--|$|SET |SELECT pg_catalog)' /tmp/prod-schema.sql)
```

- **Empty diff → in-sync.**
- Expected benign noise: extension-owned objects (`vector`, `moddatetime`),
  Supabase-managed grants/roles lines if `--no-privileges` was forgotten,
  and `drizzle.__drizzle_migrations` bookkeeping (it lives in the `drizzle`
  schema, so `--schema=public` already excludes it).
- Real drift looks like: missing/extra tables, columns, indexes (watch the
  HNSW halfvec indexes from `0002`), RLS policies (`0001`, `0007`), triggers
  (`0003`), or RPCs (`0009`).

### 4d. Two cheap cross-checks

```sh
# 1) All 43 migrations recorded as applied in prod?
psql "$POSTGRES_URL_NON_POOLING" \
  -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;'
# expect: 43 (0000..0042)

# 2) Drizzle's own journal consistency (local, no DB):
npm run check -w @polytoken/db     # drizzle-kit check
```

If 4c shows drift that 4d(1) says shouldn't exist, someone changed prod
outside migrations (Supabase Studio edits are the usual suspect) — capture
the diff into a new migration via `npm run migration:generate:custom -w
@polytoken/db` rather than editing prod by hand again.

## 5. What remains / handoffs

1. Import the remaining 49 live-existing resources (S3 bucket, SES rule set
   + 4 rules, SNS topics/policies/subscriptions, VPC/ALB/ECS/ECR/IAM,
   budget) — new runbook section needed with their import IDs.
2. Decide on the S3 state backend (uncomment in `main.tf`, create the state
   bucket, `terraform init -migrate-state`) — until then the imported state
   in this run's working copy is machine-local and easy to lose.
3. Run §4 (Supabase drift check) — blocked here (no prod DB access), Pedro
   must run it.
4. First eventual apply will re-upload the identical Lambda zip
   (`source_code_hash` churn) — expected, verified safe per runbook.
