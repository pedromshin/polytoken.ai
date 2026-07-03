# Project Research Summary

**Project:** nauta.services.email-listener — v1.3 "Conversational GenUI: Chat, Canvas & Dual-Channel"
**Domain:** Conversational generative UI — streamed chat spine + 2D infinite canvas + dual-channel (agent↔user) widget round-trips, layered onto an existing FastAPI/Bedrock + Next.js/tRPC + Drizzle/Supabase declarative genui engine
**Researched:** 2026-07-02
**Confidence:** HIGH

## Executive Summary

v1.3 adds a conversational, spatial delivery surface to a genui engine that already exists and is not being re-built: `packages/genui`'s Catalog → Spec → Registry → Renderer (zero-eval, Zod-validated) and the code-island sandbox (v1.1/v1.2) are dependencies, not research targets. The four fresh research passes (STACK, FEATURES, ARCHITECTURE, PITFALLS) confirm the prior `v1.3/V1.3-RESEARCH-SYNTHESIS.md`'s 4-phase shape (22 chat spine, 23 canvas, 24 dual-channel, 25 anticipatory-prompting SPIKE) and — critically — resolve both of its `[MODEL — pending validation]` flags into `[HIGH]`-confidence, source-verified answers: R2 (canvas) is confirmed as reuse `@xyflow/react` (not tldraw, which requires a commercial/hobby license + watermark for production), and R3 (streaming/dual-channel) is confirmed as extending the codebase's existing `AsyncAnthropicBedrock.messages.stream()` call (not introducing boto3's raw Converse API), bridged to the browser via `@ai-sdk/react`'s backend-agnostic UI Message Stream Protocol, which has a documented, named Python/FastAPI implementation path.

The recommended approach reuses aggressively: no new heavy dependencies beyond `@ai-sdk/react` and `zustand` on the frontend, and a FastAPI/`anthropic` version bump on the backend (no new Python packages — FastAPI ≥0.135.0 ships native SSE). Every new capability is a direct extension of established codebase patterns — domain-port Protocols + DI factories for the new `ChatModelPort`, the two-sided Drizzle-schema/Supabase-repository pattern for four new tables (conversations, chat_messages, chat_runs, canvas_snapshots), and the existing `SpecRenderer`/`ActionRegistry`/catalog machinery reused as-is for dual-channel widgets. The one genuinely new, high-risk piece of engineering is a partial-JSON-tolerant renderer (`StreamingSpecRenderer` / `tolerantParse` / `renderPartialTree`) needed to close the long-deferred GEN-04 (streamed partial-tree specs) — this is called out consistently across all four research files as the highest-complexity, most novel work in the milestone and should be built and fixture-tested in isolation before wiring it to a live stream.

The key risks, all independently identified by PITFALLS and cross-referenced by the other three files, cluster around three things that "look done but aren't" if not deliberately designed in from Phase 22: (1) the existing $30 AWS Budget cost guard was designed for manual-click-only generation and is silently broken by a persistent streaming chat plus (later) unprompted proactive prompting — a real per-session/per-turn application-level cap must be built, not inherited; (2) React Flow's own documented performance cliff (all nodes re-render on any store update) becomes a hard blocker the moment canvas panels carry live-streaming content, requiring streaming payloads to live outside the React Flow `nodes` array from day one; and (3) the widget→agent round-trip is a new untrusted-input surface structurally identical to the raw-email-injection problem this project already solved once (Phase 4's dual-LLM quarantine) — every widget submission must be re-validated server-side against its declared Zod schema before re-entering the model loop, never trusted because "the UI only allowed valid values."

## Key Findings

### Recommended Stack

The existing stack (FastAPI/Python 3.11, Next.js 15.3.3, tRPC 11.8.0, Drizzle+Supabase, `AsyncAnthropicBedrock`, `@nauta/genui`, `@xyflow/react` 12.11.0) is validated and unchanged. Additions are minimal and targeted at the streaming/canvas/state gaps.

**Core technologies:**
- `@ai-sdk/react` (^4.x) — frontend chat hook (`useChat`); implements the client side of the AI SDK's backend-agnostic UI Message Stream Protocol (SSE), giving a message-parts state machine (`text-delta`, `tool-input-*`, `tool-output-*`, `finish`) for free instead of hand-rolling stream reconciliation. Do NOT add the `ai` core package — model calls stay server-side in Python.
- `fastapi` bump to ≥0.135.0 — ships a native `fastapi.sse.EventSourceResponse`; no new SSE dependency needed.
- `anthropic` (Python SDK) bump to ≥0.60.0 — same `AsyncAnthropicBedrock` transport already in use (`anthropic_client.py`), just newer for streaming/tool-use bugfixes. Extend `.messages.stream()` (already proven end-to-end on Bedrock by `genui_code_generator_adapter.py`) rather than introducing boto3's raw `converse_stream()`, which is not used anywhere in this codebase.
- `zustand` (^5.0.14) — per-chat vanilla store (via `createStore`, scoped by a React context at the `/chat/[id]` boundary) for cross-panel shared state and node-level streaming-payload isolation. This was already reserved for exactly this case in prior Phase-15-era research (`SPEC-RENDERER.md`); v1.3 is the first milestone that actually needs it.
- `@xyflow/react` (already `^12.11.0`) — reused as-is for the 2D canvas. **tldraw explicitly rejected**: its SDK requires a commercial/hobby license (with watermark) for any production deployment, and React Flow's node/edge model already maps directly onto "panels-as-nodes + data-carrying edges."

### Expected Features

**Must have (table stakes — standard chat-product mechanics; missing any makes `/chat` feel broken):**
- Message history persistence (survives reload/nav)
- Streamed text response with visible generating indicator
- Stop generation and regenerate/retry last response
- Inline, non-blocking, retryable error recovery
- Session/conversation list (sidebar, switch chats)
- Markdown + code-block rendering, auto-scroll with "jump to bottom"
- Input composer affordances (multi-line, disabled/queued while streaming), optimistic message render

All of these share one underlying streaming state machine — that state machine, not any individual feature, is the real Phase 22 engineering surface. Build stop/regenerate/history in from day one; retrofitting onto an already-built streaming loop is more expensive.

**Should have (differentiators — the v1.3 value proposition):**
- 2D infinite canvas with genui panels-as-nodes (spatial workspace vs. scrollback)
- Shared cross-panel state + data-carrying edges (one panel's output feeds another)
- Dual-channel proposal cards (read-only pickable next-step cards) — build first, lowest risk
- Dual-channel clarify-with-widgets (forms/pickers reusing the existing zero-eval form engine) — build after proposal cards prove the round-trip
- Widget→agent round-trip (tool-result resumes the streamed run) — the AI SDK tool-call/tool-result lifecycle is the authoritative blueprint, independently confirmed by Thesys C1 and assistant-ui
- Streamed partial-tree declarative UI (closes GEN-04) — genuinely new renderer engineering, not a byproduct of adding a transport

**Defer (v2+ / explicitly out of scope for v1.3):**
- Anticipatory/proactive prompting beyond a gated SPIKE (greenfield, no strong precedent, high false-positive-annoyance risk)
- Full collaborative rich-text/code document editing (ChatGPT-Canvas-style) — different product category
- Freeform whiteboard/drawing (tldraw's pen/ink) — not a scoped need
- Multiplayer/CRDT (Yjs) — no multiplayer requirement exists
- Voice/multi-modal input
- Full multi-agent orchestration visualizer — seams only, deferred to v1.5
- Auto-executing agent actions without explicit user confirmation — always an anti-feature

### Architecture Approach

v1.3 is a direct, additive extension of the existing Clean-Architecture FastAPI backend and Next.js/tRPC frontend — no parallel system, no new `apps/*` service. The chat orchestration loop is a new use case (`RunChatTurnUseCase`) depending only on new domain-port Protocols (`ChatModelPort`, `ConversationRepository`, `ChatMessageRepository`, `ChatRunRepository`, `CanvasSnapshotRepository`), mirroring the exact pattern already used by `GenerateUiSpecUseCase`. Streaming crosses FastAPI → web via a `StreamingResponse` SSE endpoint on the FastAPI side, relayed through a tRPC v11 `httpSubscriptionLink` subscription (SSE-based) on the Next.js side — chosen over a bare Route Handler passthrough specifically to preserve the codebase's one universal invariant that the browser never talks to FastAPI directly and the API key never leaves the server (`D-23`).

**Major components:**
1. `application/use_cases/run_chat_turn.py` (`RunChatTurnUseCase`) — the chat orchestration loop; async-generator entry points for a fresh turn and for dual-channel resume; depends only on ports (Clean Architecture preserved).
2. `infrastructure/llm/chat_model_adapter.py` (`ChatModelPort` impl) — wraps `AsyncAnthropicBedrock.messages.stream()`, reusing the existing client singleton and DI container conventions.
3. Four new Drizzle tables + Supabase repositories (`conversations`, `chat_messages`, `chat_runs`, `canvas_snapshots`) — two-sided pattern (TS schema/migration + Python adapter/port), `chat_messages.content` stores raw Anthropic content blocks verbatim (required for bit-for-bit resume of paused tool_use/tool_result rounds).
4. `packages/genui/src/streaming/*` (`StreamingSpecRenderer`, `tolerantParse`, `renderPartialTree`) — new, sibling to the existing untouched `SpecRenderer`; renders best-effort partial trees during a stream, then swaps to the real validated `SpecRenderer` on `spec_complete`. The trusted-interpreter guarantee is deferred, not weakened.
5. `apps/web/src/app/chat/*` (`ChatCanvasShell`, `GenuiPanelNode`, `ChatNode`, node-type registry) — thin client-island wrapper around `@xyflow/react`, mirroring the existing `/knowledge` implementation structurally; `GenuiPanelNode` wraps the unmodified `SpecRenderer`.

Widget→agent round-trip is a real HTTP pause/resume (persisted `chat_runs.status = 'paused_awaiting_input'`), not a held-open socket — the entire message history is replayed into a brand-new `.stream()` call on resume, which is why raw content-block persistence matters.

### Critical Pitfalls

1. **Cost guard breaks under streaming + proactive prompting** — the existing manual-click-only $30 AWS Budget guard assumes one bounded LLM call per user action; a persistent streamed chat (and later, LLM-initiated proactive prompts) breaks that assumption entirely. Avoid by building a real application-level per-session/per-turn cap (a circuit breaker, not a notification) in Phase 22, and rate-limiting Phase 25's proactive triggers with a cheap heuristic gate before they ever reach the LLM.
2. **SSE/streaming silently dies or buffers behind this project's own ALB** (60s default idle timeout) — works in local dev, breaks on real multi-turn latency or a paused dual-channel wait. Avoid by designing resumable/tracked streaming (`tracked()` + `lastEventId`) from day one even though v1.3 is local-only; note the ALB `idle_timeout` change as a deploy-readiness item.
3. **Naive JSON re-parsing of accumulating tool-use deltas is O(n²) and flickers** — Bedrock/Anthropic streams tool input as raw string fragments valid only at block-stop. Avoid by maintaining incremental parse state (new characters only) and debouncing UI re-renders to ~50-100ms.
4. **React Flow re-renders every node on every store update once nodes carry live/streaming content** — a known library limitation invisible in the existing mostly-static `/knowledge` usage, but a hard blocker the moment genui panels stream. Avoid by moving streaming payloads out of the React Flow `nodes` array into a separate (Zustand) store from the moment the canvas is first built — retrofitting this later is a structural rewrite.
5. **Widget→agent round-trip is a new untrusted-input surface with no existing security review** — structurally identical to the raw-email-injection problem Phase 4's dual-LLM quarantine already solved once. Avoid by re-validating every widget submission server-side against its declared Zod schema before it re-enters the model loop, and never combining `allow-scripts` + `allow-same-origin` on any widget iframe sandbox.

## Implications for Roadmap

Based on research, the prior synthesis's 4-phase structure is dependency-sound and confirmed by all four fresh research files. Suggested phase structure:

### Phase 22: Chat spine + persistence + streaming
**Rationale:** Everything else in the milestone hangs off this — the streaming transport, the data model, and the partial-render capability are load-bearing prerequisites for canvas (23) and dual-channel (24). This is greenfield: the existing `genui.generate` tRPC call fully buffers the FastAPI response today (GEN-04 is not partially solved, it's unsolved).
**Delivers:** `/chat` route; `conversation`/`chat_message`/`chat_run` Drizzle tables + Supabase repositories; `ChatModelPort` + `chat_model_adapter.py` wrapping `AsyncAnthropicBedrock.messages.stream()`; FastAPI SSE endpoint (`event: text_delta|spec_delta|spec_complete|run_paused|error|done`); tRPC `httpSubscriptionLink` relay; `@ai-sdk/react` `useChat` on the client; `StreamingSpecRenderer`/`tolerantParse`/`renderPartialTree` (closes GEN-04); the full table-stakes streaming state machine (stop/regenerate/error-recovery/session-list/history) built in from the start; the real application-level cost-guard circuit breaker.
**Addresses:** All table-stakes features from FEATURES.md; the "streamed partial-tree declarative UI" and "chat spine" differentiators.
**Avoids:** Pitfall 1 (cost guard), Pitfall 2 (SSE/ALB), Pitfall 3 (O(n²) partial-JSON parsing).

### Phase 23: 2D infinite canvas + panels-as-nodes + shared state
**Rationale:** Depends only on Phase 22's data model and the unmodified `SpecRenderer` — can start in parallel with Phase 22's harder streaming-render work once the data model lands, since the canvas doesn't touch streaming internals directly.
**Delivers:** `@xyflow/react`-based `ChatCanvasShell`; `GenuiPanelNode` (wraps existing `SpecRenderer`, unmodified) and `ChatNode`; node-type registry (additive, mirrors `COMPONENT_REGISTRY` pattern); data-carrying edges (`data.kind: "visual"|"data"`); `canvas_snapshots` table + `toObject()`-based persistence with a schema version.
**Uses:** `@xyflow/react` (reuse), `zustand` (per-chat store, streaming-payload isolation) from STACK.md.
**Implements:** Canvas component map and node-registry pattern from ARCHITECTURE.md §1 and §6.
**Avoids:** Pitfall 4 (React Flow full-canvas re-render cliff) — the state-architecture decision (streaming payload lives outside the `nodes` array) must be made here, at canvas-build time, not retrofitted.

### Phase 24: Dual-channel genui — proposal cards → clarify-with-widgets → round-trip
**Rationale:** Needs both the chat loop's tool-call/tool-result mechanism (Phase 22) and a surface to display/host the widget (Phase 23's panels or the docked chat view). Proposal cards (read-only-until-click, no state-corruption risk) must ship before clarify-with-widgets (read-write forms, more failure surface) — confirmed independently by FEATURES.md and the prior synthesis.
**Delivers:** Interactive genui nodes emitted via the existing `emit_ui_spec` tool; `chat_runs.status = 'paused_awaiting_input'` pause/resume state machine; `chat.respond` tRPC procedure; server-side re-validation of every widget submission against its declared Zod schema; widget lifecycle locking (disable-on-submit) to prevent double-submit.
**Addresses:** Dual-channel proposal cards and clarify-with-widgets differentiators from FEATURES.md.
**Avoids:** Pitfall 5 (untrusted widget-submission injection surface) and the double-submit/stale-UI UX pitfalls.

### Phase 25: Anticipatory prompting (SPIKE)
**Rationale:** Needs chat + canvas state to observe in order to decide when to prompt — correctly sequenced last; no architectural changes needed to Phases 22-24 to support it later, since it consumes the `chat_runs`/`chat_messages` seam already built.
**Delivers:** A trigger/heuristic layer over chat+canvas state, gated by an appropriateness eval AND a hard frequency cap (independent of the eval) before any candidate prompt reaches the LLM. Scoped explicitly as a SPIKE with an eval gate as the exit criterion, not a shipped feature commitment.

### Phase Ordering Rationale

- **Dependency chain is linear and confirmed by all four files:** chat spine (transport + data model) → canvas (hosts panels, needs the data model) → dual-channel (needs both the tool-call mechanism from chat spine and a display surface from canvas) → anticipatory prompting (observes state from all three prior phases).
- **Within Phase 22 specifically**, ARCHITECTURE.md's suggested build order should be followed: data model first (low-risk plumbing, unblocks parallel work) → `ChatModelPort` + a non-streaming smoke test (de-risks Bedrock streaming mechanics in isolation) → text-only streaming end-to-end (proves transport before adding partial-spec complexity) → tRPC subscription + minimal UI → `StreamingSpecRenderer` built and fixture-tested against captured `partial_json` sequences before wiring it live.
- **This grouping avoids retrofitting the two most expensive-to-retrofit decisions:** the streaming-state-machine primitives (stop/regenerate/history) must be built with the chat spine, not bolted on later; the React-Flow-state-architecture separation (streaming payload outside `nodes`) must be decided when canvas is first built, not after panels already read from `node.data`.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 22:** the exact current `@ai-sdk/react` API method name for client-side tool-result submission should be re-verified against the pinned version at implementation time (AI SDK has renamed this across majors); the exact `partial_json` accumulation/parsing edge cases are worth a small isolated research/spike pass using AI SDK's `parsePartialJson` as reference.
- **Phase 24:** MCP Apps' host-pre-review/explicit-approval posture should be re-checked against the SEP-1865 spec's current state at implementation time (it was still a very recent extension as of this research, 2026-01-26).
- **Phase 25:** genuinely greenfield — no strong published product/protocol precedent exists; treat the SPIKE itself as the research vehicle rather than researching further upfront.

Phases with standard patterns (skip research-phase):
- **Phase 23:** well-documented — React Flow's own performance guide, the existing `/knowledge` implementation as a direct structural template, and the tldraw-license rejection are all settled with primary sources.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | STACK.md verified every recommendation against official docs/changelogs (FastAPI, Anthropic SDK, AI SDK, tldraw licensing, React Flow, Zustand) and against direct repository inspection of the existing Bedrock transport. Two MEDIUM sub-flags remain: the exact `@ai-sdk/react` tool-result-submission API name, and the `parsePartialJson` export path — both version-drift risks, not architecture risks. |
| Features | HIGH | FEATURES.md cross-references 7 independent reference products (Claude Artifacts, ChatGPT Canvas, tldraw computer, Thesys C1, assistant-ui, Vercel AI SDK Generative UI, v0) with official docs for each; the "component-allowlist + $action/$input round trip" shape is confirmed by three independent sources (C1, AI SDK, assistant-ui), a strong convergence signal. |
| Architecture | HIGH | ARCHITECTURE.md is grounded primarily in direct repository inspection (11 explicit "ground truth" findings verified by reading actual source files, not assumed) plus HIGH-confidence primary-source verification of tRPC v11 subscriptions and Anthropic streaming mechanics this run. |
| Pitfalls | MEDIUM-HIGH | Streaming transport, React Flow perf, MCP Apps security, and Bedrock tool-use streaming pitfalls are FRESH-verified against official docs/vendor sources. Anticipatory-prompting UX risk and exact chat-persistence-race patterns are MEDIUM — verified against multiple secondary sources, not a single authoritative spec (consistent with Phase 25 itself being flagged as greenfield). |

**Overall confidence:** HIGH

### Gaps to Address

- **R2/R4 `[MODEL — pending validation]` flags from the prior synthesis are now resolved for R2** (canvas: `@xyflow/react` reuse confirmed HIGH via tldraw licensing + React Flow perf docs) **but R4 (orchestration-visualizer seams) was not directly re-validated this pass** — the four research files focus on Phases 22-24; R4's seams (node-type registry, data-carrying edges, run/event schema stub, agent/run abstraction) are architecturally satisfied by this milestone's design as a byproduct (per ARCHITECTURE.md §6/§7) but the deferred v1.5 orchestration-visualizer tooling landscape itself (LangGraph Studio, AutoGen Studio, etc.) remains `[MODEL]` and should be freshly researched when v1.5 is actually scoped.
- **The exact `@ai-sdk/react` client API for tool-result submission** and the exact `parsePartialJson`/partial-JSON-utility export path should be verified against the pinned package version at Phase 22/24 implementation time — AI SDK has reorganized utility packages across majors.
- **ALB idle-timeout and streaming-buffering behavior** is flagged as a deploy-readiness gap, not a v1.3 blocker (project is local/sandbox only per PROJECT.md) — must be revisited explicitly before any connected-environment deploy of `/chat`.
- **Anticipatory prompting (Phase 25) has no strong published precedent** — this is a known, accepted gap; the SPIKE format with an appropriateness-eval gate is the intentional mitigation, not something to resolve via more research.

## Sources

### Primary (HIGH confidence)
- FastAPI SSE — https://fastapi.tiangolo.com/tutorial/server-sent-events/
- Anthropic Messages streaming — https://platform.claude.com/docs/en/build-with-claude/streaming
- AWS Bedrock tool-use + fine-grained streaming — https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html
- AI SDK UI Message Stream Protocol (backend-agnostic, named Python example) — https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- AI SDK Generative UI pattern — https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- tRPC v11 `httpSubscriptionLink` / SSE subscriptions — https://trpc.io/docs/client/links/httpSubscriptionLink, https://trpc.io/docs/server/subscriptions
- React Flow performance + state management — https://reactflow.dev/learn/advanced-use/performance, https://reactflow.dev/learn/advanced-use/state-management
- xyflow GitHub issue/discussion on custom-node re-render perf — https://github.com/xyflow/xyflow/issues/4711, https://github.com/xyflow/xyflow/discussions/4975
- tldraw licensing — https://tldraw.dev/community/license, https://tldraw.dev/legal/tldraw-license
- Claude Artifacts — https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- ChatGPT Canvas — https://openai.com/index/introducing-canvas/
- Thesys C1 — https://docs.thesys.dev/guides/what-is-thesys-c1
- MCP Apps (SEP-1865) — https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- AWS ALB idle timeout — https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
- Bedrock `ConverseStream` API reference — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
- Direct repository inspection (this run): `apps/email-listener/app/infrastructure/llm/anthropic_client.py`, `genui_generator_adapter.py`, `genui_code_generator_adapter.py`, `container.py`, `presentation/api/v1/genui.py`, `packages/api-client/src/router/genui/generate.ts`, `packages/db/src/schema/ui-spec-templates.ts`, `apps/web/src/app/knowledge/_components/knowledge-graph-island.tsx`, `apps/web/package.json`, `infrastructure/aws/ecs.tf`

### Secondary (MEDIUM confidence)
- tldraw Agent Starter Kit — https://tldraw.dev/starter-kits/agent
- assistant-ui generative UI — https://www.assistant-ui.com/docs/tools/generative-ui
- `fastapi-ai-sdk` PyPI (reference bridge, not adopted as dependency) — https://pypi.org/project/fastapi-ai-sdk/
- General chatbot UX table-stakes roundups (multiple 2026 sources, cross-referenced) — mindtheproduct.com, sendbird.com, fuselabcreative.com
- Anticipatory-prompting HCI literature — CHI 2025 "Need Help? Designing Proactive AI Assistants for Programming" (https://dl.acm.org/doi/10.1145/3706598.3714002), arXiv 2502.18658
- Vercel AI SDK `streamObject`/`partialObjectStream` technique (replicated, not adopted as dependency) — https://sdk.vercel.ai/examples/node/streaming-structured-data/stream-object

### Tertiary (LOW confidence)
- None flagged — all research this pass reached at least MEDIUM confidence with cross-referenced sources.

---
*Research completed: 2026-07-02*
*Ready for roadmap: yes*
