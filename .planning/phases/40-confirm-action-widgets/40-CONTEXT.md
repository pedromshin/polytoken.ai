# Phase 40: Confirm-Action Widgets - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning (planner MUST read the Phase-24 widget spine code + v1.5 promote-edge use case — this phase composes them)
**Mode:** Smart discuss, autonomous (source: SYNTHESIS.md Fork 2, locked)

<domain>
## Phase Boundary

The agent can end a turn with a confirm-action widget (`emit_confirm_action`) that lets a human
promote/reject a knowledge suggestion over the EXISTING Phase-24 `chat_widget_interactions` CAS
spine, with the ONE new staleness dimension Phase 24 lacks: an edge-tier re-check at submit time.
Requirements: CONF-01, CONF-02. Independent of the tool-loop track (widget tools are TERMINAL,
Phase-24 style — NOT ToolExecutors); can run parallel to Phase 39 (Python here, web there).
Python + one migration; near-zero web work (renders through the UNMODIFIED proposal-card/widget
machinery).

</domain>

<decisions>
## Implementation Decisions

### Emission (CONF-01)
- New terminal widget tool `emit_confirm_action` (sibling of `emit_proposal_cards`/`emit_clarify_widget`, registered in `INTERACTIVE_WIDGET_TOOL_NAMES` path): the model supplies ONLY `suggestion_ref: {kind, id}` (+ short display rationale). Never tier/params/mutation args — mirrors the optionId-not-title precedent.
- At emission the SERVER re-reads the live `knowledge_node_edges` row: must exist, be active, belong to the caller's importer, and still be INFERRED/AMBIGUOUS — else the tool call fails into a visible text part ("suggestion no longer available"). Server derives the frozen `declared_response_schema` `{action: "confirm"|"reject"}` and snapshots the edge's tier into `declaration`.
- `widget_kind` extended with `'confirm_action'` via a NEW migration (verify head first — Phase 37 authors 0029+; this numbers AFTER whatever is merged: `ls packages/db/migrations | tail -1`). Migration only alters the CHECK constraint on `chat_widget_interactions.widget_kind`; applied + live-verified locally like v1.5's.
- Widget SPEC rendering: reuse the existing proposal-card spec shape (two options: Confirm / Reject) built server-side like `build-proposal-cards-spec.ts` consumes — target ZERO new web components; the existing transcript+canvas widget rendering, double-submit lock, staleness signaling all apply unchanged. If a distinct visual proves necessary, minimal variant only.

### Submission (CONF-02)
- Submit reuses `POST /v1/chat/widget/submit` → `SubmitWidgetInteraction.prepare()` UNCHANGED (ownership → turn staleness → schema re-validation → CAS), PLUS the new edge-tier staleness re-check in the USE CASE (not the repository port): re-fetch the edge, compare tier against the `declaration` snapshot; if promoted/rejected out-of-band (another chat, /knowledge canvas) → 409 `stale` BEFORE any mutation.
- Explicit 2-entry dispatch table `{"knowledge_edge_tier_promotion": <v1.5 promote-edge use case>, "entity_merge_confirm": <merge confirm>}` — never resolve a use case from client-supplied names outside this table. Idempotent by id (mirror promote_entity_on_confirm's idempotency).
- **entity_merge_confirm reality check (from Fork 2):** `component_entity_candidate_links` is pair-keyed, not id-addressable. Planner verifies; if the blocker holds, the table entry ships as an explicit registered-but-unsupported handler (clear error result, never a KeyError), the flow ships for knowledge_edge_tier_promotion end-to-end, and the surrogate-key decision is recorded as a deferred backlog note. Do NOT invent a surrogate key this phase.
- `confirm` action → promote via the v1.5 `promote_edge` path recording promotion provenance `{via: "chat_confirm_action", widget_interaction_id, ...}` distinct from synthesis provenance; `reject` action → record the rejection on the interaction row (audit-on-the-row convention) and deactivate-or-mark per existing suggest-edge semantics — planner picks the minimal honest behavior (rejection must NOT delete; supersede/deactivate convention).

### Claude's Discretion
- Exact tool schema fields (maxLength on rationale, enum on kind); dispatch-table module location; how reject is persisted (edge deactivate vs interaction-row-only) after reading v1.5's actual edge semantics; test layout (mirror Phase 24's CAS/staleness test patterns).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 24 spine: `chat_widget_interactions` (0025), `SubmitWidgetInteraction` (ownership/staleness/re-validate/CAS), `run_chat_turn_widgets.py` (emission conventions), `build-proposal-cards-spec.ts` + `compact-interaction-entry.tsx` (rendering, zero-web-work target).
- v1.5: `promote_edge` (fail-closed load→tenant→active→tier→CAS) + promotion-provenance convention; `find_edge_by_id`.
- Migration precedent: 0025 defines the widget_kind CHECK; 0027 shows promotion jsonb.

### Established Patterns
- Terminal widget tools end the turn; `continue_after_widget` resume is a separate turn (do NOT touch the tool loop); FOUND-6 schema gates; audit-on-the-row; idempotent-by-id.

### Integration Points
- `chat_tools.py`/widget tool registry (new tool), `SubmitWidgetInteraction` use case (tier re-check + dispatch table), `packages/db/migrations/` (widget_kind CHECK), container wiring.

</code_context>

<specifics>
## Specific Ideas

- CONF-02's 409-stale is THE new safety property this phase adds — a test must prove: emit widget → promote edge via the v1.5 REST path out-of-band → submit widget → 409 stale, no double mutation.
- The design-case narrative extends: "suggestions become chat-confirmable without ever letting the model touch the mutation parameters."

</specifics>

<deferred>
## Deferred Ideas

- Entity-merge surrogate-key decision + full merge confirm flow → backlog (record as todo if blocker confirmed).
- Demote/undo path for promoted edges → backlog (Fork 2 said plain REST, lower urgency).
- Region-confirm as chat widget → explicitly out (has its own UI).

</deferred>
