# 05 — Cost Structure: current stack, COGS per user, burn scenarios

Research date: 2026-07-22. Ground rules per `README.md`: every number is sourced (URL or repo path)
or labeled **ASSUMPTION**. The current-stack section is grounded in the Terraform-derived audit
`.planning/research/2026-07-22-cost-reliability.md` (tf paths cited there); this doc adds the
per-user COGS model and burn scenarios that `04-business-model.md` prices against.

**No real usage data exists yet** — as of v1.9's close no real email had flowed through the deployed
product (01-market §1). Every per-user figure below is therefore a modeled assumption, to be replaced
with `chat_cost_ledger` + AWS Cost Explorer actuals the moment real usage exists. The ledger
(`packages/db/src/schema/chat-cost-ledger.ts`) was built precisely so this replacement is a query,
not a project.

---

## 1. Current stack costs (single-operator, ~0 users)

### 1a. AWS (from `infrastructure/aws/*.tf`; full derivation in `2026-07-22-cost-reliability.md` §2)

| Driver | Est. $/mo | Unit price source |
|---|---|---|
| Fargate prod task (0.5 vCPU / 1 GB, 24×7) | ~$18.0 | $0.04048/vCPU-hr + $0.004445/GB-hr — [aws.amazon.com/fargate/pricing](https://aws.amazon.com/fargate/pricing/) |
| ALB (exists only to receive SNS HTTP posts) | ~$17.5 | $0.0225/hr + $0.008/LCU-hr — [ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) |
| Public IPv4 × 3 | ~$11.0 | $0.005/IP-hr — [AWS IPv4 charge](https://aws.amazon.com/blogs/networking-and-content-delivery/identify-and-optimize-public-ipv4-address-usage-on-aws/) |
| Secrets Manager (4 secrets) | ~$1.6 | $0.40/secret-mo |
| CloudWatch Logs / ECR / SES receiving / S3 / SNS / Lambda forwarder | ~$1–3 | SES receiving ~$0.10/1k emails ([aws.amazon.com/ses/pricing](https://aws.amazon.com/ses/pricing/)); Lambda within free tier; S3 raw mail expires at 30 days |
| Bedrock (Claude + Titan) | variable, ~$0 today | Only unbounded line; chat path gated by circuit breaker |
| **AWS baseline** | **≈ $49–52/mo** | Exceeds the Terraform's own $30/mo budget alert (`budget.tf`) — alert fires monthly, training alert fatigue |

Identified optimization (same doc §6): SNS→SQS + drop the ALB (−$25/mo), Graviton (−$3.6),
Secrets→SSM (−$1.6) ⇒ **optimized AWS baseline ≈ $20–22/mo**, with better reliability (native DLQ).

### 1b. Non-AWS fixed lines

| Line | Today | At commercialization | Source |
|---|---|---|---|
| Vercel (apps/web) | $0 Hobby (**ASSUMPTION:** plan unknown from repo) | $20/seat Pro — Hobby prohibits commercial use | [vercel.com/pricing](https://vercel.com/pricing) |
| Supabase prod project | $0 Free (**ASSUMPTION:** tier unknown) | $25/mo Pro (mandatory before drive/scale: no auto-pause, 8 GB DB, 100 GB storage, PITR add-on) | [supabase.com/pricing](https://supabase.com/pricing), [makerkit breakdown](https://makerkit.dev/blog/saas/supabase-pricing) |
| Supabase staging project | $0 Free | keep Free | same |
| Domain/DNS/misc | ~$2–5/mo | same | ASSUMPTION |

**Total today: ~$50–60/mo. Commercial-ready fixed floor: ~$67 (optimized AWS $22 + Supabase Pro $25 + Vercel Pro $20), before any per-user variable cost.**

### 1c. LLM inference — unit prices and the spend-pattern model

Model prices (per MTok, Anthropic list; Bedrock serves the same models — **ASSUMPTION:** Bedrock
parity pricing; verify against [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/)):

| Model class | Input | Output | Source |
|---|---|---|---|
| Haiku 4.5 (cheap extraction/classification) | $1.00 | $5.00 | [platform.claude.com/docs/en/pricing](https://platform.claude.com/docs/en/pricing) |
| Sonnet-class (default chat) | $3.00 | $15.00 | same (Sonnet 5 intro $2/$10 through 2026-08-31) |
| Opus-class (heavy) | $5.00 | $25.00 | same |
| Titan Text Embeddings V2 | ~$0.02/MTok | — | **ASSUMPTION** from [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/); verify |
| Prompt caching | reads ~0.1× input; writes 1.25× | — | same pricing page |

Spend-pattern structure in the product (repo-grounded):

1. **Chat turns** — capped fail-closed at **$0.50/turn, $2.00/session, $5.00/day per user**
   (`apps/email-listener/app/settings.py:142-147`, enforced by `cost_circuit_breaker.py`). Worst-case
   chat COGS is therefore a hard **$150/user-mo ceiling**, expected case far lower (below). Browser
   ($0) and future local/pooled tiers route eligible turns off Bedrock entirely
   (`e7-inference/ARCHITECTURE.md` §1).
2. **Email-ingest pipeline** (segmentation, classification, embeddings) — **NOT behind the caps**
   (`2026-07-22-cost-reliability.md` §4). Cost scales with inbound mail; a mail-bomb to the catch-all
   domain is an unmetered spend vector until the breaker is extended to ingest (priority fix, same doc §6.6).

Per-user monthly LLM COGS model — **ASSUMPTION (no usage data; replace with ledger actuals):**

| Profile | Chat (Sonnet-class, cache-assisted) | Ingest (Haiku-class + embeddings) | Total/user-mo |
|---|---|---|---|
| Light (30 turns, 300 emails) | 30 × (4k in@10% cached + 0.8k out) ≈ $0.9 | 300 × 4k tok ≈ $1.2 + ~$0 embed | **~$2** |
| Moderate (150 turns, 600 emails) | ≈ $4.5 | ≈ $2.4 | **~$7** |
| Heavy (400 turns incl. Opus share, 1.5k emails) | ≈ $18 | ≈ $6 | **~$24** |
| Cap ceiling (product-enforced) | $5/day | unbounded today (fix pending) | $150 + ingest |

---

## 2. Projected COGS per user at 10 / 100 / 1,000 users

**ASSUMPTIONS for all three columns:** user mix 60% light / 30% moderate / 10% heavy (blended LLM
≈ $5.5/user-mo); no drive shipped in the base case (drive adds $11–20/user-mo for 500 GB dual-stored
— see 04 §2b — modeled separately); optimized AWS architecture (post ALB-removal) as the base;
Fargate scaled in 0.5-vCPU steps; Supabase Pro compute upgrades at the published add-on ladder
([supabase.com/pricing](https://supabase.com/pricing)); Vercel Pro includes 1 TB bandwidth then usage-priced.

| Line ($/mo) | 10 users | 100 users | 1,000 users |
|---|---|---|---|
| Fixed floor (AWS base + Supabase Pro + Vercel Pro) | 67 | 67 | 67 |
| Extra compute (Fargate tasks / Supabase compute add-on) | 0 | ~35 (2nd task + small compute bump) | ~350 (4–6 tasks, larger Supabase compute, autoscaling finally required — §3 of cost-reliability doc: none exists today) |
| LLM inference (blended $5.5/user) | 55 | 550 | 5,500 |
| SES receiving + S3 + SNS/SQS (600 emails/user-mo) | <1 | ~2 | ~20 |
| Egress / CDN / misc | ~2 | ~10 | ~100 |
| **Total** | **~$125** | **~$664** | **~$6,037** |
| **COGS per user** | **~$12.5** | **~$6.6** | **~$6.0** |
| + Drive add-on users (500 GB, dual-stored, B2 replica) | +$11.4 each | +$11.4 each | +$11.4 each (CAS dedup should reduce; unmodeled) |

Readings:

- **COGS/user converges to ≈ LLM spend (~$6)** once fixed costs amortize — the business is an
  inference-margin business, which is why the $0 local/browser tiers and prompt caching matter
  strategically, not just technically.
- At a $20–25 Pro price (04 §1b), blended gross margin at 100+ users is ~70% **(ASSUMPTION-stacked;
  the single most sensitive input is turns/user/month)**.
- Heavy users on Opus-class without caps would be margin-negative; the existing per-day cap is what
  makes the P&L defensible. Extending caps to ingest is a pre-launch requirement.
- The 1,000-user column assumes engineering work that does not exist yet: autoscaling
  (`prod_desired_count = 1` today, no autoscaling resources in tf), SQS ingest, SES production
  access (still sandboxed: 200 msgs/24h outbound — `aws-facts.json` via cost-reliability doc §1).

---

## 3. Burn scenarios for a solo founder

Infrastructure-only burn (founder compensation excluded — that is a personal-runway input Pedro
holds; nothing here should be quoted as "total burn" to investors without adding it):

| Scenario | Monthly infra burn | Annualized | Notes |
|---|---|---|---|
| A. Today, as deployed | ~$50–60 | ~$660 | Free Supabase/Vercel; over its own $30 AWS budget alert |
| B. Today, optimized (SQS, no ALB, Graviton, SSM) | ~$25–30 | ~$330 | ~50% cut, plus reliability gains; ~1–2 days of work per cost-reliability §6 |
| C. Commercial-ready, 0–10 users | ~$90–130 | ~$1,300 | Adds Supabase Pro + Vercel Pro + light LLM spend; the "credible demo product" tier |
| D. 100 users (no drive) | ~$660 | ~$8,000 | Covered by ~30 Pro subscribers at $25 — **break-even on infra at ~27% paid conversion of 100 users (ASSUMPTION)** |
| E. 100 users + 25 drive users | ~$950 | ~$11,400 | Drive users must be on the $50 tier to stay margin-positive |
| F. 1,000 users | ~$6,000 | ~$72,000 | Requires the §2 engineering work; infra self-funding at ≥240 Pro subscribers (24% conversion, ASSUMPTION) |
| Tail risks (any scenario) | +$0–150/user-day worst case | — | Uncapped ingest spend vector + mail-bomb (fix: extend breaker); silent-mail-loss ≠ cost but is the top reliability risk |

Solo-founder implications:

1. **Burn is not the problem; the LLM margin model and the uncapped ingest path are.** Even scenario
   C is coffee-budget scale. What a VC will probe is COGS/user trajectory and what enforces it —
   answer: the ledger + circuit breaker, extended to ingest.
2. **Do scenario B's optimizations before fundraising conversations** — "we run the whole stack for
   ~$30/mo with fail-closed spend caps" is a strong solo-founder discipline signal, and the numbers
   are verifiable from Terraform + the AWS bill.
3. **Raise the AWS budget alert to match the architecture** ($30 → ~$60 as-is, or keep $30 post-
   optimization) and add a Bedrock-only budget as the real tripwire (cost-reliability §6.3) — alert
   fatigue on the one guardrail is the cheapest catastrophic-risk fix available.
4. Once any real users exist, replace §1c/§2 with actuals: `chat_cost_ledger` per-user sums (already
   indexed for per-day/per-conversation queries) × AWS Cost Explorer service split. The README's
   ground rule ("no invented unit economics" once bills exist) then supersedes this entire document's
   assumptions.

---

## Sources

- Repo/derived: `.planning/research/2026-07-22-cost-reliability.md` (tf-derived AWS table, SPOFs, optimizations) · `infrastructure/aws/*.tf` · `apps/email-listener/app/settings.py:139-147` · `apps/email-listener/app/domain/services/cost_circuit_breaker.py` · `packages/db/src/schema/chat-cost-ledger.ts` · `.planning/research/e7-inference/ARCHITECTURE.md` §1 · `.planning/research/2026-07-22-ecosystem/app-packages.md` §4
- AWS pricing: https://aws.amazon.com/fargate/pricing/ · https://aws.amazon.com/elasticloadbalancing/pricing/ · https://aws.amazon.com/ses/pricing/ · https://aws.amazon.com/blogs/networking-and-content-delivery/identify-and-optimize-public-ipv4-address-usage-on-aws/ · https://aws.amazon.com/cloudwatch/pricing/ · https://aws.amazon.com/bedrock/pricing/
- SaaS tiers: https://supabase.com/pricing · https://makerkit.dev/blog/saas/supabase-pricing · https://vercel.com/pricing
- LLM prices: https://platform.claude.com/docs/en/pricing (Haiku 4.5 $1/$5, Sonnet-class $3/$15, Opus-class $5/$25 per MTok; cache reads ~0.1×)
- Storage unit costs referenced from `04-business-model.md` §2 (Backblaze/R2/S3/Supabase, sourced there)

**Labeled assumptions (consolidated):** Vercel/Supabase current tiers (unknown from repo, modeled at
both); Bedrock price parity with Anthropic list; Titan embedding price; all per-user token volumes and
the 60/30/10 user mix; blended LLM $5.5/user-mo; compute-scaling step costs at 100/1k users; paid-conversion
percentages in scenarios D/F; drive COGS carried over from 04 §2b (itself assumption-labeled); zero
founder compensation in burn tables.
