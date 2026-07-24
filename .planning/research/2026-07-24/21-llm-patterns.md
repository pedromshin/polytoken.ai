# LLM Architecture & Workflow Patterns — polytoken (2026-07-24)

Research lane. Question: which LLM/agent patterns are worth adopting, and *where in this
system* would each land? Verdict up front: **polytoken is already an unusually mature LLM
codebase.** Prompt caching, streaming-as-event-stream, forced-tool constrained decoding,
hybrid RAG, and a real eval harness are all shipped. The high-value moves are not "adopt a
framework" — they are closing three specific gaps (durability, cross-conversation memory,
batch/cache economics) that the existing architecture is one refactor away from.

All claims cite files under `apps/email-listener/` (the LLM brain lives here; `apps/web` is
a streaming view onto it). Evidence over doc-trust.

---

## 1. What is already true (so we don't re-recommend it)

| Pattern | Status | Evidence |
|---|---|---|
| Bounded ReAct tool loop | Shipped | `_MAX_TOOL_ROUNDS = 4` in `run_chat_turn.py:233`; per-round cap `MAX_SERVER_CALLS_PER_ROUND = 5` in `run_chat_turn_tool_loop.py:47` |
| Prompt caching (ephemeral) | Shipped | `bedrock_chat_adapter.py:43-83` puts `cache_control` on last system block + last tool; also `genui_generator_adapter.py:186` |
| Streaming-as-view | Shipped | `ChatRunEvent` vocabulary; `deep_research.py` reuses the *same* event stream (docstring "no new event type") |
| Constrained decoding | Shipped | forced `tool_choice` across `entity_type_classifier_adapter.py`, `autofill_adapter.py`, `segmentation_adapter.py`, genui adapters |
| Hybrid retrieval (RAG) | Shipped | `retrieval_repository.py` — pgvector cosine `<=>` + trigram, fused with RRF k=60, tenant-scoped by `importer_id` |
| Eval-driven | Shipped | `tests/evals/` — retrieval golden set, extraction replay, injection adversarial suite; plus `scripts/genui_eval/`, `scripts/research_eval/` with rubrics |
| Cost ledger | Shipped | `supabase_cost_ledger_repository.py`, `supabase_generation_audit_repository.py` |
| Budget-gated agentic research | Shipped | `deep_research.py` — `ResearchBudget` hard token+round ceiling, fail-closed, plan→search→draft→**adversarial-verify**→synthesize |
| Curated multi-provider registry | Shipped | `chat_model_registry.py` — bedrock/openrouter/browser, content-hashed version, honest capability flags |

The "never silent" motto (`run_chat_turn_tool_loop.py:38-56` — `PARSE_FAILURE_TEXT`,
`ROUND_CAP_EXHAUSTED_TEXT`, `FINAL_ROUND_NUDGE_TEXT`) is a genuinely good pattern most teams
skip: every loop-termination path surfaces visible text instead of a silent drop. Keep it.

---

## 2. The three real gaps (ranked by leverage)

### GAP 1 — Durable execution (highest leverage, biggest hazard if done wrong)

**Current reality:** both the chat tool loop (`run_chat_turn.py:816` `while round_count <=
_MAX_TOOL_ROUNDS`) and `deep_research` run **in-process, inside the request**. `deep_research`
is registered as a synchronous capability (`container.py:1043`). No `graphile-worker` exists
in the repo yet (grep for `graphile` across apps/packages = empty), though Task #7 names it as
a FOUNDATION item. A process crash / ECS redeploy / timeout mid-research loses all rounds and
whatever budget was already spent. There is no resume.

**2026 consensus:** durable execution = workflow survives crash/redeploy/wait by persisting
state after each step and resuming from the last checkpoint. Reference primitives: Temporal,
Restate, DBOS, Inngest, AWS Step Functions; LangGraph checkpointers (Postgres/Redis saver).

**Where it lands here — and where it must NOT:**
- **Durable:** `deep_research` (can burn real money over many rounds → the one place a crash is
  expensive), and the email-ingestion extraction pipeline (`ingest_inbound_email.py`, long,
  already async-shaped). These are the correct targets.
- **NOT durable:** the interactive chat turn. Wrapping a 4-round, sub-5-minute interactive loop
  in a durable engine buys nothing and adds serialization latency the user feels. Keep it
  in-process.

**The clean move that avoids adopting a framework:** polytoken already emits `ChatRunEvent`s as
the stream. Treat that event log as the **durable event-sourced state** — persist events as the
loop produces them (the cost ledger already writes per-step), and reconstruct loop position from
the event log on resume. This makes "streaming," "persistence," and "resume" the *same*
mechanism instead of three. graphile-worker (Postgres-native, already in the Task-7 plan, no new
infra) is the right substrate; Temporal is overkill for this scale and adds an operational
dependency. **Tradeoff:** event-sourced resume requires deterministic replay of the pure loop
helpers — `run_chat_turn_tool_loop.py` is *already* pure (no I/O, import-linter enforced), so
this is unusually cheap here. The cost is discipline: any non-determinism (timestamps, model
non-determinism) must be recorded in the event, not recomputed.

### GAP 2 — Cross-conversation / user memory (medium leverage, real footgun)

**Current reality:** retrieval is RAG over *confirmed extracted knowledge* (email components,
`retrieval_repository.py`), not a rolling agent memory. There is no long-term user/conversation
memory layer — nothing that remembers "Pedro always wants X" across sessions. `deep_research`
and chat start cold each turn beyond what's in the message history.

**2026 landscape:** Mem0 (auto-extract facts on write), Zep (temporal knowledge graph +
summarization), Letta, Cognee. Recent research (Bi-Temporal Memory Engine, "Less Context More
Accuracy") shows a *lean retrieved* memory often beats full history.

**Where it lands:** chat conversations, and personalizing extraction/autofill. **But this is the
gap I'd approach most cautiously**, for three reasons specific to polytoken:
1. **Write cost.** Mem0-style "LLM on every write" adds ~200–500ms and real tokens per turn —
   directly at odds with the project's hard-budget, cost-ledger posture. If added, memory
   writes must be batched/async, never on the interactive path.
2. **Poisoning + sycophancy.** Memory over email content is an *injection surface* — the repo
   already has `test_injection_adversarial_suite.py` / `test_web_search_injection_suite.py`
   because untrusted text flows in. A memory layer that ingests email is a new place for prompt
   injection to persist. 2026 benchmarks (MemSyco for sycophancy, SAGE novelty-gating) exist
   precisely because naive memory degrades.
3. **You have the discipline to do it right.** The golden-set eval pattern means memory should
   ship *behind a memory-recall eval* (does retrieved memory improve task completion without
   regressing injection resistance?), not vibes.

**Recommendation:** don't adopt Mem0/Zep wholesale. Start with the cheapest thing that the
existing RRF retriever can absorb: a **summarization + fact-extraction memory keyed by
`importer_id`, retrieved through the same hybrid RRF path already built**, gated by a new eval in
`tests/evals/`. Reserve a temporal-graph memory (Zep-class) only if recall evals prove flat
summaries insufficient. **Tradeoff:** flat summaries are cheap and injection-auditable but lose
multi-hop/temporal reasoning; graph memory is powerful but is a second knowledge graph to keep
consistent with the one in `knowledge_graph_repository.py`.

### GAP 3 — Batch API + cache-hit verification (pure cost win, low risk)

**Current reality:** grep for Batch API usage in `infrastructure/llm/` = **empty**. All
extraction runs on the live per-request path.

**Economics (2026):** Batch API is **50% cheaper** across all models and is ideal for async,
non-interactive work. Prompt-cache reads are **10% of input cost** (90% off); writes cost 1.25x;
default TTL 5 min, 1-hour option available.

**Where it lands:**
- **Batch:** email-ingestion extraction and the offline eval runs (`scripts/genui_eval`,
  `scripts/research_eval`) are textbook batch candidates — async, no user waiting. Moving
  extraction to Batch is a ~50% cut on what is likely the largest token line item, with no
  quality change. **Tradeoff:** batch adds latency (minutes, not seconds) — fine for ingestion,
  wrong for chat.
- **Cache verification:** caching is *implemented* but is anyone checking it *hits*? The 4-round
  tool loop completes well inside the 5-min TTL, so cross-round reads should be near-free — but
  that's an assertion to make, not assume. Add a cost-ledger assertion that `cache_read` tokens
  dominate `cache_write` on multi-round turns. If stable system prompts dominate, the 1-hour TTL
  may pay for itself. (This overlaps the cost lane — flagging the seam, not owning it.)

---

## 3. Patterns to consciously NOT adopt (anti-recommendations)

- **Supervisor/worker multi-agent fan-out for chat.** `deep_research` is (correctly) a *single*
  agent with a multi-round tool loop, not an orchestrator spawning sub-agents. Anthropic's own
  multi-agent research write-up reports ~15x token cost vs single-agent. For a hard-budget,
  fail-closed system (`ResearchBudget`), single-agent-with-tools is the right default. Reserve
  fan-out only for genuinely parallel, independently-verifiable sub-questions — and only once
  durable execution (Gap 1) exists to checkpoint the workers. Adopting LangGraph/CrewAI now
  would replace hand-written loops that are *already pure and eval-covered* with a framework
  dependency — negative value.
- **Native `response_format` / JSON-schema structured output.** Tempting, but the transport is
  `AsyncAnthropicBedrock` (`anthropic_client.py`), and Bedrock's constrained-decoding story is
  weaker than the native API's. Forced `tool_choice` (already used everywhere) *is* the correct
  constrained-decoding lever on Bedrock. Don't chase `response_format`.
- **Ripping out RRF for a fancier reranker.** RRF(k=60) over vector+trigram is a strong,
  cheap, explainable baseline. A cross-encoder reranker is a real upgrade *only if* the
  retrieval golden set shows RRF missing — measure first (`test_retrieval_golden_set.py` is the
  instrument).

---

## 4. Tool-use design — small hardening, already good

The tool envelope (`infrastructure/tools/envelope.py`, `test_tool_envelope_contract.py`), the
output-size cap (`MAX_TOOL_OUTPUT_CHARS`), parallel-call bounding (`MAX_SERVER_CALLS_PER_ROUND`
with `PARALLEL_CALL_OVERFLOW_TEXT`), and native `tool_result` blocks fed back verbatim
(`build_synthetic_tool_results_message`) are all aligned with Anthropic's tool-use guidance.
The one thing worth an eval: tool *description* quality drives selection accuracy far more than
loop mechanics — worth a small ablation once memory/durability land, not now.

---

## 5. Sequencing recommendation

1. **Durable event-sourced runtime for `deep_research` + ingestion** (Gap 1) — reuse
   `ChatRunEvent` as the log, graphile-worker as substrate, exploit the already-pure loop
   helpers. Unblocks safe long-running and future multi-agent.
2. **Batch API for extraction + eval runs** (Gap 3, batch half) — ~50% cost cut, no quality
   change, independent of everything else. Cheapest win; do it in parallel.
3. **Cache-hit assertion in the cost ledger** (Gap 3, cache half) — one test, confirms the
   caching already shipped is actually paying off.
4. **Eval-gated summarization memory** (Gap 2) — only after a recall eval exists; keep writes
   off the interactive path; treat as an injection surface.

Everything above is additive to a codebase that already does the hard parts right. The failure
mode to avoid is adopting an agent *framework* to get durability/memory when the existing pure
loops + event stream + eval harness already give you 80% of the substrate for free.

---

## Sources
- [Agent Architecture Patterns 2026: The Five Named Shapes — Future AGI](https://futureagi.com/blog/agent-architecture-patterns-2026/)
- [Durable Execution for LLM Agents 2026: Temporal + LangGraph — AppScale](https://appscale.blog/en/blog/durable-execution-llm-agents-temporal-langgraph-checkpointing-2026)
- [Durable Execution for LLM Agents: The Complete Guide — Vadim's blog](https://vadim.blog/durable-execution-llm-agents/)
- [Context Engineering: A Practical Guide for AI Agents — Sourcegraph](https://sourcegraph.com/blog/context-engineering)
- [Anthropic API Pricing 2026: Models, Caching, Batch & Optimization — Finout](https://www.finout.io/blog/anthropic-api-pricing)
- [Prompt Caching in 2026: Anthropic, OpenAI, Azure Compared — Technspire](https://technspire.com/en/blog/prompt-caching-2026-real-cost-wins)
- [Claude Platform Docs — Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [AI Agent Memory in 2026: Mem0 vs Zep vs Letta vs Cognee — DEV](https://dev.to/agdex_ai/ai-agent-memory-in-2026-mem0-vs-zep-vs-letta-vs-cognee-a-practical-guide-cfa)
- [Less Context, More Accuracy: A Bi-Temporal Memory Engine for LLM Agents — arXiv](https://arxiv.org/pdf/2606.09900)
- [MemSyco-Bench: Benchmarking Sycophancy in Agent Memory — arXiv](https://arxiv.org/pdf/2607.01071)
