"""Adversarial cross-tenant acceptance gate for the FastAPI surface (Phase 44 Plan 08, TENA-03).

Seeds importer A (owned by user A) with an email, an attachment, and a
knowledge edge under it. Drives every user-scoped FastAPI endpoint AS USER B
and asserts each denies access to A's data: list_emails never includes A's
rows (and rejects an explicit request for A's importer_id),
get_email/download_attachment/reprocess_email 404 (fail-closed, no existence
oracle), and the knowledge-edge promote proxy rejects a promotion of A's edge
even when B supplies A's REAL importer_id in the request body (the pre-44-03
exploit path -- T-44-03-03). Every user-scoped endpoint also 401s a request
carrying no X-User-Id at all. A positive control (user A reaching user A's
own data on every surface) proves the gate isn't blanket-denying.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.promote_edge import PromoteEdgeUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.entities.attachment import Attachment
from app.domain.entities.email import Email
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.importer_resolver import ImporterResolver
from app.main import create_app
from app.presentation.middleware.user_context import USER_ID_HEADER

_USER_A = "user-aaaa"
_USER_B = "user-bbbb"
_IMPORTER_A = "imp-aaaa"
_IMPORTER_B = "imp-bbbb"
_EDGE_A_ID = "00000000-0000-0000-0000-0000000000e1"
_NOW = datetime(2026, 7, 10, 12, 0, 0, tzinfo=UTC)


def _email(email_id: str, importer_id: str) -> Email:
    return Email(
        id=email_id,
        importer_id=importer_id,
        message_id=f"<{email_id}@example.com>",
        in_reply_to=None,
        references_ids=(),
        received_at=_NOW,
        sender_address="sender@example.com",
        sender_name=None,
        to_addresses=("agent@magnitudetech.com.br",),
        cc_addresses=(),
        subject="Docs",
        body_html=None,
        body_text=None,
        raw_storage_key="inbound/local/ses-001",
        parse_status="received",
        parse_error=None,
        parsed_at=None,
        created_at=_NOW,
    )


_EMAIL_A = _email("email-a", _IMPORTER_A)

_ATTACHMENT_A = Attachment(
    id="att-a",
    email_id="email-a",
    importer_id=_IMPORTER_A,
    filename="bl.pdf",
    content_type="application/pdf",
    file_ext="pdf",
    size_bytes=13,
    storage_key=f"{_IMPORTER_A}/email-a/att-a/bl.pdf",
    parent_attachment_id=None,
    parse_status="pending",
)

_EDGE_A: dict[str, object] = {
    "id": _EDGE_A_ID,
    "importer_id": _IMPORTER_A,
    "tier": "INFERRED",
    "is_active": True,
    "provenance": {"component_id": "comp-1"},
    "promotion": None,
}


@pytest.fixture
def mocks() -> dict[str, MagicMock]:
    email_repo = MagicMock()
    email_repo.list_by_importer = AsyncMock(return_value=[_EMAIL_A])
    email_repo.list_by_importer_ids = AsyncMock(return_value=[_EMAIL_A])
    email_repo.find_by_id = AsyncMock(return_value=_EMAIL_A)

    attachment_repo = MagicMock()
    attachment_repo.count_by_email_ids = AsyncMock(return_value={"email-a": 1})
    attachment_repo.find_by_email_id = AsyncMock(return_value=[_ATTACHMENT_A])

    attachment_storage = MagicMock()
    attachment_storage.fetch = AsyncMock(return_value=b"%PDF-1.4 fake")

    reprocess_use_case = MagicMock()
    reprocess_use_case.execute = AsyncMock(return_value={"email_id": "email-a", "superseded_components": 0})

    importer_repo = MagicMock()

    async def _owned(user_id: str) -> list[str]:
        return [_IMPORTER_A] if user_id == _USER_A else [_IMPORTER_B]

    importer_repo.list_importer_ids_for_user = AsyncMock(side_effect=_owned)

    knowledge_repo = AsyncMock()
    knowledge_repo.find_edge_by_id.return_value = dict(_EDGE_A)
    knowledge_repo.promote_edge.return_value = True

    return {
        "email_repo": email_repo,
        "attachment_repo": attachment_repo,
        "attachment_storage": attachment_storage,
        "reprocess_use_case": reprocess_use_case,
        "importer_repo": importer_repo,
        "knowledge_repo": knowledge_repo,
    }


@pytest.fixture
def client(mocks: dict[str, MagicMock]) -> TestClient:
    """One TestClient wiring both fix targets this plan's gate covers: the
    emails read surface (Plan 03 Task 2) and the knowledge-edge promote proxy
    (Plan 03 Task 3). PromoteEdgeUseCase is constructed for real (not mocked)
    so its actual user-ownership guard runs against the shared importer_repo
    mock -- the same collaborator wiring container.py uses in production."""
    provider = Provider(scope=Scope.APP)

    provider.provide(lambda: mocks["email_repo"], provides=EmailRepository)
    provider.provide(lambda: mocks["attachment_repo"], provides=AttachmentRepository)
    provider.provide(lambda: mocks["attachment_storage"], provides=AttachmentStorage)
    provider.provide(lambda: mocks["reprocess_use_case"], provides=ReprocessEmailUseCase)
    provider.provide(lambda: mocks["importer_repo"], provides=ImporterResolver)
    provider.provide(
        lambda: PromoteEdgeUseCase(knowledge=mocks["knowledge_repo"], importers=mocks["importer_repo"]),
        provides=PromoteEdgeUseCase,
    )

    app = create_app()
    app.state.dishka_container = make_async_container(provider)
    return TestClient(app)


def _headers(user_id: str) -> dict[str, str]:
    return {USER_ID_HEADER: user_id}


# ---------------------------------------------------------------------------
# No X-User-Id -- every user-scoped endpoint 401s
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_list_emails_requires_x_user_id(client: TestClient) -> None:
    assert client.get("/v1/emails").status_code == 401


@pytest.mark.unit
def test_get_email_requires_x_user_id(client: TestClient) -> None:
    assert client.get("/v1/emails/email-a").status_code == 401


@pytest.mark.unit
def test_download_attachment_requires_x_user_id(client: TestClient) -> None:
    assert client.get("/v1/emails/email-a/attachments/att-a").status_code == 401


@pytest.mark.unit
def test_reprocess_requires_x_user_id(client: TestClient) -> None:
    assert client.post("/v1/emails/email-a/reprocess").status_code == 401


@pytest.mark.unit
def test_promote_edge_requires_x_user_id(client: TestClient) -> None:
    resp = client.post(f"/v1/knowledge/edges/{_EDGE_A_ID}/promote", json={"importer_id": _IMPORTER_A})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# User B against user A's data -- every surface denies
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_list_emails_as_user_b_never_includes_user_a_rows(client: TestClient, mocks: dict[str, MagicMock]) -> None:
    """B owns imp-bbbb, not imp-aaaa -- the list scopes to B's owned importers,
    which never resolves email-a (owned by A's imp-aaaa)."""
    mocks["email_repo"].list_by_importer_ids = AsyncMock(return_value=[])

    resp = client.get("/v1/emails", headers=_headers(_USER_B))

    assert resp.status_code == 200
    ids = [row["id"] for row in resp.json()["data"]]
    assert "email-a" not in ids
    mocks["importer_repo"].list_importer_ids_for_user.assert_awaited_once_with(_USER_B)
    mocks["email_repo"].list_by_importer_ids.assert_awaited_once_with([_IMPORTER_B], limit=50, offset=0)


@pytest.mark.unit
def test_list_emails_as_user_b_rejects_user_a_importer_id_filter(client: TestClient) -> None:
    """B explicitly asking for A's importer_id via the query param is rejected --
    never silently returns A's rows (T-44-03-01)."""
    resp = client.get(f"/v1/emails?importer_id={_IMPORTER_A}", headers=_headers(_USER_B))
    assert resp.status_code == 403


@pytest.mark.unit
def test_get_email_as_user_b_returns_404(client: TestClient) -> None:
    resp = client.get("/v1/emails/email-a", headers=_headers(_USER_B))
    assert resp.status_code == 404


@pytest.mark.unit
def test_download_attachment_as_user_b_returns_404(client: TestClient) -> None:
    resp = client.get("/v1/emails/email-a/attachments/att-a", headers=_headers(_USER_B))
    assert resp.status_code == 404


@pytest.mark.unit
def test_reprocess_as_user_b_returns_404(client: TestClient, mocks: dict[str, MagicMock]) -> None:
    resp = client.post("/v1/emails/email-a/reprocess", headers=_headers(_USER_B))
    assert resp.status_code == 404
    mocks["reprocess_use_case"].execute.assert_not_awaited()


@pytest.mark.unit
def test_promote_edge_as_user_b_is_rejected_even_with_a_s_real_importer_id(
    client: TestClient, mocks: dict[str, MagicMock]
) -> None:
    """B supplies A's REAL importer_id in the body (the pre-44-03 exploit path)
    -- still rejected because B does not OWN imp-aaaa (T-44-03-03)."""
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_A_ID}/promote",
        json={"importer_id": _IMPORTER_A},
        headers=_headers(_USER_B),
    )

    assert resp.status_code == 409
    assert not mocks["knowledge_repo"].promote_edge.await_count


# ---------------------------------------------------------------------------
# Positive control -- user A reaches user A's own data on every surface
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_list_emails_as_user_a_includes_user_a_rows(client: TestClient) -> None:
    resp = client.get("/v1/emails", headers=_headers(_USER_A))
    assert resp.status_code == 200
    ids = [row["id"] for row in resp.json()["data"]]
    assert "email-a" in ids


@pytest.mark.unit
def test_get_email_as_user_a_succeeds(client: TestClient) -> None:
    resp = client.get("/v1/emails/email-a", headers=_headers(_USER_A))
    assert resp.status_code == 200


@pytest.mark.unit
def test_download_attachment_as_user_a_succeeds(client: TestClient) -> None:
    resp = client.get("/v1/emails/email-a/attachments/att-a", headers=_headers(_USER_A))
    assert resp.status_code == 200


@pytest.mark.unit
def test_reprocess_as_user_a_succeeds(client: TestClient) -> None:
    resp = client.post("/v1/emails/email-a/reprocess", headers=_headers(_USER_A))
    assert resp.status_code == 200


@pytest.mark.unit
def test_promote_edge_as_user_a_succeeds(client: TestClient) -> None:
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_A_ID}/promote",
        json={"importer_id": _IMPORTER_A},
        headers=_headers(_USER_A),
    )

    assert resp.status_code == 200
    assert resp.json()["data"]["tier"] == "EXTRACTED"
