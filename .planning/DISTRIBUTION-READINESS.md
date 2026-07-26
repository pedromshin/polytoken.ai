# Distribution-Readiness Plan — polytoken

Written 2026-07-26. The bar this plan clears: **a stranger who is not Pedro can discover the app,
sign up with their own Google account, forward real mail, have it ingested safely (bounded cost,
loud failure), use the canvas, pay for it, and Pedro is legally allowed to hold their data.**

Grounding: strategy from `.planning/research/business/09-bootstrapped-owner-operator.md` (the
owner-operator track — premium niche, profitable from customer #1, no VC machinery). Every gap below
is verified against the live tree on 2026-07-26, not assumed.

This doc is organized by **who can do it**, because that's the actual constraint. Pedro has been
building this entire week from Claude Code **mobile** — so the plan separates what Claude can build
and ship autonomously from mobile (`[CLAUDE]`) from what is physically gated on Pedro at a real
computer / a console / a legal decision (`[PEDRO]`). The `[PEDRO]` items are collected into the
"only-you" checklist at the bottom.

---

## Where we actually are (verified 2026-07-26)

**Shipped & live:** the canvas (~24 node types), the summon loop (build-a-tool + intent prompt +
tools picker), the code-islands data channel + node + `codeIslands.*` router, `code_islands` table
applied to prod (0055 + RLS). The product *works* for Pedro's own account.

**The distance to a paying stranger — 4 gaps, each verified:**
1. **Ingest cost is uncapped.** `cost_circuit_breaker.py` is wired into the *chat* path only
   (`run_chat_turn.py`, `prompt_assembly.py`). `ingest_inbound_email.py` never calls it → a
   mail-blast is unbounded LLM spend. (track 09 §5.1)
2. **Ingest fails silently.** 10 `except Exception` sites in `ingest_inbound_email.py` (≈60 across
   the pipeline) → mail can be "received, never analyzed," no alarm. (track 09 §5.2)
3. **No legal surface.** No `privacy` / `terms` / `legal` route exists in `apps/web`. Reading other
   people's mail with no privacy policy is non-compliant on day one. (track 09 §8)
4. **No way to pay.** No Stripe/Paddle/Lemon Squeezy integration anywhere. There is no checkout,
   no tier, no trial. (track 09 §3)

Plus two standing facts that gate *any* outside user: **SES is in sandbox** (outbound only to
verified identities, inbound needs scale approval), and **G1 is unanswered** — Pedro has never run
the live loop (real OAuth + real forwarded mail) on the deployed app.

---

## The plan, sequenced by dependency

Four phases. Phase 0 is entirely Claude-buildable from mobile and ships behind flags (zero runtime
change until Pedro flips them), so it can proceed now without waiting. Phases 1–3 interleave the
`[PEDRO]` gates. Nothing in a later phase should go live before its Phase-0 code exists.

### Phase 0 — Safety + rails, built dark (Claude, from mobile, ships to main behind flags)

These are the code halves of the existential fixes and the paid/legal/instrumentation surfaces. All
additive, all flag-gated or unreachable-until-linked, so each ships green without changing live
behavior. **This is the immediate work queue.**

- **A1 `[CLAUDE]` — Cap the ingest path.** Extend the cost circuit breaker to the ingest pipeline: a
  per-user *daily ingest* cost cap (mirror the chat `$0.50/turn … $5/day` shape), config-driven so
  tiers map onto it later (C2). Flag `INGEST_COST_CAP_ENABLED` default OFF. Full pytest + mypy +
  lint-imports; listener redeploy is a no-op while OFF. *This is the single most important pre-launch
  engineering task (track 09 §5.1, = VC-roadmap M1).*
- **A2 `[CLAUDE]` — Make ingest fail loudly.** Replace the silent `except Exception` swallows with a
  dead-letter row + a structured `ingest_failed` signal + a reprocess path; emit an alert event
  Pedro can route to his phone. The durable graphile-worker runtime (Track 3a, already built on the
  feature branch) is the proper home for the retry/DLQ — wire A2 to it. Flag-gated so the live
  receiver's behavior is unchanged until turned on.
- **B1 `[CLAUDE]` — Privacy policy + ToS pages.** Static `/legal/privacy` and `/legal/terms` routes
  in `apps/web`: honest disclosure of email + LLM processing, a fees-paid liability cap, a named
  data-subject contact, "no EU go-to-market yet." Draft is Claude's; **legal review is Pedro's**
  (this is not legal advice). Linked from footer + signup.
- **B2 `[CLAUDE]` — Deletion path audit + endpoint.** Verify and, if missing, build account-deletion
  across S3 raw MIME + Postgres rows + derived embeddings (LGPD/GDPR/CCPA all require it; deletion
  semantics are currently unverified). Ship a self-serve "delete my data" action.
- **C1 `[CLAUDE]` — Checkout scaffolding (Merchant-of-Record).** Integrate a MoR processor
  (Paddle or Lemon Squeezy — MoR handles global sales-tax/VAT so a solo BR operator doesn't).
  14-day trial → paid; `$25–30` main tier + `$50` power tier (track 09 §3). Build the webhook →
  entitlement → tier-gating plumbing behind `BILLING_ENABLED` OFF. **Account creation + bank/tax
  is Pedro's** (C1-P below).
- **C2 `[CLAUDE]` — Tier → circuit-breaker config.** Map each tier 1:1 onto the cost-cap config
  (chat + the new ingest cap), so worst-case COGS/user is a product-enforced ceiling per tier.
- **F1 `[CLAUDE]` — Funnel instrumentation.** Time-to-first-value, the forwarding-setup conversion
  step (the #1 funnel cliff, track 09 §7), ingest events, and a `chat_cost_ledger` rollup — into a
  self-hosted analytics sink (PostHog/Umami). You cannot fix a funnel you can't see.
- **G-fix `[CLAUDE]` — Clear visual-verification debt where possible.** The summon loop / intent
  dialog / tools picker passed jsdom + build but never the real geometry/screenshot gates. Claude
  can tighten the components, but the actual pixel sign-off needs a running stack → `[PEDRO]` (G
  below).

### Phase 1 — Become used: the live loop (Pedro, ~1 hour, gates everything)

- **D1 `[PEDRO]`** Sign in on the deployed app with real Google OAuth (LIVE-03).
- **D2 `[PEDRO]`** Forward real mail and watch it ingest end-to-end (LIVE-04, CLUS-07).
- **D3 `[PEDRO]`** Request SES production access from AWS (unblocks any outside user; sandbox today).

G1 ("will you use it daily?") is answerable this week for ~$0 once D1–D2 run. Until this happens,
nothing built counts as "usable."

### Phase 2 — Legal + money go live (Pedro decisions + accounts, on top of Phase-0 code)

- **B1-P `[PEDRO]`** Legal review of the privacy policy + ToS draft (or a contractor — LGPD artifact
  drafting is a bounded contractor task, track 09 §6).
- **B3 `[PEDRO]`** LGPD data-subject contact channel published + **ANPD Standard Contractual Clauses**
  in the approved form (the grace period ended 2025-08-23 — overdue the moment a Brazilian user's
  mail flows; track 09 §8.3).
- **B4 `[PEDRO]`** Documented legitimate-interest assessment for third-party correspondents in
  ingested mail (one artifact serves LGPD + future GDPR).
- **Entity `[PEDRO]`** The single highest-value question: confirm the Brazilian entity structure +
  international-billing mechanics with a BR accountant **before** taking real revenue (track 09 §8).
  No Delaware C-corp.
- **C1-P `[PEDRO]`** Create the Merchant-of-Record account (Paddle/Lemon Squeezy), connect bank +
  tax, set the tier prices, then flip `BILLING_ENABLED`.

### Phase 3 — Distribution + first payers (Pedro-led, ongoing)

- Record the ten-second wedge demo once (forward an email w/ PDF → parse/OCR/extract/thread → trust
  ladder → canvas + grounded chat → build a code-island tool from it). This *is* the marketing asset
  (track 09 §7).
- Hand-recruit 10–25 email-drowning prosumers; obsess over the forwarding-setup cliff (F1 shows
  where they drop). Then widen via build-in-public.
- First **paid** customers = the real validation. Watch churn + support load per customer, not signup
  count. Ratchet toward ~250–535 payers for a $3–5k/mo draw (track 09 §2).
- Hire only from revenue, on-call relief first, contractor-first (track 09 §6).

---

## Infra hygiene & guardrails (mixed; the `[PEDRO]` half is on the tomorrow-list)

- **E1 `[PEDRO]`** AWS budget **hard-cap** + Bedrock spend tripwire (belt to A1's per-user cap —
  A1 bounds one user, E1 bounds the whole account). AWS console.
- **E2 `[CLAUDE]`/`[PEDRO]`** Cost hygiene (track 09 §9.3, 05 scenario B): SNS→SQS, drop the ALB,
  Graviton, Secrets→SSM → ~$25–30/mo baseline. Claude can prep the Terraform; **apply is Pedro-only**
  (no remote state / no TF creds in-container — CLAUDE.md landmine).
- **E3 `[PEDRO]`** Rotate the `sbp_` Supabase Management API token + the `vcp_` Vercel token pasted
  in chat this week (stated intent: rotate EOD tomorrow). Do it.
- **E4 `[PEDRO]`** Create the 3 missing GitHub secrets `PROD_POSTGRES_URL_NON_POOLING`,
  `PROD_POSTGRES_URL`, `PROD_SUPABASE_URL` (repo or `production` env) to restore the CI migrate path;
  until then prod DB changes go via the Management API by hand.
- **E5 `[PEDRO]`** Apply deferred migrations **0053 + 0054** (durable-worker rollout) via the
  Management API *when the graphile-worker schema is provisioned* (`apps/worker install-schema`
  against real PG) — not from the sandbox.
- **E6 `[PEDRO]`** Terraform remote state + import all 46 live resources before any `apply`
  (CLAUDE.md landmine; runbook at `infrastructure/aws/REMOTE-STATE-RUNBOOK.md`). Not urgent for
  launch but required before any infra change.

---

## THE ONLY-YOU LIST — what Pedro must do at a real computer (nothing else can do these)

Ordered by leverage. Items 1–3 unblock everything; 4–6 are launch-gating; 7–10 are guardrails/legal.

1. **Run the live loop (~1h, do this first).** Sign in on the deployed app with your real Google
   account; forward one real email with an attachment; confirm it parses/extracts end-to-end. This
   answers G1 and is the cheapest credibility fix there is. *(D1, D2)*
2. **Request SES production access** from AWS (support case). Sandbox blocks every outside user;
   the request takes days to approve, so file it early. *(D3)*
3. **Rotate the two leaked tokens** — the `sbp_` Supabase + `vcp_` Vercel tokens from this week.
   *(E3)*
4. **Set an AWS budget hard-cap + Bedrock tripwire** in the console. This is your account-level
   backstop while Claude ships the per-user ingest cap. *(E1)*
5. **Create the Merchant-of-Record account** (Paddle or Lemon Squeezy), connect bank + tax, set the
   $25–30 and $50 tier prices. Claude builds the integration; only you can open the billing account.
   *(C1-P)*
6. **Book the Brazilian accountant call** — confirm entity (LTDA/MEI/existing magnitudetech PJ?) +
   how to bill international customers, **before** any real revenue. Highest-value single question in
   the whole plan. *(Entity)*
7. **Legal review** of the privacy policy + ToS draft Claude will ship (you or a contractor). *(B1-P)*
8. **LGPD: publish the data-subject contact channel + put ANPD SCCs in place** (already overdue the
   moment a Brazilian user's mail flows). *(B3)*
9. **Create the 3 `PROD_*` GitHub secrets** to restore CI migrations. *(E4)*
10. **Visual sign-off pass** on the deployed canvas (summon loop → Add-node → Build-a-tool → intent
    dialog → tools picker; and the Landscape treemap) — jsdom does no layout, so these have never had
    a human's eyes. Needs a running :3000 + seeded auth, i.e. your machine. *(G)*

Everything not on this list, Claude builds and ships from mobile — starting with A1 (cap ingest),
A2 (loud failure), B1 (legal pages), then C1/B2/F1.
