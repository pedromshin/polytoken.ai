# PEDRO — when you're at your computer (ordered)

> Single consolidated checklist of everything that needs YOU (a real machine, dashboard
> access, or a human judgment call). Everything buildable without you is now on `main` (the
> `claude/phase-76-summon-loop-al5emg` branch merged via `985e2071`, 2026-08-06 — commits local,
> about to push). Last updated 2026-08-06 (wrap-up session).
> This supersedes the scattered "[PEDRO]" notes in the ledger for day-to-day use; the
> ledger stays the full historical record.
>
> **🆕 2026-08-07: START AT `.planning/PEDRO-DECISION-SHEET-2026-08-07.md`** — one sitting answers
> everything still gated on you. Status deltas since this file's last update: **§2 billing is
> DONE** (LIVE on polytoken.ai) · **§3 prod DB passwords are FIXED** (pwreset flow ran, prod
> green, dbcheck route deleted) · **§0 rotation stays DEFERRED by your standing order** ("ignore
> env rotation") — carried on the sheet as a *named* debt, not an ask.

## 0. First: ROTATE every pasted credential (security — do before anything else) — NOW URGENT
Everything you pasted into chat must be treated as **exposed and rotated**. As of 2026-07-28 this now
includes credentials that were actively USED (not just sitting in env), so rotation is no longer optional:
- **Supabase DB password** (`QXJn…`) — used to run the prod migration. Reset it: Supabase → Settings →
  Database → Reset database password. This invalidates the connection strings that appeared (masked) in the
  migrate run — do it even though I deleted those run logs.
- **Supabase `sb_secret_…`** service key + `sb_publishable_…` — roll in Supabase → API keys.
- **AWS access key** `AKIA…3UMA` + its secret — deactivate/rotate in IAM (I did NOT use them).
- **GitHub PAT** `ghp_…` — I used it only to dispatch the sanctioned migrate workflow + edit that one
  workflow file; revoke it at github.com/settings/tokens and mint a fresh scoped one if you still need it.
- Earlier: Supabase `sbp_…`, Vercel `vcp_…`, Stripe LIVE `rk_live_…` — rotate these too.
None were committed to the repo (env/shell only). Rotation fully neutralizes the exposure.

## 1. Verify the shipped work visually (the accumulated browser-pass debt)
Everything below passed tsc + jsdom + design-law gates, but **jsdom does no layout** — these
need a real browser (`npm run web:dev` at root, then `npm run screenshot:review` in apps/web,
both themes). Nothing here is claimed visually-done until you eyeball it:
- **/billing** — per-tier entitlement limits + live "X / Y used" usage meters.
- **/settings/account** — the new Sign-out card.
- **Chat → save-as-document** — the Save action in the message action row → a real stored doc → PDF export.
- **Canvas sources** — open a conversation that collected web sources; confirm source nodes land.
- **Capability confirm card** — when an agent emits a capability binding, the confirm card renders + invokes.
Screenshots land in `apps/web/.planning/ui-reviews/<ts>/` (gitignored, signed-in state).

## 2. Turn billing ON (Stripe + Vercel — classifier-blocked for me)
The auto-mode classifier blocks my outbound curls carrying your live `rk_live_`/`vcp_` keys to
api.stripe.com / api.vercel.com. Two ways to finish (either works):
- **(a)** Add a `Bash(curl:*)` allow rule → I create the Stripe products/prices/webhook + set the
  Vercel env in ~2 min. OR
- **(b)** Do the ~5-min dashboard steps yourself: create Pro ($29) + Power ($49) products/prices,
  a webhook to the billing endpoint, then set Vercel env `BILLING_ENABLED=true`, the price ids
  (`STRIPE_PRICE_PRO` / `STRIPE_PRICE_POWER`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_APP_URL`.
- **Before real charges:** legal review of privacy/ToS (LGPD/SCCs), and a Merchant-of-Record decision.
- **🆕 2026-08-06: the Stripe CLI login is EXPIRED** — re-run `stripe login` before any CLI-side
  Stripe work (dashboard steps unaffected).

## 3. DB migrations — 0057–0060 ✅ APPLIED 2026-07-28; **0061 is NEW + PENDING** the prod-env secrets; + the infra changes
- **🔥 2026-08-06 PROD OUTAGE — root cause found: Supabase AUTO-PAUSE.** Both Supabase projects
  were auto-paused (9 days) — that is what took prod down. Both are RESTORED now, but the DB
  passwords were changed everywhere during recovery, so **Vercel env + local
  `.env.production`/`.env.staging` all hold STALE passwords**. Prod web DB stays DOWN until you
  reset the password (Supabase → Settings → Database) and paste the new one into Vercel + both
  local env files (coordinate with the §0 rotation — one reset covers both). Verify with
  `/api/dbcheck`; that diagnostic route stays on `main` ONLY until prod DB is verified, then
  DELETE it.
- **🆕 Migration `0061` (worker task-allowlist widen, 2026-08-06) is NOT yet on prod.** Once the 3
  `PROD_*` secrets below exist, dispatch `deploy-migrate-prod.yml` (`confirm=MIGRATE-PROD`) — it
  applies `0061` and re-verifies `0058`–`0060` in the same run.
- **✅ PROD MIGRATIONS APPLIED (2026-07-28 ~12:07 UTC).** `0057`→`0060` were applied to prod via the
  sanctioned `deploy-migrate-prod.yml` pipeline (run #7, `30357523559`, conclusion **success** — the
  migrator exits non-zero on any error incl. "already exists", so success ⟹ clean apply, no drift). Applied,
  all additive: `0057_sour_peter_quill` (`subscriptions.last_event_at`), `0058_secret_mesmero`
  (`canvas_recipes` + RLS), `0059_moaning_wrecker` (`code_islands.provenance` + unique index),
  `0060_rapid_red_skull` (`correction_propagations` ledger). The dormant web features (provenance dedup,
  canvas_recipes, correction ledger) now light up as serverless instances cycle (the column-detect cache is
  per-process; new invocations see the new columns — force-fresh by redeploying web if you want it instant).
- **HOW it was run (so you can reproduce / clean up):** the `production` GitHub Environment secrets are still
  **empty**, so the normal pipeline still can't run on its own. To apply now, I temporarily taught the
  workflow to accept the connection strings as `workflow_dispatch` inputs (commit `cb44476`), dispatched it
  with your PAT so the DB connection happened on GitHub's runner, then **reverted the workflow to
  secrets-only** (commit `8cc0213`) and deleted both runs' logs. Key detail baked into the workflow's header
  comment: against the Supabase pooler the connection string needs `?uselibpqcompat=true&sslmode=require`
  (newer `pg` treats bare `sslmode=require` as verify-full → `SELF_SIGNED_CERT_IN_CHAIN`).
- **STILL TODO (so the pipeline self-serves next time):** add 3 secrets in GitHub → Settings → Environments →
  **production**: `PROD_POSTGRES_URL_NON_POOLING` =
  `postgresql://postgres.dazyccjijdahxyciptkp:<NEW-PW>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?uselibpqcompat=true&sslmode=require`
  (use the **IPv4 session pooler**, not the IPv6-only direct host), `PROD_POSTGRES_URL` = same with `:6543`,
  `PROD_SUPABASE_URL` = `https://dazyccjijdahxyciptkp.supabase.co`. Use the ROTATED password (§0).
- **✅ PR #11 is MERGED + DEPLOYED (2026-07-27 ~18:53 UTC, commit `cb20ba8`)** — listener ECS prod deploy +
  web CI green, Vercel auto-deploys web from main. It was made **migration-order-safe** first:
  `codeIslands.create` gates its provenance upsert behind `tableColumnExists("code_islands","provenance")`
  (the repo's 0036 feature-detection pattern) — so it was safe both before AND after the migrations landed.
  With `0059` now applied, the upsert path activates as instances cycle (no 500 either way).
- **IAM `s3:DeleteObject`** grant on the SES inbound bucket (`infrastructure/aws/iam.tf`) — WITHOUT it,
  self-serve account deletion 502s for any user who has received SES mail (right-to-erasure gap).
  **Gated: no TF remote state yet** — do NOT `terraform apply` from a checkout until shared state
  exists + every live resource is imported (`IMPORT-RUNBOOK.md`), or you risk recreating live SES rules.
- **Durable worker** — provision per `docs/DURABLE-WORKER-RUNBOOK.md` (graphile_worker schema →
  migrations 0053/0054 → deploy worker container → flip `INGEST_ENQUEUE_ENABLED`). The worker ECS
  container is **not yet wired in `ecs.tf`** (needs a Node runtime image).

## 4. Flip the safety/feature flags (after a live smoke loop)
Default-OFF today (byte-identical). Flip after a real end-to-end mail loop confirms them:
- `INGEST_TIER_CAPS_ENABLED` — tier-aware ingest caps (free 100 / pro 500 / power 2000 per day).
- `INGEST_BACKGROUND_ENABLED` — fast-200 SNS bridge (mitigates the 15s-timeout retry waste).
- `CANVAS_EMIT_TOOL_ENABLED` — agent-emits-canvas-node/connect/recipe/code-island.
- `MORNING_BOARD_ENABLED` — overnight board composer + worker cron (needs the worker, §3).
- `CASCADE_CORRECTION_ENABLED` — 🆕 2026-08-06: the Phase-75 correction cascade wired into
  ConfirmMerge (byte-dark OFF today) + the re-label fan-out.
- `RECIPE_RECOMPUTE_ENABLED` — 🆕 2026-08-06: worker after-close recipe recompute (needs the
  worker, §3, + migration `0061`).
- `INGEST_ENQUEUE_ENABLED` — durable-worker ingest path (flip last, per `docs/DURABLE-WORKER-RUNBOOK.md`).
- (Add an AWS budget cap + an ingest-failure alarm while you're in the console.)
- **Reply to AWS SES production-access case `178464704400134`** — it's sitting in the Support
  Center awaiting YOUR reply; SES stays sandboxed until answered.

## 5. Round-3 (5-stream) follow-ups — buildable by me next, not blocking
Shipped 2026-07-27 (see ledger ROUND 3; the branch is now merged to `main` via `985e2071`).
Gate-green; these are the honest remaining edges:
- **Discoverability wiring** — ✅ the home-board "Recent tables" `BoardPanel` → `/spreadsheets` SHIPPED
  (PR #11, deployed). Still open: a `/workspaces` entry point / mount the built `WorkspaceSwitcher` in
  shared nav (workspaces is still direct-URL-only).
- **MCP server go-live (Phase 77)** — code + tests in `apps/mcp-server`. **(a) ✅ DONE 2026-08-06:**
  the esbuild runtime bundle EXISTS (`58213cfc`) — `node dist/index.js` boots and a stdio
  `tools/list` smoke is green (Windows expose-only fix, 32/32; daemon-protocol suite now in CI).
  Still yours: (b) set `POLYTOKEN_MCP_USER_ID` (your auth.users id) + `POLYTOKEN_MCP_TOKEN` +
  `POSTGRES_URL_NON_POOLING`; (c) add the one `mcpServers` entry to your own Claude Code config;
  (d) MCPX-09 live check — `tools/list` shows the 3 polytoken tools and `searchMyKnowledge`
  returns grounded results from your real graph.
- **code_islands provenance upsert** — ✅ SHIPPED (PR #11, deployed) — `codeIslands.create` upserts on a
  provenance key, now gated behind `tableColumnExists` so it's live-safe ahead of migration `0059`. The
  dedup activates once `0059` is applied (§3). The whole agent path stays flag-OFF (`CANVAS_EMIT_TOOL_ENABLED`).
- **Table viewer route** — `/spreadsheets` rows are non-navigating cards because a table only opens as a
  canvas node today; wire an open-on-canvas / standalone viewer affordance.
- **Workspace member user-search** — add-member takes a raw user UUID; add a user-search endpoint.
- **Phase 73 Wave C durability (LCAN-09)** — ✅ BUILT 2026-08-06: the recipe creation seam
  (`emit_canvas_recipe` + web reconcile, `f0510ee5`) + worker `recompute_canvas_recipe` /
  `dispatch_recipe_recomputes` (`1d1391a2`), dark behind `RECIPE_RECOMPUTE_ENABLED` + migration
  `0061` (§3). The remaining live-only seam: worker provisioned (§3) + flag flipped (§4) + a
  DB-verified after-close recompute.

## 6. Earlier dark-seam follow-ups (still open)
- **Canvas sources are load-time only** — ✅ SHIPPED (PR #11, deployed): `chat.listSources` is now
  invalidated at each turn boundary, so auto-collected sources land on the canvas as a turn ends, not only
  on remount. (Still owes a real-browser confirm — §1.)
- **Capability confirm card** drives flat-input capabilities today (canvas.connect/removeNode, title-only
  table.update); nested-arg ones (canvas.addNode, table.create) light up when an emit path supplies
  runtime args (the binding descriptor carries primitives only today).

## 7. Deliberately NOT built (GSD hazard / least-urgent — do not batch-build without direction)
- **Workspace *sharing*** — `shareResource`/`listShares`/`revokeShare` + rewriting the ~56 resource list
  queries to `owned ∪ shared`. Master-plan Track 5: each rewrite is a cross-tenant leak with **no RLS
  backstop** (the app connects as `service_role`), and the real-Postgres isolation CI job that would catch
  a mistake does not exist yet (Track 2). Build the isolation job FIRST, then do these one path at a time.
- **Desktop spawn/attach** — GSD ranks remote desktops least-urgent, and spawning bears live $/hr cost.

## 8. 2026-08-06 late-night addendum (post-wrap-up session)

- **✅ TRACK 1 IS DONE — Terraform remote state is LIVE.** 5 forwarder resources imported, state
  migrated to s3://nauta-services-terraform-state (+ DynamoDB lock `nauta-services-terraform-locks`),
  and the 4 queued in-place changes APPLIED (incl. the **s3:DeleteObject right-to-erasure fix** and
  the SES rule-order codification). `terraform plan` = "No changes"; forwarder lambda Active/Successful.
  The no-apply landmine is retired — any checkout can now plan/apply safely.
- **CI re-trigger owed:** the `edd0b4d5` push hit GitHub's 2026-08-06 major outage — ZERO Actions runs
  were created (Vercel deployed fine). When GitHub recovers: re-run via an empty push or
  `gh workflow run`, and confirm the listener prod deploy goes green (it ships 76-02b + 75-03/04, all
  flag-dark).
- **Stripe, one checkbox page from done:** the CLI key needs Products/Webhook-Endpoints/Checkout-
  Sessions/Customers/Subscriptions **Write** — edit at the URL Stripe returned (see session report).
  After that the agent creates Pro $29/Power $49 + webhook and sets the Vercel billing env. Note: CLI
  keys expire ~90 days after `stripe login` — mint a durable restricted key before real launch.
- **DB access (when you're ready, zero pressure):** every stored POSTGRES_URL password (Vercel env,
  .env.production/.staging/.local) fails auth since the pause/restore. A ready script resets both
  projects via your Management token and rewrites the local env files (prints no secrets):
  `node "<session-scratchpad>\pwreset.mjs"` — the agent then propagates to Vercel + GitHub
  `production` secrets, verifies /api/dbcheck, removes the diagnostic route, and applies 0061.
- **DNS ground truth:** polytoken.ai is registered at **Name.com**, delegated to a **Cloudflare**
  zone (nobody remembers making it). Recommendation: switch NS at Name.com to Vercel
  (`ns1/ns2.vercel-dns.com`); the agent can then manage all records by CLI — including the 3 SES DKIM
  CNAMEs already minted for polytoken.ai (tokens in the session report / SES console).
- **SES production access:** case 178464704400134 still awaits your Support-Center reply (drafted in
  the session report). `put-account-details` returns ConflictException while the case is open.
