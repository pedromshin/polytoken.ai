# Distributed Inference & Compute-Credit Economy — Deep Research

> **Status:** RESEARCH, 2026-07-22. Responds to Pedro's vision prompt
> `.planning/prompts/2026-07-22-vision-and-handoff.md` §7 ("users start providing an LLM and
> earning credits… other users join in and share gains… open website / desktop app / phone web
> app on different devices anywhere on the planet, choose or be recommended a model optimal for
> their hardware… use idle compute to gain credits").
> **Relationship to prior thinking:** builds ON, does not replace,
> `.planning/research/e7-inference/ARCHITECTURE.md` (the implementation-ready E7 design, tier
> ladder A–D, `inference.run` capability + `InferenceProvider` port). That doc deliberately parked
> the **cross-user credits** question [VISION §E7; ENDGAME-PLAN §4]. This doc unpacks exactly that
> parked question, plus the new **multi-device optimal-model-recommendation** ask, against the
> 2026 landscape. Where the two docs touch the same ground (framework picks), this doc defers to
> ARCHITECTURE.md and only re-verifies or adds.
> All external claims carry source URLs (§9). Assumptions are labeled **ASSUMPTION**.

---

## 1. What the vision prompt actually asks (parsed)

Pedro's 2026-07-22 prompt adds three asks beyond the E7 architecture already on file:

1. **Provider-side credit economy:** "a user to start providing an LLM and earning credits for
   it, then other users can join in and share gains (a lot of complexity we will want to unpack
   carefully here)."
2. **Multi-device optimal model selection:** "open website, desktop app, and phone web app each
   in a different device anywhere on the planet and be able to choose or be recommended a model
   that will be optimal for their hardware and other relevant setups."
3. **Simultaneous multi-device sharing + opt-in idle compute:** "run and share optimally for all
   three using at the same time, or not all — they may or may not choose to use idle compute to
   gain credits to use themselves (for better or heavier compute models)."

These decompose into problems of very different difficulty. (2) is a weekend-to-weeks problem.
(3)'s same-user fleet half is E7-4 as already designed. (1) is — as VISION §E7 already said — a
company-sized problem, and the 2026 evidence gathered below makes that judgment *stronger*, not
weaker.

---

## 2. Complexity unpack — the ten distinct subproblems inside "earn credits for your LLM"

The credit-economy sentence hides at least ten separable subsystems. Listing them is the honest
way to see why every serious attempt at this became its own company:

| # | Subproblem | Own-fleet (same user) | Cross-user open pool |
|---|---|---|---|
| 1 | **Node discovery & connectivity** (NAT traversal, relays, presence) | Easy — daemon already holds an outbound WebSocket to the cloud | Hard — need relay/TURN infra or accept cloud-relayed traffic for all tokens |
| 2 | **Capability detection & model placement** (what can this node run?) | Easy — daemon probes hardware honestly | Medium — nodes can lie about hardware; needs benchmarking-on-join |
| 3 | **Scheduling** (task profile → node profile) | Medium — least-loaded routing, already designed (E7-4) | Hard — churn, stragglers, geographic latency, adversarial nodes |
| 4 | **Streaming transport** (tokens back to requester) | Solved shape — `streamId`-keyed frames on the frozen daemon wire [E7 §2.3] | Same shape, but through untrusted intermediaries |
| 5 | **Metering** (who computed how much) | Easy — `chat_cost_ledger` pattern with `execution_locus` already exists (`apps/email-listener/app/domain/ports/cost_ledger_repository.py`) | Hard — meter must be tamper-evident; provider has incentive to inflate |
| 6 | **Verification** (did the node actually run the model it claims?) | Skip — you trust your own machines | Unsolved at practical cost (see §4.2) |
| 7 | **Privacy of the PROMPT** (requester's data on a stranger's GPU) | Non-issue — `dataLocality: "user-owned"` | Fundamental — prompts are plaintext on the provider's machine; TEEs are the only real answer and they're datacenter-class hardware |
| 8 | **Credit economics** (issuance, pricing, exchange rate, sinks) | N/A | Hard — see §4.1; the DePIN graveyard is full of this |
| 9 | **Payments/regulatory** (cash-out, money transmission, tax) | N/A | Hard — cash-out turns polytoken into a payments company |
| 10 | **Model licensing** (may user X serve model Y to user Z?) | Low risk (personal use) | Real risk — e.g. Llama-family licenses restrict redistribution/serving terms; prefer MIT/Apache weights (DeepSeek V4 is MIT, Qwen is Apache) [E7 §1.D sources] |

**Key structural observation:** columns 2 and 3 are different products. Everything in the
own-fleet column is buildable on the existing substrate (daemon protocol frozen 2026-07-16, 12
MsgTypes, additive tool arms — `packages/daemon-protocol/src/envelope.ts`, `tools.ts`). Everything
hard lives exclusively in the cross-user column, and *none of it* blocks the own-fleet value.

---

## 3. Landscape (2026), verified

### 3.1 Sharding / pooling runtimes

- **Petals** (bigscience-workshop) — BitTorrent-style layer-hosting across volunteers; still alive
  in 2026 (Llama 3.1 405B, Mixtral 8x22B on the public swarm), with a recent architecture rework
  claiming lower latency. Remains the reference for *stranger-pooled* inference — and also the
  reference for its costs: public-swarm latency is interactive-marginal (~single-digit tok/s
  historically), no privacy for prompts against block hosts, and no economic layer at all (pure
  volunteerism). Sources: https://github.com/bigscience-workshop/petals , https://petals.dev/ ,
  https://research.yandex.com/blog/petals-decentralized-inference-and-finetuning-of-large-language-models
- **exo (exo-explore) 1.0** — auto-discovery mesh over the user's OWN devices; 2026 release adds
  RDMA over Thunderbolt 5 (~99% transport-latency reduction, macOS 26.2) and demonstrated
  *disaggregated* serving (prefill on 2× DGX Spark, decode on M3 Ultra Mac Studio, 2.8× benchmark
  gain). OpenAI-compatible API. It is a **LAN/fleet** tool, not an internet pool. Sources:
  https://github.com/exo-explore/exo ,
  https://www.tomshardware.com/software/two-nvidia-dgx-spark-systems-combined-with-m3-ultra-mac-studio-to-create-blistering-llm-system-exo-labs-demonstrates-disaggregated-ai-inference-and-achieves-a-2-8-benchmark-boost
- **llama.cpp RPC** — pools memory over TCP so a model too big for one box can run; explicitly
  *not* a speedup (every tensor op pays a network round-trip; fine under ~5 ms LAN ping, dead over
  WAN); workers default to localhost and must be VPN'd (Tailscale) for cross-machine use. 2026
  field reports: ~60 tok/s on a 122B across 2 nodes / 88 GB VRAM on fast LAN; 4× AMD Ryzen AI
  Max+ 395 boxes running a 375 GB model. Break-glass tool, never the default — matches E7 §1.C's
  call. Sources: https://github.com/ggml-org/llama.cpp/discussions/12974 ,
  https://github.com/kjaiswal/llama-cpp-distributed-benchmarks ,
  https://www.amd.com/en/developer/resources/technical-articles/2026/how-to-run-a-one-trillion-parameter-llm-locally-an-amd.html
- **Parallax (GradientHQ)** — pipeline-parallel decentralized serving over ordinary internet,
  heterogeneous hardware, OpenAI-compatible; the credible "sharding over WAN" binding
  [E7 §1.C; https://github.com/GradientHQ/parallax , https://arxiv.org/abs/2509.26182].
- **vLLM / SGLang** — single-org GPU-server serving (PagedAttention, continuous batching). Matters
  here only as: the runtime a *serious* provider node would run, and the reason hosted open-weight
  tokens are so cheap (see §4.1). Not a P2P system.
- **Ollama** — the default daemon binding (E7 §1.B): auto-detects GPU, auto-splits layers
  GPU/CPU when VRAM is short, OpenAI-compatible endpoint; wraps llama.cpp on x86 and MLX on Apple
  Silicon. Its hardware handling is also the model for daemon-side capability detection (§6).
  Sources: https://localaimaster.com/blog/ollama-system-requirements ,
  https://eastondev.com/blog/en/posts/ai/20260528-ollama-hardware-guide/
- **WebLLM (MLC)** — already shipped in this repo: `apps/web/src/app/chat/_hooks/use-webllm-engine.ts`
  runs `Qwen3-4B-q4f16_1-MLC` via `@mlc-ai/web-llm` 0.2.84 as a module-level singleton, WebGPU
  feature-detected, text-only, $0 in the cost ledger (D-08), registry id `webllm-qwen3-4b`.
  2026 state of the art: browser WebGPU inference reaches ~80% of native speed; practical model
  cap ≈ 8B params, sweet spot 0.5–3B at Q4. Sources: https://localaimaster.com/blog/webllm-browser-ai-guide ,
  https://www.sitepoint.com/best-local-llm-models-2026/

### 3.2 Compute-credit economies — what the field teaches

**Crypto/DePIN (Render, Akash, io.net):** the 2026 record is a cautionary tale, not a template.

- **Supply is coupled to token price.** Providers paid in a floating token unplug when the token
  drops below their break-even: io.net's verified GPU count fell with its token; Akash GPU
  capacity contracted **>57% quarter-over-quarter into Q1 2026** as rewards tightened. Your
  compute supply evaporates exactly when you can least control it. Sources:
  https://blockeden.xyz/blog/2026/04/12/depin-revenue-pivot-token-subsidies-ai-compute-akash-render-ionet/ ,
  https://ownyourmind.ai/tokenomics/render-vs-akash-vs-ionet/
- **Subsidy-first economics defer the only question that matters** — who pays? Years of
  token-emission-funded "growth" are now being repriced as emissions decline; only
  demand-revenue-backed networks survive the transition. Source:
  https://blockeden.xyz/blog/2026/02/07/decentralized-gpu-networks-2026/
- **Verifiability gap:** revenue/supply self-reporting (io.net) vs audited on-chain (Akash) vs
  undisclosed (Render) — trust infrastructure is expensive and mostly still missing.

**Non-crypto marketplaces (Vast.ai, Salad):** these actually work, and they price the ceiling of
what a provider can ever earn. RTX 4090 gross earnings: **$0.55–1.50/hr on Vast (10–15% fee),
$0.30–0.60/hr on Salad (20–25% fee)**; Vast requires real ops skill, Salad is turnkey but takes
the biggest cut. Both are *fiat-denominated, escrow-brokered, container-workload* markets — no
token. Sources: https://www.gpunex.com/blog/sell-computing-power-best-platforms/ ,
https://gpuperhour.com/compare/salad-vs-vastai , https://getdeploying.com/vast-ai

**Contribute-for-stake (Prime Intellect):** contributors provide compute/rollouts, verified via
**TOPLOC** (locality-sensitive hashing over activations — lightweight tamper detection, not a
proof), coordinated by orchestrator/validator roles, with testnet smart-contract payouts. The
closest live analogue to "provide inference, earn credits," and it took a venture-funded company
building a full protocol stack (workers, validators, orchestrators, SHARDCAST) to do it. Sources:
https://arxiv.org/html/2501.16007v1 , https://www.gate.com/learn/articles/open-ai-founding-members-invest-a-quick-dive-into-the-decentralized-ai-breakthrough-prime-intellect/7323 ,
https://sacra.com/c/prime-intellect/

### 3.3 Verification of remote inference (the trust problem, 2026)

- **zkML is still economically infeasible for LLM serving:** zkLLM-class proofs take ~986 s to
  generate for a single LLaMA-2-13B inference (~13 min, 100× slower than the inference itself);
  a 2,000-token response would take ~23 days to prove. Newer schemes (TensorCommitments, ~1%
  prover overhead; VeriLLM's isomorphic verify-while-serving) are promising *papers*, not
  deployable infrastructure. Sources: https://arxiv.org/html/2602.12630 ,
  https://arxiv.org/html/2509.24257 , https://arxiv.org/pdf/2504.13443
- **Practical menu today:** (a) trust circles — skip verification inside them; (b) redundant
  spot-checking — re-run a sample of requests on a trusted node and compare (probabilistic,
  ~N% compute overhead); (c) TOPLOC-style activation hashing — cheap, catches model/precision
  swaps, requires cooperative protocol; (d) TEE attestation — NVIDIA H100/H200/B200 confidential
  computing with remote attestation — real, but datacenter hardware, not consumer laptops.
  Source: https://www.spheron.network/blog/confidential-gpu-computing-nvidia-tee-encrypted-vram/
- **The dual problem is prompt privacy:** even a *correctly* computing provider reads your prompt.
  For polytoken — whose defensible stance is privacy-as-routing-input (`maxDataLocality` hard
  floor, E7 §5) — sending user prompts to strangers' GPUs is a product contradiction unless the
  request is explicitly marked shareable.

---

## 4. Honest feasibility assessment

Verdicts by tier, calibrated against repo reality (v1.9 Band 1 live-loop gate not yet green;
daemon protocol exists and is frozen; `remote-peer` locus reserved-unused in
`apps/email-listener/app/domain/services/chat_model_registry.py`; tenancy still single-user):

| Capability | Verdict | Why |
|---|---|---|
| Browser model + hardware-aware recommendation | **FEASIBLE NOW, cheap** | WebLLM already shipped; recommendation is a pure function over `navigator.gpu` adapter limits + `navigator.deviceMemory` + `storage.estimate()` (§6). No new infra. |
| Daemon-local inference (Ollama binding) | **FEASIBLE, planned** | E7-3 design is implementation-ready; additive `"inference.run"` arm on `toolNameSchema` is frozen-contract-legal. Gated on v2.0 daemon shipping. |
| Own-fleet pooling (job-routing, N daemons) | **FEASIBLE, medium effort** | E7-4 as designed. The cloud already terminates every daemon's outbound socket — routing is a control-plane feature, no P2P networking needed. |
| Own-fleet sharding (exo/Parallax binding) | **FEASIBLE, niche** | Only for "model won't fit any single node." LAN-quality links required for interactive use. Provider-swap behind the port, per E7 §3. |
| Phone as inference *provider* | **NOT VIABLE** | **ASSUMPTION with strong support:** phone browsers cap at small models (WebGPU mobile limits, thermal throttling, tab lifecycle kills long-lived serving, battery, NAT). Phones are *consumers* with an on-device tier, not pool providers. Exception to watch: 1.58-bit ternary models (Bonsai 27B on-phone, E7 §1.A) may change the consumer side, not the provider side. |
| Cross-user credits, closed-loop (earn on own daemon → spend on hosted tier) | **FEASIBLE AS PRODUCT FEATURE, dubious as economics** | Buildable on the existing cost ledger. But see §4.1 — at small scale it is a subsidy Pedro pays, dressed as an economy. Fine *if chosen knowingly* as a growth/loyalty mechanic. |
| Cross-user open compute market (cash value, strangers, gains-sharing) | **NOT FEASIBLE for a solo-founder side-track; it is its own venture** | Requires 6+ of the §2 subproblems solved (verification, privacy, economics, regulatory, licensing, anti-fraud). Every 2026 datapoint (Prime Intellect's protocol org, DePIN supply collapses, Vast/Salad's decade of marketplace ops) says this is a company, not an epoch. VISION §E7's "venture decision at gate time" stands, reinforced. |

### 4.1 The economics problem, stated plainly

The arbitrage that would give a polytoken credit real value barely exists in 2026:

- What a consumer GPU can serve (7–32B-class models) is exactly what hosted open-weight APIs sell
  for near-zero: OpenRouter-class pricing for small open models is fractions of a cent per Mtok,
  because providers run vLLM on batched datacenter GPUs at utilization a bedroom RTX 4090 can
  never match. A credit "earned" by serving Qwen-8B on a laptop is competing against that price.
- The ceiling is measurable: even on mature, liquid markets a 4090 grosses $0.30–1.50/hr (§3.2) —
  and that's for *container workloads chosen by buyers*, with datacenter-grade uptime
  expectations. Residential electricity in much of the world eats a large fraction of the low end.
- **The closed-loop trap:** if credits earned (near-worthless compute) redeem against the hosted
  frontier tier (real dollars Pedro pays Bedrock/OpenRouter), the exchange rate either (a) makes
  credits worthless, or (b) makes the scheme a marketing subsidy. There is no third option at
  small scale. The DePIN networks hid this behind token emissions for years; the 2026 repricing
  (§3.2) is what it looks like when the hiding stops.
- **What makes it non-stupid anyway:** as a *loyalty/engagement mechanic* with explicit subsidy
  budgeting ("run your daemon, earn X hosted-tier tokens/day, capped"), it can be honest, cheap,
  and genuinely useful for bootstrapping the daemon-install base that the real E7 (own-fleet)
  needs. Denominate credits in **service units** (normalized tokens per model class), never in a
  floating asset — the single biggest lesson from the DePIN supply collapses.

### 4.2 The trust problem, stated plainly

For cross-user serving, pick a posture; each has a cost:

1. **Trust circles only** (own devices + explicitly invited peers — household, friends, team):
   verification skipped, prompt-privacy accepted by consent. **This covers ~all real near-term
   demand and costs nothing.** It also matches the coming multi-user tenancy work
   (workspaces/teams in the same vision prompt).
2. **Spot-check redundancy:** re-run ~2–5% of jobs on trusted infrastructure, slash credits on
   mismatch. Cheap, probabilistic, needs deterministic decoding config to compare (temperature-0
   replay or logprob-window comparison) — real engineering, feasible.
3. **TOPLOC-style activation commitments:** cooperative protocol change on the runtime — means
   forking/wrapping the inference engine. Months of work.
4. **TEE attestation:** excludes exactly the consumer hardware the vision wants to monetize.

**Recommendation:** posture 1 now, design the ledger so posture 2 can bolt on, ignore 3–4 until
the open-market venture decision.

---

## 6. Multi-device optimal model selection (the genuinely near-term win)

This is the most tractable ask in the prompt and it slots into the existing model-class registry
(E7 Q6: reason about classes, never ids). Design: a **DeviceProfile → recommended model class**
pure function, evaluated per surface.

### 6.1 Browser (web + phone web app)

Signals available today, no permissions needed:

- `navigator.gpu` present? → WebGPU tier possible at all (already done in
  `use-webllm-engine.ts:detectWebGpuSupport()`).
- `await navigator.gpu.requestAdapter()` → `adapter.limits.maxBufferSize` /
  `maxStorageBufferBindingSize` (hard caps on loadable weight shards) and `adapter.info`
  (vendor/architecture — distinguishes Apple/NVIDIA/Intel iGPU/Adreno). Source:
  https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html
- `navigator.deviceMemory` (Chromium, clamped to 8) + `navigator.hardwareConcurrency` — coarse
  RAM/CPU tier.
- `await navigator.storage.estimate()` — can the device even cache 2.5 GB of weights? (The
  existing hook's "~2.5GB, first run only" download is the UX cost being gated.)
- WebLLM's `prebuiltAppConfig` carries per-model `vram_required_MB` — the match is: filter
  prebuilts by required-VRAM ≤ conservative fraction of detected limits, pick largest that fits,
  with 2026 guidance capping browser models ≈8B and sweet-spotting 0.5–3B Q4. Source:
  https://localaimaster.com/blog/run-llm-in-browser
- **Progressive enhancement:** feature-detect Chrome's Prompt API (`window.ai`, stable Chrome 148)
  as a zero-download alternative when present [E7 §1.A].
- **First-token benchmark as truth:** static signals lie (driver quirks, thermals). After first
  load, record measured tok/s per device in the DB keyed by a device id; recommendations become
  empirical after one session. **ASSUMPTION:** a `device_profiles` table does not exist yet
  (nothing matching in `packages/db`); it is new, small, and tenant-scoped from day one per
  VISION guardrail 1.

### 6.2 Daemon (desktop)

The daemon probes real hardware honestly: total RAM, GPU + VRAM (nvidia-smi / Metal), CPU AVX2.
Then the boring, well-established 2026 mapping applies (Q4_K_M quantization): **8 GB → 7–8B,
16 GB → 13–14B, 24 GB+ → 32B; ~6–7 GB VRAM per 8B-Q4, ~22–24 GB per 32B**; Ollama auto-splits
GPU/CPU layers when short. Sources: https://localllm.in/blog/ollama-vram-requirements-for-local-llms ,
https://www.promptquorum.com/local-llms
The daemon reports its profile + measured tok/s through `capabilities()` on the
`InferenceProvider` port (E7 §2.1 already reserves exactly this shape) — the recommendation
function and the router read the same data.

### 6.3 "All three at the same time"

**ASSUMPTION (recommend accepting):** for interactive chat, never shard one request across
phone+laptop+desktop over WAN — llama.cpp RPC is LAN-bound, exo is LAN/Thunderbolt-bound, and
pipeline-parallel over residential WAN (Parallax) is for capacity, not latency. "Optimal for all
three simultaneously" therefore means: each *request* is routed whole to the best *single*
node/surface (phone chat → phone's on-device small model or the home daemon via cloud relay;
heavy job → strongest daemon), i.e., E7-4 job-routing plus per-device profiles. This is also
exactly what the E7 doc already concluded for the own-fleet default (§3 there).

---

## 7. Phased architecture proposal (browser-first → daemon → peer credits)

Aligned with E7-1..5 phasing; deltas marked. Everything rides the existing seams: model-class
registry (`execution_locus` axis), `defineCapability()` + `InferenceProvider` port
(`packages/capabilities/src/capability.ts`, `desktop.ts` pattern), frozen daemon wire (additive
tool arm), cost ledger with `execution_locus`.

**Phase 0 — Browser-first: device profiling + model recommendation (NEW vs E7 doc; can run
inside v1.9/v2.0 without opening the E7 epoch).**
DeviceProfile capture (§6.1) + a pure `recommendModelClass(profile)` resolver + picker UI that
says *why* ("your GPU can run the 4B model locally — private and free"). Persist measured tok/s.
Zero distributed systems risk; immediately improves the shipped WebLLM feature.
Exit criterion: recommendation shown on ≥2 real devices matches measured performance ranking.

**Phase 1 — Daemon-local inference (= E7-2/E7-3).**
`inference.run` capability + port + fail-closed default; Ollama binding behind the daemon;
additive `"inference.run"` arm in `toolNameSchema`; `streamId`-keyed streaming frames;
`daemon-local` locus + class catalogue in both registries (TS + Python, content-hash matched).
$0 ledger rows still metered — **this metering IS the future credit meter; get owner-principal
and per-run token counts right here and the credit ledger later is a view, not a system.**

**Phase 2 — Own-fleet pooling (= E7-4).**
Multi-daemon registration; least-loaded job-routing over provider `capabilities()`; privacy floor
`user-owned` enforced; per-node utilization surface ("what did my fleet do"). exo/Parallax
sharding binding stays the E7-5 opt-in for won't-fit-one-node.

**Phase 3 — Closed-loop credits pilot (NEW; the honest version of "earn credits").**
Scope: **trust circle only** (own devices + invited workspace members), **no cash-out, no token,
no strangers.** Credits denominated in service units (normalized standard-tokens per model
class). Earn: your daemon serves a request for another principal in your circle (the Phase-1/2
ledger row, attributed to provider-principal). Spend: hosted-frontier tier, at an explicit,
adjustable, *budget-capped* exchange rate (acknowledged subsidy, §4.1). Verification: none
(circle trust), with deterministic-replay spot-check hooks designed into the ledger schema but
not built. Licensing: only MIT/Apache-weight models eligible for serving-to-others.
Exit criterion: two real users in one workspace, one serving the other, ledger balanced.

**Phase 4 — Open market (NOT a phase; the venture decision).**
Strangers, gains-sharing, cash value. Requires: verification posture ≥ spot-check + TOPLOC-class,
prompt-privacy consent model or TEE providers, market-making of the credit, regulatory work
(transferable/cash-out credits ⇒ money-transmission exposure), anti-fraud, provider SLAs. Gate
unchanged from VISION/ENDGAME: daemon platform shipped + real multi-user tenancy + **demonstrated
cross-user demand from Phase 3 telemetry**. If Phase 3 shows circles never saturate their own
fleets, Phase 4 has no demand and should not happen.

---

## 8. Open questions Pedro must decide

1. **Crypto or no crypto?** Recommendation from evidence: **no token** — service-unit credits,
   centrally issued. The 2026 DePIN supply collapses (§3.2) are the argument.
2. **Cash-out or closed loop?** Closed loop avoids the payments/regulatory company. Cash-out is a
   Phase-4/venture-only question. Decide the *promise* now, because "credits" language sets user
   expectations that are hard to walk back.
3. **Trust-circle boundary for serving:** own devices only, or invited workspace peers too?
   (Phase 3 assumes peers-in-workspace; shrink to own-only if tenancy slips.)
4. **What exactly does a credit buy, and who sets the exchange rate?** Hosted tokens only, or
   also remote-desktop hours / storage? Fixed rate vs adjustable-with-notice? What monthly
   subsidy budget caps redemption?
5. **Phone as provider — accept "no"?** §4 argues phones are consumers only. If Pedro disagrees,
   that's a research fork (ternary/Bonsai-class serving), not a default.
6. **WAN sharding — accept "no" for interactive requests?** (§6.3). If yes, "all three devices at
   once" is job-routing + profiles, already designed.
7. **Licensing policy:** restrict serve-to-others to MIT/Apache weights from day one, or handle
   per-model terms? (Recommend the former; it's a registry flag.)
8. **Sequencing:** does Phase 0 (device profiling + recommendation) jump the queue into
   v1.9/v2.0 as a cheap slice, given the E7 epoch itself stays parked behind the daemon + tenancy
   gate? (It touches only the web app + registry.)
9. **Verification posture ceiling for Phase 3→4:** is deterministic spot-check replay acceptable
   as the *only* verification for invited-peer serving, or does any cross-user serving demand
   TOPLOC-class commitments before launch?
10. **Honesty surface:** do we show providers their realistic economics (electricity vs credit
    value) in-product? (Recommend yes — it's the same D-08 honesty convention that already labels
    browser models $0.)

---

## 9. Sources

**Repo (ground truth read for this doc):**
`.planning/research/e7-inference/ARCHITECTURE.md`; `.planning/research/polytoken-vision/VISION.md`;
`.planning/research/two-epoch-endgame/ENDGAME-PLAN.md`;
`.planning/prompts/2026-07-22-vision-and-handoff.md`;
`apps/web/src/app/chat/_hooks/use-webllm-engine.ts`;
`apps/email-listener/app/domain/services/chat_model_registry.py` (`remote-peer` reserved);
`apps/email-listener/app/domain/ports/cost_ledger_repository.py` (`ExecutionLocus`);
`packages/daemon-protocol/src/envelope.ts` (frozen 12 MsgTypes), `tools.ts` (additive union);
`packages/capabilities/src/capability.ts`, `desktop.ts`.

**External (fetched 2026-07-22):**
- Petals: https://github.com/bigscience-workshop/petals ; https://petals.dev/ ;
  https://research.yandex.com/blog/petals-decentralized-inference-and-finetuning-of-large-language-models ;
  https://arxiv.org/abs/2209.01188
- exo 1.0 / disaggregated demo: https://github.com/exo-explore/exo ;
  https://www.tomshardware.com/software/two-nvidia-dgx-spark-systems-combined-with-m3-ultra-mac-studio-to-create-blistering-llm-system-exo-labs-demonstrates-disaggregated-ai-inference-and-achieves-a-2-8-benchmark-boost ;
  https://noqta.tn/en/blog/exo-distributed-ai-cluster-apple-silicon-local-llm-2026
- llama.cpp RPC: https://github.com/ggml-org/llama.cpp/discussions/12974 ;
  https://github.com/kjaiswal/llama-cpp-distributed-benchmarks ;
  https://www.amd.com/en/developer/resources/technical-articles/2026/how-to-run-a-one-trillion-parameter-llm-locally-an-amd.html
- Parallax: https://github.com/GradientHQ/parallax ; https://arxiv.org/abs/2509.26182
- WebLLM/browser inference 2026: https://localaimaster.com/blog/webllm-browser-ai-guide ;
  https://localaimaster.com/blog/run-llm-in-browser ; https://www.sitepoint.com/best-local-llm-models-2026/
- WebGPU limits/detection: https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html ;
  https://webgpucheck.com/ ; https://webo360solutions.com/blog/webgpu-browser-support/
- Ollama hardware/VRAM guidance: https://localaimaster.com/blog/ollama-system-requirements ;
  https://localllm.in/blog/ollama-vram-requirements-for-local-llms ;
  https://eastondev.com/blog/en/posts/ai/20260528-ollama-hardware-guide/ ;
  https://www.promptquorum.com/local-llms
- DePIN economics: https://blockeden.xyz/blog/2026/04/12/depin-revenue-pivot-token-subsidies-ai-compute-akash-render-ionet/ ;
  https://blockeden.xyz/blog/2026/02/07/decentralized-gpu-networks-2026/ ;
  https://ownyourmind.ai/tokenomics/render-vs-akash-vs-ionet/ ;
  https://cryptodaily.co.uk/2026/05/render-vs-akt-ai-compute-token
- GPU marketplaces: https://www.gpunex.com/blog/sell-computing-power-best-platforms/ ;
  https://gpuperhour.com/compare/salad-vs-vastai ; https://getdeploying.com/vast-ai ;
  https://gpuhosted.com/en/vast-ai-pricing-guide/
- Verifiable inference: https://arxiv.org/html/2501.16007v1 (TOPLOC) ;
  https://arxiv.org/html/2602.12630 (TensorCommitments) ; https://arxiv.org/html/2509.24257 (VeriLLM) ;
  https://arxiv.org/pdf/2504.13443 ; https://www.spheron.network/blog/confidential-gpu-computing-nvidia-tee-encrypted-vram/
- Prime Intellect: https://www.primeintellect.ai/blog/intellect-2 ; https://sacra.com/c/prime-intellect/ ;
  https://www.gate.com/learn/articles/open-ai-founding-members-invest-a-quick-dive-into-the-decentralized-ai-breakthrough-prime-intellect/7323 ;
  https://www.implicator.ai/prime-intellects-intellect-3-open-source-ambition-meets-centralized-reality/

**Note on secondary sources:** several 2026 landscape claims (WebGPU model caps, VRAM tier
tables, marketplace earnings) come from secondary blogs; treat exact figures as
order-of-magnitude and re-verify pins at phase-planning time, per the E7 doc's own practice note.
