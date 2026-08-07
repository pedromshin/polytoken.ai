# vLAUNCH (Phases 78–81) Maximum-Parallelism Execution Plan

> **DRIVER PREFLIGHT RESOLUTION — 2026-08-07 (this copy is the canonical one; the scratchpad
> original is GC-able):**
> **(a) RESOLVED — writer collision cleared.** Every dirty path in the preflight list was committed
> and pushed by the writer session (`985e2071..42034d38`; tree clean at `42034d38`). The
> "deferred-on-writer" queue is UNBLOCKED — worker-test 0061 SQL sync + `index.ts` header fix are
> scheduled as new lane **0i** in Wave 0.
> **(b) RESOLVED — billing is LIVE (6/6).** The map:plan snapshot predates night 2:
> `STRIPE_SECRET_KEY` + `BILLING_ENABLED=true` were set in Vercel and deployed 2026-08-06 night 2
> (ORCHESTRATOR-STATE ⭐, driver-witnessed; webhook 400s unsigned = correct). BILL-02/03 are DONE;
> BILL-01 shrinks to "mint durable restricted key + rotate the old `rk_live_`" (Batch A item 5);
> Wave-1d BILL-04 is click-ready.
> **(c) UNCHANGED — vLAUNCH bless** (`/gsd:new-milestone`) is still the first human gate (Batch A
> item 1); Wave 0 is pre-bless by design.
> **Wave-0 amendments:** lane **0g is ALREADY DONE** (durable `scripts/staging-repair.mjs`,
> commit `fba6de54`, dry-run verified ×2). Lane 0c must NOT redraft the SES reply — a ready draft
> lives in `.planning/PEDRO-DECISION-SHEET-2026-08-07.md` §C1.

**Driver preflight (do first, before any lane launches):** (a) `git status` — an earlier session left `apps/worker/src/*`, `apps/email-listener` chat/genui files, `apps/web/src/app/chat/**`, `packages/db/migrations/meta/_journal.json`, `.planning/HANDOFF.json`, and `.github/workflows/ci-web-and-packages.yml` dirty with `0061_enqueue_allowlist_cascade_recipe.sql` untracked; nothing may edit those paths until that work is committed. (b) Re-read `.planning/ORCHESTRATOR-STATE.md` ⭐ CURRENT — the surface maps disagree on billing status (one says BILL-03 is 4/6 with `STRIPE_SECRET_KEY`/`BILLING_ENABLED` missing; another says billing went fully LIVE tonight with all 6 Vercel vars). Resolve from the ledger before scheduling BILL-01/03 work. (c) vLAUNCH is still a PROPOSAL — `/gsd:new-milestone` bless is the first human gate; ROADMAP.md has no phases 78–81 yet, so no `/gsd:execute-phase` can target them before bless.

---

## 1. FILE-COLLISION MATRIX

### Colliding pairs

**Phase 78 × Phase 81 — REAL overlap (operational + files):**
- `apps/worker/src/tasks.ts`, `apps/worker/src/index.ts` (cascade_relabel handler lives beside ingest handler) — any 78 hygiene fix (stale header comment, `worker-integration.test.ts` ENQUEUE_WRAPPER_SQL sync to 0061) and any 81 worker touch share files.
- `packages/db/migrations/0061_*.sql` + `meta/_journal.json` — 78 applies it (CUT-04), 81 depends on it (WEDG-01).
- `apps/email-listener/app/settings.py` — `INGEST_ENQUEUE_ENABLED` (78) and `CASCADE_CORRECTION_ENABLED` (81) both defined there. Flips happen in ECS task env, not code — keep it that way; no code edits to settings.py from either lane.
- `.github/workflows/deploy-email-listener.yml` — path-triggers on `apps/email-listener/**` AND `apps/worker/**`; any merge from either phase redeploys the live mail receiver.
- WEDG-03's *new* code (`packages/api-client/src/router/learning/`, `packages/api-client/src/root.ts`, `apps/web/src/lib/pipeline-health.ts` + pipeline-health node/panel) is **disjoint from all of 78** — safe to build in parallel.

**Phase 78 × Phase 79 — code-disjoint, two seams:**
- `packages/db/migrations/meta/_journal.json`: 79 must add **zero** migrations (0056/0057 already on prod). If any billing migration is ever proposed, it serializes behind 0061.
- `apps/email-listener/app/settings.py`: `INGEST_TIER_CAPS_ENABLED` (BILL-06) vs `INGEST_ENQUEUE_ENABLED` (CUT-06/08) — env flips only, no shared code edits. Otherwise fully disjoint systems (Stripe/Vercel/`packages/billing` vs AWS/ECS/`apps/worker`).

**Phase 79 × Phase 80:**
- `apps/web/e2e/screenshot-review.spec.ts` — BURN-01 owns it; if the billing lane wants /billing meter coverage, it files a request to the BURN-01 lane rather than editing the spec itself.
- Otherwise disjoint.

**Phase 80 × Phase 81:**
- No file overlap (BURN e2e spec vs WEDG-03 router/surface). **Document-level collision: CPF-live appears in both the audit EXECUTE menu and as Phase 81's opener — it is scheduled ONCE, in Phase 81 (WEDG-02). Strike it from any Phase-80 worklist.**

**Everything × active writer session (highest-priority collision):** `apps/worker/src/{index,tasks}.ts` + both worker test files, `apps/email-listener/app/{application/use_cases,infrastructure/llm,presentation/api/v1,composition}` genui/chat-tool files, `apps/web/src/app/chat/{_canvas,_components,_hooks}/**`, `_journal.json`, `.planning/HANDOFF.json`, `ci-web-and-packages.yml`. Any lane touching these waits for that session's commit. This specifically **defers**: the 78 worker-test hygiene fixes, and any chat-side upgrade-prompt/chat-turn-cap UI (79 stretch work).

**Everything × `.planning/` ledgers:** `ORCHESTRATOR-STATE.md`, `PEDRO-CHECKLIST.md`, `STATE.md`, `HANDOFF.json`, `vNEXT-AUDIT-2026-08-06.md` Decision Ledger — every phase wants to write these. Single-writer, driver-only (see §4).

### Fully disjoint pairs (safe unconditional parallelism)
- **79 × 81** (Stripe/Vercel/billing vs learning-router/pipeline-health) — provided 79 stays out of `apps/web/src/app/chat/**` and any entitlement change edits `packages/billing/src/entitlements.ts` + `apps/email-listener/app/domain/services/tier_entitlements.py` **together** in one commit.
- **79 × 78** at the file level (see seams above).
- **BURN-01 spec work × WEDG-03 code** — different trees entirely.

---

## 2. MAX-PARALLEL WAVE PLAN

Legend: **[P]**=plan-work, **[B]**=build-work, **[V]**=verify-work, **[H]**=human-gated. **WT**=own worktree (`EnterWorktree`), **ST**=shared tree OK (docs/scratch only).

### Wave 0 — NOW, before bless, zero credentials (all concurrent; 6–8 subagents)
| Unit | Type | Isolation | Notes |
|---|---|---|---|
| 0a. Runsheet pack: exact AWS command sheets for CUT-02/05/07 (incl. §P4 zero-churn plan-gate checklist), CUT-06/08 flip runsheets, CUT-09 dead-letter check design, CUT-10 rollback + `INGEST_BACKGROUND_ENABLED` bridge-flag disposition | [P] | ST (scratchpad, promote to `.planning/phases/78-*` after bless) | Source: `docs/DURABLE-WORKER-RUNBOOK.md` P1–P5 |
| 0b. BILL-04 verification harness: read-only SQL asserting `subscriptions` row (tier=pro, status, `last_event_at` advancing) + `stripe_webhook_events` dedupe, evidence template | [P] | ST | Staged ready for the minute Pedro clicks |
| 0c. LCAN-05 / LCAN-09-live / MORN-07 SQL runsheets + BURN-06 ledger-reconciliation draft + WEDGE-BASELINE.md skeleton + SES case 178464704400134 reply draft | [P] | ST | |
| 0d. **WEDG-03 learning.summary router**: `packages/api-client/src/router/learning/` + registration in `root.ts` + surface on pipeline-health node/panel (`apps/web/src/lib/pipeline-health.ts`, `pipeline-health-node.tsx`, `pipeline-health-panel.tsx`) + tests. **NOT a new /usage page** — none exists; that's a scope trap. | [B] | **WT** | Reads zero until WEDG-01; that's fine. Zero collision with 78 or dirty files. |
| 0e. Screenshot-spec extension: cascade/merge-repaint scenario in `apps/web/e2e` (audit seam 7 names it missing) | [B] | **WT** | Do NOT run it in parallel with any other playwright — build only. |
| 0f. Chat-turn cap enforcement (missing `monthlyChatTurns` gate) — **API-side only**: mirror `billingRouter.usage` counting semantics exactly (is_active=true user-role messages since UTC month start) in `packages/api-client`. **No `apps/web/src/app/chat/**` edits** (writer collision) — chat-side banner deferred. | [B] | **WT** | Fail-open vs fail-closed decision documented for Pedro; must not lock paying users out. |
| 0g. Rebuild/secure the staging repair script from `.planning/debug/staging-drift-2026-08-06.md` into a durable location (it currently lives in another session's GC-able scratchpad) | [B] | ST | Prerequisite for CUT-02 |
| 0h. Ingest-degraded visibility UI (emails finalized `degraded`/`ingest_cost_capped`) — buildable dark | [B] | **WT** | Skip if it would touch chat files |

**Deferred-on-writer (queue behind the other session's commit):** worker-integration.test.ts 0061 SQL sync; `apps/worker/src/index.ts` stale header comment; any chat upsell banner.

### Wave 1 — after PEDRO BATCH A (see §3): the two environment legs + billing test, fully parallel
| Unit | Type | Isolation | Notes |
|---|---|---|---|
| 1a. **Prod DB leg**: verify PROD_* secrets present → Pedro runs `install-schema.js` (prod) → dispatch `deploy-migrate-prod.yml` confirm=MIGRATE-PROD → agent verifies 0061 applied (`public.enqueue_job` full allowlist). Remember: 0053/0054 will never auto-apply on prod (journal high-water); 0061 alone is sufficient. | [V]+[H] | ST | Order is hard: schema → dispatch. |
| 1b. **Staging leg** (independent env, concurrent with 1a): `staging-repair.mjs --yes` + `npm run db:migrate:staging` (Pedro paste) → agent verifies 0037–0061 + graphile schema | [V]+[H] | ST | |
| 1c. **Worker image**: `WORKER_DEPLOY_ENABLED=true` set in Batch A → CI builds/pushes to `nauta-services-email-worker` ECR → agent verifies tag exists (CUT-03 pipeline already green) | [V] | ST | Image-before-enable gate for 1d/Wave 2 |
| 1d. **BILL-04**: Pedro clicks checkout→portal→cancel; agent runs the Wave-0b harness against prod DB + webhook log | [V]+[H] | ST | Allowed pre-BILL-05 (own-account test explicitly ungated) |
| 1e. **BURN-01/02/03 fill-in**: `npm run screenshot:review` capture (server on :3000, SERIAL playwright), BTAP-07 flag+gesture, MCPX-09 on Pedro's machine | [V]+[H] | ST | Needs only CUT-01; concurrent with everything above |
| 1f. Merge Wave-0 worktree branches (0d/0e/0f) after adversarial review (see §4) | [B]→[V] | — | |

### Wave 2 — staging cutover rehearsal (SERIAL within, concurrent with lingering Wave-1 billing/burn work)
CUT-05: Secrets Manager session-mode URL secret → `worker_db_url_secret_arn_staging` in tfvars → `terraform plan` **zero-churn gate** (only task-def revision + service update + read-secrets policy; ANY SES/SNS/S3/ALB churn = STOP) → apply **[H]** → watch memory (256/512 shared task, OOM risk) → CUT-06: flip `INGEST_ENQUEUE_ENABLED` staging, run enqueue→drain→terminal-parse_status verification **[V]+[H]**. Terraform is single-threaded through Pedro — no other lane may touch `infrastructure/aws/**` during this wave.

### Wave 3 — after PEDRO BATCH B: prod cutover + finishers
- 3a. CUT-07 prod tfvars + plan-gate + apply → CUT-08 prod flip + one real forwarded email smoke **[H]** — strictly after Wave 2 green.
- 3b. CUT-09 dead-letter/redrive check ∥ CUT-10 rollback rehearsal (parallel pair) **[V]+[H]**.
- 3c. BURN-04 (`MORNING_BOARD_ENABLED` flip, overnight cron, PNG judgment) ∥ BURN-05 (`RECIPE_RECOMPUTE_ENABLED` flip, LCAN-05/09 SQL checks) — both need 78 complete **[V]+[H]**.
- 3d. BILL-06 `INGEST_TIER_CAPS_ENABLED` flip (listener ECS env) after confirming live loop; BILL-07 first-dollar charge — both post-BILL-05 GO **[H]**.

### Wave 4 — Phase 81 (deliberately LAST, strictly serial) + close
WEDG-01 `CASCADE_CORRECTION_ENABLED` flip + verify worker drains `cascade_relabel` **[H]** → WEDG-02 confirm-merge on real mail; agent verifies `correction_propagations` rows, `mechanism='merge_cascade'`, idempotent re-run **[V]+[H]** → WEDG-03 read now-non-zero metric (code already merged from Wave 0) **[V]** → WEDG-04 fill WEDGE-BASELINE.md **[P]**. Then BURN-06: reconcile all ledgers, all 7 Decision Ledger rows checked **[H]** → `/gsd:audit-milestone` → `/gsd:complete-milestone`. **Do not parallelize P81 forward — the baseline must observe the fully-live stack; an early read bakes a meaningless zero into WEDGE-BASELINE.md.**

---

## 3. HUMAN-GATE SCHEDULE (two interruptions)

### 🅰 BATCH A — "unblock everything" sitting (~45–60 min, positioned before Wave 1)
1. **Bless vLAUNCH**: `/gsd:new-milestone` on PROPOSAL-vLAUNCH.md.
2. **CUT-01 remainder**: paste 3 GitHub production-env secrets (`PROD_POSTGRES_URL_NON_POOLING` with `?uselibpqcompat=true&sslmode=require`, `PROD_POSTGRES_URL`, `PROD_SUPABASE_URL`) + local `.env.production`/`.env.staging`.
3. **DB-socket runs** (sandbox is HTTPS-only): `node apps/worker/dist/install-schema.js` on prod AND staging; `node staging-repair.mjs --yes && npm run db:migrate:staging`; dispatch `deploy-migrate-prod.yml` confirm=MIGRATE-PROD.
4. **AWS**: set repo var `WORKER_DEPLOY_ENABLED=true`; create Secrets Manager session-mode DB-URL secrets (staging+prod); CUT-02 staging ECS scale-up; review+apply the pre-built CUT-05 staging plan (agent has the zero-churn checklist ready); flip staging `INGEST_ENQUEUE_ENABLED` (CUT-06) at sitting end if the worker is green.
5. **Stripe dashboard**: mint DURABLE restricted key (not the ~2026-11-04-expiring CLI key), rotate the earlier `rk_live_`, confirm/set `STRIPE_SECRET_KEY` + `BILLING_ENABLED` in Vercel + redeploy (per ledger state).
6. **Clicks**: BILL-04 checkout→portal→cancel; BURN-02 BTAP-07 gesture; BURN-03 MCPX-09 in his own Claude Code.
7. **Homework assigned (async, no sitting needed)**: read privacy/ToS drafts + decision sheet C2 (MoR / two Contabilizei questions) so Batch B can collect the BILL-05 verdict; optionally send the pre-drafted SES case reply.

### 🅱 BATCH B — "prod flips + close" sitting (positioned after staging rehearsal is proven + burn evidence collected)
1. CUT-07 prod terraform plan review + apply; CUT-08 prod `INGEST_ENQUEUE_ENABLED` flip + forward one real email for the smoke; CUT-09 + CUT-10 rollback rehearsal.
2. **BILL-05 🚦**: written GO — legal review verdict, MoR decision, routable privacy contact replacing the `privacy@polytoken.ai` placeholder in `apps/web/src/app/legal/_components/legal-entity.ts`. Then BILL-06 cap flip authorization + **BILL-07 first-dollar charge**.
3. Flag flips: `MORNING_BOARD_ENABLED`, `RECIPE_RECOMPUTE_ENABLED` (BURN-04/05), `CASCADE_CORRECTION_ENABLED` (WEDG-01) + WEDG-02 confirm-merge click.
4. BURN-01 screenshot verdicts (eyeball every PNG — agent capture is not acceptance).
5. Decision Ledger: EXECUTE/ACCEPT-AS-DEBT/BLOCK per all 7 seams, with owner+trigger — required before `/gsd:complete-milestone`.

(BURN-04's overnight cron may force a trivial third touchpoint next morning — a 5-minute PNG glance; schedule Batch B the evening before so the cron runs between B and close.)

---

## 4. SAFETY RAILS (paste into every lane's brief)

**SERIAL-ONLY, single-writer through the driver session:**
- `.planning/STATE.md`, `.planning/HANDOFF.json`, `.planning/ORCHESTRATOR-STATE.md`, `.planning/PEDRO-CHECKLIST.md`, `.planning/milestones/vNEXT-AUDIT-2026-08-06.md` Decision Ledger. Subagents RETURN text; only the driver writes ledgers. HANDOFF.json is already dirty from the other session — do not touch until it lands.
- `packages/db/migrations/meta/_journal.json` + all migration ordering. **NEVER edit journal timestamps** to make drizzle re-apply 0053/0054 — that reopens the exact skip-window class that froze staging at 0036. Sanctioned prod path: install graphile_worker schema → 0061 CREATE-OR-REPLACEs the full allowlist. Any new migration serializes behind 0061.
- All `terraform plan/apply` (`infrastructure/aws/**`): one lane, through Pedro, with the zero-churn gate — a plan showing ANY change to SES receipt rules, SNS topics, inbound S3, or ALB is a mail-outage class STOP. Never `apply` from a checkout without the shared remote state.
- All playwright against geometry/screenshot configs: `workers:1`, serial, against an already-running :3000; never bare `npx playwright test`, never add a webServer block, never two runs concurrently (single seed user, magic-link invalidation).
- Live Stripe path: `apps/web/src/app/api/stripe/webhook/route.ts`, `packages/api-client/src/router/billing/`, `packages/billing/**` — billing is (or is about to be) LIVE and Vercel auto-deploys main; no parallel-lane edits, no `stripe` CLI or live-key calls from agents (CLI login expired; keys on the §0 rotation list; classifier blocks live-key curls — never route around it).
- Prod DB writes: only via the sanctioned `deploy-migrate-prod.yml` dispatch or Pedro's own socket runs.

**HARD ORDERING (violations have live consequences):**
1. graphile_worker schema install → THEN 0053/0054/0061 (they RAISE otherwise; a premature migrate-prod dispatch goes red and burns the rotated-credential run).
2. Worker image in ECR → THEN `worker_db_url_secret_arn_*` tfvars apply (unpullable image trips the ECS circuit breaker despite essential=false).
3. Schema + 0061 + worker green → THEN `INGEST_ENQUEUE_ENABLED`, staging → THEN prod (early flip = every SNS Notification 500s; sustained failure past SNS retry policy drops live mail).
4. Worker draining + 0061 verified → THEN `RECIPE_RECOMPUTE_ENABLED` / `MORNING_BOARD_ENABLED` / `CASCADE_CORRECTION_ENABLED` (LCAN-09 is the most rot-prone acceptance — failures are invisible).
5. BILL-05 written GO → THEN public pricing / any third-party charge. BILL-04 own-account test is exempt.
6. Session-mode (non-pooling) URL in the worker's secret — a transaction-pooled URL silently breaks LISTEN/NOTIFY.

**ADVERSARIAL-VERIFICATION MERGE GATES (run `/gsd:code-review` or code-reviewer agent + a hostile pass before merge):**
- Any merge touching `apps/email-listener/**` or `apps/worker/**` — `deploy-email-listener.yml` path-triggers mean merge = live mail-receiver redeploy. Gate: full listener pytest + byte-identical flag-OFF posture for cascade files (`cascade_correction.py`, `curate_entity_merge.py`, `relabel_job.py` — prefer not touching them at all this milestone).
- WEDG-03 learning router: verify owner-scoping (tRPC read over `correction_propagations` + `entity_type_corrections` must be tenant-bound) before merge.
- Chat-turn cap: verify counting semantics are byte-for-byte the `billingRouter.usage` semantics, and the failure mode never locks out a paying user; verify `entitlements.ts` ↔ `tier_entitlements.py` were edited together if numbers changed.
- Screenshot-spec extension: dry-run once, serially, before it enters the BURN-01 evidence run.

**PROCESS RAILS:** CPF-live is scheduled exactly once (Phase 81 / WEDG-02) — strike it from Phase-80 lists. Every secret pasted into any session goes on the PEDRO-CHECKLIST §0 rotation list — prefer scoped allow-rules over pastes. Worktree lanes rebase onto main before merge and never merge while the other writer session's files are still dirty in the main tree.

---

# APPENDIX: raw surface maps (4 read-only mapper agents)

## map:plan
```json
{
 "key": "plan",
 "summary": "vLAUNCH (PROPOSAL status, awaiting Pedro's bless via /gsd:new-milestone) is Phases 78-81, 27 requirements (CUT 10 + BILL 7 + BURN 6 + WEDG 4), and is deliberately operations-not-engineering: the codebase is CODE-COMPLETE and dark. Phase 78 (Durable Ingest Cutover, CUT-01..10) executes docs/DURABLE-WORKER-RUNBOOK.md P1-P5: DB-access repair, staging rehearsal, worker image+CI, graphile schema + migrations 0053/0054/0061, worker enable on staging then prod, INGEST_ENQUEUE_ENABLED flip with live smoke, dead-letter/redrive check, and rollback rehearsal. Phase 79 (Billing Go-Live, BILL-01..07) repairs the Stripe credential, creates products/webhook, sets Vercel env, runs a real test checkout, passes the BLOCKING BILL-05 legal/MoR human gate, wires tier caps, and collects one webhook-confirmed live charge; it runs parallel to 78 except for CUT-01. Phase 80 (Live-Acceptance Burn-Down, BURN-01..06) executes the audit's EXECUTE menu \u2014 real-browser screenshot pass, BTAP-07, MCPX-09 (no worker needed), MORN-07 and LCAN-05/09 (worker-dependent) \u2014 then reconciles all ledgers so vNEXT can close via audit \u2192 complete-milestone; the audit's 7-row Decision Ledger is still entirely unfilled and every row must be checked before close. Phase 81 (Wedge Opener, WEDG-01..04) flips CASCADE_CORRECTION_ENABLED, runs CPF live acceptance on real mail, builds the first learning-loop metric (corrections made / re-labels per correction / % that stick) on an existing surface, and records WEDGE-BASELINE.md; it depends on 78 and runs deliberately last. ALREADY DONE per ORCHESTRATOR-STATE \u2b50 CURRENT (2026-08-06 tonight part 2), shrinking the phases: CUT-01 is roughly half done (Supabase passwords reset by Pedro, Vercel env fixed, /api/dbcheck green then deleted at af6c8810 \u2014 still owed: the 3 GitHub production-environment PROD_* secrets and local .env propagation); CUT-03 is essentially done (worker ECS container wired ship-dark in ecs.tf, nauta-services-email-worker ECR repo applied, worker image pipeline VALIDATED GREEN incl. Trivy at 6c4e7cc9/b797ffa6, despite the proposal text still calling the Dockerfile 'missing'); Track 1 Terraform remote state is LIVE with a clean plan, making CUT-05/07 applies safe; and on billing, BILL-02 is DONE (Stripe products/prices + webhook endpoint exist) and BILL-03 is 4/6 done (STRIPE_PRICE_PRO/POWER, STRIPE_WEBHOOK_SECRET, BILLING_APP_URL set in Vercel; only STRIPE_SECRET_KEY + BILLING_ENABLED missing). Billing is therefore NOT yet live \u2014 it stays inert until Pedro mints the durable restricted key (BILL-01) and sets those two vars; staging Terraform drift remains OPEN and classifier-gated, touching CUT-02/CUT-05; the SES production-access case 178464704400134 reply is a standing external item that gates nothing in this milestone but has weeks of lead time.",
 "key_files": [
  ".planning/milestones/PROPOSAL-vLAUNCH.md",
  ".planning/milestones/vNEXT-AUDIT-2026-08-06.md",
  ".planning/ORCHESTRATOR-STATE.md",
  ".planning/PEDRO-CHECKLIST.md",
  "docs/DURABLE-WORKER-RUNBOOK.md",
  "infrastructure/aws/ecs.tf",
  "infrastructure/aws/terraform.tfvars",
  ".github/workflows/deploy-migrate-prod.yml",
  "packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql",
  "packages/db/migrations/meta/_journal.json",
  "apps/worker/src/tasks.ts",
  "apps/worker/src/index.ts",
  "scripts/redrive-inbound.sh",
  "apps/mcp-server/dist/index.js",
  "apps/web/e2e/screenshot-review.spec.ts",
  "apps/email-listener/app/infrastructure/llm/chat_tools.py",
  "apps/email-listener/app/presentation/api/v1/sns_inbound.py"
 ],
 "dependencies": [
  "CUT-01 (the 3 GitHub PROD_* production-environment secrets) is the single cross-phase root: it gates CUT-04's migrate-workflow dispatch AND Phase 79's billing DB verification AND unblocks everything else \u2014 proposal says '79 runs in parallel (only CUT-01 gates it)'",
  "Phase 78 internal order is load-bearing: CUT-01 \u2192 (CUT-02 \u2225 CUT-03) \u2192 CUT-04 \u2192 CUT-05 \u2192 CUT-06 \u2192 CUT-07 \u2192 CUT-08 \u2192 (CUT-09 \u2225 CUT-10)",
  "Runbook ordering guard: graphile_worker schema install (install-schema.js, P2) MUST precede migration 0053 \u2014 0053 RAISEs if the schema is absent",
  "Image-before-enable (CUT-03 before CUT-05/07): an unpullable worker image trips the ECS deployment circuit breaker despite essential=false \u2014 image must be in ECR before the tfvars secret-arn apply",
  "Staging rehearsal before prod: CUT-05/06 (staging worker + cutover proven) must precede CUT-07/08 (prod)",
  "Within Phase 79: BILL-01 \u2192 BILL-02/03 \u2192 BILL-04 \u2192 \ud83d\udea6BILL-05 (blocking legal/MoR gate) \u2192 BILL-06/07; BILL-05 blocks public pricing and the first third-party charge but NOT BILL-04's own-account test",
  "Phase 80: BURN-04 (MORN-07) and BURN-05 (LCAN-05/09, needs 0061 from CUT-04) depend on Phase 78 complete; BURN-01/02/03 need only CUT-01 + browser time; BURN-06 is last and requires all seven Decision Ledger rows filled \u2014 /gsd:complete-milestone may only run when every row is checked",
  "Phase 81 depends on Phase 78 (WEDG-01 needs the worker's cascade_relabel draining + 0061 applied); WEDG-01 \u2192 WEDG-02 \u2192 WEDG-03 (reads non-zero only after 01/02) \u2192 WEDG-04; P81 is sequenced last so the metric observes the fully-live, billed, durable stack",
  "CPF-live was deliberately MOVED from the Phase-80 menu into Phase 81 (it IS the wedge opener) \u2014 do not double-schedule it"
 ],
 "human_gates": [
  "CUT-01 remainder: paste/propagate the 3 GitHub production-env secrets (PROD_POSTGRES_URL_NON_POOLING / PROD_POSTGRES_URL / PROD_SUPABASE_URL) + local .env.production/.env.staging [PEDRO-ALLOW] (Vercel half already done tonight)",
  "CUT-02/05/07: AWS-credential ops \u2014 staging ECS scale-up, terraform plan/apply with the \u00a7P4 zero-churn plan-gate on both staging and prod [PEDRO-ALLOW]",
  "CUT-04 DB-socket steps (install-schema.js, 0053/0054 owner-role runs) \u2014 sandbox is HTTPS-only [PEDRO-ALLOW]",
  "CUT-06/08: INGEST_ENQUEUE_ENABLED flips (staging then prod) + one real forwarded email for the prod smoke [PEDRO-ALLOW/PEDRO]",
  "CUT-09 run + CUT-10 rollback rehearsal [PEDRO-ALLOW]",
  "BILL-01: Stripe dashboard \u2014 re-login, enable Write scopes, mint a DURABLE restricted key (not the 90-day CLI key), rotate the earlier pasted rk_live_ [PEDRO-DASH]",
  "BILL-03 remainder: set STRIPE_SECRET_KEY + BILLING_ENABLED in Vercel + redeploy [PEDRO-ALLOW or PEDRO-DASH]",
  "BILL-04 checkout clicks; BILL-07 the actual first-dollar charge on Pedro's card [PEDRO]",
  "BILL-05 \ud83d\udea6 BLOCKING PHASE-GATE: legal review of privacy/ToS drafts, routable privacy contact replacing the privacy@polytoken.ai placeholder in legal-entity.ts, Merchant-of-Record decision (two Contabilizei accountant questions), explicit written GO \u2014 judgment, not mechanics [PEDRO]",
  "BURN-01 eyeballs on every screenshot; BURN-02 flag flip + the live gesture; BURN-03 MCPX-09 on Pedro's own machine/Claude Code (structurally un-delegatable); BURN-04/05 flag flips [PEDRO/PEDRO-ALLOW]",
  "Audit Decision Ledger: all 7 seam rows need Pedro's explicit EXECUTE/ACCEPT/BLOCK choice with owner+trigger before vNEXT close",
  "WEDG-01 CASCADE_CORRECTION_ENABLED flip [PEDRO-ALLOW]; WEDG-02 the confirm-merge click on real mail [PEDRO]",
  "Standing: reply to AWS SES production-access case 178464704400134 (weeks of lead time, gates nothing here); staging drift repair is classifier-gated diff-by-diff"
 ],
 "parallel_opportunities": [
  "Phase 79 (BILL-01..04) runs fully parallel to Phase 78 once CUT-01's secrets exist \u2014 different systems (Stripe/Vercel vs AWS/ECS)",
  "CUT-02 \u2225 CUT-03 inside Phase 78 (and CUT-03 is essentially already banked, freeing that slot)",
  "BURN-01/02/03 (browser pass, BTAP-07, MCPX-09) are explicitly fill-in work needing no worker \u2014 runnable anytime after CUT-01, concurrent with the 78 cutover",
  "CUT-09 \u2225 CUT-10 at Phase-78 tail",
  "AGENT prep with zero credential involvement, all parallelizable now: exact AWS command sheets for CUT-02/05/07, CUT-09 dead-letter check design, CUT-10 bridge-flag disposition docs, BILL-04 DB/webhook verification SQL + evidence template, CUT-08 runsheet, the SES case reply draft",
  "WEDG-03 metric code (learning.summary read over correction_propagations + surfacing on pipeline-health or /usage) is [AGENT] end-to-end and buildable before WEDG-01 flips \u2014 it just reads zero until then; WEDG-04 baseline doc skeleton likewise",
  "Extending e2e/screenshot-review.spec.ts with the cascade/merge-repaint scenario (audit seam 7 names it as missing) is agent-buildable independent of any flag"
 ],
 "risks": [
  "A live-writing collision: another session is actively modifying this repo right now (git status shows apps/worker/*, apps/email-listener chat/genui files, apps/web chat canvas, packages/db migrations journal all dirty, migration 0061 untracked) \u2014 any parallel lane touching worker tasks, the listener tool loop, chat-canvas, or the migrations journal will collide",
  "Ordering violations with live-infra consequences: 0053 before graphile schema RAISEs; enabling the worker (tfvars arn) before the image is pullable trips the ECS deployment circuit breaker; a terraform apply whose plan shows ANY churn on SES/SNS/S3/ALB must not be applied (mail outage class)",
  "Flipping INGEST_ENQUEUE_ENABLED on prod before the staging rehearsal (CUT-05/06) proves the path changes behavior on the LIVE mail receiver untested \u2014 the exact silent-loss class this milestone exists to kill",
  "Flipping BILLING_ENABLED / publishing pricing before the BILL-05 legal/MoR gate means a real third-party charge without legal sign-off \u2014 the proposal makes BILL-05 a hard blocker for that reason",
  "Worker-dependent flags (RECIPE_RECOMPUTE_ENABLED, MORNING_BOARD_ENABLED, CASCADE_CORRECTION_ENABLED) flipped before 0061 is verified on prod fail against the enqueue allowlist \u2014 and some failures are invisible (the audit calls LCAN-09 'the single most rot-prone acceptance' because nothing user-visible breaks)",
  "Credential hygiene: every secret pasted into a session goes on the \u00a70 rotation list \u2014 prefer scoped allow-rules; the auto-mode classifier blocks live-key curls to non-preapproved hosts and nothing may route around it",
  "Staging drift is open: blind parallel applies against staging without the classifier pass risk live churn",
  "Running WEDG-03's metric before the stack is fully live yields a meaningless zero baseline \u2014 P81-last sequencing is deliberate and should not be parallelized away",
  "Double-executing CPF-live (it appears in the audit menu AND as Phase 81's opener) if two lanes read different documents"
 ]
}
```

## map:worker
```json
{
 "key": "worker",
 "summary": "Track 3a (durable ingestion via graphile-worker) is CODE-COMPLETE and merged on main, ship-dark: the worker (apps/worker: runner, taskList with ingest_inbound_email/cascade_relabel/assemble_morning_board/dispatch_morning_boards/recompute_canvas_recipe/dispatch_recipe_recomputes, one-shot install-schema, Dockerfile), the listener's flag-gated enqueue branch in sns_inbound.py (INGEST_ENQUEUE_ENABLED, failed enqueue -> 500 so SNS retries), the no-swallow re-entry route ingest_job.py, the JobEnqueuer port + Supabase RPC adapter, migrations 0053/0054/0061 (public.enqueue_job SECURITY DEFINER allowlist wrapper), gated Terraform (email-worker container in ecs.tf keyed on worker_db_url_secret_arn_*, ECR repo applied), and a CI deploy workflow that already builds+Trivy-scans the worker image and pushes only when repo var WORKER_DEPLOY_ENABLED=true. Phase 78 therefore has essentially NO blocking code work left \u2014 the cutover is the operational sequence in docs/DURABLE-WORKER-RUNBOOK.md: P2 install graphile_worker schema -> P3 apply enqueue migrations -> P4 push image + set tfvars/apply -> P5 flip INGEST_ENQUEUE_ENABLED. Residual code hygiene: worker-integration.test.ts embeds the stale 0054 allowlist SQL (0061 added three identifiers), index.ts's header comment about sharing the listener image is superseded, and no .planning/phases/78-* artifacts exist yet. Critical DB nuance: on prod, 0053/0054 are bookkept BEHIND 0055 in drizzle's high-water mark and will never auto-apply, but 0061 (journal when=2026-08-06, newest) WILL be applied by deploy-migrate-prod.yml and CREATE OR REPLACEs the function with the FULL allowlist \u2014 sufficient by itself, provided the graphile_worker schema exists first (all three migrations open with a DO-block that RAISEs without it). Staging is frozen at migration 0036 by the journal skip-window drift and has NO graphile_worker schema; an idempotent staging-guarded repair script is staged (another session's scratchpad) awaiting Pedro's --yes run. Tests are solid: worker unit tests (tasks.test.ts, 420 lines covering callPython, all handlers, fan-out idempotent job_keys, recipe recompute fail-closed posture, LWW projection writer), a WORKER_TEST_DATABASE_URL-gated integration test proving enqueue->drain->POST and retry-on-500, and listener pytest coverage (test_sns_inbound_enqueue.py flag ON/OFF matrix, test_ingest_job.py, test_supabase_job_enqueuer.py, test_container_boot.py). Everything live-facing is Pedro-gated: DB creds for install-schema, the 3 stale PROD_* GitHub environment secrets (owed rotation after the Supabase auto-pause outage), AWS creds for Secrets Manager + terraform apply + the repo variable, and the final listener flag flip with live SQL verification against graphile_worker.jobs.",
 "key_files": [
  "apps/worker/src/index.ts",
  "apps/worker/src/tasks.ts",
  "apps/worker/src/install-schema.ts",
  "apps/worker/Dockerfile",
  "apps/worker/src/__tests__/tasks.test.ts",
  "apps/worker/src/__tests__/worker-integration.test.ts",
  "apps/email-listener/app/presentation/api/v1/sns_inbound.py",
  "apps/email-listener/app/presentation/api/v1/ingest_job.py",
  "apps/email-listener/app/presentation/api/v1/__tests__/test_sns_inbound_enqueue.py",
  "apps/email-listener/app/presentation/api/v1/__tests__/test_ingest_job.py",
  "apps/email-listener/app/domain/ports/job_enqueuer.py",
  "apps/email-listener/app/infrastructure/jobs/supabase_job_enqueuer.py",
  "apps/email-listener/app/composition/job_providers.py",
  "apps/email-listener/app/settings.py",
  "packages/db/migrations/0053_graphile_enqueue_wrapper.sql",
  "packages/db/migrations/0054_enqueue_allowlist_morning_board.sql",
  "packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql",
  "packages/db/migrations/meta/_journal.json",
  "infrastructure/aws/ecs.tf",
  "infrastructure/aws/ecr.tf",
  ".github/workflows/deploy-email-listener.yml",
  ".github/workflows/deploy-migrate-prod.yml",
  "docs/DURABLE-WORKER-RUNBOOK.md",
  ".planning/debug/staging-drift-2026-08-06.md",
  ".planning/PEDRO-CHECKLIST.md"
 ],
 "dependencies": [
  "graphile_worker schema install (P2, node apps/worker/dist/install-schema.js over the session-mode/non-pooling URL) MUST precede applying 0053/0054/0061 on ANY environment \u2014 all three migrations open with a DO-block that RAISEs 'graphile_worker schema is absent'",
  "On prod, 0053/0054 will NEVER be applied by drizzle (their journal 'when' values sit below the recorded high-water mark since 0055 was bookkept ahead of them); the functional allowlist arrives via 0061, which deploy-migrate-prod.yml WILL apply because its when (1785974400000) exceeds prod's mark \u2014 so prod order is: install-schema -> dispatch deploy-migrate-prod (applies 0061 = full allowlist)",
  "deploy-migrate-prod.yml requires the 3 PROD_* secrets in the GitHub 'production' environment; those are STALE after the 2026-08-06 Supabase auto-pause password reset \u2014 credential rotation/propagation must precede the prod 0061 dispatch",
  "Staging repair (staging-repair.mjs --yes, applies 24 missing migrations 0037-0061 in journal order and installs graphile_worker schema before 0053) must precede any staging worker deployment or staging durable-path test",
  "Worker image push to nauta-services-email-worker ECR (requires repo variable WORKER_DEPLOY_ENABLED=true, or a manual push) MUST precede setting worker_db_url_secret_arn_* in terraform.tfvars \u2014 essential=false does NOT cover an unpullable image; a missing tag fails every task start and trips the ECS deployment circuit breaker",
  "Secrets Manager secret holding the session-mode (non-pooling) Postgres URL must exist before the tfvars enable \u2014 the gated container's GRAPHILE_WORKER_CONNECTION_STRING secret references it; a transaction-pooled URL breaks LISTEN/NOTIFY",
  "INGEST_ENQUEUE_ENABLED flip (P5) is LAST: only after schema+0061+worker container are green. Flipping early with enqueue_job absent means every SNS Notification 500s; flipping with the wrapper present but no worker means jobs durably accumulate unprocessed (safe but dark)",
  "MORNING_BOARD_ENABLED / RECIPE_RECOMPUTE_ENABLED cron gates depend on the worker being deployed AND (for recipes) 0061 applied \u2014 they are separate later flips, not part of the ingest cutover"
 ],
 "human_gates": [
  "Rotate + populate the 3 PROD_* secrets (PROD_POSTGRES_URL_NON_POOLING with ?uselibpqcompat=true&sslmode=require, PROD_POSTGRES_URL, PROD_SUPABASE_URL) in the GitHub 'production' environment \u2014 owed since the Supabase auto-pause outage",
  "Run install-schema.js against prod (and staging) \u2014 needs DB owner credentials and a host with a direct Postgres socket (agent sandbox is HTTPS-443-only)",
  "Dispatch deploy-migrate-prod.yml with confirm=MIGRATE-PROD to apply 0061 to prod (after install-schema)",
  "Run the staged staging repair one-paste: node staging-repair.mjs --yes && npm run db:migrate:staging (script currently in another session's scratchpad \u2014 copy somewhere durable first)",
  "Create the Secrets Manager secret with the session-mode DB URL per env, set worker_db_url_secret_arn_prod/staging in terraform.tfvars, verify terraform plan shows ONLY task-def revision + service update + read-secrets policy, then apply (AWS creds; live SES pipeline adjacency)",
  "Set the GitHub repo variable WORKER_DEPLOY_ENABLED=true so CI pushes the worker image (image-before-enable ordering)",
  "Flip INGEST_ENQUEUE_ENABLED=true on the listener task def, roll the service, and run the live verification loop (test/redrive email -> graphile_worker.jobs row keyed ingest:<message_id> -> worker drains -> terminal parse_status) plus the rollback rehearsal",
  "Watch task memory on first roll (staging is 256/512 shared by both containers) and bump if the worker is OOM-killed",
  "Reply to AWS SES production-access case 178464704400134 (adjacent, blocks multi-user outbound regardless of this cutover)"
 ],
 "parallel_opportunities": [
  "Staging repair (staging-repair.mjs + db:migrate:staging) and prod credential rotation + 0061 dispatch are fully independent environments \u2014 can run concurrently",
  "Sync worker-integration.test.ts's embedded ENQUEUE_WRAPPER_SQL to the 0061 allowlist (test-only file, no runtime impact) \u2014 independent of all provisioning",
  "Fix the stale index.ts header comment ('shares the listener image via a command override' \u2014 superseded by the dedicated ECR image) \u2014 one-file cosmetic change",
  "Author the .planning/phases/78-* planning artifacts (PLAN/SPEC/verification) \u2014 pure docs, no code collision",
  "Worker image build/push via CI (once WORKER_DEPLOY_ENABLED is set) runs independently of the DB-side steps P2/P3",
  "Post-cutover cleanup items can be PREPARED (not merged) in parallel: retiring the INGEST_BACKGROUND_ENABLED fast-200 bridge and the queued dead POST /v1/emails/inbound legacy route removal",
  "P1 local gates (npm run build/typecheck/test -w @polytoken/worker) are safe/anyone and can rerun anytime"
 ],
 "risks": [
  "Another Claude session is actively writing this repo right now \u2014 apps/worker/src/*, the worker tests, and sns_inbound-adjacent listener files appeared modified in the session-start snapshot; any parallel lane touching apps/worker or the listener presentation layer risks direct file collisions",
  "Flipping INGEST_ENQUEUE_ENABLED before public.enqueue_job exists on prod turns every inbound SNS Notification into a 500; SNS retries with backoff but sustained failure past the retry policy can drop live mail \u2014 the flag flip must be strictly last",
  "terraform apply is live-mail-adjacent (SES receipt rules, SNS topics, inbound bucket, ALB in the same state); concurrent applies from parallel lanes can clash on the state lock or, worse, apply an unreviewed plan \u2014 keep all TF single-threaded through Pedro",
  "Anyone 'fixing' the out-of-order journal timestamps (0037-0039 vs 0036, or 0045/0046) to make drizzle re-apply 0053/0054 on prod would reopen the exact skip-window class that froze staging; the sanctioned path is 0061-supersedes-by-replace, never journal edits",
  "Running deploy-migrate-prod before install-schema makes 0061's guard RAISE and the run go red (transactional, no damage \u2014 but it burns the rotated-credential dispatch and confuses state tracking)",
  "Editing .github/workflows/deploy-email-listener.yml in a parallel lane can redden LIVE listener deploys \u2014 the workflow path-triggers on apps/email-listener/** and apps/worker/** pushes to main, and merging listener code auto-redeploys the live mail receiver",
  "The staging repair script lives in a session-specific scratchpad that may be garbage-collected; if lost, it must be rebuilt from .planning/debug/staging-drift-2026-08-06.md before the staging leg can proceed",
  "Enabling the worker container without watching memory can OOM-kill inside the shared task (256/512 on staging) \u2014 a crash loop is masked from the listener by essential=false but leaves the queue undrained while jobs accumulate"
 ]
}
```

## map:billing
```json
{
 "key": "billing",
 "summary": "Phase 79 (Billing Go-Live, .planning/milestones/PROPOSAL-vLAUNCH.md BILL-01..07) is mostly SHIPPED code + human gates: as of tonight billing is LIVE on polytoken.ai (all 6 Vercel vars incl. STRIPE_SECRET_KEY + BILLING_ENABLED=true; Pro $29/Power $49 products + webhook exist; webhook 400s unsigned = verified). The live stack: /api/stripe/webhook (signature-authed, idempotent via stripe_webhook_events), tRPC billingRouter (currentSubscription, usage meters, createCheckoutSession, verifyCheckout webhook-lag fallback, createPortalSession), /billing UI with live \"X / Y used\" meters, @polytoken/billing package (fully DI'd + unit-tested with fake Stripe), migrations 0056/0057 applied to prod, and listener-side tier plumbing (SupabaseTierResolver \u2192 IngestBudgetGuard) dark behind INGEST_TIER_CAPS_ENABLED=False. What REMAINS: BILL-04 real end-to-end checkout loop (Pedro clicks, agent verifies DB/webhook), BILL-05 BLOCKING legal/MoR gate (decision sheet C2 \u2014 gates public pricing/advertising only, not the own-account test; includes replacing the privacy@polytoken.ai placeholder in legal-entity.ts), BILL-06 flipping INGEST_TIER_CAPS_ENABLED after a confirming live loop, BILL-07 first-dollar evidence, and a durable restricted Stripe key before ~2026-11-04 (current key is the 90-day CLI key; earlier pasted rk_live_ still owes rotation). Two genuine code gaps buildable without live Stripe: the monthlyChatTurns entitlement is metered/displayed but ENFORCED NOWHERE (tier_entitlements.py explicitly punts it as \"a web-side concern\"; the chat cost_circuit_breaker is flat-dollar, tier-blind), and there are zero upgrade prompts anywhere \u2014 no cap-hit banner in chat or on ingest-degraded state, no upsell CTA outside /billing itself. The /billing meters also still owe the real-browser visual pass (\u00a71 debt / BURN-01).",
 "key_files": [
  "apps/web/src/app/api/stripe/webhook/route.ts",
  "apps/web/src/app/billing/page.tsx",
  "apps/web/src/app/billing/_components/billing-surface.tsx",
  "apps/web/src/app/billing/_components/__tests__/billing-surface.test.tsx",
  "apps/web/src/app/billing/success/page.tsx",
  "apps/web/src/app/billing/success/_components/success-confirm.tsx",
  "packages/api-client/src/router/billing/index.ts",
  "packages/api-client/src/router/billing/__tests__/billing-usage.test.ts",
  "packages/billing/src/entitlements.ts",
  "packages/billing/src/checkout.ts",
  "packages/billing/src/webhook.ts",
  "packages/billing/src/verify.ts",
  "packages/billing/src/portal.ts",
  "packages/billing/src/store.drizzle.ts",
  "packages/db/migrations/0056_billing.sql",
  "apps/email-listener/app/domain/services/tier_entitlements.py",
  "apps/email-listener/app/domain/services/ingest_budget_guard.py",
  "apps/email-listener/app/infrastructure/supabase/tier_resolver.py",
  "apps/email-listener/app/settings.py",
  "apps/web/src/app/legal/_components/legal-entity.ts",
  ".planning/milestones/PROPOSAL-vLAUNCH.md",
  ".planning/PEDRO-CHECKLIST.md",
  ".planning/PEDRO-DECISION-SHEET-2026-08-07.md",
  ".planning/ORCHESTRATOR-STATE.md"
 ],
 "dependencies": [
  "BILL-04 (live test checkout loop) must pass before BILL-06 (INGEST_TIER_CAPS_ENABLED flip is explicitly gated on 'after a live loop confirms it') and before BILL-07 (first real charge).",
  "BILL-05 legal/MoR sign-off blocks PUBLIC pricing/advertising, but explicitly does NOT block BILL-04's own-account test \u2014 the phase design allows testing before the gate.",
  "Decision-sheet C2 (Stripe-vs-MoR) should be answered before building any further billing-adjacent code: option (b) Merchant-of-Record would migrate checkout+webhook OFF the now-live Stripe objects, invalidating new work layered on them.",
  "Any entitlement-number or tier change must edit packages/billing/src/entitlements.ts AND apps/email-listener/app/domain/services/tier_entitlements.py together \u2014 a hand-maintained two-language mirror with no shared runtime.",
  "A chat-turn cap enforcement gate should reuse the exact counting semantics already encoded in billingRouter.usage (is_active=true user-role messages since UTC month start, per-conversation owner join) or meters and enforcement will disagree.",
  "INGEST_TIER_CAPS_ENABLED is a LISTENER setting (apps/email-listener/app/settings.py) \u2014 the flip happens in ECS task env, not Vercel."
 ],
 "human_gates": [
  "BILL-04: Pedro personally clicks Subscribe \u2192 Stripe Checkout \u2192 portal \u2192 cancel on the live site with his own card/browser (agent can only verify the resulting DB rows + webhook log).",
  "BILL-05 (BLOCKING PHASE GATE): legal review of the shipped privacy/ToS drafts (LGPD/SCC/ANPD posture); a ROUTABLE privacy mailbox replacing the privacy@polytoken.ai placeholder in legal-entity.ts; the Merchant-of-Record decision (decision sheet C2: recommended (a) stay Stripe + minimal legal pack); explicit written GO recorded before public pricing.",
  "BILL-07: one genuine live-mode charge with receipt \u2014 Pedro's card, the milestone's namesake artifact.",
  "Durable restricted Stripe key: current STRIPE_SECRET_KEY is the ~90-day CLI key expiring ~2026-11-04; minting the durable key + swapping it into Vercel is Pedro-dashboard work. The earlier pasted rk_live_ key still owes rotation (PEDRO-CHECKLIST \u00a70).",
  "INGEST_TIER_CAPS_ENABLED flip on the listener ECS env (PEDRO-ALLOW) after the live smoke loop.",
  "Real-browser eyeball pass of /billing meters (jsdom does no layout \u2014 \u00a71 debt / BURN-01)."
 ],
 "parallel_opportunities": [
  "Chat-turn cap enforcement (the missing monthlyChatTurns gate): a web-side check in the chat send path or a listener seam, TDD-able entirely with the existing DI'd stores and no Stripe \u2014 touches packages/api-client (new logic mirroring billingRouter.usage's count) + tests.",
  "Upgrade-prompt UX: cap-hit banner/CTA linking /billing when dailyIngestUsed or monthlyChatTurnsUsed approaches the entitlement \u2014 pure UI + jsdom tests, no Stripe; but see chat-file collision risk below.",
  "BILL-04 verification harness: read-only SQL/scripts that assert the subscriptions row (tier=pro, status, last_event_at high-water mark advancing) + stripe_webhook_events dedupe rows, staged ready for the minute Pedro clicks through.",
  "Ingest-degraded visibility: surface emails finalized 'degraded' with reason ingest_cost_capped in the UI (the user-facing half of BILL-06) \u2014 buildable dark since the flag is off.",
  "Any @polytoken/billing hardening: the whole package tests against fake Stripe clients (packages/billing/__tests__ covers checkout/portal/verify/webhook) \u2014 zero live-key exposure.",
  "Legal-pack code scaffolding (billing-terms page, wiring a configurable privacy contact) as review-pending drafts awaiting Pedro's BILL-05 judgment."
 ],
 "risks": [
  "Billing is LIVE and Vercel auto-deploys main on push \u2014 any careless edit to /api/stripe/webhook/route.ts, the billing router, or @polytoken/billing breaks a real payment path in production the moment it lands.",
  "File collisions with the active writer session: apps/web/src/app/chat/_components/message-turn.tsx, _hooks/use-chat-stream.ts, and _canvas/chat-canvas.tsx are modified in the working tree right now \u2014 an upgrade-prompt-in-chat build would collide head-on; keep parallel billing work out of apps/web/src/app/chat/**.",
  "Entitlements drift: parallel edits to entitlements.ts without the hand-mirrored tier_entitlements.py update silently desynchronizes what users are shown vs what the listener enforces (free 100 / pro 500 / power 2000).",
  "Drizzle migration journal: packages/db/migrations/meta/_journal.json is already dirty (0061 in flight, not yet on prod) \u2014 adding any billing migration in parallel risks the known journal-registration gotcha (0057 was once unregistered and would have 500'd billing).",
  "Flipping INGEST_TIER_CAPS_ENABLED without the confirming live loop risks silently degrading enrichment for legitimate over-cap mail; conversely building a chat-turn gate FAIL-CLOSED (like the cost breaker) instead of matching the meter's semantics could lock paying users out of chat.",
  "Stripe CLI login is EXPIRED and live keys are on the rotation list \u2014 no parallel worker should attempt stripe CLI or live-API calls; they will fail or deepen the credential-exposure debt."
 ]
}
```

## map:uat-intel
```json
{
 "key": "uat-intel",
 "summary": "Phase 80 (live-acceptance burn-down) is fully specified in .planning/milestones/PROPOSAL-vLAUNCH.md (BURN-01..06) and grounded in .planning/milestones/vNEXT-AUDIT-2026-08-06.md, which lists 7 seams each requiring an explicit EXECUTE/ACCEPT-AS-DEBT/BLOCK-CLOSE choice in its Decision Ledger: LCAN-05 (recipe DB-row round-trip \u2014 automatable check once a live :3000 + seeded auth exists), LCAN-09-live (after-close recompute \u2014 automatable SQL check, but gated on Phase 78 worker + migration 0061 + RECIPE_RECOMPUTE_ENABLED flip), MORN-07 (overnight cron \u2014 run is autonomous, DB/count checks automatable, PNG judgment needs human eyes), BTAP-07 (agent authors a code-island live \u2014 flag flip + Pedro's gesture, DB evidence automatable), MCPX-09 (Pedro's real Claude Code \u2014 structurally un-delegatable), CPF-live (moved to Phase 81), and the real-browser screenshot pass subsuming CPF-06 (capture automatable via screenshot:review, verdict needs human eyes; requires extending apps/web/e2e screenshot spec with a cascade/merge-repaint scenario, which is agent-buildable). CLUS-07 appears only as the named v1.9 carried-debt anti-pattern the audit is designed to prevent, not as a live Phase-80 item. Phase 81 (email-intelligence wedge OPENER) is deliberately thin: WEDG-01 flips CASCADE_CORRECTION_ENABLED (listener) + worker cascade_relabel draining; WEDG-02 is the CPF live-acceptance evidence trail (correction_propagations ledger rows, edge flips to mechanism='merge_cascade', re-label fan-out, idempotent re-run); WEDG-03 is the only NEW code \u2014 an owner-scoped learning.summary tRPC read over correction_propagations + entity_type_corrections surfaced on an existing surface (note: the proposal's \"/usage\" page does not exist in apps/web; the real candidates are the pipeline-health node/panel or /billing's usage meters); WEDG-04 is a WEDGE-BASELINE.md doc. Morning board is Phase 80 (BURN-04), not 81, and entity-resolution deepening is explicitly parked for Track 6 next milestone. File overlap between Phase 81 and the Phase 78 worker cutover is near-zero for the new code (WEDG-03 touches only packages/api-client + apps/web), but Phase 81 hard-depends operationally on 78 (worker must exist to drain cascade_relabel, and 0061 must be applied), and the shared at-risk files (apps/worker/src/tasks.ts, index.ts, deploy-email-listener.yml, listener genui/chat files) are dirty in the working tree right now from the active session. ROADMAP.md does not yet contain phases 78-81 \u2014 the vLAUNCH proposal still awaits Pedro's bless via /gsd:new-milestone.",
 "key_files": [
  ".planning/milestones/PROPOSAL-vLAUNCH.md",
  ".planning/milestones/vNEXT-AUDIT-2026-08-06.md",
  ".planning/PEDRO-CHECKLIST.md",
  ".planning/ORCHESTRATOR-STATE.md",
  ".planning/STATE.md",
  ".planning/phases/73-living-canvas-agent-dataflow/73-VERIFICATION.md",
  ".planning/phases/74-self-assembling-morning-board/74-VERIFICATION.md",
  ".planning/phases/75-correction-propagation-flywheel/75-VERIFICATION.md",
  "packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql",
  "packages/db/migrations/0060_rapid_red_skull.sql",
  "packages/db/src/schema/correction-propagations.ts",
  "packages/db/src/schema/entity-type-corrections.ts",
  "apps/email-listener/app/application/use_cases/cascade_correction.py",
  "apps/email-listener/app/application/use_cases/curate_entity_merge.py",
  "apps/email-listener/app/domain/ports/correction_cascade.py",
  "apps/email-listener/app/infrastructure/supabase/correction_cascade_repository.py",
  "apps/email-listener/app/presentation/api/v1/relabel_job.py",
  "apps/email-listener/app/settings.py",
  "apps/worker/src/tasks.ts",
  "apps/worker/src/index.ts",
  "apps/worker/Dockerfile",
  "apps/worker/src/install-schema.ts",
  ".github/workflows/deploy-email-listener.yml",
  "docs/DURABLE-WORKER-RUNBOOK.md",
  "packages/api-client/src/root.ts",
  "apps/web/src/lib/pipeline-health.ts",
  "apps/web/src/app/chat/_canvas/pipeline-health-node.tsx",
  "apps/web/src/app/_components/pipeline-health-panel.tsx",
  "apps/web/src/app/api/pipeline/health/route.ts",
  "infrastructure/aws/ecs.tf"
 ],
 "dependencies": [
  "Phase 78 worker cutover before Phase 80 BURN-04 (MORN-07), BURN-05 (LCAN-05/09-live) and ALL of Phase 81 WEDG-01/02 \u2014 cascade_relabel jobs only drain when the worker container is live",
  "Migration 0061 requires the graphile_worker schema installed first (the migration's own DO-block RAISEs otherwise) and requires the 3 GitHub production-environment PROD_* secrets to dispatch deploy-migrate-prod.yml (still empty per PEDRO-CHECKLIST \u00a73)",
  "WEDG-03 metric reads non-zero only after WEDG-01 flag flip + at least one real confirmed merge \u2014 but the metric CODE (router + surface + tests) has no runtime dependency and can be built any time (0060 correction_propagations is already applied on prod since 2026-07-28)",
  "Phase 81 deliberately sequenced LAST in the proposal so the learning-loop metric observes a fully-live stack (durable worker + billing + all flags)",
  "BURN-01/02/03 (browser pass, BTAP-07, MCPX-09) need only CUT-01 (prod DB restored \u2014 DONE 2026-08-06) and are fill-in work any time",
  "vNEXT /gsd:complete-milestone may only run when every row of the audit Decision Ledger is checked (BURN-06)",
  "ROADMAP does not yet contain phases 78-81: Pedro must bless PROPOSAL-vLAUNCH via /gsd:new-milestone before phase machinery (SPEC/PLAN) can target them"
 ],
 "human_gates": [
  "All feature-flag flips are [PEDRO-ALLOW]: CANVAS_EMIT_TOOL_ENABLED (BURN-02), MORNING_BOARD_ENABLED (BURN-04), RECIPE_RECOMPUTE_ENABLED (BURN-05), CASCADE_CORRECTION_ENABLED (WEDG-01), INGEST_ENQUEUE_ENABLED (Phase 78, last)",
  "Create the 3 GitHub production-environment secrets (PROD_POSTGRES_URL_NON_POOLING / PROD_POSTGRES_URL / PROD_SUPABASE_URL with rotated password) so migration 0061 can be applied via the sanctioned pipeline",
  "MCPX-09 is structurally un-delegatable: mcpServers entry + POLYTOKEN_MCP_USER_ID/TOKEN + POSTGRES_URL on Pedro's own machine, in his own Claude Code",
  "BURN-01 verdicts: Pedro must eyeball every screenshot (standing rendered-geometry lesson \u2014 agent can capture, only human eyes accept); BTAP-07 gesture and the CPF-live confirm-merge click are live-browser human actions",
  "Decision Ledger dispositions in vNEXT-AUDIT-2026-08-06.md (EXECUTE / ACCEPT-AS-DEBT with owner+trigger / BLOCK-CLOSE per seam) are Pedro's judgment calls",
  "Standing \u00a70 credential rotation (Supabase pw, sb_secret, AWS key, PATs, sbp_/vcp_/rk_live_) and the SES production-access case 178464704400134 reply (carried alongside, weeks of lead time)"
 ],
 "parallel_opportunities": [
  "WEDG-03 learning.summary router + tests (new packages/api-client/src/router/learning/ + registration in packages/api-client/src/root.ts) plus the surface wiring in apps/web pipeline-health files \u2014 zero file collision with Phase 78 (apps/worker/**, infrastructure/aws/**, workflows) and with the currently-dirty working-tree files",
  "BURN-01 prep: extend the screenshot e2e spec with the cascade/merge-repaint scenario (the audit notes it predates Phase 75 and has zero cascade coverage) \u2014 pure test code, runnable before any flag flips",
  "Verification runsheets/SQL for LCAN-05, LCAN-09-live, CPF-live, and the Phase 78 CUT-06/08/09 checks \u2014 [AGENT] per the proposal, docs/scripts only, no code collision",
  "WEDGE-BASELINE.md skeleton (WEDG-04) and the BURN-06 ledger-reconciliation draft can be written ahead, leaving only real values/dispositions to fill in",
  "Phase 79 billing (BILL-01..04) runs fully parallel to 78/80/81 per the proposal's sequencing diagram \u2014 different files (Stripe/Vercel config, no repo overlap with the wedge or worker surfaces)"
 ],
 "risks": [
  "Working-tree collision RIGHT NOW: apps/worker/src/tasks.ts, apps/worker/src/index.ts, apps/worker tests, ci-web-and-packages.yml, and the listener genui/chat-tool files are all modified-uncommitted by the active session \u2014 any parallel agent editing those files will conflict or clobber mid-write state",
  "The cascade sits ON the production merge path of the live mail receiver: touching the listener cascade files (cascade_correction.py, curate_entity_merge.py, relabel_job.py) in parallel risks breaking the adversarially-verified byte-identical-flag-OFF posture and forces a live-listener redeploy",
  "Ordering hazards if parallelized carelessly: 0061 before graphile_worker schema RAISEs; CASCADE_CORRECTION_ENABLED before the worker drains cascade_relabel strands jobs; reading the WEDG-03 metric pre-flip bakes a misleading all-zero baseline into WEDGE-BASELINE.md",
  "The .planning ledgers (ORCHESTRATOR-STATE.md, PEDRO-CHECKLIST.md, STATE.md, the audit Decision Ledger, HANDOFF.json \u2014 already dirty) are single-writer files; concurrent sessions reconciling them produce merge damage and the exact silent-debt drift the audit exists to prevent",
  "WEDG-03 scope trap: the proposal names '/usage' as a candidate surface but no /usage page exists in apps/web \u2014 building one would violate the explicit 'no new page' constraint; the real options are the pipeline-health node/panel or /billing's existing meters",
  "Browser gates cannot be parallelized: geometry/screenshot configs are workers:1/serial by design (single seed user, magic-link invalidation) and require an already-running :3000 \u2014 spawning servers or parallel playwright runs corrupts the run and .next"
 ]
}
```

