"""RunChatTurn — the chat agent/run orchestration loop (SEAM-04, SEAM-03, Phase 22-06/22-07).

Assembles token-budget-trimmed history (D-26), routes to the right transport via
the ChatProviderRouter (D-04..D-07), gates the turn through the CostCircuitBreaker
(fail-closed pre-turn, D-21), streams the provider's deltas as typed run events
(D-27), and persists the user + assistant messages as canonical interleaved typed
parts (FOUND-1) plus the run and its append-only events.

Turn control (Task 3, D-15/D-16/D-19/D-21): a mid-stream cost-cap breach, a
client-disconnect cancellation, and a provider failure are all terminal states
that persist WHATEVER partial content streamed so far — never silently dropped
— then write exactly one terminal run event + the matching message/run status.
regenerate() creates a new active sibling version of an assistant turn (D-16),
reusing the same run loop.

Phase 22-07 (STREAM-02, D-02, D-05, D-18): emit_ui_spec is offered to the
provider ONLY when the picked model is flagged genui-capable in the registry
(D-05) -- the tool dict itself is injected via the constructor (see
`emit_ui_spec_tool` below) rather than imported from
app.infrastructure.llm.chat_tools, since the "Application does not import
infrastructure" import-linter contract forbids that. A genui-capable model's
tool-call partial-JSON (ToolCallDelta) streams progressively as `tool_call` run
events and, once its JSON is complete, finalizes into an interleaved genui_spec
part (D-18) alongside a single `tool_result` run event. The spec is stored
verbatim -- no server-side schema validation/fallback (that gate is the web
boundary, FOUND-6).

Phase 24-02 (DCUI-03, D-01/D-04): `interactive_widget_tools` (e.g.
emit_proposal_cards, injected via the constructor -- same layering rationale)
are offered alongside emit_ui_spec. A completed call finalizes into an
`interactive_widget` part instead of genui_spec (run_chat_turn_widgets.py
owns the pure parse/derive logic); after persist, one pending
chat_widget_interactions row is created via the injected
ChatWidgetInteractionRepository (D-04: one pending widget per turn). Both new
params default falsy -- additive, existing callers unaffected.

Phase 24-04 (DCUI-02, D-02/D-09): `emit_clarify_widget` extends the same
interactive_widget_tools seam (widgetKind "clarify_widget"). `run()` also
calls `ChatWidgetInteractionRepository.supersede_pending(conversation_id)`
immediately after inserting the new user text message -- typing durably
supersedes any pending widget (D-02), server-side, so the state survives
reload. `regenerate()`/`continue_after_widget()` never call it.

Phase 40-01 (CONF-01): `emit_confirm_action` extends the same
interactive_widget_tools seam (widgetKind "confirm_action"), but unlike the
other three widget tools its finalization is NOT purely parse-driven —
`_finalize_confirm_action` (async, `self`-bound) re-reads the live
`knowledge_node_edges` row the model's `suggestionRef.id` names before
building the frozen confirm/reject declaration, failing into visible text
when the suggestion is gone/inactive/cross-tenant/wrong-tier or the call
itself is malformed (never silent). The optional `knowledge_graph` collaborator
is additive-default (None) — a caller that doesn't wire it always gets the
unavailable-text fallback.

Built as an async generator with NO HTTP dependency — the SSE transport (22-07)
is a thin wrapper over `run()`/`regenerate()`.

999.31 carve: this module is now the orchestrator FACADE. The cohesive units
it used to define inline live under `app.application.use_cases.chat.*`
(turn-state/delta folding, prompt+provider-message assembly, thread+cluster
context, linked-context resolution, source-capture web_search lookup) and are
re-exported here under their old names — zero external import paths changed.

Architecture contract (lint-imports): imports only domain ports/services and
standard library / structlog — no infrastructure at module level (mirrors
generate_ui_spec.py's "Application does not import infrastructure" contract).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from dataclasses import dataclass, replace
from decimal import Decimal
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal, cast

import structlog

from app.application.use_cases.chat.cluster_context import (
    _CLUSTER_CONTEXT_EMAIL_LIMIT,
    _CLUSTER_CONTEXT_PANEL_LIMIT,
    _CLUSTER_CONTEXT_SIBLING_LIMIT,
    _CLUSTER_CONTEXT_SOURCE_LIMIT,
    _PANEL_TITLE_FIELD_CHARS,
    _extract_panel_titles,
    system_prompt_with_cluster_context,
)
from app.application.use_cases.chat.linked_context import (
    _LINKED_CONTEXT_EMAIL_LIMIT,
    _MAX_CONTEXT_EDGES_RESOLVED,
    system_prompt_with_linked_context,
)
from app.application.use_cases.chat.prompt_assembly import (
    _SYSTEM_PROMPT,
    _TITLE_SNIPPET_MAX_LEN,
    _TOOL_RESULT_HARDENING_LINE,
    _build_provider_messages,
    _estimate_message_tokens,
    _provider_content_blocks,
    _system_prompt_for,
    _title_snippet,
    _trim_history_to_budget,
)
from app.application.use_cases.chat.source_capture_lookup import (
    _WEB_SEARCH_TOOL_NAME,
    _find_latest_web_search_result_by_index,
    _find_web_search_result,
    _find_web_search_result_in_parts,
)
from app.application.use_cases.chat.turn_state import (
    _accumulated_text_for_estimate,
    _apply_delta,
    _finalize_pending_tool,
    _finalize_state,
    _flush_text_buffer,
    _TurnState,
)
from app.application.use_cases.run_chat_turn_confirm_action import (
    CONFIRM_ACTION_UNAVAILABLE_TEXT,
    EMIT_CONFIRM_ACTION_TOOL_NAME,
    SUGGESTION_KIND_SOURCE_CAPTURE,
    build_confirm_action_declaration,
    build_source_capture_declaration,
    parse_confirm_action_call,
    parse_source_capture_result_id,
)
from app.application.use_cases.run_chat_turn_tool_loop import (
    FINAL_ROUND_NUDGE_TEXT,
    MAX_SERVER_CALLS_PER_ROUND,
    PARALLEL_CALL_OVERFLOW_TEXT,
    PARSE_FAILURE_TEXT,
    ROUND_CAP_EXHAUSTED_TEXT,
    build_synthetic_tool_results_message,
    build_tool_invocation_part,
    build_tool_invocation_result_part,
    cap_tool_output,
    classify_tool_dispatch,
)
from app.application.use_cases.run_chat_turn_widgets import build_create_pending_kwargs
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolResultDelta, UsageDelta
from app.domain.ports.chat_repositories import (
    ChatConversationRepository,
    ChatMessage,
    ChatMessageRepository,
    ChatMessageStatus,
    ChatRun,
    ChatRunEvent,
    ChatRunEventType,
    ChatRunRepository,
    ChatRunStatus,
)
from app.domain.ports.chat_widget_interaction_repository import ChatWidgetInteractionRepository
from app.domain.ports.cost_ledger_repository import CostLedgerRepository, UsageEvent
from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository
from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.chat_model_registry import ChatModel, get_model
from app.domain.services.chat_provider_router import ChatModelNotFoundError, ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker, estimate_prompt_tokens
from app.domain.services.tool_envelope_gate import validate_tool_envelope

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator, Mapping, Sequence

    from app.domain.ports.chat_context_edge_repository import ChatContextEdgeRepository
    from app.domain.ports.chat_provider import ChatDelta, ChatProvider
    from app.domain.ports.email_repository import EmailRepository
    from app.domain.ports.source_ledger_repository import SourceLedgerRepository
    from app.domain.ports.tool_executor import ToolExecutor

logger = structlog.get_logger(__name__)

# 999.31: re-export every symbol the carve moved into app.application.use_cases.chat.*
# under its old module path — external imports (tests, monkeypatch targets)
# keep working unchanged. Listing them here also marks the re-export-only
# imports above as intentionally used (ruff F401).
__all__ = [
    "_CLUSTER_CONTEXT_EMAIL_LIMIT",
    "_CLUSTER_CONTEXT_PANEL_LIMIT",
    "_CLUSTER_CONTEXT_SIBLING_LIMIT",
    "_CLUSTER_CONTEXT_SOURCE_LIMIT",
    "_LINKED_CONTEXT_EMAIL_LIMIT",
    "_MAX_CONTEXT_EDGES_RESOLVED",
    "_PANEL_TITLE_FIELD_CHARS",
    "_SYSTEM_PROMPT",
    "_TITLE_SNIPPET_MAX_LEN",
    "_TOOL_RESULT_HARDENING_LINE",
    "_WEB_SEARCH_TOOL_NAME",
    "RunChatTurn",
    "_TurnState",
    "_accumulated_text_for_estimate",
    "_apply_delta",
    "_build_provider_messages",
    "_estimate_message_tokens",
    "_extract_panel_titles",
    "_finalize_pending_tool",
    "_finalize_state",
    "_find_latest_web_search_result_by_index",
    "_find_web_search_result",
    "_find_web_search_result_in_parts",
    "_flush_text_buffer",
    "_provider_content_blocks",
    "_system_prompt_for",
    "_title_snippet",
    "_trim_history_to_budget",
]

# SEAM-04: one agent, one run per turn today.
_AGENT_ID = "chat-agent-v1"

# Phase 56-02 (RCNV-01): the ledger-eligible tool allowlist -- only a tool
# name in this frozenset ever triggers a `chat_source_ledger` auto-collect
# write. Starts as exactly the one already-gated web_search tool (A4:
# gating is inherited transitively from WEB_SEARCH_TOOL_ENABLED -- the hook
# only ever fires for an already-gated tool, no separate settings flag).
_LEDGER_ELIGIBLE_TOOL_NAMES = frozenset({_WEB_SEARCH_TOOL_NAME})

# Phase 34-03 (LOOP-01): bounded mid-turn server-tool round loop. A round is
# one "model calls a server tool -> executor runs -> result fed back" cycle
# inside the SAME _execute_turn call/run (no new ChatRun per round, SEAM-04).
# At most _MAX_TOOL_ROUNDS executor.execute() calls happen per turn -- a
# request for a 5th server tool call after the cap is exhaustion (LOOP-03),
# never a 5th execution.
_MAX_TOOL_ROUNDS = 4
# Per-tool execution ceiling (T-34-01) -- a timeout never raises out of the
# loop, it becomes an is_error ToolExecutionResult instead.
_TOOL_EXECUTION_TIMEOUT_SECONDS = 10.0
# Phase 69 (RSRCH-01): deep_research is a bounded multi-round agentic loop
# (several LLM steps + web-search rounds), not a lookup -- the flat 10s
# ceiling above would kill every real run mid-plan. Per-tool override,
# consulted at the one dispatch point in _run_server_tool_round; every other
# tool keeps the flat default. This is only the stalled-run backstop -- the
# loop's own ResearchBudget (token ceiling + round cap, deep_research.py) is
# the real cost gate, and it aborts fail-closed long before this fires on a
# healthy run.
_TOOL_TIMEOUT_OVERRIDES: dict[str, float] = {"deep_research": 600.0}
_TOOL_TIMEOUT_TEXT = "Tool execution timed out."
_TOOL_EXECUTION_ERROR_TEXT = "Tool execution failed."

# Phase 38 (QUAR-01): the ONE wiring point's fail-closed replacement text --
# an executor output that fails validate_tool_envelope() is swapped for this
# generic, safe text (never the raw poisoned content) and marked is_error.
_TOOL_ENVELOPE_INVALID_TEXT = "That tool result didn't pass a safety check, so I discarded it."


@dataclass(frozen=True)
class _ServerRoundResult:
    """Outcome of one server-tool round (Phase 34-03, LOOP-01) — see `_run_server_tool_round`.

    provider_messages is None exactly when the post-round breaker re-check
    (T-34-01) trips — the caller must terminate the turn `cost_capped`.
    Otherwise it carries the NEXT round's provider_messages and the caller
    increments round_count and continues streaming in the SAME run.
    """

    state: _TurnState
    events: tuple[ChatRunEvent, ...]
    provider_messages: list[dict[str, Any]] | None


@dataclass(frozen=True)
class _RoundAdvance:
    """Outcome of classifying+advancing one round's finalized pending tool call.

    outcome == "break": a non-server dispatch (widget/emit_ui_spec/unknown,
    unchanged behavior), no tool call at all, a round-cap exhaustion
    (LOOP-03), or a server-tool JSON parse failure (LOOP-02) — the caller
    falls through to the completed-finalize path.
    outcome == "terminal": the post-round breaker re-check tripped
    (T-34-01) — `_advance_round` already persisted + terminated
    'cost_capped' and `events` already carries that terminal event; the
    caller just yields `events` then returns.
    outcome == "continue": a server-tool round executed successfully —
    `provider_messages` carries the NEXT round's messages and the caller
    increments round_count and streams again in the SAME run (LOOP-01).
    `provider_messages` is unused (passed through unchanged) for the other
    two outcomes — always populated (never None) to keep the type simple.
    """

    state: _TurnState
    events: tuple[ChatRunEvent, ...]
    outcome: Literal["break", "terminal", "continue"]
    provider_messages: list[dict[str, Any]]


class _MidStreamTerminalError(Exception):
    """Internal control-flow signal (Phase 34-03) — never escapes `_execute_turn`.

    Raised by `_stream_round_deltas` the instant `_terminal_status_for` flags
    a status (StreamEnd error / mid-stream cost_capped) — the caller catches
    it to persist the partial + terminate via `_terminate` (D-15/D-19/D-21:
    the accumulated state at the moment of the terminal is never dropped).
    """

    def __init__(self, status: ChatMessageStatus, state: _TurnState) -> None:
        super().__init__(status)
        self.status = status
        self.state = state


class RunChatTurn:
    """The chat turn agent: history -> route -> gate -> stream -> events -> persist -> ledger.

    Collaborators are accepted as constructor arguments typed via domain ports —
    the router/breaker are concrete domain services (not infrastructure).
    """

    def __init__(
        self,
        *,
        messages: ChatMessageRepository,
        runs: ChatRunRepository,
        conversations: ChatConversationRepository,
        router: ChatProviderRouter,
        breaker: CostCircuitBreaker,
        ledger: CostLedgerRepository,
        emit_ui_spec_tool: dict[str, Any],
        default_importer_id: str,
        max_output_tokens: int = 4096,
        widget_interactions: ChatWidgetInteractionRepository | None = None,
        interactive_widget_tools: tuple[dict[str, Any], ...] = (),
        knowledge_graph: KnowledgeGraphRepository | None = None,
        tool_executors: Mapping[str, ToolExecutor] = MappingProxyType({}),
        server_tool_defs: Mapping[str, dict[str, Any]] = MappingProxyType({}),
        email_repository: EmailRepository | None = None,
        source_ledger: SourceLedgerRepository | None = None,
        context_edges: ChatContextEdgeRepository | None = None,
    ) -> None:
        self._messages = messages
        self._runs = runs
        self._conversations = conversations
        self._router = router
        self._breaker = breaker
        self._ledger = ledger
        self._emit_ui_spec_tool = emit_ui_spec_tool
        self._default_importer_id = default_importer_id
        self._max_output_tokens = max_output_tokens
        self._widget_interactions = widget_interactions
        self._interactive_widget_tools = interactive_widget_tools
        # Phase 40-01 (CONF-01): the live-edge-read collaborator
        # `_finalize_confirm_action` uses to re-fetch the suggestion at
        # emission time. Additive default (mirrors widget_interactions
        # above) -- None in any caller that doesn't pass it, in which case
        # emit_confirm_action always finalizes into the unavailable-text
        # fallback (fail-closed, never a crash).
        self._knowledge_graph = knowledge_graph
        # Phase 34-03 (LOOP-01): the bounded mid-turn server-tool round loop's
        # seam. Additive default (mirrors interactive_widget_tools above) —
        # empty in production until Phase 36 (container.py wires {} today).
        self._tool_executors = tool_executors
        self._server_tool_names: tuple[str, ...] = tuple(tool_executors.keys())
        # Phase 36-02: real per-tool schemas (name -> {"name","description",
        # "input_schema"} dict, e.g. build_lookup_entity_tool()'s output).
        # Additive default (empty mapping) — a tool name absent here falls
        # back to _build_tool_offer's generic stub dict, so every existing
        # Phase 34/35 test/caller that never passes this stays green.
        self._server_tool_defs = server_tool_defs
        # Phase 54-05 (CLUS-02/CLUS-06): the ONE new read collaborator this
        # plan adds -- additive default (mirrors knowledge_graph above).
        # None means the thread+cluster context feature is entirely OFF: no
        # get_thread_id call is even attempted (see
        # build_cluster_context_block's early return), so every existing
        # test/caller that never passes this stays green.
        self._email_repository = email_repository
        # Phase 56-02 (RCNV-01): the auto-collect ledger write hook's ONE
        # collaborator -- additive default (mirrors email_repository above).
        # None means the feature is structurally OFF: no insert_entries call
        # is even attempted (see _write_source_ledger_entries's early
        # return), so every existing test/caller that never passes this
        # stays green (byte-identical regression guard).
        self._source_ledger = source_ledger
        # Phase 56-04 (RCNV-04): the linked-context injection pipeline's ONE
        # new read collaborator -- additive default (mirrors email_repository
        # above). None means the feature is structurally OFF: no
        # list_active_context_edges call is even attempted (see
        # chat/linked_context.py's early return), so every existing
        # test/caller that never passes this stays green (byte-identical
        # regression guard). This is a SECOND, INDEPENDENT pipeline from
        # _email_repository/_knowledge_graph's existing thread/cluster
        # injection -- it never depends on thread linkage (RESEARCH Pattern 3).
        self._context_edges = context_edges

    async def run(
        self,
        *,
        conversation_id: str,
        user_text: str,
        model_id: str,
        importer_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        """Run one full chat turn for conversation_id, yielding typed ChatRunEvents.

        Persists the user message first (next turn_index) regardless of the
        pre-turn cost decision — only the assistant call is withheld on BLOCK
        (fail-closed, D-21).
        """
        resolved_importer_id = importer_id or self._default_importer_id
        model = get_model(model_id)
        if model is None:
            raise ChatModelNotFoundError(model_id)
        provider = self._router.select(model_id)

        history = await self._messages.list_active_context(conversation_id)
        is_first_turn = len(history) == 0
        turn_index = max((m.turn_index for m in history), default=-1) + 1

        user_message = await self._messages.insert_message(
            conversation_id=conversation_id,
            role="user",
            parts=({"type": "text", "text": user_text},),
            turn_index=turn_index,
            status="completed",
        )
        # D-02 (typing supersedes, Phase 24-04): a new user text message
        # durably supersedes any still-pending widget in this conversation —
        # done here (not in regenerate(), which is not "typing"; D-12's
        # staleness check covers that path instead) so the state survives
        # reload, not just the client's local optimistic mark.
        if self._widget_interactions is not None:
            await self._widget_interactions.supersede_pending(conversation_id)
        # The provider must see the CURRENT user turn — history was read before
        # the insert above, so append the persisted row (an empty `messages`
        # array is a Bedrock ValidationException on a fresh conversation).
        history = [*history, user_message]

        prompt_tokens_est = estimate_prompt_tokens(len(user_text))
        decision = await self._breaker.check_pre_turn(
            model=model,
            importer_id=resolved_importer_id,
            conversation_id=conversation_id,
            prompt_tokens_est=prompt_tokens_est,
            max_output_tokens=self._max_output_tokens,
        )
        if not decision.allowed:
            yield ChatRunEvent(type="cost_capped", data={"breached_cap": decision.breached_cap})
            return

        async for event in self._execute_turn(
            provider=provider,
            model=model,
            model_id=model_id,
            conversation_id=conversation_id,
            history=history,
            turn_index=turn_index,
            importer_id=resolved_importer_id,
            is_first_turn=is_first_turn,
            user_text=user_text,
            sibling_group_id=str(uuid.uuid4()),
            version=1,
        ):
            yield event

    async def regenerate(
        self,
        *,
        conversation_id: str,
        assistant_message_id: str,
        model_id: str,
        importer_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        """Regenerate an assistant turn as a NEW active sibling version (D-16).

        Runs the pre-turn cost gate BEFORE retiring the existing sibling(s) —
        a BLOCKed regenerate must never leave the conversation with zero active
        assistant messages for that turn. Reuses the same `_execute_turn` engine
        with the SAME turn_index and the history preceding that turn; only the
        newly-inserted version feeds future context (D-16).
        """
        resolved_importer_id = importer_id or self._default_importer_id
        model = get_model(model_id)
        if model is None:
            raise ChatModelNotFoundError(model_id)
        provider = self._router.select(model_id)

        history = await self._messages.list_active_context(conversation_id)
        target = next(
            (m for m in history if m.id == assistant_message_id and m.role == "assistant"),
            None,
        )
        if target is None:
            raise ValueError(
                f"No active assistant message {assistant_message_id!r} in conversation {conversation_id!r}"
            )

        decision = await self._breaker.check_pre_turn(
            model=model,
            importer_id=resolved_importer_id,
            conversation_id=conversation_id,
            prompt_tokens_est=0,
            max_output_tokens=self._max_output_tokens,
        )
        if not decision.allowed:
            yield ChatRunEvent(type="cost_capped", data={"breached_cap": decision.breached_cap})
            return

        sibling_group_id = target.sibling_group_id or target.id
        await self._messages.set_sibling_inactive(sibling_group_id)
        # Prior turns PLUS the user message of the turn being regenerated — the
        # provider needs the prompt that produced the original response.
        prior_history = [
            m
            for m in history
            if m.turn_index < target.turn_index or (m.turn_index == target.turn_index and m.role == "user")
        ]
        next_version = target.version + 1

        async for event in self._execute_turn(
            provider=provider,
            model=model,
            model_id=model_id,
            conversation_id=conversation_id,
            history=prior_history,
            turn_index=target.turn_index,
            importer_id=resolved_importer_id,
            is_first_turn=False,
            user_text="",
            sibling_group_id=sibling_group_id,
            version=next_version,
        ):
            yield event

    async def continue_after_widget(
        self,
        *,
        conversation_id: str,
        model_id: str,
        importer_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        """Resume a run after a widget submit (Phase 24-02, D-01 async-resume continuation).

        Caller (SubmitWidgetInteraction) already inserted the interaction_result
        user turn -- active context read here includes it, so this reuses
        `_execute_turn` (same breaker/SSE shape/persistence) without
        duplicating the streaming loop. turn_index matches that just-inserted
        turn (the newest active message); sibling_group_id is fresh -- a new
        assistant turn, not a regenerate.
        """
        resolved_importer_id = importer_id or self._default_importer_id
        model = get_model(model_id)
        if model is None:
            raise ChatModelNotFoundError(model_id)
        provider = self._router.select(model_id)

        history = await self._messages.list_active_context(conversation_id)
        turn_index = max((m.turn_index for m in history), default=0)

        decision = await self._breaker.check_pre_turn(
            model=model,
            importer_id=resolved_importer_id,
            conversation_id=conversation_id,
            prompt_tokens_est=0,
            max_output_tokens=self._max_output_tokens,
        )
        if not decision.allowed:
            yield ChatRunEvent(type="cost_capped", data={"breached_cap": decision.breached_cap})
            return

        async for event in self._execute_turn(
            provider=provider,
            model=model,
            model_id=model_id,
            conversation_id=conversation_id,
            history=history,
            turn_index=turn_index,
            importer_id=resolved_importer_id,
            is_first_turn=False,
            user_text="",
            sibling_group_id=str(uuid.uuid4()),
            version=1,
        ):
            yield event

    def _build_tool_offer(self, model: ChatModel) -> tuple[dict[str, Any], ...]:
        """The tools offered to the provider for this turn (pure w.r.t. `model`).

        D-05: emit_ui_spec (+ Phase 24-02 interactive_widget_tools, e.g.
        emit_proposal_cards) is offered ONLY to genui-capable models; a
        text-only model never even sees a tool exists (D-02/D-03). Phase
        34-03 (LOOP-01, T-34-05): server tool schemas (self._tool_executors)
        are ALSO offered, independently of genui, but ONLY when the model's
        max_tool_rounds capability gate is open AND at least one executor is
        wired — a max_tool_rounds==0 model (every OpenRouter/browser entry)
        never sees a server tool and can never enter a round.

        Phase 36-02: each server tool's real schema comes from
        `self._server_tool_defs` when a matching entry exists (e.g.
        `build_lookup_entity_tool()`'s dict) — the LLM sees the tool's real
        argument shape instead of the Phase-34 placeholder. A tool name with
        no matching entry (e.g. a test-only executor registered without a
        def, like EchoToolExecutor in Phase 34/35's own tests) falls back to
        the original generic stub dict, unchanged.
        """
        tools: tuple[dict[str, Any], ...] = (
            (self._emit_ui_spec_tool, *self._interactive_widget_tools) if model.capabilities.genui else ()
        )
        if not (model.capabilities.max_tool_rounds > 0 and self._tool_executors):
            return tools
        server_tools = tuple(
            self._server_tool_defs.get(
                tool_name,
                {
                    "name": tool_name,
                    "description": f"Server tool: {tool_name}",
                    "input_schema": {"type": "object", "additionalProperties": False},
                },
            )
            for tool_name in self._server_tool_names
        )
        return (*tools, *server_tools)

    async def _system_prompt_with_cluster_context(
        self, *, base_system_prompt: str, conversation_id: str, importer_id: str, history: Sequence[ChatMessage]
    ) -> str:
        """Thin delegator to chat/cluster_context.py (999.31 carve) with this instance's collaborators."""
        return await system_prompt_with_cluster_context(
            base_system_prompt=base_system_prompt,
            conversations=self._conversations,
            knowledge_graph=self._knowledge_graph,
            email_repository=self._email_repository,
            conversation_id=conversation_id,
            importer_id=importer_id,
            history=history,
        )

    async def _system_prompt_with_linked_context(
        self, *, base_system_prompt: str, conversation_id: str, importer_id: str
    ) -> str:
        """Thin delegator to chat/linked_context.py (999.31 carve) with this instance's collaborators."""
        return await system_prompt_with_linked_context(
            base_system_prompt=base_system_prompt,
            conversation_id=conversation_id,
            importer_id=importer_id,
            context_edges=self._context_edges,
            source_ledger=self._source_ledger,
            knowledge_graph=self._knowledge_graph,
            messages=self._messages,
            email_repository=self._email_repository,
        )

    async def _execute_turn(
        self,
        *,
        provider: ChatProvider,
        model: ChatModel,
        model_id: str,
        conversation_id: str,
        history: Sequence[ChatMessage],
        turn_index: int,
        importer_id: str,
        is_first_turn: bool,
        user_text: str,
        sibling_group_id: str,
        version: int,
    ) -> AsyncIterator[ChatRunEvent]:
        """Shared engine: create the run, stream the provider, persist, and finish.

        Every terminal branch (completed/cost_capped/stopped/failed) writes
        exactly one terminal run event and persists the assistant message with
        the matching status — the partial content accumulated so far is NEVER
        silently dropped (D-15/D-19/D-21).
        """
        run = await self._runs.create_run(conversation_id=conversation_id, agent_id=_AGENT_ID, model_id=model_id)
        yield await self._emit(run.id, "started", {"model_id": model_id})

        trimmed_history = _trim_history_to_budget(history, context_tokens=model.capabilities.context_tokens)
        provider_messages = _build_provider_messages(trimmed_history)
        tools = self._build_tool_offer(model)
        # Phase 38 (QUAR-01, T-38-04): the EXACT same condition
        # `_build_tool_offer` already uses to decide whether a server tool is
        # even offered -- computed once here so the hardening line appears
        # only on a turn where a server-tool round is actually possible.
        tool_round_eligible = model.capabilities.max_tool_rounds > 0 and bool(self._tool_executors)
        # Phase 54-05 (CLUS-02/CLUS-06): when conversation_id is linked to a
        # thread, this appends a bounded, quarantined thread+cluster context
        # block to the system prompt -- the SAME "untrusted DATA, never
        # instructions" framing the tool-result hardening line already
        # establishes. No thread linked / feature unwired / any read failure
        # leaves the base system prompt untouched.
        system_prompt = await self._system_prompt_with_cluster_context(
            base_system_prompt=_system_prompt_for(tool_round_eligible),
            conversation_id=conversation_id,
            importer_id=importer_id,
            history=history,
        )
        # Phase 56-04 (RCNV-04, RESEARCH Pattern 3): a SECOND, INDEPENDENT
        # fail-open injection -- resolves the conversation's active
        # chat_context_edges rows into a bounded, quarantined LINKED CONTEXT
        # block, regardless of whether a thread is linked. Deliberately
        # chained AFTER (never nested inside) the cluster-context call above.
        system_prompt = await self._system_prompt_with_linked_context(
            base_system_prompt=system_prompt,
            conversation_id=conversation_id,
            importer_id=importer_id,
        )

        # The FINAL allowed stream (round_count == _MAX_TOOL_ROUNDS) is offered
        # NO server tools — combined with the FINAL_ROUND_NUDGE_TEXT appended
        # to the last round's tool results, the model must spend it writing
        # the actual answer (genui tools stay offered so it can still emit a
        # panel) instead of burning the cap on one more lookup and stranding
        # the user with only ROUND_CAP_EXHAUSTED_TEXT (observed live
        # 2026-07-12: thin keyless-search results made every research turn end
        # capped with no answer).
        final_round_tools = tuple(t for t in tools if t.get("name") not in self._server_tool_names)

        state = _TurnState()
        round_count = 0
        # Phase 34-03 (LOOP-01): a round is one "stream -> [server tool call ->
        # execute -> feed result back]" cycle, all inside this SAME run/state —
        # no recursion, no new ChatRun per round (SEAM-04 preserved). The loop
        # breaks to the completed-finalize path below for every terminal
        # outcome: a non-server tool call (widget/emit_ui_spec/unknown,
        # unchanged behavior), no tool call at all, a server-tool JSON parse
        # failure (LOOP-02, visible text), or round-cap exhaustion (LOOP-03,
        # visible text). Mid-stream cost_capped/stopped/failed terminal
        # branches `return` directly from inside the loop, same as before.
        while round_count <= _MAX_TOOL_ROUNDS:
            round_start_part_count = len(state.parts)
            # COST-05 (Phase 35): baselines a round-scoped cost check diffs
            # against — captured fresh at the top of EVERY round.
            round_start_output_tokens = state.output_tokens
            round_start_text_len = len(_accumulated_text_for_estimate(state))

            # `state` is reassigned DIRECTLY inside this loop (not via a
            # returned value from an awaited coroutine) so that a
            # CancelledError raised mid-stream still leaves `state` holding
            # the latest accumulated partial in THIS scope for the except
            # branch below (D-15) -- an awaited-coroutine boundary would lose
            # it, since a coroutine that raises never reaches its `return`.
            try:
                async for updated_state, event in self._stream_round_deltas(
                    run=run,
                    provider=provider,
                    model=model,
                    model_id=model_id,
                    provider_messages=provider_messages,
                    tools=tools if round_count < _MAX_TOOL_ROUNDS else final_round_tools,
                    system_prompt=system_prompt,
                    state=state,
                    round_start_output_tokens=round_start_output_tokens,
                    round_start_text_len=round_start_text_len,
                ):
                    state = updated_state
                    if event is not None:
                        yield event
            except asyncio.CancelledError:
                async for event in self._terminate(
                    run=run,
                    conversation_id=conversation_id,
                    turn_index=turn_index,
                    state=state,
                    status="stopped",
                    model=model,
                    importer_id=importer_id,
                    sibling_group_id=sibling_group_id,
                    version=version,
                ):
                    yield event
                raise
            except Exception as exc:
                # _MidStreamTerminalError (a mid-stream cost_capped/failed
                # StreamEnd) carries its own status/state; any OTHER exception
                # is an unhandled provider failure -> 'failed' (D-19), state
                # as accumulated so far this round.
                terminal_status: ChatMessageStatus = "failed"
                if isinstance(exc, _MidStreamTerminalError):
                    terminal_status = exc.status
                    state = exc.state
                async for event in self._terminate(
                    run=run,
                    conversation_id=conversation_id,
                    turn_index=turn_index,
                    state=state,
                    status=terminal_status,
                    model=model,
                    importer_id=importer_id,
                    sibling_group_id=sibling_group_id,
                    version=version,
                ):
                    yield event
                return

            # Inner stream ended without a mid-stream terminal status (StreamEnd
            # was non-error and never cost-capped). Classify + advance the
            # round (LOOP-01/LOOP-02/LOOP-03/T-34-01 -- see _advance_round
            # docstring; a post-round cost cap is ALSO a terminal outcome
            # handled internally there).
            advance = await self._advance_round(
                run=run,
                state=state,
                model=model,
                round_start_part_count=round_start_part_count,
                round_start_output_tokens=round_start_output_tokens,
                round_start_text_len=round_start_text_len,
                round_count=round_count,
                provider_messages=provider_messages,
                conversation_id=conversation_id,
                turn_index=turn_index,
                importer_id=importer_id,
                sibling_group_id=sibling_group_id,
                version=version,
            )
            for event in advance.events:
                yield event
            state = advance.state

            if advance.outcome == "terminal":
                return
            if advance.outcome == "break":
                break

            provider_messages = advance.provider_messages
            round_count += 1

        # Completed normally — either a terminal (non-server) tool call, no
        # tool call at all, a round-cap exhaustion, or a server-tool parse
        # failure fell through to here (never a mid-stream/cost_capped
        # terminal — those already `return`d above).
        async for event in self._finalize_turn_completed(
            run=run,
            state=state,
            model=model,
            conversation_id=conversation_id,
            turn_index=turn_index,
            importer_id=importer_id,
            sibling_group_id=sibling_group_id,
            version=version,
            model_id=model_id,
            is_first_turn=is_first_turn,
            user_text=user_text,
        ):
            yield event

    async def _finalize_turn_completed(
        self,
        *,
        run: ChatRun,
        state: _TurnState,
        model: ChatModel,
        conversation_id: str,
        turn_index: int,
        importer_id: str,
        sibling_group_id: str,
        version: int,
        model_id: str,
        is_first_turn: bool,
        user_text: str,
    ) -> AsyncIterator[ChatRunEvent]:
        """Finalize any still-pending tool call, persist 'completed', touch the conversation.

        Finalize any STILL-pending emit_ui_spec/widget call HERE so its
        tool_result event reaches the client (persist's own _finalize_state
        would silently swallow it — found live 2026-07-04: spec persisted but
        no tool_result streamed, leaving the client's live view stuck on
        "streaming"). A server-round parse failure/exhaustion already cleared
        pending_tool_id before reaching this path, so this is a no-op there.

        Phase 40-01 (CONF-01): `_finalize_confirm_action` runs FIRST — it is
        the only site with both `self` (repository access, for the live edge
        re-read) and `importer_id`. It EAGERLY clears pending_tool_* on every
        branch, so the subsequent `_finalize_pending_tool(state)` call below
        is provably a no-op for an emit_confirm_action call either way.
        """
        state, confirm_action_event = await self._finalize_confirm_action(
            state, importer_id=importer_id, conversation_id=conversation_id
        )
        if confirm_action_event is not None:
            yield await self._emit(run.id, confirm_action_event[0], confirm_action_event[1])
        state, tool_result_event = _finalize_pending_tool(state)
        if tool_result_event is not None:
            yield await self._emit(run.id, tool_result_event[0], tool_result_event[1])
        await self._persist_and_finish(
            run=run,
            conversation_id=conversation_id,
            turn_index=turn_index,
            state=state,
            status="completed",
            run_status="completed",
            model=model,
            importer_id=importer_id,
            sibling_group_id=sibling_group_id,
            version=version,
        )
        yield await self._emit(
            run.id, "usage", {"input_tokens": state.input_tokens, "output_tokens": state.output_tokens}
        )
        yield await self._emit(run.id, "completed", {})

        title = _title_snippet(user_text) if is_first_turn else None
        await self._conversations.touch(conversation_id=conversation_id, model_id=model_id, title=title)

    async def _finalize_confirm_action(
        self, state: _TurnState, *, importer_id: str, conversation_id: str
    ) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
        """Finalize a still-pending emit_confirm_action call via a LIVE re-read (CONF-01/CLUS-04).

        No-op (`state, None`) unless the pending tool is emit_confirm_action —
        every other pending tool name falls through unchanged to the caller's
        subsequent `_finalize_pending_tool(state)` call.

        Clears pending_tool_* EAGERLY on every branch below (parse-fail,
        edge-unavailable, success) — this is what makes it safe to run this
        live-I/O check from `_finalize_turn_completed` (the only async site
        with `self`) while `_finalize_pending_tool` itself stays pure: by the
        time that pure function runs next, pending_tool_id is already None,
        so it is provably a no-op for this tool.

        A malformed call (T-40-04) never reaches ANY live lookup — parsing
        happens first for both suggestion kinds. `source_capture` (Phase
        54-03) branches into `_finalize_source_capture`, which re-reads a
        persisted web_search result instead of a `knowledge_node_edges` row.
        For `knowledge_edge_tier_promotion`: edge-not-found, cross-importer,
        inactive, and wrong-tier all collapse into the SAME
        CONFIRM_ACTION_UNAVAILABLE_TEXT (T-40-02) — a probing model/user
        cannot distinguish "wrong tenant" from "already resolved" from
        "doesn't exist". A DB error during the lookup is caught and treated
        identically to edge-unavailable (fail-closed, never crashes the turn).
        """
        if state.pending_tool_name != EMIT_CONFIRM_ACTION_TOOL_NAME or state.pending_tool_id is None:
            return state, None

        tool_id = state.pending_tool_id
        raw_json = state.pending_tool_json
        cleared = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")

        parsed = parse_confirm_action_call(raw_json)
        if parsed is None:
            logger.warning("confirm_action_tool_call_parse_failed", tool_id=tool_id)
            return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None

        if parsed["kind"] == SUGGESTION_KIND_SOURCE_CAPTURE:
            return await self._finalize_source_capture(
                cleared, tool_id=tool_id, parsed=parsed, importer_id=importer_id, conversation_id=conversation_id
            )

        edge: dict[str, object] | None = None
        if self._knowledge_graph is not None:
            try:
                edge = await self._knowledge_graph.find_edge_by_id(parsed["id"])
            except Exception:  # fail-closed, never crash the turn on a DB hiccup
                logger.warning("confirm_action_edge_lookup_failed", tool_id=tool_id, suggestion_id=parsed["id"])
                edge = None

        edge_valid = (
            edge is not None
            and edge.get("importer_id") == importer_id
            and bool(edge.get("is_active"))
            and edge.get("tier") in ("INFERRED", "AMBIGUOUS")
        )
        if not edge_valid:
            logger.warning("confirm_action_edge_unavailable", tool_id=tool_id, suggestion_id=parsed["id"])
            return (
                replace(cleared, parts=(*cleared.parts, {"type": "text", "text": CONFIRM_ACTION_UNAVAILABLE_TEXT})),
                None,
            )

        assert edge is not None  # narrows for mypy -- edge_valid already proved this
        declaration = build_confirm_action_declaration(
            kind=parsed["kind"],
            suggestion_id=parsed["id"],
            edge=edge,
            rationale=parsed["rationale"],
        )
        widget_part = {
            "type": "interactive_widget",
            "interactionId": str(uuid.uuid4()),
            "widgetKind": "confirm_action",
            "declaration": declaration,
        }
        finalized = replace(cleared, parts=(*cleared.parts, widget_part))
        return finalized, (
            "tool_result",
            {"tool_name": EMIT_CONFIRM_ACTION_TOOL_NAME, "id": tool_id, "interactionId": widget_part["interactionId"]},
        )

    async def _finalize_source_capture(
        self,
        cleared: _TurnState,
        *,
        tool_id: str,
        parsed: dict[str, Any],
        importer_id: str,
        conversation_id: str,
    ) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
        """Re-read a web_search result server-side by its {toolUseId}:{index} id (Phase 54-03, T-54-03-01).

        Never trusts model-authored title/url/snippet text — only the id (a
        lookup key into a server-recorded tool_invocation_result part) comes
        from the model. The CURRENT turn's accumulated parts are scanned
        FIRST — the designed flow is search-then-propose in ONE turn, and at
        finalize time this turn's assistant message is not yet persisted
        (found live 2026-07-12: the history-only lookup made every same-turn
        capture collapse into 'unavailable', deadlocking CLUS-04 — prior-turn
        refs are impossible too, since replay stand-ins omit tool ids).
        Persisted history remains the fallback. A malformed id, an
        unresolvable toolUseId, an out-of-range index, or a foreign
        (cross-conversation) result all collapse into the SAME
        CONFIRM_ACTION_UNAVAILABLE_TEXT (T-54-03-03 — no leak of which case).
        `retrievedAt` is stamped fresh at THIS re-read (server time, never
        model-supplied).
        """
        source: dict[str, object] | None = None
        ref = parse_source_capture_result_id(parsed["id"])
        if ref is not None:
            tool_use_id, index = ref
            source = _find_web_search_result_in_parts(cleared.parts, tool_use_id=tool_use_id, index=index)
            if source is None:
                try:
                    history = await self._messages.list_active_context(conversation_id)
                except Exception:  # fail-closed, never crash the turn on a DB hiccup
                    logger.warning("confirm_action_source_capture_lookup_failed", tool_id=tool_id)
                    history = []
                source = _find_web_search_result(history, tool_use_id=tool_use_id, index=index)
            if source is None:
                # Models mistranscribe opaque tool ids (observed live
                # 2026-07-12: 'toolu_01...' fabricated for the real
                # 'toolu_bdrk_01...'). The id is only a lookup key — content
                # is still re-read server-side, and the user still sees the
                # exact url/title in the confirm widget before anything is
                # written (suggest-only gate) — so fall back to resolving
                # `index` against THIS turn's own web_search results
                # (most recent first). Cross-conversation reads stay
                # impossible; no same-turn search means still-unavailable.
                source = _find_latest_web_search_result_by_index(cleared.parts, index=index)
                if source is not None:
                    logger.warning(
                        "confirm_action_source_capture_id_fallback",
                        tool_id=tool_id,
                        suggestion_id=parsed["id"],
                    )

        if source is None:
            logger.warning("confirm_action_source_capture_unavailable", tool_id=tool_id, suggestion_id=parsed["id"])
            return (
                replace(cleared, parts=(*cleared.parts, {"type": "text", "text": CONFIRM_ACTION_UNAVAILABLE_TEXT})),
                None,
            )

        declaration = build_source_capture_declaration(
            suggestion_id=parsed["id"],
            source=source,
            rationale=parsed["rationale"],
            importer_id=importer_id,
        )
        widget_part = {
            "type": "interactive_widget",
            "interactionId": str(uuid.uuid4()),
            "widgetKind": "confirm_action",
            "declaration": declaration,
        }
        finalized = replace(cleared, parts=(*cleared.parts, widget_part))
        return finalized, (
            "tool_result",
            {"tool_name": EMIT_CONFIRM_ACTION_TOOL_NAME, "id": tool_id, "interactionId": widget_part["interactionId"]},
        )

    def _terminal_status_for(
        self,
        delta: ChatDelta,
        *,
        model: ChatModel,
        state: _TurnState,
        round_start_output_tokens: int,
        round_start_text_len: int,
    ) -> ChatMessageStatus | None:
        """Return the terminal status this delta forces, or None to keep streaming.

        A StreamEnd(error) always fails the turn (D-19). A TextDelta/UsageDelta
        that pushes the (estimated, then real) running cost past should_abort's
        threshold cost-caps the turn mid-stream (D-21). Once the per-turn
        check clears, the SAME delta is also checked against the COST-05
        round-scoped cap (`should_abort_round`) — either trip cost-caps the
        turn, mid-round, before the round's own streaming even finishes.
        """
        if isinstance(delta, StreamEnd) and delta.stop_reason == "error":
            return "failed"
        if isinstance(delta, TextDelta):
            estimated_cost = self._estimated_cost_so_far(model=model, state=state)
            if self._breaker.should_abort(estimated_cost):
                return "cost_capped"
            round_cost = self._estimated_round_cost_so_far(
                model=model,
                state=state,
                round_start_output_tokens=round_start_output_tokens,
                round_start_text_len=round_start_text_len,
            )
            if self._breaker.should_abort_round(round_cost):
                return "cost_capped"
        elif isinstance(delta, UsageDelta):
            real_cost = self._breaker.estimate_turn_cost(
                model=model, prompt_tokens_est=state.input_tokens, max_output_tokens=state.output_tokens
            )
            if self._breaker.should_abort(real_cost):
                return "cost_capped"
            round_cost = self._estimated_round_cost_so_far(
                model=model,
                state=state,
                round_start_output_tokens=round_start_output_tokens,
                round_start_text_len=round_start_text_len,
            )
            if self._breaker.should_abort_round(round_cost):
                return "cost_capped"
        return None

    async def _terminate(
        self,
        *,
        run: ChatRun,
        conversation_id: str,
        turn_index: int,
        state: _TurnState,
        status: ChatMessageStatus,
        model: ChatModel,
        importer_id: str,
        sibling_group_id: str,
        version: int,
    ) -> AsyncIterator[ChatRunEvent]:
        """Persist the partial + finish the run, then yield the ONE matching terminal event.

        status doubles as the run's terminal status ('cost_capped'/'stopped'/
        'failed' map 1:1 between chat_messages.status and chat_runs.status).
        """
        run_status: ChatRunStatus = status  # type: ignore[assignment]  # shared value set (cost_capped/stopped/failed)
        await self._persist_and_finish(
            run=run,
            conversation_id=conversation_id,
            turn_index=turn_index,
            state=state,
            status=status,
            run_status=run_status,
            model=model,
            importer_id=importer_id,
            sibling_group_id=sibling_group_id,
            version=version,
        )
        # status is always one of 'cost_capped'/'stopped'/'failed' here — a subset
        # of both ChatMessageStatus and ChatRunEventType, but mypy can't narrow a
        # Literal parameter's runtime-restricted value set on its own.
        yield await self._emit(run.id, cast("ChatRunEventType", status), {})

    async def _persist_and_finish(
        self,
        *,
        run: ChatRun,
        conversation_id: str,
        turn_index: int,
        state: _TurnState,
        status: ChatMessageStatus,
        run_status: ChatRunStatus,
        model: ChatModel,
        importer_id: str,
        sibling_group_id: str,
        version: int,
    ) -> None:
        """Persist the assistant message (whatever streamed so far) + record usage + finish the run.

        Called for EVERY terminal branch (completed/cost_capped/stopped/failed)
        so a partial is never silently dropped (D-15) and the ledger always
        gets whatever usage was captured — even Decimal("0")/0 tokens when the
        stream never reached a UsageDelta (D-21 mid-stream / T-22-22). `state`
        is finalized here (Phase 22-07: any buffered text or in-flight
        emit_ui_spec tool call is flushed into `parts`, D-18) so a mid-stream
        abort never drops the interleaved partial.
        """
        finalized = _finalize_state(state, server_tool_names=self._server_tool_names)
        message = await self._messages.insert_message(
            conversation_id=conversation_id,
            role="assistant",
            parts=finalized.parts,
            turn_index=turn_index,
            status=status,
            run_id=run.id,
            sibling_group_id=sibling_group_id,
            version=version,
            is_active=True,
        )
        # D-04: at most one pending widget per turn; no-op when no repository
        # is configured (additive default) or the message has no such part.
        if self._widget_interactions is not None:
            widget_kwargs = build_create_pending_kwargs(message.parts)
            if widget_kwargs is not None:
                await self._widget_interactions.create_pending(
                    conversation_id=conversation_id,
                    message_id=message.id,
                    turn_index=turn_index,
                    sibling_group_id=sibling_group_id,
                    **widget_kwargs,
                )
        cost = self._breaker.estimate_turn_cost(
            model=model, prompt_tokens_est=finalized.input_tokens, max_output_tokens=finalized.output_tokens
        )
        # chat_cost_ledger.user_id is NOT NULL (0033) — attribute the row to the
        # conversation OWNER (authoritative for every entrypoint, including
        # non-HTTP callers). Best-effort like record() itself: a lookup failure
        # degrades to None (insert rejected + logged) and NEVER breaks the
        # terminal path.
        try:
            owner_user_id = await self._conversations.owner_user_id(conversation_id)
        except Exception:
            logger.warning("cost_ledger_owner_lookup_failed", conversation_id=conversation_id)
            owner_user_id = None
        await self._ledger.record(
            UsageEvent(
                importer_id=importer_id,
                model_id=model.id,
                execution_locus=model.execution_locus,
                input_tokens=finalized.input_tokens,
                output_tokens=finalized.output_tokens,
                cost_usd=cost,
                conversation_id=conversation_id,
                run_id=run.id,
                user_id=owner_user_id,
            )
        )
        await self._runs.finish_run(run_id=run.id, status=run_status)

    def _estimated_cost_so_far(self, *, model: ChatModel, state: _TurnState) -> Decimal:
        """Cheap running-cost ESTIMATE from accumulated output length (mid-stream abort signal).

        Real cost is always recorded post-turn from actual captured usage
        (D-22); this heuristic exists solely to decide whether to keep
        streaming, mirroring the pre-turn estimate's own heuristic contract.
        """
        tokens_so_far = estimate_prompt_tokens(len(_accumulated_text_for_estimate(state)))
        return self._breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)

    def _estimated_round_cost_so_far(
        self,
        *,
        model: ChatModel,
        state: _TurnState,
        round_start_output_tokens: int,
        round_start_text_len: int,
    ) -> Decimal:
        """COST-05 round-scoped cost ESTIMATE, scoped to output produced SINCE the round began.

        Mirrors `_estimated_cost_so_far`'s heuristic exactly, but diffs
        against the round's own baseline instead of the whole turn — takes
        the LARGER of the mid-stream text-length estimate and the real
        per-round token delta, whichever is available at the call site.
        """
        text_len_delta = max(0, len(_accumulated_text_for_estimate(state)) - round_start_text_len)
        token_delta = max(0, state.output_tokens - round_start_output_tokens)
        tokens_so_far = max(estimate_prompt_tokens(text_len_delta), token_delta)
        return self._breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)

    async def _emit(self, run_id: str, event_type: ChatRunEventType, data: dict[str, Any]) -> ChatRunEvent:
        """Persist one run event (append-only) and return it for the caller to yield."""
        return await self._runs.append_event(run_id=run_id, event_type=event_type, data=data)

    async def _stream_round_deltas(
        self,
        *,
        run: ChatRun,
        provider: ChatProvider,
        model: ChatModel,
        model_id: str,
        provider_messages: list[dict[str, Any]],
        tools: tuple[dict[str, Any], ...],
        system_prompt: str,
        state: _TurnState,
        round_start_output_tokens: int,
        round_start_text_len: int,
    ) -> AsyncIterator[tuple[_TurnState, ChatRunEvent | None]]:
        """Stream ONE round's deltas, yielding (updated_state, event_or_none) pairs.

        Always yields at least once per delta processed — even when
        `_apply_delta` produces no run event (e.g. UsageDelta) — so the
        caller's `state` is never stale between yields. Raises
        `_MidStreamTerminalError` (never escapes `_execute_turn`) the instant
        `_terminal_status_for` flags a status; the caller persists + terminates.

        Phase 38 (QUAR-01, T-38-04): `system_prompt` is computed ONCE per turn
        by `_execute_turn` (`_system_prompt_for`) and passed down here instead
        of referencing the module constant `_SYSTEM_PROMPT` directly — it
        carries the tool-result hardening line only on a tool-round-eligible
        turn.
        """
        # Cast: ChatProvider.stream() is typed AsyncIterator[ChatDelta] on the Protocol
        # (deliberately loose so a future non-generator implementation stays valid),
        # but every real adapter (BedrockChatAdapter/OpenRouterChatAdapter) IS an
        # `async def ...: yield ...` generator — aclosing() needs the narrower
        # AsyncGenerator type to guarantee .aclose().
        raw_stream = cast(
            "AsyncGenerator[ChatDelta, None]",
            provider.stream(
                model_id=model_id,
                system=system_prompt,
                messages=provider_messages,
                tools=tools,
                max_tokens=self._max_output_tokens,
            ),
        )
        async with contextlib.aclosing(raw_stream) as delta_stream:
            async for delta in delta_stream:
                state, events = _apply_delta(delta, state, server_tool_names=self._server_tool_names)
                if events:
                    for event_type, event_data in events:
                        yield state, await self._emit(run.id, event_type, event_data)
                else:
                    yield state, None

                terminal_status = self._terminal_status_for(
                    delta,
                    model=model,
                    state=state,
                    round_start_output_tokens=round_start_output_tokens,
                    round_start_text_len=round_start_text_len,
                )
                if terminal_status is not None:
                    raise _MidStreamTerminalError(terminal_status, state)

    async def _advance_round(
        self,
        *,
        run: ChatRun,
        state: _TurnState,
        model: ChatModel,
        round_start_part_count: int,
        round_start_output_tokens: int,
        round_start_text_len: int,
        round_count: int,
        provider_messages: list[dict[str, Any]],
        conversation_id: str,
        turn_index: int,
        importer_id: str,
        sibling_group_id: str,
        version: int,
    ) -> _RoundAdvance:
        """Collect the round's server-tool calls (queued + still-pending) and advance.

        See `_RoundAdvance`'s docstring for the three outcomes. This is the
        Phase 34-03 (LOOP-01/LOOP-02/LOOP-03/T-34-01) dispatch point: no
        server-tool work (plain text turn, or a terminal widget/emit_ui_spec
        call left pending for the post-loop finalize), a round-cap
        exhaustion, or a malformed server-tool call are all terminal
        ("break") -- unchanged behavior for the first, LOOP-03/LOOP-02
        visible text for the latter two. Well-formed server-tool calls — ALL
        of them: the model may emit several tool_use blocks in one response
        (2026-07-12 live regression: the non-last ones were mangled into
        genui_spec parts) — execute via `_run_server_tool_round`, then either
        continue the SAME run with a new round ("continue") or, if the
        post-round breaker re-check trips (T-34-01, now also checking the
        COST-05/Phase 35 per-round ceiling implemented in
        `_run_server_tool_round`), persists + terminates 'cost_capped' HERE
        and returns "terminal".
        """
        # A SERVER call still pending at StreamEnd joins the queue (same path
        # a mid-stream-finalized call took in _apply_delta); a widget/
        # emit_ui_spec/unknown pending call stays pending — it finalizes after
        # the loop, unchanged.
        if state.pending_tool_id is not None:
            dispatch = classify_tool_dispatch(state.pending_tool_name or "", self._server_tool_names)
            if dispatch == "server":
                state, _no_event = _finalize_pending_tool(state, server_tool_names=self._server_tool_names)

        if not state.queued_server_calls:
            # No server-tool work this round — plain text turn, or a terminal
            # widget/emit_ui_spec call (unchanged behavior).
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        if round_count >= _MAX_TOOL_ROUNDS:
            # LOOP-03: the model STILL wants a server tool after the cap —
            # fail closed with a visible text part, never a bare stopped
            # state, and never a 5th tool execution.
            state = replace(state, queued_server_calls=())
            state = replace(state, parts=(*state.parts, {"type": "text", "text": ROUND_CAP_EXHAUSTED_TEXT}))
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        this_round_lead_parts = list(state.parts[round_start_part_count:])

        # Parse EVERY queued call's JSON up front — any malformed call keeps
        # the LOOP-02 contract exactly: visible PARSE_FAILURE_TEXT, no
        # execution, turn completes.
        calls: list[dict[str, Any]] = []
        queued_calls = state.queued_server_calls
        state = replace(state, queued_server_calls=())
        for queued in queued_calls:
            try:
                arguments: dict[str, Any] = json.loads(queued["raw_json"]) if queued["raw_json"] else {}
            except (json.JSONDecodeError, TypeError):
                logger.warning("server_tool_call_parse_failed", tool_id=queued["id"], tool_name=queued["name"])
                state = replace(state, parts=(*state.parts, {"type": "text", "text": PARSE_FAILURE_TEXT}))
                return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)
            calls.append({"name": queued["name"], "id": queued["id"], "arguments": arguments})

        round_result = await self._run_server_tool_round(
            run=run,
            state=state,
            model=model,
            calls=calls,
            this_round_lead_parts=this_round_lead_parts,
            provider_messages=provider_messages,
            round_start_output_tokens=round_start_output_tokens,
            round_start_text_len=round_start_text_len,
            importer_id=importer_id,
            is_last_round=round_count + 1 >= _MAX_TOOL_ROUNDS,
        )
        if round_result.provider_messages is not None:
            return _RoundAdvance(
                state=round_result.state,
                events=round_result.events,
                outcome="continue",
                provider_messages=round_result.provider_messages,
            )

        terminate_events = [
            event
            async for event in self._terminate(
                run=run,
                conversation_id=conversation_id,
                turn_index=turn_index,
                state=round_result.state,
                status="cost_capped",
                model=model,
                importer_id=importer_id,
                sibling_group_id=sibling_group_id,
                version=version,
            )
        ]
        return _RoundAdvance(
            state=round_result.state,
            events=(*round_result.events, *terminate_events),
            outcome="terminal",
            provider_messages=provider_messages,
        )

    async def _write_source_ledger_entries(
        self,
        *,
        conversation_id: str,
        importer_id: str,
        tool_name: str,
        tool_use_id: str,
        content: str,
    ) -> None:
        """Fail-open ledger write (Phase 56-02, RCNV-01) — never raises past the tool round.

        Parses the ALREADY-quarantined+bounded envelope (post `validate_tool_envelope` +
        `cap_tool_output`) `{"mode": "web_search", "results": [{"title","url","snippet"}, ...]}`,
        builds one `SourceLedgerEntry` per result carrying a url (urlless entries are skipped,
        `result_index` is the enumeration position), and upserts them via `insert_entries` when
        non-empty. Zero writes to the confirm-ceremony knowledge graph — this is a separate
        candidate pool (999.19), never the `SourceCaptureHandler` path.

        A malformed/unparseable envelope, or ANY failure from `insert_entries` (e.g. the
        chat_source_ledger table not yet applied to this environment), logs a warning and
        returns — mirrors `_list_captured_sources`/`_resolve_thread_id`'s exact fail-open
        idiom (T-56-02-01: never block the model's turn, never raise a 500).
        """
        if self._source_ledger is None:
            return
        try:
            envelope = json.loads(content)
            results = envelope.get("results", []) if isinstance(envelope, dict) else []
            entries = [
                SourceLedgerEntry(
                    conversation_id=conversation_id,
                    importer_id=importer_id,
                    tool_name=tool_name,
                    tool_use_id=tool_use_id,
                    result_index=index,
                    url=str(result["url"]),
                    title=str(result.get("title") or result["url"]),
                    snippet=str(result.get("snippet")) if result.get("snippet") else None,
                )
                for index, result in enumerate(results)
                if isinstance(result, dict) and result.get("url")
            ]
            if entries:
                await self._source_ledger.insert_entries(entries)
        except Exception:  # never raise past the tool round (fail-open, T-56-02-01)
            logger.warning("source_ledger_write_failed", tool_use_id=tool_use_id, tool_name=tool_name)

    async def _run_server_tool_round(
        self,
        *,
        run: ChatRun,
        state: _TurnState,
        model: ChatModel,
        calls: list[dict[str, Any]],
        this_round_lead_parts: list[dict[str, Any]],
        provider_messages: list[dict[str, Any]],
        round_start_output_tokens: int,
        round_start_text_len: int,
        importer_id: str,
        is_last_round: bool = False,
    ) -> _ServerRoundResult:
        """Execute one server-tool round (Phase 34-03, LOOP-01): dispatch, cap, feed back.

        `calls` is EVERY server-tool call the model emitted in this response
        ({"name", "id", "arguments"} each, in emission order) — the API
        contract requires one tool_result per tool_use in the SAME next user
        message. Calls beyond MAX_SERVER_CALLS_PER_ROUND are not executed but
        still get an is_error tool_result (bounded work, protocol intact).

        `is_last_round`: this round consumed the tool budget — the fed-back
        user message gains a trailing FINAL_ROUND_NUDGE_TEXT text block
        (paired with the final stream offering no server tools) so the model
        spends its last stream answering instead of asking for another lookup.

        A per-tool timeout (`asyncio.wait_for`, ~10s, T-34-01) or ANY raised
        exception NEVER escapes this method — both become an `is_error`
        `ToolExecutionResult` (port contract, `tool_executor.py`). The
        `tool_invocation`/`tool_invocation_result` parts and the `tool_call`/
        `tool_result` run events are always recorded, whatever the outcome.
        """
        events: list[ChatRunEvent] = []
        results: list[ToolExecutionResult] = []
        for call_index, call in enumerate(calls):
            tool_name: str = call["name"]
            tool_id: str = call["id"]
            arguments: dict[str, Any] = call["arguments"]
            invocation_part = build_tool_invocation_part(tool_name, tool_id, arguments)
            state = replace(state, parts=(*state.parts, invocation_part))
            events.append(
                await self._emit(run.id, "tool_call", {"tool_name": tool_name, "id": tool_id, "arguments": arguments})
            )
            # Phase 39 (TUI-01): non-persisted SSE mirror frame -- constructed
            # DIRECTLY (never routed through self._emit/self._runs.append_event),
            # id/run_id/seq stay at their dataclass defaults (None). Deliberately
            # omits `arguments` (see 39-UI-SPEC.md's SSE / Part Contract).
            events.append(ChatRunEvent(type="server_tool_call", data={"tool_name": tool_name, "id": tool_id}))

            if call_index >= MAX_SERVER_CALLS_PER_ROUND:
                logger.warning("server_tool_call_overflow_skipped", tool_id=tool_id, tool_name=tool_name)
                result = ToolExecutionResult(tool_use_id=tool_id, content=PARALLEL_CALL_OVERFLOW_TEXT, is_error=True)
            else:
                executor = self._tool_executors[tool_name]
                try:
                    result = await asyncio.wait_for(
                        executor.execute(name=tool_name, arguments=arguments, importer_id=importer_id),
                        timeout=_TOOL_TIMEOUT_OVERRIDES.get(tool_name, _TOOL_EXECUTION_TIMEOUT_SECONDS),
                    )
                except TimeoutError:
                    logger.warning("server_tool_execution_timed_out", tool_id=tool_id, tool_name=tool_name)
                    result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_TIMEOUT_TEXT, is_error=True)
                except Exception:  # an executor MUST NEVER raise out of the loop (port contract)
                    logger.warning("server_tool_execution_failed", tool_id=tool_id, tool_name=tool_name)
                    result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_EXECUTION_ERROR_TEXT, is_error=True)

            # Phase 38 (QUAR-01): the ONE wiring point in the round loop -- every
            # registered executor's non-error output is validated against the
            # structural envelope contract BEFORE it can enter provider_messages
            # or a persisted part. The existing timeout/exception is_error
            # results above are deliberately left untouched -- their content is
            # already a pre-vetted safe string, not JSON from an executor.
            if result.is_error is False:
                gate = validate_tool_envelope(result.content)
                if gate.ok is False:
                    logger.warning(
                        "tool_envelope_gate_rejected", tool_id=tool_id, tool_name=tool_name, reason=gate.reason
                    )
                    result = ToolExecutionResult(
                        tool_use_id=tool_id, content=_TOOL_ENVELOPE_INVALID_TEXT, is_error=True
                    )

            # T-34-04 defense-in-depth / protocol correctness: the fed-back native
            # tool_result block's tool_use_id MUST match the tool_use block's id
            # exactly (Anthropic/Bedrock correlation contract) -- the ToolExecutor
            # port's execute() signature doesn't even receive tool_use_id as an
            # input, so an executor's own result.tool_use_id is NEVER trusted for
            # this; always overridden with the id the model actually streamed.
            result = replace(result, tool_use_id=tool_id, content=cap_tool_output(result.content))
            results.append(result)

            # Phase 56-02 (RCNV-01): fail-open auto-collect write, fires ONLY for an
            # already-gated, non-error, ledger-eligible tool result -- never raises,
            # never blocks the round (see _write_source_ledger_entries).
            if (
                self._source_ledger is not None
                and result.is_error is False
                and tool_name in _LEDGER_ELIGIBLE_TOOL_NAMES
            ):
                await self._write_source_ledger_entries(
                    conversation_id=run.conversation_id,
                    importer_id=importer_id,
                    tool_name=tool_name,
                    tool_use_id=tool_id,
                    content=result.content,
                )

            result_part = build_tool_invocation_result_part(result, tool_name)
            state = replace(state, parts=(*state.parts, result_part))
            # ToolResultDelta (chat_provider.py) — modeled, never emitted until now
            # (LOOP-01): its fields feed the persisted tool_result run event.
            tool_result_delta = ToolResultDelta(
                tool_use_id=result.tool_use_id, content=result.content, is_error=result.is_error
            )
            events.append(
                await self._emit(
                    run.id,
                    "tool_result",
                    {
                        "tool_name": tool_name,
                        "id": tool_id,
                        "content": tool_result_delta.content,
                        "isError": tool_result_delta.is_error,
                    },
                )
            )
            # Phase 39 (TUI-01): non-persisted SSE mirror frame, same convention
            # as the server_tool_call mirror above -- identical `data` shape to
            # the persisted tool_result event (byte-identical mirror, per
            # 39-UI-SPEC.md), so the client can build the SAME
            # tool_invocation_result part client-side without a "flash" on
            # terminal chat.getHistory refetch.
            events.append(
                ChatRunEvent(
                    type="server_tool_result",
                    data={
                        "tool_name": tool_name,
                        "id": tool_id,
                        "content": tool_result_delta.content,
                        "isError": tool_result_delta.is_error,
                    },
                )
            )

        # T-34-01: a round is the same spend commitment as continuing to
        # stream — re-check the breaker at the round boundary. COST-05
        # (Phase 35): ALSO re-check the round-scoped ceiling here — either
        # the per-turn OR the per-round cap tripping aborts the turn.
        if self._breaker.should_abort(
            self._estimated_cost_so_far(model=model, state=state)
        ) or self._breaker.should_abort_round(
            self._estimated_round_cost_so_far(
                model=model,
                state=state,
                round_start_output_tokens=round_start_output_tokens,
                round_start_text_len=round_start_text_len,
            )
        ):
            return _ServerRoundResult(state=state, events=tuple(events), provider_messages=None)

        tool_use_blocks = [
            {"type": "tool_use", "id": call["id"], "name": call["name"], "input": call["arguments"]} for call in calls
        ]
        # this_round_lead_parts are CANONICAL parts (text | genui_spec |
        # interactive_widget ...), not Anthropic content blocks — a genui_spec
        # finalized before this server-tool call in the same stream would 400
        # the next round ("Input tag 'genui_spec' ... does not match") if
        # replayed raw. Same conversion as history replay.
        lead_blocks = _provider_content_blocks(this_round_lead_parts)
        results_message = build_synthetic_tool_results_message(results)
        if is_last_round:
            results_message = {
                **results_message,
                "content": [*results_message["content"], {"type": "text", "text": FINAL_ROUND_NUDGE_TEXT}],
            }
        next_provider_messages = [
            *provider_messages,
            {"role": "assistant", "content": [*lead_blocks, *tool_use_blocks]},
            results_message,
        ]
        return _ServerRoundResult(state=state, events=tuple(events), provider_messages=next_provider_messages)
