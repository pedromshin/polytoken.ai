# polytoken — Master Plan (2026-07-24)

Synthesis of 8 recon lanes + 6 research lanes. Read-only assessment; this is the sequencing decision, not an inventory. Every ordering claim below was spot-verified against code, not docs.

---

## 0. The one framing decision that reorders everything

Before the tracks: the business lane and the engineering lanes disagree about what polytoken *is*, and Pedro has to resolve it because it changes the order.

- **Engineering reality:** a genuinely mature, well-architected agent platform. A capability registry that is a real single-source-of-truth read by four consumers (`packages/capabilities/src/capability.ts`), a lint-imports-enforced Clean Architecture Python listener, prompt caching, hybrid RRF retrieval, an eval harness, cost circuit-breakers enforced in code. This is not a wrapper.
- **Business reality:** zero external users, solo non-incorporated founder, and *breadth* (canvas + genui + drive + desktops + distributed inference) competing with the **one real edge**: automatic zero-ceremony email capture producing a compounding proprietary per-user graph — the only credible "why not OpenAI" answer, and the exact thing the funded failure (Mem AI, $110M) lacked. That moat is **downstream of retention** and cannot precede it.

**The fork (DECISION 1):** *Broad agent platform* vs *sharpen to the email wedge and instrument retention first*. If the answer is "wedge," Track 6 (Email Intelligence) and Track 10 (Frontend Fluidity) leap ahead of Tracks 7/8/9/11, and the distributed-inference/remote-desktop ambitions get parked as venture-narrative distractions. The plan below is ordered to be **correct under either answer** — Tracks 0–3 are prerequisites no matter what — but the feature-track ordering (6 vs 7/8/9) is where this decision bites.

---

## 1. Dependency spine (why the order is the order)

Two already-decided foundations gate almost everything, and they are genuinely not built:

- **Durable runtime (graphile-worker).** Verified absent — `grep -c graphile-worker package-lock.json` → **0**. Today every durable unit of work (inbound-email ingestion + every LLM generation) runs **inline inside an HTTP handler**, on a single uvicorn worker (`Dockerfile:52`, no `--workers`) in a single ECS task (`prod_desired_count` default **1**, `variables.tf:36-40`). The SNS handler wraps the whole S3+MIME+OCR+multi-Bedrock pipeline in a bare except and **always returns 200** (`sns_inbound.py:57-64`) — so any failure silently, permanently loses the email. There is no queue, DLQ, retry marker, or outbox anywhere. **This is the single most damaging and least visible failure in the system, and it is unmitigated in-tree.**
- **Node data model.** The per-conversation canvas is a **JSONB blob** — `chat_canvas_layouts`, one row per conversation, UNIQUE on `conversation_id`, `nodes`/`edges` as `jsonb` (`packages/db/src/schema/chat-canvas-layouts.ts`). It has **already sprouted an ad-hoc `scope='home'` discriminator** bolted onto the same table in migration 0046 to fake a "home board" — a visible symptom that the blob is straining. Every feature track that adds canvas nodes (email-intelligence viz, tabular, genui-home, canvas-platform, drive treemap) built on the blob **gets rewritten** when this is promoted to first-class `Workspace → Canvas → Node` rows.

Everything else layers on top. The ordering below is: **safe the landmines → unblock parallel work → build the two foundations → fan out.**

---

## 2. The tracks (ordered)

Legend — Size: S/M/L/XL. "Parallel-safe" = can run alongside peers in the same tier. "Serialized-behind-X" = must wait for X.

### TRACK 0 — Landmine safing & orientation `S · parallel-safe · DO FIRST`
**Goal:** make it safe for any agent (including the parallel fan-out) to touch the repo without breaking Pedro's mail or orienting on stale state.
- Fix the **inverted drift narrative** in `CLAUDE.md`: add a one-line Landmine-1 guard stating `magnitudetech.com.br` / `nauta-*` are **LIVE** SES + Vercel names, renaming = outage (evidence: `ses.tf:3`, `variables.tf:16`, `DEPLOY.md:20`). Pick one state ledger (STATE.md vs ORCHESTRATOR-STATE.md — they contradict on branch and work-mode), reduce the other to a stub, repoint `CLAUDE.md:41` off the 2-day-stale audit.
- **Rotate the leaked IAM keys** (pasted into prompts across sessions; treat as compromised) and disable any long-lived human-user access keys; move dev flows to short-lived STS. Repo itself is clean (task roles), so this is out-of-band hygiene, not a code change.
- **Decouple the $30 budget alert from the SES forwarding chain** (`variables.tf:96-99` → `pedro@magnitudetech.com.br`, delivered via the fragile personal-forward Lambda). Point it at Gmail directly and add an AWS Budget **Action / hard cap** (currently alert-only, `budget.tf:9-41`) — the only runaway-spend backstop, and it is coupled to the identity a future SES migration retires.

**Risk if deferred:** an uninformed agent acting on the "purge stale domain" framing rewrites the live SES domain = mail outage; a leaked-key + alert-only budget means unbounded AWS spend before anyone is notified.

### TRACK 1 — Terraform remote state + SES import `L · serialized · BLOCKS ALL IaC`
**Goal:** make `terraform apply` safe to ever run again. This is Landmine 2, and codifying the SES drift (done 2026-07-23: `ses-forwarder.tf` + `IMPORT-RUNBOOK.md` exist) **exposed a larger hazard**, it did not close it.
- **There is no remote state backend** — `main.tf:15-20` has the S3 backend commented out. State is local/ephemeral, so **any apply from a checkout lacking the local imported state treats every live resource (SES rules, forwarder Lambda, S3 bucket, SNS, ECS, ALB) as new** → name collision or duplicate-create → mail outage.
- Create the state bucket, uncomment the backend, `terraform import` **every** live resource into shared state, verify an **empty/acceptable plan** before any apply is ever permitted.
- Run the 5 IMPORT-RUNBOOK forwarder imports; **verify the Lambda env diff is zero** (values were asserted, never read from live — `ses-forwarder.tf:113-126`).
- **Codify or at minimum document inbound-mail DNS** (MX/DKIM/verification) — currently 100% out of band (`grep route53|MX|dkim` → nothing), which understates Landmine-1's rebuild cost and makes a teardown unrecoverable from IaC.

**Risk if deferred:** the mail-outage trap stays armed for the whole project; and it **blocks the biggest cost lever** (Track 3a's ingress teardown touches the ALB/Fargate) and the ALB security fix (Track 4 S2 touches `network.tf`). Nothing infra-shaped can proceed safely until this lands.

### TRACK 2 — Decomposition & CI gates `L · parallel-safe (container.py first) · unblocks fan-out`
**Goal:** stop the god-files from throttling the parallel-agent development model, and give the browser product any automated verification at all.
- **Split `container.py` (1433 lines) FIRST** — it is the repo's deterministic merge-conflict magnet: every new use case edits both its ~200-line import block and a `_provide_*` factory, so the live parallel `wf1-*` branches collide on it every time. Split into `container/providers/{ingest,chat,entities,genui,infra}.py`. Declarative DI, behavior-risk ~0.
- Then split the other three 1400+ files behind their existing e2e tests: `run_chat_turn.py` (1755, hottest path — gate on the 1208-line tool-loop e2e), `chat-canvas.tsx` (1486, pull 7 pure helpers out), `manifest.ts` (1529).
- **Add `ci-web-and-packages.yml`.** Today the **entire TypeScript side has zero CI** — the only gate is `ci-email-listener.yml` (pytest, path-filtered). Web 1722 / api-client 733 / genui 627 / db 84 / capabilities 65 / daemon 216 tests run only by hand. Full sweep is ~130s serial; nothing about speed blocks this.
- Add an **ephemeral-Postgres CI job** that applies every migration from scratch (40+ SQL files including data-backfills never run against a DB until prod, `deploy-migrate-prod.yml`) and a **real-Postgres tenant-isolation job** (today isolation is tested only against fake Drizzle chains / mocked repos, and RLS can't backstop because the app connects as `service_role` — see Track 5). The harness for this exists as the skipped `test_integration_real_postgres.py`; wire a DB, drop the skip.
- **Green + gate the daemon suite** — it is currently **RED** (12 failing tests, Windows-only junction cases + non-hermetic realpaths) and nobody would know because it's ungated.
- Delete the 2 knip-confirmed dead files (`emails/[id]/_components/fields-panel.tsx`, `use-autofill.ts`) + trim unused deps. **Do NOT delete `retired-entity-types.ts`** — it is an intentional migration-0049 deny-list guard, not maritime dead code.
- Fold in the deferred `.planning/` archival reorg (768 files; superseded same-week audits flagged but never moved).

**Risk if deferred:** `container.py` stays the collision point throttling every parallel agent; a tenant-data leak, broken build, or non-rendering canvas reaches prod undetected; migrations first execute against real data in prod.

### TRACK 3 — Durable runtime + node data model `XL · serialized behind 1 & 2 · THE foundation`
This is the already-decided foundation (repo Task #7). Two coupled halves; **both block the feature fan-out.**

**3a — graphile-worker durable runtime.** SNS handler does one durable **enqueue then returns 200**; a worker owns the heavy pipeline with retries + dead-letter. This single change is the common fix for the top three reliability findings **and** the cost lane's #1 lever (it removes the always-on inline pipeline). **Two hard constraints:** (i) **co-locate the worker** in the existing listener container / scheduled task — a *new* always-on Fargate service doubles the fixed-compute problem (~$34/mo of always-on Fargate+ALB already serves only sporadic webhooks) and adds constant Supabase poll load; (ii) apply durability to **deep_research + ingestion, NOT the interactive chat turn** — the LLM-patterns lane is right that the sub-5-min interactive turn should stay in-process; event-source the long money-burning loops from the already-emitted `ChatRunEvent` stream. Also wrap the 93 unwrapped ingest-path `.execute()` calls in `to_thread` so one slow email stops freezing the single event loop.

**3b — Promote `chat_canvas_layouts` blob → `Workspace → Canvas → Node` rows.** The W5 tenancy primitives already exist (`workspaces.ts`, `workspace-members.ts`, `resource-shares.ts`, migration 0047) but the canvas is still a per-conversation JSONB blob with a bolted-on `scope='home'` hack. Promote to real rows **before** any feature track adds nodes.

**Risk if deferred:** highest of any track. Inbound email is silently lost **today**; one slow email stalls all users; every ECS deploy kills in-flight chat/generation (single task); and every feature built on the blob is thrown away.

### TRACK 4 — Correctness, trust & observability `L · mostly parallel-safe · serialized items noted`
**Goal:** make the AI trustworthy and the system observable before piling features on it.
- **Full review of the email-AI analysis system** (the brief's "suspected many bugs") paired with the missing measurement: **there is no extraction-quality eval in the tree** — `jsonschema` validates *shape*, not *correctness*. Build a 30–100 doc hand-labeled golden set (from **extracted records/fixtures, never raw email content** — harness guardrail) + field-level micro-F1, gate in CI. Use DeepEval-in-pytest (no vendor-governance risk; promptfoo is now OpenAI-owned as of Mar 2026).
- **Security S1 (SNS SSRF, high, live-exploitable):** `sns_inbound.py:36` reads an attacker-supplied `SubscribeURL` and `confirmation.py` GETs it with no host allowlist and **zero SNS signature verification**. Verify message signature (cert host-pinned to `sns.<region>.amazonaws.com`) + allowlist the SubscribeURL host before any GET.
- **Security S2 (public plaintext ALB, high) — serialized behind Track 1** (touches `network.tf`/`alb.tf`): the prod ALB is HTTP:80 open to `0.0.0.0/0` in front of a service whose entire cross-tenant safety is a shared `API_KEY` + a spoofable `X-User-Id` header. Restrict the SG to BFF egress, terminate TLS, drop :80.
- **Empty-`API_KEY` fail-closed:** `auth.py:20-22` turns auth OFF when `API_KEY` is empty and `ENVIRONMENT=development` — a mis-set env on the public ALB is a full open door.
- **LLM observability (zero exists today** — no langfuse/otel/braintrust anywhere): OpenLLMetry → **self-hosted Langfuse**. Keeps email-derived prompts on your infra (privacy-consistent) and doubles as the eval dataset store. **Do NOT route email-derived traces through SaaS** (Braintrust/Maxim/Latitude).
- Put the **existing** genui/email-listener evals into CI as a merge gate, with **injection canary-leak as a HARD gate** (a canary-leak regression is a security regression, not a quality nit).
- **Backups / versioning / catastrophic-loss protection** (brief-named, currently unspecified): define RPO/RTO for the DB and the drive; `file_versions.ts` exists but there is no stated backup policy.
- Cheap cost wins that live here: move extraction + offline eval runs to the **Batch API** (~50% cheaper, async, no user waiting) and **assert prompt-cache hits in the cost ledger** (caching is implemented in `bedrock_chat_adapter.py` but unverified).

**Risk if deferred:** SSRF + plaintext god-key are exploitable now; you cannot see why an agent turn failed; you have no measure of whether extraction is *correct* (the product's core value); a single failure loses data irrecoverably.

### TRACK 5 — Multi-tenant sharing `L · serialized behind Track 2 CI · gated externally by SES sandbox`
**Goal:** make sharing actually function end-to-end. It's a **retrofit, not a rewrite** — `user_id` is the ownership anchor and sharing is additive — but it is **~15% done and that 15% is invisible.**
- `assertCanAccess` is wired into **one** by-id read path (`documents.byId`, `documents/index.ts:97`); 99 id-reads still use owner-only asserts, and **no list query anywhere unions shared resources** — even `documents.list` filters flatly on `eq(Documents.userId, ctx.user.id)` (`documents/index.ts:64`). A share recipient can never see a shared resource in any list. **Sharing does not work end-to-end and there is zero frontend for it.**
- Rewrite the ~56 user-scoped list queries for the 4 shareable types to `owned ∪ shared` unions (documents.list first — highest leverage). **Each rewrite is a potential cross-tenant leak with no DB backstop** (service_role bypasses RLS, policies are deny-all) — test each path individually against real Postgres, never batch-apply. This is *the* reason Track 2's real-Postgres isolation job must exist first.
- Swap owner-only asserts → `assertCanAccess` only where sharing is intended (conversation, entity), then build the share-sheet + workspace/member UI.
- **HARD EXTERNAL GATE (Landmine 3):** any multi-**user outbound-mail** feature is blocked on SES production access regardless of code — see §4.

**Risk if deferred:** collaboration (the venture-path prerequisite in DECISION 1) stays a backend-only skeleton.

### TRACK 6 — Email intelligence `XL · serialized behind Track 3 (both halves) · the product wedge`
**Goal:** the core loop the business lane says is the only real moat. Primitives partially exist (`sender_profiles` → optional `entity_instances` link, `entity-instances.ts`, `entity-type-corrections.ts`), which is why this is composition, not greenfield.
- Auto ingestion/processing of **all** mail (durable, via 3a) + **idempotent resumable reprocessing up to a chosen date** (`backfill_reprocess.py` exists but runs the full OCR+LLM pipeline **inline**, batched at 25 to dodge the ALB idle timeout — convert to enqueue-N-jobs once 3a lands).
- **Entity resolution:** recognize ONE abstract entity behind multiple domains/addresses + link senders. Solve email-context-to-model via **JIT structured-note retrieval** through the existing RRF retriever (repo Task #6), **not** bigger prompts — long-horizon agents fail from context distraction, not size.
- Rendering entities/senders/comms in **conventional UI AND** the canvas **circular treemap** (relationships + bundling-circle labels) — the treemap needs the node model (3b).
- **Correcting the AI from an email preview and propagating the correction** (repo Task #5; `entity-type-corrections.ts` is the primitive). Ship GenUI graceful-failure here too: validate-then-repair every Bedrock structured call against the registry's Zod schema — malformed model output is normal, not a crash.
- **Any memory layer added here is a new prompt-injection persistence surface** — gate behind the existing injection adversarial suites; do not adopt Mem0/Zep, start with eval-gated summarization keyed by `importer_id`.

**Risk if deferred:** you defer the one thing that could make the product retentive/fundable. Under DECISION-1 = "wedge," this track is #1 after foundations.

### TRACK 7 — Canvas platform + GenUI home + agent-integration spine `XL · serialized behind 3b`
**Goal:** the interactivity + persistence layer, planned for growth not the next feature.
- Canvas: context menus, drag, keyboard, add/remove, far more interactivity.
- GenUI **persistent, entirely agent-generated home**; panels on request; drag/drop/expand/resize/snap/remove/stash, all persistent (the mig-0046 home-board blob is the thing to promote onto the node model).
- **Write the comprehensive feature doc early** (spanning canvas/chat/drive/knowledge-entity-types/agent-context-controls/distributed-inference/remote-desktop as one system with agent-driven integration as the spine) **even though the build is late** — otherwise each track invents integration ad-hoc.
- **Highest-leverage single cross-lane move:** project the capability registry as a **self-hosted MCP server** — a projection of existing code (`capability.ts` already carries source/trust/risk axes) that serves both the product (composable) and the dev loop (Pedro's own Claude Code calls polytoken capabilities). **Expose-first only; do NOT consume external MCP servers** (30–82% of public servers are exploitable; external tool *descriptions* flow into the LLM and must be quarantined like retrieved text).

**Risk if deferred:** features built on the blob get rewritten; without the spine doc, integration is reinvented per track.

### TRACK 8 — Tabular system `L · storage parallel-safe · canvas rendering behind 3b`
**Goal:** the "scalable Excel-like" system — but the word *scalable* fights what's shipped.
- **This is NOT greenfield:** `ag-grid-community ^35.1.0` + a 2286-LOC wrapper + a Postgres **JSONB whole-document** store (`spreadsheets.ts`, migration 0044) + `table.create/update` agent capabilities are all live and wired into the canvas node and entities table.
- **Keep ag-grid-community + Postgres as system-of-record.** Introduce **DuckDB as the derivation/query engine** (server-side `pg_duckdb`/`postgres_scanner`; DuckDB-WASM+OPFS client-side) so the agent's core verb "extract info from table X into new table Y" becomes agent-authored **SQL materialized back**, not a full-table JS rewrite. Zero Rust required — rules out DataFusion.
- Normalize the JSONB whole-document only on the schema's own named escalation trigger. Do **not** adopt per-cell `spreadsheet_cells` (join+mutation machinery for zero consumer). Reject Handsontable (non-commercial license), Luckysheet (archived Oct 2025), Univer (wrong altitude unless the product pivots to user-authored formulas).

**Risk if deferred:** every table edit rewrites the whole sheet and the migration cost grows with the data.

### TRACK 9 — PolyDrive `XL · migration parallel-safe · canvas viz behind 3b`
**Goal:** own the drive substrate as agent context.
- Migrate ~500GB off OneDrive; add drive files to chat easily; deep chat↔drive context/search/management/creation.
- Visualize the drive many ways incl. a canvas circular treemap with bespoke **per-subfolder agent-generated** viz (needs node model 3b).

**Risk if deferred:** the drive-as-context differentiator is absent; 500GB stays hostage to OneDrive.

### TRACK 10 — Frontend fluidity `M · parallel-safe`
**Goal:** diagnose page-change/interaction clunkiness; make it fluid/snappy/persistent. **Under DECISION-1 = "wedge," this is #2** — the founder self-describes the UI as "ugly/experimental, not production," and clunkiness directly suppresses the retention number the business lane says gates the raise. One n: give each Playwright worker a distinct seed user so the visual-gate `workers:1` ceiling lifts.

**Risk if deferred:** retention (the thing that resolves pricing/moat/raise all at once) is capped by a janky surface.

### TRACK 11 — Remote desktops `L · parallel-safe · low urgency`
**Goal:** persistent, robust, one or several at once, with live per-hour cost. Capability (`desktop.ts`) exists and is currently fail-closed (=$0). A named pillar, but the least urgent under the wedge framing.

**Risk if deferred:** low — it's fail-closed today, no data loss, no cost bleed.

### TRACK 12 — Distributed inference `S (spike) · deferred · C2 killed`
**Goal:** a **bounded 1–2 week SPIKE of C1 only** (own-fleet pooling across a single user's own devices — activates the already-reserved-and-unused `remote-peer` locus at `chat_model_registry.py:6,30`, reuses the injected-port pattern, has **no** market/trust/payments/proof landmines). Exit criterion = a go/no-go on C2 + a demand signal (do users even own a second capable machine).
- **PARK C2 (open marketplace) with four hard gates. Both the inference lane and the business lane say kill the C2 two-sided-market monetization track.** C2 over consumer hardware is **incoherent with polytoken's own privacy stance by construction** — GPU TEEs (the only real answer to prompt privacy on a stranger's box) exist on datacenter H100/H200 only; the idle RTX-4090-class supply C2 must recruit has none. That's a hardware fact, not a maturity gap. Redeemable credits are **money-transmission felony territory** (18 USC 1960) — closed-loop non-redeemable only, and only after counsel.

**Risk if deferred:** near-zero. The real risk here is doing it **too soon** — C2 is a second company.

---

## 3. Shortlist — what to do first, and why

1. **Track 0 (landmine safing) — hours, S.** An uninformed agent literally breaks Pedro's mail acting on the inverted "purge stale domain" framing; cold-starts orient on contradictory 2-day-stale ledgers; a leaked key + alert-only budget is unbounded spend. Cheapest, highest blast-radius-reduction move in the plan.
2. **`container.py` split (front of Track 2) — days, part of L.** It is the *deterministic* merge-conflict point for the parallel-agent model Pedro is using **right now**. Every new use case collides. Declarative DI, behavior-risk ~0. Unblocks the fan-out that builds everything else.
3. **TS CI gate (Track 2) — hours to stand up.** The browser product ships with **zero** automated verification today. Full sweep <2min; the only reason it doesn't exist is nobody wrote the workflow. A tenant leak or broken build currently reaches prod unseen.
4. **Track 1 (Terraform state + SES import) — L.** The gate on every infra change and the mail-outage backstop. Until shared state exists and live resources are imported, no `apply` is safe and the cost/security infra work can't start.
5. **Track 3a (graphile-worker enqueue-then-200) — the first half of the XL foundation.** Inbound email is being **silently, permanently lost today**. This one change fixes the top-3 reliability findings *and* removes the always-on inline-pipeline cost driver. Co-located, not a new service.

Then **3b (node model)** unlocks the entire feature fan-out (Tracks 6–9). Sequence 1→2→3, then fan out per DECISION 1.

---

## 4. The three Part-C landmines, addressed head-on

**Landmine 1 — Maritime domain purge vs live infra namespace.** The domain-model purge is essentially **complete** in app code; the only remnant is `retired-entity-types.ts`, an **intentional live migration-0049 guard — do NOT delete it.** But `nauta-services` / `magnitudetech.com.br` name the **LIVE** S3 bucket, SNS topics, SES receipt rule set, Vercel project (`nauta-web`), and the Terraform `var.project` default (`variables.tf:16`, `ses.tf:3`, `DEPLOY.md:20`). The meta-dirs lane found the drift narrative **inverted** — these look stale but are load-bearing. **Guard:** the CLAUDE.md one-liner in Track 0; and **never fold "purge domain model" and "rename infra namespace" into one task.** Renaming = recreate the SES pipeline + re-point DNS = mail outage.

**Landmine 2 — SES Terraform drift.** Already **codified** 2026-07-23 (`ses-forwarder.tf` + `IMPORT-RUNBOOK.md` verified present), so it is no longer invisible — but codifying it **exposed the real hazard: no remote state backend** (`main.tf:15-20` commented). Any `apply` from a checkout lacking the local imported state recreates/reorders the live SES rule set and can drop Pedro's personal-forward rule. **Gate (Track 1):** stand up shared S3 state + `terraform import` ALL live resources + verify an empty/acceptable plan **before any apply is ever permitted**; verify the forwarder Lambda env diff is zero; codify the out-of-band DNS. No `apply` until state reflects live.

**Landmine 3 — SES sandbox + key rotation.** SES may still be in **sandbox** (`ProductionAccessEnabled=False`) — outbound only reaches verified identities, so **any multi-user outbound-mail feature is blocked on AWS production-access approval regardless of code.** **File the request now** (weeks of lead time); it is a hard external gate on Track 5's team/venture path and on DECISION 1's team fork. Separately, **IAM keys pasted into prompts across sessions must be treated as compromised — rotate/disable in Track 0** before any external-user or investor due-diligence exposure.

---

## 5. Conflicts & architecture fights (named directly)

- **Convergence worth exploiting:** graphile-worker enqueue-then-200 (reliability) **=** the cost lane's event-driven ingress (removes always-on Fargate+ALB inline pipeline) **=** the durable-ingestion fix. **One change, three wins** — but only if co-located (not a new always-on service) and only after Track 1 (state import) makes the ALB/Fargate teardown safe.
- **"Scalable tabular" vs shipped storage:** the request fights the JSONB whole-document store (`spreadsheets.ts`) *and* hits an **ag-grid Enterprise license cliff** — Server-Side Row Model / pivot / charts are paid, at exactly the scale the brief names. DuckDB-as-derivation resolves the storage half; the license half is DECISION 3.
- **Distributed-inference C2 vs everything:** incoherent with the privacy stance (no consumer-GPU TEE) *and* money-transmission risk *and* the business lane's "kill it." Killed, not deferred-with-hope. C1 spike only.
- **Multi-tenant outbound features vs SES sandbox:** a hard external gate — code cannot unblock it.
- **Don't over-apply durability:** event-source deep_research + ingestion, **keep the interactive turn in-process** (LLM-patterns lane). Durability has a serialization cost that would hurt the sub-5-min chat turn.
- **Don't adopt an agent framework:** LangGraph/Mastra/CrewAI/CopilotKit would duplicate the capability-registry spine and lose the "one declaration, four consumers" moat. Build durable execution natively (Track 3a). This is a fit judgment, not a quality one.
- **Platform breadth vs the wedge (DECISION 1):** the meta-conflict that reorders Tracks 6–11.

---

## 6. Decisions needed from Pedro

1. **The fork (§0):** broad agent platform, or sharpen to the email wedge + instrument retention first? Reorders Tracks 6 vs 7/8/9/11.
2. **File SES production-access now?** Hard external gate on any multi-user outbound mail; weeks of lead time; decouple from code.
3. **ag-grid Enterprise license vs churn to glide-data-grid** (MIT, rebuilds ~2286 LOC) at tabular scale. Storage-gated but decide before Track 8 scale work.
4. **DuckDB as the derivation/query engine** — yes/no. The answer to "agent extraction should be a query, not a JSONB rewrite."
5. **graphile-worker deployment shape** — co-locate in the listener container (recommended; avoids doubling fixed compute) vs a new service.
6. **Multi-tenancy scope now or deferred** — it's a retrofit, but each list-union rewrite is a cross-tenant leak with no RLS backstop, and outbound is SES-sandbox-gated.
7. **Observability stack** — confirm self-hosted Langfuse (privacy-consistent) over SaaS for email-derived traces.
8. **Backups** — set an explicit RPO/RTO for the DB and the 500GB drive; "catastrophic-loss protection" is named but unspecified.
9. **Distributed inference** — confirm C1-spike-only, C2-killed (both lanes concur).
10. **Incorporation/raise timing** — the business lane's recommendation is *not now*: buy a retention number first, keep a clean personal IP-assignment paper trail, don't spend the one-shot warm VC network on zero traction.
