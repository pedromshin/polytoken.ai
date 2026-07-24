# Distributed Inference — Prior Art, Hard Parts, and a Spike Scope

**Lane:** Research (system assessment fan-out, 2026-07-24)
**Scope:** Prior art for the "contribute compute for credits, run/share across your own devices" shape;
unpack the hard parts *before* any build proposal; recommend as a **spike, not a feature**; name honest
kill-risks.
**Read-only.** No source touched.

---

## 0. TL;DR judgment

The repo has already done more honest thinking about this than most seed-stage companies
(`.planning/research/e7-inference/ARCHITECTURE.md`, `.planning/research/business/04-business-model.md §3`).
The internal split — **C1 own-fleet pooling** vs **C2 open marketplace** — is exactly the right
fracture line, and prior art confirms it hard. My independent contribution:

1. **C1 (own-fleet) is not "distributed inference" in the sense that has killed companies.** It is a
   job router over daemons the *same person* owns. It has **no market, no trust boundary, no
   payments surface, no proof-of-inference problem** — every landmine below is defined by a
   *stranger* on the other side of the wire, and C1 has no stranger. It is a Pro-tier product
   feature that *populates a seam that already exists in code* (`remote-peer` locus, reserved and
   unused — verified at `apps/email-listener/app/domain/services/chat_model_registry.py:6,30`).

2. **C2 (open marketplace) is a company, not a feature, and every consumer-scale success is the
   *centralized* shape, not the decentralized one.** Salad and Vast.ai work; Petals is effectively
   moribund; exo is explicitly not production-ready (Oct 2025); Bittensor is riddled with incentive
   gaming. The decentralized/trustless framings are research and ideology, not businesses.

3. **C2 is *incoherent with polytoken's own privacy stance on consumer hardware by construction.***
   GPU TEEs (the only real answer to "prompt privacy on a stranger's box") exist on **datacenter
   H100/H200 only**. Consumer GPUs — the entire "idle machines" supply story — have **no TEE**. So
   the exact hardware C2 wants to recruit cannot run the confidential-compute answer C2 requires. This
   is not a maturity gap that time closes; it is a hardware fact.

**Recommendation:** Ship C1 as the near-term move, scoped as a **routing + failure-handling spike**
(§6). Park C2 explicitly with named gates. Do not fold the two into one roadmap item — they share a
tier name (`remote-peer`) and nothing else.

---

## 1. Prior art — who tried this shape, what happened

I sort by *what actually killed or constrained each*, because that is the reusable lesson.

### The decentralized / trustless camp (ideologically pure, commercially unproven)

| Project | Shape | What worked | What killed / caps it |
|---|---|---|---|
| **Petals** (BigScience/Yandex) | BitTorrent-style layer-sharding of one model across volunteer GPUs; each node holds a block, passes activations. | Proved BLOOM-176B *can* be served on commodity GPUs (~1 step/s). Landmark research. | Effectively **moribund**. Volunteer supply never became a service; activation-passing latency across the WAN is brutal; a single slow/churning node in the pipeline stalls the whole forward pass. A demo, not a product. |
| **exo** | Pool your *own* phones/laptops/desktops into one cluster; partition model by device RAM. | Genuinely runs 70B+ across heterogeneous home devices; the "own devices" ergonomics are the closest analog to polytoken C1. | **Oct 2025 analysis: not production-ready** — critical gaps in security, fault tolerance, operational tooling. Needs aggregate RAM to hold the *whole* model. Strongest path is Apple Silicon; Linux still CPU-only. R&D-grade. |
| **Bittensor** | Token-incentivized subnets; miners serve inference, validators score, TAO rewards. | Large market cap, real subnet ecosystem, ongoing. | **Incentive gaming is the dominant failure mode**: weight-copying validators, memetic subnet exploitation, low-quality outputs, a May 2025 overload incident, a malicious PyPI attack. The economics reward gaming the scorer, not serving good inference. A cautionary tale for *any* credit-for-compute scheme. |
| **Gensyn** | Trustless *training* with cryptographic proof-of-learning ("Verde", bitwise reproducibility) on an ETH rollup. | Mainnet Apr 2026; a16z-backed ($43M A). The most serious attempt at *verifiable* decentralized compute. | Training, not inference; years and a rollup to make verification tractable. Proof that "verify a stranger's GPU work" is a *multi-year cryptography research program*, not a sprint. |
| **prima.cpp / distributed-llama** | llama.cpp-family clustering of 30-70B across low-resource home nodes. | Real speedups on heterogeneous home clusters. | Same class as exo — hobbyist/research, LAN-optimal, no trust or payment layer. |

### The centralized-marketplace camp (this is the shape that actually works)

| Project | Shape | Take rate / economics | The reusable lesson |
|---|---|---|---|
| **Salad** | Centralized broker over ~450k–1M *consumer* idle GPUs ("Chefs"); Salad schedules, bills, and eats the churn. | ~20–25% take; host earns ~$0.30–0.60/hr. | **The only consumer-idle model at scale — and it is centralized.** Salad is trusted middleware; Chefs never talk to each other or to renters. Its take rate is 2× Vast precisely because *flaky consumer supply costs the platform* (over-provisioning, redundancy). |
| **Vast.ai** | P2P GPU marketplace; renters bid on host hardware. | ~10–15% take; host earns ~$0.55–1.50/hr. | Solved cold-start with **years of crypto-miner supply overhang** — a bootstrap advantage polytoken does not have. |
| **io.net / Akash / Together / Fireworks** | Aggregate *datacenter* GPUs into clusters (io.net on Solana; Akash a Cosmos cloud market). ~50–70% below hyperscaler on-demand. | ~$200M annualized *sector* protocol revenue early 2026 (DeFiLlama/Dune) — small. | These are **not consumer-idle**; they aggregate bare-metal/datacenter supply. When you need reliability you end up back at datacenter hardware — which is just cheaper cloud, not "idle machines for credits." |
| **Ray / Ray Serve, vLLM, llama.cpp clustering** | Orchestration frameworks, not networks. | n/a | The *plumbing* is solved and open; the hard part was never the sharding code. It is the market, trust, and payments around it. |

**The single most important prior-art fact:** every system that turned *consumer idle compute into a
business* (Salad, Vast) is a **centralized broker**, and each **solved cold-start with pre-existing
crypto-miner supply**. Every *decentralized/trustless* attempt (Petals, exo, Bittensor) is research,
ideology, or an incentive-gaming casino — none is a healthy inference *business*. If polytoken ever
does C2, it should be Salad-shaped (polytoken as trusted broker), not Petals-shaped — and it still
inherits Salad's cold-start problem *without* Salad's miner overhang.

---

## 2. Hard part: verifying work was actually performed (proof-of-inference)

The core question: a paid node returns tokens — did it actually run the model you paid for, at the
precision you paid for, or did it run a cheaper quant / a smaller model / return garbage? (This is a
real, measured attack surface — "model substitution in LLM APIs" is an active 2025 audit topic.)

Four families, none free:

| Approach | Status 2025–26 | Cost | Verdict for polytoken |
|---|---|---|---|
| **ZKML** (zero-knowledge proof of the forward pass) | **Impractical** for modern generative models; forces quantization → accuracy loss; proof generation dwarfs inference. | Absurd | Not viable this decade for chat-class models. |
| **opML / optimistic fraud proofs** | Post result, challenge window, validators recompute on dispute. Real (used on-chain). | Adds latency + a validator set + a dispute economy. | Overkill; assumes an adversarial open network — the thing C1 doesn't have. |
| **PoSP / Proof-of-Sampling** (Nash-equilibrium spot-checking) | Redundantly recompute a *sample* of jobs; make honesty the equilibrium. | **10–30% margin overhead** (matches the repo's own §3c assumption). | The pragmatic pick *if* you must have an open network — but it eats the already-thin consumer-node margin. |
| **TEE attestation** (run inside a hardware enclave, attest the binary) | Real and fast on **datacenter** GPUs (H100/H200: 95–99% of native perf, 2025 benchmarks). | Low compute overhead — but see §3: **no consumer GPU has it.** | The best answer that *cannot run on the target supply.* |

**The verifiability trilemma** (2025 framing): a decentralized inference network can optimize for at
most two of {trustlessness, low verification cost, generality}. Everyone who has shipped picks a
corner and pays for the third.

**C1 sidesteps all of this.** You do not verify your own laptop. Proof-of-inference is a *C2-only*
tax, and it is a heavy one.

---

## 3. Hard part: privacy of prompts on third-party hardware (the polytoken-specific landmine)

Polytoken's stated routing law is "never silently up in data-exposure" (`e7-inference` §1). Its prompts
are **email-derived** — some of the most sensitive text a user owns.

- **Routing that content to a stranger's GPU is a strictly larger exposure than any hosted API with a
  DPA.** A hosted provider is contractually bound and audited; a random Salad-Chef box is not.
- The only real technical answer is a **GPU TEE** (encrypted prompts, sealed enclave, attested
  binary). In 2025 this is production-viable — **on H100/H200 datacenter GPUs**, at ~95–99% of native
  performance (Phala/NVIDIA benchmarks; live on OpenRouter via Phala).
- **Consumer GPUs have no equivalent.** The RTX-4090-class hardware that *is* the entire "idle
  machines" supply story cannot run a confidential enclave. So the confidential-compute answer C2
  needs is unavailable *on the exact hardware C2 is built to recruit.*

**Consequence:** C2 over consumer hardware is **incoherent with polytoken's own privacy stance by
construction**, not by immaturity. The only privacy-clean C2 variants are: (a) restrict pooled jobs to
*non-sensitive* workloads only (severely limits the use case), or (b) recruit *datacenter* TEE
hardware — at which point you are io.net, not "idle machines for credits," and the whole consumer pitch
evaporates. **C1 sidesteps this too:** the user's own fleet is the user's own trust domain.

---

## 4. Hard part: scheduling / routing / heterogeneity

- **Churn.** Consumer nodes sleep, drop Wi-Fi, start a game. Salad's ~2× take over Vast is the
  *market's own measurement* of what flaky supply costs a broker. Effective utilization of *pledged*
  supply is well under 50% (repo §3c assumption, directionally confirmed by why Salad over-provisions).
- **Liquidity fragmentation.** Matching is per (model-class × latency tolerance × trust tier). Each
  cell needs its own liquidity; a small network has thin cells and bad UX in all of them.
- **Latency of sharding.** Petals' whole lesson: WAN activation-passing across a pipeline means one
  slow hop stalls the token stream. Cross-region LLM serving is an active research area
  (load-balancing, failure recovery) precisely because it is hard.
- **The good news for C1:** the internal design already reduces this to *"route the job to the
  least-loaded daemon in the user's own fleet"* (`ARCHITECTURE.md §1` Tier C default). That is a
  bounded, solvable scheduling problem — LAN-ish, same-owner, small N — not a two-sided matching
  market. exo/Parallax are named as *optional sharding bindings* behind the port, not the core.

---

## 5. Hard part: credits, and whether they create a payments / money-transmission problem

This is a bright legal line, and the repo's instinct is correct:

- **Closed-loop, earn-in-product/spend-in-product, non-redeemable credits ≈ loyalty points → low
  risk.** No cash-out, no transmission.
- **The moment a credit is redeemable for cash (or cash-equivalent), money-transmission / stored-value
  rules can attach.** In the US this is federal (18 U.S.C. § 1960 — running an unlicensed money
  transmitting business is a **felony**) *and* per-state (49 states license money transmitters, MTL
  regimes vary). "Prepaid access / stored value" is explicitly named MSB activity. This is not a
  parking-lot risk; it is criminal-statute territory.
- A credit that a user *earns by contributing compute* and can *convert to value* is the exact fact
  pattern regulators scrutinize. Even framing it as a token doesn't help — convertible virtual
  currency has its own FinCEN regime.

**Recommendation (already the repo's, and I endorse it strongly):** credits are **denominated in
polytoken's own unit, purchasable but never redeemable, earn-in / spend-in only.** The instant anyone
proposes cash-out, that is a legal/compliance workstream (tracks 02/06), not an eng ticket. *Not legal
advice — flag for counsel before any redeemable design.*

---

## 6. Hard part: hardware-optimal model recommendation

Smaller than the others but real, and it is the *genuinely valuable* piece that survives even if C2
never ships:

- Given a node's (VRAM, RAM, accelerator, OS), recommend the largest model class it can serve at
  acceptable tok/s. This is a **static capability-probe + a lookup table**, refreshed as the runtime
  landscape churns (it churns monthly — the repo's own doc warns of this).
- Prior art is the runtime layer, not a network: Ollama's model/hardware fit heuristics, llama.cpp
  quant tables, MLX for Apple Silicon, the ACM 2025 "idle consumer GPUs for LLM inference" cost/carbon
  analysis. Consumer 4090 clusters give up to ~75% lower token cost than H100 for *batched /
  latency-tolerant* work — which tells the router: **send low-urgency big-model jobs to weak nodes,
  keep interactive jobs on strong nodes or hosted.** That is exactly VISION E7's task-profile→node-
  profile matching, and it is useful *within a single user's own fleet* (C1) with zero market.
- This belongs behind the `InferenceProvider` port as a capability probe. It is the least risky,
  most-reusable sub-problem in the whole epoch.

---

## 7. Recommendation — scope as a SPIKE, not a feature

### Do now (C1 own-fleet): a bounded spike, ~1–2 weeks

**Goal:** activate the reserved `remote-peer` locus as *"route an inference job to the least-loaded
daemon among the user's own registered devices, fall back to hosted on failure."* Nothing else.

Spike deliverables (time-boxed, throwaway-friendly):
1. **Capability descriptor + port:** `inference.run` as a `defineCapability()` with an injected
   `InferenceProvider`, mirroring the existing `DesktopProvider` pattern
   (`packages/capabilities/src/desktop.ts`). No new framework.
2. **Hardware capability probe** (§6): a node advertises (VRAM/RAM/accel/OS) → largest servable model
   class. Static table, behind the port.
3. **Least-loaded routing + the failure ladder:** the router walks A→D and falls *down* toward hosted
   on unavailability, never silently *up* in data-exposure (`ARCHITECTURE.md §1`). Prove the fallback,
   because a churning own-node is the *only* failure mode C1 has.
4. **Exit criteria = go/no-go on C2, not "ship C2":** measured tok/s over LAN vs hosted; how badly a
   mid-request node drop degrades UX; whether real users even own a second capable machine (demand
   signal). If most users have one device, C1's whole premise is thin — find that out cheaply.

**Why a spike:** the runtime landscape churns monthly (the repo says so); the *value* is learning
whether own-fleet routing is worth the failure-handling complexity, not committing to a framework whose
version pins rot in a quarter.

### Park explicitly (C2 open marketplace): a company, gated

State it in any pitch as **optionality, not roadmap**, gated on ALL of:
- (a) Node count from C1 adoption large enough to have a supply side at all (cold-start unsolved — no
  miner overhang).
- (b) A **confidential-compute answer that works on the actual supply** — which, per §3, means either
  datacenter TEE hardware (→ you're io.net) or a hard restriction to non-sensitive jobs. There is no
  consumer-GPU version.
- (c) A **verification budget** you can afford (PoSP-class 10–30% margin tax) — margins that are
  cents/hour of consumer-node gross to begin with.
- (d) **Closed-loop non-redeemable credits** confirmed with counsel.

---

## 8. Honest kill-risks (the ones that end C2 — and the residual C1 ones)

**C2 kill-risks (any one is close to fatal):**
1. **Cold-start with no overhang.** Salad/Vast bootstrapped on years of crypto-miner supply.
   Polytoken has none. No supply → hosts earn nothing → supply leaves → death spiral. *Most likely
   killer.*
2. **Privacy contradiction is structural, not temporal** (§3). Consumer GPUs have no TEE. C2 over
   idle consumer hardware cannot honor polytoken's own privacy law. Time does not fix a hardware fact.
3. **Margins are cents/hour of consumer gross**, and verification (§2) plus over-provisioning for
   churn (§4) eat most of it. The take-rate math (§3b) makes C2 a *retention* feature at best, never a
   revenue line until node count is huge — and node count won't be huge (see #1).
4. **Incentive gaming** (Bittensor's lesson): any credit-for-compute scheme invites gaming the scorer
   over serving good inference. You inherit a policing cost forever.
5. **Payments/regulatory** (§5): one redeemable-credit decision turns a product into an MSB with
   felony exposure.

**C1 residual risks (survivable, worth the spike to learn):**
- **Demand may not exist:** many users own exactly one capable machine → nothing to pool → C1 is a
  feature with no audience. The spike's cheapest and most important finding.
- **Failure-handling complexity:** a mid-request own-node drop must degrade gracefully to hosted; get
  this wrong and it's worse than never offering it.
- **Framework churn:** anything pinned (Ollama/exo/Parallax/WebLLM versions) rots monthly — which is
  *why* it lives behind a port and *why* this is a spike.

---

## 9. Evidence — files and sources

**Repo (verified this session):**
- `apps/email-listener/app/domain/services/chat_model_registry.py:6,30` — `ExecutionLocus` includes
  `"remote-peer"`, comment "reserved, unused today." The C1 seam is real and unfilled. (All other
  registered models are `execution_locus="server"` or `"browser"`.)
- `.planning/research/e7-inference/ARCHITECTURE.md` — internal design; §0 (seam-populate framing),
  §1 (A→D tier ladder), Tier C default = "route to least-loaded daemon in user's own fleet."
- `.planning/research/business/04-business-model.md §3` — C1/C2 split, take-rate comps
  (Vast ~10–15%, Salad ~20–25%), verification-overhead and <50%-utilization assumptions, closed-loop
  credit recommendation.
- `.planning/research/polytoken-vision/VISION.md §E7` — "LAST, HARDEST"; explicitly deferred; "company-
  sized problem on its own."
- `packages/capabilities/src/capability.ts`, `packages/capabilities/src/desktop.ts` — the
  `defineCapability` + injected-port pattern C1 reuses.

**External (2025–26):**
- Petals — decentralized inference/finetuning (Yandex Research; ResearchGate 372915450).
- exo not-production-ready (Oct 2025): toolhalla.ai EXO guide; aicoolies exo review; prima.cpp
  (arXiv 2504.08791).
- Bittensor incentive gaming: emoryblockchain.substack.com "State of Bittensor in 2025";
  docs.learnbittensor.org incentive-mechanism.
- Gensyn Verde / proof-of-learning; io.net vs Akash (io.net/blog); DePIN sector revenue (Medium/Janction).
- Proof-of-inference: PoSP (arXiv 2405.00295), opML/ZKML survey (gate.com "6 AI Verification Solutions
  2025"), Verifiability Trilemma; model-substitution audit (arXiv 2504.04715).
- GPU TEEs: Phala H100 confidential-computing benchmark (95–99% native); NVIDIA confidential computing;
  Phala on OpenRouter.
- Consumer GPU economics: Salad (450k–1M nodes, ~90% cost cut); ACM 2025 "Idle Consumer GPUs for LLM
  Inference" (3775043.3775047); gpunex/earnifyhub take-rate data.
- Money transmission: 18 U.S.C. § 1960; FinCEN MSB center (irs.gov); v-comply/ridgewayfs MTL guides;
  FinCEN convertible-virtual-currency rulemaking.
