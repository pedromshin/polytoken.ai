# Architecture Patterns — v1.3 Conversational GenUI: Chat, Canvas & Dual-Channel

**Domain:** Adding a conversational spine (chat + streaming + 2D canvas + dual-channel widgets) to an
existing FastAPI Clean-Architecture + Next.js/tRPC + Drizzle/Supabase monorepo that already ships a
declarative genui spec engine (`packages/genui`) and a jailed code-island sandbox.
**Researched:** 2026-07-02
**Scope:** Integration architecture only — how NEW v1.3 features wire into the EXISTING system. Builds
directly on `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md` (R1-R4); does not repeat ecosystem
survey, only resolves it into concrete component boundaries for this codebase.

---

## 0. Ground truth from the existing codebase (verified by reading, not assumed)

These facts materially change how v1.3 must be built and are stated up front because several of them
overturn a plausible-but-wrong default assumption:

1. **`genui.generate` is a tRPC `.query()` that fully buffers the FastAPI response** —
   `packages/api-client/src/router/genui/generate.ts` explicitly documents "GEN-04: Non-streaming —
   buffer the full FastAPI response". There is **no existing SSE/streaming plumbing anywhere in the
   stack** — v1.3 is greenfield for streaming, not an extension of something partial.
2. **The Bedrock LLM transport is the `anthropic` Python SDK's `AsyncAnthropicBedrock` client
   (`app/infrastructure/llm/anthropic_client.py`)**, authenticated via the ambient ECS task IAM role.
   Every existing adapter (segmentation, autofill, genui generator, code-island generator) calls
   `client.messages.create(...)` — **never `.stream()`**, and never the raw `boto3 bedrock-runtime`
   `converse_stream` API. The milestone doc's "Bedrock ConverseStream" is the *conceptual* mechanism
   (Anthropic's streaming Messages protocol), not a literal call to boto3's `converse_stream`. **v1.3
   should use `AsyncAnthropicBedrock.messages.stream()`** (same SDK, same auth, same client singleton
   already in the DI container) to stay idiomatically consistent — not introduce a second, parallel
   boto3-based transport.
3. **Every LLM adapter is wrapped behind a domain Protocol port** (`SegmenterProtocol`,
   `AutofillProtocol`, `EntityTypeClassifierProtocol`) with a Supabase-Client-shaped DI factory in
   `container.py`. This is the load-bearing pattern for testability (fakes in unit tests) — the new
   chat orchestration loop must follow it exactly (a new `ChatModelPort` Protocol), not call
   `AsyncAnthropicBedrock` directly from a use case.
4. **All persistence is Supabase-via-`supabase-py` in FastAPI, with Drizzle (`packages/db`) as the
   TypeScript-side schema-authority + migration generator** (per project memory: "`/supabase` = system
   config only; `packages/db` Drizzle owns schema"). New tables need a Drizzle schema file + generated
   SQL migration (TS side) **and** a new `Supabase*Repository` adapter class + domain port Protocol
   (Python side) — this is two-sided work every time, confirmed by the `ui_spec_templates` /
   `knowledge_nodes` precedent (Drizzle schema in `packages/db/src/schema/`, adapter in
   `app/infrastructure/supabase/`, port in `app/domain/ports/`).
5. **The genui spec schema (`SpecRootSchema`) is a strict, deeply-recursive Zod discriminated union**
   (19 node types, `.strict()` everywhere, `z.lazy()` recursion, bound-checked via `.refine()`). It has
   **no partial/streaming-tolerant variant today** — `SpecRenderer` takes a fully-valid `SpecRoot` only.
   Building "streamed partial-tree declarative specs" is genuinely new work, not a config flip.
6. **`@xyflow/react` (v12) + `@dagrejs/dagre` are already dependencies**, proven in production at
   `/knowledge` (`apps/web/src/app/knowledge/_components/`) with a `dynamic(ssr:false)` client-island
   wrapper pattern, custom node components, and a layout module. This is the strongest possible reuse
   signal for the 2D canvas — confirms R2's lean.
7. **tRPC is v11.8.0**, which has first-class **`httpSubscriptionLink`** (SSE via `EventSource` +
   `ReadableStream` + async generators) — `[HIGH confidence, verified this run via WebSearch against
   trpc.io docs]`. This resolves R3's "SSE or tRPC streaming" open question: tRPC v11 subscriptions
   **are** SSE under the hood, so "go through tRPC" and "use SSE" are the same answer, not a fork.
8. **Anthropic Messages API streaming emits `content_block_delta` events with `input_json_delta` /
   `partial_json` fragments for tool-use blocks**, accumulated by concatenation until
   `content_block_stop` — `[HIGH confidence, verified this run via WebSearch against
   platform.claude.com/docs]`. Since the genui spec is *always* emitted via forced tool-use
   (`emit_ui_spec`), this is the exact mechanism that will carry a streaming spec: the tool's `input`
   *is* the spec, arriving as accumulating JSON text.
9. **Vercel AI SDK's `streamObject`/`partialObjectStream` pattern — repeatedly re-parse an accumulating
   JSON-text buffer through a deep-partial schema, expose each successively-more-complete object as an
   iterable — is the validated, production-grade technique for this exact problem**
   `[MEDIUM confidence, verified this run via WebSearch]`. We cannot adopt the AI SDK itself (our LLM
   call is server-side Python, not an AI-SDK model provider in the Next.js runtime) but we should
   **replicate the technique** as a small first-party utility.
10. **`X-API-Key` auth is installation-wide** (`require_api_key` dependency, fails closed outside
    `ENVIRONMENT=development`) and **the key never leaves the server** — `getListenerConfig()` reads it
    server-side only, per `D-23`. Any new streaming path MUST preserve this: the browser must never talk
    to FastAPI directly.
11. **FastAPI responses always return HTTP 200 with an `ApiResponse` envelope** (`success`/`data`/`error`)
    even on pipeline failure — "the fallback IS the response, not an error" (D-07 pattern, repeated
    across `genui.py` and `genui_code.py`). This convention does not map cleanly onto a streaming
    endpoint (a stream can't "return 200 with a body" as one shot) — v1.3 needs an explicit new
    convention for streamed error/fallback signaling (an in-stream `error`/`done` event type), which
    should be decided once and applied everywhere (see §2).

---

## 1. Component map — new vs. modified

```
                         ┌─────────────────────────────────────────────┐
                         │  apps/web (Next.js App Router)               │
                         │                                               │
  Browser  ── SSE ──────▶│  /chat route (NEW)                           │
                         │    ├─ ChatCanvasShell (NEW, client island)   │
                         │    │    ├─ @xyflow/react canvas (REUSE dep)  │
                         │    │    │    ├─ ChatNode (NEW node type)     │
                         │    │    │    ├─ GenuiPanelNode (NEW node     │
                         │    │    │    │   type — wraps SpecRenderer,  │
                         │    │    │    │   REUSE packages/genui)       │
                         │    │    │    └─ node-type registry (NEW)     │
                         │    │    └─ StreamingSpecRenderer (NEW, in    │
                         │    │        packages/genui, extends existing │
                         │    │        SpecRenderer)                    │
                         │    └─ tRPC subscription: chat.streamTurn      │
                         │        (NEW router, httpSubscriptionLink)     │
                         │                                               │
                         │  api-client (packages/api-client)             │
                         │    ├─ router/chat/* (NEW: stream, respond,   │
                         │    │   history, canvas)                       │
                         │    └─ REUSE: getListenerConfig(), trpc.ts     │
                         └───────────────────┬───────────────────────────┘
                                              │ server-side fetch, X-API-Key
                                              │ (SSE relay — see §2)
                         ┌────────────────────▼───────────────────────────┐
                         │  apps/email-listener (FastAPI, Clean Arch)      │
                         │                                                  │
                         │  presentation/api/v1/chat.py (NEW)               │
                         │    POST /v1/chat/{id}/turn   → StreamingResponse │
                         │    POST /v1/chat/{id}/respond → StreamingResponse│
                         │    GET  /v1/chat, /v1/chat/{id}, /v1/chat/{id}/  │
                         │         canvas  (REST — REUSE ApiResponse       │
                         │         envelope pattern)                        │
                         │                                                  │
                         │  application/use_cases/run_chat_turn.py (NEW)    │
                         │    RunChatTurnUseCase.execute_stream()            │
                         │    — async generator, yields ChatStreamEvent      │
                         │    — depends on ports only (Clean Arch)           │
                         │                                                  │
                         │  domain/ports/ (NEW)                              │
                         │    chat_model_port.py   (ChatModelPort Protocol)  │
                         │    conversation_repository.py                    │
                         │    chat_message_repository.py                   │
                         │    chat_run_repository.py                        │
                         │    canvas_snapshot_repository.py                 │
                         │                                                  │
                         │  infrastructure/llm/chat_model_adapter.py (NEW)  │
                         │    wraps AsyncAnthropicBedrock.messages.stream() │
                         │    — REUSE get_anthropic_client() singleton      │
                         │                                                  │
                         │  infrastructure/supabase/*_repository.py (NEW)  │
                         │    Supabase{Conversation,ChatMessage,ChatRun,    │
                         │    CanvasSnapshot}Repository — mirrors existing  │
                         │    Supabase*Repository pattern exactly            │
                         │                                                  │
                         │  container.py (MODIFIED — new provider bindings) │
                         └──────────────────────────┬───────────────────────┘
                                                      │ supabase-py client
                         ┌────────────────────────────▼──────────────────────┐
                         │  Supabase Postgres                                 │
                         │    conversations, chat_messages, chat_runs (NEW)   │
                         │    canvas_snapshots (NEW)                          │
                         │    packages/db/src/schema/chat*.ts (NEW, Drizzle)  │
                         └─────────────────────────────────────────────────────┘
```

**New packages/modules:** `presentation/api/v1/chat.py`, `application/use_cases/run_chat_turn.py`,
4 new domain ports, `infrastructure/llm/chat_model_adapter.py`, 4 new Supabase repositories,
`packages/api-client/src/router/chat/*`, `apps/web/src/app/chat/*`, `packages/genui/src/streaming/*`
(new subpath, sibling to `sandbox/`), 4 new Drizzle schema files.

**Modified:** `container.py` (new provider bindings), `packages/db/src/schema/index.ts` (new exports),
`packages/genui/src/renderer/index.ts` (export the new streaming renderer alongside the existing one —
`SpecRenderer` itself stays untouched, used as-is for the final/complete render).

**Untouched:** `SpecRootSchema`, `SpecRenderer`, `COMPONENT_REGISTRY`, the code-island sandbox
(`packages/genui/src/sandbox/*`), the existing `/v1/genui/generate` and `/v1/genui/code-island/generate`
endpoints (they remain the non-streaming, single-shot generation paths — used for e.g. an agent
"regenerate this panel" action inside a chat turn, called as a tool, not replaced).

---

## 2. (a) Streaming path: FastAPI → web — mechanics, auth, resumability

**Verdict: tRPC subscription (`httpSubscriptionLink`, SSE) relaying a FastAPI `StreamingResponse`
SSE endpoint — not a raw Next.js Route Handler bypass, not WebSockets.**

### Why tRPC subscription over a bare Route Handler
A plain `app/api/chat/stream/route.ts` that pipes FastAPI's `ReadableStream` straight through would be
*simpler* (single-hop byte relay), and is a legitimate fallback if tRPC subscriptions prove awkward in
practice. But it breaks the one invariant this codebase has enforced everywhere else: **the web layer
never trusts FastAPI blindly and never talks to it except through `api-client`'s typed router**
(`genui.generate` re-validates with `SpecRootSchema.safeParse` at the tRPC boundary; `D-23` keeps the API
key out of any code path the browser could inspect). tRPC v11 subscriptions give us the SSE transport
*and* keep the typed-procedure boundary, at the cost of one extra hop (FastAPI SSE → Node parses/re-yields
→ tRPC SSE → browser). Recommendation: **pay the extra hop, keep the invariant** — this is a "local/
sandbox only" milestone per PROJECT.md, so the added latency of the double-relay is not a measured
concern yet; revisit only if it's empirically bad.

### Concrete shape

**FastAPI side** (`presentation/api/v1/chat.py`):
```python
@router.post("/{conversation_id}/turn")
@inject
async def stream_turn(
    conversation_id: str,
    body: SendMessageRequest,
    use_case: FromDishka[RunChatTurnUseCase],
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        async for event in use_case.execute_stream(
            conversation_id=conversation_id, user_message=body.message
        ):
            yield f"event: {event.type}\ndata: {event.to_json()}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```
Event types on the wire (a small closed enum, NOT the ApiResponse envelope — the envelope pattern
doesn't fit a multi-chunk stream): `text_delta`, `spec_delta` (raw accumulating `partial_json` string for
the active tool_use block), `spec_complete` (validated final SpecNode subtree, safe to hand straight to
`SpecRenderer`), `run_paused` (dual-channel pause — carries `tool_use_id` + the interactive spec, see §5),
`error` (replaces the "always-200-fallback" convention — a stream can't retroactively become a fallback
response, so the client must render a fallback bubble on `error`), `done`.

Still behind `require_api_key` — unchanged (X-API-Key header on the FastAPI request; StreamingResponse
doesn't affect the dependency).

**tRPC side** (`packages/api-client/src/router/chat/stream.ts`), pattern (v11 subscription):
```typescript
export const streamTurnProcedure = publicProcedure
  .input(StreamTurnInput)
  .subscription(async function* ({ input, signal }) {
    const { url, apiKey } = getListenerConfig(); // D-23: server-side only, unchanged
    const res = await fetch(`${url}/v1/chat/${input.conversationId}/turn`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.message }),
      signal,
    });
    for await (const evt of parseSSE(res.body)) {   // small first-party SSE line-parser
      yield evt;   // re-emitted as SSE to the browser by httpSubscriptionLink
    }
  });
```
Client: `api.chat.streamTurn.useSubscription({ conversationId, message }, { onData: ... })` via
`httpSubscriptionLink` in the existing `trpc/react.tsx` link chain (additive — `splitLink` routes
subscriptions to SSE, queries/mutations keep the current `httpBatchStreamLink`/whatever is configured
today; verify the exact existing link config before wiring, but this is additive, not a rewrite).

### Auth
Unchanged invariant: API key stays server-side in the tRPC procedure (Node), never reaches the browser.
Browser authenticates to the *Next.js* origin only (session/cookie or none, per current no-auth state —
`trpc.ts` context is explicitly "no-auth" today; v1.3 does not need to add auth to close this milestone,
but note it as a gap if `/chat` becomes multi-user later).

### Resumability
Two distinct resumability concerns — do not conflate them:
1. **Mid-stream network drop (browser tab backgrounded, wifi blip):** tRPC's `httpSubscriptionLink`
   auto-reconnects `EventSource` at the transport level, but the *tRPC subscription itself restarts from
   scratch* (a new `fetch` to FastAPI) — it does not resume a Bedrock stream mid-token. Given
   `messages.stream()` calls are cheap/fast (Haiku-class, few-second turns for genui-sized specs) this is
   acceptable: **on reconnect, replay is via history** — the client refetches `chat.history` (a plain
   query) for the conversation up to the last persisted message, and only issues a *new* `turn` if the
   run's last persisted state is `paused_awaiting_input` or if the user sends a new message. **Do not**
   attempt token-level resume in v1.3 — real complexity for negligible payoff at this run length.
2. **Widget→agent round-trip resume (the actual, load-bearing resumability requirement):** this is
   deliberately a *new HTTP request*, not a reconnect — see §5. This is what "resumability" in the
   milestone brief actually means, and it's solved by persistence + a `chat_runs.status` state machine,
   not by streaming-transport tricks.

---

## 3. (b) Data model — conversations / messages / runs / canvas (Drizzle + Supabase)

Follows the established two-sided pattern exactly (Drizzle schema file → generated migration → Supabase
repository adapter → domain port Protocol → DI factory in `container.py`), mirroring
`ui-spec-templates.ts` / `knowledge-nodes.ts`.

```typescript
// packages/db/src/schema/conversations.ts
export const Conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  importerId: uuid("importer_id"),              // nullable, mirrors ui_spec_templates (no FK — plain scope tag)
  title: text("title"),                          // nullable — derived from first turn, editable later
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// packages/db/src/schema/chat-runs.ts  — the R4 seam #5 "agent/run abstraction"
export const chatRunStatusEnum = pgEnum("chat_run_status", [
  "running", "paused_awaiting_input", "completed", "failed",
]);
export const ChatRuns = pgTable("chat_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => Conversations.id, { onDelete: "cascade" }),
  status: chatRunStatusEnum("status").notNull().default("running"),
  modelId: text("model_id").notNull(),
  pausedToolUseId: text("paused_tool_use_id"),   // set when status='paused_awaiting_input' (§5)
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),           // best-effort, mirrors D-19 audit pattern
});

// packages/db/src/schema/chat-messages.ts  — R4 seam #4 "turns as events on a run"
export const chatMessageRoleEnum = pgEnum("chat_message_role", ["user", "assistant", "tool"]);
export const ChatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => Conversations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => ChatRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),                 // ordering within the run — cheap run-tree reconstruction later
  role: chatMessageRoleEnum("role").notNull(),
  // Full Anthropic content-block array (text / tool_use / tool_result blocks), stored AS-IS.
  // This is deliberate: resuming a paused run requires replaying the exact block shape
  // (tool_use_id etc.) back into messages.stream() — a flattened "just the text" column
  // cannot reconstruct that.
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chatMessagesConvSeqIdx: index("idx_chat_messages_conv_seq").on(t.conversationId, t.seq),
  chatMessagesRunIdx: index("idx_chat_messages_run").on(t.runId),
}));

// packages/db/src/schema/canvas-snapshots.ts  — R4 seams #1-#3
export const CanvasSnapshots = pgTable("canvas_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => Conversations.id, { onDelete: "cascade" })
    .unique(),                                    // 1:1 latest-snapshot-per-chat for v1.3 (no versioning yet)
  // React Flow toObject() shape: { nodes, edges, viewport }. Each node carries a `type`
  // discriminator (seam #1/#2 — "genui-panel" | "chat" today, open for "agent"/"run"/
  // "remote-desktop" later without a schema change). Each edge carries a `kind`
  // discriminator ("visual" | "data") — seam #3.
  nodes: jsonb("nodes").notNull().default([]),
  edges: jsonb("edges").notNull().default([]),
  viewport: jsonb("viewport"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Design decisions and why:**
- **No separate high-frequency `chat_run_events` log table in v1.3.** The synthesis (R4 seam #4) asks
  for "chat turns as events on a run" — `chat_messages` rows already ARE that, tagged with `run_id` +
  `seq`. Adding a second, finer-grained event table (every `text_delta`?) before there's a consumer for
  it is overbuild; the seam is satisfied by the `run_id`/`seq` foreign keys, which a future v1.5
  orchestration-run-tree can group/replay without a migration. If per-token event replay is ever needed,
  it's an additive table, not a rewrite.
- **`chat_messages.content` stores the raw Anthropic content-block JSON, not a normalized/flattened
  shape.** This is the one place this milestone should resist "clean data model" instincts — the
  round-trip resume (§5) requires bit-for-bit replay of `tool_use`/`tool_result` blocks with matching
  `tool_use_id`s back into `messages.stream()`. A denormalized "role + parsed spec + plain text" model
  would lose exactly the information resume needs.
- **Canvas nodes/edges are `jsonb` blobs with a `type`/`kind` discriminator field inside, not a
  normalized `canvas_nodes` table.** Matches the existing genui philosophy (spec trees are trusted JSON
  validated by Zod at the boundary, not relational) and matches React Flow's own `toObject()` shape
  directly — no impedance mismatch on load/save. Zod-validate the discriminator on read (new
  `CanvasSnapshotSchema` in `packages/genui` or a new small `packages/canvas` — see §6).
- **`GenuiPanelNode` canvas nodes store a `templateId` reference into `ui_spec_templates` (existing
  table, unmodified) PLUS an inline `specSnapshot` copy** — provenance without coupling the canvas's
  persisted shape to the cache table's lifecycle (templates can be invalidated/pruned by
  `registry_version` per existing `CACHE-04`; the canvas must keep rendering the frozen spec it showed
  the user regardless).

**FastAPI-side ports/adapters** (new, mirroring `email_repository.py` / `SupabaseEmailRepository`):
`domain/ports/conversation_repository.py`, `chat_message_repository.py`, `chat_run_repository.py`,
`canvas_snapshot_repository.py` — each a `Protocol` with `find_by_id`/`create`/`update`/`list` methods;
`infrastructure/supabase/supabase_{conversation,chat_message,chat_run,canvas_snapshot}_repository.py` —
each wraps `supabase-py` table calls exactly like `SupabaseEmailRepository`. Register all four in
`container.py` the same way the existing five repositories are registered (`provider.provide(Supabase...,
provides=...)`).

---

## 4. (c) Where the chat orchestration loop lives

**New use case, not a new service.** `application/use_cases/run_chat_turn.py`:
`RunChatTurnUseCase` with two entry points — `execute_stream(conversation_id, user_message)` (fresh turn)
and `resume_stream(conversation_id, tool_use_id, tool_result)` (dual-channel resume, §5). Both are async
generators yielding a small `ChatStreamEvent` dataclass (mirrors `GeneratorResult`'s immutable-dataclass
style already used by `genui_generator_adapter.py`).

This is a deliberate, direct extension of the existing Clean Architecture, not a parallel system:
- Depends **only on ports** (`ConversationRepository`, `ChatMessageRepository`, `ChatRunRepository`,
  `ChatModelPort`) — zero direct `AsyncAnthropicBedrock` or `supabase-py` imports in the use case, exactly
  like `GenerateUiSpecUseCase` depends on `GenuiQuarantineAdapter`/`GenuiGeneratorAdapter` ports rather
  than the raw client.
- **`ChatModelPort`** (new domain Protocol, `domain/ports/chat_model_port.py`) is the R4 seam #5 "agent/
  run abstraction behind the chat loop" made concrete: its interface is `stream(messages, tools, system)
  -> AsyncIterator[ChatModelEvent]`. The chat use case is "an agent with one run" against this port —
  multi-agent orchestration later becomes multiple `ChatModelPort` calls composed by a higher-level use
  case, not a rewrite of this one.
- `infrastructure/llm/chat_model_adapter.py` implements `ChatModelPort` by wrapping
  `AsyncAnthropicBedrock.messages.stream()` — same `bedrock_model_id`/`get_anthropic_client()` singleton
  the rest of the app uses. Should reuse the existing repair-loop/timeout/temperature conventions from
  `genui_generator_adapter.py` where they apply (bounded `max_tokens`, `asyncio.timeout` around the
  stream context manager) but does **not** reuse the 3-attempt repair loop as-is — a chat turn that fails
  validation mid-stream should surface an `error` event to the user, not silently retry with a different
  model (repair-loop-on-invalid-tool-JSON is still appropriate *within* a single stream attempt, since
  `input_json_delta` accumulation can legitimately produce transient invalid states while incomplete).
- **Not a separate FastAPI app / microservice.** PROJECT.md scope is explicitly "local/sandbox only";
  `apps/email-listener` remains the single service. No new `apps/*` directory needed.

**DI wiring** (`container.py`, additive): register `ChatModelPort` → `_provide_chat_model_adapter`
factory (same shape as `_provide_segmenter`/`_provide_autofiller`), the four new repositories, and
`RunChatTurnUseCase` via a factory function (it needs `conversation`, `messages`, `runs`, `model` — more
than dishka's auto-inject can cleanly resolve given the Protocol/alias friction already documented
throughout `container.py`'s comments, e.g. `_provide_ingest_use_case`'s rationale applies here too).

---

## 5. (d) + (e) Streaming partial specs into `SpecRenderer`, and the widget→agent round-trip

These two are one mechanism, described together because the dual-channel round-trip's *outbound* half
(agent → user) is exactly the partial-spec-streaming problem, and its *inbound* half (user → agent) is
what makes "resume" concrete.

### (d) Partial-tree tolerant rendering — new capability, `packages/genui/src/streaming/`

`SpecRootSchema` (§0.5) is untouched — it stays the single source of truth for what a *complete* spec
is, used as today by `SpecRenderer` for the final render. The new pieces:

1. **`accumulatePartialJson(chunks: string[]): string`** — trivial concatenation of `partial_json`
   fragments as they arrive over the tRPC subscription (mirrors Anthropic's own accumulation contract,
   §0.8).
2. **`tolerantParse(text: string): unknown | undefined`** — a small, first-party "complete the open
   brackets and try `JSON.parse`" utility (bracket-depth heuristic; no `eval`, consistent with `D-24`).
   Returns `undefined` while the buffer is too malformed to parse at all (e.g. mid-string-literal); this
   is the exact `partialObjectStream`-style technique validated by the AI SDK (§0.9), reimplemented
   locally rather than pulling in the `ai` package (which assumes an in-process model call we don't have
   — our stream is relayed, not generated, in the Next.js runtime).
3. **`renderPartialTree(rawNode: unknown, ctx: RenderContext, path: string): React.ReactElement`** — a
   tolerant sibling to the existing `renderNode`, NOT a modification of it. Walks the loosely-typed
   accumulated object depth-first. At each level: if `rawNode.type` is a known catalog type and the
   node's *own* required fields (per that single leaf/container schema, checked in isolation — not the
   whole-tree `.strict()`/`.refine()` bound checks) are present, render it via the real catalog
   component, recursing into `children`/`header`/etc. with the same tolerant walk; if a child slot exists
   in the raw object but is itself incomplete, render a skeleton placeholder in that slot (reuse the
   existing `KnowledgeGraphSkeleton`-style loading-skeleton convention) keyed by `path` for stable React
   reconciliation across successive partial renders; if `rawNode.type` is missing or unknown, render
   nothing at that slot (defer). This is genuinely new, moderately intricate code — budget it as its own
   build step, not a byproduct of the streaming plumbing.
4. **`<StreamingSpecRenderer>`** (new component, `packages/genui/src/renderer/` or a new `streaming/`
   subpath) — owns the chunk buffer + `tolerantParse` + `renderPartialTree` state machine, and **swaps to
   the real `<SpecRenderer spec={finalValidatedSpec} />` on the `spec_complete` event** (full
   `SpecRootSchema.safeParse` gate, exactly like `genui.generate` does today — the trusted-interpreter
   guarantee is not weakened, only *deferred* until the tree is complete; the partial renderer is
   explicitly a best-effort preview, never the thing that gets persisted or trusted for actions).

### (e) Widget → agent round-trip = a real HTTP pause/resume, not a WebSocket hold-open

The agent emits an **interactive** genui node as a tool_use block (reuse `emit_ui_spec`'s existing
mechanism — the "interactivity" is encoded by the *spec itself* using existing node types like `form`,
`button` with `onClick: ActionSchema`, or a new dedicated `type: "proposal-cards"` node for the R3
lowest-risk case — no new wire protocol needed if the tool stays `emit_ui_spec`). The orchestration use
case does **not** try to hold the HTTP/SSE connection open while the user thinks/fills a form (seconds to
minutes) — that is fragile over serverless-style infra and inconsistent with "local/sandbox only" but
still worth building correctly since it's the seam that matters most:

1. `RunChatTurnUseCase.execute_stream` streams until the model emits an `emit_ui_spec` tool_use block
   whose spec is *interactive* (has an `onSubmit`/`onClick` `ActionSchema` bound to a reserved
   `respond-to-agent` action id, or the new `proposal-cards` type). On detecting this, the use case:
   - persists the assistant `chat_messages` row with the **exact** Anthropic content blocks including
     the `tool_use_id`,
   - sets `chat_runs.status = 'paused_awaiting_input'` and `chat_runs.paused_tool_use_id = <id>`,
   - yields a `run_paused` SSE event carrying the interactive spec (validated — this one IS a complete
     spec, since the tool_use block closed) and the `tool_use_id`,
   - **closes the stream cleanly** (no error — `run_paused` is a normal terminal state for this request).
2. The browser renders the interactive widget via ordinary `SpecRenderer` + the existing `ActionRegistry`
   seam (`SEAM-02`), wiring `respond-to-agent` to call a **new** tRPC procedure `chat.respond` (mutation
   or a fresh subscription — recommend subscription too, since the agent immediately continues streaming
   text/specs after the tool_result).
3. `chat.respond` → `POST /v1/chat/{id}/respond` → `RunChatTurnUseCase.resume_stream(conversation_id,
   tool_use_id, tool_result_content)`: loads the persisted message history for the run (in `seq` order,
   full content blocks), appends a new `user` message whose content is `[{"type": "tool_result",
   "tool_use_id": ..., "content": ...}]`, flips `chat_runs.status` back to `'running'`, and calls
   `ChatModelPort.stream(...)` again with the full reconstructed message array. This is a **brand-new
   Bedrock call**, not a resumed socket — `messages.stream()` has no server-side session concept; the
   entire message history is the state, which is exactly why `chat_messages.content` must be stored
   verbatim (§3).
4. Security posture for the reverse direction (widget-initiated "tool calls" back to the agent) follows
   the MCP Apps pattern flagged in R3 `[FRESH✓]`: the browser never sends arbitrary tool-call JSON — it
   can only trigger the specific `respond-to-agent` action bound to the *specific* `tool_use_id` the
   agent itself emitted, submitting only the structured field values the `form`/`proposal-cards` spec
   declared. There is no "the widget invents a new tool call" path — the round-trip is closed by
   construction (mirrors the existing `ActionSchema` allowlist philosophy, `SAFE-04`-style).

**Pitfalls this design must guard (flagged for phase-level attention, not solved here):** stale UI (user
responds to a widget from an old run — guard: `chat.respond` checks `chat_runs.status ===
'paused_awaiting_input'` and the submitted `tool_use_id` matches `paused_tool_use_id`, else reject with a
friendly "this request has expired" error, not a silent no-op); double-submit (disable the widget
optimistically on submit client-side; server-side idempotency via the same status check — a second
`respond` call for an already-`running`/`completed` run is rejected the same way).

---

## 6. (f) Canvas node model — wrapping genui panels while leaving R4 seams open

**Recommendation confirmed from R2: reuse `@xyflow/react`, do not add tldraw.** The existing `/knowledge`
implementation is the template to copy structurally:

- `apps/web/src/app/chat/_components/chat-canvas-island.tsx` — thin `"use client"` +
  `dynamic(..., { ssr: false })` wrapper (same reason as `knowledge-graph-island.tsx`: Next.js 15 forbids
  `ssr:false` in Server Components).
- `apps/web/src/app/chat/_components/chat-canvas.tsx` — the actual `<ReactFlow>` instance, `nodeTypes`
  registry, `edgeTypes` registry.
- **Node-type registry (seam #2)**, new module `apps/web/src/app/chat/_components/node-registry.ts`:
  a small `Record<string, React.ComponentType<NodeProps>>` map — `{ "genui-panel": GenuiPanelNode, "chat":
  ChatNode }` today. This is the *exact same shape* as `packages/genui`'s own `COMPONENT_REGISTRY`
  (type-string → component), deliberately — same pattern, different registry, one more instance of the
  "type-keyed renderer" convention already proven at `packages/ui/src/spreadsheet-grid/column-defs.ts`
  and cited as the template in the v1.1 research. New node types (agent, run, remote-desktop — R4's
  forward-looking list) are additive entries, never a rewrite of the switch/registry structure (seam #1
  "panels-as-nodes generality" is satisfied by construction, not by a specific extensibility mechanism —
  the registry pattern IS the extensibility mechanism).
- **`GenuiPanelNode`** (`apps/web/src/app/chat/_components/genui-panel-node.tsx`) — a React Flow custom
  node whose `data` payload is `{ templateId?: string; specSnapshot: SpecRoot }`; renders
  `<SpecRenderer spec={data.specSnapshot} />` (existing, unmodified) inside a `<Handle>`-bearing React
  Flow node shell. This is the literal "wraps existing genui panels" requirement — no changes needed
  inside `packages/genui`'s renderer for this to work; React Flow nodes are just React components, and
  `SpecRenderer` is just a React component.
- **`ChatNode`** — the chat thread rendered as a first-class canvas node (R2's lean: "chat is a node on
  the canvas, with a convenience docked view" — build the docked view as the v1.3 default UX and the
  on-canvas node as the seam-satisfying alternate render of the *same* `useSubscription` state, not two
  separate chat implementations).
- **Data-carrying edges (seam #3):** edge `data.kind: "visual" | "data"`. A `"data"` edge additionally
  carries `data.bindingKey: string` — when panel B's spec references `dataRef: "edge.<bindingKey>"`,
  the canvas shell resolves it from panel A's node data at render time via the existing `RenderContext.
  data` prop (`SpecRenderer`'s `data` prop is already a plain `Record<string, unknown>` injection point —
  no renderer change needed, only a canvas-level "collect edge-sourced data into the `data` prop before
  rendering each target panel" step in `chat-canvas.tsx`).
- **Shared per-chat state store:** a plain per-conversation Zustand-style (or React Context + `useReducer`,
  consistent with `useDeclaredState`'s existing style in `packages/genui/src/renderer/`) store keyed by
  `conversationId`, hydrated from `CanvasSnapshots` on load, persisted via a debounced `chat.saveCanvas`
  mutation. CRDT/Yjs explicitly deferred (R2) — no multiplayer requirement in v1.3.
- **Persistence:** `chat-canvas.tsx` calls `reactFlowInstance.toObject()` on debounce/blur → `{ nodes,
  edges, viewport }` → `chat.saveCanvas` mutation → `canvas_snapshots` upsert (§3). Load path is the
  mirror: `chat.getCanvas` query hydrates `<ReactFlow nodes={...} edges={...} defaultViewport={...}>`.

---

## 7. Suggested build order (dependency-driven, matches the synthesis's phase numbering)

Confirms the synthesis's Phase 22-25 structure is dependency-sound; adds the concrete sub-sequencing
this architecture surfaces within Phase 22 (the highest-risk, most load-bearing phase):

1. **Data model first, inside Phase 22** — the four Drizzle tables (§3) + Supabase repositories + ports
   must exist before anything else, since both the orchestration loop and the canvas persistence depend
   on them. This is pure plumbing, low risk, do it first to unblock parallel work.
2. **`ChatModelPort` + `chat_model_adapter.py` + a NON-streaming smoke test first** (call `.stream()`,
   collect all events, assert final text matches a `.create()` call) — de-risks the Bedrock streaming
   mechanics (§0.2, §0.8) in isolation before wiring the SSE relay on top. This is exactly the kind of
   "verify the [MODEL]/[FRESH] claim against the live Bedrock account" step the synthesis flags as
   pending — do it early, cheaply, before building the UI on top of an unverified assumption.
3. **`RunChatTurnUseCase.execute_stream` (happy path, no pause/resume yet) + the FastAPI SSE endpoint** —
   text-only streaming end-to-end (no spec streaming yet) proves the transport (§2) works before adding
   the harder partial-spec-rendering problem on top.
4. **tRPC `chat.streamTurn` subscription + minimal `/chat` UI rendering streamed text** — closes the
   transport loop to the browser; still no genui streaming.
5. **`StreamingSpecRenderer` + `tolerantParse`/`renderPartialTree`** (§5) — the single highest-complexity,
   most novel piece of new code in this milestone. Build and unit-test it against captured/fixture
   `partial_json` sequences (recorded from step 2's smoke test) BEFORE wiring it live — this isolates the
   hardest bug surface (malformed intermediate JSON, React key stability across re-renders) from the
   live-Bedrock-timing variable. *Closes GEN-04.*
6. **Phase 23 (canvas):** `GenuiPanelNode`/`ChatNode`/node-registry + `CanvasSnapshots` persistence — can
   start in parallel with step 5 once step 1's data model lands, since the canvas doesn't depend on
   streaming internals, only on `SpecRenderer` (unchanged) and the conversation id.
7. **Phase 24 (dual-channel):** pause/resume state machine (§5) — depends on steps 2-5 being solid (it's
   built on top of the same streaming mechanics, adding the persistence-driven pause). Proposal cards
   first (lowest risk, per R3), then `form`-based clarify.
8. **Phase 25 (anticipatory prompting SPIKE):** depends on 3-7 all existing (it observes chat+canvas
   state) — correctly sequenced last in the synthesis; no architectural changes needed to this doc's
   design to support it, since it consumes the `chat_runs`/`chat_messages` seam already built, not a new
   substrate.

**Cross-cutting, do throughout:** every new FastAPI port gets a fake for use-case unit tests (existing
convention, e.g. `tests/application/`); every new Drizzle table needs the RLS-deny-all migration pattern
already established for `ui_spec_templates` (service-role bypass, anon/authenticated denied) — this is a
security-boundary requirement, not optional, per this codebase's own established convention.

---

## Sources

- Direct repository inspection (this run): `apps/email-listener/app/infrastructure/llm/anthropic_client.py`,
  `genui_generator_adapter.py`, `container.py`, `presentation/api/v1/genui.py`, `genui_code.py`,
  `presentation/api/response.py`, `presentation/middleware/auth.py`; `packages/api-client/src/router/
  genui/generate.ts`, `trpc.ts`; `packages/db/src/schema/ui-spec-templates.ts`, `knowledge-nodes.ts`;
  `packages/genui/src/schema/spec-schema.ts`, `renderer/spec-renderer.tsx`; `apps/web/src/app/knowledge/
  _components/knowledge-graph-island.tsx`; `apps/web/package.json` (dependency versions).
- `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md` (prior synthesis — R1-R4 findings, this doc
  resolves R2/R3/R4 into concrete component boundaries).
- Anthropic streaming protocol (`input_json_delta`/`partial_json` accumulation) —
  [platform.claude.com/docs/en/build-with-claude/streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
  `[HIGH confidence, verified this run]`.
- tRPC v11 `httpSubscriptionLink` / SSE subscriptions —
  [trpc.io/docs/client/links/httpSubscriptionLink](https://trpc.io/docs/client/links/httpSubscriptionLink),
  [trpc.io/docs/server/subscriptions](https://trpc.io/docs/server/subscriptions),
  [github.com/trpc/examples-next-sse-chat](https://github.com/trpc/examples-next-sse-chat)
  `[HIGH confidence, verified this run]`.
- Vercel AI SDK `streamObject`/`partialObjectStream` technique (replicated, not adopted as a dependency) —
  [sdk.vercel.ai/examples/node/streaming-structured-data/stream-object](https://sdk.vercel.ai/examples/node/streaming-structured-data/stream-object)
  `[MEDIUM confidence, verified this run]`.
