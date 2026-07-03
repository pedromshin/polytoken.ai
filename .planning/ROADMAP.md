# Roadmap: nauta.services.email-listener

## Milestones

- ✅ **v1.0 — MVP** (Phases 1–11) — inbound email → parse → extract → entities/knowledge (shipped; phase dirs retained under `.planning/phases/`, lifecycle not formally run).
- ✅ **v1.1 — Generative UI Engine** (Phases 12–15) — spec-first Catalog→Spec→Registry→Renderer→Generation→Cache→Studio. Archived: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
- ✅ **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) — SHIPPED 2026-07-03. Eval harness + style packs + catalog expansion + declarative form engine + jailed-eval code-island (multi-candidate + judge). Archived: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Audit: [milestones/v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md).
- 🚧 **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25) — IN PROGRESS. A conversational surface for the genui engine: persistent `/chat` with streamed responses, laid out on a 2D infinite canvas of genui panels, with bidirectional (agent↔user) interactive widgets. Local/sandbox only.

## Phases

**Phase Numbering:**
- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). **v1.3 starts at Phase 22.**
- Integer phases (22, 23, 24, 25): planned v1.3 milestone work.
- Decimal phases (e.g. 22.1): urgent insertions via `/gsd:phase insert`, executed between the
  surrounding integers.

<details>
<summary>✅ v1.2 — Generative UI: Realism & Interactivity (Phases 16–20) — SHIPPED 2026-07-03</summary>

- [x] Phase 16 — Studio Foundation: Eval Harness + History/Page-Ideas Tabs
- [x] Phase 17 — Tier A: Design-Token/Theme Layer + Style Packs + Assembly RAG
- [x] Phase 18 — Tier A: Catalog Expansion
- [x] Phase 19 — Tier B-1: Declarative (zero-eval) Form Engine
- [x] Phase 20 — Tier B-2: Sandboxed Code-Island (jailed-eval; SPIKE→phase; +Phase-21 multi-candidate/judge, cost guard)

Full detail: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Audit `tech_debt`, 0 gaps;
15 connected-env/browser verifications deferred (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.1 — Generative UI Engine (Phases 12–15) — SHIPPED 2026-06-27</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

</details>

### 🚧 v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel (In Progress)

**Milestone Goal:** A conversational surface for the genui engine — a persistent `/chat` with streamed
responses, laid out on a 2D infinite canvas of genui panels, where the agent and user exchange
interactive declarative widgets in both directions. Local/sandbox only — no deploy criteria.

- [ ] **Phase 22: Chat Spine + Persistence + Streaming** - Persistent, streamed `/chat` (text + progressive genui partial-tree specs) with the full table-stakes chat state machine and an application-level cost circuit breaker
- [ ] **Phase 23: 2D Canvas + Panels-as-Nodes + Shared State** - genui panels laid out as draggable/pannable nodes on a persistent, responsive infinite canvas with cross-panel shared state and data-carrying edges
- [ ] **Phase 24: Dual-Channel GenUI** - Agent↔user widget round-trips (proposal cards → clarify-widgets), safely re-validated and persisted
- [ ] **Phase 25: Anticipatory Prompting (SPIKE)** - Eval-gated, frequency-capped proactive-prompt trigger layer

## Phase Details

### Phase 22: Chat Spine + Persistence + Streaming
**Goal**: Users can have a persistent, streamed conversation with the agent — text and genui specs
render progressively, the full table-stakes chat mechanics (stop/regenerate/error-recovery/history)
work from day one, and an application-level cost circuit breaker guards every turn.
**Depends on**: Nothing (first v1.3 phase; builds on the existing v1.1/v1.2 genui engine and Bedrock transport)
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, STREAM-01, STREAM-02, STREAM-03, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):
  1. User can open `/chat`, send a message, and get a streamed agent response; conversations and messages persist across reload
  2. User can manage conversations: view a conversation list, switch between chats, rename and delete them
  3. User can stop an in-flight generation, regenerate the last response without retyping, and recover from a failed turn via an inline, retryable error that never loses the user's in-flight input
  4. The composer and message rendering behave like a real chat product — multi-line input, send-on-enter, disabled-while-streaming, optimistic render of the user's message, markdown + code-block rendering, auto-scroll with jump-to-bottom — and declarative genui specs render progressively as partial trees during generation (render-what's-valid, placeholder the rest) instead of only appearing after the full response completes
  5. Every chat turn is capped by an application-level per-turn/per-session cost circuit breaker independent of the AWS budget alert, and the underlying turn/run model is event-based behind an agent/run abstraction (one agent, one run today) so stop/regenerate/resume behave reliably and the schema is reusable by future orchestration
**Plans**: 11 plans (8 waves)
- [x] 22-01-PLAN.md — Chat data model + migration 0023 (conversations, messages/parts, runs, run_events, cost ledger; RLS deny-all; [BLOCKING] local push)
- [ ] 22-02-PLAN.md — Model provider system: ChatProvider port + curated registry + Bedrock & OpenRouter streaming adapters + /v1/chat/models + usage capture
- [ ] 22-03-PLAN.md — Markdown/code renderer (react-markdown + remark-gfm + rehype-highlight/sanitize; new dep)
- [ ] 22-04-PLAN.md — Cost ledger + circuit breaker (fail-closed pre-turn + mid-stream abort; D-22 usage-gap fix)
- [ ] 22-05-PLAN.md — Conversation CRUD (tRPC/Drizzle) + /chat rail + home + rename + hard-delete confirm
- [ ] 22-06-PLAN.md — Chat agent/run orchestration + persistence writes (SEAM-03/04; history trim; stop/cost-cap/fail/regenerate)
- [ ] 22-07-PLAN.md — FastAPI SSE stream + regenerate endpoints + emit_ui_spec genui tool (capability-gated)
- [ ] 22-08-PLAN.md — Streamed chat core: Next SSE proxy + stream hook + message list + composer + stop + auto-scroll
- [ ] 22-09-PLAN.md — Rich mechanics: regenerate siblings + inline error/cost-cap recovery + progressive partial-tree genui
- [ ] 22-10-PLAN.md — Model picker (registry-driven, honest capabilities + cost + best-for) + session cost meter
- [ ] 22-11-PLAN.md — In-browser WebLLM prototype (WebGPU, local streaming, canonical-shape persistence, $0 metered)
**UI hint**: yes

### Phase 23: 2D Canvas + Panels-as-Nodes + Shared State
**Goal**: Users can see and interact with a chat's genui outputs spatially — a persistent, responsive
2D infinite canvas where panels carry live-streaming content without lag, and panels share state and
data across each other.
**Depends on**: Phase 22 (needs the chat data model and the unmodified `SpecRenderer` it wires up)
**Requirements**: CANVAS-01, CANVAS-02, CANVAS-03, CANVAS-04, STATE-01, STATE-02
**Success Criteria** (what must be TRUE):
  1. User can view a chat's genui outputs as draggable/pannable panels-as-nodes on a 2D infinite canvas
  2. Canvas layout persists per conversation and restores exactly on reload
  3. New node types beyond genui-panel and chat can be added later via a versioned node-type registry without breaking existing canvases
  4. Canvas stays responsive (no visible lag or full-canvas re-render) while panels stream live content
  5. Panels on the same canvas read and write a shared per-chat state store, and data-carrying edges let one panel's output feed another panel's input
**Plans**: TBD
**UI hint**: yes

### Phase 24: Dual-Channel GenUI
**Goal**: The agent and user can exchange interactive widgets in both directions — proposal cards
first, then richer clarify-widgets — with every round-trip safely re-validated.
**Depends on**: Phase 22 (tool-call/tool-result mechanism), Phase 23 (surface to host/display the widgets)
**Requirements**: DCUI-01, DCUI-02, DCUI-03, DCUI-04
**Success Criteria** (what must be TRUE):
  1. Agent can emit a proposal card; clicking it sends a structured result that resumes the run
  2. Agent can emit clarify-widgets (forms/pickers from the declarative catalog + v1.2 form engine); submitting one returns a structured result to the agent and resumes the run
  3. Every widget round-trip is re-validated server-side against its declared schema, locked against double-submit, signals staleness, and requires explicit user action — it never auto-fires
  4. GenUI turns and widget interactions persist in both the conversation history and the canvas
**Plans**: TBD
**UI hint**: yes

### Phase 25: Anticipatory Prompting (SPIKE)
**Goal**: Determine, via a scoped spike, whether a trigger/heuristic layer can safely propose
proactive prompts from chat+canvas state — gated hard enough that it never becomes trust-destroying.
**Depends on**: Phase 22, Phase 23, Phase 24 (observes chat + canvas + dual-channel state)
**Requirements**: ANTIC-01, ANTIC-02
**Success Criteria** (what must be TRUE):
  1. A trigger/heuristic layer observing chat+canvas state can propose a candidate proactive prompt
  2. Every candidate prompt is filtered by an appropriateness eval AND a hard frequency cap (independent checks) before it ever reaches the user, and nothing fires without explicit user acceptance
  3. The SPIKE concludes with an explicit go/no-go recommendation on shipping anticipatory prompting as a real feature — this phase's exit criterion is a documented decision, not a shipped guarantee
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 22 → 23 → 24 → 25

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 22. Chat Spine + Persistence + Streaming | 1/11 | In Progress|  |
| 23. 2D Canvas + Panels-as-Nodes + Shared State | 0/TBD | Not started | - |
| 24. Dual-Channel GenUI | 0/TBD | Not started | - |
| 25. Anticipatory Prompting (SPIKE) | 0/TBD | Not started | - |

## Next

Ready to execute Phase 22: `/gsd:execute-phase 22`.

## Backlog

- **999.1 — GenUI history per-importer authorization** (from Phase 16 code review, CR-01): `GET /v1/genui/history` returns all importers' rows when `importer_id` is omitted. Accepted for the current single-shared-key local/sandbox posture (auth enforced via `X-API-Key`; mirrors `/v1/genui/generate`). Enforce per-importer scoping (require `importer_id` or derive from auth context) if real multi-tenancy is introduced. Source: `.planning/phases/16-.../16-REVIEW.md`.
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — v1.4 Design Engine (deferred):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). See REQUIREMENTS.md → Future Requirements.
- **999.5 — v1.5 Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
