"""Tests for POST /v1/knowledge/edges/{edge_id}/promote (Phase 30-02 Task 3, T-30-04/05/07;
extended Phase 44-03 Task 3, T-44-03-03).

TestClient + dishka HTTP-seam idiom (mirrors test_confirm_region.py): a
minimal Provider swaps in a mock/real PromoteEdgeUseCase so the endpoint's
auth gate, error mapping, and response shape are exercised without a live DB.
Every request below sends X-User-Id by default (Phase 44-03: require_user_id
401s without it) via the TestClient's default headers.
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock

from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.promote_edge import (
    EdgeNotFound,
    EdgeNotPromotable,
    PromoteEdgeUseCase,
)
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository
from app.main import create_app
from app.presentation.middleware.user_context import USER_ID_HEADER
from app.settings import get_settings

_EDGE_ID = "00000000-0000-0000-0000-0000000000e1"
_IMPORTER = "imp-abc"
_USER_ID = "user-owner-1"


def _make_client(mock_use_case: PromoteEdgeUseCase) -> TestClient:
    """Build a test app with a minimal dishka container providing PromoteEdgeUseCase."""

    def provide_use_case() -> PromoteEdgeUseCase:
        return mock_use_case

    provider = Provider(scope=Scope.APP)
    provider.provide(provide_use_case, provides=PromoteEdgeUseCase)

    app = create_app()
    app.state.dishka_container = make_async_container(provider)
    return TestClient(app, raise_server_exceptions=False, headers={USER_ID_HEADER: _USER_ID})


def test_promote_edge_returns_200_with_extracted_tier() -> None:
    mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
    mock_use_case.execute.return_value = {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}

    client = _make_client(mock_use_case)
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["tier"] == "EXTRACTED"
    mock_use_case.execute.assert_awaited_once_with(edge_id=_EDGE_ID, importer_id=_IMPORTER, user_id=_USER_ID)


def test_promote_edge_not_found_maps_to_404() -> None:
    mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
    mock_use_case.execute.side_effect = EdgeNotFound("not found")

    client = _make_client(mock_use_case)
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 404


def test_promote_edge_already_extracted_maps_to_409() -> None:
    mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
    mock_use_case.execute.side_effect = EdgeNotPromotable("not_promotable", "already extracted")

    client = _make_client(mock_use_case)
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 409


def test_promote_edge_inactive_maps_to_409() -> None:
    mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
    mock_use_case.execute.side_effect = EdgeNotPromotable("inactive", "inactive edge")

    client = _make_client(mock_use_case)
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_ID}/promote",
        json={"importer_id": _IMPORTER},
    )

    assert resp.status_code == 409


def test_promote_edge_cross_importer_maps_to_409_with_no_write() -> None:
    """Tenant mismatch is fail-closed -- rejected before any write (T-30-07)."""
    mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
    mock_use_case.execute.side_effect = EdgeNotPromotable("tenant_mismatch", "cross-importer")

    client = _make_client(mock_use_case)
    resp = client.post(
        f"/v1/knowledge/edges/{_EDGE_ID}/promote",
        json={"importer_id": "imp-other-caller"},
    )

    assert resp.status_code == 409
    mock_use_case.execute.assert_awaited_once()


def test_promote_edge_requires_api_key() -> None:
    """POST .../promote returns 401 without X-API-Key when configured (T-30-04)."""
    old_key = os.environ.get("API_KEY")
    os.environ["API_KEY"] = "test-secret-key"
    get_settings.cache_clear()
    try:
        mock_use_case = AsyncMock(spec=PromoteEdgeUseCase)
        mock_use_case.execute.return_value = {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}

        client = _make_client(mock_use_case)

        resp = client.post(
            f"/v1/knowledge/edges/{_EDGE_ID}/promote",
            json={"importer_id": _IMPORTER},
        )
        assert resp.status_code == 401
        mock_use_case.execute.assert_not_awaited()

        resp_authed = client.post(
            f"/v1/knowledge/edges/{_EDGE_ID}/promote",
            json={"importer_id": _IMPORTER},
            headers={"X-API-Key": "test-secret-key"},
        )
        assert resp_authed.status_code == 200
    finally:
        if old_key is None:
            os.environ.pop("API_KEY", None)
        else:
            os.environ["API_KEY"] = old_key
        get_settings.cache_clear()


def test_container_builds_with_promote_edge_use_case() -> None:
    """Container wiring smoke test: create_container() succeeds (no GraphMissingFactoryError)."""
    from app.container import create_container

    container = create_container()
    assert container is not None


def test_promote_edge_use_case_factory_instantiates_repo_directly() -> None:
    """_provide_promote_edge_use_case wires SupabaseKnowledgeGraphRepository (concrete, not a port)
    and threads through the ImporterResolver collaborator (Phase 44-03)."""
    from unittest.mock import MagicMock

    from app.container import _provide_promote_edge_use_case

    client = MagicMock()
    importer_resolver = MagicMock()
    use_case = _provide_promote_edge_use_case(client, importer_resolver)

    assert isinstance(use_case, PromoteEdgeUseCase)
    assert isinstance(use_case._knowledge, SupabaseKnowledgeGraphRepository)
    assert use_case._importers is importer_resolver
