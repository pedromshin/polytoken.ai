# Cost Assessment — where money goes + top levers

_Assessment lane, 2026-07-24. Read-only. All figures are order-of-magnitude from AWS us-east-1 list
prices; live billing was not consulted (no creds, harness guardrails). Cites are `file:line` in the
committed Terraform / config, which is the ground truth for what is deployed._

## Bottom line

At single-operator scale the spend is small (est. **~$60–90/mo all-in**) and, crucially, the
**variable** cost — model inference — is already well-guarded by a real, enforced circuit breaker.
The waste is structural and fixed: an **always-on Fargate task + a dedicated ALB** (~$34/mo combined)
exist to serve **sporadic inbound-email SNS webhooks**. That pair costs more than everything else on
AWS put together and is the single highest saving-to-effort lever. The forward-looking risks
(graphile-worker, remote desktops, distributed inference) are correctly gated or cheap — except
graphile-worker, which if deployed naively adds a *second* always-on service.

## Where money goes now

**1. AWS Fargate — production listener, always-on 24/7.** `desired_count = 1`
(`variables.tf:36-40`, `ecs.tf:98`) with `cpu = 512` / `memory = 1024` (`locals.tf:19-20`) →
0.5 vCPU + 1 GB running continuously ≈ **$18/mo**. Staging is `desired_count = 0`
(`variables.tf:42-46`) — correctly scaled to zero, no waste there.

**2. Application Load Balancer — the biggest structural waste.** One ALB fronts the single
task (`alb.tf:5-13`) with two listeners (prod :80, staging :8080). ALB base is ~$0.0225/hr ≈
**$16.4/mo** + LCUs, i.e. roughly the same as the compute it fronts. Its only real job is to give SNS
a stable HTTP endpoint for inbound-email delivery (`ses.tf:85-97`, subscriptions target
`http://${alb_dns_name}/v1/emails/inbound-sns`). That is a lot of always-on infrastructure for an
event that arrives a handful of times a day.

**3. Public IPv4.** Tasks run in public subnets with `assign_public_ip = true` and **no NAT**
(`ecs.tf:104`, `network.tf:1-2`) — the right call (NAT would be ~$32/mo). But AWS now bills every
public IPv4 at $0.005/hr ≈ $3.6/mo each; the ALB (2 AZs) + task IP add a few dollars.

**4. Model inference (Bedrock) — the only material variable cost, and it is guarded.** Registry:
Sonnet 4.6 at $3/$15 per Mtok, Haiku 4.5 at $1/$5
(`apps/email-listener/app/domain/services/chat_model_registry.py:79-96`). GenUI uses a
cost-conscious fan-out — 2 candidates + a **Haiku** judge (`settings.py:200-206`). Spend is capped by
an **enforced** `CostCircuitBreaker` (`run_chat_turn.py:166`), not just an alert:
`COST_CAP_PER_TURN_USD = 0.50`, `PER_SESSION = 2.00`, `PER_DAY = 5.00`, `PER_ROUND = 0.15`
(`settings.py:145-150`). This is the strongest cost control in the codebase and it is real code, not
a doc claim.

**5. OpenRouter** — pay-per-use passthrough to cheap open models (DeepSeek $0.27/$1.10, Qwen, GLM,
Gemma; `chat_model_registry.py:98-137`), billed only when selected. Fail-closed if key absent
(`openrouter_chat_adapter.py:72-79`). Negligible at current volume.

**6. WebLLM in-browser inference — a cost *reducer*.** `webllm-qwen3-4b` runs on the visitor's
WebGPU at $0 server cost by design (`chat_model_registry.py:146-153`; ledger still records $0 usage
rows for observability, `chat-cost-ledger.ts` module doc). Every turn pushed to the browser is a
Bedrock turn not paid for.

**7. S3 / SES / Lambda / CloudWatch — pennies, and well-tuned.** Inbound-email S3 has a 30-day
expiry lifecycle (`ses.tf:18-28`); CloudWatch log groups retain 7 days (`ecs.tf:21`); Container
Insights is **disabled** to cut ~$5/mo (`ecs.tf:6-12`). The SES forwarder Lambda (256 MB, 30s,
`ses-forwarder.tf:99-127`) fires only on `pedro@` mail — fractions of a cent.

**8. Off-repo: Vercel + Supabase.** Web app deploys to Vercel (`vercel.json`, Next.js 15). Two
Supabase projects exist — prod `dazyccjijdahxyciptkp` and staging `fyfwkjvbcrmjqjysdyqw`
(`locals.tf:22,35`). Not in Terraform, so cost is unverifiable here, but two projects is two
potential paid lines (or two free-tier instances that auto-pause when idle). Est. Vercel Pro ~$20/mo
+ Supabase $0–50/mo depending on tier. **These are likely the largest single lines after AWS and are
invisible to the committed IaC** — worth a billing-console confirm.

**9. The budget guard — good, but alert-only and email-coupled.** `aws_budgets_budget` at **$30/mo**
account-wide, firing at 80%/100% actual + 100% forecast (`budget.tf:9-41`, default
`variables.tf:89-93`). Two caveats: (a) it is an **alert, not a stop** — it does not halt a runaway;
(b) alerts go to `pedro@magnitudetech.com.br` (`variables.tf:96-99`), whose delivery depends on the
SES `personal-forward` → Lambda → Gmail chain staying intact. If a future SES migration to
polytoken.ai retires the magnitudetech.com.br identity, the one safety net for runaway spend goes
silent. This is a coupling to watch, not a break today.

## Top levers (ranked by saving : effort)

1. **Collapse the always-on Fargate+ALB ingress (~$34/mo → near-zero fixed).** The listener's only
   external trigger is inbound-email SNS. An event-driven ingress — SNS → SQS → an on-demand task, or
   a thin Lambda that fronts the FastAPI logic — removes both the 24/7 task and the ALB. Highest
   structural saving. **Medium effort, and it collides with Landmine 1 (below): restructure ingress,
   do NOT rename the `nauta-services`-derived resources in the same change.**

2. **Confirm and consolidate Supabase + Vercel (potentially the biggest single line).** Verify in the
   billing console whether the staging Supabase project is a paid instance sitting idle; pause or
   downgrade it. Likely the largest quick win after AWS and invisible to the repo. **Low effort.**

3. **Fix / harden the budget guard.** Point `budget_alert_emails` at the Gmail address directly
   (decouple the one runaway-spend alarm from the SES forwarding chain), and add an AWS Budget
   **Action** (or a hard cap) rather than alert-only. **Low effort, high downside-protection.**

4. **Fargate Spot for prod (~$12/mo).** Inbound is SNS-delivered and SNS retries, so a Spot
   interruption is tolerable for an email listener. ~70% off compute via a capacity provider.
   **Low effort.**

5. **Right-size the prod task — but you're flying blind.** 0.5 vCPU / 1 GB may be 2× what a
   low-traffic listener needs (staging runs 0.25/0.5). Dropping to the staging size ≈ halves compute.
   The catch: Container Insights is **off** (`ecs.tf:6-12`), so there is no per-task CPU/mem data to
   right-size against. Turn it on for a week (~$5), measure, resize, turn it off. **Low effort.**

## Coming costs (forward-looking)

- **graphile-worker durable runtime (foundation task, in the roadmap).** A Node worker polling
  Postgres. Two cost shapes to avoid: (a) deploying it as a **second always-on Fargate service**
  doubles the fixed-compute problem lever #1 is trying to solve — co-locate it in the existing
  listener/container or a scheduled task instead; (b) graphile-worker polls Postgres continuously,
  which is **constant Supabase compute/connection load** — size the poll interval and pooling
  deliberately, or it quietly raises the Supabase tier.

- **Remote desktops (RFC cloud-desktop / CD-2+).** Correctly **fails closed today = $0**:
  `getDesktopProvider()` returns the fail-closed floor until an operator flag + budget ceilings are
  set (`remote-desktop-provisioning-plan.md §1`). Cost primitives are already built — per-session
  `hourlyRateCents` + `maxLifetimeMinutes` default 480 (`desktop-sessions.ts:73-74`) and a live cost
  ticker. When flipped, each live desktop is real VM burn (RFC recommends Hetzner, ~€4–15/mo/VM or
  hourly). The gate discipline is sound; the risk is purely the operator flip.

- **Distributed inference (E7).** `remote-peer` execution locus is reserved/unused
  (`chat_model_registry.py:30`, distributed-inference-phase-plan.md); credits economy is
  venture-gated. **$0 today.** If activated, peer-pooling shifts inference *off* Bedrock — a
  potential cost reducer, not adder, at the metering layer.

## Landmines respected (Part C)

- **LM1 — `nauta-services` is the live infra namespace.** `var.project = "nauta-services"`
  (`variables.tf:13-17`) derives the cluster, ALB, SG, S3 bucket and SNS topic names
  (`locals.tf:2`, `ses.tf:15,56`). Lever #1 (restructure ingress) is safe; **renaming** these to
  "polytoken" is a mail-outage hazard (recreates the SES pipeline + DNS). Never fold a cost
  restructure and a rename into one change.

- **LM2 — SES Terraform drift.** The `personal-forward` receipt rule + `polytoken-ses-forwarder`
  Lambda were created out of band and are codified via import (`ses-forwarder.tf:1-16`,
  `IMPORT-RUNBOOK.md`). Any cost-motivated `terraform apply` that has not imported them first can
  **drop the rule that forwards Pedro's mail** — including the budget alert (lever #3 depends on this
  chain). Follow the import runbook before any apply.

- **LM3 — SES sandbox + leaked IAM keys.** If SES is still in sandbox, **no multi-user outbound-mail
  feature can scale regardless of cost work** — it's blocked on AWS production-access approval, not
  code. Separately: IAM keys have been pasted into prompts across sessions — **rotate them.** This is
  filed under security, but it is also the single largest *cost* catastrophe risk: leaked keys =
  unbounded AWS spend, and the only backstop is a $30 alert-only budget that emails a
  soon-to-migrate domain (lever #3).
