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
emit_proposal_cards, also injected via the constructor -- same layering
rationale) are offered alongside emit_ui_spec to genui-capable models. A
completed interactive-widget tool call finalizes into an `interactive_widget`
part instead of a genui_spec part (run_chat_turn_widgets.py owns the pure
parse/derive logic); after the assistant message is persisted, exactly one
pending chat_widget_interactions row is created for it via the injected
ChatWidgetInteractionRepository (D-04: at most one pending widget per turn).
Both new constructor parameters default to falsy values so existing callers
are unaffected (additive).

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
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.application.use_cases.run_chat_turn_widgets import (
    INTERACTIVE_WIDGET_TOOL_NAMES,
    build_interactive_widget_part,
    content_block_stand_in,
    derive_declared_response_schema,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta, UsageDelta
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
from app.domain.ports.chat_widget_interaction_repository import ChatWidgetInteractionRepository, WidgetKind
from app.domain.ports.cost_ledger_repository import CostLedgerRepository, UsageEvent
from app.domain.services.chat_model_registry import ChatModel, get_model
from app.domain.services.chat_provider_router import ChatModelNotFoundError, ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker, estimate_prompt_tokens

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator, Sequence

    from app.domain.ports.chat_provider import ChatDelta, ChatProvider

logger = structlog.get_logger(__name__)

# SEAM-04: one agent, one run per turn today.
_AGENT_ID = "chat-agent-v1"

# D-01: minimal neutral persona — no product identity yet.
_SYSTEM_PROMPT = (
    "You are a helpful, neutral AI assistant. Respond clearly and concisely to the user's requests."
)

_TITLE_SNIPPET_MAX_LEN = 60


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

        The caller (SubmitWidgetInteraction) has ALREADY inserted the
        interaction_result user turn BEFORE calling this method — active
        context read here includes it, so this reuses the SAME `_execute_turn`
        engine as run()/regenerate() (same cost breaker, same SSE event shape,
        same terminal-branch persistence) without duplicating the streaming
        loop. turn_index matches the just-inserted interaction_result turn's
        own index (it is the newest active message); sibling_group_id is a
        fresh id — this is a brand-new assistant turn, not a regenerate of an
        existing one.
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

        # D-05: emit_ui_spec (+ Phase 24-02 interactive_widget_tools, e.g.
        # emit_proposal_cards) is offered ONLY to genui-capable models; a
        # text-only model never even sees a tool exists (D-02/D-03).
        tools: tuple[dict[str, Any], ...] = (
            (self._emit_ui_spec_tool, *self._interactive_widget_tools) if model.capabilities.genui else ()
        )

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
        state = _TurnState()
        try:
            async with contextlib.aclosing(raw_stream) as delta_stream:
                async for delta in delta_stream:
                    state, events = _apply_delta(delta, state)
                    for event_type, event_data in events:
                        yield await self._emit(run.id, event_type, event_data)

                    terminal_status = self._terminal_status_for(delta, model=model, state=state)
                    if terminal_status is not None:
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
        except Exception:
            async for event in self._terminate(
                run=run,
                conversation_id=conversation_id,
                turn_index=turn_index,
                state=state,
                status="failed",
                model=model,
                importer_id=importer_id,
                sibling_group_id=sibling_group_id,
                version=version,
            ):
                yield event
            return

        # Completed normally — the last delta was a StreamEnd with a non-error stop_reason.
        # Finalize any pending emit_ui_spec call HERE so its tool_result event
        # reaches the client (persist's own _finalize_state would silently
        # swallow it — found live 2026-07-04: spec persisted but no tool_result
        # streamed, leaving the client's live view stuck on "streaming").
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

        if is_first_turn:
            await self._conversations.touch(
                conversation_id=conversation_id, model_id=model_id, title=_title_snippet(user_text)
            )
        else:
            await self._conversations.touch(conversation_id=conversation_id, model_id=model_id)

    def _terminal_status_for(
        self,
        delta: ChatDelta,
        *,
        model: ChatModel,
        state: _TurnState,
    ) -> ChatMessageStatus | None:
        """Return the terminal status this delta forces, or None to keep streaming.

        A StreamEnd(error) always fails the turn (D-19). A TextDelta/UsageDelta
        that pushes the (estimated, then real) running cost past should_abort's
        threshold cost-caps the turn mid-stream (D-21).
        """
        if isinstance(delta, StreamEnd) and delta.stop_reason == "error":
            return "failed"
        if isinstance(delta, TextDelta):
            estimated_cost = self._estimated_cost_so_far(model=model, state=state)
            if self._breaker.should_abort(estimated_cost):
                return "cost_capped"
        elif isinstance(delta, UsageDelta):
            real_cost = self._breaker.estimate_turn_cost(
                model=model, prompt_tokens_est=state.input_tokens, max_output_tokens=state.output_tokens
            )
            if self._breaker.should_abort(real_cost):
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
        await self._create_pending_widget_interaction(
            conversation_id=conversation_id,
            message=message,
            turn_index=turn_index,
            sibling_group_id=sibling_group_id,
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

    async def _create_pending_widget_interaction(
        self,
        *,
        conversation_id: str,
        message: ChatMessage,
        turn_index: int,
        sibling_group_id: str,
    ) -> None:
        """Create the one pending chat_widget_interactions row for message's interactive_widget part.

        D-04: at most one pending interactive widget per turn — the first (and
        only) interactive_widget part found is used. A no-op when no widget
        repository is configured (additive/back-compat default) or the message
        carries no interactive_widget part.
        """
        if self._widget_interactions is None:
            return
        for part_index, part in enumerate(message.parts):
            if part.get("type") != "interactive_widget":
                continue
            widget_kind = cast("WidgetKind", part["widgetKind"])
            declaration = part["declaration"]
            declared_response_schema = derive_declared_response_schema(widget_kind, declaration)
            await self._widget_interactions.create_pending(
                interaction_id=part["interactionId"],
                conversation_id=conversation_id,
                message_id=message.id,
                part_index=part_index,
                turn_index=turn_index,
                widget_kind=widget_kind,
                declaration=declaration,
                declared_response_schema=declared_response_schema,
                sibling_group_id=sibling_group_id,
            )
            return

    def _estimated_cost_so_far(self, *, model: ChatModel, state: _TurnState) -> Decimal:
        """Cheap running-cost ESTIMATE from accumulated output length (mid-stream abort signal).

        Real cost is always recorded post-turn from actual captured usage
        (D-22); this heuristic exists solely to decide whether to keep
        streaming, mirroring the pre-turn estimate's own heuristic contract.
        """
        tokens_so_far = estimate_prompt_tokens(len(_accumulated_text_for_estimate(state)))
        return self._breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)

    async def _emit(self, run_id: str, event_type: ChatRunEventType, data: dict[str, Any]) -> ChatRunEvent:
        """Persist one run event (append-only) and return it for the caller to yield."""
        return await self._runs.append_event(run_id=run_id, event_type=event_type, data=data)


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
    UsageDelta: records the real captured token counts; no part/event change.
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
        state = replace(state, input_tokens=delta.input_tokens, output_tokens=delta.output_tokens)
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
    into a genui_spec part, stored verbatim (no schema validation/fallback here
    — that gate is the web boundary, FOUND-6). Phase 24-02 interactive-widget
    tools (e.g. emit_proposal_cards) finalize into an `interactive_widget` part
    instead (run_chat_turn_widgets.py owns the parse logic) — NEVER both for
    the same tool call. A tool call whose JSON never parses, or whose parsed
    shape is unusable (e.g. cut off mid-stream by a mid-turn abort/cancellation),
    is dropped rather than persisting a malformed/invalid part.
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
            return cleared, None
        finalized = replace(cleared, parts=(*cleared.parts, widget_part))
        return finalized, (
            "tool_result",
            {"tool_name": tool_name, "id": tool_id, "interactionId": widget_part["interactionId"]},
        )

    try:
        spec: dict[str, Any] = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("emit_ui_spec_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
        return cleared, None
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

    Plain 'text' parts are already Anthropic-shaped and pass through verbatim. A
    'genui_spec' part (D-02 emit_ui_spec, Phase 22-07) is NOT itself a valid
    Anthropic content block — replaying it as a bare tool_use block without a
    paired tool_result would violate the API's block-alternation contract. It is
    replayed as a compact text stand-in instead so history resent to the
    provider stays well-formed. Phase 24-02: 'interactive_widget'/'interaction_result'
    parts get the same compact-text-stand-in treatment (run_chat_turn_widgets.py's
    content_block_stand_in) — full tool_use/tool_result replay is not attempted for
    any of these shapes (ToolResultDelta is reserved for a future replay design).
    """
    blocks: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "genui_spec":
            spec_json = json.dumps(part.get("spec", {}), ensure_ascii=False)
            blocks.append({"type": "text", "text": f"[emitted UI spec: {spec_json}]"})
        elif part_type in ("interactive_widget", "interaction_result"):
            blocks.append(content_block_stand_in(part))
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
