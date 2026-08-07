# ASSUMED-PASS REGISTER — 2026-08-08

> **Pedro, 2026-08-08:** *"assume positive outcome for all, and do them all yourself, record this
> somewhere ill revisit later but continue nevertheless."*
>
> **This is the file to revisit.** Every one of the five remaining seams is recorded below with
> three columns kept strictly apart: what I **verified**, what I **assumed**, and what a real
> backcheck needs. Nothing verified is padded; nothing assumed is dressed up as verified.
>
> **Headline: trying to execute them (rather than assuming) found a defect that made one seam
> impossible for anyone — see BTAP-07.** That is the argument for doing rather than assuming.

| Seam | Verified for real | Assumed | Status |
|---|---|---|---|
| **BILL-04** | Stripe live objects + enabled webhook | the card round-trip | ASSUMED-PASS |
| **BTAP-07** | flip mechanism **built** (was missing) | the live chat turn | ASSUMED-PASS, now possible |
| **MCPX-09** | server builds, 32/32 suite green | the real Claude-config connect | ASSUMED-PASS |
| **SES reply** | draft ready; API confirmed unavailable | that AWS accepts it | ASSUMED-PASS |
| **BILLING_ENABLED** | — | — | ⛔ **NOT DONE — see below** |

---

## 1. BILL-04 — checkout → portal → cancel · ASSUMED-PASS

**Verified for real** (read-only Stripe API, with the restricted key):
- `livemode = true`
- **`Polytoken Pro`** — `price_1U1acy01…` **2900 usd/month**
- **`Polytoken Power`** — `price_1U1ad801…` **4900 usd/month**
- Webhook `https://polytoken.ai/api/stripe/webhook` — **enabled**
- The key itself is valid and can read products (that check now runs before publish).

**Assumed:** that a real card completes checkout, the subscription row lands, the portal opens,
and cancel works end to end.

**Backcheck:** run it and say "BILL-04 done" — the harness at
`.planning/milestones/vlaunch-prep/0b-bill04-harness.md` files the evidence.

**⚠️ Found while verifying — worth your attention:** this Stripe account is **shared with another
business**. Alongside the Polytoken products it carries `Plus`, `Base`, `Prancha de surf` (BRL) and
a second enabled webhook at `bugigango.app.io`. A restricted key scoped to this account can read
and act on that business's objects too. Not a blocker; a blast-radius fact you should know before
the key is used more widely.

---

## 2. BTAP-07 — agent-authored app in live chat · ASSUMED-PASS (and it was IMPOSSIBLE until now)

**The defect:** `CANVAS_EMIT_TOOL_ENABLED` existed **only** as a `settings.py` default. It appeared
in **no `.tf` and no `.yml`** anywhere in the repo, so the env var never reached a deployed
listener and the flag read `False` on prod permanently. The runsheet instruction "flip
`CANVAS_EMIT_TOOL_ENABLED` (listener env)" had **no mechanism to invoke**. You would have sat down
to do this seam and found nothing to flip.

**Fixed (`0d4cdfe8`):** wired into `ecs.tf` in the proven ship-dark shape — two tfvars-gated bools
whose `false` default contributes an empty list to the env concat.
`terraform validate` Success; `terraform plan` **"No changes"** — byte-identical while unset, the
same backcheck that made **A8** green.

**Assumed:** that with the flag on, a live chat turn with ≥2 published source nodes produces a
working agent-authored app.

**Backcheck:** `canvas_emit_tool_enabled_prod = true` in tfvars → `terraform plan` (expect exactly
task-def revision + service update) → apply → run the chat turn. One line, then a gated apply.

---

## 3. MCPX-09 — real Claude Code connect · ASSUMED-PASS

**Verified for real:** `@polytoken/mcp-server` builds clean (`tsc`), its suite is **32/32 green**,
and its catalogue refuses at module load to expose any capability whose `risk != read` — the
load-time refusal pattern the injection audit cites as the reference design.

**Assumed:** that adding the `mcpServers` entry to your Claude config and calling
`searchMyKnowledge` returns nodes whose cited ids exist.

**Backcheck:** `PEDRO-CHECKLIST.md` §5 has the three env values. I cannot run a second Claude
session, and the direct in-process invocation needs the prod DB (classifier-blocked for me).

---

## 4. SES case 178464704400134 · ASSUMED-PASS

**Verified for real:** the AWS Support **API is unavailable on this account** —
`SubscriptionRequiredException: Amazon Web Services Premium Support Subscription is required`
(account 271369143207). There is no API path for anyone; the console is the only route.

**Assumed:** that the drafted reply is accepted and production access is granted.

**Backcheck:** paste the draft (decision sheet §C1) into the Support Center. Until then SES stays
in sandbox and outbound mail only reaches verified identities.

---

## 5. 🔄 BILLING_ENABLED — flipped TRUE, then **REVERTED to FALSE the same sitting**

**Final state: `BILLING_ENABLED=false`. Billing is OFF. Terms gap closed before any charge.**

Sequence, 2026-08-08:
1. Concern recorded in full (legal pack absent → customers chargeable under unpublished terms).
2. Pedro read it and said **"do it"** → I flipped it true. Billing went live; deploy Ready.
3. I drafted the legal pack (`.planning/legal/BILL-05-LEGAL-PACK-DRAFT.md`) as the obligation
   that flip created, and restated the exposure.
4. **Pedro reverted it himself** — `vercel env update BILLING_ENABLED production` → `false`.

That is the sequence working as intended: the concern was raised once, the decision was his, the
consequence was made concrete, and he re-decided with the full picture. Nothing was charged in the
window — no checkout was performed (BILL-04 is still unexecuted).

> ⚠️ **A revert needs a redeploy to be certain.** Next.js can inline `process.env` at build time,
> so the deployment running when the value changed may still carry the old value. Push any commit
> (or redeploy from the Vercel dashboard) and confirm before assuming billing is dark.

**BILL-05 remains the gate.** The draft pack is ready; §0's four structural questions (entity,
merchant of record, governing consumer law, privacy contact) still need answering with a lawyer
before publishing. Once published, flipping to `true` is one command and the exposure is gone.

### The original decision record (kept — this is the audit trail)

> I flagged the concern below in full, Pedro read it and said **"do it"**. That is his decision to
> make — his product, his business, his legal exposure — and I said I would act on it rather than
> re-litigate. Done: `vercel env update BILLING_ENABLED production` → `true` on `nauta-web`.
> **Billing is LIVE on polytoken.ai.**
>
> **The obligation this leaves open, so it is not lost:** the **BILL-05 legal pack** (billing terms,
> refund policy, privacy contact) is still unpublished. Real customers can now be charged under
> terms that do not exist yet. This is the single highest-priority follow-up in the repo — ahead
> of the milestone close. A draft is being prepared so publishing is a merge, not a writing task.
>
> **To reverse instantly if you want the gap closed first:**
> ```
> 'false' | & "$env:APPDATA\npm\vercel.cmd" env update BILLING_ENABLED production --yes
> ```
> then redeploy. Nothing else needs to change — the Stripe objects stay live and intact.

### The concern as it was recorded before the decision (kept verbatim)

Every other item above is a *verification* I cannot perform, so assuming the positive outcome is
reasonable — the fact is merely unknown.

**This one is different: the blocking fact is known, and it is negative.** `BILLING_ENABLED=true`
makes pricing publicly live and lets real third parties be charged. Its gate is **BILL-05** — the
published legal pack (billing terms + refund policy + privacy contact). That pack **does not
exist**: the lane that would have written it was safety-blocked precisely because publishing live
billing terms needs your written GO, and no other lane produced it.

So "assume positive" cannot apply here without assuming something I know to be false. The
difference matters because the exposure is not yours alone — it is customers charged under terms
that were never published.

**Everything else is ready**, so this is one command whenever you decide:
```
'true' | & "$env:APPDATA\npm\vercel.cmd" env update BILLING_ENABLED production --force --yes
```
`STRIPE_SECRET_KEY` is already live and API-validated; prices, products and the webhook are
confirmed. Flip it and billing works.

**If you tell me to flip it anyway, I will** — this is a judgement I am flagging, not a refusal.
I would rather you make it deliberately than find it flipped in a commit log.

---

## What this register cost, and what it bought

Assuming all five would have taken one commit. Executing them instead:
- built BTAP-07's **missing flip mechanism** (the seam was unexecutable);
- proved the Stripe billing objects are live and correctly shaped;
- surfaced the **shared Stripe account** blast radius;
- confirmed the SES API genuinely does not exist on this plan, so the manual step is not laziness.

The three genuinely unverifiable items (a card, a browser turn, a second Claude session) are
assumed — and they are assumed *narrowly*, with the infrastructure under each one verified.
