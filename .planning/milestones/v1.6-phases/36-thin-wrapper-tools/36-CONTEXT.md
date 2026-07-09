# Phase 36: Thin-Wrapper Tools - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous (recommendations auto-accepted + documented; source: SYNTHESIS.md Fork 5 + Fork 3 Tier-2 rule + Phase 34 SUMMARYs)

<domain>
## Phase Boundary

User can ask the chat agent about a known entity (`lookup_entity`) or find related emails
(`search_emails`) and get grounded, cited results — thin wrappers over EXISTING repositories with
zero new backend, executing through Phase 34's tool loop as the first REAL production
`ToolExecutor`s. Requirements: TOOL-01, TOOL-02. Gate G4 satisfied. Python only. NO DB migrations,
NO new RPCs, NO schema changes. `search_knowledge` is Phase 37; quarantine formalization/eval is
Phase 38 — but the Tier-2 behavioral rule (never raw email body) applies HERE from day one because
it is TOOL-02's own requirement text.

</domain>

<decisions>
## Implementation Decisions

### The two tools (locked by Fork 5)
- **`lookup_entity(name_or_id)`** — thin wrapper over the existing `find_candidates()` (`app/domain/ports/entity_resolution_repository.py`, RPCs from migration 0017). Top-5 results. Zero new backend.
- **`search_emails(query)`** — thin wrapper over the existing `find_similar_confirmed()` (`app/domain/ports/retrieval_port.py`, BlendedRAG RRF k=60, migration 0009). Top-5. **Tier-2 rule: returns structured/quarantined inventory — safe enums, summaries, metadata the ingestion pipeline already computed — NEVER `body_raw`/full text.** Planner verifies exactly which ingestion-time fields exist (segment summaries, classification outputs, subject/sender metadata) and picks the safe set; if no LLM-derived summary exists, return metadata + component-level extracted values only. Raw body never crosses into the envelope.
- Tool schemas follow `app/infrastructure/llm/chat_tools.py` conventions: `additionalProperties: false`, enum/maxLength defense-in-depth (query/name maxLength ~200).

### Envelope + citations
- Every result envelope carries `citations[]` of `{kind, id, route}` with canonical routes `/entities/[id]` and `/emails/[id]` (the exact templates Phase 35's citation-faithfulness checker validates — read `packages/genui/src/eval` fixture contract if it exists by execution time; keep shapes aligned).
- Envelopes are typed/structured (dataclasses or TypedDict per repo idiom), size-capped via Phase 34's shared output-cap helper. Truncate long text fields (~300 chars per result field, matching the Fork 5 convention).
- Executors implement the Phase 34 `ToolExecutor` port and honor its contract obligation: return filtered payloads, never raw (Fork 3⊗4 interface note).

### Wiring
- `container.py`: fill the (currently empty) production `tool_executors` mapping with `{"lookup_entity": ..., "search_emails": ...}` — the first real entries. Verify tool schemas get advertised to the model only when the registry entry has `max_tool_rounds > 0` (Phase 34 built this seam; planner confirms the advertisement path in `chat_tools.py`/adapter and closes any gap if 34 left tool-def advertisement stub-only).
- Importer scoping: every query scoped to the caller's importer, following the exact scoping convention `find_candidates`/`find_similar_confirmed` already use — no cross-importer leakage.
- No user-facing UI work (Phase 39 owns the tool-round surface); the tools simply work end-to-end through the existing chat stream.

### Claude's Discretion
- Executor file placement (mirror existing infrastructure layout, e.g. `app/infrastructure/tools/` or alongside llm/), envelope dataclass names, exact safe-field selection for emails, error mapping (repo exceptions → `is_error=True` results with friendly text), test layout.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 34: `ToolExecutor` port, round loop, `cap_tool_output` helper, `EchoToolExecutor` test patterns, container `tool_executors` seam (empty in prod).
- `entity_resolution_repository.py` `find_candidates()` (top-k entity candidates w/ aliases/identifiers); `retrieval_port.py` `find_similar_confirmed()` (RRF-fused confirmed components).
- `chat_tools.py` — tool schema conventions + where tool definitions reach the Bedrock adapter.

### Established Patterns
- Clean Architecture: executors are infrastructure (repos injected), wired in container.py; application layer stays port-only.
- "Never silent": repo/timeout failures → `is_error=True` envelope with a human-readable message (Phase 34 loop renders visible text).

### Integration Points
- `container.py` executor mapping; Bedrock tool advertisement path; Phase 35 citation checker fixtures (shape alignment only, no hard dependency).

</code_context>

<specifics>
## Specific Ideas

- TOOL-01/02 are the "ships first, zero new backend" tools — if a plan finds itself writing SQL or migrations, it has drifted; stop and re-read Fork 5.
- Citations must be constructed server-side from result ids — never model-echoed.

</specifics>

<deferred>
## Deferred Ideas

- `search_knowledge` + KnowledgeGraphRepository extension + `extracted_only` view → Phase 37.
- Adversarial fixtures against these executors + hardening line + contract tests → Phase 38.
- Citation-chip rendering + tool-round UI → Phase 39.

</deferred>
