# Milestone PROPOSAL — vLAUNCH: Durable Mail & First Dollar

**Status:** 📋 PROPOSAL (drafted 2026-08-06, wrap-up session — awaiting Pedro's bless via
`/gsd:new-milestone`).
**Phases:** 78–81 (numbering continues from vNEXT's 77; never restarts — ROADMAP.md convention).
**Requirements:** 27 (CUT 10 + BILL 7 + BURN 6 + WEDG 4).
**Depends on:** vNEXT CODE-COMPLETE (2026-08-06 — all five phases on `main`; remaining items are
live seams, not software) · Track 1 DONE (Terraform remote state LIVE, imports verified, plan
clean — PEDRO-CHECKLIST §8) · `docs/DURABLE-WORKER-RUNBOOK.md` (the P1–P5 procedure this
milestone executes) · master-plan DECISION 1 (assessment/2026-07-24/00-MASTER-PLAN.md §0).

---

## Thesis

Every prior milestone built software. This one **turns it on and charges for it.** The codebase
is code-complete past its own launch line: the durable worker, billing, the correction cascade,
and the living-canvas seams are all merged, gate-green, and **dark**. What separates polytoken
from a launched product is no longer engineering — it is a short, ordered sequence of live
operations, most of them Pedro-gated by credentials rather than by difficulty.

vLAUNCH does exactly four things, in dependency order:

1. **Durable mail** — execute the Track 3a cutover so no inbound email can ever again be
   silently lost (the master plan's "single most damaging and least visible failure"), staging
   rehearsal first.
2. **First dollar** — flip billing live behind an explicit legal/MoR human gate and collect one
   real, webhook-confirmed charge.
3. **Burn down the live-acceptance debt** — every vNEXT live seam the audit menu marks EXECUTE
   gets run on the real stack, and the ledgers get reconciled to truth.
4. **Open the email-intelligence wedge** — the master plan's DECISION-1 answer made concrete but
   *thin*: cascade flag on, one learning-loop metric measured. The wedge **deepens next
   milestone** (Track 6 proper); this milestone only proves the flywheel turns.

This is deliberately a small milestone. Its enemy is scope, not effort.

### Honest constraint, stated up front — the classifier and credentials

The auto-mode classifier blocks agent-issued outbound calls that carry live credentials to
non-pre-approved hosts (it correctly blocked `rk_live_`/`vcp_` curls to api.stripe.com /
api.vercel.com on 2026-07-26; the Supabase Management API path was allowed only because a rule
existed). Nothing in this milestone routes around that. Every credential operation below is
therefore marked one of:

- **[PEDRO-DASH]** — Pedro does ~5 min of dashboard clicks himself.
- **[PEDRO-ALLOW]** — Pedro adds a scoped allow rule (or approves in a fresh interactive
  session) and the agent executes in minutes. One-paste of a secret into a session counts as
  exposure → it goes on the §0 rotation list afterward, so **prefer allow-rules over pastes**.
- **[AGENT]** — no credentials involved; agent-executable end-to-end (code, CI, scripts,
  verification SQL, docs).

The milestone cannot complete without Pedro at a real computer for Phases 78 and 79's gates.
That is a feature: these are launch decisions, not chores.

---

## Phase 78 — Track 3a Cutover: Durable Ingest, Staging → Prod

**Goal:** inbound mail is processed by the durable graphile-worker path in prod — enqueue-then-
200, retries, dead-letter — with the cutover rehearsed on staging first and rollback proven.
Executes `docs/DURABLE-WORKER-RUNBOOK.md` P1–P5 plus the §P4 enabling sequence, in order.

**Why first:** it is the master plan's top-ranked unmitigated failure (silent mail loss +
SNS-15s retry storms + duplicate Bedrock spend), it unblocks three Phase-80/81 seams
(MORN-07, LCAN-09, cascade re-label all ride the worker), and its prerequisite repair (DB
passwords) unblocks *everything else* including billing verification.

### Requirements

- [ ] **CUT-01 — DB access restored (the prerequisite repair).** Both Supabase projects'
  passwords reset post-auto-pause and propagated everywhere they are stored: Vercel env, local
  `.env.production`/`.env.staging`, and the three GitHub `production`-environment secrets
  (`PROD_POSTGRES_URL_NON_POOLING` / `PROD_POSTGRES_URL` / `PROD_SUPABASE_URL`, IPv4 session
  pooler + `?uselibpqcompat=true&sslmode=require` — PEDRO-CHECKLIST §3). `/api/dbcheck` verified
  green, then the diagnostic route DELETED from `main`. **[PEDRO-ALLOW]** — the ready
  `pwreset.mjs` script (§8 addendum) does the reset + local rewrite; propagation to
  Vercel/GitHub is the credential op. Coordinate with the §0 rotation (one reset covers both).
- [ ] **CUT-02 — Staging rehearsal environment live.** Staging ECS desired count ≥1 (currently
  scaled to 0 for cost), staging Supabase awake, migrations current on staging. Scale back down
  at phase end. **[PEDRO-ALLOW]** (AWS) after **[AGENT]** prepares the exact commands.
- [ ] **CUT-03 — Worker image build + CI half.** A Dockerfile for `apps/worker` (Node runtime)
  and a deploy-workflow job that builds and pushes `:staging`/`:latest` to the
  `nauta-services-email-worker` ECR repo (repo already provisioned; the GitHub deploy role can
  already push). This is the runbook's named missing piece ("No worker Dockerfile / CI job
  exists yet — that is Track 3a's build/CI half"). **[AGENT]** — pure code + CI; image lands via
  the existing OIDC deploy role, no new secrets. *Image-before-enable is load-bearing* (§P4:
  an unpullable image trips the deployment circuit breaker despite `essential=false`).
- [ ] **CUT-04 — Queue schema + migrations.** `install-schema.js` run against staging then prod
  (P2, owner role, non-pooling URL); migrations **0053 + 0054** applied (P3) and **0061**
  applied via `deploy-migrate-prod.yml` (`confirm=MIGRATE-PROD`), which re-verifies 0058–0060 in
  the same run (unblocked by CUT-01's secrets). Verified: `public.enqueue_job` exists and an
  unknown identifier `RAISE`s. **[PEDRO-ALLOW]** for the DB-socket steps (sandbox is HTTPS-only);
  the migrate workflow dispatch itself is **[AGENT]** once secrets exist.
- [ ] **CUT-05 — Worker enabled on STAGING.** Secrets Manager secret with the session-mode DB
  URL → `worker_db_url_secret_arn_staging` in `terraform.tfvars` → `terraform plan` shows ONLY
  task-def revision + service update + read-secrets policy (the §P4 gate; zero churn on SES/SNS/
  S3/ALB or the plan does not apply) → apply → worker boots polling, no `worker_fatal`, memory
  watched on first roll. **[PEDRO-ALLOW]** (AWS creds; remote state makes this safe now).
- [ ] **CUT-06 — Staging cutover proven.** `INGEST_ENQUEUE_ENABLED=true` on the staging
  listener; `redrive-inbound.sh staging <message-id>` drives a real stored email through
  enqueue → `graphile_worker.jobs` row keyed `ingest:<id>` → drain → terminal `parsed`.
  **[PEDRO-ALLOW]** flip; **[AGENT]** verification SQL + log cross-check.
- [ ] **CUT-07 — Worker enabled on PROD.** Same discipline as CUT-05 with
  `worker_db_url_secret_arn_prod`; same plan-gate. **[PEDRO-ALLOW]**.
- [ ] **CUT-08 — PROD cutover flip + live smoke.** `INGEST_ENQUEUE_ENABLED=true` on the prod
  listener, then a real forwarded email observed end-to-end: fast SNS 200 → job row → drained →
  `parsed`; no `email_enqueue_error`; an SNS redelivery does NOT duplicate the job (`job_key`
  idempotency). The runbook's P5 checklist, every box. **[PEDRO-ALLOW]** flip + the forwarded
  email; **[AGENT]** the verification queries and the runsheet.
- [ ] **CUT-09 — Redrive + dead-letter check.** Honest note: there is **no SQS DLQ in-tree** —
  the dead-letter is `graphile_worker.jobs` rows at `attempts = max_attempts`, and redrive is
  the SNS republish script. Verify both halves: (a) a deliberately-failed job dead-letters
  visibly (attempts climb, `last_error` recorded) instead of vanishing, and is re-drivable;
  (b) `redrive-inbound.sh` replays an S3-stored email through the NEW enqueue path idempotently
  (safe on duplicates, per its own header). **[AGENT]** designs the check; **[PEDRO-ALLOW]** runs it.
- [ ] **CUT-10 — Rollback rehearsed + bridge flags dispositioned.** Flag OFF → inline path
  resumes byte-identical, in-flight jobs still drain (runbook §4, actually exercised once).
  `INGEST_BACKGROUND_ENABLED` / `INGEST_INLINE_RETRY_ON_FAILURE` recorded as superseded-by-
  cutover fallbacks (kept, documented, not flipped). **[PEDRO-ALLOW]** the rehearsal;
  **[AGENT]** the docs.

**Sequencing inside the phase:** CUT-01 → (CUT-02 ∥ CUT-03) → CUT-04 → CUT-05 → CUT-06 →
CUT-07 → CUT-08 → (CUT-09 ∥ CUT-10). The runbook's own ordering guard (schema before 0053) is
load-bearing.

---

## Phase 79 — Billing Go-Live: The First Dollar

**Goal:** a stranger *could* pay; Pedro *does* pay (one real live-mode charge) — with the
legal/MoR review as an explicit blocking human gate between "test checkout works" and "public
pricing". Parallel-safe with Phase 78 except CUT-01 (billing verification reads the prod DB).

**Ground truth going in (PEDRO-CHECKLIST §2, §8):** all billing code + `subscriptions` schema
(0056/0057) are live and inert; `/billing` UI shipped; Stripe CLI login EXPIRED; the CLI key is
"one checkbox page from done" (needs Products / Webhook-Endpoints / Checkout-Sessions /
Customers / Subscriptions **Write**); CLI keys expire ~90 days, so a durable restricted key is
part of the work, not a nice-to-have.

### Requirements

- [ ] **BILL-01 — Stripe credential repaired, durably.** `stripe login` re-run; the restricted
  key's Write scopes enabled at the URL Stripe returned (session report); a **durable**
  restricted key minted for launch (not the 90-day CLI key). Rotation of the earlier pasted
  `rk_live_` completes here too. **[PEDRO-DASH]** — this is genuinely a checkbox page.
- [ ] **BILL-02 — Products + webhook created.** Pro **$29** / Power **$49** products + prices
  (MUST match the shipped `/billing` display prices) and a webhook endpoint pointed at
  `/api/stripe/webhook`; price ids + `whsec_` captured. **[PEDRO-ALLOW]** (agent, ~2 min, via a
  scoped allow rule) OR **[PEDRO-DASH]** (~5 min).
- [ ] **BILL-03 — Vercel billing env set.** `BILLING_ENABLED=true`, `STRIPE_SECRET_KEY`,
  `STRIPE_PRICE_PRO` / `STRIPE_PRICE_POWER`, `STRIPE_WEBHOOK_SECRET`, `BILLING_APP_URL`;
  redeploy so serverless instances see it. **[PEDRO-ALLOW]** or **[PEDRO-DASH]**.
- [ ] **BILL-04 — Real test checkout, end-to-end.** One full loop on the live site: Subscribe →
  Stripe Checkout → webhook → `subscriptions` row (`tier=pro`, event high-water mark advancing)
  → `/billing` renders the plan + live usage meters → portal opens → cancel downgrades cleanly.
  Also exercises the `verifyCheckout` delayed-webhook fallback. **[PEDRO]** clicks;
  **[AGENT]** the DB/webhook-log verification and the written evidence trail.
- [ ] **BILL-05 — 🚦 BLOCKING HUMAN PHASE-GATE: legal + MoR sign-off.** Before ANY real
  third-party charge: (a) legal review of the shipped privacy/ToS drafts (LGPD/SCC posture,
  ANPD items); (b) a ROUTABLE privacy contact replacing the `privacy@polytoken.ai` placeholder
  in `legal-entity.ts`; (c) the Merchant-of-Record decision recorded (Stripe ≠ MoR → the LTDA
  owes cross-border tax handling — the two Contabilizei accountant questions from the
  distribution plan); (d) explicit written GO recorded in this file's successor ROADMAP. This
  gate blocks *public* pricing, not BILL-04's own-account test. Mirrors the v1.10 Phase-58
  BLOCKING HUMAN GATE convention. **[PEDRO — judgment, not mechanics]**
- [ ] **BILL-06 — Tier caps wired to money.** `INGEST_TIER_CAPS_ENABLED` flipped after a live
  loop confirms it (free 100 / pro 500 / power 2000 per day, fail-open, `degraded` never
  silent-drop) — entitlements must be enforced the day money is accepted. **[PEDRO-ALLOW]**
  flip; **[AGENT]** the confirming queries.
- [ ] **BILL-07 — First-dollar evidence.** One genuine live-mode charge (Pedro's own card is
  fine) with receipt + webhook-confirmed subscription row, recorded as the milestone's namesake
  artifact. **[PEDRO]**

**Standing external item carried alongside (not a requirement):** reply to AWS SES
production-access case `178464704400134`. It gates multi-user *outbound* mail (Track 5 / team
features), NOT this milestone's single-user inbound launch — but it has weeks of lead time, so
send the drafted reply now.

---

## Phase 80 — Live-Acceptance Burn-Down (the EXECUTE menu)

**Goal:** every vNEXT live seam and accumulated verification debt that the milestone audit's
decision menu marks **EXECUTE** is actually run on the live stack, evidence recorded, and the
ledgers (vNEXT ROADMAP checkboxes, PEDRO-CHECKLIST, ORCHESTRATOR-STATE) reconciled — so vNEXT
can go through `/gsd:audit-milestone` → `/gsd:complete-milestone` clean instead of accreting a
fourth generation of carried debt (the v1.9 lesson: LIVE-03/04/CLUS-07 were accepted as debt at
the gate and haunted three milestones).

**The menu.** The audit finalizes dispositions; this proposal's recommended menu, from the
⭐ CURRENT ledger block + PEDRO-CHECKLIST §1/§4:

| Item | Seam | Needs worker (P78)? | Proposed |
|---|---|---|---|
| Real-browser pass | §1 debt: /billing meters, /settings/account, save-as-doc, canvas sources, capability confirm card, summon-loop UI | no | **EXECUTE** |
| BTAP-07 | agent authors a code-island app live (`CANVAS_EMIT_TOOL_ENABLED`) | no | **EXECUTE** |
| MCPX-09 | Pedro's real Claude Code calls the 3 polytoken tools | no | **EXECUTE** |
| MORN-07 | real overnight morning-board run (`MORNING_BOARD_ENABLED`) | **yes** | **EXECUTE** |
| LCAN-05/09 | recipe survives reload + DB-verified after-close recompute (`RECIPE_RECOMPUTE_ENABLED`, needs 0061) | **yes** | **EXECUTE** |
| CPF-live | correction cascade on real mail (`CASCADE_CORRECTION_ENABLED`) | yes | **moved to Phase 81** — it IS the wedge opener |
| Older v1.10/62-63 pixel legs | carried pixel-gated phases | no | audit decides (likely WAIVE-or-fold into the browser pass) |

### Requirements

- [ ] **BURN-01 — Real-browser screenshot pass.** The full §1 accumulated debt, both themes,
  via `npm run web:dev` + `screenshot:review`; each surface eyeballed by Pedro (jsdom does no
  layout — the standing rendered-geometry lesson: measure the live DOM or read the PNG, never
  infer from source). **[PEDRO]** eyes; **[AGENT]** drives the runs + files the shots.
- [ ] **BURN-02 — BTAP-07 live.** `CANVAS_EMIT_TOOL_ENABLED` flipped; the agent authors a
  bespoke code-island app end-to-end on the live stack (select sources → intent → generated →
  wired → recomputes on a source edit). **[PEDRO-ALLOW]** flip; **[PEDRO]** the gesture.
- [ ] **BURN-03 — MCPX-09 live.** `mcpServers` entry + `POLYTOKEN_MCP_USER_ID`/`_TOKEN`/
  `POSTGRES_URL_NON_POOLING` on Pedro's machine; `tools/list` shows the 3 tools;
  `searchMyKnowledge` returns grounded, cited results from the real graph. **[PEDRO]** (his
  machine, his Claude Code — structurally un-delegatable).
- [ ] **BURN-04 — MORN-07 live.** `MORNING_BOARD_ENABLED` on the worker; one real overnight
  cron run assembles the `home` board headless; morning `screenshot:review` evidence.
  *Depends on Phase 78.* **[PEDRO-ALLOW]** flip; the overnight run is autonomous by design.
- [ ] **BURN-05 — LCAN-05 + LCAN-09 live.** `RECIPE_RECOMPUTE_ENABLED` on the worker (0061
  already applied in CUT-04); a wired recipe round-trips reload AND a DB-verified after-close
  recompute lands. *Depends on Phase 78.* **[PEDRO-ALLOW]** flip; **[AGENT]** the DB verification.
- [ ] **BURN-06 — Menu closed + ledgers reconciled.** Every menu item recorded EXECUTE-passed /
  EXECUTE-failed(→fix) / WAIVED-with-reason; vNEXT ROADMAP live-seam checkboxes ticked
  truthfully; PEDRO-CHECKLIST pruned; vNEXT routed through audit → complete-milestone.
  **[AGENT]** with Pedro's dispositions.

---

## Phase 81 — Email-Intelligence Wedge: OPENER

**Goal:** DECISION 1 answered in the code's favor — the wedge, not the platform — but executed
*thin*: turn the correction flywheel on, watch it propagate on real mail, and stand up the ONE
metric that tells us whether the learning loop actually learns. Nothing else. Entity-resolution
deepening, JIT structured-note retrieval, the circular treemap, reprocess-to-date — all of
Track 6 proper — are explicitly the NEXT milestone, fed by this phase's baseline.

**Why the cascade is the opener:** CPF is the smallest live loop that exercises the wedge's
whole thesis — *a human correction compounds into the proprietary per-user graph* (the "why not
OpenAI" answer; the thing Mem AI's $110M never had). It is already code-complete both halves
(vNEXT Phase 75), needs only Phase 78's worker + a flag.

### Requirements

- [ ] **WEDG-01 — Cascade flag flip.** `CASCADE_CORRECTION_ENABLED=true` on the listener (+ the
  worker's `cascade_relabel` draining). *Depends on Phase 78.* **[PEDRO-ALLOW]**.
- [ ] **WEDG-02 — CPF live acceptance (the vNEXT seam, executed here).** On real mail: confirm
  one genuine merge → suggestion edges promote to canon → past emails re-point onto the
  survivor via the re-label fan-out → every placed downstream node repaints (cascade-highlight
  visible). Evidence: `correction_propagations` ledger rows + before/after DB reads.
  **[PEDRO]** the confirm click; **[AGENT]** the evidence trail.
- [ ] **WEDG-03 — First learning-loop metric.** One owner-scoped read (e.g. `learning.summary`)
  over the `correction_propagations` ledger + `entity-type-corrections`, surfaced on ONE
  existing surface (the pipeline-health node or `/usage` — no new page): corrections made ·
  emails re-labeled per correction (propagation leverage) · % of corrections that STICK (not
  re-corrected within N days). This is the retention-adjacent number the master plan says gates
  everything downstream (pricing/moat/raise). **[AGENT]** end-to-end; needs only WEDG-01 live
  to read non-zero.
- [ ] **WEDG-04 — Wedge boundary + baseline recorded.** A short WEDGE-BASELINE.md: the metric's
  first real values, what was deliberately NOT built, and the named Track-6 backlog it feeds
  (entity resolution across domains, JIT retrieval via RRF, treemap on the node model,
  idempotent reprocess-to-date via the now-live worker). The next milestone's opening input.
  **[AGENT]**.

---

## Sequencing (whole milestone)

```
P78 CUT-01 (DB repair) ──────────────┬────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            │
P78 CUT-02..10 (staging→prod    P79 BILL-01..04 (test checkout)   │  ← parallel tracks
    worker + cutover)                │                            │
        │                       🚦 BILL-05 legal/MoR GATE         │
        │                            ▼                            │
        │                       BILL-06..07 (first dollar)        │
        ▼                                                         ▼
P80 BURN-01..03 (no-worker items can start anytime after CUT-01) ─┤
P80 BURN-04..06 (worker-dependent)  ← after P78                   │
        ▼                                                         │
P81 WEDG-01..04 (cascade + metric)  ← after P78; last, so the     │
                                      metric reads a fully-live stack
```

- **78 before everything worker-shaped**; **79 runs in parallel** (only CUT-01 gates it).
- **80's no-worker items (BURN-01/02/03) are fill-in work** whenever Pedro has browser time.
- **81 last, deliberately** — the learning-loop metric should observe the durable, billed,
  fully-flipped stack, not a half-lit one.
- Estimated shape: P78 **L** (mostly operations) · P79 **M** (mostly gates) · P80 **M**
  (mostly evidence) · P81 **S/M** (one flag + one metric). No XL — by design.

## Explicitly out of scope (parked with reasons)

- **Track 6 deepening** (entity resolution, JIT retrieval, treemap, reprocess-to-date) — next
  milestone; WEDG-04 is its intake.
- **Track 5 sharing list-unions** — still hazard-gated on the real-Postgres isolation CI job
  (Track 2 remnant); do not batch-build (standing PEDRO-CHECKLIST §7 rule).
- **SES production access** — external gate with weeks of lead time; reply to the case now, but
  no phase depends on it (single-user inbound launch is sandbox-compatible).
- **Tracks 8/9/11/12** (tabular scale-up, PolyDrive, desktops, inference spike) — per master
  plan ordering under the wedge answer to DECISION 1.
- **`.planning/` archival reorg + remaining Track 2 items** — fold into normal hygiene, not a
  launch phase.
