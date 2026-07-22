# 01 — Market & Positioning

Research date: 2026-07-22. Prepared for VC/PE-grade conversations per the ground rules in
`README.md`: every externally-stated claim below is either sourced (URL) or explicitly labeled
**ASSUMPTION**. Product-definition claims are grounded in the repo itself
(`.planning/PROJECT.md`, `.planning/prompts/2026-07-22-vision-and-handoff.md`).

---

## 1. What polytoken is (product definition, grounded in the repo)

**One-liner:** polytoken is a personal AI workspace that grows out of your own email — every
inbound message is ingested, parsed (PDF text + OCR), extracted into entities and threads, and
promoted into a confidence-tiered personal knowledge graph that you work on a 2D canvas with an
agent that reads its own extracted data and generates live, editable UI panels.

**What exists today (shipped, per `.planning/PROJECT.md`, v1.9 shipped 2026-07-14; v1.10/v1.11
in flight):**

- **Email ingestion spine:** mail forwarded to a per-user CSPRNG `u-{token}@` address → AWS SES →
  FastAPI listener → parsing, OCR, entity/region extraction, Union-Find thread grouping.
- **Knowledge graph with trust tiers:** EXTRACTED | INFERRED | AMBIGUOUS ladder; only
  human-confirmed (EXTRACTED) knowledge is ever auto-injected into prompts; suggest-only
  promotion gate ("never auto-decide" is a standing product stance).
- **Canvas + chat:** xyflow 2D canvas where email-thread cards are first-class nodes, chats bind
  to threads, and a bounded mid-turn tool loop (entity lookup, email search, knowledge search,
  web search behind an SSRF-guarded executor) grounds the agent in the user's own data.
- **Generative UI (genui):** the agent emits live data-bound panels the user can re-theme, edit,
  and regenerate — the product's surfaces are increasingly compositions the product generates
  for itself over a declared capability registry (`packages/capabilities`; the "self-building
  product" D2 directive).
- **Multi-tenant foundation:** Google OAuth, per-user RLS on 13 tables, adversarially tested.

**Vision scope (from the 2026-07-22 handoff prompt — planned, NOT shipped; label accordingly in
any pitch):** automatic entity resolution across senders/domains rendered as circular-treemap
canvas views; a persistent agentically-generated home page of genui panels; an in-house tabular
system with agent-suggested tables; **polydrive** (personal drive, ~500 GB-class, backups +
versioning, canvas treemap visualization); **distributed inference** (users contribute idle
compute across their own devices, earn credits, spend credits on heavier models); **persistent
remote desktops** with live per-hour cost reporting; a local agent daemon (v2.0 plan).

**Honest current-state caveat (must be volunteered in any diligence conversation):** as of
v1.9's close the deployed product had not yet been signed into by its own user and no real email
had flowed (LIVE-03/LIVE-04/CLUS-07 accepted as tech debt). polytoken is a deeply built product
that is not yet a *used* product. That is the single cheapest credibility fix available before
any investor conversation.

**ASSUMPTION:** the target user is initially "prosumer knowledge individual drowning in email
who wants a private second brain," starting with a market of one (Pedro) — classic
founder-as-user wedge. No customer discovery beyond the founder has been done yet.

---

## 2. Competitive landscape

polytoken sits at the intersection of four markets. No single competitor spans all four — that
is both the differentiation story and the focus risk.

### 2a. Personal AI OS / "second brain" workspaces

| Player | Status / signal |
|---|---|
| **Notion** | ~100M users (2024), ~$400M revenue 2024, ~$600M ARR late 2025, $10–11B valuation — the gravity well of the category ([super.so stats](https://super.so/blog/notion-stats), [taptwicedigital](https://taptwicedigital.com/stats/notion)) |
| **Genspark** | AI workspace ("second brain that never forgets" + agentic engine); $275M Series B Nov 2025 at $1.25B, valuation ~$2.6B by Jun 2026 ([SiliconANGLE](https://siliconangle.com/2025/11/20/genspark-raises-275m-funding-ai-productivity-suite/), [Sacra](https://sacra.com/c/genspark/), [BusinessWire — Workspace 6.0, Jul 2026](https://www.businesswire.com/news/home/20260721503339/en/Genspark-Unveils-AI-Workspace-6.0-Betting-AIs-Next-Breakthrough-Isnt-Models-Its-Context)) |
| **Limitless (ex-Rewind)** | Personal-memory AI; ~$27–34M raised incl. $15M Series A at $350M (2023, a 495x multiple on ~$707K ARR); ~$2M ARR 2025; **acquired by Meta Dec 2025** for "personal superintelligence" wearables ([Sacra](https://sacra.com/c/limitless/), [Yahoo Finance](https://finance.yahoo.com/news/meta-acquires-ai-device-startup-210213488.html)) |
| **Mem, Anytype, Saga, etc.** | AI-native capture / private-data second brains; smaller, mostly niche ([Taskade roundup](https://www.taskade.com/blog/ai-second-brain-tools)) |

**Read:** the category is validated (Genspark unicorn, Meta buying Limitless) and the incumbents
are moving toward exactly polytoken's thesis — "AI's next breakthrough isn't models, it's
context." Big-tech assistants (Gemini in Gmail, Copilot, Meta post-Limitless) are the structural
threat: they own the data source.

### 2b. Email intelligence

| Player | Status / signal |
|---|---|
| **Superhuman** | $118M raised; acquired by Grammarly Jul 2025; Grammarly then rebranded the whole parent company "Superhuman" (Oct 2025) — email is now the brand of a multi-product AI suite ([Tracxn](https://tracxn.com/d/companies/superhuman/__uNI3PJ_Huz1B_OobMp1RIu3DT8SOBubIyA2wkxh7Quk), [Sacra](https://sacra.com/c/superhuman/)) |
| **Fyxer** | AI exec assistant for email; $10M Series A Mar 2025 (~$60M post), $30M Series B months later led by Madrona ([Sacra](https://sacra.com/c/fyxer-ai/), [Sifted](https://sifted.eu/articles/ai-exec-assistant-startup-fyxer-raises-30m-to-expand-to-the-us)) |
| **Shortwave** | AI Gmail client by ex-Googlers; $9M raised (2020), ~$1.9M ARR mid-2025 with 17 people ([Sacra via search](https://sacra.com/), [TFN context](https://techfundingnews.com/yc-backed-french-startup-upstream-raises-3m-to-rebuild-email-in-the-era-of-ai-agents/)) |
| **Upstream** | YC-backed, $3M (2026), "rebuilding email for AI agents" ([TFN](https://techfundingnews.com/yc-backed-french-startup-upstream-raises-3m-to-rebuild-email-in-the-era-of-ai-agents/)) |

**Read:** email-AI companies get funded and get acquired, but nearly all compete on *triage and
drafting* (inbox zero, replies). polytoken is not an email client: it treats email as the
highest-signal ambient data feed for building a knowledge graph. That is a different job-to-be-
done — closer to "CRM/entity intelligence over your own life" than to Superhuman.

### 2c. Canvas / knowledge tools

| Player | Status / signal |
|---|---|
| **Obsidian** | Bootstrapped, ~$2M revenue 2025, <20 people; huge community, local-first ([Fueler stats](https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics), [GetLatka](https://getlatka.com/companies/obsidian.md)) |
| **Heptabase** | Card-on-whiteboard PKM, $11.99/mo, ChatGPT integration ([ToolChase](https://toolchase.com/tool/heptabase/)) |
| **Tana** | AI-native outliner/supertags; opened GA late 2025; $10/mo Pro ([Storyflow roundup](https://storyflow.so/blog/best-obsidian-alternatives-2026)) |
| **Scrintal, Muse, Logseq, Anytype** | Niche spatial/canvas tools ([Storyflow](https://storyflow.so/blog/best-heptabase-alternatives-2026)) |

**Read:** spatial canvas engagement is real (a 2024 Forte Labs survey reported 68% of
canvas-based PKM users more engaged than block-based users — secondary citation via
[Storyflow](https://storyflow.so/blog/best-obsidian-alternatives-2026); **treat as directional,
verify before quoting**). But every tool here requires *manual capture*. polytoken's wedge is
zero-ceremony capture: the inbox feeds the graph automatically. Note also ChatGPT removed its
Canvas cross-surface feature (May 2026 per PROJECT.md's market note) — spatial UI on mobile is
an unsolved industry problem; polytoken already degrades to an inline feed below `md`.

### 2d. Distributed inference / compute sharing

| Player | Status / signal |
|---|---|
| **Prime Intellect** | Decentralized training/compute; $15M led by Founders Fund early 2025, +$64.6M Feb 2026; INTELLECT-3 106B MoE Nov 2025 ([Prime Intellect blog](https://www.primeintellect.ai/blog/fundraise), [Sacra](https://sacra.com/c/prime-intellect/), [StartupHub](https://www.startuphub.ai/startups/prime-intellect)) |
| **Petals / exo / Hivemind** | Open-source swarm-parallel inference of large models across consumer devices ([Prime Intellect survey](https://www.primeintellect.ai/blog/our-approach-to-decentralized-training)) |
| **DePIN compute (Akash, io.net, Render, Salad)** | ~250 DePIN projects, ~$19B combined market cap late 2025; io.net ~$20M annualized revenue Oct 2025; Akash H100s at $1.20–1.80/hr vs ~$4.50–5.50 AWS ([BlockEden](https://blockeden.xyz/blog/2026/03/12/depin-compute-revenue-pivot-akash-ionet-aethir/), [KuCoin](https://www.kucoin.com/blog/depin-vs-big-tech-gpu-marketplaces)) |

**Read:** credits-for-idle-compute is a real, funded pattern — but it is a *different company*
(marketplace/protocol economics, crypto-adjacent, heavy trust/security surface). For polytoken
it should be framed to investors as **long-dated optionality on the cost line** (user-contributed
compute lowers COGS for their own inference), not as the business. **ASSUMPTION:** consumer
devices meaningfully serving a personal workspace's inference load is unproven at product
quality; latency and model-size constraints are severe for cross-device swarms.

---

## 3. Differentiation (the defensible story)

1. **Email as the automatic data spine.** Everyone else asks users to capture; polytoken's graph
   is fed by mail that arrives anyway (~121 emails/day for an average office worker —
   [Radicati via Signite](https://www.signite.io/emails-are-still-king/)). Zero-ceremony
   ingestion is the wedge Limitless tried with a $99 pendant; polytoken does it with an MX record.
2. **Confidence-tiered knowledge, human-gated.** The EXTRACTED/INFERRED/AMBIGUOUS ladder with a
   suggest-only promotion gate is a real answer to the #1 objection to AI memory products
   ("it will be confidently wrong about my life"). No surveyed competitor exposes trust tiers as
   a first-class product primitive (per v1.8 design research: "novel, no competitor precedent" —
   internal finding, PROJECT.md).
3. **The canvas is the interface to the graph, and genui is the interface to the canvas.** The
   agent doesn't just answer — it composes persistent, data-bound, user-editable panels from a
   typed capability registry. "A self-building product" is a differentiated architecture claim
   that Pedro can demo live, which matters more than any slide.
4. **One integrated system where competitors are point solutions:** email intelligence (Fyxer),
   knowledge canvas (Heptabase), AI workspace (Genspark), drive (Dropbox), compute (io.net) — each
   is someone's whole company; polytoken's bet is that the *integration* (agent context spanning
   mail + graph + drive + canvas) is the product.
5. **AI-native solo build velocity.** ~11 shipped milestones in weeks, largely autonomous
   overnight runs, with committed regression gates (screenshot harness, palette bans, WCAG,
   adversarial tenancy suites). This is the operational proof for the "one founder + agents"
   thesis investors are actively underwriting in 2025-26.

**Counter-positioning risks (say them before the VC does):** platform dependence (Gmail/Google
Workspace own the inbox; forwarding-based ingestion is fragile vs. native API access);
Genspark/Notion/Meta can bundle a good-enough version; scope breadth (drive + remote desktop +
distributed inference + canvas) reads as unfocused at pre-seed — the fundable narrative must
pick the email→knowledge-graph→canvas core and park the rest as roadmap.

---

## 4. TAM framing (layered, sourced)

Market-research TAM numbers vary wildly by scope; use ranges and say so.

**Core (personal knowledge / AI workspace):**
- Personal knowledge management software: **$1.3–1.8B (2024/25) → $4.7–4.9B by 2033/34**,
  11.8–15.2% CAGR ([Dataintelo](https://dataintelo.com/report/personal-knowledge-management-software-market),
  [MarketIntelo](https://marketintelo.com/report/personal-knowledge-management-software-market)).
- Broader knowledge-management software: **$23–34B (2025) → $74–98B by 2034/35**
  ([Fortune Business Insights](https://www.fortunebusinessinsights.com/knowledge-management-software-market-110376),
  [Market Research Future](https://www.marketresearchfuture.com/reports/knowledge-management-software-market-4193)).

**Adjacent expansions (only if/when those products ship):**
- Personal cloud storage (polydrive): **~$41–47B (2025)**, 8–17% CAGR forecasts
  ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/personal-cloud-market-821.html),
  [MRFR](https://www.marketresearchfuture.com/reports/personal-cloud-storage-market-8691)); Dropbox ~700M registered users
  ([ConnectBit](https://connectbit.com/cloud-storage-statistics/)).
- Desktop-as-a-Service (remote desktops): **~$5B (2025) → $12.5–16.6B by 2031/34**, ~14% CAGR
  ([Valuates](https://reports.valuates.com/market-reports/QYRE-Auto-17Z2363/global-desktop-as-a-service-daas),
  [Dataintelo](https://dataintelo.com/report/desktop-as-a-service-daas-market)).
- Decentralized compute: ~$19B DePIN market cap (late 2025), but revenue is tiny relative to cap
  (io.net ~$20M/yr) — cite as option value, not TAM
  ([BlockEden](https://blockeden.xyz/blog/2026/02/07/decentralized-gpu-networks-2026/)).

**Demand-side sanity check (bottom-up, ASSUMPTIONS labeled):**
- 4.4B email users worldwide (2024) → 4.9B by 2028; 376B+ emails/day
  ([Radicati](https://www.einpresswire.com/article/751597875/the-radicati-group-releases-email-statistics-report-2024-2028),
  [Signite](https://www.signite.io/emails-are-still-king/)).
- **ASSUMPTION:** serviceable segment = prosumers already paying for a productivity/PKM tool.
  Proxy: Notion's 100M users with single-digit-% paid conversion, Obsidian/Heptabase/Tana price
  points cluster at $8–16/user/mo. At an illustrative $15/mo ($180/yr) blended sub:
  1M paying users ≈ $180M ARR; 100K ≈ $18M ARR. SOM at seed stage is measured in
  hundreds-to-thousands of users, not market share.
- **ASSUMPTION:** storage and remote-desktop tiers raise ARPU materially (Dropbox-class 2TB plans
  ~$120/yr retail; DaaS seats $30–100+/mo) but also carry real COGS — defer monetization math to
  `04-business-model.md` / `05-cost-structure.md`.

**Recommended pitch framing:** "Beachhead: the $1.5–2B PKM/prosumer-AI-workspace segment growing
~12–15%/yr, reached through email — a channel with 4.4B users and zero capture friction.
Expansion: storage, compute, and desktop layers that turn a workspace into a personal cloud OS
($40B+ adjacent)." Keep DePIN out of the TAM slide.

---

## 5. Positioning statement (draft, for iteration)

> For knowledge-heavy individuals drowning in email, polytoken is a private AI workspace that
> turns the mail you already receive into a trustworthy, visual knowledge graph you can work on
> a canvas with an agent — unlike email assistants that only triage, and second-brain tools that
> demand manual capture, polytoken builds itself from your inbox and never promotes a fact you
> haven't confirmed.

**Nearest-comp valuation anchors for conversations:** Fyxer ($60M post at ~Series A, then $30M B
within months), Limitless ($350M at $707K ARR in the 2023 froth; exited to Meta), Genspark
($1.25B B). These are aspiration anchors, not entitlements — see `03-fundraising.md` for what
stage polytoken can actually price at today.
