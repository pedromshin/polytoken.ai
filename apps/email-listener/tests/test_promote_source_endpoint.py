"""Tests for POST /v1/chat/sources/{ledger_id}/promote (Phase 63 canon-curation wiring).

TestClient + dishka HTTP-seam idiom (mirrors test_promote_edge_endpoint.py):
a minimal Provider swaps in mocks for PromoteSourceLedgerEntryUseCase,
SourceLedgerRepository, and ChatConversationRepository so the endpoint's
auth gate, fail-closed ownership ordering, error mapping, and response shape
are exercised without a live DB. Every request below sends X-User-Id by
default (require_user_id 401s without it) via the TestClient's default
headers.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.promote_source_ledger_entry import PromoteSourceLedgerEntryUseCase
from app.domain.ports.chat_repositories import ChatConversationRepository
from app.domain.ports.source_ledger_repository import SourceLedgerEntry, SourceLedgerRepository
from app.main import create_app
from app.presentation.middleware.user_context import USER_ID_HEADER

_LEDGER_ID = "00000000-0000-0000-0000-0000000000a1"
_CONVERSATION_ID = "00000000-0000-0000-0000-0000000000c1"
_IMPORTER = "imp-abc"
_USER_ID = "user-owner-1"
_NODE_ID = "node-1"


def _ledger_entry() -> SourceLedgerEntry:
    return SourceLedgerEntry(
        id=_LEDGER_ID,
        conversation_id=_CONVERSATION_ID,
        importer_id=_IMPORTER,
        tool_name="web_search",
        tool_use_id="toolu_1",
        result_index=0,
        url="https://example.com/article",
        title="An Article",
        snippet="a snippet",
        captured_at=datetime(2026, 7, 12, tzinfo=UTC),
        knowledge_node_id=None,
    )


def _make_client(
    mock_use_case: PromoteSourceLedgerEntryUseCase,
    mock_source_ledger: SourceLedgerRepository,
    mock_conversations: ChatConversationRepository,
) -> TestClient:
    """Build a test app with a minimal dishka container providing all three seams."""

    def provide_use_case() -> PromoteSourceLedgerEntryUseCase:
        return mock_use_case

    def provide_source_ledger() -> SourceLedgerRepository:
        return mock_source_ledger

    def provide_conversations() -> ChatConversationRepository:
        return mock_conversations

    provider = Provider(scope=Scope.APP)
    provider.provide(provide_use_case, provides=PromoteSourceLedgerEntryUseCase)
    provider.provide(provide_source_ledger, provides=SourceLedgerRepository)
    provider.provide(provide_conversations, provides=ChatConversationRepository)

    app = create_app()
    app.state.dishka_container = make_async_container(provider)
    return TestClient(app, raise_server_exceptions=False, headers={USER_ID_HEADER: _USER_ID})


def _default_mocks() -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    mock_use_case = AsyncMock(spec=PromoteSourceLedgerEntryUseCase)
    mock_use_case.execute.return_value = {"status": "captured", "node_id": _NODE_ID}
    mock_source_ledger = AsyncMock(spec=SourceLedgerRepository)
    mock_source_ledger.get.return_value = _ledger_entry()
    mock_conversations = AsyncMock(spec=ChatConversationRepository)
    mock_conversations.owner_user_id.return_value = _USER_ID
    return mock_use_case, mock_source_ledger, mock_conversations


def test_promote_source_returns_200_with_captured_view() -> None:
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["ledger_id"] == _LEDGER_ID
    assert body["data"]["node_id"] == _NODE_ID
    assert body["data"]["status"] == "captured"
    mock_use_case.execute.assert_awaited_once_with(ledger_entry_id=_LEDGER_ID, importer_id=_IMPORTER)
    mock_conversations.owner_user_id.assert_awaited_once_with(_CONVERSATION_ID)


def test_promote_source_missing_ledger_row_maps_to_404_without_execute() -> None:
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()
    mock_source_ledger.get.return_value = None

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 404
    mock_use_case.execute.assert_not_awaited()
    mock_conversations.owner_user_id.assert_not_awaited()


def test_promote_source_wrong_owner_maps_to_404_without_execute() -> None:
    """Fail-closed ownership: a non-owned conversation 404s (never 403 — the
    row's existence is never disclosed) BEFORE the use case ever executes."""
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()
    mock_conversations.owner_user_id.return_value = "user-someone-else"

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 404
    mock_use_case.execute.assert_not_awaited()


def test_promote_source_unknown_conversation_owner_maps_to_404() -> None:
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()
    mock_conversations.owner_user_id.return_value = None

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 404
    mock_use_case.execute.assert_not_awaited()


def test_promote_source_capture_failed_maps_to_409() -> None:
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()
    mock_use_case.execute.return_value = {"status": "capture_failed"}

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 409


def test_promote_source_requires_user_id_header() -> None:
    """401 without X-User-Id (require_user_id), before any repository call."""
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    client.headers.pop(USER_ID_HEADER, None)
    resp = client.post(
        f"/v1/chat/sources/{_LEDGER_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 401
    mock_use_case.execute.assert_not_awaited()


def test_promote_source_invalid_ledger_id_maps_to_422() -> None:
    mock_use_case, mock_source_ledger, mock_conversations = _default_mocks()

    client = _make_client(mock_use_case, mock_source_ledger, mock_conversations)
    resp = client.post(
        "/v1/chat/sources/not-a-uuid/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 422
    mock_use_case.execute.assert_not_awaited()


def test_container_builds_with_promote_source_ledger_entry_use_case() -> None:
    """Container wiring smoke test: create_container() succeeds (no GraphMissingFactoryError)."""
    from app.container import create_container

    container = create_container()
    assert container is not None


def test_promote_source_use_case_factory_wires_source_capture_handler() -> None:
    """_provide_promote_source_ledger_entry_use_case builds SourceCaptureHandler over a
    directly-instantiated SupabaseKnowledgeGraphRepository and threads through the
    already-bound SourceLedgerRepository collaborator (Phase 63 seam closure)."""
    from unittest.mock import MagicMock

    from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
    from app.container import _provide_promote_source_ledger_entry_use_case
    from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository

    client = MagicMock()
    source_ledger = MagicMock()
    use_case = _provide_promote_source_ledger_entry_use_case(client, source_ledger)

    assert isinstance(use_case, PromoteSourceLedgerEntryUseCase)
    assert use_case._source_ledger is source_ledger
    assert isinstance(use_case._source_capture, SourceCaptureHandler)
    assert isinstance(use_case._source_capture._knowledge_graph, SupabaseKnowledgeGraphRepository)
