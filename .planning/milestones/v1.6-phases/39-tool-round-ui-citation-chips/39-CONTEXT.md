# Phase 39: Tool-Round UI + Citation Chips - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning (planner MUST read Phases 34/36/37 SUMMARYs — the deltas/parts/envelopes this UI renders are theirs; a UI-SPEC should be generated via ui-phase before planning)
**Mode:** Smart discuss, autonomous (source: SYNTHESIS.md critic gap (c) + Fork 1↔5 ProvenanceLink conflict resolution)

<domain>
## Phase Boundary

`/chat` visibly surfaces in-progress tool rounds ("searching knowledge…") via NEW SSE tool-round
deltas, renders the Phase-34 `tool_invocation`/`tool_invocation_result` message parts in the
transcript, and renders citation chips through ONE shared `<ProvenanceLink kind id />` primitive —
the same primitive Phase 41's preview node will consume (decided once, used twice). Requirements:
TUI-01, TUI-02. Spans Python (SSE delta emission — small) + web (rendering — the bulk). No
migrations. This closes the "web transcript tolerance for new part types" item Phase 34 deferred.

</domain>

<decisions>
## Implementation Decisions

### SSE deltas (TUI-01, Python side — minimal)
- Emit new SSE frame types from the existing FastAPI stream when a tool round starts/ends (backed by the run-events Phase 34 already persists; the SSE layer mirrors them as deltas). Names/shapes follow the existing typed-delta conventions in the SSE endpoint + `useChatStream` frame folding. Additive only — no changes to existing frame semantics; older clients ignoring unknown frames must keep working.

### Transcript surface (TUI-01, web)
- While a round runs: a compact inline activity row inside the assistant turn — existing `GeneratingRing`/streaming affordance style, token-only, text like "Searching knowledge…" derived from the tool name (map tool → human label; unknown tool → generic "Running a lookup…"). Never a modal/toast.
- Completed rounds: `tool_invocation_result` parts render as a collapsed, quiet single-line entry (tool label + result count + citation chips), expandable is NOT required this phase — keep it minimal; full result JSON stays out of the transcript (debug affordances belong to studio).
- Failed/errored rounds render the visible text part Phase 34 already emits — no special UI beyond normal text.
- `useChatStream` state machine gains the round states additively; no regressions to idle→streaming→terminal flow (existing tests must stay green).

### `<ProvenanceLink>` (TUI-02)
- ONE shared primitive at `apps/web/src/components/provenance-link.tsx` (app-level, not packages/ui — routes are app-specific): props `kind: "email"|"entity"|"knowledge"`, `id`, optional label; renders a small chip (token-styled: muted bg, hover accent, focus ring; 2-weight typography; teal only via existing tokens) linking `/emails/[id]`, `/entities/[id]`, `/knowledge?focus={id}` via Next `<Link>`.
- Citation chips render from `citations[]` INSIDE the `tool_invocation_result` part content (the critic's ownership resolution) — chips attach to that part's row, not to the following assistant text.
- Phase 41 imports this primitive — export it cleanly; no chat-specific coupling inside it.

### Design constraints
- nauta-design-system SKILL.md constraints are hard: Tailwind v3.4/React 18/Radix, existing tokens only, zero new npm deps, one-scrollbar aesthetic, reduced-motion-gated animation. frontend-design plugin skill is the aesthetic floor. Verify visually via the playwright-core loop if feasible; otherwise mark visual check human_needed (v1.4/v1.5 precedent).
- Locked files stay locked: `spec-renderer.tsx`, `render-node.tsx`, `genui-part-boundary.tsx` byte-identical. New part types render via NEW components in the message-turn part switch — not by modifying the genui boundary.

### Claude's Discretion
- Exact SSE frame names/payloads; tool→label map location; chip truncation/overflow behavior (cap visible chips ~5 with "+N"); whether the activity row shows round count (e.g. "2nd lookup…") — keep subtle.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useChatStream` hook + SSE proxy (Phase 23); `message-turn.tsx` part-type switch (where new part renderers mount); `GeneratingRing` primitive (v1.4); `compact-interaction-entry.tsx` (the quiet-single-line precedent for widget results — mirror its tone for tool results); run-events from Phase 34.
- Phase 36/37 envelopes define `citations[]` `{kind,id,route}` — read their SUMMARYs for exact field names.

### Established Patterns
- Typed SSE frames folded by a state machine; unknown-part-type tolerance; token-only styling; "never silent" errors already surface as text parts.

### Integration Points
- FastAPI SSE endpoint (new frame emission), `useChatStream` (folding), `message-turn.tsx` (part rendering), `apps/web/src/components/` (ProvenanceLink), Phase 41 (consumer).

</code_context>

<specifics>
## Specific Ideas

- The activity row must appear DURING the round (streamed delta), not after — that's TUI-01's whole point.
- Chips must be real links (middle-click/new-tab works), not onClick handlers.

</specifics>

<deferred>
## Deferred Ideas

- Expandable full tool-result inspector → studio/debug surface, backlog.
- Chip rendering inside genui panels (bindings-driven) → not this phase; chips live in transcript rows.
- Knowledge-preview node itself → Phase 41.

</deferred>
