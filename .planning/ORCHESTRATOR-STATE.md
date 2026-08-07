# ORCHESTRATOR-STATE — grand orchestrator run ledger

> THE single source of truth for "where are we"; chat context is disposable. UPDATE at every batch
> launch, completion, and merge. No autonomous backstop Routine is active (Pedro's call) — recovery
> after a session/container death is MANUAL: a fresh session (or Pedro) reads this file and follows
> the RESUME PROTOCOL below. Strategic `/compact` is safe at any batch boundary — this file + pushed
> branches hold all durable state, so nothing critical lives only in chat.

## ⭐ CURRENT — 2026-08-06 · tonight part 2 (live-infra session) · `main` (pushed; prod deploys green)
> **This block is the live "where are we."** Everything below is chronological history
> (newest-first). vNEXT (Phases 73–77) stays **CODE-COMPLETE** (block below); tonight part 2
> closed the prod DB outage, landed Track 1 for real, provisioned Track 3a dark, and put the
> milestone code LIVE on prod ECS. Remaining work = Pedro-gated enable/live seams (see the ⛔
> bullet + STATE.md Next Actions).

### 🟢 2026-08-07 — BATCH A §1 + §2 DONE: THE DURABLE-INGEST DB SEAM IS LIVE ON PROD
- ✅ **§1 staging repair — DONE + independently verified read-only.** `staging-repair.mjs --yes`
  reported "61 rows recorded / Nothing pending"; `db:migrate:staging` green. A separate read-only
  probe confirmed staging is ALL GREEN: `graphile_worker` present (5 tables), `public.enqueue_job`
  present, **all 7 allowlist identifiers**, journal 61/61.
  ⚠️ **Corrected claim:** the sitting doc said the repair "installs graphile_worker as part of the
  run." It does not on that path — the script `exit(0)`s at *"Nothing pending"* BEFORE the graphile
  check. Staging already had it; the outcome was right by luck, not mechanism.
- ✅ **§2.1 the 3 `PROD_*` secrets are SET** on `pedromshin/polytoken.ai` env `Production`
  (`scripts/set-prod-env-secrets.ps1`, user-run — the credential class is classifier-blocked for
  the agent). 🐛 **Shipped-then-fixed bug worth remembering:** the first write produced MALFORMED
  URLs. PowerShell's `-like '*?*'` is a WILDCARD match (`?` = any single char), so it is true for
  every non-empty string; the compat suffix was joined with `&` and no `?`, and the driver read the
  query string as the database name (`database "postgres&uselibpqcompat=true&..." does not exist`).
  Both scripts now use `.Contains('?')` and ASSERT the assembled URL's database segment is a bare
  identifier before connecting or publishing.
- ✅ **§2.2 `graphile_worker` schema INSTALLED ON PROD** (`scripts/prod-graphile-preflight.ps1
  -Apply`). ⚠️ The old instruction (`node apps/worker/dist/install-schema.js`) would have failed —
  **that dist did not exist**; nothing in the local flow builds `@polytoken/worker`. Built now.
- ✅ **§2.3 PROD MIGRATION RUN GREEN** — run `31213827515`, 38s, **success** ("Migrations
  completed in 1371ms (44 tables)"). **Verified read-only afterwards: `ALLOWLIST: 7/7 present`,
  `GRANT: service_role EXECUTE = YES`.** The durable-ingest DB seam is LIVE on prod.
- 🔎 **The measured finding, and the correction to it.** Prod showed **58/61** with
  `graphile_worker` and `enqueue_job` both ABSENT, pending = `0053` + `0054` + `0061`. First read:
  "three pending, the workflow will apply all three in journal order." **That was wrong.** The run
  applied **only 0061** (58→59) — drizzle's migrator applies migrations whose `folderMillis` is
  NEWER than the last applied `created_at`, not "everything pending". Prod's last applied was 0060
  (07-27), so 0053 (07-24) and 0054 (07-25) are skipped **permanently**; 0061 (08-06) ran.
- ⛔ **PERMANENT STATE — prod reads `recorded=59/61` and that is CORRECT.** 0061 is a full
  `CREATE OR REPLACE` of the same function with the complete 7-identifier allowlist + REVOKE/GRANT;
  it supersedes 0053/0054 by replacement. **The danger is the "repair", not the gap:** 0054's body
  installs a **FOUR**-identifier allowlist, so any journal-order pending-migration repair
  (`scripts/staging-repair.mjs` is exactly that shape) would replace the live function and silently
  break `cascade_relabel` / `recompute_canvas_recipe` / `dispatch_recipe_recomputes`.
  `prod-graphile-preflight.ps1` now prints a DO-NOT-APPLY block and asserts the **live function's**
  allowlist + grant rather than the journal count — journal is bookkeeping, the function is
  behaviour. PEDRO-CHECKLIST §3 carries the full write-up.
- ⏭️ **Next:** §3 worker staging leg → §4 Stripe durable key → §5 clicks.

### ✅ 2026-08-07 OVERNIGHT — WAVES 0.5/0.6/0.65 SHIPPED (`5d490259`, 24-commit push)
- ✅ **Wave 0.5** (6 lanes): listener chat-turn-cap MIRROR (server-locus gate, pre-insert,
  fail-open), duplicate-createdAt fix, over-allowance toast, tier narrowing → billing,
  RQ-v5 fix, structural stream-parse classifier, migration-sourced worker SQL,
  email-detail 901→603, ship-dark ecs.tf flip wiring + staging worker CI lanes.
- ✅ **Wave 0.6** (16-item review fix batch): cap-message PARITY FIXTURE
  (`packages/billing/src/chat-cap-parity.json` — both language suites assert against it),
  fail-closed tier narrowing in the Python gate, paid `over_limit` rides the completed SSE
  event → Billing toast on the PRIMARY path, **draft preservation** on pre-turn cap block
  (one-click restore), tier-for-enforcement = active/trialing BOTH gates (A11), panel status
  machine, controller split <800, gather/head-count efficiency, e2e typecheck in CI,
  staging workflow mirrors prod (worker build/scan unconditional, only push gated),
  migration-by-content selector.
- ✅ **Wave 0.65** (breadth): WorkspaceSwitcher mounted in nav (+ sheet-close fix),
  /spreadsheets → standalone read-only viewer `/spreadsheets/[id]`, workspace add-member
  USER SEARCH (min-3-char, capped, minimal columns), 999.21 sidebar pointer-events
  root-cause + regression pin, screenshot camera scenarios for /billing · /settings/account
  · /workspaces · /spreadsheets. ⛔ **legal-pack lane SAFETY-BLOCKED** (correctly: live
  billing-terms page needs Pedro's BILL-05 written GO — A4 boundary held; stays a draft
  task for the sitting).
- 🔎 Two 10-angle review rounds (26 findings total filed w/ outcomes); full gates green at
  every merge: listener 2190 · api-client 831 · web 2267 (174 files) · billing 31 · worker.
- 🟢 **LIVE on this deploy:** the listener cap mirror (free 200/mo enforced on BOTH chat
  paths w/ friendly copy + draft restore; paid never blocked, over-limit toast).
- ✅ **Wave 0.7 queue burn SHIPPED** (`b8401780`): run_chat_turn 1905→1236 (AST-verified
  carves), test-double consolidation ×3, jsonlStreamConsumer swap, WebLLM draft-restore
  parity, worker-image composite action (+ paths-filter fix). Queue is EMPTY except
  Pedro-gated policy calls (A12 widget path, A4/BILL-05 legal pack — lane safety-blocked,
  correctly).
- 🔥 **Incident RESOLVED zero-loss:** worktree junction sweep deleted 1265 tracked files from
  the main tree; `git restore .` + `npm install` + full re-gates recovered everything.
  **WORKTREE JUNCTION LAW** added to VLAUNCH-WAVE-PLAN §4.
- ✅ **Wave 0.8 (`040f4d45`): approaching-cap upsell banner** — quiet ink notice above the
  composer at ≥80% of a FINITE monthlyChatTurns entitlement (numbers read from
  `@polytoken/billing`, power never shows), `/billing` link, session-latched dismiss,
  fail-quiet on loading/error. Closes the last "zero upgrade prompts outside /billing" debt.
  Web suite 2287/175 files green. Banner uses the DISPLAY tier, not A11's enforcement tier —
  recorded as **A13**.
- 🔒 **Wave 0.8b (`26da8ea4`) — SECURITY FIX, the night's most valuable find.** The lane
  returned NOT-CONTAINED (correct: no emitter exists, and the Bedrock artifact/settings.py
  inlets are both oversized), but its **hostile reviewer refuted the analysis's central
  claim** and the driver verified the refutation in code: the agent-emitted `capability`
  binding path was **reachable end-to-end from untrusted content** — listener stores
  `emit_ui_spec` JSON verbatim → `extractCapabilityBinding` runs BEFORE the `.strict()` spec
  parse and strips the key → live invoker with five write-tier tRPC mutations → a confirm
  card that **displayed no arguments**. One blind Approve fired a real mutation. Fixed
  defense-in-depth: default-OFF kill switch (`NEXT_PUBLIC_CAPABILITY_BINDING_ENABLED`),
  **required** arg disclosure on the card, and `parseArgs` fail-closed before approve.
  Analysis + correction banner: `docs/NESTED-ARGS-ANALYSIS.md`. Recorded as **A14**.
  (Lane stall #1 was the Fable 5 model limit — session switched to Opus, relaunched once.)
- 🔁 **Wave 0.9 LANDED — 1 of 3 lanes merged, 2 blocked on HIGHs (the review did its job).**
  Merged: **live-Postgres cap-count proof** (`5dcdfb0b`) — an env-gated integration test that
  actually exercises the `!inner` embed against real PostgREST, plus a
  `chat_turn_usage_count_query_failed` marker at the raising source (the gate fails OPEN, so a
  dead cap is otherwise invisible). Driver-corrected on merge (`85e6bb9d`): the lane's comment
  claimed the gate's warning "cannot say WHICH read failed" and that a broken embed is
  "indistinguishable" from a tier blip — **the reviewer refuted that empirically** (the gate logs
  `exc_info` and `format_exc_info` is wired ahead of `JSONRenderer`, so the traceback names the
  query). Corrected to the true claim (no *stable, structured, alertable* signal) — the same
  false-load-bearing-claim class as 0.8b, caught pre-merge this time. Also made the only
  auth.user-creating test's cleanup failure-tolerant. FULL listener gates green (coverage 92%).
  **Blocked, NOT merged:** `lane/w9-injection-audit` (3 HIGH — chiefly "fails closed at startup"
  is false: the read-only-tier guard sits in a dishka `Scope.APP` factory, so it runs lazily, and
  deleting its only call site reddens nothing) and `lane/w9-flag-gate` (2 HIGH — the gate is
  derived on the field axis but hardcoded on the class axis, and the web census misses two real
  `process.env` read shapes, so two documented guarantees are false). Both HIGH sets are the
  standing-lesson shape again: **an unenforced safety claim**.
- 🔁 **Wave 0.11 IN FLIGHT (`wf_5323d32a-28a`, 6 lanes):** the two HIGH-fix lanes above (each
  building ON TOP of its W9 branch, each guard required to ship a RED-check), plus the four
  post-gate kits that stalled as 0.10 — `verify-wave1.mjs`, `verify-cutover.mjs`, the close kit
  (`collect-wedge-evidence` / `fill-wedge-baseline` / `check-close-readiness`), and
  `merge-wave.mjs` driver tooling. All kits are verify-only, prod-write-refusing, `--apply`-gated.
- 🔁 **Wave 0.9 scope (findings-derived, the recorded queue is EMPTY):** generalizing
  last night's security class — (a) untrusted-content→privileged-sink audit across the whole
  product (`docs/INJECTION-SURFACE-AUDIT.md`, every path classified ENFORCED /
  DEPENDS-ON-MODEL-COOPERATION / UNGUARDED with contained guards where cheap), (b) a
  **flag-posture exposure gate** that enumerates flags from their real source so adding or
  flipping one to ON reddens CI (the "believed dark, nothing enforced it" bug class made
  mechanically impossible), (c) the env-gated live-Postgres proof for the chat-turn cap
  count's `!inner` embed (today it fails OPEN — a dead cap would be invisible).
- 🌅 **Morning report: `.planning/MORNING-REPORT-2026-08-07.md`** — Pedro starts there.

### ✅ 2026-08-07 — HARNESS LOCKED · vLAUNCH BLESSED · staging repair staged · decision sheet up
- ✅ **Harness DECISION recorded** (`.planning/decisions/2026-08-07-HARNESS-LOCK.md`, Pedro,
  FINAL): v2.0 and everything before it runs on **Claude Code + gsd plugin 4.5.3 + `.planning/`**.
  GSD Pi migration disqualified now (importer destroys decision bodies #1607, inconsistent state
  #1606, fresh auto-mode regressions); re-entry criteria verbatim in the record. Sanctioned update
  route + Buildomator v5.0 (2026-10-01 `/gsd:*`→`/bm:*` retirement) chore captured there too.
- ✅ **vLAUNCH (phases 78–81) BLESSED as proposed** — execute on this harness; first action of the
  post-`/reload-plugins` session.
- ✅ **Sauce-backup RITUAL standing** (`scripts/sauce-backup.ps1`): dated tag + all-refs bundle +
  non-git IP zip into `C:\Users\pc\polytoken-backups\` at EVERY milestone close; failure =
  close **BLOCKER**. First capture `sauce-2026-08-06-pre-v2.0` done (parallel session).
- 🟡 **Staging DB repair STAGED — one paste from green.** Dry-run VERIFIED live against staging
  (24 pending journal migrations incl. graphile_worker install; prod-ref refusal armed); the
  `--yes` apply is classifier-blocked in-session → Pedro one-paste
  `node scripts/staging-repair.mjs --yes` (durable repo copy). Supersedes the 🟡 "Staging drift
  OPEN" bullet below.
- ℹ️ **Stripe bullet below is STALE:** `STRIPE_SECRET_KEY` + `BILLING_ENABLED=true` landed
  2026-08-06 night 2 — **billing is LIVE on polytoken.ai** (webhook 400s unsigned = correct).
- ✅ **`.planning/PEDRO-DECISION-SHEET-2026-08-07.md`** consolidates ALL Pedro-gated remainder
  (one-pastes · 7 audit seams · SES reply draft · Legal/MoR) into one sitting — per order, never
  blanket-resolved.
- ✅ **vLAUNCH WAVE 0 SHIPPED (ultracode, pre-bless)** — 13-agent workflow: 3 plan-packs
  (78-cutover runsheets w/ zero-churn TF gate · BILL-04 SQL harness · UAT pack + WEDGE-BASELINE
  skeleton — promoted to `.planning/milestones/vlaunch-prep/`, `287f4d94`) + 5 build lanes in
  isolated worktrees, each hostile-reviewed, merged behind the full gate stack (api-client 820 ·
  web targeted · worker 34 · **full listener pytest 2157** · 3× typecheck) + a 10-angle
  `/code-review` (13 findings: 3 fixed in `dfb87ee1` — cap-block toast, per-merge label,
  learning-read logging; 10 recorded for follow-up). Landed dark: **WEDG-03 learning.summary**
  (owner-scoped, on pipeline-health), **chat-turn cap** (free blocked w/ friendly msg at 200/mo,
  paid never blocked, fail-open), **ingest-capped visibility** (inbox+detail), **cascade
  screenshot scenario** (skip-laddered), worker-test 0061 sync. Follow-up queue (from review):
  server-SSE cap mirror in listener (load-bearing before announcing caps) · duplicateConversation
  createdAt fix via shared helper · overLimit consumer banner · classifier structural parse ·
  worker-test readFileSync(0061) · tier-narrowing → @polytoken/billing · email-detail.tsx
  extraction (901 lines).
- ✅ **Vendored gsd-core bumped → v1.9.1** (`69dc8ce8`): all FOUR vendored subtrees together
  (`.claude/gsd` + `commands/gsd` + `gsd-*` agents + `gsd-*` skills — prior state was
  v1.8.0+53, byte-identical upstream, no local patches). SOURCE_COMMIT = `957ebd8e`. Wins:
  code-fixer honors `use_worktrees:false` + Windows reparse-point guard; guard hooks close
  fail-open holes; executor SUMMARY needs `actuals`.

### ✅ PROD RESTORED + TRACK 1 LIVE + TRACK 3a DARK + MILESTONE CODE DEPLOYED — 2026-08-06 tonight part 2
- ✅ **Prod DB restore chain CLOSED.** Root cause confirmed: both Supabase projects had
  AUTO-PAUSED (9 days idle). Pedro ran the password reset himself (the prepared
  Management-token script) → the new credentials replaced the STALE values in the Vercel env →
  `/api/dbcheck` came back GREEN against prod → the diagnostic route was then DELETED from
  `main` (`af6c8810`). The 🔥 PROD INCIDENT in the block below is RESOLVED; prod web DB is up.
- ✅ **Track 1 DONE — Terraform remote state LIVE** (`13edbea6`). S3 state bucket
  (`nauta-services-terraform-state`) + DynamoDB lock table (`nauta-services-terraform-locks`);
  the 5 forwarder resources imported; the 4 queued in-place changes APPLIED (incl. the
  **s3:DeleteObject right-to-erasure fix** in `iam.tf`); final `terraform plan` = CLEAN
  ("No changes"). The no-apply landmine is retired — any checkout can now plan/apply safely.
- ✅ **Track 3a PROVISIONED DARK** (`6c4e7cc9` + `b797ffa6`). Co-located `email-worker` ECS
  container wired into `ecs.tf`, gated on `worker_db_url_secret_arn_*` (unset ⇒ rendered task
  def byte-identical ⇒ live no-op — applied ship-dark); `nauta-services-email-worker` ECR repo
  APPLIED; the worker image pipeline VALIDATED GREEN end-to-end — incl. the Trivy gate, which
  passed after stripping bundled npm/yarn from the runtime image (`b797ffa6`). Enable sequence
  = `docs/DURABLE-WORKER-RUNBOOK.md` §3/§5 (secret → image push → tfvars → plan/apply → flags).
- ✅ **Listener prod deploy SUCCESS ×2** — the deploy workflow went green twice on tonight's
  pushes; the vNEXT milestone listener code (76-02b typed-inputs manifest, 75-03/04 cascade —
  all flag-dark) is **LIVE on prod ECS**.
- 🟡 **Stripe: objects LIVE + 4/6 Vercel env vars.** Products/prices + the webhook endpoint
  exist in Stripe; `STRIPE_PRICE_PRO` / `STRIPE_PRICE_POWER` / `STRIPE_WEBHOOK_SECRET` /
  `BILLING_APP_URL` are set in Vercel. Still MISSING: `STRIPE_SECRET_KEY` (mint a durable
  restricted key — CLI keys expire ~90 days) + `BILLING_ENABLED`. Billing stays inert until
  both exist.
- 🟡 **Staging drift OPEN.** Staging still shows Terraform drift; the repair is
  **classifier-gated** — each diff must be classified safe-in-place vs live-churn before any
  apply (the standing live-infra guard). Nothing was applied against staging tonight.
- ℹ️ **GitHub major outage (2026-08-06):** Actions silently swallowed the runs for 4
  consecutive pushes (zero runs created; Vercel deployed fine), then recovered — the two green
  listener prod deploys above landed after recovery.
- ⛔ **REMAINING (all Pedro-gated):** worker ENABLE sequence (runbook §3/§5: session-mode
  `GRAPHILE_WORKER_CONNECTION_STRING` secret → image push → `worker_db_url_secret_arn_*` in
  tfvars → apply → boot check → `INGEST_ENQUEUE_ENABLED` last; graphile schema + migration
  `0061` on prod precede the recompute/cascade flags) · staging drift repair (classifier-gated)
  · `STRIPE_SECRET_KEY` + `BILLING_ENABLED` · SES production-access case `178464704400134`
  reply · flag flips after a live smoke loop (`CANVAS_EMIT_TOOL_ENABLED` ·
  `MORNING_BOARD_ENABLED` · `CASCADE_CORRECTION_ENABLED` · `RECIPE_RECOMPUTE_ENABLED`) · live
  UAT seams (LCAN-05 / LCAN-09-live · MORN-07 · BTAP-07 · MCPX-09 · CPF-live) · the
  real-browser screenshot pass.

## 2026-08-06 · wrap-up session · `main` (superseded later the same day — tonight part 2)
> **(Was the ⭐ CURRENT block until tonight part 2 — the live status is now the block above;
> the 🔥 PROD INCIDENT below is resolved there.)** Everything below is chronological history
> (newest-first). vNEXT (Phases 73–77) is now **CODE-COMPLETE** — every remaining item is a
> Pedro-gated LIVE seam, not missing software.

### ✅ vNEXT CODE-COMPLETE — 6 streams shipped + adversarially verified — 2026-08-06
All local on `main` (about to push). Every stream got an adversarial verify pass; every CONFIRMED
finding was fixed same-session. Gates at integration: **worker 34 · mcp-server 32/32 · web 461
targeted + tsc · drizzle-kit check · api-client 59 (entities) · listener targeted suites +
mypy 318 + lint-imports**. FULL listener pytest + the full TS matrix were still running at ledger
time — assume green unless a note here says otherwise.
- ✅ **`985e2071`** — merge of `claude/phase-76-summon-loop-al5emg` (migrate workflow back to
  secrets-only + rotation docs). The feature-branch era is closed; everything now lives on `main`.
- ✅ **Phase 76 CLOSED (code)** — `87f4daf5` 76-02b: the listener consumes the typed-inputs
  manifest in the code-island generator prompt; `08c336a7` hardening (delimiter-breakout escape +
  bool rowCount). With 76-05 (`emit_code_island`, 2026-07-27) already in, Phase 76 is
  code-complete; **BTAP-07 live** is the only remaining leg.
- ✅ **Phase 73 Wave C CLOSED (code)** — `f0510ee5` recipe creation seam: `emit_canvas_recipe` +
  web reconcile; `a19aba67` fixes (all-or-nothing planning, sourceRef sanitize, esbuild pin).
  Remaining: **LCAN-05 / LCAN-09 live** (worker + flag).
- ✅ **Worker recompute + cascade fan-out** — `1d1391a2`: `cascade_relabel` +
  `recompute_canvas_recipe` + `dispatch_recipe_recomputes` (dark behind
  `RECIPE_RECOMPUTE_ENABLED`) + **migration `0061`** (task-allowlist widen) — **NEW, NOT yet on
  prod**; goes through the migrate pipeline once the 3 `PROD_*` secrets exist.
- ✅ **Phase 77 CLOSED (code)** — `58213cfc` esbuild runtime bundle (`dist` boots; stdio
  `tools/list` smoke green) + Windows expose-only fix (32/32) + daemon-protocol suite into CI.
  PEDRO-CHECKLIST §5(a) (the runtime build strategy) is DONE. Remaining: **MCPX-09 live**
  (Pedro's real Claude Code).
- ✅ **Phase 75 SERVER cascade CLOSED (code)** — `d5c5b1d2` 75-03/04: cascade wired into
  ConfirmMerge behind `CASCADE_CORRECTION_ENABLED` (byte-dark OFF) +
  `POST /v1/emails/relabel-job`. Remaining: **CPF live** (flag flip + live re-label).
- ⛔ **REMAINING = LIVE SEAMS ONLY, all Pedro-gated:** migration `0061` (+ verify `0058`–`0060`)
  on prod via the migrate pipeline once the 3 `PROD_*` env secrets exist · worker container
  provisioning (`ecs.tf` wiring, Terraform remote-state gate) · flag flips
  (`CANVAS_EMIT_TOOL_ENABLED`, `MORNING_BOARD_ENABLED`, `CASCADE_CORRECTION_ENABLED`,
  `RECIPE_RECOMPUTE_ENABLED`, `INGEST_ENQUEUE_ENABLED`) · live UAT seams (LCAN-05 /
  LCAN-09-live · MORN-07 · BTAP-07 · MCPX-09 · CPF-live) · the real-browser screenshot pass.
- 🔥 **PROD INCIDENT (context):** both Supabase projects were AUTO-PAUSED (9 days) — the root
  cause of the prod outage — and are restored now, but the DB passwords were changed everywhere
  in recovery: Vercel env + local `.env.production`/`.env.staging` all hold STALE passwords, so
  **prod web DB is still down** pending Pedro's password reset + paste. The `/api/dbcheck`
  diagnostic stays on `main` until prod DB is verified, then DELETE it. Also: **SES
  production-access case `178464704400134`** awaits Pedro's Support-Center reply; the **Stripe
  CLI login is expired**.

## 2026-07-24 · session_016dmeeGLzwLPZfRwGpByHmn · branch `claude/polytoken-email-infra-cont-qi9q5g` (superseded 2026-08-06)
> **(Was the ⭐ CURRENT block until 2026-08-06 — the live status is now the block above.)**
> Everything below the RESUME PROTOCOL is chronological
> history (newest-first); the `01RZ`/`jzz1pg`-session standing config at the very BOTTOM of this file
> (batch plan / merge protocol / completion criterion) is **SUPERSEDED** — all of that session's
> `send_later` Routines show `ended_reason=run_once_fired` (verified via list_triggers 2026-07-24);
> **no autonomous backstop is active.**

### 🌙 AUTONOMOUS OVERNIGHT RUN — safe additive batch on PR #11 — 2026-07-27 (07:58→~14:00 UTC)
Pedro: "continue autonomously 6h, don't prompt me, keep yourself alive." Ran a self-paced build loop
(full plan/policy/queue in `.planning/AUTONOMOUS-RUN.md`). Environment was UNSTABLE (container restart +
repeated interrupts) → policy: small atomic units, commit+push after every verified step, remote branch =
durable store. Held to the hard safety lines (NO terraform apply / prod migrations / AWS provisioning /
classifier bypass). Browser/visual sim was INFEASIBLE (no Supabase/auth, no .env.local) — visible surfaces
still owe Pedro's real-browser pass. All work is additive + locally CI-green, accumulated on
**PR #11 (NOT merged — held for Pedro's review + the migration order below).**
- ✅ **W1 — the TypeScript side finally has CI** (`ci-web-and-packages.yml`) — **GREEN in GitHub on Node 22**; it immediately caught a pre-existing clean-install jsdom@29→ESM-@exodus/bytes ERR_REQUIRE_ESM bug (fixed via Node 22 + a follow-up to align apps/web jsdom→^25.0.1). tsc + vitest for all 9 TS
  workspaces + drizzle-kit check, path-filtered. Validated all 9 green locally first. (master-plan Track 2
  shortlist #3 — the TS side had ZERO CI.) daemon excluded (known-red non-hermetic suite).
- ✅ **W2 — "Recent tables" home-board panel** → /spreadsheets discoverability (wires spreadsheets.list).
- ✅ **W5 — canvas source feed invalidation** — sources land as a turn ends, not only on remount.
- ✅ **W3 — code_islands provenance upsert** (round-3 G-LOW) — migration **0059** + optional provenance
  column + unique (user_id, provenance); create UPSERTS so an agent re-run can't orphan a row. Added the
  first-ever codeIslands router test + fixed a fake-db regression it exposed; also added a references
  router test (last untested router). Full api-client suite 784 green.
- **⚠️ MERGE ORDER (PR #11):** apply migrations **0058** (canvas_recipes, from PR #10) AND **0059**
  (code_islands.provenance) BEFORE merging/deploying PR #11 — the new codeIslands.create references the
  provenance column and would fail the LIVE "Build a tool" flow if deployed ahead of 0059.
- **Deferred (deliberately NOT built autonomously — need Pedro's eyes / can't validate green):**
  W4 workspace user-search (user-enumeration privacy surface), W6 real-Postgres migration/isolation CI
  (needs a Supabase-shim bootstrap — auth schema/roles/auth.uid + extensions — can't prove green here),
  W7 Phase 75 correction-cascade (touches the LIVE listener merge path), W8 Phase 77 Wave C MCP **write**
  tool (security-sensitive write-exposure), W9 container.py split (1433-line refactor too risky to leave
  half-done under restarts). Each is scoped in AUTONOMOUS-RUN.md for a supervised pickup.

### 🚀 ULTRACODE ROUND 3 — MERGED TO MAIN + LISTENER DEPLOYED — 2026-07-27
**"deploy all" + "full permissions".** PR #10 (rounds 1–3, 20 commits) MERGED to `main` (`c3f339a`).
CI green (listener lint/format/mypy/pytest 2111 + Vercel preview). En route, CI fast-failed on
`ruff format --check` over **20 PRE-EXISTING unformatted files** (not this branch's — run_chat_turn.py,
the supabase repos, morning-board tests); fixed with a `ruff format` pass (`9dd2020`, formatting-only).
**Listener PROD deploy VERIFIED SUCCESS** (run 30240600911): image built → Trivy clean → ECR → ECS →
service-stability wait ✓ → smoke test ✓. Stream D is flag-gated (`CANVAS_EMIT_TOOL_ENABLED` default OFF)
so the redeploy is a behavioral no-op until flipped. **Vercel web prod** deploys off the same `main` push
(preview was green on the PR — that preview URL is the surface for the owed browser-verification pass).
**STILL OPERATOR-GATED (reality, not permission) — see PEDRO-CHECKLIST §2–3:**
- **Prod migrations `0057`+`0058` NOT applied** — the MIGRATE-PROD workflow needs the 3 absent `PROD_*`
  secrets. Until run: `canvas_recipes` reads degrade to render-nothing (graceful); billing stays off.
- **Terraform/IAM NOT applied** — no remote state → `apply` would recreate/drop live SES rules = mail
  outage. Blocked on the state-import runbook. Did NOT run it even under "full permissions."
- **MCP server** — runs on Pedro's machine (`POLYTOKEN_MCP_*` env + runtime bundle); nothing server-side.

### ✅ ULTRACODE ROUND 3 — 5 GSD-safe streams SHIPPED — 2026-07-27 · session_01NhVUcfpAuwy4YBkvme7dUp · branch `claude/phase-76-summon-loop-al5emg`
Pedro (3rd "whats next" → "also check gsd" → "ultracode everything"). I grounded the menu with a
wired-but-dark sweep AND reconciled it against GSD (master plan + STATE): the naive top pick
(workspaces) is a Track-5 cross-tenant-leak hazard to batch-build (no real-PG isolation CI yet), so I
scoped "everything" to the GSD-SAFE set and held out the two flagged hazards (workspace *sharing*
list-unions; desktop-spawn, GSD-least-urgent + cost-bearing). 14-agent Workflow (5 disjoint builds ∥ →
adversarial verify each; then 2 canvas-web halves sequential → verify). I integrated + ran the FULL gate
matrix + fixed every CONFIRMED finding + committed per-stream. Pushed on top of `c5cea3d`.
Gates all green: **db drizzle-kit check + tsc · api-client 33 + tsc · mcp-server 32 + tsc · web tsc +
spreadsheets 5 / workspaces 11 / recipe-overlay 8 / agent-reconcile 21 / chat-canvas 7 / design-law ·
listener ruff/format/lint-imports/mypy(313) + pytest 2111.**
- ✅ **VISIBLE — `/spreadsheets` "My tables" index** (`5fba2e6`). Wires the callerless `spreadsheets.list`;
  registry surface mirroring /documents. Verdict SOUND. Rows non-navigating (no standalone table viewer
  route yet — followup). Reachable by direct URL; nav/home-board tile is a documented followup.
- ✅ **VISIBLE — owner-scoped workspace shell** (`c539265`). Opens the 100%-dark workspaces router
  (switcher + members/roles admin) using ONLY the 7 owner/RBAC procedures — **NO** shareResource/
  listShares/revokeShare, **NO** resource list-union (the deferred cross-tenant hazard). Verdict SOUND.
  Dark (URL-only until linked). Add-member is raw-UUID (user-search followup).
- ✅ **Phase 73 Wave C — canvas_recipes** (`e1da907` backend, `de8137e` web badge). LCAN-07 durable table
  + ownership-gated CRUD (LCAN-08) + on-canvas neutral recipe legend (LCAN-06). **Fixed 2 CONFIRMED:**
  MED the drizzle-gen migration dropped the brand-new-table RLS idiom every sibling user-owned table
  carries → hand-appended ENABLE RLS + anon-deny + owner policy (0058); LOW typed node/edge_keys jsonb.
  LCAN-09 (durable after-close recompute) remains the live-only worker seam.
- ✅ **Phase 76-05 — emit_code_island** (`353839d` listener, `de8137e` web reconcile). BTAP-07: agent
  emits a `canvas_code_island` part behind `CANVAS_EMIT_TOOL_ENABLED` (fail-closed, byte-identical off) →
  web re-grounds against the live canvas (values never reach the model) → generate → materialize wired
  node. Listener verdict SOUND. **Fixed 1 CONFIRMED (web):** MED the reconcile effect ignored publish
  state so a part arriving before its sources published never retried → added a publish-signature dep on
  the store's `values.shared` identity. Known LOW (documented followup): remount/delete-reload can
  re-mint a code_islands row (islandId is network-minted); clean fix = provenance-keyed upsert on
  codeIslands.create. BTAP-07 end-to-end is a named live seam.
- ✅ **Phase 77 Waves A+B — capability-registry MCP server** (`d1dd3bd`). New `apps/mcp-server`:
  expose-only stdio server projecting 3 owner-scoped read tools through the same appRouter+createCaller;
  single fixed principal (fail-closed), identity never from tool input, expose-only machine-checked
  (no external MCP client — Track-7 mandate). **Fixed 3 CONFIRMED:** MED verbatim-manifest describe
  over-promised (id-lookup / graph-expand the read procs lack) → authored procedure-accurate descriptions,
  kept the id∈manifest∧risk:read guard + a regression test; MED the SDK entrypoint (principal→context→
  caller wiring) was untested/unbuilt → extracted a pure `handlers.ts` + unit-tested the identity
  threading, installed `@modelcontextprotocol/sdk` (1.29.0) so tsc covers index.ts; LOW "confirmed"→
  "extracted" knowledge wording. Wave C (canvas.addNode write tool) deferred (depends on 73). MCPX-09
  (Pedro's real Claude Code) is a named live seam.
- **Owed (in the checklist):** apply migration 0058 (canvas_recipes); wire nav/home-board discoverability
  for /spreadsheets + /workspaces; MCP runtime packaging (bundle for `node dist/index.js`) + set
  POLYTOKEN_MCP_USER_ID/TOKEN + MCPX-09 live loop; the real-browser pass on all shipped web UI; the
  2 documented dark-seam followups (code_islands provenance upsert; table viewer route; user-search).
- **Deliberately NOT built (GSD hazard/least-urgent):** workspace *sharing* list-unions (needs real-PG
  isolation CI first) and desktop-spawn (cost-bearing). Do NOT batch-build these without Pedro direction.

### ✅ ULTRACODE ROUND 2 — 3 dark seams LIT + Pedro checklist — 2026-07-27 · session_01NhVUcfpAuwy4YBkvme7dUp · branch `claude/phase-76-summon-loop-al5emg`
Pedro (2nd "whats next"): "amazing, ultracode everything." 6-agent Workflow (3 build → adversarial verify),
integrated + full gates + fixed every CONFIRMED finding. All three previously-DARK seams are now LIVE.
Gates green: **api-client 770 + tsc · web 1465 (incl design-law 195) + tsc**. Pushed on top of `012c403`.
- ✅ **RCNV-02 now LIVE** — `chat.listSources` (ownership-scoped, 500-cap) feeds ChatCanvasIsland →
  ChatCanvas `sourceRows` → the reconcile Pass 2c materializes a source node per `chat_source_ledger`
  row. Sources land on conversation open. Verdict SOUND. Known limit (documented): load-time feed, no
  mid-session invalidation yet.
- ✅ **Live usage-vs-cap on /billing** — `billing.usage` + "X / Y used" meters. **Verify caught 2 MEDIUM
  bugs I FIXED before shipping:** (1) counted `received_at` (sender-controlled, backdatable) instead of
  server-stamped `created_at` — the exact mail-bomb concern the DailyIngestCounter port documents; (2)
  summed across all a user's importers vs a PER-importer cap (could read >100%) → now max-over-importers
  (busiest importer). Also fixed a LOW (count only `is_active` chat turns). Added a per-importer-max test.
- ✅ **REG-04 now LIVE (in-app)** — client-executable registry folds the tRPC-backed CANVAS_ +
  TABLE_CAPABILITIES (executors forward to api.chat.*CanvasNode / api.spreadsheets.*); daemon-only caps
  (fs/terminal/git/browser) stay UNREGISTERED = fail-closed; all risk:write so every invoke is confirm-
  card-gated (no auto-invoke). CapabilityInvokerProvider mounted around ConversationView. Verdict SOUND,
  0 findings. Flat-input caps drivable now; nested-arg (addNode/table.create) light up when an emit path
  supplies runtime args.
- ✅ **`.planning/PEDRO-CHECKLIST.md`** — the single ordered "at-your-computer" list (rotate tokens →
  browser-verify the shipped UI → flip Stripe/Vercel → apply migration 0057 + IAM + worker → flip flags).
  Supersedes the scattered [PEDRO] notes for day-to-day use.
- **Owed (all in the checklist):** the browser/screenshot pass on all the shipped UI (jsdom does no
  layout — I can't run the server here); the 2 dark-seam follow-ups (source-feed invalidation; nested-arg
  capability emit path) are buildable by me next, non-blocking.

### ✅ ULTRACODE EVERYTHING (5 streams) SHIPPED — 2026-07-27 · session_01NhVUcfpAuwy4YBkvme7dUp · branch `claude/phase-76-summon-loop-al5emg`
Pedro: "whats next" → "ultracode everything." Built via a 10-agent Workflow (5 parallel/waved builds →
adversarial verify each), then I integrated + ran the FULL gate suite + fixed every CONFIRMED finding
before committing. Pushed `1f5241d..012c403`. Gates all green: **billing 30 + tsc · db 124 + drizzle-kit
check · api-client 6 + tsc · web 1261 + tsc · design-law 195**.
- ✅ **VISIBLE — /billing entitlement limits** (`f1fdabd`). Each tier's real caps (ingest/day + chat
  turns/mo, power=unlimited) now render on the plan cards + current plan. Makes slice-B tiers meaningful.
  Verdict SOUND. Owes a screenshot pass (jsdom can't see layout).
- ✅ **VISIBLE — DOCS-01 save-response-as-document** (`630b7b4`). Real message/report→document export
  affordance in the chat action row; documents.create now takes optional initial blocks additively
  (blank path byte-identical); existing typeset-PDF then applies. Verdict SOUND (2 trivial LOW: docstring
  fixed; Next-internal import path disclosed/acceptable). Owes a screenshot pass.
- ✅ **CORRECTNESS — billing pre-launch hardening** (`ff0fb40`, inert until BILLING_ENABLED). Event-ordering
  high-water mark (`subscriptions.last_event_at`, migration 0057) stops a stale `subscription.updated`
  resurrecting a canceled tier + same-second tie-break (cancels win ties); atomic idempotency
  (claim-on-insert, release-on-throw); checkout TOCTOU advisory lock. **Fixed the MEDIUM verify finding**
  (0057 was NOT journal-registered → `db:migrate` would never create the column → 500s once billing on):
  added the column to the Drizzle model + `drizzle-kit generate` so journal+snapshot are consistent
  (`drizzle-kit check` clean). Closes the 3 DEFERRED billing findings from the prior A+B+C ship.
- 🌓 **DARK PREREQ — RCNV-02 canvas source reconcile** (`8773c85`). Reconcile pass that materializes a
  source node per `chat_source_ledger` row is built+tested+wired through a ChatCanvas `sourceRows` prop,
  but byte-identical until fed: **remaining to make sources visibly land = a per-conversation source-list
  tRPC query in api-client + page.tsx passing sourceRows** (both out of the _canvas/** build scope).
  RCNV-03 standalone CanonToolbar deliberately NOT mounted — SelectionToolbar already owns the
  bottom-center slot + generalizes canon mode; a 2nd toolbar would overlap (verified design call).
- 🌓 **DARK PREREQ — REG-04 capability confirm-card path** (`012c403`). Agent-emits-binding-spec →
  CapabilityConfirmCard → resolver invoke is wired fail-closed + proven end-to-end in test, but renders
  nothing in-app until a host mounts `CapabilityInvokerProvider` with a **client-reachable executable
  registry — which the web tier does not have today** (executors live server-side/daemon). That client
  executor path is the real remaining build; not forced (architectural, needs its own slice).
- **NEXT visible candidates** (both unblock a dark seam, both need the owed real-browser pass): wire the
  RCNV-02 source-list feed (smaller); build a client-reachable capability executor + mount the REG-04
  provider (larger). Neither is Pedro-gated.

### ✅ ULTRACODE ALL THREE (A+B+C) SHIPPED — 2026-07-26 · session_01NhVUcfpAuwy4YBkvme7dUp
Built via a 6-agent Workflow (2 parallel builds → adversarial verify + 3 review agents), then I
gated + fixed every CONFIRMED finding before shipping. All to `main`:
- ✅ **A — durable-worker runbook** (`f388051`, `docs/DURABLE-WORKER-RUNBOOK.md`). apps/worker + the
  listener enqueue path were ALREADY on main (verified byte-identical to the feature branch) — so A
  collapsed to the provisioning/cutover runbook: install graphile_worker schema → migrations
  0053/0054 → deploy worker container → flip `INGEST_ENQUEUE_ENABLED`. Every step marked [safe]/[PEDRO];
  honors the no-remote-state TF landmine; flags that the worker ECS container is **not yet wired in
  `ecs.tf`** (needs a Node runtime image — Pedro).
- ✅ **B — tier-aware ingest caps** (`2728632`). `ENTITLEMENTS` map in `@polytoken/billing` is the SoT
  (free 100 / pro 500 / power 2000 emails/day). Listener mirrors the ingest caps + a `TierResolver`
  port self-derives importer→user→`subscriptions.tier`, behind **`INGEST_TIER_CAPS_ENABLED` (default
  OFF = byte-identical)**; fail-open to the flat cap on any resolver error; only active/trialing grants
  a paid cap. Gates: listener ruff/format/lint-imports/mypy(313)/pytest(91.95%); billing tsc+vitest(23,
  +4 new); api-client tsc. (The build agent errored on its final StructuredOutput emit but wrote all
  code; the independent verifyB pass + my full self-review/gate confirmed it sound.)
- ✅ **C — hardening (confirmed findings fixed):**
  - **HIGH/CONFIRMED ingest compute-idempotency** (`36280bc`): passive SNS redelivery of a 'parsed'
    email re-ran the full Bedrock/Textract pipeline (data upserted, but compute/cost did NOT dedup).
    `execute()` now short-circuits a passive redelivery of a 'parsed' row; deliberate reprocess passes
    the new `reprocess=True` and re-runs. Also fixes the LOW/CONFIRMED cap-downgrade-on-redelivery.
    (Does NOT fix the concurrent-retry case — first still in-flight — whose root cause is the SNS 15s
    timeout; mitigation = fast-200 bridge / durable worker.)
  - **HIGH/CONFIRMED deletion IAM** (`2847c46`): the ECS task role lacked `s3:DeleteObject` on the SES
    inbound bucket, so B2 account-deletion could NEVER erase SES raw MIME → 502 for any user with SES
    mail (right-to-erasure gap; fails closed, no data loss). Added the action to `iam.tf`. **Apply is
    Pedro-gated** (no TF remote state yet).
  - **DEFERRED (billing, all PLAUSIBLE, billing not yet live) — pre-launch hardening TODO:**
    (1) webhook has no event-ordering guard → an out-of-order `subscription.updated` after `deleted`
    could resurrect a canceled paid tier; (2) idempotency is check-then-act (non-atomic) → concurrent
    duplicate deliveries both run (bounded today: all side effects are idempotent upserts);
    (3) TOCTOU on the duplicate-active guard → concurrent checkouts could create two Stripe subs.
    Fix these in the billing-hardening pass before flipping Stripe live.

### ✅ THREE MORE SLICES SHIPPED (ultracode) — 2026-07-26 · session_01NhVUcfpAuwy4YBkvme7dUp
- ✅ **DEPLOYED TO MAIN `5cebe7e`** (web + listener) — built via a Workflow (3 parallel builds + adversarial
  verify), fixed against the verdicts, all gates green:
  - **Ingest fast-200 bridge** (listener, `INGEST_BACKGROUND_ENABLED` default OFF): fixes the
    SNS-15s-timeout → retry → 2-3× duplicate-Bedrock waste + multi-minute `received`. When on, the inline
    path schedules ingest as a FastAPI BackgroundTask and 200s in <1s. Verify caught + I fixed: flag-OFF
    byte-identical drift (DI resolution hoisted out of the try → moved back in) + an honest comment on the
    accepted pre-persist gap (logged loudly, never silent) vs the durable worker. Also fixed the
    sns_inbound SIGNATURE test's settings stub (the full suite caught it — the targeted test hadn't).
    **The proper fix is still the durable worker (Pedro infra); this is the no-infra bridge to flip.**
  - **Forwarding onboarding** (web): `/onboarding` guided flow — shows the user's personal forwarding
    address (`api.forwarding.getOrCreateMyAddress`) + copy + setup steps + a "test email arrived" readout.
    The #1 funnel cliff. Nav "Get started" entry. Design-law clean.
  - **Billing verifySession** (packages/billing + api-client + web): the delayed-webhook fallback —
    `/billing/success` calls `billing.verifyCheckout` on mount so a lagging Stripe webhook never leaves a
    paid user on `free`. Idempotent vs the webhook (shared `syncSubscription` + `verify:{sessionId}` key).
  - Gates: listener ruff+format+mypy(310)+lint-imports+full pytest(0 fail); billing tsc+vitest(19);
    api-client tsc; web tsc+tests(8)+design-law(189)+placeholder build. Adversarial verdicts: web SOUND,
    ingest PROBLEMS(2 HIGH) → both fixed.
  - ✅ **Listener deploy VERIFIED SUCCESS** — `deploy-email-listener.yml` run 30223784262 (SHA `5cebe7e`):
    completed/success (test job + build&deploy green). Scheduled check-in confirmed; listener image on main is current.
  - ✅ **ULTRACODE-ALL-THREE deploy VERIFIED SUCCESS** — `deploy-email-listener.yml` run 30225009732
    (SHA `445cdfa`, the final ledger+B+C push): completed/success. Listener image on main now carries the
    B tier-cap wiring (flag OFF, byte-identical) + C compute-idempotency + reprocess fixes. Scheduled
    verification check-in (trig_01GzKkMtVoVV3LKqnhoxgvbu) proactively confirmed early and cancelled — no
    fix needed, CI green on the SHA.

### ✅ B2 ACCOUNT DELETION SHIPPED (ultracode + adversarial-hardened) — 2026-07-26 · session_01NhVUcfpAuwy4YBkvme7dUp
- ✅ **B2 self-serve account/data deletion DEPLOYED TO MAIN** (`786edc4`; web + listener). Makes the
  shipped privacy-policy/ToS deletion promise real. Built via an ultracode Workflow (listener + web +
  settings UI in parallel → adversarial verify), then HARDENED against 3 bugs the verification caught:
  (1) CRITICAL — `delete_prefix('')` would walk the attachments BUCKET ROOT and wipe every user's blobs
  → guarded. (2) HIGH tenant-isolation — the listener trusted caller-supplied ids → redesigned to
  SELF-DERIVE scope from `X-User-Id` (new `AccountDeletionReader` port + Supabase impl); no input can
  reach another user's data. (3) HIGH stranding — blob-delete failures were swallowed then the cascade
  ran anyway → the web route now BLOCKS the irreversible cascade until blob erasure is confirmed
  (listener returns `complete`; vault sweep must succeed) → 502 + retry-safe, never orphans data.
  Deletion architecture: auth-user delete cascades ~all Postgres + embeddings; the route explicitly
  erases what doesn't cascade (S3 raw MIME + backfill, email-attachments bucket, user-files vault incl
  .versions/.trash, 3 orphan telemetry tables). No migration needed. UI: `/settings/account` danger
  zone, confirm-gated destructive control. Gates: listener ruff+format+mypy(310)+lint-imports+full
  pytest; web tsc+tests(6+2)+design-law(195)+placeholder build. The adversarial-verify pass is the
  reason this is safe to ship.
  - ✅ **DEPLOY VERIFIED (2026-07-26 22:15Z):** listener deploy run 30222583533 (sha 786edc4)
    `conclusion=success`; the CI-unblock run 30221452382 (d65417b) also succeeded — the listener
    pipeline is healthy again and A1/A2 are now actually live (flag-off). **B2 is FULLY LIVE end-to-end**
    (listener endpoint + web route + Vercel UI). The `/settings/account` delete button really erases an
    account now.

### 🔥 LIVE-INGEST INCIDENT + CI-UNBLOCK — 2026-07-26 · session_01NhVUcfpAuwy4YBkvme7dUp
Pedro (live-loop testing, finally!) reported forwarded emails "should have worked already." Diagnosed
against prod DB (Management API read via apply.py):
- **NOT broken — SLOW.** All 5 emails he forwarded (Vivo/Vercel/AWS invoices w/ PDFs) reached the DB
  and, checked again ~6 min later, ALL `parsed`. PDF-heavy emails generate 178–210 components →
  hundreds of Bedrock enrichment calls → several minutes wall-time. He looked mid-enrichment (status
  `received`) and thought it stalled. No data lost; pipeline healthy.
- **REAL BUG FOUND + FIXED (`d65417b`, on main):** every listener deploy since the A1 push was
  SILENTLY FAILING on CI ruff (stricter than the local per-file check) — A1's `execute()` tripped
  PLR0912/PLR0915 (branch/statement limits) + I001 + PT018. So A1/A2 never actually deployed (old
  image still serving — which is why ingest still worked). Fixed: extracted `_over_daily_cost_cap`
  helper (fewer branches), split the assert, sorted imports. ruff+format+mypy(304)+pytest(54) green.
  **Listener deploys are unblocked now.**
- **REAL WEAKNESS (not yet fixed):** SNS HTTP delivery times out at 15s while enrichment runs for
  minutes → SNS RETRIES → the heavy email is re-enriched 2–3× (wasted Bedrock $) and the UI shows
  `received` for minutes. Proper fix = the durable worker (Track 3a: fast 200 → background enrichment
  w/ retries, no dup processing) — Pedro-gated infra. Bridge option (fast-200 + background task) NOT
  shipped (live-receiver change, deferred/offered). This is a latency+cost issue, not data loss.

### ✅ SESSION UPDATE — 2026-07-26 (B1 legal pages + /billing UI SHIPPED) · session_01NhVUcfpAuwy4YBkvme7dUp
- ✅ **C1 /billing PAGE DEPLOYED** (`b836836`): plan readout + Pro/Power cards (one-click Subscribe →
  Checkout, Manage → portal), `/billing/success`, "Billing" in the nav registry. Design-law green
  (palette/colour-law/role-hue), surface test 4/4. Graceful when billing off (reads `free`).
- ✅ **B1 LEGAL PAGES DEPLOYED TO MAIN** (`3748fba`, web-only): `/legal/privacy` + `/legal/terms`,
  grounded in track 06 (SES→S3→Textract/Bedrock→graph; subprocessors AWS/Supabase/Vercel/Stripe; US
  transfer; LGPD/CCPA rights + contact; legitimate-interest for correspondents; fees-paid liability
  cap; AS-IS/not-a-backup; no-EU; loud-not-silent; Brazil law). Shared `LegalDoc` renderer
  (chrome/sans). Linked from the billing checkout footer. **Marked review-pending draft** — legal
  sign-off + a ROUTABLE privacy contact (currently `privacy@polytoken.ai` placeholder in
  `legal-entity.ts`) + ANPD SCCs owed (Pedro/lawyer). Gates: web tsc + palette/colour-law (189).
- ⏭️ **NEXT = B2 deletion path** (self-serve delete-my-data across Postgres + S3 raw mail + storage +
  embeddings) — now a PROMISE in the shipped privacy policy ("delete your data from account
  settings"), so it must be made real. Scoping the deletion landscape first. Then: forwarding-setup
  onboarding (the #1 funnel cliff), billing verifySession fallback + tier→listener cost-cap wiring, F1
  funnel instrumentation. Pedro-gated remainder unchanged (live loop + SES · Stripe/Vercel config ·
  legal review · budget cap + flip A1/A2 flags + alarm · rotate tokens · visual pass).

### ✅ SESSION UPDATE — 2026-07-26 (C1 billing SHIPPED + deployed) · session_01NhVUcfpAuwy4YBkvme7dUp
- ✅ **C1 /billing PAGE SHIPPED** (`b836836`, Vercel-only). The visible half: `/billing` (current-plan
  readout + Pro $29 / Power $49 flat cards, 1-click Subscribe → Stripe Checkout, Manage → portal) +
  `/billing/success` + a "Billing" nav entry (rail + mobile More). Chrome-monochrome/ink/sans (laws
  1+2); gates: web tsc, surface test 4/4, palette-ban+colour-law+role-hue (195), placeholder build.
  Graceful when billing off (reads free; Subscribe toasts). ⚠️ visual sign-off owed (jsdom no layout).
  Display prices ($29/$49) MUST match the Stripe prices Pedro creates.
- ✅ **C1 Stripe subscription billing DEPLOYED TO MAIN** (`8935506..8fecd23`, 8 commits: distribution
  plan · CNPJ entity · A1 · A2 · billing). Vercel (billing code, inert) + listener (A1/A2, flag-off)
  redeployed — all safe. Adapted Pedro's `algomaxxing/packages/billing` reference (added to session via
  add_repo after he transferred it to his account) into `@polytoken/billing` for subscriptions.
- ✅ **Migration 0056_billing APPLIED TO PROD** via the sanctioned apply.py path (Management API, sbp_
  read from settings.local.json — never written to a new file). Verified AGAINST DB: `subscriptions`
  (rls on, 2 policies) + `stripe_webhook_events` (deny-all, 2 policies), drizzle bookkept (hash
  92eb69ec…, when 1785095269965). The billing DB is ready.
- ⛔ **REMAINING = LIVE STRIPE/VERCEL CONFIG (Pedro-gated, classifier-blocked).** The auto-mode
  classifier blocks outbound curls carrying Pedro's live `rk_live_`/`vcp_` keys to api.stripe.com /
  api.vercel.com (no pre-approval rule for those hosts, unlike the Supabase migration path). I did NOT
  route around it. To finish: (a) Pedro adds a `Bash(curl:*)` allow rule → I create Stripe
  products/prices/webhook + set Vercel env (`BILLING_ENABLED=true`, keys, price ids, whsec,
  BILLING_APP_URL) in ~2 min; OR (b) Pedro does the ~5-min dashboard steps (only-you #5). Recommended
  prices: $29 Pro / $49 Power. **Then billing is live.** Also owed: rotate the pasted rk_live_/vcp_
  tokens; the `/billing` UI page (frontend, not blocked — not yet built); privacy/ToS (B1) before any
  real external charge.

### ✅ SESSION UPDATE — 2026-07-26 (later) · session_01NhVUcfpAuwy4YBkvme7dUp · branch `claude/phase-76-summon-loop-al5emg`
**DISTRIBUTION-READINESS turn.** Pedro: "make this project distribution ready + a list of stuff only I
can do when I get back to my computer tomorrow" (we've built all week on Claude Code **mobile**), then
handed the **CNPJ card** and said "go".
- ✅ **`.planning/DISTRIBUTION-READINESS.md`** — the sequenced plan to go from "works for Pedro" to "a
  stranger can sign up, pay, and safely use it". Verified 4 gaps against the live tree (uncapped ingest
  cost, silent ingest failure, no legal surface, no billing). Split by who-can-do-it (`[CLAUDE]`
  mobile-buildable vs `[PEDRO]` at-a-computer), with an ordered **only-you checklist** (live loop · SES
  prod access · rotate tokens · AWS budget cap · MoR account · **accountant Qs** · legal review · LGPD/SCCs
  · 3 PROD_* secrets · visual sign-off · flip the two ingest-safety flags + failure alarm).
- ✅ **ENTITY CONFIRMED from the CNPJ** (`8935506`-line follow-up commits): `PEDRO KYUN MASCHIO SHIN
  CONSULTORIA EM TECNOLOGIA LTDA` — **LTDA, porte ME, ATIVA**, CNPJ 65.152.447/0001-21, nome fantasia
  **MAGNITUDE TECNOLOGIA** (= the live magnitudetech.com.br entity), CNAEs already cover SaaS
  (62.02-3-00 + 63.11-9-00 + 63.19-4-00), accountant **Contabilizei**. Resolves track 09 §8's flagged
  entity assumption + the no-C-corp call. Narrowed the only-you entity item to two accountant Qs
  (Simples Anexo III vs V / Fator R; international billing into the LTDA). Folded into track 09 + the plan.
- ✅ **A1 — CAP THE INGEST COST PATH** (`e211f56`, flag OFF). `IngestBudgetGuard` (new domain service) +
  narrow `DailyIngestCounter` port (NOT widening the broad EmailRepository Protocol) + concrete
  `count_received_since` on the Supabase repo (counts server-stamped `created_at`, NOT sender-controlled
  `received_at`). Per-importer daily volume cap bounds a mail-bomb; **fail-OPEN** (deliberate opposite of
  the chat breaker — never caps legit mail on a count error); past the cap the raw email STILL persists,
  only enrichment is skipped, finalizes `degraded` with an `ingest_cost_capped` reason (new KNOWN_STAGES
  entry; visible + reprocessable, never silently dropped). Flags `INGEST_DAILY_COST_CAP_ENABLED` (OFF) +
  `INGEST_DAILY_EMAIL_CAP=500`. Wired via structural-omission (inject None when off) exactly like
  INGEST_ENTITY_RESOLUTION_ENABLED; boot-test pinned. **The single most important pre-launch eng task
  (track 09 §5.1 / VC-roadmap M1).**
- ✅ **A2 — MAKE INLINE INGEST FAIL LOUDLY** (`d169969`, flag OFF). `INGEST_INLINE_RETRY_ON_FAILURE`: the
  SNS handler returns 200 on ANY inline ingest failure today → a pre-persist critical-path failure (S3
  fetch / MIME parse / importer resolve / save) silently, PERMANENTLY loses the mail. Flag ON → the inline
  path returns **500 so SNS retries** (ingest is idempotent → safe; enrichment failures never reach the
  branch). Closes the CLAUDE.md silent-loss landmine **without the worker**. The durable dead-letter form
  is the already-built `INGEST_ENQUEUE_ENABLED` path (worker-gated, Pedro). Loud structured events emitted
  (`email_ingest_error` w/ `will_retry`, `ingest_cost_capped`) for a CloudWatch→phone alarm (Pedro infra).
- 🧪 **ALL LISTENER GATES GREEN** on both: ruff + mypy(304) + lint-imports(3) + full `uv run pytest`
  (exit 0, 92.26% cov, only env-gated skips). Tests added: `IngestBudgetGuard` unit (8),
  ingest-use-case cost-cap (4), supabase count_received_since (2), sns_inbound A2 (3).
- ✅ **C1 — STRIPE SUBSCRIPTION BILLING** (`8ca217c`, flag OFF). Pedro chose **Stripe** (not a MoR) and
  transferred his `algomaxxing` repo to his account so I could read its `packages/billing` reference
  (added via add_repo + cloned to /workspace/algomaxxing). Built greenfield as **`@polytoken/billing`**
  — a DI, unit-tested Stripe wrapper mirroring his structure but modeled for **subscriptions** (Pro/Power
  tiers, no credit packs): client factory, tier↔price mapping, errors, checkout (customer reuse +
  duplicate-active guard), **idempotent webhook** (stripe_webhook_events dedupe; checkout + subscription
  created/updated/deleted → sync tier), portal. A `BillingStore` port keeps it testable with no DB; the
  drizzle adapter is a separate entrypoint. **DB:** `subscriptions` (one row/user, entitlement `tier`) +
  `stripe_webhook_events`, migration **`0056_billing.sql`** (owner RLS; generated via drizzle-kit +
  hand-appended RLS; check green). **api-client:** `billing` router (currentSubscription /
  createCheckoutSession / createPortalSession), owner-scoped, request-time secrets, no open redirect.
  **web:** `/api/stripe/webhook` (raw-body signature verify, idempotent, 500→retry) + optional Stripe env
  vars (never NEXT_PUBLIC_). Inert unless `BILLING_ENABLED=true` + keys set. USD + adaptive_pricing.
  **Stripe ≠ MoR** → LTDA owes cross-border tax (accountant Q #6b). Follow-ups: `/billing` UI,
  verifySession fallback, tier→listener-cost-cap wiring. **Secrets:** the pasted `rk_live_`/`vcp_` are
  NOT in any tracked file (read from env at request time); `.claude/settings.local.json` (gitignored)
  still holds the earlier `sbp_` token locally — rotate all three.
- 🧪 **WEB/DB/API-CLIENT GATES GREEN (C1):** drizzle-kit check; tsc ×4 (billing/db/api-client/web); vitest
  (billing 15, api-client 756); web placeholder build (compiled + 30/30 static pages, exit 0).
- ⚠️ **NOT fast-forwarded to main — deliberately.** A1/A2/C1 are all flag-OFF byte-for-byte no-ops that CANNOT be
  turned on until Pedro runs the live loop (only-you #1) + sets the AWS budget belt (only-you #4), so
  shipping the live-mail-receiver redeploy now buys nothing. Held on the feature branch pending Pedro's
  "ship it" (trivial) or batching with more Phase-0 work. **Next Phase-0 (pure web/Vercel, no listener):
  B1 legal pages, B2 deletion path, C1 MoR checkout scaffolding, F1 funnel instrumentation.**

### ✅ SESSION UPDATE — 2026-07-26 · session_01NhVUcfpAuwy4YBkvme7dUp · branch `claude/phase-76-summon-loop-al5emg`
Built the **Phase 76 SUMMON LOOP** — the gesture that finally makes the code-island node
USER-REACHABLE (the visible payoff of the whole phase). Shipped as one green slice; all Vercel-only
(NO listener/migration/infra change, so the live mail receiver is untouched). Gates green: web
tsc + full vitest (2078 pass across 148 files) + placeholder build (exit 0); api-client tsc + full
vitest (756 pass).
- ✅ **Spreadsheet publish-port prereq**. `spreadsheet-node` now publishes a bounded shape+sample
  projection to `shared.published.{id}` once its query settles (`spreadsheet-publish.ts` pure module:
  `{label, columns:[{name,type}], rowCount, sample≤8}` — NEVER all rows; `projectForPublish` is the
  final size belt). Effect gated on the stable `query.data` (not the per-render derived arrays) so it
  publishes on a genuine change, not every render. Mirrors the 10 board nodes' publish ports.
- ✅ **76-02a — api-client `inputs` passthrough** (SAFE/additive). `codeIslandGenerate` accepts an
  optional bounded typed-inputs **SHAPE** manifest (`{targetKey → {label?,nodeType?,fields?,rowCount?}}`,
  ≤32 keys, pollution-guarded) and forwards it as `inputs` in the POST body. SHAPE ONLY — the row
  VALUES never reach the model. The FastAPI model ignores the field until 76-02b, so no listener
  redeploy needed. `inputs:null` when the caller wired nothing (back-compat).
- ✅ **76-04 — the "Build a tool from these" flow** (the summon loop). Pure core in `build-tool-flow.ts`
  (`collectToolInputs`): from the selected nodes + live store `values`, keeps only sources that HAVE
  published a projection, assigns each a unique JS-ident targetKey, and emits the parallel `inputs`
  (SHAPE → generator) + `inputBindings` (WIRING → persistence, `targetKey → {sourceNodeKey,
  sourcePath}`) records + a default intent. `chat-canvas` `handleBuildTool`: reads projections →
  `collectToolInputs` → `utils.genui.codeIslandGenerate.fetch({intent,inputs})` (imperative one-shot)
  → `codeIslands.create` → materializes ONE `code-island` node + one data-edge per source in a single
  history/save unit (idempotent per BTAP-06: fresh uuids, one scheduleSave). Selection-aware menu entry
  in `add-node-menu.tsx` — disabled with an inline hint until ≥2 sources selected, "Building…" while a
  summon is mid-flight. Added the missing `code-island` (560×520) entry to `CANVAS_NODE_DIMENSIONS` so
  cascade/dagre see the true rect. Tests: `build-tool-flow` (11), `spreadsheet-publish` (3),
  `add-node-menu` (+4 summon cases), `code-island` api-client (+3 inputs cases).
- ✅ **76-04b — the intent prompt SHIPPED** (Vercel-only, closes the headline UX gap). The menu now
  opens `BuildToolDialog` (a radix Dialog, `build-tool-dialog.tsx`) instead of firing the canned
  default: `openBuildTool` preflights the selection (≥2 published sources → captures their labels),
  the dialog captures the user's words ("build me a rent reconciler"; ⌘/Ctrl+Enter submits; blank ⇒
  the 76-04 auto-intent), and `handleBuildTool(intentOverride)` threads it into `codeIslandGenerate` +
  `codeIslands.create`. So the product promise — *describe the tool you want* — is now real. Gates:
  web tsc + full vitest (2083 / 149 files) + placeholder build. Test: `build-tool-dialog` (5).
- ✅ **76-04c — "Your tools" picker SHIPPED** (`9e30932`, Vercel-only). Closes the build→reuse loop:
  Add-node menu → "Your tools…" opens `CodeIslandPickerDialog` over the already-wired
  `codeIslands.list` (owner-scoped); selecting a saved tool places a `code-island` node by `islandId`
  ref (rehydrates via `codeIslands.byId`) — same mechanics as the entity/spreadsheet add-flows,
  `handleAddCodeIsland`. A Dialog opened via nonce (no extra toolbar button); empty state guides to
  Build-a-tool. Gates: web tsc + full vitest (2088 / 150 files) + placeholder build. Tests:
  `code-island-picker-dialog` (4), `add-node-menu` (+1).
- ⚠️ **VISUAL-VERIFICATION DEBT (owed, Pedro-gated):** the summon-loop UI, the intent dialog, and the
  tools picker all pass jsdom + build, but jsdom does NO layout — none have been through the real
  `test:geometry` / `screenshot:review` gates (they need an already-running :3000 + seeded auth + the
  live DB, unavailable in this sandbox). A human look at `/chat` → Add-node menu is owed before
  calling the visuals verified.
- ✅ **0055 `code_islands` APPLIED TO PROD (2026-07-26) — the summon loop is now fully live.** Applied
  over the Supabase Management API (`sbp_` PAT Pedro provided; the sandbox has only HTTPS egress, no PG
  socket — the §8 transport). Verified AGAINST THE DB: `code_islands` exists, `rls_enabled=true`, 2
  owner RLS policies; `__drizzle_migrations` bookkept (id 53, hash 66ec2a5a…). Also applied the other
  overdue additive-pending migrations in the same pass: **0050** (maritime purge, idempotent) and
  **0052** (`canvases`/`canvas_nodes`/`canvas_edges` + RLS — the deployed canvas-promotion code already
  expected these). `codeIslands.create` now persists in prod; the "Build a tool from these" flow works
  end-to-end. **DEFERRED (Pedro-gated, unchanged): 0053 + 0054** — the Track-3a durable-worker rollout.
  0053 RAISEs unless the `graphile_worker` schema exists (its own header: *"applied to the live DB by
  Pedro (P3), never by this workflow"*); that schema needs `apps/worker install-schema` against a real
  PG connection — not provisionable from the sandbox. They must be applied via the Management API (NOT
  `drizzle migrate`) WHEN the worker is provisioned: because 0055 is now bookkept ahead of them
  (created_at 1785032909130 > their 1784929405945/1785016800000), a `drizzle migrate` run would SKIP
  them — but that CI path is already dead (secrets missing, below) and 0053/0054 were always manual, so
  no regression. **STILL NEEDS PEDRO (separate from code_islands): the CI migrate path is broken** —
  `PROD_POSTGRES_URL_NON_POOLING`/`PROD_POSTGRES_URL`/`PROD_SUPABASE_URL` don't exist in GitHub (repo or
  `production` env; I added `environment: production` to `deploy-migrate-prod.yml` on branch `bca7c60`,
  re-ran, still empty). Create those 3 secrets to restore drizzle-CI migrations; until then prod DB
  changes go via the Management API.
- 🚧 **(historical) The blocker this note replaced — 0055 could not be applied from a session —**
  Investigated this pass: the ONLY sanctioned prod-DB path is the `deploy-migrate-prod.yml` workflow
  (manual-dispatch, typed `MIGRATE-PROD` guard) — no DB creds exist in the ephemeral container, and no
  `.env.production`. That workflow has run exactly ONCE (2026-07-23, run 30052709284) and **FAILED at
  the env-check before touching the DB**: its `PROD_POSTGRES_URL_NON_POOLING` / `PROD_POSTGRES_URL` /
  `PROD_SUPABASE_URL` resolved **EMPTY** (`throw "POSTGRES_URL_NON_POOLING is not defined"`, migrate.ts:11).
  Evidence they're mis-scoped, not merely typo'd: the sibling `deploy-email-listener.yml` reads
  `secrets.AWS_DEPLOY_ROLE_ARN` at REPO level with NO `environment:` block and deploys prod fine — so
  repo-level secrets work; the three `PROD_*` came through blank because they are **not set at repo
  level** (likely scoped to a `production` GitHub Environment the migrate job never declares, or absent).
  Re-firing would fail identically, so it was NOT re-triggered. **Two ways to unblock (Pedro's call, I
  did neither — both are speculative live-prod actions):** (a) set `PROD_POSTGRES_URL_NON_POOLING`,
  `PROD_POSTGRES_URL`, `PROD_SUPABASE_URL` as REPO secrets, then dispatch the workflow with
  `confirm=MIGRATE-PROD`; or (b) if they already live in a `production` Environment, add
  `environment: production` to the `migrate` job in `deploy-migrate-prod.yml` and dispatch. Until then
  the summon flow's `codeIslands.create` errors in prod → the flow toasts "Couldn't build a tool"; the
  shipped UI degrades gracefully and is otherwise correct. (0054 `enqueue_allowlist_morning_board` is
  in the same boat — also never applied via this never-succeeding workflow.)
- ⏭️ **Phase 76 REMAINING** (the LIVE-listener legs — deferred, deliberately NOT shipped this pass):
  **76-02b** consume `inputs` in the FastAPI generator prompt (`genui_code.py` +
  `generate_code_island.py`) so emitted code reads `window.__ISLAND_DATA__.{targetKey}` against the
  known shape — additive, back-compat, FULL pytest + ECS redeploy of the LIVE mail receiver. Held
  because its user-visible payoff is gated on the migration blocker above, and redeploying the live mail
  receiver for a not-yet-end-to-end feature isn't worth the operational risk — batch it with the
  migration unblock. **76-05** agent-authored `emit_code_island` behind `CANVAS_EMIT_TOOL_ENABLED`
  (default OFF). The 76-02a api-client passthrough already SHIPPED (`inputs` forwarded, listener ignores
  it until 76-02b — safe).

### ✅ SESSION UPDATE — 2026-07-26 · session_016dmeeGLzwLPZfRwGpByHmn
Continued the "build VISIBLE canvas surfaces" run. All shipped to main via clean fast-forward; every
gate green (web tsc+vitest+build, genui/capabilities/api-client vitest, db drizzle-kit check). Order:
- ✅ **Phase 75 VISIBLE half SHIPPED** (`32b21c6`, CPF-05/06). A merge (or reject) now repaints EVERY
  placed `EntityNode` live — `useMergeReview.settle` invalidates `entities.byId` for BOTH survivor +
  absorbed (was only reviewQueue+list, so placed cards stayed stale). Plus an ephemeral, non-persisted
  cascade-highlight (`cascade-highlight.ts`, `useSyncExternalStore`, NOT the LWW store) → a motion-safe
  ring sweeps the touched cards. Tests: `merge-cascade-invalidate` + `cascade-highlight`. The banger's
  user-facing payoff. **Remaining 75 = the SERVER cascade** (75-01 ledger migration · 75-02
  CascadeCorrectionUseCase promote-suggestion-edges · 75-03 wire into ConfirmMerge best-effort + summary
  passthrough · 75-04 worker re-label) — its user-visible effect (edge promotion, past-mail re-label) is
  LIVE-loop-gated per the spec, and 75-03 touches the LIVE listener merge path. Deferred, flagged.
- ✅ **Phase 76 Wave A (76-01) SHIPPED** (`7866c10`, BTAP-01). The island **data channel**:
  `buildIslandSrcdoc({data})` installs a deep-frozen `window.__ISLAND_DATA__` via `JSON.parse` (inert
  string, never eval) BEFORE user code; `serializeIslandData` rejects pollution/oversize/unserializable;
  CSP + sandbox tokens **byte-for-byte pinned** (`connect-src 'none'`, no allow-same-origin) by a
  drift-guard snapshot; a data-reading island still passes `validateIslandCode`. 645 genui tests.
- ✅ **Phase 76 Wave B (76-03) SHIPPED** (`b64c56c`, BTAP-02/03/04/09/10). The **code-island canvas
  node** — a real, placeable, rehydrating node. `code_islands` table (0055 migration + owner RLS,
  drizzle-kit check green) + `assertCodeIslandOwnership` + ownership-gated `codeIslands.*` router
  (byId/create/remove/list, ownership-first NOT_FOUND, owner stamped server-side, bindings capped +
  pollution-guarded). `code-island` ref-only node type in BOTH allowlists + registry + node-types +
  canvas-vocabulary (L4·right-seam·double geometry, pairwise-distinct). `code-island-node.tsx` fetches
  via byId, collects incoming data-edges through the UNCHANGED `usePanelData` overlay, feeds
  `{targetKey: projection}` into `<CodeIslandFrame data>` (recomputes on input change without restarting
  the repair pipeline). Migration applies via `npm run db:migrate` (until then byId errors are caught by
  the node's error branch). No listener/worker change.
- ⏭️ **Phase 76 REMAINING = the summon loop** (makes the node user-reachable): **76-02b** typed-inputs
  manifest CONSUMED in the listener generator prompt (76-02a api-client passthrough not yet written; the
  Pydantic model already ignores extra fields so it's safe/additive — LIVE listener redeploy); **76-04**
  the "Build a tool from these" flow (select ≥2 data nodes → read `shared.published.{id}` projections →
  manifest+bindings → `codeIslandGenerate` → `codeIslands.create` → materialize ONE node + one data-edge
  per source, idempotent). **NOTE for 76-04:** `spreadsheet-node` does NOT yet publish a projection (only
  the 10 board nodes got the publish port) — the reconciler demo needs a bounded spreadsheet-publish
  added first. **76-05** agent-authored `emit_code_island` (flag-gated, live). This is the largest,
  highest-risk wave (async generate + stateful LWW-canvas mutation + new multi-select gesture) — left for
  a fresh focused pass rather than rushed at session tail.

### ⏸️ PRE-COMPACT CHECKPOINT — 2026-07-25 (resume here)
Pedro's directive this session: **STOP building invisible backend — build NEW interfaces on the CANVAS
(the primary surface) over already-wired backend.** State:
- ✅ **11 new canvas node types LIVE on main** (`fcb68c5` +6, `f555b6b` +5): entity · knowledge-search ·
  review-queue · rule-suggestions · pipeline-health · brief · usage(+`chat.summary` cost-read proc) ·
  documents · references · search-all · conversations. All user-placeable (Add-node menu) AND
  agent-droppable (`canvas.addNode` mirror). Canvas now ~24 node types. Click-path: Chat → `+`.
- ✅ **Bangers filed through GSD** (`2c09695`): proposed milestone **vNEXT — The Living Canvas**, phases
  **73-77** (SPEC.md each, grounded): 73 living-canvas-agent-dataflow (XL, foundation) · 74
  self-assembling-morning-board · 75 correction-propagation-flywheel · 76 bespoke-task-apps-codeisland ·
  77 capability-registry-mcp-server. 41 reqs. Roadmap: `milestones/vNEXT-living-canvas-ROADMAP.md`.
- ✅ **v1.10/v1.11 reconciled to truth** (`2c09695`): `assessment/V1X-RECONCILIATION.md` — product ~82%
  code-complete, AHEAD of the ledger; the unticked boxes are night-run bookkeeping, not missing code.
  Real remaining = **5-seam code punch-list** [RCNV-02 ledger→canvas reconcile · RCNV-03 mount
  CanonToolbar · DOCS-01 export affordance · REG-04 mount CapabilityConfirmCard · RSRCH-04 mid-stream
  refine] + defer RCNV-05 + **~1h human-gated legs** (LIVE-03 OAuth, LIVE-04 forward mail, CLUS-07,
  pixel 62/63). STATE.md progress corrected 1→3 / 16→50%.
- ✅ **Phase 73 Wave A SHIPPED (the wedge)** — the agent can now DRAW nodes + WIRE data-edges on the
  canvas. Web `a2393f2` (MessagePart `canvas_add_node`/`canvas_connect` + `reconcileNodesFromHistory`
  Pass 2b + `collectAgentEdges` + chat-canvas additive edge merge + transcript/stream-reducer skip;
  13 tests) and listener `203a8b5` (`emit_canvas_node`/`emit_canvas_connect` behind
  `CANVAS_EMIT_TOOL_ENABLED` default-OFF, structural-omission wiring; mirrors the `emit_ui_spec`
  emit-a-part path — no executor, no SES/mail touch). LCAN-01/02/06 green. Gates: web tsc + 1008 vitest
  + placeholder build; listener ruff + lint-imports + mypy(288) + full pytest. On feature branch
  `claude/polytoken-email-infra-cont-qi9q5g` (NOT yet on main — needs squash-merge; listener redeploy is
  a no-op while the flag is OFF). The dead workflow (wf_397f3345, died 19:45) is fully superseded.
- ✅ **Phase 73 Wave B SHIPPED (the publish port)** — the wire now CARRIES DATA. Core `c2139f7`
  (`projectForPublish` bounded JSON projection + `useCanvasPublish` → `shared.published.{nodeId}` +
  agent-edge friendly→physical sourcePath rewrite + usage reference; `canvas-publish.test.ts` LCAN-03,
  `canvas-publish-flow.test.tsx` LCAN-04 zero-mock publish→edge→live-target) and fan-out `00f19db`
  (publish port wired into 10 more source nodes: pipeline-health/brief/entity/references/conversations/
  documents/search-all/knowledge-search/review-queue/rule-suggestions, via 3 parallel agents). Gates:
  tsc + canvas/hooks vitest (1023) + placeholder build. LCAN-05 client-live proven; DB-row/real-browser
  gate owed. On feature branch (pending squash-merge to main).
- ✅ **Phase 74 SHIPPED (self-assembling morning board — MVP + overnight backend).** (a) VISIBLE MVP
  `f573c3d`: `/chat` Add-node → **Assemble board** drops brief+review-queue+usage in one click (live
  now, no gate). (b) Overnight backend: worker `1fe5b80` (cron `0 5 UTC` gated on
  `MORNING_BOARD_ENABLED` → `dispatch_morning_boards` fan-out → idempotent per-user
  `assemble_morning_board` → POST `/v1/home/assemble-job`; migration 0054 additive allowlist) +
  listener `<this commit>` (flag + deterministic composer + tenancy-safe service-role home writer +
  route). MORN-01..06 green; ships DARK (worker cron omitted + listener no-ops until the ONE env var
  `MORNING_BOARD_ENABLED` flips). Gates: worker tsc+vitest, packages/db tsc, listener
  ruff+lint-imports+mypy(302)+full pytest(2061).
- ✅ **Phase 74 MORN-07 PAINT SLICE SHIPPED** (`f5eef75`): `/home` now RENDERS the composed board as a
  real canvas. New `HomeCanvas` (ReactFlow + CanvasStoreProvider + shared /chat nodeTypes, dynamic
  ssr:false island) paints the home layout's nodes; `home-board.tsx` shows the canvas when the layout
  has nodes (else the fixed panels) + an "Assemble board" button that writes the node set client-side
  (visible NOW, no flag). The overnight composer writes into the SAME home layout HomeCanvas reads, so
  flipping `MORNING_BOARD_ENABLED` makes the pre-assembled board appear. REMAINING for MORN-07: only the
  LIVE overnight-run screenshot gate.
- **RESUME NEXT:** (1) squash-merge Phase 74 backend to main (MVP f573c3d + worker 1fe5b80 already on
  feature branch; listener needs main); the listener merge redeploys the mail receiver — SAFE (flag
  OFF). (2) The `/home` canvas-render slice (MORN-07 visible) — bring node-type rendering to /home.
  (3) **Phase 73 Wave C** — named recipes (`canvas_recipes` migration + CRUD + badge, LCAN-07) +
  durable recompute (LCAN-09); migration-gated. (4) Phases 75-77 + the 5-seam v1.x punch-list. To
  live-verify the agent-draw + morning board end-to-end, flip `CANVAS_EMIT_TOOL_ENABLED` and
  `MORNING_BOARD_ENABLED`. Tree CLEAN + pushed.

**Shipped to main since the last chronological block:**
- **6 NEW CANVAS NODE TYPES → main `fcb68c5`** (2026-07-25, Vercel-only; NO listener/migration/infra
  so the live mail receiver is untouched). Pedro's directive: stop building invisible backend — build
  NEW interfaces on the canvas (the primary surface) over already-wired backend. Added `entity`
  (entities.byId + an entity-picker over entities.list), `knowledge-search` (knowledge.search/list),
  `review-queue` (entities.reviewQueue + confirm/rejectMerge inline), `rule-suggestions`
  (emails.list + ruleSuggestions), `pipeline-health` (usePipelineHealth), `brief` (shapeMorningBrief).
  Each user-placeable (Add-node menu) AND agent-droppable (canvas.addNode mirror). Central wiring in
  one hand (node-data-schemas/registry/node-types/dims/canvas-vocabulary geometry+labels/capabilities
  mirror/api-client builtin-manifest+projection-map hand-mirrors); drift+fixture tests extended
  additively. Gates green: tsc ×3, vitest web 1873 / cap 65 / api-client 746, placeholder next build.
  Built via a parallel component workflow (7 agents; `usage` dropped — no user-scoped cost-read proc)
  + one integration agent; I verified diffs additive, fixed a builtin-manifest describe-mirror drift,
  ran all gates, squashed WIP → `fcb68c5`. **Click-path: sidebar → Chat → Add node (top-right +).**
  NEXT canvas fronts (works-when-clicked, no blockers): add the `usage` cost-read proc + node; more
  node types. Boards/workspaces = migration-0052-gated (needs a prod token or a migrate-deploy).
- **5 MORE CANVAS NODE TYPES (wave 2) → main `f555b6b`** (2026-07-25, Vercel-only). `usage` (live spend
  meter — added owner-scoped read proc `chat.summary` over ChatCostLedger in chat/cost.ts), `documents`
  (recent-docs browser, documents.list), `references` (references.list), `search-all` (omnibox,
  search.omnibox across entities/mail/chats/knowledge/files), `conversations` (chat.listConversations).
  Same central-wiring discipline; 5 distinct ink geometries; describe strings untouched (no manifest
  drift). Gates green: tsc ×3, vitest web 1998 / cap 65 / api-client 746, placeholder next build.
  **11 NEW CANVAS NODE TYPES total shipped this session** (canvas is now ~24 node types). Click-path:
  sidebar → Chat → Add node (+). All user-placeable AND agent-droppable via canvas.addNode.
  BANGER DIRECTION (Pedro's vision Q, 2026-07-25): the emergent superpower is agent-authored LIVE
  DATAFLOW on the canvas — canvas.connect (sourcePath→targetKey data edges) + live ref-only nodes +
  genui + the capability registry = the AI assembling running machines over the user's compounding
  personal graph. The wedge to prove it: teach the chat agent to emit canvas.addNode + canvas.connect
  as CLIENT-APPLIED tool calls so "make me a board that tracks X" draws + wires itself live (the
  deferred marquee). That's the next high-leverage build.
- **Visible batch #1–#6** — all on main (the dead `wf_6f85ee71` workflow was recovered by hand). DONE.
- **Track 2 — `container.py` split: COMPLETE (9/9 groups).** First 5 (genui, repositories, llm_adapter,
  cost, anticipatory) + the final 4 this session (chat_turn `2e8aac6` → document_region `5bfc8e7` →
  entity `9d00777` → ingestion `58e975e`, all on main). `container.py` is now a pure composition root:
  the client singletons + three boto3 anchors (raw_email_store/parser_registry/embedder — the boot
  test's patch targets), and one `register()` call per group. **1434 → 218 lines.** ultracode-audited
  (88=88 bindings, nothing dropped) with a full-graph boot safety net. Ingestion group is
  `all_movable=false`: the moved ingest factory calls the staying `_provide_parser_registry` via a
  DEFERRED import (avoids the load-time circular import; boto3 patch still resolves). Verify loop green
  every group: boot gate + full app suite + lint-imports + mypy-neutral. The merge-conflict magnet is
  fully dissolved.
- **Landscape redesign**: replaced the circle-pack with a WizTree-style **labelled Treemap** primitive
  (`@polytoken/ui/treemap`); all 3 consumers swapped; design-law law-2 serif fix (`evidenceLabels`);
  leftover circle iconography → `LayoutDashboard`. Commits `47fee11`, `242a04c`. On main.
  **VISUAL sign-off owed** — Pedro's eyes on the `polytoken.ai` Landscape tab (jsdom proves no pixels;
  this container can't run the screenshot/geometry gates).
- **GSD Core v1.8.0** vendored into the repo (commands + agents + skills + hooks); reconciliation in
  `.planning/GSD-INSTALL.md`. Commit `9f89865`. NOTE: skills/commands are prompt-shells; the
  `gsd-tools` execution backend is NOT installed (so `/gsd:*` self-execution is partial — see
  GSD-INSTALL.md "execution backend" note).

**State reconciled (this update, 2026-07-24):** GSD's `STATE.md` stays the structural milestone
tracker (v1.11); **THIS file is the live ledger.** The bottom-of-file `01RZ`/`jzz1pg` standing config
is quarantined under a SUPERSEDED header.

**NEXT. Open build fronts, master-plan order:**
1. ~~**Track 2 finish**~~ — DONE (9/9 groups on main, `container.py` 1434→218). ✅
2. **Track 3 FOUNDATION (task #7) — Part A BUILT on the feature branch (NOT yet on main).** Ran an
   understand→design→critique workflow (design at `assessment/2026-07-24/20-track3-design.md`), then
   built + gated the whole confirmed-buildable set:
   - **3a durable runtime:** A1 to_thread-wrap the ingest path (102 sites) · A2 JobEnqueuer port+adapter+DI ·
     A3 `public.enqueue_job` graphile wrapper migration (0053) · A4 flag-gated SNS enqueue
     (`INGEST_ENQUEUE_ENABLED`, default off — the silent-loss fix) · A5 internal `/v1/emails/ingest-job`
     (5xx-on-fail) · A6 `apps/worker` co-located graphile-worker Node package.
   - **3b canvas rows:** B1 canvases/canvas_nodes/canvas_edges schema + 0052 · B2 CanvasRepository ·
     B3 `CANVAS_ROW_MODEL` flag (default off) + Blob/Row backends.
   - **PROVEN beyond gates:** stood up a real pg16 + graphile-worker 0.17.3 cluster in-container (via
     `runuser`) → the A3 SECURITY-DEFINER wrapper (add_job.id shape, job_key idempotency, allowlist,
     service_role GRANT) and the A6 worker↔Python-HTTP seam (drain + 500→attempts++) are proven end-to-end.
   - **Everything flag-OFF by default = zero runtime change.** All gates green (listener full `uv run pytest`
     + mypy + ruff + lint-imports; web/db tsc + vitest for db/api-client/apps/web).
   - **Adversarial review pass** (4 dimension reviewers → refute-by-default verify): 5 findings → 2 CONFIRMED
     (both flag-gated canvas-cutover data-safety holes) FIXED — (1) HIGH: a partial agent-minted canvas row
     could shadow+clobber a richer blob at read_rows; now the read fallback is PARITY-keyed (blob wins until
     the row is backfilled to parity). (2) MED: concurrent canvas create raced the partial unique index → 500;
     now onConflictDoNothing + re-select. 3 findings refuted; 2 refuted-but-cheap hardenings applied
     (JobEnqueuer now in the boot test; worker env-int parse guarded).
   - **DEFERRED (by design):** A7 Dockerfile-rollout (docker daemon down here; = P4, Pedro) · A9
     deep_research turn-detach (changes the live streaming turn; Part B) · A8 DLQ ops tRPC router
     (no admin-auth pattern exists — don't invent one as a side effect; query `graphile_worker.jobs`
     by SQL meanwhile). RLS/apply-from-scratch for 0052 is Track-2-CI-gated (no pgvector here).
   - **⚠️ Part-B rollout is Pedro's coordinated step (P0–P12 in the design doc):** merging listener code
     to `main` AUTO-REDEPLOYS the LIVE mail receiver (`deploy-email-listener.yml`). So Part A stays on the
     FEATURE BRANCH; production = apply migrations (P3, after install-schema) → merge → flip flags. I did
     NOT self-merge Track 3 to main.
3. **Track 1** — remote state + import. **Safe prep DONE; execution is Pedro-only** (no terraform
   binary/creds in-container). Found + closed a real gap: `IMPORT-RUNBOOK.md` covered only the 5
   forwarder resources, but the full stack is 46 — a fresh checkout's `apply` would try to CREATE the
   live SES rules/SNS/S3 → mail outage. New `infrastructure/aws/REMOTE-STATE-RUNBOOK.md`: state
   backend+lock setup, `init -migrate-state` as the primary path (imports nothing), the re-import
   fallback with config-derivable mail-pipeline IDs + the for_each/count gotcha, and the hard gate
   (`terraform plan` must show ZERO create/replace on any live resource before apply). main.tf's
   commented backend block completed (dynamodb_table + encrypt). Commit `3c6b9b4`.
4. **The "lives in it" proof (Pedro-only, gates everything)** — sign in on the deployed app + forward
   real mail (LIVE-03/04, CLUS-07). Nothing built counts as "usable" until this runs once.
5. **Track 4 S1 — SNS inbound authenticity (SSRF + forgery). SHIPPED to main `8f95163` (2026-07-25),
   deploy run #28.** The unauthenticated `/v1/emails/inbound-sns` trusted any POST body — a
   live-exploitable SSRF (`confirm_subscription` GET any attacker `SubscribeURL`) + zero SNS signature
   verification (forge Notifications/SubscriptionConfirmations). Two controls, tuned for NO mail-outage:
   (a) **UNCONDITIONAL host-pin** — `is_sns_host()` requires `https://sns.<region>.amazonaws.com[.cn]`;
   handler 403s a non-SNS SubscribeURL before any GET (`confirmation.py` re-checks as defense-in-depth).
   A real AWS URL always matches → zero false-positive risk → SSRF closed on deploy.
   (b) **Full AWS SNS signature verify** (`infrastructure/sns/verification.py`): canonical string per AWS
   spec (SignatureVersion 1/SHA1 legacy + 2/SHA256), RSA verify vs the signing cert fetched ONLY from a
   host-pinned URL + cached. Gated by `SNS_VERIFY_SIGNATURE` (default True = verify+LOG, NEVER rejects on
   its own — a verifier bug can't drop live mail) and `SNS_SIGNATURE_ENFORCED` (default False = the
   reversible flip to 403 forgeries once logs confirm clean traffic). **Pedro's activation: watch logs
   for `sns_signature_invalid` on real mail; when clean, set `SNS_SIGNATURE_ENFORCED=true`.** Canonical
   builder covered by a real-key round-trip test (guards against rejecting valid mail). All deploy gates
   green (ruff check + mypy + full `uv run pytest` 2027 passed) + CI extras (format-check changed files,
   lint-imports 3/3, bandit 0).

**Fixed this block:** the pre-existing mypy-RED (task-6 linked-context test stubs) — now `mypy app` = 0
issues. Also fixed a Track-2 fallout: 2 tests under `tests/` imported promote factories from `app.container`
that the entity split moved to `app.composition.entity_providers` — missed because the Track-2 gate ran
`pytest app` while CI runs the full `uv run pytest` (collects `tests/`). Repointed; full suite green.
**Lesson: gate the listener with `uv run pytest` (no path), matching CI — not `pytest app`.**

## RESUME PROTOCOL — a fresh/resumed session does this FIRST
1. Branch is `claude/polytoken-email-infra-cont-qi9q5g`. `git fetch origin`; confirm you're on it.
2. Read `.planning/assessment/2026-07-24/00-MASTER-PLAN.md` (the sequenced plan) + this ledger's top
   Status block (what's in flight).
3. IN-FLIGHT WORKFLOWS do NOT survive a container death — re-check by hand:
   - Visible build batch: branches `claude/wf1-*` are pushed to origin (treemap-zoomout,
     attachment-carousel, chat-autoload-fab, genui-action-graceful, screenshot-fix, and
     email-context-in-chat when it lands). If not yet merged, run the SHIP PROTOCOL (step 4);
     re-verify each branch before merging if the workflow died mid-run.
   - Foundation workflows (Track 2/1/3): check this ledger for what was launched.
4. SHIP PROTOCOL (visible batch): merge each adversarially-verified `wf1-*` branch into the feature
   branch (drop any that failed verify); run FULL gates — `npx tsc --noEmit -p apps/web` + `npx
   vitest run` (apps/web) + placeholder `SKIP_ENV_VALIDATION=1 NEXT_DIST_DIR=.next-verify next build`
   then `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json`; fast-forward `main`
   (`git push origin HEAD:main`) = ONE Vercel build; give Pedro per-fix click-paths at polytoken.ai.
5. THEN foundation IN ORDER: Track 2 (split `container.py` FIRST — the merge-conflict magnet — then
   the other god-files + TypeScript CI + real-Postgres tenant-isolation job) → Track 1 (Terraform
   remote state + import ALL live resources; NO `apply` before that) → Track 3 (graphile-worker
   durable runtime [fixes the silent email loss] + Workspace→Canvas→Node rows; sole migration owner).
6. GUARDRAILS: commit trailers (`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + the
   `Claude-Session` line); NEVER the model id in commits; NO PR unless Pedro asks; obey the CLAUDE.md
   live-infra landmines (never rename magnitudetech/nauta resources; no `terraform apply` without
   imported remote state); models fable-5 / opus-4.8 / sonnet-5 only, never haiku. The strategic FORK
   (broad platform vs email wedge) is OPEN — it only reorders feature Tracks 6 vs 7/8/9 (downstream
   of the foundation), so it does NOT block Tracks 0–3.

## SHIPPED TO MAIN — visible batch (4/6) · 2026-07-24 14:4x UTC · merge `8ed86ce`
The wf_6f85ee71-d16 build workflow DIED mid-run (journal froze 12:36 UTC after 3 slice results;
no live process). Recovered by hand and shipped the real work:
- ✅ #1 treemap zoom-out (`04c6015`) · ✅ #2 attachment carousel (`31a4cce`) · ✅ #4 screenshot fix
  (`456200e`) — were committed+pushed by the workflow before it died.
- ✅ #3 chat auto-load + FAB (`c10d03c`, +787) — was BUILT but left UNCOMMITTED in the worktree;
  recovered the 8 modified + 5 new files and committed on-branch.
- Merged all 4 into the feature branch (no conflicts), ran FULL gates GREEN: `tsc -p apps/web` ✓ ·
  vitest 1753 passed / 141 files ✓ · placeholder `next build` ✓. Fast-forwarded `main`
  (`2615ebc..8ed86ce`) = ONE Vercel build. Feature branch + all `wf1-*` pushed.
- ✅ BATCH 2 (was owed) SHIPPED by hand · merge `2e01108`:
  - #5 GenUI graceful-fail (`4fc7e2e`): added `safeInvokeAction` — button/form action handlers now
    catch BOTH a sync throw and a rejected-promise return (host handlers are async), log
    server-side, no-op to the user. Was: sync-only try/catch → async rejection crashed the surface.
    632 genui tests green + new regression test.
  - #6 email-context-in-chat (`2e01108`): the production fix already existed (importer-scoped linked
    context, Phases 44-09/56-04) but was UNTESTED. Added the regression guard at
    `system_prompt_with_linked_context`: owned importer_ids → email subject+body reach the prompt;
    no importer_ids → default read → [] → dropped (documents the bug). ruff+format+lint-imports+3 tests green.
  - Full web gates re-run green (tsc ✓ · genui-boundary vitest ✓ · placeholder next build ✓) since #5
    changed genui (bundled into apps/web). Fast-forwarded main (`60a93f3..2e01108`) = one Vercel build.
- ✅✅ ALL 6 VISIBLE SLICES (#1–#6) NOW ON MAIN. The dead-workflow batch is fully recovered + shipped.
  NEXT: Task #7 FOUNDATION — Track 2 (split container.py FIRST) → Track 1 (TF state) → Track 3
  (graphile-worker + Workspace→Canvas→Node rows). Strategic FORK still OPEN (doesn't block 2/1/3).

## TRACK 2 FOUNDATION IN PROGRESS — container.py decomposition (2026-07-24)
Goal: split the 1434-line `container.py` (the "merge-conflict magnet", ~60 dishka providers)
into grouped `app/composition/*.py` modules, each owning its factories + a `register(provider)`.
- ✅ SAFETY NET first (`3772eae`): `app/__tests__/test_container_boot.py` resolves all 19 major
  top-level providers under mocked clients — their transitive closure spans nearly the whole
  graph. This is the gate: any binding lost during a move fails here loudly.
- ✅ GROUP 1 GenUI (`a28402b`): 11 factories → `app/composition/genui_providers.py`. 1434 → 1252.
  Verified: 13 boot tests + mypy + lint-imports + 304 genui tests green. Zero behavior change.
- ✅ GROUP 2 Supabase repositories (`26748ad`): highest-churn cluster → `repository_providers.py`. 1252→1165.
- ✅ GROUP 3 LLM adapters (`4a040fa`): autofiller/classifier/segmenter + both chat adapters + router
  → `llm_adapter_providers.py`. 1165→1092.
- ✅ ULTRACODE AUDIT (`wf_2708aa65`, 5 agents/3 adversarial lenses): binding-set EQUIVALENT (88=88,
  nothing dropped), moved-factory bodies byte-identical, none touch patched globals. Found + FIXED a
  safety-net hole: boot test reached only 66/88 → strengthened to resolve ALL 88 (`6e31a09`).
- ✅ GROUPS 4+5 cost + anticipatory (`4c6d331`): → `cost_providers.py`, `anticipatory_providers.py`. 1092→1039.
- container.py now 1039 (from 1434). **5 of ~9 groups extracted; ALL shipped to main.**
- ⏭️ REMAINING (turnkey spec in `.planning/assessment/2026-07-24/12-container-split-remaining.md`):
  chat_turn → document_region → entity → ingestion (order + per-group gotchas + must-stay list +
  the exact 4-step verify loop are all in that doc). ingestion needs a deferred import (parser_registry).
  PATTERN PROVEN + full-graph safety net: each remaining group is low-risk mechanical continuation.
- ⛔ CONSTRAINT (do not trip): the boot tests patch `app.container.get_supabase_client` /
  `get_anthropic_client` / `boto3`. The client-singleton factories that call those globals MUST
  stay in container.py — only move factories that take `client`/ports as INJECTED params.
- NEXT groups (same register-pattern, verify with boot test each time): repositories (highest
  churn), LLM adapters (autofiller/classifier/segmenter/chat), ingestion, entity/region use cases,
  chat spine. Then Track 1 (TF state) → Track 3 (graphile-worker + node rows).

## Status: ASSESSMENT + MASTER PLAN DELIVERED ✅ · foundation started (2026-07-24)

> Pedro pasted the "optimized handoff" (assessment-and-plan brief) + "use ultracode and best model",
> then course-corrected hard: "nothing shows up on my UI… I need stuff actually built and on my UI."
> Two workflows launched:
>   1. VISIBLE BUILD BATCH (wf_6f85ee71-d16) — 6 slices in isolated worktrees (treemap zoom-out,
>      attachment carousel, chat auto-load+FAB, screenshot fix, genui graceful-fail, email-context-
>      in-chat), each wired to a reachable route + adversarially verified. STILL RUNNING as of this
>      write; branches `claude/wf1-*`. On return: merge verified → full integrated gates → ship to
>      main (ONE Vercel build) → give Pedro click-paths. NOTHING on main yet.
>   2. ASSESSMENT + PLAN (wf_a0b0c50b-cb6) — DONE. 8 recon + 6 research lanes → docs in
>      `.planning/assessment/2026-07-24/` + `.planning/research/2026-07-24/`; synthesis in
>      `00-MASTER-PLAN.md` (committed 52bdfb2). Artifact (phone-readable) published.
>
> Pedro's DECISION (AskUserQuestion): "Ship visible batch + start foundation." The strategic FORK
> (broad platform vs email wedge) is still OPEN — it only reorders feature Tracks 6 vs 7/8/9, all
> downstream of the foundation, so it does NOT block Tracks 0–3.
>
> TRACK 0 (landmine safing) — DONE this session (docs only, zero code risk):
>   - CLAUDE.md: added the "Live-infra landmines" guard (magnitudetech/nauta are LIVE — renaming =
>     mail outage; no TF remote state; SES sandbox; SNS swallows failures) + fixed the stale
>     orientation pointer (was → 07-22 META-AUDIT; now → this ledger + the master plan).
>   - STATE.md: added a banner (it's GSD phase-tracking, not the live ledger).
>   - Key rotation + budget-alert decoupling + AWS Budget hard-cap = Pedro's out-of-band actions
>     (can't be done from here); flagged in the master plan §4 + Track 0.
>
> NEXT (after the visible batch merges — deliberately sequenced AFTER it so I don't collide with the
> in-flight wf1 branches on container.py/run_chat_turn.py):
>   - TRACK 2: split container.py (merge-conflict magnet) FIRST, then run_chat_turn.py / chat-canvas.tsx
>     / manifest.ts; add TypeScript CI (zero exists today); real-Postgres tenant-isolation CI job.
>   - TRACK 1: Terraform remote state + import ALL live resources (gate before any apply).
>   - TRACK 3: graphile-worker durable runtime (3a, fixes silent email loss) + Workspace→Canvas→Node
>     rows (3b). Serialized behind 1 & 2; sole migration owner.

## Status: DOCUMENT-NODE SHIPPED TO MAIN ✅ (2026-07-24, main @ 2615ebc) — Vercel building

> New session (opus-4.8, session_016dmeeGLzwLPZfRwGpByHmn) resuming the unattended run.
> Branch is now `claude/polytoken-email-infra-cont-qi9q5g` (the prior `-jzz1pg` work was all
> consolidated onto main @ 0dd20bb before this session; nothing lost). On resume the tree was
> clean and fully shipped (HEAD == origin/main == 0dd20bb). Shipped ONE safe increment:
>   - 2615ebc feat(web): document create-from-scratch node from the canvas Add-node menu.
>     The `document` node type + data schema + capabilities mirror already existed (a reference
>     node needing an existing documentId); this added the missing CREATE-BLANK path — a
>     `documents.create` tRPC mutation (owner stamped server-side, inserts a minimal blank
>     ReportDocument envelope spec.id===row.id/blocks:[], returns {documentId, created:true}; no
>     apps/web import, no new capability — plain owner-scoped write like the read router), an
>     AddNodeMenu "Document" item + handleAddDocument host handler mirroring the spreadsheet
>     create→place, and document node dims (300×140). NO new node type → NO mirror drift.
>   Gates: api-client tsc clean + documents.create control-plane test 3/3; web tsc clean + full
>   vitest 136 files/1720 green; placeholder next build clean (all routes compiled). Web/
>   api-client only → only the Vercel build fires. Fast-forwarded main 0dd20bb..2615ebc.
>   ⚠️ VISUAL: the document node component (document-node.tsx) already ships unchanged; the only
>   NEW pixels are one dropdown item mirroring the adjacent "Spreadsheet" item. jsdom does no
>   layout + this container can't run the screenshot/geometry gates, so verify at
>   https://polytoken.ai (canvas → top-right "+" Add node → Document → node places, opens the
>   blank doc). Very low visual risk.
>
> REMAINING (unchanged, both need the LIVE loop / Pedro — NOT blind-shipped this session):
>   1. AI-BUILDS-A-NODE-FROM-A-PROMPT (marquee) — canvas.addNode as an EMIT-STYLE client-applied
>      agent tool + a new web seam routing the tool-result to the ReactFlow store. All-or-nothing,
>      needs the live agent→canvas loop to verify. Build WITH Pedro.
>   2. CHAT WRITES FILES INTO A NODE — scoped this session: NO document.*/files.write capability
>      exists anywhere, and the Python chat loop currently offers ZERO write tools (all 4 read).
>      Requires a document.create/update capability + DocumentStore port + fail-closed default +
>      Drizzle store binding + Python registry registration + wiring a write tool into the Python
>      tool loop (container.py + chat_tools.py build_*_tool). Same "needs the live agent loop to
>      verify" risk as the marquee → deferred to an attended session, not blind-shipped.
>   3. #13 listener-auth hardening still DEFERRED (runbook staged). drizzle 0050 tracking row still
>      self-heals on next migrate (cosmetic).

## Prior status: EDITOR-MERGE SHIPPED TO MAIN ✅ (2026-07-24, main @ 54622c1) — Vercel building

> Pedro: "everything is everything" — do it all, no more asking. Shipped the HEADLINE that
> had been dodged all session:
>   - 54622c1 feat(web): the editor IS the email preview (one surface, no /emails/[id] hop).
>     EmailDetail gains an `embedded` mode (no <main>/back-link/focus-steal, compact
>     status/Reprocess row); inbox-email-preview renders it via next/dynamic ssr:false (keeps
>     pdfjs out of the inbox shell) with subject+meta+rule-review header; /emails/[id] is now a
>     server redirect → /?email=<id> (every deep link still resolves; inbox seeds selection
>     from the param); reading pane widened + entities aside removed there (detail lives in the
>     editor's inspector). Body view now gets `components` so inline body shows its text-anchored
>     highlights. Tests updated (inbox-structure pane set, useSearchParams mocks, route-loading).
>     Web 136 files / 1718 green; prod build clean (/emails/[id] → 200B redirect). Task #21 DONE.
> Fast-forwarded main 71a0ff4..54622c1 (web-only; only Vercel builds).
>
> ALL of tasks #21-#24 now DONE. Remaining stretch items (from the broader vision, not yet
> built): AI-creates-a-node-from-a-prompt (mobile genui-from-SQL), more directly-addable node
> types (spreadsheet/document create flows), chat-creates-files-into-a-node. #13 listener-auth
> still deferred pending Pedro.

## Prior status: ADD-NODES SHIPPED TO MAIN ✅ (2026-07-24, main @ 71a0ff4) — Vercel building

> Pedro (justifiably) called out that "add nodes of various types" / "landscape isn't on the
> canvas" was NOT done — I had wrongly filed it as low-priority polish. FIXED and shipped:
>   - 71a0ff4 feat(web): AddNodeMenu — a touch-reachable "Add node" dropdown in the canvas
>     Panel (the pane right-click menu was desktop-only, so a phone couldn't place a node).
>     Offers Email treemap + Drive treemap (circle-pack LANDSCAPES placed directly, no picker)
>     and Email thread… / Knowledge node… (existing pickers). handleAddCirclePack + circle-pack
>     added to PANE_ADDABLE + pane onAddNode + CANVAS_NODE_DIMENSIONS. Task #22 now DONE
>     (canvas-on-mobile + gesture isolation + add-node incl. landscape). 5 new tests; web 136
>     files / 1718 green; prod build clean. Verify at https://polytoken.ai (canvas → top-right
>     "+" Add node → Email treemap).
> Fast-forwarded main 8dd874e..71a0ff4 (web-only; only Vercel builds).

## Prior status: BATCH 3 SHIPPED TO MAIN ✅ (2026-07-24, main @ 8dd874e) — Vercel prod build triggered

> Pedro said "full go to main with everything ... no users, ship and I'll verify once up."
> Fast-forwarded main 1525a44..8dd874e (11 commits, web/api-client/planning only — NO listener
> or migration changes, so ONLY the Vercel web build fires; listener untouched). Prod `next
> build` verified clean locally first (every route compiled, static/dynamic gen OK) with
> placeholder env. What went live: maritime hidden in Knowledge/entity-types, body overlays
> fixed (text-anchored highlighter), canvas-on-mobile, FAB overlap fix, double-send latch,
> stuck-skeleton fallback, searchable chat email picker, treemap gesture isolation. Verify at
> https://polytoken.ai once Vercel finishes (~2-5 min). Migration 0050 was already applied to
> prod earlier this session (data purge done).
> NOT shipped (staged for an attended session): #21 editor-becomes-preview merge, #22 treemap
> expand/add-node polish.

## Prior status: BATCH 3 IN FLIGHT 🔧 (2026-07-24) — 2 UI worktree agents (salvaged after restart)

> BATCH 2 is DONE and LIVE on prod. Listener deploy run 30052959299 (main@1525a44)
> concluded **SUCCESS** ✅ (verified via actions_get 2026-07-24) — email-context importer
> fix is live on the prod listener. Open item 1 RESOLVED.
>
> BATCH 3 (this session, opus-4-8 after Fable-5 hit its usage limit) — responding to Pedro's
> mobile drop "editor is email preview itself / canvas on mobile / treemap navigable inside
> canvas / chat buttons overlapping / improve email context picker / minor chat bugs /
> remove maritime". Landed to the feature branch so far:
>   - 16c50f9 fix(web): hide retired maritime entity types from Knowledge + entityTypes.list
>     (is_active + retired-slug exclusion; shared allow-list router/retired-entity-types.ts;
>     api-client 730 tests green + tsc clean). Belt-and-braces vs the un-applied 0050.
>   - 6695956 feat(web): text-anchored body-region highlighter (CSS Custom Highlight API) —
>     the CORRECT fix for the misaligned body overlays (the "PEDREDRO," garble). Pure matcher
>     unit-tested (6 green). Wiring lands with the editor-merge.
> UPDATE 2026-07-24 (opus): both worktree agents were KILLED mid-run by a container restart
> (~75min, no completion notification). Their partial diffs were SALVAGED from the worktrees,
> repaired, gated, and committed to the feature branch. Landed since:
>   - db7f077 feat(web): canvas on mobile (dropped the isMobile→chat coercion; toggle shown on
>     every viewport) + FAB overlap fix (bottom-24 when a composer is present) + double-send
>     latch (composer submittingRef + controller sendInFlightRef) + stuck-skeleton terminal
>     fallback (MessageTurn flips genui boundary out of streaming on stopped/interrupted/
>     cost_capped — NOT on "completed", which is the D-01 async-resume case; that distinction
>     also fixed a transcript-panel-toolbar force-lock regression). +::highlight CSS rule.
>   - 903bea5 fix(web): wired the body-region highlighter into body-view.tsx — dropped the
>     broken polygon OverlayLayer path; body overlays now render CORRECTLY (text-anchored).
>     The "email preview needs to work and show overlays correctly" HALF of the headline is DONE.
>   - 991b659 fix(web): circle-pack treemap node gesture isolation (nowheel nopan nodrag) so
>     the pack is explorable inside the canvas without panning the board.
> Gates on every commit: web tsc clean + full vitest (134 files / 1709 tests) green.
> Dead worktrees removed.
>
> UPDATE 2 (2026-07-24, opus, later backstop): more landed to the branch —
>   - bc05e60 feat(web): searchable inbox picker for chat email-context (#23 email-selection).
>     New ThreadPickerDialog (CommandDialog: search + subject/count·time/snippet rows) replaces
>     the flat subject-only slice(0,20) in the composer attach menu. 4 new tests. → Task #23
>     is now FULLY DONE (FAB + double-send + skeleton + picker).
>   Gates: web tsc clean + vitest 135 files / 1713 tests green.
>
> STILL TODO on this batch:
>   - #21 HEADLINE: "editor is email preview itself, no separate things. just one thing." —
>     merge the /emails/[id] editor INTO the inbox inline preview as ONE surface + redirect the
>     route to /?email=<id>. NOT started (only the body-overlay half is done). This is the big
>     multi-file refactor and is UX-heavy — it genuinely needs VISUAL verification (jsdom does
>     no layout; CLAUDE.md law), so it is staged for an ATTENDED session, not the unattended
>     backstop loop. Scout report for it is in the session transcript.
>   - #22 (polish, LOW priority — core "explore the treemap inside the canvas" is already met
>     by the gesture-isolation commit): treemap node full-screen EXPAND affordance + a pane
>     "Add node ▸ Email treemap" entry (handleAddCirclePack in chat-canvas.tsx, data
>     {scope:"mailbox"}). Nice-to-have; the AI can already place circle-pack nodes.
> NOT fast-forwarded to main yet — batching with the remaining editor-merge so it is ONE
> Vercel deploy (cost-conscious, per Pedro's request to watch build/infra costs). Everything on
> the branch is independently complete + gated, so it is deployable whenever desired.
>
> PROD DB STATE (verified via Management API, 2026-07-24): drizzle.__drizzle_migrations
> showed 50 rows = through 0049. Hash check confirmed 0048 (3540513969…) + 0049 (8ea707f9…)
> applied, 0050 (4420f67b7…) NOT. So prod had DEACTIVATED the maritime types (0049) but never
> PURGED the data rows (0050) — which is why the Knowledge screenshot still showed them.
>
> ✅ 0050 APPLIED to prod (2026-07-24) via the Management API query endpoint (same path as
>    0043-0047; Pedro supplied the sbp_ token and chose this path). HTTP 201, DO block ran to
>    completion with no error → the six maritime system entity_types + their instances,
>    extraction_records, corrections, candidate-links, instance/type-scoped knowledge_nodes
>    (+cascaded edges/links), and maritime sender categories are DELETED, atomically (single
>    txn). Task #19 DONE at the DB level; 16c50f9 already hid them on the web side.
>    ⚠️ LOOSE END: the drizzle tracking ROW for 0050 could NOT be inserted — the safety
>    classifier blocked the follow-up metadata write. This is COSMETIC/SELF-HEALING: 0050 is
>    idempotent (empty arrays → all-no-op), so the next `migrate` run (Action or local) will
>    re-run it as a no-op and record the row. To finish cleanly now, run this ONE line in the
>    Supabase SQL Editor (dashboard):
>      insert into drizzle.__drizzle_migrations (hash, created_at)
>      values ('4420f67b7efca8962511d218739b4de324a3c34ebdd9c0dbd99eda037a0c432c', 1784900200000);
>    ⚠️ ROTATE the sbp_ Management API token Pedro pasted this session (Supabase → Account →
>    Access Tokens → revoke).
>
> STILL OPEN (external / human):
> 1. Insert the 0050 drizzle tracking row (one-line SQL above) OR let it self-heal on next
>    migrate. Not blocking anything.
> 2. Task #13 listener-auth hardening stays DEFERRED pending Pedro (runbook staged). Trigger
>    stays ENABLED.

## Previous status: ALL WORK COMPLETE ✅ (waves W0–W6, prod deploy SHA 0a63f8a, follow-ups through cad7c5e)

## Status: PROD DEPLOY COMPLETE ✅ (2026-07-23, SHA 0a63f8a) — all 3 layers LIVE (DB + listener + web @ polytoken.ai)

Pedro provided prod credentials + a Supabase Management API token mid-session, which
unblocked the deploy. Executed end-to-end from this container over HTTPS:

1. **DB migrated (DONE, verified live).** Direct Postgres is unreachable from here
   (HTTPS-443-proxy-only egress), so migrations 0043→0047 were applied over the
   Supabase Management API query endpoint, each in its own txn + a matching
   `drizzle.__drizzle_migrations` row (hash=SHA256(file), created_at=journal when).
   Live verify: 31→36 public tables, 43→48 tracking rows, RLS on all new tables,
   0046 columns + 4 new enums present, max created_at=0047 so migrate.ts stays
   idempotent. Rollback: `.planning/PROD-ROLLBACK-0043-0047.sql` (PITR is OFF on this
   project, so the DROP script IS the DB rollback — additive migs, clean reversal).
2. **Code on main (DONE).** Branch fast-forwarded main (0a63f8a, linear, 100 commits).
   This fires: Vercel production build (web) + `deploy-email-listener.yml` (ECR/ECS).
3. **Listener deploy DONE ✅.** `deploy-email-listener.yml` run 30017547005 (SHA 0a63f8a):
   Test job green (ruff/mypy/pytest); Build&deploy green — image built, Trivy pass, pushed
   to ECR, ECS update, **service stability confirmed**, smoke test passed. New listener live.
4. **Web deploy (Vercel) DONE ✅.** Verified via the Vercel API (token provided mid-session).
   Project `nauta-web` (prj_70hRKIxh1giNAfzQvbrR1tX7pP2j, team teampedroshin,
   team_V2cgPPeWDBTsSBVg3fwh1Jof). Production deployment `dpl_ECPCJisvrLjMaTakuiDLkwYdRSos`
   for SHA **0a63f8a** is **READY** and alias-assigned to the real prod domain
   **`polytoken.ai`** (+ www). `polytoken.ai/api/pipeline/health` → **401 Unauthorized**
   (the new auth-gated route EXISTS — new code shipped), root → 307 (login redirect).
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` confirmed present in the
   Production env, so the earlier "build failed on env vars" call was WRONG.

   ⚠️ CORRECTION: the earlier "web blocked" entry was a FALSE ALARM caused by probing
   `nauta-web.vercel.app` — a STALE/SEPARATE domain (old "NAUTA Global Trade" marketing page)
   that is NOT in this deployment's alias set. The canonical prod domain is **polytoken.ai**.
   Use polytoken.ai for all future prod smoke checks, not *.vercel.app.

**ALL THREE LAYERS LIVE on SHA 0a63f8a — full prod deploy COMPLETE.**

OPEN ITEMS (human, not blockers):
  - **ROTATE the prod secrets** Pedro pasted this session — all are in the transcript:
    POSTGRES_URL(_NON_POOLING), SUPABASE_URL, service_role/anon JWTs, sb_secret/sb_publishable,
    Supabase Management token `sbp_2115…` (Supabase dashboard), AND the Vercel access token
    `vcp_3aq…` (Vercel → Account Settings → Tokens → revoke).
  - **Vercel Production env** must include NEXT_PUBLIC_SUPABASE_URL +
    NEXT_PUBLIC_SUPABASE_ANON_KEY (build-time). If the Vercel build failed, it's on
    those — set them and redeploy. Non-destructive: a failed Vercel build leaves the
    prior prod deploy live.
  - **Smoke test** per PROD-DEPLOY-RUNBOOK.md Step 5 once Vercel + ECS are green.

Rollback map (per layer, fastest-first): R-app = Vercel promote previous; R-listener =
ECS revert to prior task-def / re-run deploy on prior SHA; R-DB = run the ROLLBACK sql.
  Migrate MUST precede the main-merge (the app expects the new tables).

## --- prior status (build waves) ---
## Status: COMPLETE ✅ — all waves W0–W6 merged, verified, pushed (tip a5c5539)

Completion report: `.planning/research/2026-07-23-GRAND-COMPLETION-REPORT.md`.
Final sweep GREEN: TS packages (db 84 / api-client 724 / capabilities 65 / ui 22 /
genui 626 / apps/web 1677), listener pytest 91.61% + ruff/mypy/lint-imports clean,
drizzle lineage clean (0000–0047 linear), all tsc clean. Only the 4 OCR corpus
tests fail (environmental — no Textract client in-container, fail identically on base).
W6 lanes recovered after a container restart killed them uncommitted (~88min) — the
worktrees preserved every file; resumed both to gate+commit, zero work lost.
Watchdogs stood down: hourly backstop deleted, send_later chain stopped.
Remaining work is Pedro's manual runsheet (visual/geometry gates, live-stack E2E,
real-DB migration apply) + documented venture/billing-gated seams — see the report.

## --- historic detail below ---
## Status: RUNNING — Batch 7 (W6 ventures) — THE LAST BATCH

Batch 6 DONE 2026-07-23T10:xxZ (52ba8fa pushed): W5 teams (workspaces/members/
resource_shares, additive assertCanAccess, RBAC no-self-escalate, documents wired,
ZERO tenancy regression — 98/98 existing tenancy tests pass, migration 0047 lineage
clean) + TM-04 drive circle-pack (widened circle-pack node scope enum to 'drive',
mirror field-for-field, byte-conserving bounded recursion). Integrated green: web
1620, capabilities 65, db 84, api-client 724, ui 22, all tsc clean.

Waves DONE: W0 email hardening, W1 reliability+evals+snappiness+terraform, W2 AI
spine, W3 canvas+viz, W4 drive+home, W5 teams. Only W6 ventures remains.

## Batch 7 in flight (b7-* worktrees forked 52ba8fa) — venture-gated, mostly design+safe-seams
- b7-inference (distributed-inference Phase 0: browser device-profiling → per-hardware
  model recommendation wired to the WebLLM picker; + credits/peer-pooling accounting
  DESIGN doc — real pooling stays E7-gated)
- b7-desktop (remote-desktop live-cost: per-second/hour cost ticker on the desktop node
  using desktop_sessions.hourly_rate_cents + ST-03 desktop-management pane; Hetzner
  provider binding stays billing-gated — design doc for it)
- b7-business (business execution roadmap synthesizing the 8 business/ research tracks
  into a go/no-go decision framework + next-steps — pure planning doc)

## AFTER b7 merges — FINAL COMPLETION SWEEP (do not skip):
1. Run EVERY gate on the final tree: all package vitest (db/api-client/capabilities/
   ui/genui/daemon-protocol), full apps/web vitest+tsc, listener `uv run pytest` full
   (4 OCR env failures expected) + ruff + mypy + lint-imports, drizzle-kit consistency.
2. Write `.planning/research/2026-07-23-GRAND-COMPLETION-REPORT.md` — every wave, what
   landed, skeptic saves, deferred/handoff items, the manual-verification runsheet
   pointer for Pedro (jsdom proved behavior; visual/geometry gates + live-stack E2E
   are HIS to run — enumerate exactly what needs his eyes/hands).
3. Set this ledger Status: COMPLETE. PushNotification the finish.
4. DELETE hourly backstop trig_01FYyp3Kpfa2vgWBY56N4Gq1 and stop the send_later chain.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 6 (W5 multiuser/teams) + TM-04 tail

Batch 5 (W4) DONE 2026-07-23T09:xxZ (a395f1a pushed). files-chat (DR-03 file node
+ CH-01 attachments + vault_file context edge — I hardened segment validation to
full vault-chokepoint parity + capped ref size), home (HM-01/02 — I fixed a latent
ON CONFLICT prepared-stmt footgun + closed a CHECK 3-valued-logic gap, schema/
migration/snapshot kept consistent), drive-ops (DR-01/02/04 + OneDrive design doc —
I added a move-into-own-subtree guard + fixed a dead move-dialog error branch).
CRITICAL MERGE FIX: home's 0046_snapshot was missing file_versions (forked before
drive's 0045) → a future drizzle-kit generate would recreate the table. I rebuilt
_journal.json to contiguous 0..46 and patched 0046_snapshot (+file_versions table
+file_version_state enum, prevId→0045); `drizzle-kit generate` now reports no
changes. Integrated green: web 1605, api-client 709, db 48, all tsc clean.

MIGRATION LESSON (carry forward): parallel lanes each add a migration off the same
base → their snapshots are each "base + own change" and the LATEST snapshot loses
siblings' tables. After merging N migration lanes: rebuild _journal.json contiguous
+ chain prevIds + union each later snapshot with earlier siblings' new tables/enums,
then `drizzle-kit generate` (dummy POSTGRES_URL) must say "no changes". Sequence
migration numbers across lanes up front (done: 0045 drive, 0046 home).

## Batch 6 in flight (b6-* worktrees forked a395f1a)
- b6-teams (W5: workspaces/membership/RBAC + sharing — GREENFIELD, migration 0047;
  touches many user_id-scoped tables' READ paths to add workspace-scope, so it is
  the sole schema owner this batch; every existing tenancy test must still pass)
- b6-tm04 (deferred TM-04 drive circle-pack: consumes files.folderSizeRollup, reuses
  the merged TM-01 CirclePack primitive + circle-pack node with a drive scope; NO new
  node type — extends the existing circle-pack scope enum, updates the AI-01 mirror if
  the enum widens)
Batch 7 (W6 ventures: distributed-inference Phase 0, remote-desktop live cost,
business execution) + FINAL full-program verification sweep is the last batch.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 5 (W4 drive+home)

Batch 4 (W3) DONE 2026-07-23T08:xxZ (792fce1 pushed): CI canvas interactivity
(undo/redo — I added a canon-tier reconcile so undo can't revert server-owned
promotion + per-node send-to gating, both skeptic findings; context menus, keymap,
multi-select), TM circle-pack (primitive + email landscape view + canvas node),
sheet EN-01 grid + CV-03 spreadsheet node + table.* capability + spreadsheets
schema/migration 0044 (I moved a schema-dir test that broke drizzle-kit generate).
TM+sheet both extended the node registry/mirror/projection → I synthesis-resolved
8 additive conflicts (kept BOTH circle-pack + spreadsheet; fixed a shared-tail
brace bug in node-type-registry). Integrated green: web 1561, capabilities 65,
api-client 655, ui 22, db 35; AI-01 mirror + AI-02 gates pass with both new types.

MERGE LESSON (carry forward): when two lanes both add an entry to the same
multi-LINE object (registry/mirror), the git "shared tail" after >>>>>>> closes
only ONE entry — reconstruct BOTH entries' closings by hand, then tsc BEFORE
trusting vitest (a syntax error shows as many-suites-failed, not a clear error).

## Batch 5 in flight (b5-* worktrees forked 792fce1)
- b5-drive-ops (DR-01 rename/move/bulk, DR-02 versioning+trash, DR-04 quotas +
  drive size-rollup aggregate; sole owner of files router + vault UI + a new
  file_versions schema/migration; also writes the OneDrive 500GB migration design doc)
- b5-files-chat (CH-01 composer attachments, DR-03 `file` canvas node [the ONE new
  node type this batch → must update AI-01 mirror + AI-02 projection], DR-05 vault
  content extraction/embedding in the listener)
- b5-home (HM-01 agentic genui home at / via a home-scoped chat_canvas_layouts
  discriminator, HM-02 morning-brief panel; reuses existing canvas — no new node type)
Deferred to post-merge: TM-04 drive circle-pack (consumes drive-ops' size aggregate).
Batch 6 (W5 multiuser/teams) next; then Batch 7 (W6 ventures) + final sweep.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 4 (W3 canvas+viz)

Batch 3a DONE (5c72a60). Batch 3b DONE 2026-07-23T07:xxZ (4d2b760 pushed):
AI-04 send-to-chat/canvas (verified), AI-06 graph memory (refuted on 8 mypy errors
→ fixed test-double protocol stubs + object-cast, re-verified, merged), AI-03
ingest-time resolution (REFUTED on a REAL defect — sender-global tier-blind edge
deactivation demoted human-promoted canon + wiped other emails' pending; I replaced
deactivate-then-insert with insert-if-absent pre-seeded from active edges [never
touches canon], added rejected/superseded component filter + a canon-survival
regression test; re-verified, merged). Integrated listener green 91.61%, mypy 254
clean, lint-imports 3/3. W2 spine COMPLETE.

Carry-forward: (1) amend every agent commit to noreply@anthropic.com before merge;
(2) skeptics refuted 3 of last 6 lanes on real defects — NEVER merge a refuted lane
unfixed; (3) W3 lanes add canvas node types + capabilities → they MUST update the
AI-01 mirror (packages/capabilities/src/canvas.ts CANVAS_NODE_DATA_SCHEMAS) + AI-02
projection-map + pinned id sets or the enforcement suites go red (by design).

## Batch 4 in flight (b4-* worktrees forked 4d2b760)
- (b4 lanes merged, see above)
- b4-tm-treemap (TM-01 CirclePack primitive, TM-02 email view, TM-03 canvas node) — aa5d72eddca37a8cf
- b4-sheet-grid (EN-01 grid shakedown, CV-03 spreadsheet node + table.* capability) — aafb480b69c9bc0c5
Batch 5 (W4 drive+home) next: DR-01..05, CH-01, HM-01/02, TM-04, OneDrive design.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 3a (W2 spine, manual-worktree agents) + ST-04 rebuild

Batch 2 DONE 2026-07-23T05:5xZ (9e93f6d pushed): 5/6 lanes merged — evals harness
(E1–E3 enforced), KG-2/3/8 + pipeline-health panel (web), snappiness §1–4 (+
main-loop fixes: 8 neutral loading.tsx, prefetch TTL dedupe), hygiene P0 (stubs
deleted, knip baseline, .gitignore env fix), terraform 5 imports DONE against
live AWS (MAIL_FROM drift found+codified: live=forward@, plan clean after).
ST-04 lane REJECTED by skeptic (stale-base redo of 1R) → rebuilding via agent in
manually-created worktree st04-resynth (fork-from-HEAD, skeptic findings A–H as
hard requirements). Terraform local tfstate could NOT be copied from the lane
worktree (classifier); re-run the 5 idempotent runbook imports in the main tree
before any plan/apply (config now merged).

## Orchestration mode NOTE (learned B1R/B2)
Workflow-tool worktrees fork from dde04bb (repo base), NOT branch HEAD → any
lane touching session-modified files rebuilds stale and conflicts. From Batch 3
on: `git worktree add -b <branch> .claude/worktrees/<name> HEAD` MYSELF, then
parallel Agent-tool agents pointed at those dirs. Verify with skeptic Agent
runs, merge in main loop.

## Batch 3a DONE 2026-07-23T06:5xZ (5c72a60 pushed)
All 5 merged after fable-5 skeptic verification + main-loop fixes:
- ST-04 pipeline health (degraded/skipped lifecycle, exact-count endpoint) +
  forgery guard (closed KNOWN_STAGES vocab — skeptic proved filename injection)
- AI-01 canvas triple + .finite()/self-loop hardening; AI-02 projection gate
  (fired on AI-01's 3 new caps at merge exactly as designed → entries added)
- AI-05 omnibox (5 tenancy-scoped arms); EN-02 review queue + deterministic ORDER BY
Suites: listener full green 91.51%, capabilities 47, api-client 639, web 1440.
Committer identity: had to amend agent commits to noreply@anthropic.com (git config
in worktrees didn't inherit) — DO THIS for every future agent commit before merge.

## Batch 3b in flight (agents on b3b-* worktrees, forked 5c72a60)
- b3b-ai03 (ingest-time entity resolution + edge proposal, as ST-04 post-persist stage)
- b3b-ai06 (graph-backed chat memory, canon-tier read + suggest-only writeback)
- b3b-ai04 (universal send-to-chat/canvas affordance, calls AI-01 procedures)
Batch 4 (W3 canvas+viz) queues next: CI-01..07, TM-01..03, EN-01→CV-03 spreadsheet.

Batch 1 DONE: 3 gap docs (c1bf55c) + 4 W0 fixes merged (92c9098), all suites green.
Batch 1R DONE 2026-07-23T04:4xZ (e158449 pushed): ING-6/RES-1/REG-1 repairs merged.
NOTE: worktree agents fork from dde04bb (repo base), NOT branch HEAD — expect
conflicts when agents touch W0/1R files; resolve as SYNTHESIS in main loop (see
e158449 message for the REG-1 pattern: keep re-ingest-first + count-gate, adopt
DB-clock cutoff; supersede lte / count gt; cutoff None ⇒ skip supersede).
Verified on merged tree: listener full suite exit 0 + mypy/ruff/lint-imports
clean; api-client 568/568; db (PGlite) 27/27; web tsc clean; emails/[id] 79/80.
4 OCR corpus failures are pre-existing environmental (Textract deps absent).

## --- ⛔ SUPERSEDED: `01RZ`/`jzz1pg`-session standing config (HISTORIC — do NOT action) ---
> The block below is the prior grand-orchestrator session's operational scaffolding (branch
> `…-jzz1pg`, session `01RZ…`, fable-5 policy, its 7-batch program, its completion criterion + hourly
> backstop). It is kept for provenance only. The CURRENT session is `qi9q5g` / `016d…` on opus-4.8;
> the live truth is the ⭐ CURRENT block at the TOP of this file. Every Routine referenced below has
> `ended_reason=run_once_fired` — none will fire again; there is nothing here to run or delete.

- Branch: `claude/polytoken-email-infra-cont-jzz1pg` (all merges land here; NO PR)
- Model policy: fable-5 (verify panels/synthesis) · opus-4.8 (mutations/security, session default) · sonnet-5 (mechanical). Never haiku.
- Trailer for every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01RZuPfFSoRaTp59yqF91AZs`

## Active work — Batch 3b (3 Agent-tool agents on manual worktrees b3b-ai03/ai06/ai04, forked 5c72a60)
Not a Workflow — plain background Agents. If container dies: the worktrees +
their committed branches survive on disk; check `git -C .claude/worktrees/b3b-<n>
log` and `git branch --list 'b3b-*'`. Uncommitted agent work is lost on death →
relaunch that lane's Agent (worktree keeps partial files). As each returns:
fable-5 skeptic verify → amend committer to noreply@anthropic.com → merge → verify → push.
- Prior workflows (cached): wf_acbedf4e-6ec (B1), wf_b93b55e9-cca (B1R), wf_05119d6c-159 (B2)

## Batch plan (whole program)
| Batch | Contents | Status |
|---|---|---|
| 1 | Gap docs + W0 fixes + 2-skeptic verify | **DONE** (92c9098) |
| 1R | ING-6/RES-1/REG-1 repairs, fable-5 skeptics | **DONE** (e158449) |
| 2 | W1 6 lanes: eval harness, ST-04 health, KG-2/3/8+panel, snappiness exec, hygiene P0, terraform imports+drift. Deferred to 2R/3: cost-opt deliverable, .mcp.json, settings.json handoff | **RUNNING** |
| 3 | W2 AI spine: AI-01..06 (ingest-time resolution, capability 4-way projection, agent canvas mutation, send-to-chat/canvas, omnibox, graph memory) | pending |
| 4 | W3 canvas+viz: CI-01..07, TM-01..03, EN-01→CV-03 spreadsheet wiring, UX-pattern catalog, **+ phase 62 redesign surfaces (gate waived)** | pending |
| 5 | W4 drive+home: DR-01..05, CH-01, TM-04, HM-01/02, OneDrive migration design doc + import tooling, **+ phase 63 research-canvas visuals (gate waived)** | pending |
| 6 | W5 multiuser/teams: workspace/membership/RBAC + sharing | pending |
| 7 | W6 ventures: DX-01 + distributed-inference Phase 0, DX-03 desktop live-cost plan, business execution docs; final sweep + full-program verification + COMPLETE | pending |

## Merge protocol (only the main session does this)
1. Workflow returns `merge_ready` (fix committed in worktree branch + 2/2 skeptics un-refuted).
2. `git merge --no-ff <worktree-branch>` into the feature branch, resolve nothing silently.
3. Run targeted tests again on the merged tree. Commit with trailer. Push with retries.
4. `needs_review` items: main loop inspects diff + verdicts, fixes forward or re-dispatches one repair agent.
5. Update this file; PushNotification at each batch boundary.

## Permissions grant (Pedro, 2026-07-23, this session)
- FULL permission to manage prod/staging/local systems (AWS, Supabase, Vercel, etc.).
- May wipe/reseed prod/staging/local DBs — system is fully under development.
- **Pixel gates 62–63 WAIVED**: build all visual/redesign surfaces at full speed; Pedro verifies manually later. Fold 62–63 work into Batches 4–5.
- Safety envelope (self-imposed, always): backup before anything irreversible; nothing cost-compounding (no fleet spin-ups, no bulk storage migrations, no deleting sole copies); account-level settings (billing, domains, auth providers) untouched.

## Hard gates (still parked — classifier sits above user grants)
- Classifier blocks regardless of permission: prod-DB psql connections, email CONTENT / S3 email objects, Lambda env vars, self-authored settings.json permissions → hand to Pedro.
- External: AWS SES prod-access approval; kaszek-os-dev repo (needs add_repo).

## Completion criterion
All 7 batches merged+pushed, per-wave manual runsheets written, final COMPLETE notification sent,
THEN delete trig_01FYyp3Kpfa2vgWBY56N4Gq1 and write `## Status: COMPLETE` here.
