# Agentic Ecosystem — Research Lane (2026-07-24)

Scope: packages, frameworks, MCP, skills, context/system-prompt strategy, evals, observability, LLM security & privacy. Split into **(A) improves THE PRODUCT** vs **(B) improves the Claude-Code + GSD DEV LOOP**. Recommendations are judgment calls with tradeoffs, not link lists.

## What polytoken already is (verified, not assumed)

This is not a greenfield "should we adopt an agent framework" situation. The repo *is* an agent framework, hand-rolled and unusually principled:

- **Capability registry as single source of truth.** `packages/capabilities/src/capability.ts:1-60` declares one capability → four consumers (LLM tool def, genui block, daemon executable, canvas node). `risk` is DATA not code (INV-4), `reversibility` is an additive optional field, `source`/`trust` (`"builtin"|"external"`, `"first-party"|"verified"|"claimed"|"unvetted"`) are pre-wired for a future OSS/skills ontology. This is essentially a private, typed, in-repo MCP-tool model built before adopting MCP.
- **LLM path is Bedrock, not the Anthropic first-party API.** `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` uses `AsyncAnthropicBedrock`; models in tree: `claude-3-haiku-20240307`, `us.anthropic.claude-haiku-4-5-20251001`, `claude-sonnet-4-6` (`grep` across `apps/`,`packages/`). Web also ships `@mlc-ai/web-llm@0.2.84` (client-side WebLLM) in `apps/web/package.json`.
- **A real eval harness already exists.** `packages/genui/src/eval/` has golden sets (`golden-set.json`, `retrieval-golden-set.json`, `page-ideas.json`), scorers (`citation-scorer.ts`, `retrieval-scorer.ts`, `injection-scorer.ts`), and injection fixtures (`injection-fixtures.json`, `web-search-injection-fixtures.json`). The injection method is a **canary-leak** test: `[CANARY:token]` in quarantined `retrievedText`, scored `leaked` iff the token appears in visible output (`injection-scorer.ts:1-45`). A Python mirror lives at `apps/email-listener/tests/evals/_scorers.py`.
- **Cost + audit are first-class in the DB.** `supabase_cost_ledger_repository.py`, `supabase_generation_audit_repository.py`, and "read real (input_tokens, output_tokens) off a Bedrock response (D-22)" in the genui adapter.
- **What's MISSING:** zero distributed tracing / LLM observability platform (`grep` for `langfuse|opentelemetry|otel|braintrust` across all `package.json` → nothing). CI (`.github/workflows/`) covers email-listener test + deploy + prod migrate only — **no eval-gate, no web CI visible**. The evals exist but do not appear to gate merges.

The strategic read: polytoken has out-engineered most of the "agent framework" market on the *substrate* (typed capability spine, risk-as-data, canary evals). Its real gaps are **observability**, **eval-in-CI**, and the **OSS-ontology / MCP bridge** the registry is already shaped for. Recommendations below lean into that reality rather than importing a framework that would duplicate the spine.

---

## (A) PRODUCT — what moves polytoken's agentic product

### A1. Do NOT adopt a general agent framework (LangGraph / Mastra / CrewAI / Vercel AI SDK as orchestrator). Confidence: high.

The 2026 market leaders — Mastra (TS), LangGraph (durable graphs, used by Anthropic/Replit/Uber), CrewAI, Vercel AI SDK — all solve "declare tools, run an agent loop, keep state." polytoken's capability registry + planned graphile-worker durable runtime (Task #7) already own that surface, and own it with tenant/risk/reversibility semantics no framework gives you. Dropping LangGraph in would mean maintaining two tool ontologies and losing the "one declaration, four consumers" invariant that is the product's actual moat.

- **Tradeoff / where I'd reconsider:** the one piece worth *stealing conceptually* is durable, checkpoint-based execution with human-in-the-loop pauses. That's exactly Task #7 (graphile-worker durable runtime). Build it natively; don't import LangGraph to get it. If Task #7 slips repeatedly, a narrow adoption of a durable-workflow engine (Temporal/Inngest/graphile-worker — you already picked graphile) is the pragmatic fallback, but the *agent* logic stays in your registry.
- **Vercel AI SDK** is the one exception worth a look for the **streaming UI layer only** (not orchestration): it's the most-installed TS agent toolkit and its `useChat`/streaming primitives are battle-tested. But you already have `use-chat-stream` (`apps/web/src/app/chat/_hooks/`), so this is a "if you rewrite chat streaming" note, not an action.

### A2. Bridge the capability registry OUTWARD as an MCP server — but treat MCP as hostile supply chain. Confidence: high on direction, high caution on execution.

The registry's `source: "external"` / `trust: "unvetted"|"claimed"|"verified"` fields (`capability.ts:52`) are explicitly built for this. MCP is now the de-facto interop standard (official servers repo >87.5k stars by mid-2026; OAuth 2.1 + PKCE formalized in the 2025-11-25 spec). Exposing polytoken capabilities *as* an MCP server lets external agents (Claude Desktop, Cursor) drive polytoken, and lets polytoken *consume* external MCP servers as capabilities — which is precisely the "populate, not re-architect" story in INV-3.

- **The landmine:** consuming third-party MCP is a supply-chain attack surface. Independent scans find **30–82% of public MCP servers carry exploitable flaws; only ~8.5% use OAuth** (Practical DevSecOps 2026; arXiv 2509.06572 "Parasites in the Toolchain"). Tool-poisoning / rug-pull attacks (arXiv 2506.01333 ETDI) hide instructions in tool *descriptions* — which for polytoken flow straight into the LLM via `describe`. The `trust` axis must be *enforced*, not just stored: an `unvetted` external capability's `describe` text must be treated as untrusted content (quarantined the same way `retrievedText` is), and high-`risk`/irreversible external capabilities must be gated behind the ONE permission model.
- **Recommendation:** expose polytoken-as-MCP-server first (low risk, high leverage for the dev loop too — see B1). Defer *consuming* arbitrary external MCP until the `trust`→enforcement wiring exists. When you do, require OAuth 2.1 + PKCE and pin/attest server identity; do not auto-install from a registry.
- **Maturity flag:** MCP spec itself is stable and vendor-backed (Anthropic). The third-party *server ecosystem* is a security minefield — that's the maintained-vs-abandoned risk here, not the protocol.

### A3. Generative UI: you're ahead of the market's default; converge toward the emerging declarative-stream standards, don't chase them. Confidence: medium-high.

polytoken's genui already does the thing the 2026 GenUI guides now recommend as best practice: LLM emits a **constrained, typed component description** (allow-listed blocks bounded by the capability registry), not arbitrary code — the safety/predictability win everyone converged on. Emerging standards to watch, not adopt yet:

- **Google A2UI** (declarative JSONL stream for LLM→client UI across trust boundaries) and **OpenUI Lang / Open-JSON-UI** (streamable, ~67% fewer tokens than equivalent JSON). These matter if polytoken ever needs to render genui *into a client it doesn't own* (e.g., an external agent host). For your own canvas/web, your typed catalog is better because it's tied to real capabilities.
- **Concrete near-term win aligned with existing tasks:** Task #5 ("GenUI action graceful failure — malformed model output is normal, not a crash") is the single highest-ROI GenUI investment. Constrained-decoding / schema-enforced output at the Bedrock call (Anthropic tool-use with a strict Zod→JSON-Schema, validate-and-repair on parse failure) turns "malformed output" from an exception into a bounded retry. This is the "single schema, four jobs" pattern (Zod v4: type + JSON-Schema for the model + runtime validation from one source). You already generate tool defs from the registry's Zod `input`/`output` — extend that to a validate-then-repair wrapper around every model call.
- **CopilotKit** is the loudest GenUI vendor but is a React-host framework (would fight your xyflow canvas + genui renderer) and is VC-funded — **flag: VC-dependent, would create host lock-in.** Skip.

### A4. Context / memory strategy for the product agent: adopt "structured note-taking + JIT retrieval," not bigger prompts. Confidence: medium-high.

Anthropic's own 2026 guidance (Memory tool, compaction, structured note-taking) and the arXiv line (2510.12635 "Memory as Action"; LOCA-bench; AgentLongBench) all converge: long-horizon agents fail from *context distraction* (arXiv 2601.07226 "Lost in the Noise"), not context *limits*. For polytoken's email/entity agent this means: persist what the agent learns about a workspace/entity to DB (you have the tables — chat_message, generation_audit, autofill_retrieval_event repos) and retrieve *just-in-time* per turn, rather than stuffing thread history into every prompt. This directly serves Task #6 ("email context reaches the model in chat") — the fix is a scoped retrieval step, not a larger context window.

- **Tradeoff:** JIT retrieval adds a retrieval hop (latency + a place for retrieval bugs — your `retrieval-scorer.ts` golden set is exactly the guard for this). Worth it; the alternative (max context) is both more expensive per Bedrock call and measurably *less* accurate at long horizon.

### A5. Privacy posture is a product feature, not just a control. Confidence: medium.

polytoken reads users' email. The `@mlc-ai/web-llm` dependency suggests some client-side inference intent — lean into it as a differentiator: classification/PII-detection that can run on-device keeps email content out of Bedrock entirely for the sensitive path. This pairs with the harness guardrail (email content is already classifier-blocked) and is a genuine trust story for a multi-user launch. **Flag:** WebLLM is capable but its model catalog and browser-WebGPU support are uneven; treat it as an enhancement path, not the primary inference route.

---

## (B) DEV LOOP — what moves Pedro's Claude Code + GSD workflow

### B1. Expose the capability registry to your *own* Claude Code as an MCP server / skill surface. Confidence: high.

Same build as A2, but the internal payoff is immediate and lower-risk (you trust your own server). Once polytoken capabilities are reachable by Claude Code, dev-loop tasks like "run this capability against staging," "list what the daemon can execute," or "diff canvas node types vs registry" become tool calls instead of bespoke scripts. Because the registry is already the single source, the MCP server is a *projection*, not new logic — cheap to build, and it dogfoods A2.

### B2. Put the existing evals in CI as a merge gate. Confidence: high. This is the biggest dev-loop gap.

You have golden sets and scorers (`packages/genui/src/eval/`, Python mirror in email-listener) but `.github/workflows/` shows no eval job and no web CI. Evals that don't gate are documentation. Wire:
- a `genui` eval job (citation + retrieval + injection scorers) and the Python `_scorers.py` suite into CI, gating on regression thresholds;
- **canary-leak (injection) as a hard gate** — a regression here is a security regression, not a quality one.
- **Tradeoff:** eval jobs that call Bedrock cost money and add CI latency/flakiness (non-deterministic model output). Mitigate: run scorers against *recorded* model outputs for the deterministic gate, and a smaller live-Bedrock smoke suite nightly, not per-PR. Braintrust (1M spans/mo + 10k eval runs free) or **Langfuse self-hosted (free, no usage cap, OTel-native)** can host datasets built from production traces; given polytoken's self-host/OSS-substrate ethos, **Langfuse self-hosted is the natural fit** over the SaaS-tier vendors.

### B3. Add LLM tracing/observability — Langfuse self-hosted or OpenLLMetry. Confidence: high.

There is currently no way to see a failed agent turn's causal chain. The 2026 consensus: OpenTelemetry is the standard; **Langfuse** and **Arize Phoenix** are the leading OSS/self-host backends; **Traceloop/OpenLLMetry** (Apache-2.0) is the OTel-native instrumentation layer. Recommendation:
- Instrument the Bedrock adapters with **OpenLLMetry** (vendor-neutral, just OTel spans) and point them at **self-hosted Langfuse**. This keeps email content on your infra (privacy-consistent with the guardrails) and gives you trace + cost + eval-dataset-building in one place — and Langfuse can *consume* the traces to build the B2 datasets.
- **Tradeoff:** self-hosting Langfuse is one more service to run. Given you already run Supabase + FastAPI + daemon locally, the marginal ops cost is low and the privacy/cost win is high. Avoid SaaS observability that ships email-derived prompts to a third party.
- **Flag on vendors:** Braintrust/Latitude/Maxim are VC-funded eval SaaS — fine for datasets, but do not route email-derived traces through them. Phoenix (Arize) and Langfuse have credible OSS governance; prefer them.

### B4. GSD dev-loop patterns worth stealing from the public ecosystem. Confidence: medium.

The public GSD system (58.9k stars by April 2026) and the "claude-code-harness" repos have converged on a few patterns you can adopt piecemeal without buying the whole thing:
- **Subagent review loop** (a reviewer subagent reads the diff *cold*, without the implementer's framing, against the plan). You're already fanning out subagents for this very assessment — formalize a `/review` subagent that reads plan-vs-diff. Your repo even ships `/code-review` and `/security-review` skills; the addition is *cold-context* review as a gate.
- **"Gotchas" section in every skill.** The best-practice finding: a skill's gotchas section does more for reliability than its happy path. Your `CLAUDE.md` already encodes footguns (999.22 build trap, env split, jsdom-does-no-layout) — mirror that discipline into per-skill gotchas.
- **PostToolUse hooks for auto-regenerated progress / auto-format / quick-test-after-edit.** Low effort, high signal. A PostToolUse hook that runs `npm run typecheck` on the touched workspace would have caught a whole class of drift.
- **Flag:** GSD-the-product and the various "harness" repos are fast-moving, individually-maintained, and star-chasing. Adopt *patterns*, not dependencies. Don't couple your workflow to an external CLI that can churn or get abandoned.

### B5. Model selection hygiene for the dev loop. Confidence: medium.

The tree pins several model IDs (`claude-3-haiku-20240307`, `haiku-4-5`, `sonnet-4-6`). Centralize model IDs (they're already partly in one place) and keep a documented "which model for which capability" mapping keyed off the registry's `cost` field (`"free"|"cheap"|"moderate"|"expensive"`, `capability.ts:44`). This makes cost/quality tradeoffs a data change, and lets the planner reason about cost — which INV-1 says is the whole point of declaring `cost` early. Pair with the `claude-api` skill in-repo for pricing/model-migration facts rather than answering from memory.

---

## Cross-cutting: security & privacy (respecting Part C landmines)

- **Prompt injection is unsolved at the model layer; containment is the 2026 strategy** (OWASP LLM01, arXiv 2604.24118 AgentVisor, 2606.20922 isolated planning). polytoken's canary-leak eval + quarantined `retrievedText` is exactly the "separate readers from doers" architecture the field recommends — **you are ahead here.** The gap is enforcement at *new* boundaries: (1) external MCP tool *descriptions* (A2) must be quarantined like retrieved content; (2) the injection eval must be a CI gate (B2), not a local test.
- **The lethal-trifecta rule** (untrusted content + tool access + exfiltration path) must be checked whenever a capability with `risk: "write"|"exec"` or `reversibility: "irreversible"` can be reached from an email-content-derived turn. This is a registry-level invariant you can actually assert in code.
- **Landmine respect:** none of the above touches the `nauta-services` live-infra namespace, the out-of-band SES receipt rule / forwarder Lambda, or SES sandbox status. Observability/evals are additive services; the MCP bridge is a projection of existing code. **Rotate the IAM keys pasted across sessions** regardless — that's the one urgent security item that intersects this lane's "AI/LLM security" remit only tangentially but must not be dropped.

## Bottom line

polytoken's agentic *substrate* is stronger than the framework market it could buy from — so the product plays are **bridge (MCP), harden (constrained output + injection-gate), and remember (JIT context)**, not "adopt a framework." The dev-loop plays are **observe (Langfuse+OpenLLMetry self-hosted), gate (evals in CI), and project (registry→MCP for your own Claude Code)**. The single highest-leverage move serving both lanes at once: **turn the capability registry into a self-hosted MCP server** — it's a projection of code you already own, it dogfoods the external-trust path, and it makes both the product and the dev loop composable with the rest of the 2026 agent ecosystem.
