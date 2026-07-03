"""RunChatTurn — the chat agent/run orchestration loop (SEAM-04, SEAM-03, Phase 22-06).

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
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
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
from app.domain.ports.cost_ledger_repository import CostLedgerRepository, UsageEvent
from app.domain.services.chat_model_registry import ChatModel, get_model
from app.domain.services.chat_provider_router import ChatModelNotFoundError, ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker, estimate_prompt_tokens

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator, Sequence

    from app.domain.ports.chat_provider import ChatDelta, ChatProvider

# SEAM-04: one agent, one run per turn today.
_AGENT_ID = "chat-agent-v1"

# D-01: minimal neutral persona — no product identity yet.
_SYSTEM_PROMPT = (
    "You are a helpful, neutral AI assistant. Respond clearly and concisely to the user's requests."
)

_TITLE_SNIPPET_MAX_LEN = 60


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
        default_importer_id: str,
        max_output_tokens: int = 4096,
    ) -> None:
        self._messages = messages
        self._runs = runs
        self._conversations = conversations
        self._router = router
        self._breaker = breaker
        self._ledger = ledger
        self._default_importer_id = default_importer_id
        self._max_output_tokens = max_output_tokens

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

        await self._messages.insert_message(
            conversation_id=conversation_id,
            role="user",
            parts=({"type": "text", "text": user_text},),
            turn_index=turn_index,
            status="completed",
        )

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
        prior_history = [m for m in history if m.turn_index < target.turn_index]
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

        accumulated_text = ""
        input_tokens = 0
        output_tokens = 0

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
                tools=(),
                max_tokens=self._max_output_tokens,
            ),
        )
        try:
            async with contextlib.aclosing(raw_stream) as delta_stream:
                async for delta in delta_stream:
                    accumulated_text, input_tokens, output_tokens, event_type, event_data = _apply_delta(
                        delta, accumulated_text=accumulated_text, input_tokens=input_tokens, output_tokens=output_tokens
                    )
                    if event_type is not None:
                        yield await self._emit(run.id, event_type, event_data)

                    terminal_status = self._terminal_status_for(
                        delta,
                        model=model,
                        accumulated_text=accumulated_text,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                    )
                    if terminal_status is not None:
                        async for event in self._terminate(
                            run=run,
                            conversation_id=conversation_id,
                            turn_index=turn_index,
                            accumulated_text=accumulated_text,
                            status=terminal_status,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
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
                accumulated_text=accumulated_text,
                status="stopped",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
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
                accumulated_text=accumulated_text,
                status="failed",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model,
                importer_id=importer_id,
                sibling_group_id=sibling_group_id,
                version=version,
            ):
                yield event
            return

        # Completed normally — the last delta was a StreamEnd with a non-error stop_reason.
        await self._persist_and_finish(
            run=run,
            conversation_id=conversation_id,
            turn_index=turn_index,
            accumulated_text=accumulated_text,
            status="completed",
            run_status="completed",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            importer_id=importer_id,
            sibling_group_id=sibling_group_id,
            version=version,
        )
        yield await self._emit(run.id, "usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})
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
        accumulated_text: str,
        input_tokens: int,
        output_tokens: int,
    ) -> ChatMessageStatus | None:
        """Return the terminal status this delta forces, or None to keep streaming.

        A StreamEnd(error) always fails the turn (D-19). A TextDelta/UsageDelta
        that pushes the (estimated, then real) running cost past should_abort's
        threshold cost-caps the turn mid-stream (D-21).
        """
        if isinstance(delta, StreamEnd) and delta.stop_reason == "error":
            return "failed"
        if isinstance(delta, TextDelta):
            estimated_cost = self._estimated_cost_so_far(model=model, accumulated_text=accumulated_text)
            if self._breaker.should_abort(estimated_cost):
                return "cost_capped"
        elif isinstance(delta, UsageDelta):
            real_cost = self._breaker.estimate_turn_cost(
                model=model, prompt_tokens_est=input_tokens, max_output_tokens=output_tokens
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
        accumulated_text: str,
        status: ChatMessageStatus,
        input_tokens: int,
        output_tokens: int,
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
            accumulated_text=accumulated_text,
            status=status,
            run_status=run_status,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
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
        accumulated_text: str,
        status: ChatMessageStatus,
        run_status: ChatRunStatus,
        input_tokens: int,
        output_tokens: int,
        model: ChatModel,
        importer_id: str,
        sibling_group_id: str,
        version: int,
    ) -> None:
        """Persist the assistant message (whatever streamed so far) + record usage + finish the run.

        Called for EVERY terminal branch (completed/cost_capped/stopped/failed)
        so a partial is never silently dropped (D-15) and the ledger always
        gets whatever usage was captured — even Decimal("0")/0 tokens when the
        stream never reached a UsageDelta (D-21 mid-stream / T-22-22).
        """
        parts = ({"type": "text", "text": accumulated_text},) if accumulated_text else ()
        await self._messages.insert_message(
            conversation_id=conversation_id,
            role="assistant",
            parts=parts,
            turn_index=turn_index,
            status=status,
            run_id=run.id,
            sibling_group_id=sibling_group_id,
            version=version,
            is_active=True,
        )
        cost = self._breaker.estimate_turn_cost(
            model=model, prompt_tokens_est=input_tokens, max_output_tokens=output_tokens
        )
        await self._ledger.record(
            UsageEvent(
                importer_id=importer_id,
                model_id=model.id,
                execution_locus=model.execution_locus,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost,
                conversation_id=conversation_id,
                run_id=run.id,
            )
        )
        await self._runs.finish_run(run_id=run.id, status=run_status)

    def _estimated_cost_so_far(self, *, model: ChatModel, accumulated_text: str) -> Decimal:
        """Cheap running-cost ESTIMATE from accumulated output length (mid-stream abort signal).

        Real cost is always recorded post-turn from actual captured usage
        (D-22); this heuristic exists solely to decide whether to keep
        streaming, mirroring the pre-turn estimate's own heuristic contract.
        """
        tokens_so_far = estimate_prompt_tokens(len(accumulated_text))
        return self._breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)

    async def _emit(self, run_id: str, event_type: ChatRunEventType, data: dict[str, Any]) -> ChatRunEvent:
        """Persist one run event (append-only) and return it for the caller to yield."""
        return await self._runs.append_event(run_id=run_id, event_type=event_type, data=data)


def _apply_delta(
    delta: ChatDelta,
    *,
    accumulated_text: str,
    input_tokens: int,
    output_tokens: int,
) -> tuple[str, int, int, ChatRunEventType | None, dict[str, Any]]:
    """Fold one provider delta into the running turn state (pure, no I/O).

    Returns (new_accumulated_text, new_input_tokens, new_output_tokens,
    checkpoint_event_type_or_None, checkpoint_data). ToolCallDelta and a
    non-error StreamEnd are no-ops here (D-03: no data tools in 22-06; a
    non-error StreamEnd needs no mid-loop handling — the stream simply ends).
    """
    if isinstance(delta, TextDelta):
        return accumulated_text + delta.text, input_tokens, output_tokens, "text_delta_checkpoint", {"text": delta.text}
    if isinstance(delta, UsageDelta):
        return accumulated_text, delta.input_tokens, delta.output_tokens, None, {}
    return accumulated_text, input_tokens, output_tokens, None, {}


def _build_provider_messages(history: Sequence[ChatMessage]) -> list[dict[str, Any]]:
    """Anthropic-shaped {role, content} dicts from active-sibling ChatMessage rows (FOUND-1)."""
    return [
        {"role": message.role, "content": list(message.parts)}
        for message in history
        if message.role in ("user", "assistant")
    ]


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
