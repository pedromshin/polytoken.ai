# BILL-05 legal pack — SUPERSEDED 2026-08-08

> ⛔ **This draft was largely unnecessary and two of its four "unanswered" questions were
> already answered in the repo.** I wrote it without reading `apps/web/src/app/legal/`, which
> already contained a terms page, a privacy page, a shared `LegalDoc` component and
> `legal-entity.ts` naming the contracting entity.
>
> **What was actually already true:**
> - **Entity (§0.2):** `Pedro Kyun Maschio Shin Consultoria em Tecnologia LTDA`, trading as
>   Magnitude Tecnologia, **CNPJ 65.152.447/0001-21** — in `legal-entity.ts` since 2026-07-26.
> - **Governing law (§0.3):** Brazil, stated in the terms' "Governing law" section.
> - **Privacy contact (§0.4):** `privacy@polytoken.ai`, already used across `/legal/*`.
> - The pages were **already linked** from the billing surface.
>
> **What was genuinely missing, and is now shipped:** the CDC art. 49 seven-day right of
> withdrawal was only implied ("except where required by law") rather than stated, so the person
> holding the right could not see it. `/legal/terms` now states it plainly, alongside an explicit
> refund policy — which Stripe also expects to be reachable on a live account.
>
> **Still genuinely open (the one real §0 item):** the **merchant-of-record** posture. A4 assumes
> Stripe-direct, which makes the LTDA the seller of record and puts foreign VAT/sales-tax
> obligations on it. That is an accountant/lawyer question, not a code one.
>
> The original draft follows for its refund/privacy wording, which fed the shipped text.

---

# BILL-05 legal pack — DRAFT for Pedro's review

> **Status: DRAFT. Not published. Not legal advice.**
> Written 2026-08-08, immediately after `BILLING_ENABLED` went true, because live billing without
> published terms is the one open exposure in the milestone. It exists so publishing is a *merge*
> rather than a writing task — **not** so it can be shipped unread.
>
> **I am not a lawyer.** The structural questions in §0 change what these documents must say, and
> at least two of them (merchant of record, consumer jurisdiction) have real legal consequences
> for a Brazil-resident founder charging USD to an international audience. Get a lawyer's eyes on
> §0 before publishing; the body text below is a competent starting point, not a substitute.

## §0 — Four questions that change the text (answer before publishing)

1. **Who is the merchant of record?** Today it is **you directly via Stripe** (assumption **A4**,
   option (a): stay on Stripe + a minimal legal pack). That means *you* are the seller of record,
   and you carry the VAT/sales-tax obligations for every jurisdiction you sell into. A merchant of
   record (Paddle, Lemon Squeezy, Stripe's own MoR offering) takes that on instead. This is the
   single biggest structural choice and it is unmade in writing.
2. **Which entity is contracting?** A registered company or you as an individual? The terms must
   name a legal entity, an address, and a tax id. Currently no entity is named anywhere.
3. **Which consumer law governs?** You are Brazil-resident (the Stripe account carries BRL
   products); prices are USD; buyers may be anywhere. Brazil's **CDC** gives a 7-day right of
   withdrawal for distance selling; the **EU** gives 14 days and requires an explicit waiver for
   immediate digital delivery. The refund text below assumes you honour the stricter of the two.
4. **Data protection contact.** **LGPD** (and GDPR if you sell into the EU) requires a named
   contact for data-subject requests. `privacy@polytoken.ai` needs to exist and be monitored.

## §1 — Billing terms (draft body)

**What you are buying.** Polytoken is a hosted email-intelligence service. Paid plans raise usage
allowances; the current plans and prices are shown on the pricing page and in Stripe:
**Pro — USD 29.00/month** · **Power — USD 49.00/month**. Prices are in US dollars and exclude any
taxes your jurisdiction imposes.

**Billing cycle.** Subscriptions bill monthly in advance from the date you subscribe, and renew
automatically each month until cancelled. Your card is charged by Stripe; we never see or store
full card details.

**Allowances.** Each plan includes a monthly allowance of chat turns (free 200 · Pro 2,000 ·
Power unlimited). Allowances reset at the start of each calendar month (UTC). Reaching a free-plan
allowance blocks further chat turns until the reset or an upgrade; **paid plans are never blocked
mid-cycle** — you are notified instead.

**Cancellation.** You can cancel at any time from the billing portal. Cancellation stops the next
renewal; you keep paid access until the end of the period already paid for. We do not pro-rate
partial months on cancellation, except where §2 or local law requires it.

**Changes to price or plan.** We will give at least 30 days' notice by email before any price
change affecting an existing subscription. You may cancel before it takes effect.

**Suspension.** We may suspend an account for non-payment, or for use that threatens the service
or other users. Where practical we will contact you first.

**Service availability.** The service is provided "as is". We do not offer an uptime SLA on these
plans. Nothing here limits liability that cannot lawfully be limited.

## §2 — Refund policy (draft body)

**Cooling-off.** If you are a consumer, you may cancel within **14 days** of first subscribing and
receive a full refund. (This is deliberately the stricter of Brazil's 7-day CDC right and the EU's
14 days — one rule is simpler to honour than a jurisdiction matrix, and it can only ever be more
generous than required.)

**After the cooling-off period.** Monthly subscriptions are not generally refundable once a period
has begun, because access is delivered immediately. If the service was materially unavailable or
did not work as described, contact us and we will refund fairly — we would rather refund than
argue.

**Accidental renewals.** If you cancel late and are charged for a period you have not used, tell
us within 14 days and we will refund it.

**How to request.** Email **billing@polytoken.ai**. Refunds return to the original payment method,
typically within 5–10 business days once issued.

## §3 — Privacy contact (draft body)

**Controller.** *(entity name and address — see §0.2, currently unnamed.)*

**Contact for data-subject requests.** **privacy@polytoken.ai**

**What is processed.** Account identity (email), the email content you connect to the service and
anything derived from it, and billing metadata. Card details are processed by **Stripe** and never
reach our systems.

**Your rights.** Under LGPD (and GDPR where it applies) you may request access, correction,
deletion, portability, and information about sharing. Account deletion removes your stored email
content and derived records.

**Sub-processors.** Stripe (payments) · Amazon Web Services (hosting, email receipt, model
inference via Bedrock) · Supabase (database and authentication) · Vercel (web hosting).

## §4 — Where these go when published

| Document | Route | Notes |
|---|---|---|
| Billing terms | `/legal/billing-terms` | link from the pricing page **and** from Stripe Checkout |
| Refund policy | `/legal/refunds` | Stripe requires a reachable refund policy for live accounts |
| Privacy contact | `/legal/privacy` | extend the existing privacy copy if one exists |

Checkout should link the terms **before** the pay button, not only after. Stripe Checkout has a
`custom_text.terms_of_service_acceptance` field for exactly this.

## §5 — What I did NOT do, and why

I did not create the live pages. Publishing legal terms is an act of the business, not of its
build system: the entity, the MoR posture and the governing law in §0 are all unanswered, and text
published under the wrong answers is worse than text that is late. Answer §0, have a lawyer read
it, then it is a merge.

**Until these are live, `polytoken.ai` is charging real money with no published terms.** That is
recorded in `ASSUMED-PASS-2026-08-08.md` §5 and as **A19**, and it is the highest-priority item in
the repo — ahead of the milestone close.
