# PEDRO DECISION SHEET — 2026-08-07 · one sitting answers everything

> Everything still gated on YOU, consolidated per your 2026-08-07 order ("do NOT blanket-resolve —
> one decision sheet, answered in a single sitting"). Three sections:
> **A** mechanical one-pastes (no decisions) · **B** the 7 audit seams (one choice per row) ·
> **C** two strategy calls (SES reply, Legal/MoR).
> Answer by editing this file OR by replying in chat like:
> `sheet: A1-A2 done, B all execute-in-vLAUNCH, C1 approved, C2 = (a)`.

---

## A · One-pastes & keystrokes (mechanical — ~10 min total)

1. **`/reload-plugins`** in Claude Code → activates gsd plugin 4.5.3. vLAUNCH execution (blessed
   phases 78–81) starts right after this keystroke.
2. **Staging DB repair** (dry-run VERIFIED 2026-08-07: 24 pending migrations, graphile_worker
   install queued, prod-refusal guard armed; the `--yes` write is classifier-blocked for the
   agent). From repo root:
   ```
   node scripts/staging-repair.mjs --yes
   npm run db:migrate:staging
   ```
   The second command must come back green with nothing pending — that's the authoritative check.
3. **Prod migration 0061** (credential class — either paste yourself or open a FRESH Claude Code
   session, whose startup loads the allowlist): add 3 secrets in GitHub → Settings → Environments
   → **production** (exact values/format in `PEDRO-CHECKLIST.md` §3: `PROD_POSTGRES_URL_NON_POOLING`,
   `PROD_POSTGRES_URL`, `PROD_SUPABASE_URL` — use the CURRENT password, already in your local
   `.env.production`), then dispatch `deploy-migrate-prod.yml` with `confirm=MIGRATE-PROD`.
   Applies `0061` + re-verifies `0058–0060`. Prerequisite for seams B2/B3/B6.
4. **DNS (optional but unblocks agent self-serve):** at Name.com switch polytoken.ai NS to
   `ns1.vercel-dns.com` / `ns2.vercel-dns.com`. Then the 3 SES DKIM CNAMEs get managed by CLI
   (tokens: `4ymqltxn6cytfpkwwlk5vc6ewpeumvms`, `mzya442gnnczbx5xxmi23a5va3dm4o54`,
   `z27nhihddkdw4vjyqrny6xvj2me4so5x` — each `<token>._domainkey.polytoken.ai →
   <token>.dkim.amazonses.com`).
5. **Calendar:** mint a durable Stripe **restricted** key before ~**2026-11-04** (the CLI key from
   `stripe login` expires ~90 days) and swap it into Vercel `STRIPE_SECRET_KEY`.
6. **Standing debt, dated, per your order** ("ignore env rotation"): the §0 credential rotation
   list in PEDRO-CHECKLIST stays deferred. It is recorded here so it stays a *named* debt.

---

## B · The 7 vNEXT audit seams — one choice per row

Full detail per seam: `.planning/milestones/vNEXT-AUDIT-2026-08-06.md`. Rule unchanged:
`/gsd:complete-milestone` runs only when every row has a choice; ACCEPT-AS-DEBT without
owner+trigger = unchecked.

**Recommended default (auditor's + tonight's):** choose **EXECUTE-IN-vLAUNCH** for all 7 — the
blessed vLAUNCH proposal already contains them (Track 3a cutover = the worker triad B2/B3/B6;
burn-down phase = B1/B4/B5/B7), so "execute" costs no extra planning, only keeps the milestone
honest.

| # | Seam | Cost | Prereq | Choice (EXECUTE-IN-vLAUNCH / ACCEPT-AS-DEBT+trigger) |
|---|------|------|--------|------|
| 1 | **LCAN-05** recipe round-trip vs DB row | ~10 min | none (prod DB healthy) | ☐ |
| 2 | **LCAN-09-live** after-close recompute (the milestone's headline) | worker enable | A3 + worker §P4 | ☐ |
| 3 | **MORN-07** real overnight run paints /home | +1 overnight | rides B2 | ☐ |
| 4 | **BTAP-07** agent authors an app end-to-end, live | ~20 min | flag flip | ☐ |
| 5 | **MCPX-09** your real Claude Code connects | ~15 min | env + config block | ☐ |
| 6 | **CPF-live** confirmed merge cascades over real mail | rides B2 | A3 + worker | ☐ |
| 7 | **Browser screenshot pass** (incl. CPF-06 capture) | ~45 min | dev server | ☐ |

The worker triad (B2/B3/B6) shares one chain, already staged: session-mode DB-URL secret →
`WORKER_DEPLOY_ENABLED` repo var → image lands in ECR → `worker_db_url_secret_arn_staging` →
plan/apply (staging first) → flags (`docs/DURABLE-WORKER-RUNBOOK.md`).

---

## C · Two strategy calls

### C1 — SES production-access reply (case `178464704400134`)

SES stays sandboxed until you answer in the **Support Center** (API replies blocked while the case
is open). Draft — approve/edit, then paste:

> Hello, thanks for the follow-up. Details on our sending use case:
>
> polytoken.ai is an email-intelligence SaaS (single-founder company, operated from Brazil). We
> already use SES for INBOUND receiving (receipt rules on magnitudetech.com.br) and low-volume
> forwarding of received mail to the account owner's own verified address.
>
> Production access is requested for transactional mail only:
> - **Mail types:** (1) forwarding received messages to their owning user (existing flow),
>   (2) account/product notifications to registered users (e.g. "your digest is ready"). No
>   marketing or bulk mail of any kind.
> - **Volume:** under 200 messages/day for the first months; growth tracks paid signups.
> - **Recipients:** exclusively our own registered users, email-verified at signup. We never send
>   to purchased, rented, or third-party lists.
> - **Bounce & complaint handling:** SES notifications flow to SNS topics consumed by our backend;
>   hard bounces and complaints are automatically suppressed from future sending; rates monitored
>   in CloudWatch.
> - **Unsubscribe:** every notification category can be disabled in account settings; notification
>   mail carries an unsubscribe link.
> - **Authentication:** DKIM + SPF configured for our sending domains (DKIM tokens minted for
>   polytoken.ai; magnitudetech.com.br already verified).
>
> Happy to provide any further detail. Thank you!

☐ approved as-is ☐ approved with edits (say which) ☐ hold

### C2 — Legal / Merchant-of-Record (gates ADVERTISING billing, not billing itself — billing is live)

- **(a) RECOMMENDED for launch: stay Stripe + minimal legal pack.** ToS + Privacy policy
  (LGPD-aware: you as controller, Supabase/AWS/Anthropic as operators, international-transfer
  language) + a billing-terms page + your CNPJ/MEI invoice story. ~a day with a template plus
  review; keeps the already-live Stripe objects; revisit MoR at meaningful non-BR volume.
- **(b) Merchant of Record (Paddle / Lemon Squeezy):** offloads global sales-tax/VAT liability
  (MoR is the seller of record) at ~5%+ fees — but requires migrating checkout+webhook off the
  live Stripe objects, delaying launch.

☐ (a) Stripe + legal pack ☐ (b) MoR — name which ☐ decide later (dated debt, blocks advertising)

---

*Compiled 2026-08-07 from `vNEXT-AUDIT-2026-08-06.md`, `PEDRO-CHECKLIST.md`, ORCHESTRATOR-STATE ⭐,
and the 2026-08-07 marching orders. When every box has an answer, vNEXT closes clean and vLAUNCH
runs unattended.*
