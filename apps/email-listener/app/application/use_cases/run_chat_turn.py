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

from app.application.use_cases.run_chat_turn_confirm_action import (
    CONFIRM_ACTION_UNAVAILABLE_TEXT,
    EMIT_CONFIRM_ACTION_TOOL_NAME,
    build_confirm_action_declaration,
    parse_confirm_action_call,
)
from app.application.use_cases.run_chat_turn_tool_loop import (
    PARSE_FAILURE_TEXT,
    ROUND_CAP_EXHAUSTED_TEXT,
    build_synthetic_tool_result_message,
    build_tool_invocation_part,
    build_tool_invocation_result_part,
    cap_tool_output,
    classify_tool_dispatch,
)
from app.application.use_cases.run_chat_turn_widgets import (
    INTERACTIVE_WIDGET_TOOL_NAMES,
    build_create_pending_kwargs,
    build_interactive_widget_part,
    content_block_stand_in,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta, ToolResultDelta, UsageDelta
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
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.chat_model_registry import ChatModel, get_model
from app.domain.services.chat_provider_router import ChatModelNotFoundError, ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker, estimate_prompt_tokens

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator, Mapping, Sequence

    from app.domain.ports.chat_provider import ChatDelta, ChatProvider
    from app.domain.ports.tool_executor import ToolExecutor

logger = structlog.get_logger(__name__)

# SEAM-04: one agent, one run per turn today.
_AGENT_ID = "chat-agent-v1"

# D-01: minimal neutral persona — no product identity yet.
_SYSTEM_PROMPT = (
    "You are a helpful, neutral AI assistant. Respond clearly and concisely to the user's requests."
)

_TITLE_SNIPPET_MAX_LEN = 60

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
_TOOL_TIMEOUT_TEXT = "Tool execution timed out."
_TOOL_EXECUTION_ERROR_TEXT = "Tool execution failed."


@dataclass(frozen=True)
class _TurnState:
    """Immutable accumulator folded across a turn's streamed deltas (Phase 22-07, D-18).

    parts: FINALIZED interleaved content parts, in emission order (text | genui_spec).
    text_buffer: text accumulated since the last flush point (not yet a part).
    pending_tool_name/pending_tool_id/pending_tool_json: an in-flight emit_ui_spec
        tool call's partial JSON, accumulated across ToolCallDelta chunks sharing
        the same id, until a different delta type/id finalizes it into a part.
    """

    parts: tuple[dict[str, Any], ...] = ()
    text_buffer: str = ""
    pending_tool_name: str | None = None
    pending_tool_id: str | None = None
    pending_tool_json: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


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
            if m.turn_index < target.turn_index
            or (m.turn_index == target.turn_index and m.role == "user")
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
                    tools=tools,
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
        state, confirm_action_event = await self._finalize_confirm_action(state, importer_id=importer_id)
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
        yield await self._emit(run.id, "usage", {"input_tokens": state.input_tokens, "output_tokens": state.output_tokens})
        yield await self._emit(run.id, "completed", {})

        title = _title_snippet(user_text) if is_first_turn else None
        await self._conversations.touch(conversation_id=conversation_id, model_id=model_id, title=title)

    async def _finalize_confirm_action(
        self, state: _TurnState, *, importer_id: str
    ) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
        """Finalize a still-pending emit_confirm_action call via a LIVE edge re-read (CONF-01).

        No-op (`state, None`) unless the pending tool is emit_confirm_action —
        every other pending tool name falls through unchanged to the caller's
        subsequent `_finalize_pending_tool(state)` call.

        Clears pending_tool_* EAGERLY on every branch below (parse-fail,
        edge-unavailable, success) — this is what makes it safe to run this
        live-I/O check from `_finalize_turn_completed` (the only async site
        with `self`) while `_finalize_pending_tool` itself stays pure: by the
        time that pure function runs next, pending_tool_id is already None,
        so it is provably a no-op for this tool.

        A malformed call (T-40-04) never reaches the knowledge_graph lookup at
        all — `self._knowledge_graph.find_edge_by_id` is only ever called for
        a structurally-valid parsed call. Edge-not-found, cross-importer,
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
        finalized = _finalize_state(state)
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
                system=_SYSTEM_PROMPT,
                messages=provider_messages,
                tools=tools,
                max_tokens=self._max_output_tokens,
            ),
        )
        async with contextlib.aclosing(raw_stream) as delta_stream:
            async for delta in delta_stream:
                state, events = _apply_delta(delta, state)
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
        """Classify the round's finalized pending tool call (if any) and advance.

        See `_RoundAdvance`'s docstring for the three outcomes. This is the
        Phase 34-03 (LOOP-01/LOOP-02/LOOP-03/T-34-01) dispatch point: no
        pending tool call, a non-server dispatch (widget/emit_ui_spec/
        unknown), a round-cap exhaustion, or a malformed server-tool call are
        all terminal ("break") -- unchanged behavior for the first two, LOOP-
        03/LOOP-02 visible text for the latter two. A well-formed server-tool
        call executes via `_run_server_tool_round`, then either continues the
        SAME run with a new round ("continue") or, if the post-round breaker
        re-check trips (T-34-01, now also checking the COST-05/Phase 35
        per-round ceiling implemented in `_run_server_tool_round`), persists
        + terminates 'cost_capped' HERE and returns "terminal".
        """
        if state.pending_tool_id is None:
            # No tool call at all this round — plain text turn (unchanged).
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        # Captured immediately after the guard above (before any `state =
        # replace(...)` reassignment below) so mypy narrows tool_id: str once,
        # cleanly — a repeated `state.pending_tool_id` attribute read further
        # down loses that narrowing the instant `state` is reassigned anywhere
        # in this function's control flow.
        tool_name = state.pending_tool_name or ""
        tool_id: str = state.pending_tool_id
        raw_json = state.pending_tool_json

        dispatch = classify_tool_dispatch(tool_name, self._server_tool_names)
        if dispatch != "server":
            # widget / emit_ui_spec / unknown — terminal, unchanged behavior:
            # _finalize_pending_tool (after the loop) does the finalization.
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        if round_count >= _MAX_TOOL_ROUNDS:
            # LOOP-03: the model STILL wants a server tool after the cap —
            # fail closed with a visible text part, never a bare stopped
            # state, and never a 5th tool execution.
            state = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")
            state = replace(state, parts=(*state.parts, {"type": "text", "text": ROUND_CAP_EXHAUSTED_TEXT}))
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        this_round_lead_parts = list(state.parts[round_start_part_count:])
        state = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")

        try:
            arguments: dict[str, Any] = json.loads(raw_json) if raw_json else {}
        except (json.JSONDecodeError, TypeError):
            # LOOP-02 (server-path fix): never silently drop a malformed
            # server-tool call — surface the same visible text as the
            # existing widget/emit_ui_spec parse-failure paths.
            logger.warning("server_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
            state = replace(state, parts=(*state.parts, {"type": "text", "text": PARSE_FAILURE_TEXT}))
            return _RoundAdvance(state=state, events=(), outcome="break", provider_messages=provider_messages)

        round_result = await self._run_server_tool_round(
            run=run,
            state=state,
            model=model,
            tool_name=tool_name,
            tool_id=tool_id,
            arguments=arguments,
            this_round_lead_parts=this_round_lead_parts,
            provider_messages=provider_messages,
            round_start_output_tokens=round_start_output_tokens,
            round_start_text_len=round_start_text_len,
            importer_id=importer_id,
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

    async def _run_server_tool_round(
        self,
        *,
        run: ChatRun,
        state: _TurnState,
        model: ChatModel,
        tool_name: str,
        tool_id: str,
        arguments: dict[str, Any],
        this_round_lead_parts: list[dict[str, Any]],
        provider_messages: list[dict[str, Any]],
        round_start_output_tokens: int,
        round_start_text_len: int,
        importer_id: str,
    ) -> _ServerRoundResult:
        """Execute one server-tool round (Phase 34-03, LOOP-01): dispatch, cap, feed back.

        A per-tool timeout (`asyncio.wait_for`, ~10s, T-34-01) or ANY raised
        exception NEVER escapes this method — both become an `is_error`
        `ToolExecutionResult` (port contract, `tool_executor.py`). The
        `tool_invocation`/`tool_invocation_result` parts and the `tool_call`/
        `tool_result` run events are always recorded, whatever the outcome.
        """
        events: list[ChatRunEvent] = []
        invocation_part = build_tool_invocation_part(tool_name, tool_id, arguments)
        state = replace(state, parts=(*state.parts, invocation_part))
        events.append(
            await self._emit(run.id, "tool_call", {"tool_name": tool_name, "id": tool_id, "arguments": arguments})
        )

        executor = self._tool_executors[tool_name]
        try:
            result = await asyncio.wait_for(
                executor.execute(name=tool_name, arguments=arguments, importer_id=importer_id),
                timeout=_TOOL_EXECUTION_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            logger.warning("server_tool_execution_timed_out", tool_id=tool_id, tool_name=tool_name)
            result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_TIMEOUT_TEXT, is_error=True)
        except Exception:  # an executor MUST NEVER raise out of the loop (port contract)
            logger.warning("server_tool_execution_failed", tool_id=tool_id, tool_name=tool_name)
            result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_EXECUTION_ERROR_TEXT, is_error=True)

        # T-34-04 defense-in-depth / protocol correctness: the fed-back native
        # tool_result block's tool_use_id MUST match the tool_use block's id
        # exactly (Anthropic/Bedrock correlation contract) -- the ToolExecutor
        # port's execute() signature doesn't even receive tool_use_id as an
        # input, so an executor's own result.tool_use_id is NEVER trusted for
        # this; always overridden with the id the model actually streamed.
        result = replace(result, tool_use_id=tool_id, content=cap_tool_output(result.content))
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

        tool_use_block = {"type": "tool_use", "id": tool_id, "name": tool_name, "input": arguments}
        next_provider_messages = [
            *provider_messages,
            {"role": "assistant", "content": [*this_round_lead_parts, tool_use_block]},
            build_synthetic_tool_result_message(result),
        ]
        return _ServerRoundResult(state=state, events=tuple(events), provider_messages=next_provider_messages)


def _apply_delta(
    delta: ChatDelta,
    state: _TurnState,
) -> tuple[_TurnState, list[tuple[ChatRunEventType, dict[str, Any]]]]:
    """Fold one provider delta into the running turn state (pure, no I/O).

    TextDelta: finalizes any in-flight emit_ui_spec tool call first (D-18
    interleaving order), then buffers the text and emits a
    text_delta_checkpoint event.
    ToolCallDelta: flushes any buffered text before STARTING a new tool call
    (or finalizes a DIFFERENT prior tool call before starting this one), then
    accumulates this chunk's partial_json and emits a tool_call event so the
    client can render the partial tree progressively (STREAM-02).
    UsageDelta: records the real captured token counts, ACCUMULATING across
    multiple UsageDelta events (a multi-round turn emits one per round,
    LOOP-02 bugfix — the prior overwrite silently under-reported cost the
    moment a turn spans more than one round); no part/event change.
    A non-error StreamEnd needs no mid-loop handling (D-03/22-06 precedent).
    """
    if isinstance(delta, TextDelta):
        events: list[tuple[ChatRunEventType, dict[str, Any]]] = []
        if state.pending_tool_id is not None:
            state, tool_result_event = _finalize_pending_tool(state)
            if tool_result_event is not None:
                events.append(tool_result_event)
        state = replace(state, text_buffer=state.text_buffer + delta.text)
        events.append(("text_delta_checkpoint", {"text": delta.text}))
        return state, events

    if isinstance(delta, ToolCallDelta):
        events = []
        if state.pending_tool_id is not None and state.pending_tool_id != delta.id:
            state, tool_result_event = _finalize_pending_tool(state)
            if tool_result_event is not None:
                events.append(tool_result_event)
        if state.pending_tool_id is None:
            state = _flush_text_buffer(state)
            state = replace(state, pending_tool_name=delta.tool_name, pending_tool_id=delta.id, pending_tool_json="")
        state = replace(state, pending_tool_json=state.pending_tool_json + delta.partial_json)
        events.append(("tool_call", {"tool_name": delta.tool_name, "id": delta.id, "partial_json": delta.partial_json}))
        return state, events

    if isinstance(delta, UsageDelta):
        state = replace(
            state,
            input_tokens=state.input_tokens + delta.input_tokens,
            output_tokens=state.output_tokens + delta.output_tokens,
        )
        return state, []

    return state, []


def _flush_text_buffer(state: _TurnState) -> _TurnState:
    """Flush any buffered text into a finalized text part (order-preserving, D-18)."""
    if not state.text_buffer:
        return state
    return replace(state, parts=(*state.parts, {"type": "text", "text": state.text_buffer}), text_buffer="")


def _finalize_pending_tool(
    state: _TurnState,
) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
    """Parse an in-flight tool call's accumulated JSON into its finalized part.

    emit_ui_spec (or any tool NOT in INTERACTIVE_WIDGET_TOOL_NAMES) finalizes
    into a genui_spec part, stored verbatim (no validation/fallback -- that
    gate is the web boundary, FOUND-6). Phase 24-02 interactive-widget tools
    (e.g. emit_proposal_cards) finalize into an `interactive_widget` part
    instead (run_chat_turn_widgets.py owns the parse logic) -- never both. A
    tool call whose JSON never parses, or whose shape is unusable (e.g. cut
    off mid-stream), NEVER persists an invalid part and NEVER drops silently
    (LOOP-02 bugfix) -- it appends a visible PARSE_FAILURE_TEXT text part so
    the user sees the lookup failed, while the server-side logger.warning
    detail is retained.
    """
    if state.pending_tool_id is None:
        return state, None
    tool_name = state.pending_tool_name or ""
    tool_id = state.pending_tool_id
    raw_json = state.pending_tool_json
    cleared = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")

    if tool_name in INTERACTIVE_WIDGET_TOOL_NAMES:
        widget_part = build_interactive_widget_part(tool_name, raw_json)
        if widget_part is None:
            logger.warning("interactive_widget_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
            return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None
        finalized = replace(cleared, parts=(*cleared.parts, widget_part))
        return finalized, (
            "tool_result",
            {"tool_name": tool_name, "id": tool_id, "interactionId": widget_part["interactionId"]},
        )

    try:
        spec: dict[str, Any] = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("emit_ui_spec_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
        return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None
    finalized = replace(cleared, parts=(*cleared.parts, {"type": "genui_spec", "spec": spec}))
    return finalized, ("tool_result", {"tool_name": tool_name, "id": tool_id, "spec": spec})


def _finalize_state(state: _TurnState) -> _TurnState:
    """Flush any remaining buffered text/pending tool call into parts (never dropped, D-15)."""
    state, _tool_result_event = _finalize_pending_tool(state)
    return _flush_text_buffer(state)


def _accumulated_text_for_estimate(state: _TurnState) -> str:
    """Cheap text-length signal for the mid-stream cost estimate (D-21 heuristic).

    Sums already-finalized text parts plus the current buffer; tool-call JSON
    length is intentionally excluded (the heuristic tracks assistant PROSE
    output, mirroring the pre-22-07 accumulated_text estimate).
    """
    finalized_text = "".join(part["text"] for part in state.parts if part.get("type") == "text")
    return finalized_text + state.text_buffer


def _build_provider_messages(history: Sequence[ChatMessage]) -> list[dict[str, Any]]:
    """Anthropic-shaped {role, content} dicts from active-sibling ChatMessage rows (FOUND-1)."""
    return [
        {"role": message.role, "content": _provider_content_blocks(message.parts)}
        for message in history
        if message.role in ("user", "assistant")
    ]


def _provider_content_blocks(parts: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert canonical typed parts into Anthropic-shaped content blocks for replay.

    Plain 'text' parts pass through verbatim. 'genui_spec' (D-02, Phase 22-07)
    is NOT a valid Anthropic content block on its own -- replaying it bare
    would violate the API's block-alternation contract, so it becomes a
    compact text stand-in instead. Phase 24-02: 'interactive_widget'/
    'interaction_result' get the same treatment (run_chat_turn_widgets.py's
    content_block_stand_in). Phase 34-03 (LOOP-01): 'tool_invocation'/
    'tool_invocation_result' (a PRIOR turn's persisted server-tool round) get
    the same text stand-in treatment for the same reason -- a bare
    tool_use/tool_result pair replayed here (outside the SAME turn's native
    in-round messages built by _execute_turn's round loop) would violate the
    API's block-alternation contract. Full tool_use/tool_result replay is not
    attempted for any of these shapes.
    """
    blocks: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "genui_spec":
            spec_json = json.dumps(part.get("spec", {}), ensure_ascii=False)
            blocks.append({"type": "text", "text": f"[emitted UI spec: {spec_json}]"})
        elif part_type in ("interactive_widget", "interaction_result"):
            blocks.append(content_block_stand_in(part))
        elif part_type == "tool_invocation":
            args_json = json.dumps(part.get("arguments", {}), ensure_ascii=False)
            blocks.append({"type": "text", "text": f"[dispatched tool {part.get('toolName')}: {args_json}]"})
        elif part_type == "tool_invocation_result":
            blocks.append(
                {"type": "text", "text": f"[tool {part.get('toolName')} result: {part.get('content', '')}]"}
            )
        else:
            blocks.append(part)
    return blocks


def _estimate_message_tokens(message: ChatMessage) -> int:
    serialized = json.dumps(list(message.parts), ensure_ascii=False)
    return estimate_prompt_tokens(len(serialized))


def _trim_history_to_budget(history: Sequence[ChatMessage], *, context_tokens: int) -> list[ChatMessage]:
    """Keep the most recent messages that fit context_tokens, recent-first (D-26).

    Always keeps at least the single most recent message, even if it alone
    exceeds the budget — a caller should never end up with an empty history
    just because one message is large.
    """
    kept: list[ChatMessage] = []
    budget = context_tokens
    for message in reversed(history):
        cost = _estimate_message_tokens(message)
        if kept and cost > budget:
            break
        kept.append(message)
        budget -= cost
    kept.reverse()
    return kept


def _title_snippet(user_text: str, *, max_len: int = _TITLE_SNIPPET_MAX_LEN) -> str:
    """Deterministic truncated first-message snippet for the conversation title (D-12).

    No LLM call — whitespace-collapsed, hard-truncated at max_len with an
    ellipsis when the source text is longer. Falls back to a neutral default
    for empty/whitespace-only text (defence-in-depth).
    """
    collapsed = " ".join(user_text.split())
    if not collapsed:
        return "Untitled conversation"
    if len(collapsed) <= max_len:
        return collapsed
    return collapsed[: max_len - 1].rstrip() + "…"
