# 08 — Milestones to fundability: traction ladder, demo narrative, metrics to instrument now

Research date: 2026-07-22. Ground rules per `README.md`: sourced (URL/repo path) or labeled
**ASSUMPTION**. This is the "proof" companion to `03-fundraising.md` (which defines what each
stage pays for) and `01-market-and-positioning.md` (the story the proof supports). Repo state is
grounded in `.planning/research/2026-07-22-META-AUDIT.md` (the wishlist↔codebase gap map) and
the schema files cited inline.

**The starting fact that shapes everything:** as of v1.9's close, the deployed product had never
been signed into by its own user and no real email had flowed (LIVE-03/LIVE-04/CLUS-07 tech
debt, 01 §1). polytoken is rich in *artifact* and empty of *usage*. Every milestone below is
ordered by how cheaply it converts artifact into evidence.

---

## 1. What "fundable" means for THIS product at each stage

From 03 §3, restated as pass/fail gates:

| Stage | Gate | polytoken-specific translation |
|---|---|---|
| Network angels ($100–400K SAFE) | Working demo + credible founder + a wedge | Live loop closed; founder is a daily user; demo per §3 below |
| Institutional pre-seed ($500K–1.5M) | Live product, early cohort, retention signal | 25–100 real users through the forwarding flow with a flattening retention curve |
| Seed ($2.5–4M) | $50–200K ARR or exceptional engagement; burn multiple <2x | Paid tier live; 300–1,000 users; COGS/user provable from the ledger |

Seed-stage investors look first at retention cohorts, engagement depth, and organic referral —
and specifically for the "smile curve": early drop-off flattening into stable usage
([CRV, What Seed Investors Look For](https://www.crv.com/content/what-seed-investors-look-for),
[CRV KPI guide](https://www.crv.com/content/key-performance-indicators)). Engagement benchmarks
to calibrate against: DAU/MAU ≥ ~20% is decent, 50% exceptional; for workflow tools WAU is often
the honest cadence ([SheetVenture, seed metrics](https://sheetventure.com/fundraising-knowledge/what-metrics-do-vcs-care-about-at-seed-stage)).
For AI-native products, investors increasingly evaluate **gross-margin trend, workflow
entrenchment, and inference-cost management** rather than classic SaaS NRR thresholds
([CRV, B2B SaaS AI criteria](https://www.crv.com/content/b2b-saas-ai-startup-investment-criteria)) —
which is exactly what `chat_cost_ledger` was built to answer (§4a). 2026 pre-seed screening is
also explicitly hostile to thin wrappers: proprietary data flow + workflow depth is the filter
([Boilerplate Hub, pre-seed AI funding](https://boilerplatehub.com/blog/pre-seed-funding-for-ai-startups));
polytoken's answer is that its data spine is the user's own inbox — but only once mail actually flows.

---

## 2. The milestone ladder (each one cheap, each one compounding)

**M0 — Founder-live (days; zero dev cost).** Close the carried v1.9 debt: LIVE-03 (real Google
OAuth sign-in on prod), LIVE-04 (real email through SES into the deployed pipeline), CLUS-07
(the end-to-end cluster scenario). Runsheet already exists:
`.planning/phases/49-*/MORNING-CHECKLIST.md`. Blocker to clear alongside: SES production-access
approval still pending (meta-audit §2). *Fundability value:* converts "built, never used" into
"founder is the first daily-active user" — the single cheapest credibility fix available (01 §1).

**M1 — Trustworthy ingest (1–2 weeks; prerequisite for ANY outside user).** The meta-audit's
bug map (§3) documents that the ingest pipeline swallows failures at ~60 `except Exception`
sites (`ingest_inbound_email.py:160-313`), degrades LLM-adapter failures silently to
unclassified, and has a fragile reprocess path. An outside user whose forwarded mail silently
vanishes is a killed reference. Scope: surface swallowed errors (pipeline-events/dead-letter
visibility), fix reprocess, extend the cost circuit breaker to the **currently unmetered ingest
path** (05 §1c's mail-bomb spend vector). *Fundability value:* "we fail loudly and cap spend
fail-closed everywhere" is the AI-cost-discipline answer investors now probe (§1).

**M2 — Design-partner cohort (weeks 3–8).** 10–25 hand-recruited outside users through the
forwarding flow (`u-{token}@` addresses, `packages/db/src/schema/forwarding-addresses.ts`).
Instrument the funnel BEFORE inviting anyone (§4). The known funnel cliff is forwarding setup —
**ASSUMPTION:** setting up Gmail auto-forwarding + confirmation is the highest-drop step; measure
`forwarding_addresses.created_at → first emails.received_at` conversion and latency explicitly.
*Fundability value:* "even one real user responding to the product is worth more than anything
in the deck" at pre-seed ([Boilerplate Hub](https://boilerplatehub.com/blog/pre-seed-funding-for-ai-startups)).

**M3 — Retention proof (weeks 8–16).** The cohort's week-4 curve flattens (smile curve, §1);
WAU cadence established; the product-specific "aha" metric moves: **knowledge promotions per
user** (suggest-only gate acceptances — the moment a user confirms the graph is right about
their life). Targets — **ASSUMPTION, set as hypotheses not promises:** ≥40% of activated users
still active in week 4; ≥5 promotions/user/month among retained users.

**M4 — Willingness to pay (parallel to M3).** 5–10 of the cohort convert to a paid tier at
$15–25/mo (04's pricing). This is when the 03 §6 sequence unlocks: network-angel SAFE with
usage + payment evidence, at leverage instead of on faith.

**M5 — Pre-seed evidence pack (months 4–9).** 100+ users, retention curves by cohort, ledger-
derived COGS/user vs price, organic-referral share of signups. Then institutional pre-seed —
or skip toward seed if engagement is exceptional.

**Sequencing note:** M0→M1 are also steps 1–2 of the meta-audit's own proposed sequencing (§4) —
the fundability path and the engineering-hygiene path are the same path. Nothing in M0–M4
requires building any wishlist feature (treemap, drive, spreadsheet wiring, distributed
inference); fundability runs entirely on what already exists.

---

## 3. The demo narrative (built ONLY from actually-existing features)

Per the meta-audit gap map, demo what is **Substantially built / Built**, never what is
greenfield or unwired. A 60–90-second walkthrough plus 2-page insight note is the 2026 pre-seed
packaging norm ([Boilerplate Hub](https://boilerplatehub.com/blog/pre-seed-funding-for-ai-startups)).

**The live arc (8–10 minutes, one continuous flow):**

1. **Cold open — "here is my real inbox becoming a knowledge graph."** Forward a real email
   (with a PDF attachment) to the `u-{token}@` address live. Show it land: parsed, OCR'd,
   regions extracted, thread grouped (email ingestion spine, 01 §1).
2. **Entity resolution** — show `sender_profiles`/`entity_instances` merging multiple addresses
   into one entity (substantially built: aliases, merged_into, BlendedRAG candidate resolution).
3. **The trust ladder** — show an INFERRED fact and the suggest-only promotion widget; say the
   line: *"it never promotes a fact I haven't confirmed."* This is the differentiation claim
   with no competitor precedent (01 §3.2) and it demos in ten seconds.
4. **Canvas + grounded chat** — open the xyflow canvas, thread card as node, ask the agent a
   question it can only answer from the just-ingested mail (mid-turn tool loop over own data).
5. **Genui finale** — ask the agent to build a panel; it composes a live, data-bound, editable
   UI from the capability registry. *"The product builds its own interface"* — the demo-able
   architecture claim (01 §3.3).
6. **The discipline close (for investors specifically)** — show the `chat_cost_ledger` rollup
   for the demo session itself: tokens, dollars, the fail-closed caps
   ($0.50/turn, $2/session, $5/day — `apps/email-listener/app/settings.py:142-147`). *"Every
   token this demo just burned is in this table; margin is instrumented, not estimated."* Then
   the velocity story: the repo, ~11 milestones, overnight build marches, committed gates.

**Never demo (greenfield/unwired per meta-audit §3):** circular treemap (zero code), spreadsheet
grid (built, imported by NO surface), drive versioning/backups/quota, distributed inference
(stub: `execution_locus` reserves `remote-peer`), remote desktops (fail-closed, no live
provider). Mention as roadmap only, one slide, framed per 01 §3's focus-risk warning.

**Failure-mode prep:** the demo depends on live ingest, so M1 must land first, and rehearse the
degraded path (pre-ingested fallback account) — a silent ingest failure mid-pitch is the
worst-case version of the very bug class the meta-audit flags.

---

## 4. Metrics to instrument NOW, tied to real code surfaces

The product's telemetry philosophy is already "DB tables, not third-party trackers" — and a
grep confirms **no product-analytics SDK exists anywhere** (no PostHog/Amplitude/Mixpanel/
Plausible in apps/ or packages/). What exists, what it answers, and the gaps:

### 4a. Unit economics — `chat_cost_ledger` (exists; the crown jewel)

`packages/db/src/schema/chat-cost-ledger.ts`: per-turn rows with `user_id`, `model_id`,
`execution_locus` (server|browser), tokens, `cost_usd`; indexed on (importer_id, created_at)
and user_id; survives conversation deletion by design. **Do now:** a weekly rollup query —
COGS/user/week, cost per active user by model class, $0-browser-turn share. This single query
replaces 05's entire assumption stack the moment usage exists (05 §3.4) and is the direct
answer to the AI-native "inference-cost management" diligence lens (§1).
**Gap:** ingest-side LLM spend (segmentation/classification/embeddings) writes NO ledger rows —
it is both uncapped and uncounted (05 §1c). Extending the ledger (or a sibling `ingest_cost`
ledger) to the pipeline is part of M1; without it, COGS/user understates the truth.

### 4b. Product reliability — `genui_generation_events` (exists)

`packages/db/src/schema/genui-generation-events.ts`: every generation writes outcome
(`ok|fallback|escalated`), attempts, latency_ms, spec validation, tokens, registry_version —
privacy-safe (intent stored as hash). **Do now:** dashboard genui success rate and p95 latency;
demo step 5 lives or dies on this number. Track regression per `registry_version` — this is
also the eval spine for the "self-building product" claim.

### 4c. Engagement depth (exists, needs rollups)

- **Turns/user/week:** `chat_runs` + `chat_run_events` (append-only event log incl.
  `cost_capped`, `failed` — also your error-rate metric).
- **Agent-proposal acceptance:** `chat_widget_interactions.state`
  (pending→submitted|superseded|stale) — the share of agent-proposed actions users actually
  submit is a direct workflow-entrenchment measure, rarer and more convincing than DAU.
- **The "aha" metric — promotions:** knowledge-graph promotion acceptances via
  `knowledge_nodes`/`knowledge_node_edges` writes through the suggest-only gate.
  **ASSUMPTION:** no dedicated promotion-events table exists; derive from row timestamps now,
  add an event row later if attribution gets murky.
- **Workspace adoption:** `chat_canvas_layouts` (returning to a persisted canvas = the product
  became a place, not a chat); `chat_source_ledger` for research-flow usage.

### 4d. Extraction quality (exists, including the query script)

`autofill_retrieval_events` joined to `extraction_records.corrected_fields` — the
correction/miss rate script already exists (`packages/db/scripts/retrieval-miss-rate.ts`).
**Do now:** report correction-rate weekly; a falling correction rate as volume grows is the
"data edge compounds" evidence line for the insight note.

### 4e. Activation funnel (derivable today; instrument before M2)

- **Time-to-first-value:** `forwarding_addresses.created_at` → first
  `emails.received_at` per user (index `idx_emails_importer_id_received_at` already supports
  this). Target — **ASSUMPTION:** <24h; every hour of forwarding-setup friction shows up here.
- **Feed health:** emails/user/week — the ambient-data wedge (01 §3.1) is falsified if this
  decays (users quietly turning forwarding off is churn that never shows in logins).
- **Gap (add for M2):** minimal web-side analytics for signup→OAuth→forwarding-created steps.
  Recommendation: self-hosted PostHog or Umami, keeping the privacy story consistent — the
  pitch says "your mail never feeds trackers"; the app should match.

### 4f. Ingest reliability (the missing table that matters most)

Today a swallowed ingest failure is invisible (§2 M1). **Do now (part of M1):** per-email
pipeline-stage event rows (received → parsed → extracted → resolved) + a dead-letter count.
This yields the operational SLO — % of inbound mail fully analyzed within N minutes — which is
both the pager metric for hire #1 (07 §2b) and a diligence answer.

### The one-page investor dashboard (all queries, no new infra beyond 4e/4f)

| Metric | Source surface | Stage gate it feeds |
|---|---|---|
| WAU / retention cohort curves | `chat_runs`, `emails` per user-week | Pre-seed (smile curve) |
| Time-to-first-value; forwarding conversion | `forwarding_addresses` → `emails` | M2 activation |
| Promotions/user/mo (aha) | knowledge tables via promotion gate | M3 |
| Widget acceptance rate | `chat_widget_interactions` | Entrenchment story |
| Genui success rate, p95 | `genui_generation_events` | Demo reliability |
| COGS/user vs price; $0-locus share | `chat_cost_ledger` (+ ingest ledger, M1) | Seed (margin trend) |
| Correction/miss rate trend | `autofill_retrieval_events` join | Data-edge narrative |
| % mail fully analyzed (SLO) | new pipeline events (M1) | Trust/reliability |

---

## 5. Bottom line

Fundability for polytoken is not a feature problem — it is a **usage-evidence problem with a
2-week engineering prerequisite (M0+M1)**. The demo is assembled entirely from shipped surfaces
(ingest → entities → trust ladder → canvas/chat → genui → cost ledger); the metrics stack is
80% already in the schema and needs only rollup queries plus two additions (ingest cost + ingest
pipeline events) that are independently required for reliability. Sequence: M0 this week, M1
next, instrument §4e/§4f before a single design partner is invited, and start angel
conversations only after M2's cohort has produced its first week-4 retention read.
