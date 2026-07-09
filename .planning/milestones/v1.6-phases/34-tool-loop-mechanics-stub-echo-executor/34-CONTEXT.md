# Phase 34: Tool-Loop Mechanics (stub/echo executor) - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous (`/gsd:autonomous` — recommendations auto-accepted and documented; primary source is the locked research `.planning/research/v1.6-chat-knowledge/SYNTHESIS.md` → Fork 4)

<domain>
## Phase Boundary

The chat agent can execute server tools mid-turn in a bounded in-stream round loop against a
stub/echo `ToolExecutor` — proving the loop mechanics, the new `ToolExecutor` domain port, and the
new `tool_invocation`/`tool_invocation_result` part types before any real knowledge tool exists —
and the 2 latent bugs research found are fixed (UsageDelta overwrite → cost under-reporting;
silent tool-parse-failure drop). This phase IS gate G4 for Phases 35–39. Python only
(`apps/email-listener/`); NO web UI work (tool-round display is Phase 39); NO real tools
(Phase 36/37); NO DB migrations expected (message parts are JSON content; `tool_call`/`tool_result`
run-event types already exist in the 0023 CHECK constraint).

</domain>

<decisions>
## Implementation Decisions

### Loop mechanics (locked by research — Fork 4)
- Bounded in-stream round loop INSIDE `_execute_turn` (`run_chat_turn.py:351`): `while round_count <= _MAX_TOOL_ROUNDS` wrapping the existing inner stream loop — NOT recursion, NOT a new run per round; preserves SEAM-04's one-`ChatRun`-per-turn invariant. `_MAX_TOOL_ROUNDS = 4`.
- Capability gate: new `ChatModelCapabilities.max_tool_rounds: int = 0` (0 = server tools disabled — doubles as the gate; no second boolean). Set `4` on the 2 Bedrock Claude registry entries ONLY. OpenRouter NEVER enters a round (`openrouter_chat_adapter.py:186` drops tool blocks — verified still true).
- New domain port `app/domain/ports/tool_executor.py`; `RunChatTurn` accepts `tool_executors: Mapping[str, ToolExecutor] = {}` (additive default, same pattern as `interactive_widget_tools` at `run_chat_turn.py:146`). Concrete executors wired in `container.py` (respects application ⊥ infrastructure import-linter contract).
- Dispatch branches three ways on tool name: `tool_executors.keys()` (server loop) vs `INTERACTIVE_WIDGET_TOOL_NAMES` (terminal, unchanged) vs `emit_ui_spec` (terminal, unchanged).
- Next-round message build: trimmed history + assistant partial-through-tool_use + synthetic `{role: user, content: [{type: tool_result, tool_use_id, content, is_error}]}` — the Bedrock adapter (`app/infrastructure/llm/bedrock_chat_adapter.py`) already accepts native `tool_result` content blocks verbatim; prefer native blocks over string fencing.
- `ToolResultDelta` already modeled at `chat_provider.py:53` — emit it now (was declared, never emitted).
- Per-round boundary: re-check `breaker.should_abort()` — a round is the same spend commitment as continuing to stream; NO new breaker method this phase (per-round ceiling is Phase 35 / COST-05).
- Round-cap exhaustion: fail closed with a VISIBLE text part ("couldn't fully resolve after several lookups"), never a bare `stopped` (LOOP-03).
- Per-tool timeout: `asyncio.wait_for` ~10s → timeout/exception becomes `ToolExecutionResult(is_error=True)`, never raises out of the loop.
- Tool-output size cap at the executor boundary: ~2000 chars (history trimming doesn't cover in-round messages).

### The 2 bug fixes (LOOP-02)
- `run_chat_turn.py:666`: `replace(state, input_tokens=delta.input_tokens, ...)` OVERWRITES — change to accumulate (`state.input_tokens + delta.input_tokens`); test asserts summed totals across ≥2 rounds.
- `_finalize_pending_tool` (`run_chat_turn.py:679`): JSONDecodeError currently drops the part with only a logger.warning. Fix BOTH paths: (a) the new server-tool round path appends a visible text part explaining the lookup failed; (b) the existing terminal `emit_ui_spec`/widget path also surfaces a visible text part instead of a silent drop — this resolves pending todo `2026-07-06-salvage-truncated-tool-calls.md` (`resolves_phase: 34`; full lenient-repair salvage remains optional — the REQUIRED behavior is: never silent).

### Part types + persistence
- New part types named exactly `tool_invocation` and `tool_invocation_result` (NOT reusing `interactive_widget` — that carries pending-for-human semantics). Persisted as FOUND-1 canonical message parts (JSON content; no schema migration).
- Also persist `tool_call`/`tool_result` run_events rows per round (types already in the 0023 CHECK constraint, never emitted until now) — cheap now, feeds Phase 39's UI. NO new SSE delta types this phase (Phase 39 owns the UI surface).

### Stub/echo executor
- One `echo` ToolExecutor (returns its arguments, respects the size cap, supports a forced-error input for tests). Registered in TESTS ONLY (constructed via DI in test fixtures); `container.py` wires an EMPTY executor mapping in production — so even with `max_tool_rounds=4` on Bedrock entries, no server tool exists in prod until Phase 36. Echo tool schema follows `chat_tools.py` conventions (`additionalProperties: false`).

### Claude's Discretion
- Exact `ToolExecutor` protocol shape (async `execute(name, args) -> ToolExecutionResult`-style), dataclass names, event payload fields, test file layout — follow existing repo idioms (`chat_provider.py` dataclass style, `__tests__` placement, pytest patterns).
- Whether the web transcript renderer needs a tolerance guard for the 2 new part types: VERIFY read-tolerance only; if it would crash, add the minimal guard in the message renderer — but prefer deferring all web changes to Phase 39 (a concurrent Phase-33 agent owns `apps/web` right now; avoid file overlap).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `chat_provider.py:53` `ToolResultDelta` (modeled, unemitted) + `ChatDelta` union at :82; `ChatModelCapabilities` in same file.
- `run_chat_turn.py`: `_execute_turn` at :351, usage fold at :666 (the overwrite bug), `_finalize_pending_tool` at :679, `interactive_widget_tools` seam at :146/:158 — the additive-default pattern to copy for `tool_executors`.
- `app/infrastructure/llm/bedrock_chat_adapter.py` accepts `tool_result` content blocks verbatim; `chat_tools.py` holds the tool-schema conventions + `INTERACTIVE_WIDGET_TOOL_NAMES`.
- Cost breaker: `breaker.should_abort()` already called mid-stream — reuse at round boundaries.
- v1.5 ALREADY built `app/domain/ports/knowledge_graph_repository.py` + Supabase impl (promote-edge work) — NOT needed this phase, but Phase 37 extends it rather than creating it (correcting the synthesis's "needs building from scratch").

### Established Patterns
- Clean Architecture with import-linter contract (application must not import infrastructure — wire in `container.py`).
- FOUND-1 canonical typed message parts; append-only run_events; fail-closed cost breaker per turn.
- Tests: pytest under `__tests__/`, deterministic fake providers/adapters for streaming tests (see existing run_chat_turn tests).

### Integration Points
- `container.py` (executor mapping wiring), model registry entries (the 2 Bedrock Claude entries get `max_tool_rounds=4`), SSE endpoint untouched (loop is inside the use case), messages/run_events repositories (new part/event writes).

</code_context>

<specifics>
## Specific Ideas

- Success criterion #1 verbatim: tool call → `tool_invocation_result` → continued streaming inside the same `_execute_turn` call.
- "Never silent" is the phase's behavioral motto: parse failure → visible text part; timeout → is_error result; cap exhaustion → visible "couldn't fully resolve" part.

</specifics>

<deferred>
## Deferred Ideas

- Per-round cost ceiling + mid-round `cost_capped` abort semantics → Phase 35 (COST-05).
- Real executors (`lookup_entity`, `search_emails`) → Phase 36; `search_knowledge` → Phase 37.
- Tier-filtered envelope contract enforcement on executors → Phase 38 (QUAR-01) — but the `ToolExecutor` port docstring should already state the obligation ("executors return filtered payloads, never raw"; Fork 3⊗4 conflict resolution).
- Tool-round SSE deltas + "searching knowledge…" UI + citation chips → Phase 39.
- Full lenient JSON-prefix repair salvage of truncated tool calls (server-side GenuiPartBoundary analog) — only if cheap during LOOP-02; visible-surface is the requirement.

</deferred>
