"""Tests for POST /v1/chat/widget/submit (Phase 24-02 Task 3, DCUI-03).

Verifies:
- every WidgetSubmitRejected outcome maps to the correct pre-stream HTTP
  status code (404 not_found, 409 stale, 422 invalid, 409 conflict) with NO
  stream body -- SubmitWidgetInteraction.prepare() is awaited BEFORE the
  StreamingResponse is constructed (T-24-02/T-24-03: never mid-stream)
- a valid submit returns 200 text/event-stream carrying the continuation run
  events framed identically to /v1/chat/stream (`data: {...}` per event)
- X-API-Key required when configured (401, no stream, prepare() never called)
- Phase 44-09 contract: X-User-Id required (401 without it) and the
  conversation must be OWNED by that user (404 otherwise) BEFORE prepare()
  is ever called — updated 2026-07-13 (this suite predated 44-09 and had
  been failing invisibly: CI's testpaths never collects app/**/__tests__).

Deviation note: placed at app/presentation/api/v1/__tests__/ (co-located),
mirroring 24-01/24-02's new co-located __tests__ convention rather than the
pre-24-01 top-level tests/presentation/ convention that
tests/presentation/test_chat_stream.py still uses for the existing
regression suite.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction, WidgetSubmitRejected
from app.domain.ports.chat_repositories import ChatConversationRepository, ChatRunEvent
from app.presentation.api.v1.chat_widget import router
from app.presentation.middleware.user_context import USER_ID_HEADER
from app.settings import Environment, get_settings

_VALID_UUID_1 = "11111111-1111-1111-1111-111111111111"
_VALID_UUID_2 = "22222222-2222-2222-2222-222222222222"
_TEST_USER_ID = "33333333-3333-3333-3333-333333333333"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeSubmitWidgetInteraction:
    """A SubmitWidgetInteraction test double with a scripted prepare() outcome."""

    def __init__(
        self,
        *,
        events: list[ChatRunEvent] | None = None,
        rejection: WidgetSubmitRejected | None = None,
    ) -> None:
        self._events = events or []
        self._rejection = rejection
        self.prepare_calls: list[dict[str, Any]] = []

    async def prepare(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
        user_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        self.prepare_calls.append(
            {
                "conversation_id": conversation_id,
                "interaction_id": interaction_id,
                "result": result,
                "model_id": model_id,
                "user_id": user_id,
            }
        )
        if self._rejection is not None:
            raise self._rejection
        return self._stream()

    async def _stream(self) -> AsyncIterator[ChatRunEvent]:
        for event in self._events:
            yield event


class _FakeChatConversationRepository:
    """A ChatConversationRepository test double with a configurable owner (Phase 44-09).

    Defaults to owning every conversation_id as `_TEST_USER_ID` — matches the
    shared client's default X-User-Id header (mirrors
    tests/presentation/test_chat_stream.py's idiom).
    """

    def __init__(self, owner_user_id: str | None = _TEST_USER_ID) -> None:
        self._owner_user_id = owner_user_id

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        return None

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner_user_id

    async def get_thread_id(self, conversation_id: str) -> str | None:
        return None

    async def list_by_thread_id(
        self,
        *,
        thread_id: str,
        importer_id: str,
        exclude_conversation_id: str | None = None,
        limit: int = 8,
    ) -> list[Any]:
        return []


def _sample_events() -> list[ChatRunEvent]:
    return [
        ChatRunEvent(type="started", data={"model_id": "m1"}, id="e1", run_id="r1", seq=0),
        ChatRunEvent(type="text_delta_checkpoint", data={"text": "Got it"}, id="e2", run_id="r1", seq=1),
        ChatRunEvent(type="completed", data={}, id="e3", run_id="r1", seq=2),
    ]


def _make_app_with_fake_use_case(
    use_case: _FakeSubmitWidgetInteraction,
    conversations: ChatConversationRepository | None = None,
) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    conversations_repo = conversations if conversations is not None else _FakeChatConversationRepository()

    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=SubmitWidgetInteraction, scope=Scope.APP)
    provider.provide(lambda: conversations_repo, provides=ChatConversationRepository, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


def _make_client(
    use_case: _FakeSubmitWidgetInteraction,
    conversations: ChatConversationRepository | None = None,
) -> TestClient:
    test_client = TestClient(_make_app_with_fake_use_case(use_case, conversations), raise_server_exceptions=True)
    test_client.headers[USER_ID_HEADER] = _TEST_USER_ID
    return test_client


@pytest.fixture
def fake_use_case() -> _FakeSubmitWidgetInteraction:
    return _FakeSubmitWidgetInteraction(events=_sample_events())


@pytest.fixture
def client(fake_use_case: _FakeSubmitWidgetInteraction) -> TestClient:
    return _make_client(fake_use_case)


def _valid_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "conversation_id": _VALID_UUID_1,
        "interaction_id": _VALID_UUID_2,
        "model_id": "m1",
        "result": {"optionId": "opt-0"},
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Valid submit -> 200 text/event-stream
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_valid_submit_streams_continuation_events(
    client: TestClient, fake_use_case: _FakeSubmitWidgetInteraction
) -> None:
    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    frames = [line for line in resp.text.split("\n\n") if line.strip()]
    assert len(frames) == 3
    parsed = [json.loads(frame.removeprefix("data: ")) for frame in frames]
    assert [p["type"] for p in parsed] == ["started", "text_delta_checkpoint", "completed"]

    assert fake_use_case.prepare_calls == [
        {
            "conversation_id": _VALID_UUID_1,
            "interaction_id": _VALID_UUID_2,
            "result": {"optionId": "opt-0"},
            "model_id": "m1",
            "user_id": _TEST_USER_ID,
        }
    ]


@pytest.mark.unit
def test_valid_clarify_widget_flat_result_streams_continuation_events() -> None:
    """Cross-boundary regression pin (2026-07-23): the web's clarify_widget submit
    is a FLAT field-name map — no ``{"values": {...}}`` wrapper. The listener's
    derived response schema (``_derive_clarify_response_schema``) is flat with
    ``additionalProperties: false``, so the wrapped shape 422s; this pins the
    exact shape InteractiveWidgetBoundary now sends reaching prepare() verbatim
    and streaming 200.
    """
    use_case = _FakeSubmitWidgetInteraction(events=_sample_events())
    client = _make_client(use_case)

    flat_result = {"reason": "Need more time", "subscribe": False}
    resp = client.post("/v1/chat/widget/submit", json=_valid_body(result=flat_result))

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert use_case.prepare_calls == [
        {
            "conversation_id": _VALID_UUID_1,
            "interaction_id": _VALID_UUID_2,
            "result": flat_result,
            "model_id": "m1",
            "user_id": _TEST_USER_ID,
        }
    ]


# ---------------------------------------------------------------------------
# Rejections -> pre-stream status codes, never mid-stream (T-24-02/T-24-03)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_not_found_rejection_returns_404_no_stream() -> None:
    use_case = _FakeSubmitWidgetInteraction(rejection=WidgetSubmitRejected("not_found", "widget interaction not found"))
    client = _make_client(use_case)

    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 404
    assert not resp.headers.get("content-type", "").startswith("text/event-stream")


@pytest.mark.unit
def test_stale_rejection_returns_409_no_stream() -> None:
    use_case = _FakeSubmitWidgetInteraction(rejection=WidgetSubmitRejected("stale", "this widget is no longer active"))
    client = _make_client(use_case)

    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 409
    assert not resp.headers.get("content-type", "").startswith("text/event-stream")


@pytest.mark.unit
def test_conflict_rejection_returns_409_no_stream() -> None:
    use_case = _FakeSubmitWidgetInteraction(
        rejection=WidgetSubmitRejected("conflict", "this widget has already been answered")
    )
    client = _make_client(use_case)

    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 409
    assert not resp.headers.get("content-type", "").startswith("text/event-stream")


@pytest.mark.unit
def test_invalid_rejection_returns_422_no_stream() -> None:
    use_case = _FakeSubmitWidgetInteraction(
        rejection=WidgetSubmitRejected("invalid", "result did not match the declared response schema")
    )
    client = _make_client(use_case)

    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 422
    assert not resp.headers.get("content-type", "").startswith("text/event-stream")


# ---------------------------------------------------------------------------
# Phase 44-09 contract: X-User-Id + ownership, both fail-closed BEFORE prepare()
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_missing_user_id_header_returns_401_prepare_never_called(
    fake_use_case: _FakeSubmitWidgetInteraction,
) -> None:
    app = _make_app_with_fake_use_case(fake_use_case)
    bare_client = TestClient(app, raise_server_exceptions=True)  # NO X-User-Id header

    resp = bare_client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 401
    assert not fake_use_case.prepare_calls


@pytest.mark.unit
def test_non_owned_conversation_returns_404_prepare_never_called(
    fake_use_case: _FakeSubmitWidgetInteraction,
) -> None:
    client = _make_client(
        fake_use_case,
        conversations=_FakeChatConversationRepository(owner_user_id="99999999-9999-9999-9999-999999999999"),
    )

    resp = client.post("/v1/chat/widget/submit", json=_valid_body())

    assert resp.status_code == 404
    assert not fake_use_case.prepare_calls


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejects_invalid_conversation_id(client: TestClient) -> None:
    resp = client.post("/v1/chat/widget/submit", json=_valid_body(conversation_id="not-a-uuid"))
    assert resp.status_code == 422


@pytest.mark.unit
def test_rejects_invalid_interaction_id(client: TestClient) -> None:
    resp = client.post("/v1/chat/widget/submit", json=_valid_body(interaction_id="not-a-uuid"))
    assert resp.status_code == 422


@pytest.mark.unit
def test_rejects_missing_model_id(client: TestClient) -> None:
    body = _valid_body()
    del body["model_id"]
    resp = client.post("/v1/chat/widget/submit", json=body)
    assert resp.status_code == 422


@pytest.mark.unit
def test_rejects_non_object_result(client: TestClient) -> None:
    resp = client.post("/v1/chat/widget/submit", json=_valid_body(result="not-an-object"))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Auth (fail-closed)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_requires_api_key_when_configured(
    monkeypatch: pytest.MonkeyPatch, fake_use_case: _FakeSubmitWidgetInteraction
) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        # X-User-Id IS supplied (via _make_client) so the 401 below is
        # attributable to the missing X-API-Key alone.
        auth_client = _make_client(fake_use_case)
        resp = auth_client.post("/v1/chat/widget/submit", json=_valid_body())

        assert resp.status_code == 401
        assert not resp.headers.get("content-type", "").startswith("text/event-stream")
        assert not fake_use_case.prepare_calls
        assert get_settings().ENVIRONMENT is Environment.STAGING
    finally:
        get_settings.cache_clear()
