# Pitfalls Research

**Domain:** Conversational GenUI — streamed chat + 2D infinite canvas + dual-channel widget round-trips, added to an existing FastAPI/Bedrock + Next.js/tRPC + Drizzle/Supabase genui system
**Researched:** 2026-07-02
**Confidence:** MEDIUM-HIGH (streaming transport, React Flow perf, MCP Apps security, and Bedrock ConverseStream tool-streaming are FRESH-verified from official docs/vendors; anticipatory-prompting and exact chat-persistence-race patterns are MEDIUM — verified against multiple secondary sources, not a single authoritative spec)

This document extends `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md` (R1–R4) — it does not repeat the architecture decisions there (declarative catalog for dual-channel widgets, code-island for appearance, React Flow reuse leaning, MCP Apps as security blueprint). It focuses on **integration mistakes when wiring these into THIS stack**: FastAPI → Bedrock `ConverseStream` → SSE/tRPC stream → Next.js chat UI → React Flow canvas → declarative widget round-trip → Drizzle/Supabase persistence, plus the two known local landmines (stale `@lru_cache` settings under uvicorn `--reload`/zombie processes, and Zod/React-ref objects that cannot cross the Next.js server→client boundary) which now interact with streaming state in new ways.

---

## Critical Pitfalls

### Pitfall 1: The $30 cost guard was designed for manual-click-only generation — streaming chat + proactive prompting silently break that assumption

**What goes wrong:**
Phase 16–20's cost guard (AWS Budget alert, "conservative defaults," **manual-click-only generation**) assumes each genui generation is a single, user-initiated, bounded LLM call. A persistent `/chat` with `ConverseStream` is a fundamentally different cost shape: every keystroke-driven turn is a new streamed completion, multi-turn context grows the prompt on every round-trip (full history resent unless truncated/summarized), and **Phase 25's anticipatory prompting is explicitly designed to fire LLM calls without a user click** — the one invariant the current guard relies on. A single runaway chat session (long conversation, verbose spec streaming, a proactive-prompting heuristic that fires every few seconds) can blow the monthly budget in hours, and an AWS Budget *alert* is a notification, not a circuit breaker — it does not stop in-flight requests.

**Why it happens:**
The guard was scoped to v1.2's actual behavior at the time it was built (click → generate → done). Nobody revisits a safety mechanism's assumptions when a new milestone changes the triggering model, because the guard "still exists" and looks satisfied by inspection.

**How to avoid:**
Treat the cost guard as a requirement to **re-derive**, not inherit, in Phase 22. Concretely: (1) a hard per-session token/turn cap independent of the AWS Budget alert (a real circuit breaker, not a notification), (2) truncate/summarize chat history before resending to `ConverseStream` rather than resending the full transcript every turn, (3) Phase 25's proactive triggers must be rate-limited (e.g., max N proactive prompts per session/hour) *before* they reach the LLM, not just eval-gated on appropriateness after the fact, (4) keep the existing manual-click model for code-island generation (still the most expensive path) and only relax it for the cheaper declarative/text streaming paths.

**Warning signs:**
Phase 22 ships chat streaming with only the existing AWS Budget alert as protection; no per-session or per-turn cap exists in code; Phase 25 triggers call the LLM directly to *decide* whether to prompt (using the expensive model to gate itself) rather than a cheap heuristic layer.

**Phase to address:**
Phase 22 (chat spine) — establish the real circuit breaker before any streaming ships. Phase 25 (anticipatory prompting) — must inherit and respect it, not introduce a second uncontrolled trigger source.

---

### Pitfall 2: SSE/streaming responses silently buffer or die behind the ALB/reverse-proxy path this project already uses

**What goes wrong:**
This project's existing infra (`infrastructure/aws/ecs.tf`) fronts services with an ALB whose **default idle timeout is 60 seconds** [FRESH✓, AWS docs]. A streamed Bedrock response with a pause longer than that (slow-thinking turn, tool-use round-trip, a widget waiting on user input mid-stream) gets the connection silently killed, and the client sees a hung request or an abrupt cutoff — not a clean error. Separately, any proxy layer (Nginx, an API gateway, even some CDNs) that buffers responses by default turns a token-by-token stream into delayed bursts, defeating the entire point of streaming. `httpBatchStreamLink`/`httpSubscriptionLink` in tRPC also do not support setting response headers/cookies once the stream has begun [FRESH✓, tRPC docs] — a mistake if any procedure needs to set auth cookies mid-stream.

**Why it happens:**
Streaming "works" in local dev (no proxy in the path) and works in the first few manual tests (short responses, well under 60s), so the failure mode only appears under real multi-turn chat latency or when the dual-channel round-trip pauses for user input — exactly the cases Phase 22–24 are built around. This project's milestone context says v1.3 is **local/sandbox only**, so the ALB timeout is not an immediate blocker, but the pitfall is real for the eventual connected-env deploy and should be designed against now rather than retrofitted.

**How to avoid:**
Design the streaming transport to tolerate disconnection from day one, even while running local-only: (1) use `tracked()`-helper events with an `id` in tRPC subscriptions so the client can reconnect and resume from `lastEventId` [FRESH✓, tRPC docs] rather than assuming one unbroken connection for the life of a turn, (2) keep heartbeats/keep-alive frames flowing during long silent gaps (tool-use "thinking" time) so idle timeouts never trigger, (3) when this does get deployed, raise ALB idle timeout explicitly (`idle_timeout` attribute, up to 4000s) and disable proxy response buffering, (4) do not set cookies/headers inside a streamed procedure — use `httpBatchLink` for anything that needs to mutate response headers.

**Warning signs:**
Chat responses that "just stop" mid-sentence with no error surfaced to the user; works fine for short answers, breaks only on long multi-tool-call turns; no reconnection/resume logic exists — a dropped connection loses the in-flight turn entirely.

**Phase to address:**
Phase 22 (chat spine + streaming transport) — build resumable/tracked streaming from the start even though the ALB constraint doesn't bite until deploy; note the ALB config change as a deploy-readiness item, not a v1.3 blocker.

---

### Pitfall 3: Bedrock `ConverseStream` tool-use deltas arrive as a string that must be manually assembled and validated before it is valid JSON — and this project's declarative spec streaming needs the same discipline one layer up

**What goes wrong:**
Unlike the non-streaming Converse API (which returns a fully-formed `Document` for tool input), `ConverseStream` delivers tool/spec input incrementally through `contentBlockDelta` events as **raw string chunks** that must be concatenated and only become valid JSON at `contentBlockStop` [FRESH✓, AWS docs]. Naively calling `JSON.parse()` on each partial chunk throws; naively re-parsing the whole accumulated string on every delta is O(n²) over a long stream and can visibly stutter. This is exactly the same problem the milestone's own goal — "streamed partial-tree declarative specs" (closes GEN-04) — has to solve one layer up: a genui spec tree is not renderable until enough of the JSON exists to represent a valid partial node, and naive re-parsing will flicker the canvas.

**Why it happens:**
The streaming and non-streaming Bedrock code paths look similar at the call-site (`ConverseStream` vs `Converse`) but have different data shapes for tool input, and it's easy to write the assembly/parsing code once, get it working for short demo specs, and not notice the O(n²) cost or the render-flicker until specs get longer (which is exactly when the dual-channel/canvas features in Phase 23–24 start emitting bigger trees).

**How to avoid:**
(1) Maintain parsing state between chunks — process only the new characters each delta, don't re-scan from the start [FRESH✓]. (2) Use or write a streaming/incremental JSON parser (or a partial-JSON completion library) rather than raw `JSON.parse` on partial strings, so a syntactically-incomplete tree can still produce a best-effort valid partial structure. (3) Debounce re-renders of the canvas/chat UI to roughly human-readable cadence (50–100ms) — re-rendering on every token is wasted work and causes visible flicker, especially where a partial spec briefly looks like one node type before resolving into another (analogous to markdown's "two backticks looks like inline code until the third arrives" problem) [FRESH✓]. (4) The renderer must explicitly define what "valid partial tree" means for the declarative spec schema (e.g., an unclosed node renders as a loading placeholder, not an error) — this is new interpreter behavior beyond what the Phase 12–15 spec-first renderer needed, since it was never asked to render incomplete trees before.

**Warning signs:**
Streamed spec rendering works in short demo widgets but stutters/flickers on longer specs; the renderer throws and shows an error boundary mid-stream instead of a loading state; CPU usage during a long stream is visibly higher than the byte count would suggest (a smell for O(n²) re-parsing).

**Phase to address:**
Phase 22 (chat spine + streamed declarative spec) — this is the phase whose explicit goal is "streamed partial-tree declarative specs," so the partial-JSON assembly discipline and the interpreter's partial-tree tolerance must both be built here, not patched in later.

---

### Pitfall 4: React Flow re-renders every node on every store update once nodes carry live/streaming content

**What goes wrong:**
React Flow's `useStore` selector for `selectedNodes` changes reference on *every* `state.nodes` update, which — combined with un-memoized custom node components — causes **all nodes on the canvas to re-render on every state change**, not just the one that changed [FRESH✓, xyflow GitHub issue #4711 / discussion #4975]. This is a known, previously-irrelevant limitation that becomes a hard blocker the moment nodes contain live-updating content: Phase 23's genui-panels-as-nodes plus Phase 22's streamed spec content means node payloads update dozens of times per second during an active stream, and each update can force a full-canvas re-render pass across every panel, tanking perf as panel count grows — exactly when the "2D infinite canvas of genui panels" milestone goal is most visually impressive (many panels open at once).

**Why it happens:**
React Flow's existing use in this project (`/knowledge`, per PROJECT.md) is a mostly-static graph — nodes don't change dozens of times a second — so this perf cliff was never hit before. It only appears when nodes become live/streaming, which is new in v1.3.

**How to avoid:**
(1) Memoize every custom node component with `React.memo`, define them outside the parent component (stable reference), and memoize any callback props with `useCallback` [FRESH✓]. (2) Move the frequently-changing streaming payload *out* of the React Flow `nodes` array/state and into a separate store (Zustand-style) that individual node components subscribe to directly with precise selectors — so a stream update touches only the one subscribed component, not the shared `nodes` state that all node components implicitly depend on [FRESH✓, matches R2's "observable per-chat store" leaning already in the synthesis]. (3) Debounce the visual re-render rate for streaming content the same way as Pitfall 3 (50–100ms), independent of how often the underlying data updates. (4) If panel count grows large, consider virtualizing/collapsing off-screen panels rather than keeping every node fully mounted and subscribed.

**Warning signs:**
Canvas frame rate drops as soon as a second or third panel is actively streaming simultaneously; dragging one panel while another streams feels laggy; React DevTools profiler shows every node component re-rendering on a single panel's content update.

**Phase to address:**
Phase 23 (2D infinite canvas + shared state) — the state-architecture decision (stream payload lives outside the React Flow `nodes` array) must be made when the canvas is first built, since retrofitting it after panels already read streaming content from `node.data` is a structural rewrite, not a tweak.

---

### Pitfall 5: Widget→agent round-trips are a new "user input" surface with no existing security review — treat every widget submission as untrusted, same as raw email input

**What goes wrong:**
Phase 24's dual-channel round-trip (clarify-with-widgets → tool-result resumes the streamed run) means the LLM agent now receives structured data that a **user manipulated in the browser** and that becomes part of the conversation the agent reasons over next. Without deliberate design, this creates a fresh injection surface analogous to the raw-email quarantine problem this project already solved once (Phase 4's dual-LLM quarantine so raw email never reaches the generator directly) — except here nobody has built the equivalent boundary yet, because dual-channel widgets are new in v1.3. A widget that lets a user type free text (a clarification form) and pipes it straight back into the next `ConverseStream` turn is a prompt-injection vector; a widget whose tool-call is trusted blindly (no host-side re-validation of the returned payload against the tool's declared schema) lets a compromised/buggy client send anything.

**Why it happens:**
The AI SDK generative-UI pattern and MCP Apps both make the mechanics look safe by construction (schema-validated tool-call args, host pre-review + explicit user approval for UI-initiated tool calls) [FRESH✓, ai-sdk.dev + MCP Apps spec], but "the pattern supports safety" is not the same as "this implementation enforces it." It's easy to wire the round-trip functionally (widget submits → run resumes) without adding the schema re-validation and injection-awareness that make it safe.

**How to avoid:**
(1) Re-validate every widget submission server-side against the tool's declared Zod schema before it re-enters the `ConverseStream` loop — never trust that the client only sent what the widget UI allowed. (2) Free-text fields inside widgets (clarification forms) should be treated with the same suspicion as any other untrusted user input reaching the LLM — no special exemption just because it arrived via a "structured" widget. (3) Follow the MCP Apps posture explicitly: UI-initiated tool calls go through host pre-review, not directly to execution [FRESH✓]. (4) If/when an iframe boundary is used for any widget rendering, do not combine `allow-scripts` with `allow-same-origin` in the same sandbox — that combination lets the framed content escape its sandbox by manipulating the parent DOM [FRESH✓, MCP Apps docs] — this is the same class of gotcha Phase 20's code-island jail already had to get right (opaque-origin iframe, no same-origin) for a different reason; the dual-channel widget path must not accidentally relax it.

**Warning signs:**
Widget submission handlers deserialize and forward the payload without a schema `safeParse`; a free-text widget field's content is string-concatenated directly into the next prompt; any widget iframe sandbox attribute list includes both `allow-scripts` and `allow-same-origin`.

**Phase to address:**
Phase 24 (dual-channel genui) — the round-trip's server-side re-validation boundary must be built alongside the round-trip itself, not added after a security review finds it missing.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Resend full chat history on every `ConverseStream` turn instead of truncating/summarizing | Simple, no summarization logic to build | Cost scales quadratically with conversation length; interacts directly with Pitfall 1's budget risk | Never past a short demo — cap or summarize before Phase 22 ships |
| Store live streaming payload inside the React Flow `nodes` array (`node.data`) | Fewer moving parts, one state tree | Forces the full-canvas re-render cliff (Pitfall 4) once panels stream simultaneously | Only acceptable for a throwaway spike with 1-2 static panels |
| Trust widget tool-result payloads without re-validating against the Zod schema server-side | Faster to wire the round-trip end-to-end | Reopens the exact injection-surface class Phase 4's email quarantine was built to close | Never — this is a security boundary, not a convenience |
| Skip reconnection/resume (`tracked()` + `lastEventId`) for the first streaming implementation | Ships faster | Any dropped connection (ALB timeout, network blip, browser tab sleep) loses the entire in-flight turn with no recovery | Acceptable only for the very first local spike; must be added before Phase 22 is considered done |
| Let Phase 25's proactive-prompting heuristic call the LLM itself to decide whether to prompt | Reuses the same "smart" model for everything, less code | Defeats the purpose of a cheap pre-filter — every proactive check now costs a full LLM call, worsening Pitfall 1 | Never as the primary gate; fine as a secondary confirmation step after a cheap heuristic has already filtered |

## Integration Gotchas

Common mistakes when connecting to external services/libraries in this stack.

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Bedrock `ConverseStream` (tool/spec streaming) | Treating tool-input deltas like the non-streaming `Converse` API's `Document` type | Assemble the raw string deltas across `contentBlockDelta` events, parse only at/incrementally toward `contentBlockStop` [FRESH✓] |
| Bedrock IAM permissions | Granting only `bedrock:InvokeModel` and assuming streaming works | `ConverseStream` requires the separate `bedrock:InvokeModelWithResponseStream` IAM action — streaming fails closed with access-denied otherwise [FRESH✓] |
| tRPC `httpBatchStreamLink` | Trying to set response headers/cookies from inside a streamed procedure | Use `httpBatchLink` (non-streaming) for anything that mutates headers/cookies; streaming links don't support it once the stream has begun [FRESH✓] |
| tRPC SSE subscriptions | Assuming one unbroken connection for the life of a chat turn | Use the `tracked()` helper with an `id` so the client auto-reconnects and resumes from `lastEventId` [FRESH✓] |
| React Flow custom nodes | Defining node components inline inside the parent render function | Define outside the component (or memoize) so React doesn't treat them as a new type every render, which defeats `React.memo` entirely [FRESH✓] |
| React Flow canvas persistence | Persisting `toObject()`/store snapshot verbatim as the source of truth without a schema version | Version the serialized canvas snapshot the same way the genui registry is versioned (R4 seam #2), so a future node-type addition doesn't silently break deserialization of old chats |
| MCP Apps / widget iframes | Combining `allow-scripts` + `allow-same-origin` "to make things easier" | Never combine them — that pairing lets framed content escape its own sandbox [FRESH✓]; mirrors the constraint Phase 20's code-island jail already enforces |
| Next.js server→client boundary (already a known local gotcha) | Passing a Zod schema instance or a React ref as a streamed chunk's payload across the RSC/client boundary | Stream plain serializable JSON only; hydrate Zod schemas and refs client-side from a schema *name*/id, not the object itself — the same rule that already applies to non-streaming genui specs now also applies to every streamed chunk |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Naive `JSON.parse` re-scan of the accumulating spec string on every delta | Stream feels fine on short specs, visibly stutters/CPU-spikes on long ones | Maintain incremental parse state; parse only new characters per chunk [FRESH✓] | Scales O(n²) — breaks once a spec/response exceeds a few hundred tokens of streamed content |
| Un-memoized custom React Flow node components with live content | Fine with 2-3 static panels; canvas gets sluggish as panels increase | `React.memo` + stable component identity + move live data out of the shared `nodes` array [FRESH✓] | Breaks once 2+ panels stream simultaneously, or once panel count exceeds roughly a dozen |
| Re-rendering the chat/canvas UI on every single streamed token | Looks "real-time" in a demo with one user, wastes CPU/battery at any real usage | Debounce re-renders to ~50-100ms — imperceptible to users, dramatically cheaper [FRESH✓] | Breaks (visibly janky) as soon as multiple streams run concurrently (e.g., a proposal card widget streaming while the canvas has other active panels) |
| Resending full conversation history every turn | Works fine for the first 5-10 turns of a demo conversation | Truncate/summarize history before it's sent to `ConverseStream`; cap max context sent | Cost and latency both grow with conversation length; compounds directly with Pitfall 1 |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting widget tool-result payloads as already-validated because "the UI only let them submit valid values" | Client-side widget code is not a trust boundary; a modified/compromised client can submit anything back into the agent loop | Re-`safeParse` every widget submission server-side against the declared Zod schema before it re-enters the run |
| Free-text fields inside clarify-with-widgets treated as "structured" and therefore safe | Prompt injection via a form field is functionally identical to prompt injection via raw email — same risk class, different channel | Apply the same untrusted-input discipline Phase 4's dual-LLM quarantine already established; don't grant widget text an implicit trust upgrade |
| `allow-scripts` + `allow-same-origin` on any widget/panel iframe sandbox | Full sandbox escape — the framed content can manipulate the parent DOM and remove its own sandbox attribute [FRESH✓] | Never combine these two flags; mirror the existing code-island jail's opaque-origin, no-same-origin posture |
| UI-initiated tool calls executed without host pre-review | A widget can trigger an unintended/unapproved agent action directly | Route UI-initiated tool calls through explicit host-side review/approval before execution, per the MCP Apps posture [FRESH✓] |
| AWS Budget alert treated as an enforcement mechanism | It's a notification, not a circuit breaker — cost can run well past the alert threshold before a human reacts | Build an explicit per-session/per-turn cap in application code (Pitfall 1) |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Stale widget state after a run resumes | User clicks a proposal card, the run continues elsewhere, but the card still shows its pre-submission state — user double-submits or gets confused about what happened | Explicitly model widget lifecycle state (`input-available` → loading → `output-available`/error) the way AI SDK's `message.parts` does [FRESH✓]; disable/replace the widget the instant its submission is sent, before the round-trip resolves |
| Double-submit on a slow round-trip | User clicks "confirm" twice because nothing visibly happened for a second; agent receives two tool results for one action | Optimistically lock the widget on first click, ignore subsequent clicks until the server acknowledges (not just until the LLM responds) |
| Proactive prompts fire based on the agent's own guess of "appropriate" without a hard rate limit | Users perceive the assistant as "distracting"/"annoying" even when individual prompts are individually reasonable — frequency, not correctness, is what breaks trust [FRESH✓, CHI research] | Cap proactive-prompt frequency per session *before* the appropriateness eval runs, not just gate on a single appropriateness score per candidate prompt |
| Canvas panel re-render flicker during streaming makes the UI feel broken rather than "live" | Users interpret visual jank as a bug, undermining confidence in the whole feature | Debounce to human-readable cadence (Performance Traps table); ensure partial-tree rendering shows an intentional loading state, never a flash of an invalid/error UI |
| No visible reconnection/recovery affordance when a stream drops (ALB timeout, network blip) | Conversation just stops with no explanation; user doesn't know if it's still "thinking" or dead | Surface a clear "reconnecting…"/"resume" state tied to the `tracked()`/`lastEventId` mechanism, not a silent hang |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Chat streaming (Phase 22):** Often missing reconnection/resume logic — verify a mid-stream network drop resumes from `lastEventId` rather than losing the turn.
- [ ] **Streamed declarative spec rendering (Phase 22):** Often missing partial-tree tolerance — verify the interpreter shows a loading placeholder (not an error boundary) for an intentionally-truncated spec mid-stream.
- [ ] **Canvas panels-as-nodes (Phase 23):** Often missing the state-architecture separation between React Flow's `nodes` array and live streaming payloads — verify perf with 3+ panels streaming simultaneously, not just 1.
- [ ] **Canvas persistence (Phase 23):** Often missing a schema version on the serialized snapshot — verify an old persisted canvas still deserializes after a node-type registry change.
- [ ] **Dual-channel round-trip (Phase 24):** Often missing server-side re-validation of the widget's returned payload — verify a hand-crafted/tampered tool-result is rejected, not just a well-formed one accepted.
- [ ] **Dual-channel round-trip (Phase 24):** Often missing widget lifecycle locking — verify rapid double-click on a submit widget produces exactly one tool result, not two.
- [ ] **Cost guard (Phase 22 & 25):** Often "still exists" only as the old AWS Budget alert — verify an actual application-level per-session/per-turn cap exists and is exercised by a test, not just documented.
- [ ] **Anticipatory prompting (Phase 25):** Often missing a hard frequency cap independent of the appropriateness eval — verify a pathological session (rapid state changes) can't trigger more than N proactive prompts per hour.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Cost guard gap discovered after a runaway session | MEDIUM | Add the per-session/per-turn cap retroactively; audit Bedrock CloudWatch usage logs to quantify actual spend; consider a temporary hard kill-switch env var while the proper cap ships |
| React Flow full-canvas re-render cliff discovered late | HIGH | Requires moving streaming payload out of `nodes` state into a separate store — a structural change touching every panel component, not a local fix; budget this as a dedicated refactor, not a quick patch |
| Widget round-trip found to skip server-side re-validation | MEDIUM | Add the `safeParse` boundary at the round-trip's server entrypoint; audit any already-persisted conversations for widget submissions that would now fail validation (treat as a data-quality review, not just a code fix) |
| Canvas snapshot schema drift breaks old persisted chats | MEDIUM-HIGH | Write a one-time migration/upgrader for old snapshots (mirrors the region-versioning/supersede-safe pattern already used elsewhere in this project — Phase 6) rather than discarding old canvas state |
| Proactive prompting proves too noisy after shipping | LOW | It's explicitly a SPIKE (Phase 25) — the fastest recovery is tightening the frequency cap and appropriateness threshold, or disabling the trigger layer entirely behind a feature flag, without touching the chat/canvas/dual-channel foundation underneath |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Cost guard doesn't cover streaming/proactive triggers | Phase 22 (established), Phase 25 (inherits) | A test/manual check that a long synthetic session hits an application-level cap before AWS Budget alert would ever fire |
| SSE/ALB/proxy buffering & idle-timeout drops | Phase 22 | Reconnection test: kill the connection mid-stream, verify resume from `lastEventId`; document the ALB `idle_timeout` change needed before eventual deploy |
| Partial-JSON tool/spec streaming assembly + O(n²) re-parse | Phase 22 | Long-spec streaming test with a CPU/latency profile check, not just a functional pass/fail |
| React Flow full-canvas re-render under live content | Phase 23 | Perf check with 3+ simultaneously-streaming panels; React DevTools profiler shows only the touched node re-rendering |
| Canvas snapshot serialization drift | Phase 23 | Deserialize an old fixture snapshot after a deliberate node-type/schema change; must not throw |
| Widget→agent round-trip trust boundary | Phase 24 | Adversarial test: hand-crafted tool-result payload is rejected server-side |
| Double-submit / stale widget state | Phase 24 | Rapid-double-click test on a submit widget produces exactly one resumed run |
| Anticipatory prompting annoyance/false positives | Phase 25 | Eval on appropriateness AND a hard frequency-cap test independent of that eval |

## Sources

- [How to Configure Server-Sent Events Through Nginx](https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view)
- [Edit attributes for your Application Load Balancer — AWS docs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)
- [ConverseStream — Amazon Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)
- [AWS Bedrock Converse API with Rust: Tool Use + Streaming](https://levelup.gitconnected.com/aws-bedrock-converse-api-with-rust-tool-use-streaming-e20b7f42a5bd)
- [HTTP Batch Stream Link — tRPC docs](https://trpc.io/docs/client/links/httpBatchStreamLink)
- [Subscriptions — tRPC docs](https://trpc.io/docs/server/subscriptions)
- [HTTP Subscription Link — tRPC docs](https://trpc.io/docs/client/links/httpSubscriptionLink)
- [Performance — React Flow official docs](https://reactflow.dev/learn/advanced-use/performance)
- [Performance issues with custom nodes (React) · xyflow/xyflow#4711](https://github.com/xyflow/xyflow/issues/4711)
- [How to improve React Flow performance when rendering a large number of nodes and edges · xyflow/xyflow discussion #4975](https://github.com/xyflow/xyflow/discussions/4975)
- [Streaming AI responses and the incomplete JSON problem](https://www.aha.io/engineering/articles/streaming-ai-responses-incomplete-json)
- [Streaming UI Patterns That Don't Break](https://thepromptbench.com/ai-product-ux/streaming-ui-patterns-that-dont-break/)
- [MCP Apps — Model Context Protocol overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps — Bringing UI Capabilities To MCP Clients](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [AI SDK UI: Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Designing chat architecture for reliable message ordering at scale — Ably](https://ably.com/blog/chat-architecture-reliable-message-ordering)
- [Need Help? Designing Proactive AI Assistants for Programming (CHI 2025)](https://dl.acm.org/doi/10.1145/3706598.3714002)
- [Assistance or Disruption? Exploring and Evaluating the Design and Trade-offs of Proactive AI Programming Support](https://arxiv.org/pdf/2502.18658)
- Project sources: `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md`, `.planning/PROJECT.md`, `infrastructure/aws/ecs.tf`, MEMORY notes (llm-transport-bedrock, code-island-sandbox-architecture, aws-cost-optimization)

---
*Pitfalls research for: Conversational GenUI (chat streaming, infinite canvas, dual-channel widgets) — v1.3*
*Researched: 2026-07-02*
