# BATCH A — the "unblock everything" sitting (~45–60 min, ordered)

> Run top to bottom. Every step's heavy lifting is pre-staged; you paste/click/approve.
> Decisions (7 seams · SES draft · Legal/MoR) are on
> [PEDRO-DECISION-SHEET-2026-08-07.md](PEDRO-DECISION-SHEET-2026-08-07.md) — they were
> provisionally filled with recommended defaults under your nonstop order
> ([ASSUMPTIONS-2026-08-07.md](ASSUMPTIONS-2026-08-07.md)); backcheck them whenever.

## 0 · Session hygiene (1 min)
- Open a **fresh Claude Code session** in this repo. That alone loads gsd plugin **4.5.3**
  (`/reload-plugins` doesn't exist in the VSCode env — fresh session is the mechanism) AND the
  `.claude/settings.local.json` allowlist (which may clear several classifier blocks below).

## 1 · Staging DB repair (2 min, from repo root)
```
node scripts/staging-repair.mjs --yes
npm run db:migrate:staging
```
Second command must finish green with nothing pending. (Dry-run verified ×2; prod-ref refusal armed;
installs graphile_worker schema on staging as part of the run.)

## 2 · Prod migration 0061 (5 min)
1. GitHub → repo Settings → Environments → **production** → add 3 secrets (values = your current
   `.env.production`; format in [PEDRO-CHECKLIST.md](PEDRO-CHECKLIST.md) §3 — non-pooling URL needs
   `?uselibpqcompat=true&sslmode=require`): `PROD_POSTGRES_URL_NON_POOLING`, `PROD_POSTGRES_URL`,
   `PROD_SUPABASE_URL`.
2. **Schema first** (hard order — 0061 RAISEs without it), from repo root:
   `node apps/worker/dist/install-schema.js` with prod `GRAPHILE_WORKER_CONNECTION_STRING`/DB URL
   env (session-mode :5432 URL — see runsheet §CUT-04 in
   [milestones/vlaunch-prep/0a-runsheet-pack.md](milestones/vlaunch-prep/0a-runsheet-pack.md)).
3. Actions → `deploy-migrate-prod.yml` → Run workflow → `confirm=MIGRATE-PROD`. Applies 0061,
   re-verifies 0058–0060.

## 3 · Worker enable, staging leg (15 min — runsheet has every command)
Follow [milestones/vlaunch-prep/0a-runsheet-pack.md](milestones/vlaunch-prep/0a-runsheet-pack.md)
§CUT-02 → §CUT-05, in order:
1. Repo variable `WORKER_DEPLOY_ENABLED=true` (GitHub → Settings → Variables) → CI pushes the
   worker image to ECR on next main push (or re-run the latest deploy workflow).
2. Secrets Manager: create the staging session-mode DB-URL secret (**:5432, never :6543** —
   transaction pooling silently breaks LISTEN/NOTIFY).
3. `worker_db_url_secret_arn_staging` in tfvars → `terraform plan` → **ZERO-CHURN GATE**: allowed
   changes are exactly task-def revision + service update + read-secrets policy. **ANY SES/SNS/
   inbound-S3/ALB line = STOP.** Also expect "No changes" for the new `ingest_enqueue_enabled_*`
   wiring while unset (ASSUMPTIONS **A8** — this plan IS its backcheck). Then apply; watch first
   roll for OOM (256/512 shared task; bump command in the sheet).

## 4 · Stripe durability (5 min, dashboard)
Mint a **durable restricted key** (Products/Checkout/Customers/Subscriptions/Webhooks write),
swap into Vercel `STRIPE_SECRET_KEY` + redeploy, and rotate/revoke the old pasted `rk_live_` and
the ~2026-11-04-expiring CLI key.

## 5 · Clicks (15 min, evidence harness is armed)
- **BILL-04**: on polytoken.ai — Subscribe → Stripe Checkout (your card) → open portal → cancel.
  Then tell the session "BILL-04 done" — it runs
  [milestones/vlaunch-prep/0b-bill04-harness.md](milestones/vlaunch-prep/0b-bill04-harness.md)
  and files the evidence.
- **BTAP-07**: flip `CANVAS_EMIT_TOOL_ENABLED` (listener env — flip mechanism per runsheet), then
  in live chat with ≥2 published source nodes say "build me a reconciler for these".
- **MCPX-09**: add one `mcpServers` entry to your own Claude Code config pointing at
  `node apps/mcp-server/dist/index.js` with the three env values described in
  [PEDRO-CHECKLIST.md](PEDRO-CHECKLIST.md) §5 (your `auth.users` id — look it up by your email —
  a token string you mint, and the prod non-pooling DB URL you already hold). Then in that
  session call `searchMyKnowledge` and confirm the cited node ids exist.

## 6 · Async homework (no sitting needed)
- Paste the SES reply (decision sheet §C1) into the Support Center — case `178464704400134`.
- Skim the decision sheet §B/§C ASSUMED defaults + [ASSUMPTIONS-2026-08-07.md](ASSUMPTIONS-2026-08-07.md)
  A1–A10; flag anything wrong.
- Optional: Name.com NS → `ns1/ns2.vercel-dns.com` (then DKIM goes CLI-manageable).

**After this sitting** the agent runs Wave 1–2 without you (staging cutover rehearsal, BILL-04
verification, burn-down fill-ins). Batch B (prod flips + first dollar + close) comes only after
staging rehearsal is green.
