# Feature Landscape

**Domain:** Conversational generative UI — chat spine + 2D canvas + dual-channel widgets
**Milestone:** v1.3 "Conversational GenUI: Chat, Canvas & Dual-Channel"
**Researched:** 2026-07-02
**Builds on:** `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md`, `.planning/research/v1.3/R1-DESIGN-GENERATION-ARCHITECTURE.md`

**Scope note:** This covers only the NEW conversational/canvas surface for v1.3. The declarative
genui engine itself (Catalog → Spec → Registry → Renderer, style packs, code-island, form engine)
is already built (v1.1/v1.2) and is a *dependency*, not something re-researched here.

---

## How the reference products actually work

| Product | Pattern | Relevance |
|---|---|---|
| **Claude Artifacts** | Chat stays the primary column; when output is "substantial standalone content" (code/HTML/SVG/React/Mermaid/doc), a side panel opens showing a live, versioned preview. Continuing the conversation updates the artifact *in place* (no new duplicate message) rather than appending a new copy. One artifact focus at a time; share via link. | Closest precedent for our **docked convenience view** of a genui panel — proves "chat drives an updating side-surface" without needing a full canvas. HIGH confidence (official support docs). |
| **ChatGPT Canvas** | Similar docked side panel, but the panel is a real collaborative *document/code editor* — the model can make targeted diffs or full rewrites, the user can directly hand-edit inline, and there's a menu of one-click shortcuts (adjust length, fix bugs, port language) plus back-button version history. Opens automatically when ChatGPT judges it useful, or on explicit "use canvas". | This is a genuinely different product shape than what we're building — it's rich-text/code **co-editing** with OT-like diffing, not composed interactive widgets. Table-stakes-adjacent features worth stealing: **auto-open heuristic**, **targeted-section editing**, **version/undo history**. The full collaborative-document-editor mechanism itself is an **anti-feature** for us (see below). HIGH confidence (official OpenAI docs). |
| **tldraw computer / Agent Starter Kit** | A real infinite canvas (shapes, freehand pen, groups) with a chat rail on the right. The agent reads back both a *screenshot* and *structured shape data* (dual-modality context), plus the user's current selection/viewport/recent actions, then streams create/update/delete shape operations that render incrementally as they arrive — the canvas is live and responsive mid-generation, not "wait for the full plan." | Direct precedent for **agent making canvas edits mid-stream** and for **including selection + viewport as agent context**. Confirms "streamed partial mutations to a live canvas" is an established, working pattern (not a research risk). We adopt the node/edge graph model (React Flow) rather than tldraw's freeform shape model — see Anti-Features. MEDIUM-HIGH confidence (official tldraw docs + GitHub). |
| **Thesys C1 / Crayon** | An OpenAI-compatible completion API that streams a structured "C1 DSL" (XML-like) referencing **pre-registered components by name** (schemas sent to the model as context); a `<C1Component>` renderer parses the stream and renders live React as it arrives. Interactive elements (buttons, forms, clickable chart segments) fire actions that **feed back into the conversation as a new turn**, closing the loop. This is a commercial product built on the *exact same architectural bet* as our `packages/genui` core (declarative, catalog-bounded, no eval). | Direct architectural mirror for our **dual-channel widget round-trip**: interaction → structured result → resumes the agent turn. Validates that streaming a partial declarative tree and rendering-what's-valid is production-viable, not speculative. HIGH confidence (official Thesys docs, verified in R1). |
| **v0 chat** | Code-emit, not declarative — the chat/build UI streams real TSX files into a sandboxed runtime (moved off iframe to Vercel Sandbox/Firecracker microVMs specifically because iframe couldn't run server code). Out of scope as a *pattern* for our chat/canvas widgets (we deliberately keep those declarative/catalog-bounded per the v1.3 synthesis), but its **repair-loop UX** (mid-stream "LLM Suspense" fixes, then a fast post-stream autofix pass) is a relevant pattern for keeping a streaming UI feeling reliable rather than broken-then-fixed. | Confirms (again) the R1 finding: code-emit and declarative-chat-UI are different product categories; don't blend v0's chat-UX with C1/Adaptive-Cards' widget-UX. MEDIUM confidence for the repair-loop detail (Vercel blog, already verified in R1). |
| **assistant-ui (OSS React chat UI kit)** | A JSON-spec "generative UI" primitive: agent emits a tree naming components from a consumer-supplied allowlist; interactive components (Button/Select/Input/DatePicker) carry an `$action` object, and firing it attaches the user's value as `$input` — this is the two-way channel back into the thread. Explicitly documents that free-form two-way interaction is **out of scope** for this primitive and routes to a separate "Tool UI / Interactables" mechanism instead. | Useful as a second, independent confirmation of the "component allowlist + `$action`/`$input` round trip" shape (in addition to C1 and AI SDK). Also a signal: even a mature OSS chat kit **separates** "render a widget" from "two-way interactive tool UI" as different primitives — worth mirroring that seam rather than conflating proposal cards (read-only pick) with clarify-widgets (read-write form) in one mechanism. MEDIUM confidence (official docs, one source). |
| **Vercel AI SDK "Generative UI" (tool-call → component)** | LLM calls a typed tool (Zod schema); SDK maps tool-name → a pre-built component; component renders by tool-part lifecycle state (`input-available` → loading, `output-available` → rendered, `output-error` → error UI). The LLM never authors markup. The RSC/`streamUI` variant is explicitly **deprecated** in favor of this typed `message.parts` approach. | This is the **authoritative blueprint** for our widget→agent round trip (already the headline finding of R3 — reconfirmed here). Also directly informs table-stakes chat mechanics: `useChat` ships `stop()`, `regenerate()`/`reload()` (resend last user turn), `reset()` (clear conversation/errors), and an `onError` callback — i.e., the SDK treats these as base-layer chat primitives, not advanced features. HIGH confidence (official AI SDK docs + GitHub issues cross-checked). |

---

## Table Stakes

Standard chat-product mechanics. Missing any of these makes `/chat` feel broken or unfinished — users have been trained by ChatGPT/Claude/Gemini to expect all of them.

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Message history persistence (conversation survives reload/nav) | Baseline expectation of any chat product | Low | Already have Postgres/Drizzle; new `conversation`/`message` tables per the synthesis's Phase 22 scope |
| Streamed text response with visible "typing"/generating indicator | Users need to see the agent is working, not frozen | Low-Med | Bedrock `ConverseStream` → SSE/tRPC stream is the planned transport (R3); indicator is pure UI state on stream-open |
| Stop generation | Prevents wasted tokens/time on a response the user already knows is wrong direction | Low | `useChat`-style `stop()` is a base primitive per AI SDK, not an "advanced" feature — build it in from day one |
| Regenerate / retry last response | Recovering from a bad answer without retyping the prompt | Low | Maps to AI SDK's `regenerate()`/`reload()` pattern — resend last user turn |
| Error recovery (inline, non-blocking, retryable) | Bedrock calls, tool calls, and widget round-trips can all fail transiently; a dead chat with no recourse is a hard failure | Low-Med | AI SDK's `onError` + a visible inline error bubble with a retry affordance is the standard shape; must not lose the user's in-flight message |
| Session/conversation list (sidebar, switch between chats) | Users expect multiple parallel conversations, same as ChatGPT/Claude | Low-Med | Straightforward CRUD list once `conversation` table exists; rename/delete are cheap adds |
| Markdown + code-block rendering with syntax highlighting | Agent responses routinely include code/structured text | Low | Standard library (e.g. existing markdown renderer if already in the stack) |
| Auto-scroll to latest message + "jump to bottom" affordance when user has scrolled up | Long streaming responses without this feel janky | Low | Pure frontend UX polish, no backend dependency |
| Input composer affordances (multi-line, send-on-enter, disabled/queued while streaming) | Prevents double-submits and lost input during a stream | Low | Ties into the streaming state machine already needed for stop/regenerate |
| Optimistic render of the user's own message (before server ack) | Perceived latency; users expect their message to appear instantly | Low | Standard optimistic-UI pattern |

**Complexity read:** none of table stakes are individually hard. The real cost center is that they all share one underlying **streaming state machine** (idle → streaming → tool-call-pending → error → done, plus stop/regenerate transitions) — that state machine is the actual Phase 22 engineering surface, not any single feature in this table.

---

## Differentiators

Features that set this product apart from a plain chatbot. Not expected by default, but this is where the v1.3 value proposition lives.

| Feature | Value Proposition | Complexity | Precedent / Notes |
|---|---|---|---|
| **2D infinite canvas with genui panels-as-nodes** | Turns a linear chat into a spatial workspace where prior genui outputs (forms, dashboards, entity views) persist as revisitable, arrangeable, connectable objects — not scrollback | Med-High | Precedent: tldraw computer (freeform), ChatGPT Canvas/Claude Artifacts (docked, not spatial — weaker precedent). **Depends on existing genui engine**: panels render existing Spec/Registry/Renderer output; canvas is a new "node type" wrapper around it. Reuse `@xyflow/react` (already a dependency, proven in `/knowledge`) rather than adding tldraw as a second heavy canvas dependency — per R2's leaning, still flagged for perf validation with many live/streaming panels |
| **Shared cross-panel state + data-carrying edges** | Panels aren't isolated — output of one genui panel can feed another (e.g., an entity list panel filters a detail panel) | Med-High | No direct product precedent found (emergent combination); closest analogue is dataflow/node-editor tools (n8n-style edges) applied to genui panels instead of integration steps. **Depends on existing genui engine's declared-state model** (v1.1 spec schema already has declared state/data bindings — this extends that concept across panel boundaries) |
| **Dual-channel genui: proposal cards** | Agent offers pickable next-step options as structured cards instead of prose the user has to parse and retype into a follow-up | Low-Med | Precedent: quick-reply/suggested-action patterns broadly used in chatbot UX; C1's "clickable elements that continue the conversation." Lowest-risk dual-channel feature — a proposal card is read-only until clicked, so no state-corruption risk. Build first (synthesis already recommends this ordering) |
| **Dual-channel genui: clarify-with-widgets (forms/pickers)** | Agent asks for missing structured input via an actual form widget rather than a text question the user answers in prose (which the agent then has to re-parse) | Med | Precedent: C1 forms, AI SDK tool-call→component. **Depends heavily on existing genui engine**: reuses the v1.2 zero-eval declarative form engine directly as the widget-rendering substrate — this is the single biggest reuse win in the milestone |
| **Widget→agent round-trip (tool-result resumes the streamed run)** | Makes the chat genuinely bidirectional generative UI, not "AI writes, human reads" — user manipulation of a widget becomes a structured message the agent's next turn can act on | Med-High | Precedent: AI SDK tool-call/tool-result lifecycle (authoritative blueprint), MCP Apps (SEP-1865) for the security posture (host pre-review + explicit user approval before a UI-initiated action reaches the agent). **Depends on**: chat orchestration loop (Phase 22) + widget catalog (existing genui engine) |
| **Streamed partial-tree declarative UI** | The genui panel starts rendering before the full spec has finished generating — closes GEN-04, matches the "live" feel users now expect from AI Studio-era tools | Med-High | Precedent: A2UI's flat-list-with-ID-references representation (explicitly designed for incremental/streamed generation and correction), C1's streaming DSL parse. **Depends directly on the existing Spec schema + trusted interpreter** — this requires making the v1.1 renderer tolerant of an *incomplete* valid-so-far tree (render what parses, defer/placeholder the rest), which is new engineering on top of an existing system, not a green-field build |
| **Anticipatory / proactive prompting (SPIKE)** | Agent decides *unprompted* when/what to suggest next (vs. purely reactive chat) | High, high uncertainty | **Greenfield** — no strong published product or protocol precedent found (R3 confirmed this again this pass); closest analogue is HCI "mixed-initiative interaction" literature and ad hoc Copilot-style proactive suggestions. Correctly scoped as a SPIKE with an appropriateness eval gate, not a committed feature — false-positive proactive prompting is a known trust-destroying failure mode in the broader chatbot-UX literature ("don't overwhelm, guide sparingly") |

---

## Anti-Features

Explicitly out of scope for v1.3. Building these would be scope creep against the milestone's actual goal (a conversational surface *for the existing genui engine*, not a general-purpose editor or drawing tool).

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| **Full collaborative rich-text/code document editing (ChatGPT-Canvas-style)** | This is a different product category — real-time diff/OT-style co-editing of freeform text/code is a large, separate engineering investment (conflict resolution, granular diff application, version history UI) disproportionate to this milestone's need, which is *composed interactive widgets*, not document editing | If a "let the user hand-edit an artifact" need shows up later, scope it as its own future milestone; for v1.3, panels are agent-generated/widget-driven, not directly hand-edited prose |
| **Freeform whiteboard/drawing toolkit (tldraw's pen, arbitrary shapes, ink)** | We need a structured node/edge graph (panels + data connections), not freeform ink/drawing; adding a second, heavier canvas paradigm duplicates `@xyflow/react` (already a proven dependency) for no scoped benefit | Use React Flow's node/edge model; revisit tldraw specifically if freeform annotation becomes a real requirement later (R2's existing leaning) |
| **Multiplayer / real-time collaboration (CRDT/Yjs)** | v1.3 is explicitly local/sandbox, single-user; CRDT infrastructure is a large addition with no current user story | Simple per-chat persistence (snapshot on save) is sufficient; revisit only if multiplayer becomes an actual requirement |
| **Auto-executing agent actions from proactive prompts or widgets without explicit user confirmation** | Silent/implicit execution is the single biggest trust-destroying failure mode across both the chatbot-UX literature and the MCP Apps security model (which mandates host pre-review + explicit approval for UI-initiated tool calls) | Every widget→agent round-trip and every proactive suggestion must be an explicit, visible user action (click/submit), never auto-fired |
| **Voice / multi-modal input** | Not part of the milestone's stated scope (chat text + genui widgets + canvas) | Defer; no current requirement references it |
| **Full multi-agent orchestration visualizer (run trees, agent/task nodes)** | Explicitly deferred to v1.5 per the synthesis; building it now is premature given v1.3 only has one "run" (the chat itself) | Leave the seams open per R4 (node-type registry, data-carrying edges, run/event schema stub, agent/run abstraction behind the chat loop) but do not build the visualizer itself |
| **Unbounded/no-context-management chat history** | Long-running chats will eventually blow context windows; not addressing this now creates a silent failure mode later | Not a v1.3-blocking feature, but flag as a known gap (see below) rather than silently ignoring it |

---

## Feature Dependencies

```
Chat spine (persistence + ConverseStream loop + text/partial-spec streaming)   [Phase 22]
        │  (existing genui Spec/Registry/Renderer must tolerate partial trees)
        ▼
2D canvas + panels-as-nodes + shared state + data edges                        [Phase 23]
        │  (panels render existing genui specs; canvas needs something to host)
        ▼
Dual-channel genui: proposal cards → clarify-with-widgets → round-trip         [Phase 24]
        │  (round-trip needs the chat loop's tool-call/tool-result mechanism
        │   AND the canvas/chat surface to display + host the widget)
        ▼
Anticipatory prompting (SPIKE)                                                  [Phase 25]
        (needs chat + canvas STATE to observe in order to decide when to prompt)
```

- **Table-stakes chat features** (stop/regenerate/history/error-recovery/session-list) are all sub-dependencies of Phase 22's streaming state machine — they should ship together with the chat spine, not bolted on later, because retrofitting stop/regenerate onto an already-built streaming loop is more expensive than building it in from the start (this is exactly the lesson from the AI SDK — these are base primitives, not add-ons).
- **Every differentiator in this milestone depends on the existing genui engine** (v1.1/v1.2: Catalog → Spec → Registry → Renderer, form engine, style packs). Nothing here re-derives that engine; v1.3 is entirely about giving it a conversational/spatial delivery surface.
- **Proposal cards before clarify-with-widgets** — confirmed twice now (synthesis + this pass): proposal cards are read-only-until-click (no state-corruption risk), clarify-widgets are read-write forms (more failure surface: stale UI, double-submit, resuming a paused run). Build in that order.

---

## Widget → Agent Round-Trip — Expected UX

Synthesized from AI SDK tool-call/tool-result lifecycle, Thesys C1, assistant-ui, and MCP Apps:

1. **Agent emits an interactive widget as a turn** (not free text) — e.g., a form, a set of proposal cards, a picker. The widget is rendered from the existing declarative catalog (never code-emit — dual-channel widgets stay on the zero-eval path per the v1.3 synthesis's routing decision).
2. **Widget state is local until submit/click** — matches the tool-part lifecycle model (`input-available` = widget is live/editable, not yet an event). No partial/keystroke-level round-trips to the agent.
3. **User action (click/submit) produces a structured result**, not free text — this result is what resumes the agent's run, analogous to a tool-result. The UI should visibly transition to a "sent"/pending state immediately (optimistic, matching the message-optimism table-stakes pattern) to avoid the double-submit trap called out in the synthesis.
4. **The agent's next turn can reference the structured result directly** — this is the entire point of dual-channel vs. re-parsing prose.
5. **Failure modes to design for explicitly** (called out by both the synthesis and MCP Apps): stale UI (widget rendered against state that has since changed — needs a staleness/expiry signal), double-submit (disable the widget after first submit, don't rely on the user not clicking twice), and resuming a paused run correctly if the user takes a long time to respond (the run must be safely suspended, not timed out silently).
6. **Explicit-approval posture**: per MCP Apps' security model, a UI-initiated action reaching the agent should be treated as an explicit, user-approved event — never an implicit side-effect of rendering.

## Streamed Partial UI — Expected UX

Synthesized from tldraw's incremental shape streaming, A2UI's flat-list representation, and C1's streaming DSL:

1. **Render-what's-valid, not all-or-nothing.** The spec tree should be structured (or the renderer should be tolerant) such that a syntactically-incomplete-but-partially-valid tree still renders its complete sub-parts immediately, with the still-generating portion shown as a lightweight placeholder/skeleton — not a blank panel until the full spec parses.
2. **Incremental application beats "stream then swap.**" tldraw's precedent (shapes created/updated/deleted incrementally as each streamed action completes, canvas staying responsive throughout) is the target feel — avoid a UX where the user watches a spinner and then the whole panel pops in at once.
3. **This is new engineering on the existing renderer, not a green-field feature.** The v1.1 trusted interpreter currently assumes a complete, Zod-validated spec. Streamed partial rendering requires either (a) a representation change toward something more incrementally-parseable (A2UI's flat-list-with-IDs is the documented pattern for exactly this reason), or (b) a tolerant top-down renderer that treats "not yet arrived" subtrees as a known placeholder state rather than an error. This should be scoped explicitly in Phase 22 rather than assumed to fall out of adding a streaming transport.

---

## MVP Recommendation

Prioritize (in this order, matching the dependency chain above):
1. Chat spine with the full streaming state machine (stop/regenerate/error-recovery/session-list/history built in from the start, not deferred)
2. Streamed text — ship this before attempting streamed partial-tree specs, to validate the transport independently of the harder rendering problem
3. Canvas with panels-as-nodes, reusing `@xyflow/react`
4. Proposal cards (lowest-risk dual-channel feature)

Defer within v1.3 but keep seams open:
- Streamed partial-tree spec rendering can follow streamed text once the transport is proven — don't couple the two as one atomic deliverable, since the rendering-tolerance work is separable and higher-risk
- Clarify-with-widgets after proposal cards prove the round-trip mechanism end-to-end
- Anticipatory prompting stays a SPIKE — do not commit to shipping it as a full feature inside v1.3 scope; the appropriateness-eval gate is the exit criterion, not a build deadline

Defer past v1.3 entirely (already correctly scoped as such):
- Unify-vs-hybrid design-engine lock (v1.4)
- Orchestration visualizer (v1.5)
- Remote-desktop / cross-chat context (north-star)

---

## Sources

**Fresh this pass (WebSearch/WebFetch, 2026-07-02):**
- Claude Artifacts: [support.claude.com — What are artifacts and how do I use them?](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- ChatGPT Canvas: [openai.com — Introducing canvas](https://openai.com/index/introducing-canvas/), [help.openai.com — Canvas feature](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it)
- tldraw Agent Starter Kit: [tldraw.dev/starter-kits/agent](https://tldraw.dev/starter-kits/agent), [github.com/tldraw/agent-template](https://github.com/tldraw/agent-template)
- assistant-ui generative UI: [assistant-ui.com/docs/tools/generative-ui](https://www.assistant-ui.com/docs/tools/generative-ui)
- Vercel AI SDK useChat primitives (stop/regenerate/reset/onError): official AI SDK docs + `vercel/ai` GitHub issues cross-check
- General chatbot UX table-stakes (history, error tone, quick-reply/suggested-action patterns): multiple 2026 UX-practice roundups (mindtheproduct.com, sendbird.com, fuselabcreative.com) — MEDIUM confidence, cross-referenced across sources, treated as directional not authoritative
- Thesys C1 forms/round-trip: [docs.thesys.dev](https://docs.thesys.dev/guides/what-is-thesys-c1), [github.com/thesysdev/examples](https://github.com/thesysdev/examples)

**Carried forward (already verified, prior research passes):**
- `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md` — R1 (design-generation architecture, `[FRESH✓]`), R2 (canvas, `[MODEL — pending validation]`), R3 (dual-channel/streaming, `[FRESH✓]` for AI SDK + MCP Apps), R4 (orchestration seams, `[MODEL — pending validation]`)
- `.planning/research/v1.3/R1-DESIGN-GENERATION-ARCHITECTURE.md` — full source list (v0, shadcn registry, A2UI, Adaptive Cards, Design2Code benchmark)
- MCP Apps (SEP-1865, blog.modelcontextprotocol.io, 2026-01-26) — UI-initiated tool-call security posture, `[FRESH✓]` per R3

**Not independently re-validated this pass (flagged, unchanged from synthesis):**
- React Flow vs. tldraw performance at scale with many live/streaming panels — still `[MODEL, pending validation]`
- Real production precedents for "chat + canvas coexistence" specifically at scale — no additional fresh source found beyond tldraw computer/ChatGPT Canvas/Claude Artifacts (which are docked-panel, not spatial-canvas, precedents)
