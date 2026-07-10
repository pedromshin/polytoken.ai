# Brand Identity Options — polytoken.ai (DSSR-01)

**Status:** Decision-ready research input for v1.8 (E2 — "polytoken.ai: Rebrand, Design Refactor, Auth & Tenancy")
**Researched:** 2026-07-10
**Scope:** This document produces options and one recommendation. It does NOT implement a re-skin, register a domain, or file a trademark — those are v1.8/E2 execution work.
**Grounded in:** `.planning/research/polytoken-vision/VISION.md` (the north star, epoch ladder E0–E7, and the "not a generic SaaS" product framing)

---

## Naming collision — cross-cutting risk (read before the directions below)

A live WebSearch check during this research turned up an **existing product also named "Polytoken"**: a local-first AI coding-agent daemon (CLI + TUI) documented at `docs.polytoken.dev`, distributed as the `polytoken` npm package, with its own logo, Discord, and Bluesky presence (version 0.4.2 at time of research). It is a *different product category* (a developer coding-agent tool, not a personal AI knowledge workspace), but it is an **exact name collision** in a directly adjacent space (AI agent tooling), which creates real SEO and brand-confusion risk — especially given polytoken.ai's own early audience skews technical.

- `polytoken.com` also appears registered.
- No first-party evidence was found on whether `polytoken.ai` itself is currently held; VISION.md already treats it as the target domain, so this is flagged as a pre-launch risk to validate, not a blocker to this research.

**Every direction below inherits this risk.** It is scored per-direction in the comparison table and factored into the recommendation. Resolving it (trademark search, domain-lock confirmation) is v1.8 execution work, not this document's job — see `research_notes` in the plan.

Sources: WebSearch "polytoken.ai domain" (surfaced `docs.polytoken.dev`, `polytoken.com`); WebFetch of `https://docs.polytoken.dev/introduction/`; WebSearch `"polytoken.ai" -polytoken.dev -polytoken.com` (confirmed `docs.polytoken.dev` is the dominant indexed result for the bare name "polytoken").

---

## Direction A: Nodal — Ontology-Precision

**Naming & voice:** Precise, structural, engineering-literate — restrained rather than showy, closer to Linear's or Anthropic's own understated register than to a consumer-productivity brand. Vocabulary leans on the product's actual internals: *node, edge, tier, cluster, promote, graph*. Tagline sketch: *"Your knowledge, structured."* or *"Every conversation becomes a node."*

**Logo direction:** An abstract interconnected-node glyph — three or four circles joined by thin lines forming a minimal graph mark, ideally resolving into negative-space wordmark potential (e.g., the mark reads as both "graph" and a stylized "p"). Monochrome-first with a single accent color, reusing the existing `color.primary` teal (`164 39% 22%`) rather than introducing a new brand hue.

**Domain posture:** `polytoken.ai` as both marketing and app home; in-app surface names lean directly on graph vocabulary (`/graph`, `/canvas`, `/cluster`). This is the direction with the *highest* exposure to the naming-collision risk above, since it targets the same technical/dev-tool audience already indexing for "polytoken."

**Rationale:** Grounded in VISION's "AI-powered, ontology-driven knowledge graph that the user's own conversations grow," the suggest-only tier ladder (INFERRED vs EXTRACTED), and the explicit graphify heritage (tier ladder, bounded expand, tier-pruned detail already adopted from graphify's algorithms). This direction puts the single hardest-to-copy, most differentiated piece of the product — the ontology engine — front and center as the entire brand personality, which is the most literal reading of "not a generic SaaS."

---

## Direction B: Cortex — Second-Brain Companion

**Naming & voice:** Warm, human, conversational — a companion, not a console. Vocabulary: *remember, recall, connect, your workspace*. Register close to Notion AI or Mem: approachable to a daily, non-technical user rather than a developer. Tagline sketch: *"Everything you know, in one place."* or *"The AI that remembers what you forgot to bookmark."*

**Logo direction:** A rounded, organic mark — interlocking soft-edged shapes (a node/brain hybrid) rather than sharp graph lines. Keeps the teal base as primary but pairs it with a softer secondary accent for warmth; avoids anything that reads as an infrastructure diagram.

**Domain posture:** `polytoken.ai` app surfaces use personal, first-person framing ("Your Cortex," "Your Timeline") rather than systems vocabulary; marketing site leans lifestyle/personal-productivity register (closer to how Notion or Superhuman market to individuals). Lower collision risk than Nodal — a personal-productivity search intent is a different query space than "polytoken" the dev-agent tool — but the exact-name collision still applies and should still be validated.

**Rationale:** Grounded directly in VISION's stated north star: *"the tool that is everything I wanted all of my current AI tools to be"* — a **personal** AI workspace, not an engineering platform — and in E3's "emails are cards, chats attach to threads, research accumulates into the cluster." This direction sells the emotional promise (a second brain that never lets a thread go missing) rather than exposing the graph mechanics as the headline.

---

## Direction C: Lattice — Infrastructure-Grade

**Naming & voice:** Infra-confident, precise, engineering-trust register akin to Stripe or Vercel. Vocabulary: *node, mesh, compute, pool, daemon, protocol*. Tagline sketch: *"The compute layer for your own AI."*

**Logo direction:** A geometric lattice/mesh pattern — a repeating triangulated or hex-grid motif signaling "a network of many small cooperating units," visually distinct from Nodal's sparse organic graph.

**Domain posture:** Reserves the brand identity for the eventual multi-user compute-pooling network (E7) and desktop daemon (E4) rather than the current single-user product. This is a **premature-commitment risk**: VISION explicitly gates E7 on "E4 shipped + real multi-user tenancy + demonstrated demand" and calls it "a company-sized problem on its own," LAST and HARDEST in the ladder — branding the whole product around a capability that is 4+ epochs away risks a "vaporware infra brand" read for what is currently a personal single-user tool.

**Rationale:** Grounded in E4's generic daemon job envelope and E7's distributed-inference/compute-pooling vision. Useful only if the team deliberately wants the brand to anticipate the *entire* roadmap rather than the near-term epoch (E2/E3) — which is why it is included as an option but not the recommendation.

---

## Direction D: Constellation — Spatial Canvas

**Naming & voice:** Exploratory, spatial, visual-first. Vocabulary: *canvas, cluster, constellation, orbit, connect*. Register closer to a creative tool (Figma/Miro-adjacent) than either an engineering or companion brand.

**Logo direction:** A connected star-field/dot motif — nodes of varying size loosely connected, evoking both a starfield and a graph; naturally reuses the visual language already present in-app (the 2D infinite canvas with typed nodes).

**Domain posture:** Leans into the 2D infinite canvas as the primary UI metaphor across both marketing and product; feature naming keeps "Canvas" front and center (it already is, internally). The marketing site could embed a live, interactive canvas demo on the homepage — the single easiest thing about this product to show in a screenshot or video.

**Rationale:** Grounded in `.planning/research/FEATURES.md`'s differentiator "2D infinite canvas with genui panels-as-nodes" and VISION's "emails become cards on the canvas." This direction foregrounds the most visually distinctive, most demo-able surface of the product, unlike the graph engine (Nodal) which is largely invisible under the hood.

---

## Comparison Table

| Direction | Voice | Logo Direction | Domain Posture | Best-fit-for | Collision Risk |
|---|---|---|---|---|---|
| **Nodal** | Precise, structural, engineering-literate | Minimal interconnected-node glyph; monochrome + teal accent | Graph vocabulary across app surfaces (`/graph`, `/cluster`) | Technical/developer-adjacent early adopters who want to see the ontology engine | Highest — same audience as the existing `polytoken` dev-agent tool |
| **Cortex** | Warm, human, companion | Rounded organic node/brain hybrid | Personal-workspace vocabulary; lifestyle-leaning marketing | The actual north-star user: daily personal use | Present but lower — different search intent than the dev-tool collision |
| **Lattice** | Infra-confident, engineering-trust | Geometric lattice/mesh pattern | Anticipates E4/E7 compute-network brand | A brand built for the full 7-epoch roadmap, not just E2/E3 | Present; also risks premature-commitment to unbuilt E7 capability |
| **Constellation** | Exploratory, spatial, visual-first | Connected starfield/dot motif | Canvas-first marketing and feature naming | Visually-driven acquisition (demo-able screenshots/video) | Present but moderate — canvas visual is distinctive regardless of name |

---

## Recommendation: Cortex

**Recommend: Direction B — Cortex (Second-Brain Companion).**

VISION's own north star is explicitly personal and emotional ("the tool that is everything I wanted all of my current AI tools to be"), and the near-term epoch gate (E2 auth/tenancy, E3 email-cluster killer feature) is about real daily personal use, not selling infrastructure (Lattice — premature given E7's own "LAST, HARDEST" gating) or courting a developer-tool audience that already associates "polytoken" with a different product (Nodal — highest collision exposure). Cortex keeps the ontology/graph engine as the product's internal differentiator, surfaced through *behavior* (citations, the suggest-only tier ladder, promotion gates) rather than as the entire brand voice, while still allowing the logo mark to borrow node/constellation geometry as a secondary visual motif. Given the confirmed naming collision with the existing `polytoken` CLI dev-tool, treat trademark/SEO differentiation as a pre-launch v1.8 action item — Cortex's personal-productivity register competes for different search terms than that collision, which is the most practical mitigation available without registering or purchasing anything now.
