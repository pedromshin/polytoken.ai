"""Tests for POST /v1/emails/backfill (backfill transport, capability auth).

Verifies:
- forwarding-token authorization: 401 when no recipient resolves, 200 when one does
- payload validation: 422 on invalid base64, 422 on invalid backfill id,
  422 when recipients is empty (pydantic min_length)
- DI wiring: BackfillInboundEmailUseCase invoked with decoded bytes + recipients
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.backfill_inbound_email import (
    BackfillInboundEmailUseCase,
    InvalidBackfillIdError,
)
from app.domain.entities.email import Email
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver

_RAW_MIME = b"From: a@example.com\r\nTo: u-tok@fwd.test\r\nSubject: hi\r\n\r\nbody\r\n"
_FWD = "u-tok@fwd.test"
_OWNER = "user-1"


def _make_email(**overrides: object) -> Email:
    base: dict = {
        "id": "email-1",
        "importer_id": "imp-1",
        "thread_id": "thread-1",
        "message_id": "bf-msg-1",
        "in_reply_to": None,
        "references_ids": (),
        "received_at": datetime(2026, 7, 23, tzinfo=UTC),
        "sender_address": "a@example.com",
        "sender_name": None,
        "to_addresses": (_FWD,),
        "cc_addresses": (),
        "subject": "hi",
        "body_html": None,
        "body_text": "body",
        "raw_storage_key": "backfill/bf-msg-1",
        "parse_status": "parsed",
        "parse_error": None,
        "parsed_at": datetime(2026, 7, 23, tzinfo=UTC),
        "created_at": datetime(2026, 7, 23, tzinfo=UTC),
    }
    base.update(overrides)
    return Email(**base)


def _make_app(use_case: BackfillInboundEmailUseCase, resolver: ForwardingAddressResolver) -> FastAPI:
    from dishka import Provider, Scope, make_async_container
    from dishka.integrations.fastapi import setup_dishka

    from app.presentation.api.v1.backfill_email import router

    app = FastAPI()
    app.include_router(router)

    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=BackfillInboundEmailUseCase, scope=Scope.APP)
    provider.provide(lambda: resolver, provides=ForwardingAddressResolver, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


def _payload(
    backfill_id: str = "msg-1",
    raw: bytes = _RAW_MIME,
    recipients: list[str] | None = None,
    raw_b64: str | None = None,
) -> dict:
    return {
        "backfill_id": backfill_id,
        "raw_mime_b64": raw_b64 if raw_b64 is not None else base64.b64encode(raw).decode(),
        "recipients": recipients if recipients is not None else [_FWD],
    }


@pytest.fixture
def mock_use_case() -> MagicMock:
    uc = MagicMock(spec=BackfillInboundEmailUseCase)
    uc.execute = AsyncMock(return_value=_make_email())
    return uc


@pytest.fixture
def mock_resolver() -> MagicMock:
    r = MagicMock(spec=ForwardingAddressResolver)
    r.resolve_recipients = AsyncMock(return_value=_OWNER)
    return r


@pytest.fixture
def client(mock_use_case: MagicMock, mock_resolver: MagicMock) -> TestClient:
    return TestClient(_make_app(mock_use_case, mock_resolver), raise_server_exceptions=True)


@pytest.mark.unit
def test_resolved_token_returns_200_and_ack(client: TestClient, mock_use_case: MagicMock) -> None:
    resp = client.post("/v1/emails/backfill", json=_payload())
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["email_id"] == "email-1"
    assert data["parse_status"] == "parsed"
    assert data["thread_id"] == "thread-1"

    mock_use_case.execute.assert_awaited_once()
    kwargs = mock_use_case.execute.await_args.kwargs
    assert kwargs["backfill_id"] == "msg-1"
    assert kwargs["raw_mime"] == _RAW_MIME
    assert list(kwargs["recipients"]) == [_FWD]


@pytest.mark.unit
def test_unresolved_token_is_401(client: TestClient, mock_resolver: MagicMock, mock_use_case: MagicMock) -> None:
    mock_resolver.resolve_recipients = AsyncMock(return_value=None)
    resp = client.post("/v1/emails/backfill", json=_payload(recipients=["stranger@x.test"]))
    assert resp.status_code == 401
    mock_use_case.execute.assert_not_awaited()


@pytest.mark.unit
def test_empty_recipients_is_422(client: TestClient) -> None:
    resp = client.post("/v1/emails/backfill", json=_payload(recipients=[]))
    assert resp.status_code == 422


@pytest.mark.unit
def test_invalid_base64_is_422(client: TestClient, mock_use_case: MagicMock) -> None:
    resp = client.post("/v1/emails/backfill", json=_payload(raw_b64="!!!not-base64!!!"))
    assert resp.status_code == 422
    mock_use_case.execute.assert_not_awaited()


@pytest.mark.unit
def test_invalid_backfill_id_maps_to_422(client: TestClient, mock_use_case: MagicMock) -> None:
    mock_use_case.execute = AsyncMock(side_effect=InvalidBackfillIdError("bad id"))
    resp = client.post("/v1/emails/backfill", json=_payload(backfill_id="has space"))
    assert resp.status_code == 422
