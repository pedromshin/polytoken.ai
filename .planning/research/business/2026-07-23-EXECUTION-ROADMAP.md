# Execution Roadmap — the decision + the sequence

Synthesis date: 2026-07-23. This document is the **entry point** to the business-research folder.
It compresses the eight research tracks (`01`–`08`) into a decision framework and a sequenced plan
for one specific person in one specific situation: Pedro — solo founder, ex-sole-engineer at a VC
firm, with a live VC/PE network, Brazil-based, evaluating whether to turn polytoken from a solo
project into a company.

**Read the tracks for the evidence; read this for the decision.** Every recommendation below cites
the track it rests on. Where a track labeled something an ASSUMPTION, it stays an assumption here —
this roadmap adds sequencing and judgment, not new facts.

---

## 0. The situation in one paragraph (what changed, what didn't)

The eight tracks were written 2026-07-22 against a product that was **artifact-rich and
usage-empty**: deeply built, architecturally novel, but never signed into by its own user, with no
real email ever flowed (01 §1; 08 opening). Since then the grand orchestrator shipped **six more
waves** (W0–W6): ingest-time entity resolution, the circle-pack treemap, the in-house spreadsheet
grid, drive versioning/trash/quotas, the agentically-generated home page, file-to-chat attachments,
**multi-user teams/workspaces/RBAC/sharing**, and Phase-0 scaffolding for distributed inference and
remote-desktop live-cost. Concretely, this moved almost every item track 08 §3 told Pedro to
**"never demo"** (treemap, spreadsheet wiring, drive versioning, teams) into **demo-able** surface.
**But it did not move the one thing fundability actually depends on.** The live loop — LIVE-03
(real OAuth sign-in on prod), LIVE-04 (real inbound email), CLUS-07 — is *still* owed as user-only
console actions (STATE.md §"Carried debt"; HANDOFF.json), still gated on SES production-access
approval. So the ratio of *built* to *used* is now more extreme than when the tracks were written.
**The core recommendation follows directly from that gap: stop building, start being used.**
Fundability is a usage-evidence problem, not a feature problem (08 §5), and polytoken has spent the
interval adding features.

---

## 1. Go / No-Go decision framework

Not "is polytoken a good product" (the repo already answers that). The question is **"should Pedro
convert it into a company he pursues seriously,"** and it resolves to five gates. Treat them as
sequential AND gates — a No on an early one makes the later ones moot.

### Q1 — Will you personally use it every day? (the founder-as-user test)
The entire wedge is "your graph builds itself from mail that arrives anyway" (01 §3.1). That thesis
is **unfalsifiable until the founder is the first daily-active user** — which today requires only
console actions, zero dev (08 §2 M0). If Pedro will not run the MORNING-CHECKLIST runsheet and live
inside the product for two weeks, that is itself the answer: a personal-data product whose own
builder doesn't depend on it is not fundable and probably not worth the company overhead. **This is
the cheapest, highest-signal gate and it is gate #1 for a reason.** Cost to answer: days.

### Q2 — Can it survive the "just-a-feature" counter-positioning? (the defensibility test)
Say the VC's objection out loud before they do (01 §3 counter-positioning): Gmail/Gemini,
Notion, Genspark, or post-Limitless Meta can bundle a good-enough version, *and they own the data
source you reach by fragile forwarding*. Pedro must have a genuine answer, not a hope. The tracks
supply three defensible ones — (a) confidence-tiered, human-gated knowledge as a first-class
primitive with no surveyed competitor precedent (01 §3.2); (b) the integration itself — agent
context spanning mail + graph + drive + canvas + teams — as the product, where each competitor is a
point solution (01 §3.4); (c) the SES-forwarding architecture as a *compliance moat* that sidesteps
Google's restricted-scope/CASA regime entirely (06 §4). If Pedro doesn't believe these hold, No.

### Q3 — Do you want the company, not just the artifact? (the commitment test)
Serious pursuit means accepting: founder-share vesting as the key-person backstop (07 §4d), a real
on-call obligation for other people's mail 24/7 (07 §2b — the ingest pipeline has ~60 silent-failure
sites), personal cross-border tax complexity (02 §2), and a multi-year seed→A gap (~616 days median,
03 §2). The solo-with-AI model genuinely covers product/QA/infra/design/security today (07 §1,
proven by the repo) — but "solo" stops the day outside users arrive (07 §1 ASSUMPTION). This is a
lifestyle question the tracks can't answer; Pedro must.

### Q4 — Is the network real capital, or just goodwill? (the unfair-advantage test)
Pedro's edge is not the code — it's being an ex-VC-firm sole engineer with warm VC/PE contacts, a
profile that reads as "technical founder who understands how funds think" and **skips exactly the
screening stage where the solo penalty is priced** (03 §1, §4). The test: are ≥3 of those contacts
willing to take an *advice-first* memo meeting (03 §4.1)? If yes, the fundraising path is real and
cheap. If the network is warm-but-not-that-warm, the plan doesn't break — it just means earning the
right through usage traction first (M2+) before any capital conversation.

### Q5 — Can the wedge be stated in one sentence a stranger repeats? (the focus test)
The scope is now genuinely huge (mail + graph + canvas + drive + spreadsheet + teams + inference +
desktops). At pre-seed that breadth **reads as unfocused** and is an active screening filter (01 §3
counter-positioning; 08 §1 "hostile to thin wrappers, filters on workflow depth"). The fundable
narrative must pick the email→knowledge-graph→canvas core and **park everything else as roadmap**
(01 §3; 03 §6). If Pedro can't bring himself to park the drive/inference/desktop story in a pitch,
that's a focus-risk No — not on the product, on the pitch.

**Decision rule:** Q1 is a hard gate answerable this week for ~$0 — **answer it first, before any
incorporation or conversation.** Q2/Q5 are about whether Pedro can tell the story; Q3/Q4 are about
whether he wants to and can fund it. A confident Yes on Q1+Q3 plus a credible Q4 is sufficient to
start the sequence in §3; Q2/Q5 are refined *during* the advice-first conversations, not before.

---

## 2. Positioning: the wedge, the ICP, the one-liner

Drawn from 01 §5 and 04, updated for what the product now *does* post-orchestrator.

**Sharpest wedge (pick this, park the rest):** *zero-ceremony capture.* Everyone else — Notion,
Obsidian, Heptabase, Mem — requires manual capture; polytoken's graph is fed by mail that arrives
anyway (~121 emails/day for the average office worker, 01 §3.1). Limitless tried zero-ceremony with
a $99 pendant and got acqui-hired; polytoken does it with an MX record. The email→knowledge-graph→
canvas loop is the whole pitch.

**ICP (beachhead):** the knowledge-heavy prosumer individual drowning in email who already pays for
a PKM/productivity tool (Notion/Obsidian/Heptabase/Tana price points cluster $8–16/mo — 01 §4). Not
teams, not enterprise — those are expansion. Start with a market of one (Pedro) and hand-recruit 10–
25 more like him (08 §2 M2). **Note:** teams/workspaces now *exists* in code (W5), but selling to
teams triggers SOC 2 pressure (06 §5) and a GTM motion that doesn't exist yet (07 §2c item 9) — keep
it as an expansion lever, not the beachhead.

**One-line pitch (from 01 §5, tightened):**
> polytoken turns the email you already receive into a private, visual knowledge graph you work on a
> canvas with an agent — it builds itself from your inbox and never promotes a fact you haven't
> confirmed.

**The two clauses that do the work:** "builds itself from your inbox" (vs. second-brain tools that
demand manual capture) and "never promotes a fact you haven't confirmed" (the trust-tier answer to
the #1 objection to AI-memory products — 01 §3.2). Both demo in ten seconds (08 §3 steps 1, 3).

**What the expanded feature set buys the pitch:** a *longer, more convincing live demo* (see §3),
not a broader positioning statement. Lead with the wedge; let the treemap/drive/teams/genui surfaces
be the "and it's already this deep" reveal, not the headline.

---

## 3. The sequenced plan — 0–3 / 3–6 / 6–12 months

The spine is track 08's milestone ladder (M0–M5), re-mapped against what the product now does and
interleaved with the incorporation timing (02) and the network conversations (03).

### Horizon A — 0–3 months: **become used, and be legally launch-able**
*Theme: convert artifact into evidence. Almost zero new feature work.*

1. **M0 — Founder-live (this week, $0 dev).** Run the MORNING-CHECKLIST runsheet: LIVE-03 real OAuth
   on prod → LIVE-04 real email through SES → CLUS-07 (08 §2 M0; STATE.md next-actions 3). Blocker:
   SES production-access approval still pending (STATE.md; 05 §2). **This is the single cheapest
   credibility fix that exists and it has been owed the entire time** — it is answer to decision Q1
   and the precondition for everything else. Nothing below matters until mail flows.
2. **M1 — Trustworthy ingest (1–2 weeks dev).** Surface the ~60 swallowed-failure sites, fix
   reprocess, and **extend the cost circuit breaker to the currently-unmetered ingest path** (08 §2
   M1; 05 §1c — the mail-bomb spend vector). This is simultaneously a reliability fix and the
   "we fail loudly and cap spend fail-closed everywhere" AI-cost-discipline answer investors probe
   (08 §1). It is also the only meaningful *engineering* on the whole critical path.
3. **Instrument before inviting anyone.** Wire the M2 funnel metrics (08 §4e/§4f): time-to-first-
   value (`forwarding_addresses.created_at → emails.received_at`), forwarding-setup conversion (the
   assumed cliff, 08 §2 M2), ingest pipeline-stage events. Add minimal privacy-consistent web
   analytics (self-hosted PostHog/Umami — 08 §4e). The `chat_cost_ledger` rollup is a query, not a
   project (05 §3.4; 08 §4a).
4. **Legal launch-blockers (external spend, not incorporation).** Before any non-friend user touches
   it: privacy policy + ToS with liability caps and honest email/LLM disclosures; a working
   end-to-end deletion path across S3 raw MIME + Postgres + derived indexes; the legitimate-interest
   assessment for third-party correspondents (serves LGPD *and* future GDPR from one artifact) (06
   §1, §"Priority order" 1; 02 §5). **These are launch blockers independent of incorporation** — the
   product reads other people's mail (02 TL;DR).
5. **Cost hygiene (1–2 days, do before any investor sees the bill).** Execute cost-structure scenario
   B: SNS→SQS + drop the ALB, Graviton, Secrets→SSM → ~$25–30/mo optimized baseline with better
   reliability, plus a Bedrock-only budget tripwire (05 §3.2–3.3). "We run the whole stack for ~$30/mo
   with fail-closed spend caps" is a strong solo-founder discipline signal and is verifiable from
   Terraform + the AWS bill.
6. **Trademark clearance ($0–hours).** Search "polytoken" in USPTO TESS / INPI / EUIPO before the name
   is locked by public launch; "token" is a crowded crypto-adjacent space (02 §4). Clearance only —
   don't file yet.

**Incorporation timing in Horizon A: NOT YET (default), with one trigger.** Incorporate when the
first *money* conversation turns concrete, not before — a Delaware C-corp costs ~$1.5–3.5k/yr more
than doing nothing and the standard docs are only worth having when there's a SAFE to sign (02 §1).
The one thing to do *now* regardless: get the IP-assignment chain-of-title questions answered (02
§3, §"Open questions" 2–3) — specifically whether any polytoken code flowed through magnitudetech
(would need a second entity assignment) and any prior-employer invention-assignment exposure from
the VC-firm engineering role. These are cheap now and expensive in diligence.

### Horizon B — 3–6 months: **prove retention, then incorporate into the first check**
*Theme: a design-partner cohort with a flattening curve; the advice-first conversations; incorporate
on the SAFE.*

7. **M2 — Design-partner cohort (weeks 3–8 of this horizon).** 10–25 hand-recruited outside users
   through the forwarding flow, funnel instrumented from step 3 (08 §2 M2). Measure the forwarding-
   setup cliff explicitly.
8. **M3 — Retention proof (weeks 8–16).** Week-4 cohort curve flattens (the "smile curve" seed
   investors look for — 08 §1, §2 M3); WAU cadence; the product-specific "aha" metric moves:
   **knowledge promotions per user** (suggest-only gate acceptances — the moment a user confirms the
   graph is right about their life). Targets are hypotheses, not promises (08 §2 M3).
9. **Advice-first conversations with the network (start once M2's first week-4 read exists — 08 §5).**
   Run 3–5 meetings framed explicitly as "pressure-test my memo" — *this research folder is that
   memo* (03 §4.1). **Never ask the same person for advice and money in the same meeting.** Ask them
   what *they* would need to see at seed for this product (feeds/validates the milestone
   definitions), and which funds carry an active "AI-leveraged solo founder" or "personal AI" thesis
   (03 §4.4). Handle the ex-employer question deliberately: secure either a check or an explicit,
   repeatable "we don't do pre-seed" narrative — a quiet pass reads badly (03 §4.3).
10. **The demo to walk them through (08 §3, now expanded).** The live 8–10 min arc — forward a real
    email with a PDF → watch it parse/OCR/extract/thread → entity resolution merging addresses → the
    trust ladder ("never promotes a fact I haven't confirmed") → canvas + grounded chat → **genui
    finale** → the discipline close (the `chat_cost_ledger` rollup for the demo session itself: "every
    token this demo burned is in this table; margin is instrumented, not estimated"). **What's new
    post-orchestrator:** the circle-pack treemap, the spreadsheet grid, drive versioning, and teams
    are now *built* — track 08 §3 said never to demo them because they were greenfield/unwired; they
    can now be part of the "and it's already this deep" reveal. **Still don't lead with them** (focus
    risk, decision Q5), and still don't demo distributed inference or live remote desktops (Phase-0
    scaffolding only — verify each is truly wired before showing it; the meta-audit's silent-failure
    lesson applies to demos too, 08 §3 failure-mode prep).
11. **M4 — Willingness to pay (parallel to M3).** 5–10 of the cohort convert at $20–25/mo (04 §1b).
    This is the unlock: it turns the network-angel conversation from faith into evidence (03 §6; 08
    §2 M4).
12. **Incorporate HERE — timed to the first check, not before.** Delaware C-corp via Stripe Atlas
    ($500) or Clerky ($425 + $99/yr; Clerky's Orrick docs handle SAFEs/option grants better — 02 §1).
    The formation packet carries the IP (Technology) Assignment + CIIAA that assign the pre-existing
    solo codebase into the corp as consideration for founder stock (02 §3) — **this is the
    diligence-critical step and the reason to have done the chain-of-title homework in Horizon A.**
    File the 83(b) defensively within 30 days (needs SSN/ITIN — start ITIN early, weeks of lead time,
    02 §2, §"Open questions" 4). Get the Brazilian tax-advisor sign-off *in writing* that a C-corp
    (not LLC) keeps Pedro outside Lei 14.754 automatic taxation (02 §2, §"Open questions" 1) **before**
    signing the first SAFE. First capital: prefer **network angels/operators, $150–400K on a post-money
    SAFE at a $7.5–10M cap** (03 §6; median caps 03 §2) — fast, light governance, no signaling risk; a
    priced-institutional pass at pre-seed creates negative signal, an angel SAFE does not (03 §4).

### Horizon C — 6–12 months: **pre-seed evidence pack, or skip toward seed**
*Theme: turn the cohort into a fundable evidence pack; make the first hire only when load forces it.*

13. **M5 — Pre-seed evidence pack (months 4–9 of the ladder).** 100+ users; retention curves by
    cohort; ledger-derived COGS/user vs price; organic-referral share (08 §2 M5). The one-page
    investor dashboard (08 §4) is all queries, no new infra beyond the two additions already required
    for reliability. Then institutional pre-seed ($500K–1.5M SAFE, ~$10–15M cap — 03 §2/§3) *or* skip
    toward seed if engagement is exceptional (AI-attached companies can command a 1.5–2× seed premium
    — 03 §2).
14. **First hire — only when real-user load forces it, not before.** Engineer #1 is a product/infra
    generalist who **shares the on-call pager** for the ingest pipeline (07 §2b, §6). Trigger: ≥100
    real users or the first paid cohort, whichever first (07 §2b). Target ~2.0% equity on 4-yr/1-yr
    vest; if hiring into Brazil from the Delaware entity, use an **EOR** ($400–999/mo) — do **not** put
    a full-time, exclusive, on-call engineer on PJ (misclassification reclassifies retroactively with
    back FGTS/INSS/penalties — 07 §3c). Everything else — compliance ops, design polish, GTM — stays
    fractional/contract until seed (07 §6).
15. **Compliance, staged with revenue (06 §"Priority order").** At first Brazilian users: ANPD SCCs
    for the Brazil→US transfer (the grace period already ended 2025-08-23 — transfers without a valid
    mechanism are unlawful now — 06 §1) + a public data-subject contact channel. At first paid storage
    tier: tech E&O/cyber insurance + documented restore drills + explicit version-retention windows
    in product and ToS (06 §6). SOC 2 waits for the first enterprise/team-sales conversation (06 §5) —
    do the near-free posture work now (SSO+MFA, CloudTrail, DPAs, IR one-pager) so it's later a 6–12
    week sprint, not a rewrite.

---

## 4. Cost & runway reality — and the fund-vs-bootstrap call

**What solo operation costs today (05 §1, §3):**
- As-deployed infra burn: **~$50–60/mo** (~$660/yr) — coffee-budget scale, but over its own $30 AWS
  budget alert (alert fatigue on the one guardrail — fix it, 05 §3.3).
- Optimized (scenario B): **~$25–30/mo**. Do this before investor conversations (05 §3.2).
- Commercial-ready, 0–10 users (scenario C): **~$90–130/mo** — adds Supabase Pro + Vercel Pro + light
  LLM spend. This is the "credible demo product" tier and it is still trivially self-fundable.
- **The burn is not the problem; the LLM margin model and the uncapped ingest path are** (05 §3.1).
  What a VC probes is COGS/user trajectory and what enforces it — the answer is the ledger + circuit
  breaker, *extended to ingest* (which is M1). COGS/user converges to ≈ LLM spend (~$6) once fixed
  costs amortize (05 §2) — this is an inference-margin business, which is why the $0 local/browser
  inference tiers matter strategically, not just technically (04 §0–1).

**The burn if he takes it seriously** — the real number is **founder runway, not infra** (05 §3 is
explicit: infra tables exclude founder compensation, and nothing here should be quoted to investors
as "total burn" without it). Infra stays sub-$1k/mo well past 100 users (scenario D ~$660/mo, break-
even at ~30 Pro subscribers — 05 §3). The scarce resource is Pedro's months. Which frames the call:

**Fund vs bootstrap (03 §1, §3, §6; 07 §6):**
- **Bootstrap through M0–M4 is not just possible, it's the recommended default.** 0 employees through
  pre-seed close is defensible and increasingly normal (07 §6); the whole M0–M4 ladder requires no
  capital, only Pedro's time and <$150/mo (05 §3, scenario C; 08 §5). Raising before there's usage
  evidence means raising at faith-stage caps and taking dilution the traction would have saved.
- **Raise when it buys leverage or de-risks a genuine constraint**, not to fund infra. The two honest
  reasons to raise: (a) to convert Pedro's *time* — a network angel SAFE that lets him go full-time
  through the seed-gated 616-day gap (03 §2); (b) to fund the first on-call hire once ingest load
  makes the solo pager untenable (07 §2b). Both are Horizon B/C triggers, not now.
- **Dilution math favors patience** (03 §3): a solo founder stacking angel ($500K@$7.5M = 6.7%) +
  pre-seed ($1M@$10M = 10%) + seed (~$3M@$16M ≈ 15.8%) still holds ~65–70% before Series A. Solo
  founding materially softens lifetime dilution — every month of traction before the first check
  compounds into a higher cap and less dilution. **The optimal move is to raise late and warm, on
  evidence, from the network — not early and on faith.**

---

## 5. What to NOT do yet (the trap list)

Each of these is a real, cited temptation the tracks warn against:

1. **Don't incorporate before the first money conversation is concrete.** A C-corp is ~$1.5–3.5k/yr of
   overhead whose standard docs only pay off when there's a SAFE to sign (02 §1). Incorporating "to
   feel serious" burns cash and starts franchise-tax/Form-5472 clocks (02 §1) for nothing. *But* do
   the IP chain-of-title homework now (02 §3) — that's the cheap part that's expensive later.
2. **Don't build any more features before M0.** The orchestrator just shipped six waves; the product
   is feature-saturated and usage-empty. Nothing in M0–M4 requires building any wishlist feature —
   fundability runs entirely on what exists (08 §2 sequencing note, §5). More treemap/drive/inference
   polish is motion, not progress, until real mail flows.
3. **Don't pitch the whole scope.** Drive + remote desktop + distributed inference + spreadsheet +
   teams reads as unfocused at pre-seed and trips the thin-wrapper/focus filter (01 §3; 08 §1). Pick
   email→graph→canvas; park the rest as one roadmap slide (03 §6).
4. **Don't demo what isn't truly wired.** Distributed inference is Phase-0 scaffolding
   (`execution_locus` reserves `remote-peer`) and remote desktops are fail-closed with no live provider
   (08 §3 "never demo"). Verify each surface end-to-end before it enters a demo — a silent failure
   mid-pitch is the worst version of the exact bug class the meta-audit flags (08 §3 failure-mode prep).
5. **Don't build the open compute-credit marketplace (C2).** It's effectively a second company —
   two-sided market cold-start, verifiable-computation, and a *privacy contradiction* with polytoken's
   own values (routing email-derived prompts to a stranger's GPU — 04 §3c). Ship own-fleet pooling
   (C1, $0 COGS, pure feature) and treat C2 as explicitly-deferred optionality with named gates (04
   §3d). Investors respect a deferred two-sided market far more than a hand-waved one.
6. **Don't hire ahead of load.** Stay at zero employees through the live-loop close and first cohort
   (07 §6). The first hire is triggered by real-user on-call load, not by fundraising or ambition
   (07 §2b). Never staff ahead of the expansion products — each carries its own hires and none is on
   the fundable critical path (07 §6).
7. **Don't sell storage as storage, ever.** Google sells 2TB at $0.005/GB — below polytoken's
   wholesale COGS. The drive is defensible only as "storage the agent can see," bundled in the Power
   tier; a standalone $/GB SKU loses on arithmetic (04 §2c).
8. **Don't let credits become cash-redeemable.** Closed-loop earn-in/spend-in-product credits are
   loyalty-point-like (low risk); the moment they're redeemable for cash, money-transmission rules can
   attach (04 §3c item 5). Keep them non-cashout.
9. **Don't court EU users yet.** GDPR attaches on EU-targeted marketing/EUR pricing/EU-language support
   — so *deliberately defer* EU go-to-market and say so in the ToS until compliance budget exists (06
   §2). Avoid triggering the EU-representative + DPA/SCC pack prematurely.
10. **Don't adopt the Gmail API to smooth onboarding.** The SES-forwarding architecture avoids Google's
    entire restricted-scope/CASA regime (annual third-party assessment, hard ban on training generalized
    models on Gmail data) — that's an architectural *moat*, not just a shortcut (06 §4). Preserve it as
    the default; treat Gmail API as an optional premium integration with its own compliance budget.
11. **Don't quote froth-era comps as entitlements.** Limitless's $350M-at-$707K-ARR (2023) won't repeat
    (03 §6); Fyxer/Genspark are aspiration anchors, not what polytoken can price at today (01 §5). And
    before any live conversation, pull the *current* quarter's Carta data directly — blog aggregations
    drift (03 §2 caution).

---

## 6. Open questions only Pedro can answer

These gate real decisions and no amount of research resolves them:

1. **Q1 itself — will you live in it daily?** Run M0 and find out. This is the whole decision in
   miniature (§1 Q1; 08 §2 M0).
2. **Is magnitudetech a legal entity (PJ/LTDA), and did any polytoken code flow through it?** Determines
   whether a *second* IP assignment is needed and whether PJ-invoicing is the pay path — the single
   highest-value question for the Brazilian accountant (02 §2, §3, §"Open questions" 2).
3. **Any prior-employer invention-assignment exposure** from the VC-firm engineering role that could
   reach side projects? Cheap to clear now, a diligence-killer later (02 §3, §"Open questions" 3).
4. **Is the VC/PE network warm enough for advice-first meetings, and is the ex-employer a natural first
   check or a conflict to manage?** Decide the ex-employer posture *before* pitching the broader network
   (03 §4.3, §4.5). The `kaszek-os-dev` reference in the repo hints the relationship may reach a top-tier
   LatAm fund — if so, confirm and handle IP-adjacency cleanly before pitching it (03 §4.5).
5. **US/global-first or Brazil-first user base?** Decides straight Delaware C-corp vs the "Delaware
   Tostada" and which funds fit (03 §5; 02 §1) — decide with counsel *before* the first SAFE, because
   repapering after checks is expensive.
6. **Personal runway:** how many months can Pedro self-fund full-time before a raise is a constraint,
   not a choice? Infra is trivial (05 §3); founder time is the real burn and only Pedro holds that
   number — it sets the entire raise-timing decision (§4).
7. **Do you want the company, or the artifact?** (§1 Q3) Founder vesting, 24/7 on-call for other
   people's mail, and multi-year commitment are the price; the research can't decide it.

---

## 7. The core recommendation, in four lines

1. **Stop building. Run M0 this week** — real sign-in, real mail, become your own daily-active user;
   it's the cheapest credibility fix and the entire wedge is unfalsifiable without it (08 §2 M0).
2. **Bootstrap the M0→M4 ladder** (founder-live → trustworthy ingest → 10–25 design partners →
   retention curve → first paid users) on <$150/mo and no employees — no capital is on the critical
   path (05 §3; 07 §6; 08 §5).
3. **Incorporate late, timed to the first check** — Delaware C-corp with the IP assignment, on a
   network-angel SAFE ($150–400K, $7.5–10M cap) once a cohort retains, not before (02 §1; 03 §6).
4. **Pitch one wedge** — "your inbox becomes a knowledge graph you never have to trust blindly" — and
   park drive/inference/desktops/teams as roadmap; the expanded feature set makes a deeper *demo*, not
   a broader *story* (01 §3–5; 03 §6).
</content>
</invoke>
