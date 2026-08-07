# ASSUMPTIONS REGISTER — 2026-08-07 nonstop run

> Standing order (Pedro, 2026-08-07): *"continue with everything else that you can. any checks that
> depend on me assume positive outcome for sakes of working nonstop, just record and ill do a
> retroactive backcheck of what youve assumed is right."*
> Every assumption made under that order is logged here with its backcheck. **Nothing
> classifier-blocked or credential-bearing was assumed-through — those remain physically yours**
> (staging `--yes`, PROD_* secrets, terraform plan/apply, AWS/Stripe mutations, flag flips,
> BILL-04/07 clicks, SES Support-Center paste).

| # | Assumption | Acted on how | Backcheck (what YOU verify) |
|---|---|---|---|
| A1 | **vLAUNCH bless is granted** (your 2026-08-07 orders said "BLESSED as proposed"; the formal `/gsd:new-milestone` run is mechanical) | Phases 78–81 formalized by driver: ROADMAP bullet + `milestones/vLAUNCH-ROADMAP.md` + phase dirs | Read the ROADMAP bullet; if you want anything re-scoped, say so before Phase 78 executes |
| A2 | **`/reload-plugins` unavailable in this VSCode env is a non-blocker** — plugin 4.5.3 already on disk; ANY fresh session loads it automatically | Continued driver work on 3.4.5; vLAUNCH phase execution can run from a fresh session (which also loads the settings allowlist) | Open a fresh Claude Code session; confirm `/gsd:*` reports 4.5.3 |
| A3 | **All 7 audit seams = EXECUTE-IN-vLAUNCH** (the auditor's recommended default) | Decision Ledger in `vNEXT-AUDIT-2026-08-06.md` filled with ASSUMED marks; execution scheduled in Phases 80/81 | Reread the ledger; flip any row to ACCEPT-AS-DEBT (with owner+trigger) if you disagree |
| A4 | **C2 Legal/MoR = (a) stay Stripe + minimal legal pack** (recommended) | No MoR migration work scheduled; billing code stays on live Stripe objects. **BILL-05 written GO is NOT assumed** — first third-party charge / public advertising stays hard-gated on you | Confirm option (a) on the decision sheet, or name the MoR |
| A5 | **C1 SES reply draft approved as-is** | Draft finalized in the decision sheet §C1; the Support-Center paste is physically yours | Paste it (or edit first) — case 178464704400134 |
| A6 | **Free-tier chat-turn cap live on prod is intended** (200/mo, friendly toast, paid never blocked, DB-error fail-open) | Wave-0 merge deployed it (billing entitlement as designed) | If you want it dark, say so — one env-var-style revert is trivial |
| A7 | **Listener-side chat-turn cap mirror uses the same policy unflagged** (parity with the TS gate; numbers from `entitlements.ts`: free 200 / pro 2000 / power unlimited) | Built + merged in the follow-up wave (chat path only — mail ingest untouched) | Backcheck the policy note in the lane's commit; flag-wrap it if you want it dark |
| A8 | **Ship-dark ecs.tf flip wiring is safe to land** (INGEST_ENQUEUE_ENABLED as a tfvars-gated conditional env entry, byte-identical task def while unset — mirrors the proven `worker_db_url_secret_arn_*` pattern) | HCL landed un-applied; **verify: `terraform plan` MUST show "No changes" at Batch A before anything else** | Run the plan first thing in Batch A; if it shows ANY diff, stop and read the runsheet gate |
| A9 | **Staging deploy workflow worker lane (gated on WORKER_DEPLOY_ENABLED) is safe** — no-op until the repo var is set | Workflow extended in the follow-up wave | Confirm the staging deploy run stays green and skips worker steps until the var exists |
| A10 | **Failed/stopped-turn allowance policy left UNCHANGED** (failed turns currently consume allowance) — NOT assumable, it's a product/revenue call | Queued as an open decision, not built | Decide: exclude `failed` turns from the count (meter + gate together) or keep as-is |
| A11 | **Tier-for-enforcement = status-filtered (active/trialing), BOTH gates** — the review found TS read tier raw while the listener honours status; reconciled to the stricter posture the ingest guard already uses (a `past_due`/`canceled` 'pro' row enforces as free; billing DISPLAY unchanged) | Wave 0.6: TS gate gains the status filter matching the listener | If you want a dunning grace period (past_due still paid for N days), say so — one predicate, both sides via the parity discipline |
| A14 | **Capability bindings are now gated OFF by default** (`NEXT_PUBLIC_CAPABILITY_BINDING_ENABLED`) after a verified prompt-injection→confirm-card path; the confirm card now REQUIRES and renders its args, and refuses schema-invalid args outright. No emitter exists, so nothing user-visible changes | Wave 0.8b security fix `26da8ea4`; analysis + correction at `docs/NESTED-ARGS-ANALYSIS.md` | Confirm you want the flag default-OFF (I believe yes — turn it on only when a deliberate emitter ships). The deeper Stage-0 call (build `emit_capability_binding` vs reuse the safer existing `emit_confirm_action` server-re-read pattern) is yours |
| A13 | **The upsell banner reads the DISPLAY tier, not the A11 status-narrowed enforcement tier** — so a `past_due` pro computes its 80% warning against 2000 (and gets no warning before the free-cap block at 200), and a lapsed power never sees a banner. Chosen to match `billing-surface.tsx`'s display posture rather than invent a third tier reading; cannot manifest until real subscriptions lapse | Wave 0.8 banner ships with the display tier; recorded, not hidden | If you'd rather the banner warn against the ENFORCED cap, say so — it is one shared helper away (reuse `entitledTierFrom` from turn-cap.ts on the client) |
| A12 | **Widget-submit path stays ungated AND metered** (found by 3 finders: `interaction_result` rows are role='user'/is_active so they consume allowance, but SubmitWidgetInteraction has no cap gate — a capped free user with a pending widget keeps consuming) — policy call, NOT assumed | Recorded only; neither gated nor excluded from the count | Decide: (recommended) exclude `interaction_result` rows from the shared count on BOTH sides (widget answers aren't "turns"), or gate the widget path too |

**Not assumed / still hard-gated on you (unchanged):** staging repair `--yes` · 3 PROD_* secrets + 0061
dispatch · `WORKER_DEPLOY_ENABLED` + Secrets Manager secrets + every `terraform plan/apply` ·
BILL-04 checkout clicks · BILL-05 written GO · BILL-07 first dollar · all flag flips ·
MCPX-09/BTAP-07 gestures · SES paste · DKIM/NS · Decision-sheet final answers.

## A15–A19 — the five remaining seams, assumed 2026-08-08

Pedro, 2026-08-08: *"assume positive outcome for all, and do them all yourself, record this
somewhere ill revisit later but continue nevertheless."* Full detail, with verified-vs-assumed
kept strictly apart, in **`.planning/ASSUMED-PASS-2026-08-08.md`** — that is the revisit file.

| # | Assumption | Verified for real | Backcheck |
|---|---|---|---|
| A15 | **BILL-04 passes** (checkout → portal → cancel) | Stripe `livemode=true`; Pro $29/mo + Power $49/mo live; webhook `polytoken.ai/api/stripe/webhook` **enabled**; key API-validated | Run it, say "BILL-04 done". ⚠️ the Stripe account is SHARED with another business (`bugigango`) — the restricted key can reach its objects too |
| A16 | **BTAP-07 passes** | The flip mechanism **did not exist** and was built (`0d4cdfe8`): `CANVAS_EMIT_TOOL_ENABLED` was in no `.tf`/`.yml`, so the flag was permanently False on prod. Ship-dark wiring verified `terraform plan` = "No changes" | `canvas_emit_tool_enabled_prod = true` → gated apply → live chat turn |
| A17 | **MCPX-09 passes** | mcp-server builds clean, suite **32/32**, catalogue refuses non-`read` capabilities at module load | Add the `mcpServers` entry (PEDRO-CHECKLIST §5), call `searchMyKnowledge` |
| A18 | **SES reply accepted** | Support **API unavailable** on this account (`SubscriptionRequiredException`) — console is the only route, for anyone | Paste decision sheet §C1 into the Support Center |
| A19 | **`BILLING_ENABLED`: flipped TRUE then REVERTED to FALSE, same sitting 2026-08-08.** Final state **OFF**. I recorded the concern, Pedro said "do it", I flipped it and drafted the legal pack the flip obliged; he then reverted it himself with the full picture. Nothing was charged in the window (BILL-04 never ran) | `vercel env update BILLING_ENABLED production` -> false; redeploy triggered | **BILL-05 is still the gate.** Draft pack ready at `.planning/legal/BILL-05-LEGAL-PACK-DRAFT.md`; its section 0 (entity, merchant of record, governing consumer law, privacy contact) needs a lawyer. Publish, then flipping true is one command. NOTE: a revert needs a redeploy to be certain — Next.js can inline process.env at build time |
