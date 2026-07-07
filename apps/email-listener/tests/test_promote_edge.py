"""Tests for PromoteEdgeUseCase (Phase 30-02 Task 2, T-30-05/06/07/08).

TDD RED->GREEN: load -> tenant guard -> active guard -> tier guard -> CAS
write is fixed and never reordered. Every rejection path (not-found /
cross-importer / inactive / already-EXTRACTED / CAS-conflict) raises a typed
exception BEFORE `promote_edge` (the write) is ever called -- asserted
explicitly on every rejection test. A successful promotion writes
promotion={promoted_at, from_tier, mechanism} and leaves `provenance`
untouched (the repo double proves this by construction: the use case never
reads/writes provenance).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from app.application.use_cases.promote_edge import (
    EdgeNotFound,
    EdgeNotPromotable,
    PromoteEdgeUseCase,
)

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


def _use_case(edge: dict[str, object] | None, *, promote_result: bool = True) -> tuple[PromoteEdgeUseCase, AsyncMock]:
    repo = AsyncMock()
    repo.find_edge_by_id.return_value = edge
    repo.promote_edge.return_value = promote_result
    return PromoteEdgeUseCase(knowledge=repo), repo


def test_promote_inferred_edge_writes_promotion_and_leaves_provenance() -> None:
    use_case, repo = _use_case(_edge(tier="INFERRED"))

    result = asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))

    assert result == {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    repo.find_edge_by_id.assert_awaited_once_with(_EDGE_ID)
    repo.promote_edge.assert_awaited_once()
    call = repo.promote_edge.await_args
    assert call.kwargs["edge_id"] == _EDGE_ID
    promotion = call.kwargs["promotion"]
    assert promotion["from_tier"] == "INFERRED"
    assert promotion["mechanism"] == "human_promote"
    assert "promoted_at" in promotion
    # The use case never touches `provenance` -- only `promotion` is passed to the repo.
    assert "provenance" not in promotion


def test_promote_ambiguous_edge_succeeds() -> None:
    use_case, repo = _use_case(_edge(tier="AMBIGUOUS"))

    result = asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))

    assert result == {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    call = repo.promote_edge.await_args
    assert call.kwargs["promotion"]["from_tier"] == "AMBIGUOUS"


def test_reject_not_found_before_any_write() -> None:
    use_case, repo = _use_case(None)

    try:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))
        raise AssertionError("expected EdgeNotFound")
    except EdgeNotFound:
        pass

    assert not repo.promote_edge.await_count, "promote_edge must NOT be called on not-found rejection"


def test_reject_already_extracted_before_any_write() -> None:
    use_case, repo = _use_case(_edge(tier="EXTRACTED"))

    try:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))
        raise AssertionError("expected EdgeNotPromotable")
    except EdgeNotPromotable as exc:
        assert exc.reason == "not_promotable"

    assert not repo.promote_edge.await_count, "promote_edge must NOT be called on already-EXTRACTED rejection"


def test_reject_inactive_before_any_write() -> None:
    use_case, repo = _use_case(_edge(tier="INFERRED", is_active=False))

    try:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))
        raise AssertionError("expected EdgeNotPromotable")
    except EdgeNotPromotable as exc:
        assert exc.reason == "inactive"

    assert not repo.promote_edge.await_count, "promote_edge must NOT be called on inactive rejection"


def test_reject_cross_importer_before_any_write() -> None:
    use_case, repo = _use_case(_edge(importer_id=_OTHER_IMPORTER))

    try:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))
        raise AssertionError("expected EdgeNotPromotable")
    except EdgeNotPromotable as exc:
        assert exc.reason == "tenant_mismatch"

    assert not repo.promote_edge.await_count, "promote_edge must NOT be called on cross-importer rejection"


def test_reject_cas_conflict_when_repo_reports_no_row_updated() -> None:
    """Concurrent promote/dismiss already changed the row (T-30-06)."""
    use_case, repo = _use_case(_edge(tier="INFERRED"), promote_result=False)

    try:
        asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))
        raise AssertionError("expected EdgeNotPromotable")
    except EdgeNotPromotable as exc:
        assert exc.reason == "conflict"

    repo.promote_edge.assert_awaited_once()


def test_load_precedes_write_call_ordering() -> None:
    """find_edge_by_id is awaited before promote_edge on the success path."""
    calls: list[str] = []
    repo = AsyncMock()

    async def _find_edge_by_id(_edge_id: str) -> dict[str, object]:
        calls.append("find_edge_by_id")
        return _edge(tier="INFERRED")

    async def _promote_edge(**_kwargs: object) -> bool:
        calls.append("promote_edge")
        return True

    repo.find_edge_by_id.side_effect = _find_edge_by_id
    repo.promote_edge.side_effect = _promote_edge
    use_case = PromoteEdgeUseCase(knowledge=repo)

    asyncio.run(use_case.execute(edge_id=_EDGE_ID, importer_id=_IMPORTER))

    assert calls == ["find_edge_by_id", "promote_edge"]
