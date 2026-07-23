"""Tests for POST /v1/emails/backfill-reprocess (owner-scoped bulk reprocess)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.entities.email import Email
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver

_FWD = "u-tok@fwd.test"
_OWNER = "user-1"
_OWNED_IMPORTER = "imp-owned"


def _email(email_id: str, importer_id: str) -> Email:
    return Email(
        id=email_id,
        importer_id=importer_id,
        thread_id=None,
        message_id=f"<{email_id}@x>",
        in_reply_to=None,
        references_ids=(),
        received_at=datetime(2026, 7, 23, tzinfo=UTC),
        sender_address="a@b.com",
        sender_name=None,
        to_addresses=(),
        cc_addresses=(),
        subject="s",
        body_html=None,
        body_text="b",
        raw_storage_key="inbound/prod/x",
        parse_status="received",
        parse_error=None,
        parsed_at=None,
        created_at=datetime(2026, 7, 23, tzinfo=UTC),
    )


def _make_app(resolver: object, importer: object, emails: object, reprocess: object) -> FastAPI:
    from dishka import Provider, Scope, make_async_container
    from dishka.integrations.fastapi import setup_dishka

    from app.presentation.api.v1.backfill_reprocess import router

    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: resolver, provides=ForwardingAddressResolver, scope=Scope.APP)
    provider.provide(lambda: importer, provides=ImporterResolver, scope=Scope.APP)
    provider.provide(lambda: emails, provides=EmailRepository, scope=Scope.APP)
    provider.provide(lambda: reprocess, provides=ReprocessEmailUseCase, scope=Scope.APP)
    setup_dishka(container=make_async_container(provider), app=app)
    return app


def _deps(owner: str | None = _OWNER) -> tuple[object, object, object, object]:
    resolver = MagicMock(spec=ForwardingAddressResolver)
    resolver.resolve_recipients = AsyncMock(return_value=owner)
    importer = MagicMock(spec=ImporterResolver)
    importer.list_importer_ids_for_user = AsyncMock(return_value=[_OWNED_IMPORTER])
    emails = MagicMock(spec=EmailRepository)
    reprocess = MagicMock(spec=ReprocessEmailUseCase)
    reprocess.execute = AsyncMock(return_value={"superseded_components": 3, "new_regions": 5})
    return resolver, importer, emails, reprocess


@pytest.mark.unit
def test_unresolved_token_is_401() -> None:
    resolver, importer, emails, reprocess = _deps(owner=None)
    client = TestClient(_make_app(resolver, importer, emails, reprocess))
    resp = client.post("/v1/emails/backfill-reprocess", json={"recipients": ["x@y"], "email_ids": ["e1"]})
    assert resp.status_code == 401
    reprocess.execute.assert_not_awaited()


@pytest.mark.unit
def test_owned_email_is_reprocessed() -> None:
    resolver, importer, emails, reprocess = _deps()
    emails.find_by_id = AsyncMock(return_value=_email("e1", _OWNED_IMPORTER))
    client = TestClient(_make_app(resolver, importer, emails, reprocess))
    resp = client.post("/v1/emails/backfill-reprocess", json={"recipients": [_FWD], "email_ids": ["e1"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["reprocessed"] == 1
    assert data["items"][0]["new_regions"] == 5
    reprocess.execute.assert_awaited_once_with(email_id="e1")


@pytest.mark.unit
def test_foreign_email_is_skipped_not_reprocessed() -> None:
    resolver, importer, emails, reprocess = _deps()
    emails.find_by_id = AsyncMock(return_value=_email("e1", "imp-someone-else"))
    client = TestClient(_make_app(resolver, importer, emails, reprocess))
    resp = client.post("/v1/emails/backfill-reprocess", json={"recipients": [_FWD], "email_ids": ["e1"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["skipped_not_owned"] == 1
    assert data["reprocessed"] == 0
    reprocess.execute.assert_not_awaited()
