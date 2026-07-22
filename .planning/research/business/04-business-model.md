# 04 — Business Model: pricing, storage economics, compute credits, remote desktops

Research date: 2026-07-22. Per the ground rules in `README.md`: every externally-stated number is
sourced (URL) or explicitly labeled **ASSUMPTION**. Repo-grounded claims cite file paths. Companion
doc: `05-cost-structure.md` (COGS this doc's pricing must clear). Infra facts lean on
`.planning/research/2026-07-22-cost-reliability.md`, `.planning/research/2026-07-22-ecosystem/app-packages.md`,
`.planning/research/e7-inference/ARCHITECTURE.md`, and `.planning/research/cloud-desktop/AWS-ARCHITECTURE.md`.

---

## 0. What polytoken is structurally able to monetize today (repo reality)

The codebase already contains the metering substrate a usage-priced product needs — this is a real
asset in a monetization conversation:

- **Per-call cost ledger:** `packages/db/src/schema/chat-cost-ledger.ts` — every adapter writes a
  usage row with `cost_usd numeric(12,6)`; rows survive conversation deletion, so accounting can't
  be erased by content deletion.
- **Fail-closed spend caps, as data:** `apps/email-listener/app/settings.py:142-147` — defaults
  `$0.50/turn`, `$2.00/session`, `$5.00/day`, `$0.15/round`, enforced by
  `app/domain/services/cost_circuit_breaker.py` (pre-turn gate + mid-stream abort). This means the
  worst-case LLM COGS per user is a *product-enforced ceiling*, not a hope.
- **Cost as a first-class capability field:** `packages/capabilities/src/capability.ts` declares
  `cost` on every capability; the cloud-desktop design (`.planning/research/cloud-desktop/AWS-ARCHITECTURE.md`
  §5.3) mandates per-run hard caps and an in-app cost readout that must match the provider invoice.
- **The inference tier ladder** (`.planning/research/e7-inference/ARCHITECTURE.md` §1): browser ($0)
  → local daemon ($0) → pooled own-fleet ($0/credits) → hosted (metered $). The router resolves the
  cheapest tier that satisfies the request — i.e., the architecture is built to *minimize* hosted
  COGS per request, which is the correct shape for a subscription business.

**Consequence:** the natural model is a subscription with hard usage ceilings (Claude/ChatGPT-style),
plus metered pass-through for genuinely metered resources (desktops, overflow inference), not pure
pay-as-you-go.

---

## 1. Subscription tiers

### 1a. Comparable price anchors (published, 2026)

| Product | Price | What it anchors |
|---|---|---|
| ChatGPT Plus | $20/mo | AI-assistant baseline ([sentisight.ai comparison](https://www.sentisight.ai/ai-price-comparison-gemini-chatgpt-claude-grok/)) |
| Claude Pro | $20/mo; Max at $100/$200 | Same, plus proof a $100–200 power tier exists ([aipricing.guru](https://www.aipricing.guru/compare/chatgpt-plus-vs-claude-pro/)) |
| Superhuman | $30–33/user/mo | Ceiling for "email as a premium product" ([vendr.com](https://www.vendr.com/marketplace/superhuman)) |
| Google One 2TB | $9.99/mo | Retail storage floor ([spliiit.com summary](https://www.spliiit.com/en/blog/google-one-abonnement-stockage-prix)) |
| Dropbox Plus 2TB | $11.99/mo | Same ([cloudwards.net](https://www.cloudwards.net/dropbox-vs-google-drive-vs-onedrive/)) |
| Shadow PC (full cloud PC) | ~$30–38/mo base | Remote-desktop retail anchor ([tech-insider.org](https://tech-insider.org/shadow-pc-vs-geforce-now-2026/), [shadow.tech](https://shadow.tech/us/)) |

Read of the anchors: the market has converged on **$20/mo for an AI assistant** and tolerates
**$30+/mo for email-centric productivity** (Superhuman). Commodity storage retails at **~$0.005/GB**
— far below what a small company pays wholesale (§2), so storage can never be sold as storage; it
must be bundled as "your drive inside your knowledge graph."

### 1b. Proposed tier ladder — **ASSUMPTION (untested; no customer discovery yet, per 01-market §1)**

| Tier | Price (ASSUMPTION) | Contents | Cost logic (see 05) |
|---|---|---|---|
| Free | $0 | Email ingest cap (e.g. 200 emails/mo), browser/local-only inference (Tier A/B — genuinely $0 COGS), 5 GB drive, community support | COGS ≈ storage pennies + fixed-cost share; local inference tiers make a real free tier affordable — most competitors can't do this |
| Pro | $20–25/mo | Full ingest, hosted-model chat under the existing caps ($5/day ceiling), 100 GB drive, canvas/genui, daemon | Expected LLM COGS $5–10/mo (05 §2), storage ≤$2.7 → healthy gross margin at expected usage; ceiling-bounded worst case |
| Power | $50/mo | 500 GB–1 TB drive w/ versioning + off-provider replica, higher inference caps, priority models, remote desktop hours included (e.g. 20 hr CPU-desktop) | Drive dual-stored ≈ $10.5–13/mo + desktop hours ≈ $4–8 + LLM $10–20 → still >40% gross margin (ASSUMPTION on usage mix) |
| Metered add-ons | pass-through + margin | Desktop hours beyond quota, GPU desktop, overflow inference beyond caps | Cost-plus; the ledger/capability substrate already reports per-run cost, matching the vision's "live per-hour cost reporting" |

Design rules this ladder follows (all defensible to a VC):

1. **Never sell unlimited anything metered.** The circuit-breaker caps are the pricing mechanism —
   raising a cap is a settings change, so tiers map 1:1 onto existing config (`settings.py:139-147`).
2. **The free tier rides the $0 tiers of the inference ladder.** Browser (WebLLM/Prompt API) and
   local-daemon inference cost polytoken nothing (`e7-inference/ARCHITECTURE.md` §1.A–B). This is a
   structural COGS advantage over purely-hosted competitors.
3. **Storage is a bundling feature, not a SKU** (see §2 — retail storage economics are hostile).
4. **Anything genuinely per-hour (desktops) is metered with margin**, never flat-rate (see §4 —
   Shadow's flat model only works with utilization assumptions polytoken shouldn't make at N=1).

---

## 2. Storage economics for a 500 GB-class drive

### 2a. Wholesale unit costs (published, 2026)

| Provider | Storage $/GB-mo | Egress | 500 GB stored, $/mo | Source |
|---|---|---|---|---|
| AWS S3 Standard | $0.023 | $0.09/GB | $11.50 + egress | [backblaze.com/cloud-storage/pricing comparison](https://www.backblaze.com/cloud-storage/pricing), [infratally](https://infratally.com/articles/backblaze-b2-vs-aws-s3-2026/) |
| Cloudflare R2 | $0.015 | **$0** | $7.50 | [mecanik.dev R2 pricing explained](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/), [devopsboys comparison](https://devopsboys.com/blog/cloudflare-r2-vs-aws-s3-vs-backblaze-b2-2026) |
| Backblaze B2 | $0.006 | Free up to 3× stored/mo, then $0.01/GB | $3.00 | [backblaze.com pricing](https://www.backblaze.com/cloud-storage/pricing), [tech-insider comparison](https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/) |
| Supabase Storage (Pro) | 100 GB included, then ~$0.021/GB | 250 GB egress included, then $0.09/GB | ~$8.40 overage on 500 GB | [supabase.com/pricing](https://supabase.com/pricing), cross-checked in `2026-07-22-cost-reliability.md` §5.1 |

### 2b. What the polytoken drive actually costs per user

The already-specced architecture (`2026-07-22-ecosystem/app-packages.md` §4) is **dual-stored by
design**: primary blobs in Supabase Storage (app-integrated, RLS, signed URLs) + nightly `rclone`
replica to a **versioned, Object-Locked real S3 bucket** — because Supabase Storage has no
versioning and deletes are permanent ([S3 compatibility matrix](https://supabase.com/docs/guides/storage/s3/compatibility)).

Per 500 GB user, monthly (list prices):

| Component | Cost |
|---|---|
| Primary: Supabase Storage overage (~400 GB past the project-wide 100 GB) | ~$8.40 |
| Replica: S3 Standard w/ versioning | ~$11.50 — **or swap replica to B2 ($3.00) / R2 ($7.50)** |
| One full re-download (worst-case egress event, Supabase $0.09/GB past 250 GB) | ~$22.50 one-off |
| **Steady-state total** | **~$11.4/mo (B2 replica) to ~$19.9/mo (S3 replica)** |

- **ASSUMPTION:** content-addressed storage (CAS) dedup gives a real haircut on the replica (identical
  blobs across versions stored once — the design in `app-packages.md` §4.1); modeled at 0% above, so
  these are conservative ceilings.
- **Versioning multiplier:** S3 versioning bills every retained version. A churn-heavy drive can cost
  1.2–2× the live-data figure — **ASSUMPTION**, mitigated by lifecycle rules to Glacier
  ([AWS versioning docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)).
- **The killer risk is egress, not storage.** A sync-style client (the OneDrive-replacement ambition)
  multiplies egress; Supabase charges $0.09/GB past 250 GB. If sync ships, primary reads should move
  to R2 (zero egress) — this is exactly the class of decision R2 was built for.

### 2c. The retail comparison every investor will make

Google sells 2 TB for $9.99/mo retail — **$0.005/GB**, below even B2's wholesale $0.006. Hyperscalers
price storage at/below small-company COGS as an ecosystem subsidy. **Therefore:** polytoken must never
compete on $/GB. The drive is defensible only as *storage the agent can see* — versioned, entity-linked,
treemap-visualized, referenced in chat. Price it inside Power-tier bundling; a standalone "500 GB for
$X" SKU loses to Google One on arithmetic alone.

Also blocking (from `2026-07-22-cost-reliability.md` §5.1): Supabase Pro upgrade and the CAS+replica
design are prerequisites *before* any 500 GB migration — a bug during migration can currently destroy
the only copy.

---

## 3. Compute-credit marketplace for distributed inference

### 3a. What the vision actually specifies, and the two distinct products inside it

VISION E7: "idle machines offer compute; others offload to the pool; scheduler matches task profile
to node profile" — users earn credits contributing compute, spend credits on heavier models. But the
shipped design (`e7-inference/ARCHITECTURE.md` §1.C) deliberately scopes Tier C to **the user's own
fleet** ("stays within user-owned nodes, $0 / credits"). That distinction is everything:

| Variant | Market structure | COGS | Risk |
|---|---|---|---|
| **C1: Own-fleet pooling** (designed, near-term) | Not a market — same owner both sides | $0 to polytoken | Low; pure product feature |
| **C2: Open credit marketplace** (vision, long-term) | True two-sided market | Polytoken clears supply/demand | High — everything in §3c |

### 3b. Comparable take rates (published, 2026)

| Marketplace | Take rate | Notes |
|---|---|---|
| Vast.ai | ~10–15% | Largest P2P GPU marketplace; renters bid on host hardware ([gpunex platform comparison](https://www.gpunex.com/blog/sell-computing-power-best-platforms/), [vast.ai/hosting](https://vast.ai/hosting)) |
| Salad | ~20–25% | Consumer-idle-hardware model — the closest analog to polytoken's "idle machines" pitch ([gpunex](https://www.gpunex.com/blog/sell-computing-power-best-platforms/), [earnifyhub guide](https://earnifyhub.com/learning-guides/make-money-renting-out-gpu-2026)) |
| Consumer host earnings | ~$0.30–0.60/hr (Salad-class) to $0.55–1.50/hr (Vast-class) | Sets the ceiling on what a credit can be worth ([gpunex](https://www.gpunex.com/blog/sell-computing-power-best-platforms/)) |

**ASSUMPTION for modeling:** a polytoken marketplace take rate of 15–25% on cleared compute value.
At consumer-node rates that is cents/hour of gross margin per active host — the marketplace is a
retention/economics feature for users, not a meaningful revenue line until node count is large.

### 3c. Two-sided market risks (the honest list for a VC conversation)

1. **Cold start / chicken-and-egg.** No demand → hosts earn nothing → supply leaves → heavy models
   unavailable → demand never arrives. Vast/Salad solved this with years of crypto-miner supply
   overhang polytoken doesn't have.
2. **Privacy contradiction — the polytoken-specific one.** The product's core stance is
   privacy-first routing ("never silently up in data-exposure," `e7-inference` §1). Routing a
   user's email-derived prompts to a *stranger's* GPU is a bigger exposure than any hosted API with
   a DPA. C2 requires confidential-compute-grade answers (TEEs, or restricting pooled jobs to
   non-sensitive workloads) before it is even coherent with the product's own values.
3. **Verifiable computation.** Nothing stops a malicious node returning garbage or logging inputs.
   Redundant execution / spot-checking eats the margin; attestation is immature on consumer hardware.
   **ASSUMPTION:** verification overhead 10–30% of cleared compute.
4. **Reliability/heterogeneity.** Consumer nodes churn (sleep, Wi-Fi, gaming). Scheduler must
   over-provision; effective utilization of pledged supply is well under 50% (**ASSUMPTION**,
   directionally consistent with why Salad's take rate is 2× Vast's — flaky supply costs the platform).
5. **Credits as a regulatory surface.** Closed-loop, non-cashout credits ≈ loyalty points (low risk).
   The moment credits are redeemable for cash, money-transmission/e-money rules can attach
   (jurisdiction-dependent — **flag for `02-incorporation-and-legal.md` / `06-compliance`**; not legal advice).
   Recommendation: credits are **earn-in-product, spend-in-product only**, denominated in polytoken's
   own unit, purchasable but never redeemable.
6. **Liquidity fragmentation.** Matching is per model-class × latency × trust tier. Each cell of that
   matrix needs its own liquidity; a small network has thin cells and bad UX everywhere.

### 3d. Recommendation

Ship **C1 (own-fleet pooling) as a Pro/Power feature** — it is pure differentiation with $0 COGS and
no market risk, and it makes the free/local tiers stronger. Treat **C2 as an explicit "not now"** in
any pitch: describe it as optionality, gated on (a) node count from C1 adoption, (b) a
confidential-compute answer, (c) closed-loop credit design. Investors respect a deferred two-sided
market far more than a hand-waved one.

---

## 4. Remote-desktop margin model

### 4a. Cost side (the polytoken design is AWS + Amazon DCV; DCV is license-free on EC2)

From `.planning/research/cloud-desktop/AWS-ARCHITECTURE.md` (its own sources, us-east-1 on-demand,
cross-checked against [instances.vantage.sh](https://instances.vantage.sh/aws/ec2/g4dn.xlarge) and
[usage.ai EC2 guide](https://www.usage.ai/blogs/aws/ec2/pricing/)):

| Shape | $/hr | Role |
|---|---|---|
| m7i.xlarge (4 vCPU/16 GB) | ~$0.20 | Floor CPU desktop |
| m7i.2xlarge (8 vCPU/32 GB) | ~$0.4032 | Default CPU dev desktop |
| g4dn.xlarge (T4, NVENC) | ~$0.526 | Entry GPU desktop |
| g6.xlarge (L4, AV1) | ~$0.805 | Modern GPU desktop |
| Idle (hibernated): EBS gp3 only | ~$0.08/GB-mo → ~$8/mo per 100 GB root | "Disk = the machine" persists |
| Amazon DCV streaming | $0 on EC2 | [DCV licensing docs](https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html) |

Hetzner alternative (post-2026 repricing): new-line CPX42 (8 vCPU/16 GB) **€25.49/mo flat**
([bitdoze breakdown](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/)) — but note Hetzner
raised legacy CPX/CCX prices up to ~2–3× in April/June 2026 (legacy CPX41 reached ~$141/mo in the US
region — [northflank breakdown](https://northflank.com/blog/hetzner-cloud-server-price-increases),
[wz-it analysis](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)).
**Lesson: never build a flat-rate retail price on one provider's list price** — the repo's
`DesktopProvider` port abstraction (`packages/capabilities/src/desktop.ts`) is the right hedge.

### 4b. Retail anchor vs raw cost

Shadow PC sells an always-on-feeling full Windows PC at ~$30–38/mo ([tech-insider](https://tech-insider.org/shadow-pc-vs-geforce-now-2026/)).
Raw EC2 for an *always-on* m7i.2xlarge is ~$294/mo (0.4032 × 730) — flat-rate only works with heavy
oversubscription/utilization bets. Polytoken should not make that bet at its scale.

### 4c. The margin model that fits the product: **metered cost-plus with hibernation**

The vision itself demands "live per-hour cost reporting," and the design's lifecycle is
spawn → use → hibernate (EBS-only) → resume. That makes utilization-priced desktops natural:

| Usage profile (ASSUMPTION) | Provider cost/mo | Retail at cost × 2.0 (ASSUMPTION markup) | Gross margin |
|---|---|---|---|
| Casual: 20 hr/mo, m7i.xlarge + 100 GB EBS | $4.00 + $8.00 = $12.00 | $24 (or bundled in Power tier) | ~50% |
| Dev: 60 hr/mo, m7i.2xlarge + 150 GB EBS | $24.19 + $12.00 = $36.19 | $72, or $0.99/hr + $12/mo storage | ~50% |
| GPU: 40 hr/mo, g4dn.xlarge + 150 GB EBS | $21.04 + $12.00 = $33.04 | ~$66, or $1.29/hr + storage | ~50% |
| Always-on (discourage) | $294+ | — | Sell reserved/Savings-Plan pass-through + 20–30% instead |

Model rules:
1. **Hourly metered + monthly storage fee**, surfaced live in-app (the cost readout the design
   already requires must match the invoice — CD-4 acceptance in `AWS-ARCHITECTURE.md`). Honest
   metering is itself a differentiator vs Shadow-style flat plans.
2. **Hibernate-by-default** (auto-hibernate on idle) is the margin protector: idle burns only EBS.
3. **2× markup on compute, ~1.5× on EBS storage** — **ASSUMPTION**; sanity-checked against Shadow:
   the casual profile lands under Shadow's $30 price with better economics for light users.
4. Per-run hard caps from the capability registry (Q5 "cap first, tune later") bound the downside of
   a runaway desktop exactly like the chat circuit breaker bounds LLM spend.

---

## 5. Summary recommendations (for the VC conversation)

1. **Subscription-first**: Free (local-inference-powered) / Pro ~$20–25 / Power ~$50, with the
   existing cost-cap settings as the literal tier mechanism. All prices ASSUMPTION pending discovery.
2. **Storage is bundled, never a $/GB SKU**; drive COGS ~$11–20/mo per 500 GB dual-stored user at
   list prices; pick B2 or R2 for the replica; egress is the line to watch.
3. **Compute credits: own-fleet pooling now (C1, $0 COGS), open marketplace explicitly deferred (C2)**
   with named gates; closed-loop non-cash credits only.
4. **Desktops: metered cost-plus (~2× compute markup) with auto-hibernate**, never flat-rate; provider
   abstraction retained (Hetzner's 2026 repricing is the cautionary tale).
5. The metering/caps substrate that already exists in the repo is the connective tissue of the whole
   model — lead with it.

---

## Sources

- Storage: https://www.backblaze.com/cloud-storage/pricing · https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/ · https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/ · https://devopsboys.com/blog/cloudflare-r2-vs-aws-s3-vs-backblaze-b2-2026 · https://infratally.com/articles/backblaze-b2-vs-aws-s3-2026/ · https://supabase.com/pricing · https://supabase.com/docs/guides/storage/s3/compatibility · https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html
- Subscription anchors: https://www.sentisight.ai/ai-price-comparison-gemini-chatgpt-claude-grok/ · https://www.aipricing.guru/compare/chatgpt-plus-vs-claude-pro/ · https://www.vendr.com/marketplace/superhuman · https://www.spliiit.com/en/blog/google-one-abonnement-stockage-prix · https://www.cloudwards.net/dropbox-vs-google-drive-vs-onedrive/
- GPU marketplaces: https://www.gpunex.com/blog/sell-computing-power-best-platforms/ · https://vast.ai/hosting · https://earnifyhub.com/learning-guides/make-money-renting-out-gpu-2026
- Desktops/compute: https://instances.vantage.sh/aws/ec2/g4dn.xlarge · https://instances.vantage.sh/aws/ec2/m7i.2xlarge · https://www.usage.ai/blogs/aws/ec2/pricing/ · https://tech-insider.org/shadow-pc-vs-geforce-now-2026/ · https://shadow.tech/us/ · https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/ · https://northflank.com/blog/hetzner-cloud-server-price-increases · https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/ · https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html
- Repo: `packages/db/src/schema/chat-cost-ledger.ts` · `apps/email-listener/app/settings.py` · `apps/email-listener/app/domain/services/cost_circuit_breaker.py` · `packages/capabilities/src/capability.ts` · `.planning/research/e7-inference/ARCHITECTURE.md` · `.planning/research/cloud-desktop/AWS-ARCHITECTURE.md` · `.planning/research/2026-07-22-ecosystem/app-packages.md` · `.planning/research/2026-07-22-cost-reliability.md`

**Labeled assumptions (consolidated):** all tier prices and tier contents; 0% CAS dedup credit;
versioning multiplier 1.2–2×; marketplace take rate 15–25%; verification overhead 10–30%; pooled-supply
effective utilization <50%; desktop usage profiles and 2×/1.5× markups; credits treated as closed-loop
loyalty-point-like instruments (legal analysis deferred to tracks 02/06).
