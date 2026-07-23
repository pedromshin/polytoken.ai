"""Chat streaming endpoints — POST /v1/chat/stream + POST /v1/chat/regenerate (STREAM-01, D-24).

Thin FastAPI SSE transport wrapping RunChatTurn.run()/.regenerate() (Phase 22-06):
serializes each yielded ChatRunEvent as one `data: {json}` frame over
text/event-stream. A client disconnect cancels the underlying agent task so
RunChatTurn's own `except asyncio.CancelledError` handler persists the partial
as 'stopped' (D-15/D-25/T-22-27) — this transport never swallows the
cancellation into a fake 'completed'.

Security (T-22-24..T-22-28):
  - X-API-Key auth: require_api_key router dependency, fail-closed (401
    without a valid key; no stream body — dependencies run before the
    endpoint body).
  - Request bodies are Pydantic-validated (conversation_id/assistant_message_id
    must be UUIDs, user_text length-bounded).
  - The emit_ui_spec spec JSON is untrusted model output — passed through
    verbatim in run events; validated at the web boundary, not here (FOUND-6).

Tenancy (Phase 44-09, TENA-03 gap closure): both endpoints also require
X-User-Id (require_user_id) and assert the caller owns conversation_id
(assert_conversation_owned, 404 fail-closed) BEFORE constructing the
StreamingResponse. This placement is REQUIRED — run()/regenerate() are lazy
async generators whose bodies do not execute until the StreamingResponse
iterates them, so a check inside the use case would fire mid-stream, not
pre-stream. Mirrors emails.py's `_assert_importer_owned` disposition: 404
(never 403) so a non-owned conversation's existence is never disclosed.

Note: Intentionally omits 'from __future__ import annotations' — matches
genui.py/genui_code.py/chat_models.py (FastAPI/Pydantic v2 needs concrete
types at route registration time to build response serializers).
"""

import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncIterator

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_repositories import ChatConversationRepository, ChatRunEvent
from app.domain.ports.importer_resolver import ImporterResolver
from app.presentation.middleware.auth import require_api_key
from app.presentation.middleware.user_context import require_user_id

logger = structlog.get_logger(__name__)

router = APIRouter(
    prefix="/v1/chat",
    tags=["chat"],
    dependencies=[Depends(require_api_key)],
)

_USER_TEXT_MAX_LEN = 8_000
# How often stream_run_events checks request.is_disconnected() while waiting on
# the agent's next event. Short enough to detect a real disconnect quickly;
# long enough that it never fires during normal (much faster) event production.
_DISCONNECT_POLL_SECONDS = 0.1


def _require_uuid(value: str) -> str:
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise ValueError(f"{value!r} is not a valid UUID") from exc
    return value


async def assert_conversation_owned(
    conversations: ChatConversationRepository, user_id: str, conversation_id: str
) -> None:
    """Fail-closed ownership assertion (Phase 44-09, TENA-03 gap closure).

    404 (never 403) so a non-owned conversation's existence is never
    disclosed — the caller sees the identical response whether the
    conversation doesn't exist or belongs to another user. Mirrors
    emails.py's `_assert_importer_owned` exactly. MUST be awaited before any
    StreamingResponse is constructed — see module docstring.
    """
    owner = await conversations.owner_user_id(conversation_id)
    if owner is None or owner != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ChatStreamRequest(BaseModel):
    """Request body for POST /v1/chat/stream."""

    conversation_id: str = Field(..., description="UUID of the conversation this turn belongs to.")
    user_text: str = Field(..., min_length=1, max_length=_USER_TEXT_MAX_LEN)
    model_id: str = Field(..., min_length=1, description="Curated CHAT_MODEL_REGISTRY model id.")

    @field_validator("conversation_id")
    @classmethod
    def _validate_conversation_id(cls, v: str) -> str:
        return _require_uuid(v)


class ChatRegenerateRequest(BaseModel):
    """Request body for POST /v1/chat/regenerate."""

    conversation_id: str = Field(..., description="UUID of the conversation this turn belongs to.")
    assistant_message_id: str = Field(..., description="UUID of the assistant message to regenerate.")
    model_id: str = Field(..., min_length=1, description="Curated CHAT_MODEL_REGISTRY model id.")

    @field_validator("conversation_id", "assistant_message_id")
    @classmethod
    def _validate_ids(cls, v: str) -> str:
        return _require_uuid(v)


# ---------------------------------------------------------------------------
# SSE serialization + client-disconnect cancellation
# ---------------------------------------------------------------------------


def _format_sse_event(event: ChatRunEvent) -> str:
    """One SSE `data:` frame per run event (JSON-serialized)."""
    payload = json.dumps({"type": event.type, "seq": event.seq, "data": event.data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


async def stream_run_events(
    request: Request,
    events: AsyncIterator[ChatRunEvent],
) -> AsyncIterator[str]:
    """Serialize ChatRunEvents as SSE frames; cancel the run task on client disconnect.

    `events` is consumed via a background asyncio.Task so a detected disconnect
    can `task.cancel()` it — this raises CancelledError INSIDE the agent's
    current await point, which RunChatTurn._execute_turn's own
    `except asyncio.CancelledError` handler turns into a persisted 'stopped'
    partial (D-15/D-25/T-22-27). Simply closing the async generator (aclose())
    would raise GeneratorExit instead, which that handler does not catch —
    real task cancellation is required for the stopped-partial path to run.
    """
    pending: asyncio.Task[ChatRunEvent] = asyncio.ensure_future(events.__anext__())
    try:
        while True:
            done, _pending_set = await asyncio.wait({pending}, timeout=_DISCONNECT_POLL_SECONDS)
            if pending in done:
                try:
                    event = pending.result()
                except StopAsyncIteration:
                    return
                yield _format_sse_event(event)
                pending = asyncio.ensure_future(events.__anext__())
                continue
            if await request.is_disconnected():
                pending.cancel()
                with contextlib.suppress(BaseException):
                    await pending
                return
    finally:
        if not pending.done():
            pending.cancel()


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/stream")
@inject
async def stream_chat(
    body: ChatStreamRequest,
    request: Request,
    use_case: FromDishka[RunChatTurn],
    conversations: FromDishka[ChatConversationRepository],
    importer_repo: FromDishka[ImporterResolver],
    user_id: str = Depends(require_user_id),
) -> StreamingResponse:
    """Stream one chat turn's run events over text/event-stream (STREAM-01).

    Phase 44-09: rejects 401 (no X-User-Id) and 404 (non-owned
    conversation_id) BEFORE the stream opens — see module docstring.

    Chat-context fix: the caller's OWNED importer ids (resolved from the
    verified user_id, same primitive as emails.py/pipeline_health.py) are
    passed as `importer_ids` so the thread/cluster + linked-context email
    reads span every importer the caller owns — without this, RunChatTurn
    falls back to the DEFAULT importer and those reads silently return []
    (context blocks fail-open dropped).
    """
    await assert_conversation_owned(conversations, user_id, body.conversation_id)
    owned_importer_ids = await importer_repo.list_importer_ids_for_user(user_id)
    events = use_case.run(
        conversation_id=body.conversation_id,
        user_text=body.user_text,
        model_id=body.model_id,
        importer_ids=owned_importer_ids,
    )
    return StreamingResponse(
        stream_run_events(request, events),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/regenerate")
@inject
async def regenerate_chat(
    body: ChatRegenerateRequest,
    request: Request,
    use_case: FromDishka[RunChatTurn],
    conversations: FromDishka[ChatConversationRepository],
    importer_repo: FromDishka[ImporterResolver],
    user_id: str = Depends(require_user_id),
) -> StreamingResponse:
    """Stream a NEW sibling run regenerating an assistant turn (CHAT-04, D-16).

    Phase 44-09: rejects 401 (no X-User-Id) and 404 (non-owned
    conversation_id) BEFORE the stream opens — see module docstring.

    Chat-context fix: same owned-importer scoping as stream_chat above.
    """
    await assert_conversation_owned(conversations, user_id, body.conversation_id)
    owned_importer_ids = await importer_repo.list_importer_ids_for_user(user_id)
    events = use_case.regenerate(
        conversation_id=body.conversation_id,
        assistant_message_id=body.assistant_message_id,
        model_id=body.model_id,
        importer_ids=owned_importer_ids,
    )
    return StreamingResponse(
        stream_run_events(request, events),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
