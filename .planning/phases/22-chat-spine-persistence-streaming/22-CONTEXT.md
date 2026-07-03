# Phase 22: Chat Spine + Persistence + Streaming - Context

**Gathered:** 2026-07-03 (interactive for 3 areas; remainder auto-resolved after user switched to `/gsd:autonomous` — auto-picks marked `[auto]`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can have a persistent, streamed conversation with the agent — text and genui specs render
progressively, the full table-stakes chat mechanics (stop/regenerate/error-recovery/history) work
from day one, and an application-level cost circuit breaker guards every turn. The turn/run model
is event-based behind an agent/run abstraction (SEAM-03/04).

**Scope expansion decided in discussion (user, explicit):** the chat spine ships with a
**multi-provider model system** in Phase 22 — a curated per-conversation model picker (Anthropic
via Bedrock + best-in-class non-Anthropic via OpenRouter) **including a minimal in-browser
WebLLM/WebGPU prototype**, with schema-level seams for a future sovereign/distributed-inference
play. Canvas (23), dual-channel widgets (24), proactive prompting (25) remain out.

Requirements: CHAT-01..07, STREAM-01..03, SEAM-03, SEAM-04.
</domain>

<decisions>
## Implementation Decisions

### Agent identity & genui emission
- **D-01:** Agent persona = **minimal neutral assistant** (plain helpful assistant, no product
  identity yet; persona question deferred to Phase 24 era).
- **D-02:** GenUI specs are emitted via an **agent-decided tool call** (`emit_ui_spec` tool — the
  AI SDK generative-UI pattern from R3). This *is* the tool-call/tool-result mechanism Phase 24's
  round-trips extend; build it as such.
- **D-03:** **No Nauta product data access in Phase 22** (no entity/email/knowledge tools). Data
  reaches widgets later via the existing allowed-tRPC-procedures gate (Phase 24 scope).

### Multi-provider model system (user-driven expansion)
- **D-04:** **Full menu ships in 22**: per-conversation model picker over a **curated
  "best-in-class only" registry** (Anthropic Sonnet/Haiku + e.g. DeepSeek, Qwen, GLM 5.x, Gemma —
  exact list curated at plan time and kept up to date).
- **D-05:** Registry entries follow the FOUND-2 registry contract and carry: model id, provider/
  transport, **execution locus (`server | browser`, `remote-peer` reserved)**, pricing (per-Mtok
  in/out), and **capability flags** (tools/genui reliability, streaming, context size). GenUI tool
  is only offered to models flagged reliable for it; the picker surfaces capabilities honestly.
- **D-06:** Picker UX must include **guidance for choosing**: rough cost estimate and "what this
  model is best at" per entry (user: "easy way to estimate which they should choose, how much
  cost and for what which is best").
- **D-07:** Transports: **Bedrock Anthropic (existing IAM, no key) + OpenRouter (single
  `OPENROUTER_API_KEY`)**. The provider port must be designed so a **self-hosted /
  run-it-yourself endpoint adapter** (OpenAI-compatible base URL) can be added later without
  rework. No direct per-provider API adapters in 22.
- **D-08:** **In-browser prototype (minimal, honest):** one small model (e.g. Qwen3 4B or
  Gemma 3 4B via WebLLM/WebGPU) as a real picker entry — text-only chat, streams locally,
  persists messages + run events through the same API as server models, **no genui tool**.
  Architecture stays open for richer browser execution later.
- **D-09:** **Sovereign/distributed-inference future = schema-level seams only** in 22:
  execution-locus field, per-model usage metering in the ledger (credits-ready), one provider
  port. No credits, no GPU pooling, no desktop-app concepts in this phase (see Deferred).
- **D-10:** Default model for a new conversation = **remember last used**.

### Conversation management UX
- **D-11:** Conversation list = **own collapsible rail inside `/chat`** (list, new-chat, rename,
  delete). The app sidebar gets a single Chat nav item.
- **D-12:** Titles = **first-user-message snippet** (truncated, deterministic, no LLM call) +
  inline manual rename (CHAT-02). LLM auto-titling noted as a possible later enhancement.
- **D-13:** Opening `/chat` shows a **conversation home screen** (list + prominent new-chat);
  a conversation opens from there. Home-screen composition details = Claude's discretion.
- **D-14:** Delete = **hard delete with confirm dialog**. Ledger/usage audit rows survive
  deletion as aggregate accounting data (they carry no conversation content).

### Streaming & turn mechanics
- **D-15:** **Stop keeps the partial response** in the thread as an assistant message marked
  "stopped by user" (recorded as a run event). No silent disappearance.
- **D-16:** **Regenerate = versioned siblings with `< 1/2 >` navigation** (user chose the
  branching model over replace). Message schema must support sibling response versions per turn;
  only the **active** version feeds subsequent context. This interacts with FOUND-1 typed parts —
  plan the tree model deliberately.
- **D-17:** Progressive genui (STREAM-02) = **render valid subtrees live + skeleton placeholders**
  for still-arriving children (partial-JSON parse against the existing schema; `@nauta/ui`
  skeleton exists). If the final spec fails validation, existing fallback path applies.
- **D-18:** A turn's content = **freely interleaved typed parts** (text → spec → text → …) exactly
  as emitted — FOUND-1's canonical typed-parts model. Renderer and persistence read one shape.
- **D-19:** Failed turn = inline retryable error on the assistant turn; the user's in-flight
  composer input is never lost (CHAT-05, restated as locked).

### Cost circuit breaker `[auto]`
- **D-20:** `[auto]` Ledger caps per FOUND-3: **per-turn / per-session / per-day**, env-configurable
  (settings.py pattern), starting defaults **$0.50 / $2.00 / $5.00** — planner may tune.
- **D-21:** `[auto]` **Fail-closed**: pre-turn estimate gate blocks the turn with an inline error
  when a cap would be exceeded; **mid-stream abort at the per-turn cap** keeps the partial and
  marks it "cost-capped" (consistent with D-15). Raising caps = config change, not a UI override.
- **D-22:** `[auto]` **Real usage capture on every adapter** — fixes the known gap where only
  quarantine tokens are recorded (Call B / judge tokens currently dropped). Bedrock + OpenRouter
  report usage; browser models meter tokens at $0 cost but still record usage events.
- **D-23:** `[auto]` Visibility: **subtle session cost meter** in the chat surface + per-turn cost
  detail on inspection. Ledger queryable per conversation/day.

### Architecture & plumbing `[auto]`
- **D-24:** `[auto]` Streaming transport: **FastAPI SSE (`StreamingResponse`/`text/event-stream`)
  → Next.js route-handler proxy that injects `X-API-Key` server-side → browser consumes the
  stream**. tRPC keeps conversation CRUD (list/rename/delete/history). Researcher validates the
  exact mechanism (tRPC v11 httpSubscriptionLink considered but not required).
- **D-25:** `[auto]` Reload/disconnect mid-stream: server aborts on client disconnect; turn is
  marked interrupted (retryable, partial kept). **No resumable/re-attach streams in 22** — seam
  documented for later.
- **D-26:** `[auto]` History context: token-budget trim, recent-first, sized by the active model's
  registry context-size flag. Unbounded-context management explicitly out of scope (REQUIREMENTS).
- **D-27:** `[auto]` Run/event model (SEAM-03/04): **minimal-but-real** — `runs` + append-only
  `run_events` tables (migration 0023+), one agent/one run per turn today, typed events
  (started/delta-checkpoint/tool-call/usage/stopped/failed/completed — exact taxonomy at plan
  time), provenance IDs per FOUND-5. `GenerationEvent` audit stays; chat runs are the new shape.
- **D-28:** `[auto]` Markdown + code-block rendering (CHAT-07): new dependency required (none in
  repo) — researcher picks (react-markdown/remark-gfm + shiki class); output sanitized per
  project guardrails.

### Claude's Discretion
- Home-screen composition (empty state, suggestion affordances)
- Exact event taxonomy + runs/run_events column detail; sibling-version tree representation
- Partial-JSON incremental parse approach for D-17
- WebLLM model choice + loading UX for the browser prototype
- Markdown/code renderer library choice (research-driven)
- Exact cap defaults tuning and estimate heuristic (D-20/D-21)
- Composer details beyond CHAT-06 requirements (drafts, shortcuts)
</decisions>

<specifics>
## Specific Ideas

- **Sovereign/distributed inference north star (user, verbatim intent):** users pool GPU
  resources for a group; contributors earn credit for lending hardware, can cash out or spend on
  AI usage; a desktop-native app gets at hardware directly. "Very difficult to plan architecture
  for at this point… I just want to be able to eventually if I even want to move that way.
  Options should be open." → Phase 22 encodes this ONLY as D-09's seams.
- **"Best options only"** — the model menu is curated and maintained, not an everything-list.
- Model choice should feel effortless: pick + see cost estimate + "best for X" hints (D-06).
- Chat mechanics should feel like a real chat product (ChatGPT-grade table stakes) — the roadmap's
  success criteria enumerate these; regenerate explicitly uses the `< 1/2 >` sibling pattern.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & foundation decisions
- `.planning/ROADMAP.md` §"Phase 22: Chat Spine + Persistence + Streaming" — goal, success criteria
- `.planning/REQUIREMENTS.md` §Chat Spine / §Streaming / §Seams — CHAT-01..07, STREAM-01..03, SEAM-03/04
- `.planning/PROJECT.md` §Key Decisions — **FOUND-1..7** (typed message parts, registry contract,
  cost ledger, shared-state, provenance, untrusted-input boundary, eval dimensions) + style_pack_id
  threading + procedure-allowlist convergence rule — all binding on this phase

### Research base
- `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md` — R3 (streaming transport, partial-tree
  rendering, AI SDK generative-UI tool-call pattern), R4 seams 4–5 (run/event schema, agent/run
  abstraction); R2/R4 flagged pending fresh-web-validation
- `.planning/research/v1.3/R1-DESIGN-GENERATION-ARCHITECTURE.md` — background only (design-engine
  fork is v1.4, not this phase)
</canonical_refs>

<code_context>
## Existing Code Insights (scouted 2026-07-03)

### Reusable Assets
- **Streaming idiom (server):** `apps/email-listener/app/infrastructure/llm/genui_code_generator_adapter.py`
  — `messages.stream(...)` + `asyncio.timeout` with per-event `reschedule` (inactivity timeout);
  the ready-made pattern to turn into an SSE generator (yield deltas instead of buffering).
- **Bedrock client:** `app/infrastructure/llm/anthropic_client.py` (`AsyncAnthropicBedrock`,
  IAM, `@lru_cache` singleton). Model/timeout/token settings all in `app/settings.py`.
- **Event shape template:** `app/domain/ports/generation_audit_repository.py` (`GenerationEvent`
  frozen dataclass + best-effort Supabase repo) — template for the new run/event port.
- **UI primitives:** `@nauta/ui` has textarea, scroll-area, skeleton, avatar, resizable, dialog,
  dropdown-menu, command (cmdk), sonner. **No markdown/code renderer exists anywhere** (D-28).
- **Renderer:** `packages/genui/src/renderer/spec-renderer.tsx` (expects pre-validated spec;
  validation at web tRPC boundary via `SpecRootSchema.safeParse` → SAFE_FALLBACK_SPEC).
- **Registry pattern to instantiate (FOUND-2):** `packages/genui/src/registry/registry-version.ts`
  (content-hash version) — model-provider registry mirrors this.

### Established Patterns
- Clean Architecture (domain/application/infrastructure/presentation) + Dishka DI factories in
  `app/container.py`; `ApiResponse[T]` envelope; `X-API-Key` via `require_api_key` router dep.
- Two-hop key posture: browser → tRPC `publicProcedure` (packages/api-client, server-side fetch
  with `EMAIL_LISTENER_API_KEY` from `_listener-config.ts`) → FastAPI. SSE must preserve this
  (D-24 proxy injects the key server-side; never `NEXT_PUBLIC_`).
- Two DB stacks: Drizzle owns schema+migrations (`packages/db`, latest = `0022`; new tables =
  `0023+`, RLS deny-all, IF NOT EXISTS guards); Python reads/writes via supabase-py with
  `asyncio.to_thread`.
- Studio manual-trigger pattern (`enabled:false` + refetch) in
  `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` — chat replaces this
  interaction model with streaming.

### Integration Points
- **No SSE/StreamingResponse anywhere yet** (FastAPI or web) — chat SSE is the repo's first
  HTTP-streaming surface, both sides new.
- New `/chat` route in `apps/web/src/app/` + nav item in `src/components/app-sidebar.tsx`.
- New FastAPI router under `app/presentation/api/v1/` (mirror genui.py registration in `main.py`).
- Known gap to fix for D-22: only quarantine tokens are captured today
  (`genui_quarantine_adapter.py` reads `.usage`; generator/judge adapters do not).
- Phase 23 consumes the chat data model + unmodified SpecRenderer; Phase 24 extends the
  tool-call/tool-result loop (D-02) — keep both boundaries clean.
</code_context>

<deferred>
## Deferred Ideas

- **Sovereign/distributed inference play** — GPU pooling across users, credit earn/spend/cash-out
  economy, desktop-native app for direct hardware access, remote-peer execution locus. North-star;
  Phase 22 ships only D-09's schema seams. Revisit as its own milestone when/if wanted.
- **Self-hosted inference endpoint adapter** (run-it-yourself, OpenAI-compatible base URL —
  Ollama/vLLM class) — provider port must admit it (D-07); not shipped in 22.
- **LLM auto-titling** of conversations (user chose snippet titles for now).
- **Resumable streams / re-attach after reload** + "Continue generating" affordance (D-25 seam).
- **Nauta data tools for the agent** — Phase 24 via the procedure allowlist (D-03).
- **Richer browser-model functionality** (genui from in-browser models, bigger models) — after the
  minimal prototype proves the locus.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 22-chat-spine-persistence-streaming*
*Context gathered: 2026-07-03*
