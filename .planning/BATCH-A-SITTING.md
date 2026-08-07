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

## 1 · Staging DB repair — ✅ **DONE 2026-08-07**
```
node scripts/staging-repair.mjs --yes     # "61 rows recorded / Nothing pending"
npm run db:migrate:staging                # green, 44 tables
```
**Independently verified read-only afterwards** — staging is ALL GREEN: `graphile_worker` schema
present (5 tables), `public.enqueue_job(text,jsonb,integer,text)` exists, **all 7 allowlist
identifiers** present (`ingest_inbound_email`, `deep_research`, `assemble_morning_board`,
`dispatch_morning_boards`, `cascade_relabel`, `recompute_canvas_recipe`,
`dispatch_recipe_recomputes`), journal reconciled 61/61.

> ⚠️ **Correction to this step's old claim.** It said the repair "installs graphile_worker schema
> as part of the run." It does not, on this path: `staging-repair.mjs` `process.exit(0)`s at
> *"Nothing pending"* **before** the graphile check ever runs. Staging happened to already have the
> schema, so the outcome was right by luck, not by mechanism. If you ever rebuild staging, install
> the schema explicitly (`apps/worker/dist/install-schema.js`) — do not rely on the repair script.

## 2 · Prod migration 0061 (5 min)
1. Publish the 3 secrets into the GitHub **Production** environment (values from your
   `.env.production`; the pooler needs `?uselibpqcompat=true&sslmode=require` appended — the agent
   is classifier-blocked from doing this, so it is scripted):
   ```
   pwsh -File scripts/set-prod-env-secrets.ps1          # dry run — shows what it would set
   pwsh -File scripts/set-prod-env-secrets.ps1 -Apply   # writes PROD_POSTGRES_URL_NON_POOLING,
                                                        # PROD_POSTGRES_URL, PROD_SUPABASE_URL
   ```
   It refuses any value lacking the prod project ref, pipes via stdin (never a command line), and
   prints names/lengths only. **If the run reports a stale password later**, reset it in Supabase
   and re-run with `-Apply` — the secrets are overwritten in place.
   ✅ **DONE 2026-08-07** — all three set on `pedromshin/polytoken.ai` env `Production`
   (both DB URLs went in with `compat=True`; `PROD_SUPABASE_URL` is the plain project URL).
2. **Schema first** (hard order — 0061 RAISEs without it):
   ```
   pwsh -File scripts/prod-graphile-preflight.ps1           # read-only: is the schema there?
   pwsh -File scripts/prod-graphile-preflight.ps1 -Apply    # install it (idempotent)
   ```
   > ⚠️ The old instruction here (`node apps/worker/dist/install-schema.js`) would have failed
   > on the first command — **that dist did not exist**; nothing builds `@polytoken/worker` in
   > the local flow. It is built now, and the script checks for it and refuses with the build
   > command if it is ever missing again. The script also enforces the session-mode `:5432`
   > requirement (transaction mode silently breaks LISTEN/NOTIFY) and appends the pooler compat
   > query string.
3. Dispatch the migration:
   ```
   gh workflow run deploy-migrate-prod.yml -f confirm=MIGRATE-PROD
   ```

✅ **§2 COMPLETE 2026-08-07.** Secrets set · schema installed · run `31213827515` **success** ·
verified read-only `ALLOWLIST: 7/7`, `GRANT: service_role EXECUTE = YES`.
⛔ Prod reads `recorded=59/61` **permanently and correctly** — 0053/0054 are superseded by 0061
and must NEVER be applied (0054 would downgrade the live allowlist to 4 identifiers). Full
reasoning in [PEDRO-CHECKLIST.md](PEDRO-CHECKLIST.md) §3.

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
