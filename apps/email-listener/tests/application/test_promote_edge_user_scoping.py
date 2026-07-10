"""Tests for PromoteEdgeUseCase's user-ownership guard (Phase 44-03 Task 3, TENA-03).

Proves: the client-supplied body importer_id is no longer sufficient to
promote an edge when a caller supplies user_id -- the acting user must
actually OWN the edge's importer, resolved via the owned-importer resolver
(Task 1). Every rejection raises BEFORE promote_edge (the write) is ever
called (T-44-03-03). Omitting user_id (the chat confirm_action dispatch path)
preserves the exact pre-44-03 behavior.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.application.use_cases.promote_edge import (
    EdgeNotPromotable,
    PromoteEdgeUseCase,
)

_USER = "user-owner-1"
_OTHER_USER = "user-other-2"
_IMPORTER = "imp-abc"
_OTHER_IMPORTER = "imp-other"
_EDGE_ID = "edge-001"


def _edge(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": _EDGE_ID,
        "importer_id": _IMPORTER,
        "tier": "INFERRED",
        "is_active": True,
        "provenance": {"component_id": "comp-1"},
        "promotion": None,
    }
    base.update(overrides)
    return base


def _use_case(
    edge: dict[str, object] | None,
    *,
    owned_importer_ids: list[str],
    promote_result: bool = True,
) -> tuple[PromoteEdgeUseCase, AsyncMock, AsyncMock]:
    knowledge_repo = AsyncMock()
    knowledge_repo.find_edge_by_id.return_value = edge
    knowledge_repo.promote_edge.return_value = promote_result

    importer_repo = AsyncMock()
    importer_repo.list_importer_ids_for_user.return_value = owned_importer_ids

    use_case = PromoteEdgeUseCase(knowledge=knowledge_repo, importers=importer_repo)
    return use_case, knowledge_repo, importer_repo


@pytest.mark.unit
def test_promoting_edge_owned_by_user_succeeds() -> None:
    use_case, knowledge_repo, importer_repo = _use_case(_edge(), owned_importer_ids=[_IMPORTER])

    result = asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER, user_id=_USER))

    assert result == {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    importer_repo.list_importer_ids_for_user.assert_awaited_once_with(_USER)
    knowledge_repo.promote_edge.assert_awaited_once()


@pytest.mark.unit
def test_body_importer_id_not_owned_by_user_is_rejected_before_any_write() -> None:
    """The body importer_id doesn't match the edge's REAL importer -- rejected
    regardless of ownership (the pre-existing tenant-mismatch guard, still active)."""
    use_case, knowledge_repo, _importer_repo = _use_case(
        _edge(importer_id=_OTHER_IMPORTER), owned_importer_ids=[_OTHER_IMPORTER]
    )

    with pytest.raises(EdgeNotPromotable) as exc_info:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER, user_id=_USER))

    assert exc_info.value.reason == "tenant_mismatch"
    assert not knowledge_repo.promote_edge.await_count


@pytest.mark.unit
def test_cross_user_promotion_with_correct_body_importer_id_is_rejected() -> None:
    """Even a body importer_id that matches the edge's REAL importer is rejected
    if the acting user does not own that importer (T-44-03-03)."""
    use_case, knowledge_repo, _importer_repo = _use_case(_edge(), owned_importer_ids=[_OTHER_IMPORTER])

    with pytest.raises(EdgeNotPromotable) as exc_info:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER, user_id=_OTHER_USER))

    assert exc_info.value.reason == "tenant_mismatch"
    assert not knowledge_repo.promote_edge.await_count


@pytest.mark.unit
def test_omitting_user_id_skips_ownership_guard_preserving_pre_44_03_behavior() -> None:
    """Legacy/internal callers (e.g. chat confirm_action dispatch) that never
    pass user_id are unaffected -- only the pre-existing body-importer_id
    equality check runs."""
    use_case, _knowledge_repo, importer_repo = _use_case(_edge(), owned_importer_ids=[])

    result = asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))

    assert result == {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    importer_repo.list_importer_ids_for_user.assert_not_awaited()


@pytest.mark.unit
def test_user_id_provided_without_importers_collaborator_raises_runtime_error() -> None:
    """Defensive: a misconfigured use case (user_id passed but no importers
    collaborator wired) fails loudly rather than silently skipping the guard."""
    knowledge_repo = AsyncMock()
    knowledge_repo.find_edge_by_id.return_value = _edge()
    use_case = PromoteEdgeUseCase(knowledge=knowledge_repo)

    with pytest.raises(RuntimeError):
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER, user_id=_USER))
