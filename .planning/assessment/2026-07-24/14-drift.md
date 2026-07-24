# Drift Assessment — AWS↔Terraform, Supabase↔migrations

**Lane:** Declarative drift. **Date:** 2026-07-24. **Branch:** `claude/polytoken-email-infra-cont-qi9q5g`.
**Method:** committed IaC + migration artifacts only. No live AWS/psql calls (harness block + no creds). Every claim cites `file:line`.

## Bottom line

The SES console-vs-Terraform gap that the handoff flagged as landmine 2 has **already been codified** (`ses-forwarder.tf`, `IMPORT-RUNBOOK.md`, dated 2026-07-23). That is good news — it is no longer an invisible gap. But codifying it **created a larger, structural hazard that now dominates the drift picture**: there is **no Terraform remote state backend** (`main.tf:15-20` — the S3 backend is commented out). State is local/ephemeral, so on any checkout that lacks the imported state file, `terraform apply` treats every live resource — SES rules, the forwarder Lambda, the S3 bucket, SNS topics, ECS, ALB — as new. The entire IMPORT-RUNBOOK depends on importing into a state that is neither shared nor persisted. **This is the single highest-blast-radius drift item and the real thing standing between "someone runs apply" and "Pedro's mail stops."**

On the DB side, prod/staging schema was built by **manually replaying migration SQL through the Supabase Management API and hand-inserting `drizzle.__drizzle_migrations` tracking rows** (`MORNING-CHECKLIST.md:608-625`, `ORCHESTRATOR-STATE.md:157-168`). The native drizzle migrator is only trustworthy on fresh DBs. The "0050 tracking-row loose end" is a cosmetic, self-healing symptom of that hand-maintained model; the real latent trap underneath it is **non-monotonic journal `when` timestamps** plus **drizzle-kit snapshot drift**.

## Drift inventory, ranked by blast radius on `apply`

### 1. [CRITICAL] No Terraform remote state backend — state is local & ephemeral
`main.tf:15-20`: the `backend "s3"` block is commented out (`# backend "s3" { bucket = "nauta-services-terraform-state" ... }`). There is no shared state. Consequences:
- A fresh checkout has an **empty state**. `terraform apply` would try to **create** the live S3 bucket `nauta-services-ses-inbound-emails` (`ses.tf:15`), SNS topics (`ses.tf:54-57`), the `nauta-services-inbound` receipt rule set (`ses.tf:111`), all receipt rules, the forwarder Lambda/role, and the ECS/ALB stack — every one collides on name or silently duplicates.
- The IMPORT-RUNBOOK's five `terraform import` commands (`IMPORT-RUNBOOK.md:63-75`) write into **local** state that no other session/machine sees. Import discipline is un-shareable and un-auditable.
**Codify-before-touch:** create the state bucket, uncomment the backend, and `terraform import` **every** live resource (not just the 5 forwarder ones) into it before any plan is ever run against account `271369143207`. Nothing below is safe until state reflects live reality.

### 2. [HIGH] SES forwarder is codified but NOT imported — apply against un-imported state = mail outage
`ses-forwarder.tf` + `IMPORT-RUNBOOK.md` codify resources that "already exist live … created outside Terraform" (`ses-forwarder.tf:5-15`): Lambda `polytoken-ses-forwarder`, role `polytoken-ses-forwarder-role`+inline policy, `ses-invoke` permission, and receipt rule `personal-forward`. The `forwarding-catchall` rule's `after` was re-pointed from `agent-prod` to `personal-forward` (`ses.tf:207`) to match live chain order `agent-local → agent-staging → agent-prod → personal-forward → forwarding-catchall` (`IMPORT-RUNBOOK.md:19`). The `stop_action` scope=RuleSet on `personal-forward` (`ses.tf`/`ses-forwarder.tf:173-176`) is what keeps `pedro@` mail out of the prod agent pipeline. **If applied against state that lacks these imports, Terraform recreates/reorders the rule set and can drop the rule that forwards Pedro's mail.** Entirely a consequence of #1; whenever state is empty this fires.

### 3. [HIGH] Forwarder Lambda env values are asserted, never read from live
`ses-forwarder.tf:113-126` sets `BUCKET/PREFIX/FORWARD_TO/MAIL_FROM`; the code comment (`ses-forwarder.tf:113-118`) and runbook (`IMPORT-RUNBOOK.md:33-47`) state the live env **values were never read** during drift capture. `MAIL_FROM` was already corrected once — from an assumed `no-reply@` to the actual `forward@magnitudetech.com.br` after the first post-import plan showed a diff (`ses-forwarder.tf:36-40`). Any remaining mismatch means a blind apply silently rewrites the function's environment and breaks forwarding. Mitigation exists only as procedure ("inspect the `environment` diff before apply", `IMPORT-RUNBOOK.md:43-47`), not as a guard.

### 4. [HIGH] Inbound-mail DNS (MX, DKIM, domain verification) is entirely out of band
`grep` across `infrastructure/aws/` for `route53|MX|dkim|aws_ses_domain_mail_from|_dmarc` returns **nothing**. The MX record that routes `@magnitudetech.com.br` inbound mail to SES, the `_amazonses` TXT verification (only surfaced as an output hint, `ses.tf:6-9`), and DKIM are all managed at the registrar with zero codification. This is a permanent declarative gap: Terraform can rebuild the SES pipeline but cannot rebuild the DNS that feeds it, and nothing in-repo records the required records. Blast radius is on **teardown/rebuild**, not routine apply — but it means "recreate the SES pipeline" (landmine 1's cost) is understated: DNS re-pointing is manual and undocumented in IaC.

### 5. [MEDIUM] drizzle-kit snapshot drift — `generate` will corrupt the next migration
`ls migrations/meta/` stops at `0047_snapshot.json`. **No snapshot exists for 0048, 0049, 0050** (all hand-written SQL: `0048_secure_rls_chat_telemetry`, `0049_generalize_entity_types`, `0050_purge_maritime_data`), plus older gaps (0010-0012, 0015, 0017, 0025-0029). Runtime is unaffected — `_journal.json` has all 51 entries (idx 0-50), so `migrate` (`src/migrate.ts:81`) applies correctly. But `drizzle-kit generate` diffs the schema against the **stale 0047 snapshot** and would re-emit DDL for everything 0048+, producing a corrupt/duplicate migration. Authoring-time hazard: the next person who runs `generate` instead of hand-writing SQL gets a broken migration.

### 6. [MEDIUM] Non-monotonic journal `when` timestamps — latent silent-skip trap
`_journal.json`: 0036 `when=1784227200000` but 0037/0038/0039 `when=1784093875902 / 1784103700170 / 1784108349679` — **earlier** than 0036. Drizzle's migrator gates on `max(created_at)` vs each entry's `folderMillis` (=journal `when`), and the manual tracking-row path inserted `created_at = when` (`MORNING-CHECKLIST.md:617-621`). A fresh DB is safe (lastDbMigration null → all apply in idx order). **But an environment stamped exactly through 0036 and then switched to native `migrate` would treat 0037-0039 as already-applied (their `when` < recorded max) and silently skip them.** Given the hand-maintained tracking history, that boundary is plausible for a rebuilt staging/local DB. Latent, not currently firing (all live envs are past 0050).

### 7. [LOW / self-healing] 0050 tracking row missing on prod
`ORCHESTRATOR-STATE.md:157-168`: 0050 was applied to prod 2026-07-24 via the Management API (data purged, atomic), but the `drizzle.__drizzle_migrations` row insert was blocked by the safety classifier. Because 0050 is idempotent (empty arrays → all-no-op, `0050_purge_maritime_data.sql:26`), the next `migrate` re-runs it as a no-op and records the row. Cosmetic. It matters only as evidence that **prod's tracking table is hand-maintained and unaudited** — see #6.

### 8. [CONSTRAINT, not a fix] `nauta-services` namespace is bound to live infra — landmine 1
`variables.tf:16` (`project` default `"nauta-services"`), `locals.tf` (`tg_prefix = "nauta-el"`), rule set `${var.project}-inbound` = `nauta-services-inbound` (confirmed by import ID `IMPORT-RUNBOOK.md:75`), bucket `nauta-services-ses-inbound-emails` (`ses.tf:15`). These names key the live S3 bucket, SNS topics, SES rule set, and ALB target groups. **Renaming any = recreate + re-point DNS = outage.** Record as an immovable constraint; the maritime *domain-model* purge (0050) is unrelated and safe. Do not fold the two.

### 9. [OBSERVATION] Mail domain (`magnitudetech.com.br`) ≠ app domain (`polytoken.ai`)
`ses.tf:2-3` hardcodes SES identity `magnitudetech.com.br`; all receipt-rule recipients and `MAIL_FROM` use `@magnitudetech.com.br`. The prod web app is `polytoken.ai`. This is **intentional** (magnitudetech.com.br is the verified SES inbound domain) but reads like drift and a future reader may "fix" it. Flag so nobody renames the SES domain to match the app.

## Recommended codify-before-touch order
1. **State first.** Create the state bucket, uncomment `main.tf:15-20`, `terraform import` **all** live resources (SES/S3/SNS/Lambda/IAM/ECS/ALB) into shared state. Until this is done, treat `terraform apply` against prod as forbidden.
2. **Forwarder imports** (`IMPORT-RUNBOOK.md:63-75`) into that shared state; confirm plan shows only the acceptable diffs (`source_code_hash` churn, `after` no-op — `IMPORT-RUNBOOK.md:86-98`).
3. **Verify Lambda env plan diff = none** before any apply (#3).
4. **Codify DNS** (#4) — at minimum document the required MX/TXT/DKIM records in-repo; ideally import Route53 or add an out-of-band DNS runbook so teardown is recoverable.
5. **Fix snapshot drift** (#5) — backfill/regenerate snapshots for 0048-0050 before anyone runs `drizzle-kit generate`.
6. **Guard journal monotonicity** (#6) — add a test asserting `when` is strictly increasing by idx, or accept-and-document that all live envs are past 0050.
7. **0050 tracking row** (#7) — insert or let self-heal. Lowest priority; not blocking.

## Caveats
- Cannot confirm live AWS or live `__drizzle_migrations` contents (harness blocks + no creds). #1-#4 reason from committed IaC; #5-#7 from committed migration artifacts + planning notes. The IMPORT-RUNBOOK and ORCHESTRATOR-STATE claims (imports done, 0050 applied) are **unverified against live** — verify against state/DB before acting.
- Separate security follow-up already flagged in `ORCHESTRATOR-STATE.md:164`: rotate the `sbp_` Supabase Management API token pasted this session; the same pattern (IAM keys / tokens pasted in prompts) is landmine 3 and belongs to the security lane.
