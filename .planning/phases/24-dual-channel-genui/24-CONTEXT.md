# Phase 24: Dual-Channel GenUI - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — Areas 1–3 explicitly accepted by user; Area 4 accepted via "go full auto" directive

<domain>
## Phase Boundary

The agent and user can exchange interactive widgets in both directions — proposal cards first,
then richer clarify-widgets — with every round-trip safely re-validated. Covers DCUI-01..04:
agent emits a proposal card or clarify-widget as a turn; the user's explicit interaction returns
a structured result that resumes the run; every round-trip is server-side re-validated,
double-submit-locked, staleness-signaled; genui turns and widget interactions persist in both
the conversation history and the canvas.

Out of scope: live product-data binding into widgets (tRPC data gate stays a seam), anticipatory
prompting (Phase 25), code-emit islands as dual-channel widgets (declarative catalog only, per
R3 research).

</domain>

<decisions>
## Implementation Decisions

### Round-trip mechanics & run resumption (accepted)
- **D-01: Async-resume continuation.** The agent's turn ENDS with the widget pending (no held-open
  stream). Widget submit POSTs a structured tool-result, which starts a new streamed continuation
  turn through the existing Phase 22 SSE transport, unchanged. The pending widget + its declared
  response schema are persisted server-side so the continuation can be validated and resumed
  after any delay/reload.
- **D-02: Typing supersedes.** If the user types a text message while a widget is pending, the
  widget becomes `superseded` — visually marked, disabled, submits rejected — and the agent
  proceeds with the text. The composer is NEVER blocked by a pending widget.
- **D-03: Dedicated interactive tool(s).** New tool(s) (e.g. `emit_interactive_widget`) carry the
  widget spec AND a declared response schema for the expected structured result. Phase 22's
  `emit_ui_spec` stays untouched as the fire-and-forget display channel (its D-02 contract).
- **D-04: One pending interactive widget per turn.** A proposal-card group counts as ONE widget.
  Emitting an interactive widget ends the turn (clarify-then-continue shape).

### Proposal cards UX & semantics (accepted)
- **D-05: Structured card model.** Title + description + structured value payload, rendered by
  the existing declarative catalog (card/button primitives). The click's payload IS the declared
  structured result — no free-form per-card specs.
- **D-06: Group locks on choice.** After a card is clicked: chosen card highlighted, others
  dimmed/disabled. The chosen state persists in history so the transcript reads linearly.
- **D-07: Composer is the escape hatch.** No auto-added "None of these" card — typing supersedes
  (D-02) is the universal escape.
- **D-08: Renders in both transcript and canvas** (DCUI-04). Canvas reuses the existing
  genui-panel node; interactive state is shared via message parts, never duplicated.

### Clarify-widgets & validation posture (accepted)
- **D-09: Catalog + Phase 19 form engine only.** No new widget components this phase. The tool
  call declares the response schema (JSON Schema) the submit must satisfy.
- **D-10: FastAPI owns re-validation.** The agent-loop owner validates the submitted result
  against the STORED declared schema (not client-supplied) before resuming the run. Rejection →
  inline error on the widget; run not resumed.
- **D-11: DB-level double-submit lock.** Widget-interaction state transitions `pending →
  submitted` with a uniqueness guarantee at the database level; a second submit gets 409.
  Client-side disable is cosmetic only.
- **D-12: Turn-bound staleness.** When a newer turn exists, or regenerate switches the active
  sibling (Phase 22 D-16 versioned siblings), older pending widgets show a stale badge and the
  server rejects their submits (409).

### Persistence & data access (accepted via full-auto directive)
- **D-13: Typed message parts + run events** (FOUND-1 / Phase 22 D-18). The widget part carries
  state (`pending / submitted / superseded / stale`) + the submitted value. One shape for
  renderer and persistence.
- **D-14: No live product data in widgets this phase.** Widgets are self-contained
  (agent-provided options/values only). The allowed-tRPC-procedures data gate remains a
  documented seam for a later phase (carries over Phase 22 D-03).
- **D-15: Canvas persistence mirrors genui panels.** Spec + interaction state live in message
  parts; layout in `chat_canvas_layouts` (Phase 23 D-05: no spec content in layout rows).
- **D-16: Compact structured user-response in transcript.** A submitted interaction renders as a
  compact structured "user response" entry on the transcript (linear read), with the widget shown
  in its locked/submitted state.

### Claude's Discretion
- Exact tool naming/count (`emit_interactive_widget` vs per-kind tools) — pick what best fits the
  FastAPI tool registry from Phase 22.
- Widget-interaction storage shape (dedicated table vs message-part columns) as long as D-11's
  DB-level lock and D-01's stored response schema hold.
- Visual styling of pending/stale/submitted badges within the existing design tokens.
- How the continuation turn attributes the tool result in the model context (tool_result block
  vs synthesized user message) — follow Bedrock Converse tool-use conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 22 chat spine: `emit_ui_spec` tool-call mechanism (D-02 there: "build it as the mechanism
  Phase 24 extends"), FastAPI SSE turn transport, run-event persistence, typed message parts.
- Phase 19 declarative form engine + catalog (forms/pickers) — the entire clarify-widget
  vocabulary already renders through `SpecRenderer` (which remains UNMODIFIED — locked).
- Phase 23 canvas: genui-panel node renders any spec by provenance from message parts;
  `GenuiPartBoundary` `actions` prop (23-06) already threads an ActionRegistry into panels —
  the natural client-side hook for card-click/submit wiring.
- Phase 23 canvas store write path (`panel-action-bridge.ts`) — pattern for routing catalog
  button actions into app behavior.

### Established Patterns
- Registry pattern (FOUND-2): content-hash versioned, Zod-validated, allowlist semantics.
- Zod at every boundary; FORBIDDEN_KEYS prototype-pollution guard on user-supplied keys.
- FastAPI structlog + settings.py env config; Drizzle migrations in packages/db/migrations.
- TDD RED→GREEN commits; vitest (web/packages) + pytest (FastAPI).

### Integration Points
- FastAPI chat loop (`run_chat_turn.py`) — where tool calls are detected and turns finalize;
  the continuation-turn entry point.
- tRPC chat router (`packages/api-client/src/router/chat/`) — history/CRUD; likely home for the
  widget-submit procedure OR a FastAPI route (planner decides; D-10 requires FastAPI to do the
  validation either way).
- `apps/web/src/app/chat/_components/` (transcript rendering) + `_canvas/` (panel rendering).

</code_context>

<specifics>
## Specific Ideas

- R3 research (V1.3-RESEARCH-SYNTHESIS.md) is the blueprint: AI SDK Generative UI pattern —
  LLM emits schema-validated tool-call args; catalog components referenced by name; widget
  interaction returns as the tool result that resumes the run. MCP Apps (SEP-1865) posture:
  UI-initiated actions require explicit user approval, never auto-fire.
- Build order: proposal cards FIRST (lowest-risk round-trip), then clarify-widgets
  (forms/pickers), per ROADMAP.

</specifics>

<deferred>
## Deferred Ideas

- Live product-data binding into widgets via the allowed-tRPC-procedures gate (D-14 seam).
- LLM auto-titling of conversations (carried from Phase 22).
- Multiple concurrent pending widgets with independent continuations (D-04 chose one-per-turn).
- Code-emit islands as interactive dual-channel widgets (declarative only this milestone).

</deferred>
