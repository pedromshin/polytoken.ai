"""Tests for confirm_action_dispatch.py (Phase 40-02, CONF-02).

Mirrors test_promote_edge.py's AsyncMock-based repo-double style — here the
mocked collaborator is PromoteEdgeUseCase itself (an application use case,
not infrastructure). Every rejection/unsupported path is asserted to never
raise past `execute()`, and the reject branch is asserted to never touch
the wrapped PromoteEdgeUseCase at all.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from app.application.use_cases.confirm_action_dispatch import (
    KnowledgeEdgeTierPromotionHandler,
    UnsupportedConfirmActionHandler,
)
from app.application.use_cases.promote_edge import EdgeNotFound, EdgeNotPromotable

_IMPORTER = "imp-abc"
_EDGE_ID = "edge-001"
_WIDGET_INTERACTION_ID = "wi-1"


def _handler(
    promote_result: dict[str, object] | None = None, *, side_effect: Exception | None = None
) -> tuple[KnowledgeEdgeTierPromotionHandler, AsyncMock]:
    promote_edge = AsyncMock()
    if side_effect is not None:
        promote_edge.execute.side_effect = side_effect
    else:
        promote_edge.execute.return_value = promote_result or {"edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    return KnowledgeEdgeTierPromotionHandler(promote_edge=promote_edge), promote_edge


def test_confirm_calls_promote_edge_with_chat_confirm_action_mechanism_and_returns_promoted() -> None:
    handler, promote_edge = _handler({"edge_id": _EDGE_ID, "tier": "EXTRACTED"})

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id=_EDGE_ID,
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result == {"status": "promoted", "edge_id": _EDGE_ID, "tier": "EXTRACTED"}
    promote_edge.execute.assert_awaited_once_with(
        edge_id=_EDGE_ID,
        importer_id=_IMPORTER,
        user_id=None,
        mechanism="chat_confirm_action",
        extra={"widget_interaction_id": _WIDGET_INTERACTION_ID},
    )


def test_confirm_catches_edge_not_promotable_and_returns_promote_failed_without_raising() -> None:
    handler, promote_edge = _handler(side_effect=EdgeNotPromotable("conflict", "already promoted"))

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id=_EDGE_ID,
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result == {"status": "promote_failed"}
    promote_edge.execute.assert_awaited_once()


def test_confirm_catches_edge_not_found_and_returns_promote_failed_without_raising() -> None:
    handler, promote_edge = _handler(side_effect=EdgeNotFound("gone"))

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id=_EDGE_ID,
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result == {"status": "promote_failed"}
    promote_edge.execute.assert_awaited_once()


def test_reject_never_calls_promote_edge_and_returns_rejected() -> None:
    handler, promote_edge = _handler()

    result = asyncio.run(
        handler.execute(
            action="reject",
            suggestion_id=_EDGE_ID,
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result == {"status": "rejected"}
    assert not promote_edge.execute.await_count, "reject must NEVER call the wrapped PromoteEdgeUseCase"


def test_unsupported_handler_never_raises_and_returns_unsupported_status() -> None:
    handler = UnsupportedConfirmActionHandler()

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="link-pair-id",
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result["status"] == "unsupported"
    assert "reason" in result


def test_unsupported_handler_never_raises_on_reject_action_either() -> None:
    handler = UnsupportedConfirmActionHandler()

    result = asyncio.run(
        handler.execute(
            action="reject",
            suggestion_id="link-pair-id",
            importer_id=_IMPORTER,
            widget_interaction_id=_WIDGET_INTERACTION_ID,
        )
    )

    assert result["status"] == "unsupported"
