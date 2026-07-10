"""Known-gap regression: the FastAPI chat SSE surface (stream / regenerate /
widget submit) does not enforce per-user conversation ownership (Phase 44
Plan 08, TENA-03).

Discovered while enumerating "every route/procedure" for the 44-08 sweep
inventory (broader than the originally carried-forward item -- see below).
The Next.js BFF forwards a server-verified `X-User-Id` on EVERY one of these
three routes (apps/web/src/app/api/chat/{stream,regenerate}/route.ts +
chat/widget/submit/route.ts, all via `supabase.auth.getUser()`), but NONE of
the three corresponding FastAPI endpoints (`chat_stream.py`'s
`POST /v1/chat/stream` + `POST /v1/chat/regenerate`, `chat_widget.py`'s
`POST /v1/chat/widget/submit`) ever read that header or verify the caller
owns `conversation_id` -- `RunChatTurn.run()/.regenerate()` and
`SubmitWidgetInteraction.prepare()` all key exclusively off the
client-supplied `conversation_id`, with zero ownership check.

Originally carried forward (44-03 -> 44-07 -> 44-08) as a NARROWER item:
`PromoteEdgeUseCase.execute()` gained an OPTIONAL `user_id` ownership guard
in 44-03, wired to the REST promote endpoint -- but the chat confirm_action
dispatch path (chat_widget.py -> SubmitWidgetInteraction.prepare() ->
confirm_action_dispatch.py -> PromoteEdgeUseCase.execute()) never threads a
user_id through, so the guard is a permanent no-op for that one path. Sweep
investigation for this plan found the actual gap is the WHOLE chat SSE
transport layer, not just the promotion dispatch sub-path.

Full exploit path: an attacker who obtains ANOTHER user's `conversation_id`
(e.g. via logs, a shared link, browser history, or any out-of-band channel)
can, under THEIR OWN session:
  - POST /v1/chat/stream with that conversation_id -- appends a message into
    the victim's conversation and streams back a model response generated
    from the VICTIM's full conversation history (cross-tenant READ of
    conversation context + WRITE of a message into it);
  - POST /v1/chat/regenerate similarly, keyed by conversation_id +
    assistant_message_id;
  - POST /v1/chat/widget/submit for a pending confirm_action widget in that
    conversation, promoting a suggested knowledge edge under another user's
    importer (the narrower originally-flagged item -- `_dispatch_confirm_
    action` resolves `importer_id` from the edge itself, so the pre-existing
    `PromoteEdgeUseCase` tenant-mismatch check is a tautology on this path
    and the optional `user_id` guard never runs).

These tests lock in the CURRENT (insecure) behavior as xfail: unlike every
other user-scoped endpoint swept in this phase (emails.py, knowledge_edges.py
promote, the attachments route), none of these three require `X-User-Id` at
all -- a request with no X-User-Id header still reaches the use case
successfully instead of 401ing.

Tracked in .planning/phases/44-tenancy-user-id-scoping-enforced-isolation/
44-SWEEP-INVENTORY.md under "Known Gap (not enforced)". Recommended fix (a
dedicated follow-up plan -- this is a core, heavily-tested execution path,
not a quick patch): (1) add `Depends(require_user_id)` to all three
endpoints; (2) extend `ChatConversationRepository` with an ownership-lookup
method; (3) thread `user_id` through `RunChatTurn.run()/.regenerate()` and
`SubmitWidgetInteraction.prepare()` (the latter also through
`_dispatch_confirm_action` -> `ConfirmActionHandler.execute()` ->
`KnowledgeEdgeTierPromotionHandler.execute()` ->
`PromoteEdgeUseCase.execute(user_id=...)`), verifying ownership before any
read/write, mirroring the REST promote endpoint's existing wiring
(`knowledge_edges.py`).

xfail(strict=True): when this gap is closed, these tests start PASSING
unexpectedly and pytest treats that as a hard failure -- the fix's author
must remove these markers (and update the SWEEP-INVENTORY row) as part of
that change.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.domain.ports.chat_repositories import ChatRunEvent
from app.presentation.api.v1.chat_stream import router as chat_stream_router
from app.presentation.api.v1.chat_widget import router as chat_widget_router
from app.presentation.middleware.user_context import USER_ID_HEADER

_CONVERSATION_ID = "11111111-1111-1111-1111-111111111111"
_INTERACTION_ID = "22222222-2222-2222-2222-222222222222"
_ASSISTANT_MESSAGE_ID = "33333333-3333-3333-3333-333333333333"
_ATTACKER_USER_ID = "user-attacker"


class _FakeSubmitWidgetInteraction:
    """Always succeeds -- proves the endpoint reaches prepare() regardless of caller identity."""

    def __init__(self) -> None:
        self.prepare_calls: list[dict[str, Any]] = []

    async def prepare(
        self, *, conversation_id: str, interaction_id: str, result: dict[str, Any], model_id: str
    ) -> AsyncIterator[ChatRunEvent]:
        self.prepare_calls.append(
            {"conversation_id": conversation_id, "interaction_id": interaction_id, "model_id": model_id}
        )
        return self._stream()

    async def _stream(self) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


def _make_widget_submit_client() -> TestClient:
    use_case = _FakeSubmitWidgetInteraction()
    app = FastAPI()
    app.include_router(chat_widget_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=SubmitWidgetInteraction, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture
def client() -> TestClient:
    return _make_widget_submit_client()


def _body() -> dict[str, Any]:
    return {
        "conversation_id": _CONVERSATION_ID,
        "interaction_id": _INTERACTION_ID,
        "model_id": "m1",
        "result": {"optionId": "opt-0"},
    }


@pytest.mark.unit
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 known gap (44-SWEEP-INVENTORY.md): POST /v1/chat/widget/submit has no require_user_id gate",
)
def test_submit_widget_requires_x_user_id_like_every_other_user_scoped_endpoint(client: TestClient) -> None:
    """DESIRED contract (matches emails.py / knowledge_edges.py promote / the
    attachments route): a request with no X-User-Id must 401 before touching
    SubmitWidgetInteraction.prepare(). Currently it does not -- see module
    docstring."""
    resp = client.post("/v1/chat/widget/submit", json=_body())

    assert resp.status_code == 401


@pytest.mark.unit
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 known gap (44-SWEEP-INVENTORY.md): submit_widget never verifies the caller owns conversation_id",
)
def test_submit_widget_rejects_a_conversation_the_caller_does_not_own(client: TestClient) -> None:
    """DESIRED contract: an authenticated caller supplying X-User-Id for a
    conversation they do not own must be rejected before dispatch. Currently
    the endpoint never checks conversation ownership at all -- ANY
    authenticated caller can submit ANY conversation_id/interaction_id pair
    (see module docstring for the full exploit path)."""
    resp = client.post(
        "/v1/chat/widget/submit",
        headers={USER_ID_HEADER: _ATTACKER_USER_ID},
        json=_body(),
    )

    assert resp.status_code in (401, 403, 404)


# ---------------------------------------------------------------------------
# POST /v1/chat/stream + POST /v1/chat/regenerate -- the SAME gap, broader
# blast radius (the primary chat turn engine, not just widget confirmation).
# ---------------------------------------------------------------------------


class _FakeRunChatTurn:
    """Always succeeds -- proves both endpoints reach the use case regardless
    of caller identity or conversation ownership."""

    async def run(self, *, conversation_id: str, user_text: str, model_id: str) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)

    async def regenerate(
        self, *, conversation_id: str, assistant_message_id: str, model_id: str
    ) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


def _make_chat_stream_client() -> TestClient:
    use_case = _FakeRunChatTurn()
    app = FastAPI()
    app.include_router(chat_stream_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=RunChatTurn, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture
def stream_client() -> TestClient:
    return _make_chat_stream_client()


@pytest.mark.unit
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 known gap (44-SWEEP-INVENTORY.md): POST /v1/chat/stream has no require_user_id gate",
)
def test_chat_stream_requires_x_user_id_like_every_other_user_scoped_endpoint(stream_client: TestClient) -> None:
    """DESIRED contract: a request with no X-User-Id must 401 before touching
    RunChatTurn.run(). Currently ANY authenticated caller can post a message
    into ANY conversation_id and stream back the VICTIM's conversation
    context (see module docstring)."""
    resp = stream_client.post(
        "/v1/chat/stream",
        json={"conversation_id": _CONVERSATION_ID, "user_text": "hi", "model_id": "m1"},
    )

    assert resp.status_code == 401


@pytest.mark.unit
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 known gap (44-SWEEP-INVENTORY.md): POST /v1/chat/regenerate has no require_user_id gate",
)
def test_chat_regenerate_requires_x_user_id_like_every_other_user_scoped_endpoint(stream_client: TestClient) -> None:
    """DESIRED contract: same as /v1/chat/stream -- see module docstring."""
    resp = stream_client.post(
        "/v1/chat/regenerate",
        json={
            "conversation_id": _CONVERSATION_ID,
            "assistant_message_id": _ASSISTANT_MESSAGE_ID,
            "model_id": "m1",
        },
    )

    assert resp.status_code == 401
