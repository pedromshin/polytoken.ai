# Technology Stack — v1.3 Additions

**Project:** nauta.services.email-listener — "Conversational GenUI: Chat, Canvas & Dual-Channel"
**Researched:** 2026-07-02
**Scope:** Additions/changes only. Existing stack (FastAPI/Python 3.11, Next.js 15.3.3 App Router,
npm workspaces, tRPC 11.8.0, TanStack Query 5.62.0, Drizzle+Supabase Postgres+pgvector,
`AsyncAnthropicBedrock` transport, `@nauta/genui` declarative engine, `@xyflow/react` 12.11.0 +
`@dagrejs/dagre` 3.0.0) is validated and NOT re-litigated here.

## Headline corrections to the v1.3 research synthesis

The synthesis's milestone framing says "Bedrock `ConverseStream`" — this is the *capability*,
not the *library call*. This codebase does not use boto3's raw `bedrock-runtime.converse_stream()`
API anywhere. It already uses the **`anthropic` Python SDK's `AsyncAnthropicBedrock` client**
(`apps/email-listener/app/infrastructure/llm/anthropic_client.py`), and
`genui_code_generator_adapter.py` already proves `.messages.stream()` works end-to-end on Bedrock
(used today for inactivity-timeout robustness, buffering to `get_final_message()`). **Do not
introduce boto3/raw Converse API** — extend the proven `AsyncAnthropicBedrock.messages.stream()`
call to forward deltas live instead of buffering. `[HIGH — verified by reading the existing
codebase]`

R2 (canvas) and R3 (streaming/dual-channel) `[MODEL]` claims from the synthesis are now
validated below with primary sources; both are confirmed correct in direction, with concrete
library/version/mechanism detail added.

---

## Recommended Stack (additions)

### Chat streaming transport

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `fastapi` (bump) | `>=0.135.0` (latest `0.139.0`) | Native SSE responses | FastAPI shipped a **built-in** `fastapi.sse.EventSourceResponse` in 0.135.0 (Pydantic-serialized on the Rust side) — no need for a third-party SSE dependency. `response_class=EventSourceResponse` + `async def` generator yielding Pydantic models. `[HIGH — fastapi.tiangolo.com/tutorial/server-sent-events/, PyPI]` |
| `anthropic` (bump) | `>=0.40.0` → `>=0.60.0` recommended (latest `0.116.0`) | Bedrock streaming transport (unchanged library, newer version) | Already the transport (`AsyncAnthropicBedrock`). Bump for streaming/tool-use bugfixes accumulated since 0.40. No new dependency. |
| `@ai-sdk/react` | `^4.x` (latest `4.0.15`) | Frontend chat hook (`useChat`) | Implements the client side of the **AI SDK UI Message Stream Protocol** (SSE, `x-vercel-ai-ui-message-stream: v1` header) — a documented, backend-agnostic wire format with an explicit Python/FastAPI implementation guide. Gives message-parts state machine (`text-delta`, `tool-input-*`, `tool-output-*`, `data-*`, `finish`) for free instead of hand-rolling stream reconciliation. `[HIGH — ai-sdk.dev/docs/ai-sdk-ui/stream-protocol]` |

**Do NOT add the `ai` (Vercel AI SDK core) package.** Model calls stay server-side in Python via
`AsyncAnthropicBedrock` — only the UI-side package is needed. `ai` core's model-calling/tool-loop
machinery (`generateText`, `ToolLoopAgent`, etc., now at major `7.0.14` as of AI SDK 7,
2026-06-25) is irrelevant to a Python backend and would be dead weight.

**Transport architecture (the actual R3 answer — not tRPC subscriptions):**
1. FastAPI emits the **UI Message Stream Protocol** wire format directly from a new
   `/v1/chat/stream` SSE endpoint: `message-start` → `text-start/delta/end` parts (for prose) →
   `tool-input-start/delta/available` parts (for the streamed declarative genui spec, see below)
   → `finish` → `data: [DONE]`. Header `x-vercel-ai-ui-message-stream: v1` required.
2. A **thin Next.js Route Handler** (Node runtime, not Edge — must reach the internal FastAPI
   URL) proxies the raw SSE byte stream from FastAPI straight through to the browser response.
   No protocol translation logic — it's a passthrough `ReadableStream` pipe.
3. `@ai-sdk/react`'s `useChat` on the client points at that route.
4. **tRPC stays for structured CRUD** (conversation/message create, canvas snapshot save/load,
   chat listing) — it is NOT used for the token/spec stream. **Do not adopt tRPC v11
   `httpSubscriptionLink`/SSE subscriptions for this.** It would mean re-implementing a second
   SSE protocol on the Next.js server that itself re-proxies FastAPI's SSE stream — a redundant
   double-hop and a second wire format to maintain, when `@ai-sdk/react` already speaks a
   protocol FastAPI can emit directly. `[MEDIUM — tRPC httpSubscriptionLink docs confirm it's
   viable in isolation (trpc.io/docs/client/links/httpSubscriptionLink,
   github.com/trpc/examples-next-sse-chat), but combining it with an upstream Python SSE source
   adds a translation layer with no benefit over a direct passthrough — this is an architectural
   judgment call, not a hard blocker; revisit only if a reason to unify all traffic under tRPC
   emerges]`

**Streamed partial-tree declarative spec (closes GEN-04):**
Bedrock/Anthropic tool-use streaming already produces incremental `input_json_delta` /
`partial_json` events for forced tool-use calls (our `emit_ui_spec` tool, already built in
`genui_generator_adapter.py`). `[HIGH — platform.claude.com/docs/en/build-with-claude/streaming,
AWS Bedrock tool-use docs]` For **immediate**, ungrouped per-token deltas (rather than Anthropic's
default larger buffered chunks), add the beta header `anthropic-beta:
fine-grained-tool-streaming-2025-05-14` to the `.messages.stream()` call — AWS's own Bedrock
tool-use documentation confirms this header works through Bedrock, not just the direct API.
`[HIGH — docs.aws.amazon.com/bedrock/.../model-parameters-anthropic-claude-messages-tool-use.html]`
Caveat: with fine-grained streaming, chunks are **not guaranteed to be valid JSON at any
boundary** — buffer the raw `partial_json` string and only attempt a parse per chunk, never
assume boundary alignment.

Bridge: FastAPI translates each Anthropic `input_json_delta` event into an AI SDK
`tool-input-delta` protocol part (`inputTextDelta`) for the `emitGenuiWidget`/`emitUiSpec` tool
call. On the frontend, run a **best-effort partial-JSON parser** against the accumulated string
each time (AI SDK's own `@ai-sdk/ui-utils` `parsePartialJson` is the reference implementation for
this exact problem — reuse it or port its approach) and feed whatever currently parses into the
existing zero-eval `SpecRenderer` (`packages/genui/renderer`), which already tolerates rendering
a partial/incomplete tree by construction (unknown/absent fields simply don't render yet). No new
renderer logic needed — only a partial-JSON-tolerant feed into the existing one.
`[MEDIUM — parsePartialJson existence/purpose confirmed via ai-sdk.dev docs + GitHub, exact
current export path should be re-checked against the pinned @ai-sdk/react version at
implementation time since AI SDK has reorganized utility packages across majors]`

### 2D infinite canvas

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@xyflow/react` | `^12.11.1` (already `^12.11.0`) | Panel-graph canvas | **Confirmed: reuse, do not add tldraw.** MIT license, already integrated (`/knowledge`), node/edge graph model is structurally correct for "panels-as-nodes + data-carrying edges" and composes with the later orchestrator/subagent graph (R4 seam). |
| `zustand` | `^5.0.14` | Node-content re-render isolation + per-chat shared state | See below — two distinct uses. |

**tldraw explicitly rejected, with a concrete reason (upgrades the synthesis's "watch license"
flag to a decision):** tldraw SDK v5.x requires a commercial or hobby license for **any
production deployment**; the hobby license mandates a visible "made with tldraw" watermark on
canvas, and commercial licensing is a sales-led paid engagement (a 100-day trial exists but is
not a durable answer). `[HIGH — tldraw.dev/community/license, tldraw.dev/legal/tldraw-license]`
Combined with React Flow already being integrated, MIT-licensed, and structurally sufficient for
node/edge panels (not freeform drawing, which is the one thing tldraw would add), there is no
case for a second heavy canvas dependency in this milestone.

**Performance at scale with live-updating React panels (the R2 gap the synthesis flagged):**
React Flow's own performance guide is unambiguous on the failure mode and the fix.
`[HIGH — reactflow.dev/learn/advanced-use/performance,
reactflow.dev/learn/advanced-use/state-management]`
- **Do not** hold volatile node/edge state in `useState`/`useReducer`/Context at the page level —
  every update re-renders the whole tree. Move it into a **Zustand store** (React Flow's own
  internals already are Zustand) and subscribe components via selectors.
- **Memoize every custom node component** with `React.memo`; declare `nodeTypes`/`edgeTypes`
  objects **outside** the render function or via `useMemo` — an inline object literal recreated
  each render forces React Flow to treat every node as a new type and remounts the entire canvas.
  This is the single most-cited React Flow performance footgun.
- For panel content that updates live (a genui panel receiving streamed spec deltas), keep the
  **stream-driven state in its own Zustand slice keyed by node id**, and have the custom node
  component subscribe only to its own slice with `useShallow` — this isolates re-renders to the
  one streaming panel, not the whole graph, which is the concrete mechanism for "many live/
  streaming React panels" the synthesis asked to validate.
- Decouple **selection state** into its own store field so panel content updates don't trigger
  selection-driven re-renders and vice versa.

**Serialization/persistence:** use `useReactFlow().toObject()` (nodes + edges + viewport) as the
canvas snapshot; persist as a `jsonb` column on the chat/canvas row via Drizzle (mirrors the
existing `ui-spec-templates` / `genui-generation-events` schema conventions in `packages/db`).
Rehydrate via `defaultNodes`/`defaultEdges` or `setNodes`/`setEdges` from the persisted snapshot
on chat load.

### Per-chat shared state

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `zustand` | `^5.0.14` | Per-chat cross-panel store | MIT, requires React ≥18 as of v5 (this app is React 18.3.1 — compatible). `[HIGH — github.com/pmndrs/zustand releases, npm registry]` |

Create one **vanilla Zustand store instance per chat** (via `createStore`, not the global
singleton pattern) scoped by a React context provider at the `/chat/[id]` route boundary. This
directly satisfies "per-chat shared state" without cross-chat bleed, and composes with the canvas
node-slice pattern above (same store, different slices: canvas node content + cross-panel shared
values like "selected entity ID both a list panel and the canvas need").

This is not a new architectural decision — `.planning/research/SPEC-RENDERER.md` (Phase 15-era)
already reserved Zustand for exactly this case ("out-of-spec state that must be shared across
multiple SpecRenderer instances") while keeping `useReducer`/Jotai `atomFamily` for a single
spec's own declared state. v1.3 is the first milestone that actually needs the cross-panel case —
confirming, not revising, prior research.

**Do not add Yjs/CRDT.** No multiplayer or offline-robustness requirement exists yet (single
user, single tab per chat per the milestone scope). Revisit only if multiplayer becomes a
requirement — CRDT is a heavyweight answer to a problem this milestone doesn't have.

### Dual-channel widget round-trip

No new runtime library beyond `@ai-sdk/react` (already listed above for streaming). The pattern:

- FastAPI emits a genui proposal/clarify widget as a **tool-call part** in the UI Message Stream
  Protocol (e.g. `tool-emitGenuiWidget`), with `input` = a validated SpecRoot (the existing
  `@nauta/genui` schema — no new schema needed).
- The frontend maps `part.type === 'tool-emitGenuiWidget'` to the **existing**
  `<SpecRenderer spec={part.input} />` (built in Phase 12-15, zero-eval, no code execution) by
  `part.state`: `input-available` → loading, `output-available` → rendered widget. Reuse, don't
  rebuild.
- User interaction with the widget (a click, a form submit) produces a structured value that is
  submitted back through `@ai-sdk/react`'s tool-result submission API, included in the next
  message FastAPI receives, and fed back into the Bedrock `messages` array as a `tool_result`
  content block — the same message-array-splicing pattern already implemented in
  `genui_generator_adapter.py._repair_loop` (currently used for validation-error repair; extend
  it to real user-submitted tool results).
- This confirms and upgrades the synthesis's R3 `[MODEL]` "AI SDK Generative UI pattern
  applicability given our Python backend" question to **confirmed applicable**: AI SDK 3.4+
  explicitly documents implementing the Data/UI Message Stream Protocol in non-JS backends, with
  Python/FastAPI as a named example, and a third-party `fastapi-ai-sdk` PyPI package already
  exists implementing this exact bridge (evaluate as a reference/starting point, not necessarily
  a direct dependency — the protocol is simple enough to hand-implement given the existing SSE
  infrastructure this milestone is already building).
  `[HIGH for protocol backend-agnosticism (ai-sdk.dev/docs/ai-sdk-ui/stream-protocol, explicit
  Python example); MEDIUM for the exact current `@ai-sdk/react` API method name for client-side
  tool-result submission — verify against the pinned version at Phase 24 implementation time,
  AI SDK has renamed this across majors]`

**Do NOT adopt MCP Apps / `mcp-ui`** (the sandboxed-iframe widget protocol, SEP-1865) for this
milestone. That is the code-emit/sandboxed lane the v1.3 synthesis explicitly deferred to v1.4 —
our dual-channel widgets are declarative-catalog by design (reliable, no eval, safe round-trip),
which is the R1/R3-validated correct choice for this use case.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Chat streaming transport | FastAPI SSE + `@ai-sdk/react` (direct passthrough) | tRPC v11 `httpSubscriptionLink` subscriptions | Would add a second SSE protocol translation hop (FastAPI SSE → Next.js tRPC-subscription SSE) with no benefit; `@ai-sdk/react` already speaks a protocol FastAPI can emit natively |
| Chat streaming transport | Extend `AsyncAnthropicBedrock.messages.stream()` | boto3 `bedrock-runtime.converse_stream()` | Not used anywhere in this codebase; would mean re-solving tool schema/quarantine wiring already proven with the Anthropic SDK |
| 2D canvas | `@xyflow/react` (reuse) | tldraw | Requires commercial/hobby license + watermark for production; second heavy canvas dep; freeform-drawing strength isn't a current requirement |
| Cross-panel state | Zustand (per-chat vanilla store) | React Context, Redux | Context causes broad re-renders at scale (React Flow's own perf guide warns against it); Redux is unnecessary ceremony for this scope; Zustand was already the reserved answer in prior research |
| Cross-panel state | Zustand | Yjs/CRDT | No multiplayer/offline requirement in scope |
| SSE server library | Native `fastapi.sse.EventSourceResponse` (FastAPI ≥0.135.0) | `sse-starlette` | FastAPI now ships this natively (Rust-side Pydantic serialization); avoids adding a third-party dependency. Use `sse-starlette` only if there's a reason not to bump FastAPI's minor version |
| Dual-channel widgets | Declarative catalog via existing `SpecRenderer` | MCP Apps / `mcp-ui` sandboxed iframe | Code-emit/sandboxed lane explicitly deferred to v1.4; declarative is the correct reliability profile for chat's own interactive widgets per R1/R3 |

## Installation

```bash
# apps/web — chat streaming client
npm install @ai-sdk/react -w @nauta/web

# apps/web — cross-panel/per-chat shared state
npm install zustand -w @nauta/web

# @xyflow/react and @dagrejs/dagre already present — no change

# apps/email-listener (Python) — bump existing deps, no new packages required
# pyproject.toml: fastapi>=0.135.0 (was >=0.115.0), anthropic>=0.60.0 (was >=0.40.0)
uv sync
```

No new Python packages are required — `fastapi.sse.EventSourceResponse` ships inside FastAPI
itself once bumped past 0.135.0, and Bedrock streaming continues through the already-present
`anthropic` package.

## Sources

- FastAPI SSE: https://fastapi.tiangolo.com/tutorial/server-sent-events/ · PyPI `fastapi` 0.139.0
- Anthropic streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- Bedrock tool-use + fine-grained streaming: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html
- AI SDK UI Message Stream Protocol (backend-agnostic, Python example): https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- AI SDK Generative UI pattern: https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- AI SDK 7 release: https://vercel.com/changelog/ai-sdk-7 · npm `ai` 7.0.14, `@ai-sdk/react` 4.0.15
- `fastapi-ai-sdk` (Python protocol bridge reference): https://pypi.org/project/fastapi-ai-sdk/
- tRPC v11 SSE subscriptions (considered, not adopted for chat stream): https://trpc.io/docs/client/links/httpSubscriptionLink · https://github.com/trpc/examples-next-sse-chat
- React Flow performance: https://reactflow.dev/learn/advanced-use/performance · https://reactflow.dev/learn/advanced-use/state-management
- tldraw licensing: https://tldraw.dev/community/license · https://tldraw.dev/legal/tldraw-license
- Zustand: https://github.com/pmndrs/zustand (releases) · npm `zustand` 5.0.14
- Existing codebase (primary, read directly): `apps/email-listener/app/infrastructure/llm/anthropic_client.py`, `genui_generator_adapter.py`, `genui_code_generator_adapter.py`; `apps/web/package.json`; `packages/api-client/src/router/genui/generate.ts`; `.planning/research/SPEC-RENDERER.md`
