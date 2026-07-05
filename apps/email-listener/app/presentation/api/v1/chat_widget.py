"""POST /v1/chat/widget/submit — the DCUI-03 widget round-trip submit endpoint.

Thin FastAPI SSE transport wrapping SubmitWidgetInteraction.prepare() (Phase
24-02): every non-resume outcome (WidgetSubmitRejected: not_found/stale/
invalid/conflict) is resolved and mapped to a plain JSON HTTPException BEFORE
any StreamingResponse is constructed — a rejection never surfaces mid-stream
(T-24-02/T-24-03). A successful prepare() returns the (unstarted) continuation
async iterator, which this endpoint frames identically to /v1/chat/stream by
reusing chat_stream.py's `stream_run_events` helper (same disconnect-
cancellation loop, same `data: {...}` SSE framing) — the streaming loop is
written once.

Security (T-24-02..T-24-05):
  - X-API-Key auth: require_api_key router dependency, fail-closed (401
    without a valid key; no stream body — dependencies run before the
    endpoint body).
  - Request body is Pydantic-validated (conversation_id/interaction_id must
    be UUIDs, model_id non-empty, result a JSON object).
  - The submitted `result` is untrusted client input — SubmitWidgetInteraction
    re-validates it against the STORED declared_response_schema (D-10) before
    ever touching the DB lock or model context (FOUND-6 boundary).

Note: Intentionally omits 'from __future__ import annotations' — matches
chat_stream.py/genui.py/chat_models.py (FastAPI/Pydantic v2 needs concrete
types at route registration time to build response serializers).
"""

import uuid
from typing import Any

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.application.use_cases.submit_widget_interaction import (
    SubmitWidgetInteraction,
    WidgetSubmitRejected,
    WidgetSubmitRejectionReason,
)
from app.presentation.api.v1.chat_stream import stream_run_events
from app.presentation.middleware.auth import require_api_key

router = APIRouter(
    prefix="/v1/chat",
    tags=["chat"],
    dependencies=[Depends(require_api_key)],
)

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

# Every WidgetSubmitRejected reason maps to exactly one pre-stream HTTP status
# code (DCUI-03's three enforced guarantees + T-24-04 ownership).
_REJECTION_STATUS: dict[WidgetSubmitRejectionReason, int] = {
    "not_found": 404,
    "stale": 409,
    "invalid": 422,
    "conflict": 409,
}


def _require_uuid(value: str) -> str:
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise ValueError(f"{value!r} is not a valid UUID") from exc
    return value


class ChatWidgetSubmitRequest(BaseModel):
    """Request body for POST /v1/chat/widget/submit."""

    conversation_id: str = Field(..., description="UUID of the conversation this interaction belongs to.")
    interaction_id: str = Field(..., description="UUID of the chat_widget_interactions row being submitted.")
    model_id: str = Field(..., min_length=1, description="Curated CHAT_MODEL_REGISTRY model id for the continuation.")
    result: dict[str, Any] = Field(
        ..., description="Submitted structured result — re-validated server-side against the STORED schema (D-10)."
    )

    @field_validator("conversation_id", "interaction_id")
    @classmethod
    def _validate_ids(cls, v: str) -> str:
        return _require_uuid(v)


@router.post("/widget/submit")
@inject
async def submit_widget(
    body: ChatWidgetSubmitRequest,
    request: Request,
    use_case: FromDishka[SubmitWidgetInteraction],
) -> StreamingResponse:
    """Validate/lock/persist a widget submit, then stream the continuation turn (DCUI-03).

    prepare() performs every rejection check (ownership/staleness/schema/CAS
    lock) BEFORE this handler ever constructs a StreamingResponse — a
    rejection always maps to a plain JSON HTTPException with no stream body.
    """
    try:
        continuation = await use_case.prepare(
            conversation_id=body.conversation_id,
            interaction_id=body.interaction_id,
            result=body.result,
            model_id=body.model_id,
        )
    except WidgetSubmitRejected as exc:
        raise HTTPException(status_code=_REJECTION_STATUS[exc.reason], detail=exc.message or exc.reason) from exc

    return StreamingResponse(
        stream_run_events(request, continuation),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
