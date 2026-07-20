"""PromoteSourceLedgerEntryUseCase -- promotion-gate reuse seam (Phase 56-05, RCNV-01).

Adapts a `chat_source_ledger` row onto the UNCHANGED `SourceCaptureHandler`
(`confirm_action_dispatch.py`, Phase 54-03/54-05). This class contains ZERO
new promotion machinery -- it only reshapes a ledger row into the exact
`source_payload` shape `SourceCaptureHandler.execute()` already accepts, calls
it verbatim, and (on a "captured" result) back-references the resulting node
id onto the ledger row via `SourceLedgerRepository.set_knowledge_node_id`.

`SourceCaptureHandler` already does the INFERRED node upsert (dedupe via
`uuid5(NAMESPACE_URL, url)`) + INFERRED edge insert; `PromoteEdgeUseCase`
(unchanged, `promote_edge.py`) already flips the resulting edge's tier to
EXTRACTED. Neither file is modified by this plan -- proven by a git-based
zero-diff assertion in `test_promote_source_ledger_reuse.py`.

Phase 56-05 left this unwired BY DESIGN (56-05-PLAN.md's stated scope
boundary); Phase 63's canon-curation UX closed that seam: DI wiring lives in
`container.py` (`_provide_promote_source_ledger_entry_use_case`) and the
route is POST /v1/chat/sources/{ledger_id}/promote (`chat_sources.py`, which
asserts conversation ownership via the ledger row's conversation_id BEFORE
execute). The reuse test still constructs this use case directly with fakes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.application.use_cases.confirm_action_dispatch import ConfirmActionResult, SourceCaptureHandler
    from app.domain.ports.source_ledger_repository import SourceLedgerRepository

_STATUS_CAPTURED = "captured"
_STATUS_CAPTURE_FAILED = "capture_failed"


class PromoteSourceLedgerEntryUseCase:
    """Reshapes one chat_source_ledger row onto SourceCaptureHandler.execute(), verbatim."""

    def __init__(self, *, source_ledger: SourceLedgerRepository, source_capture: SourceCaptureHandler) -> None:
        self._source_ledger = source_ledger
        self._source_capture = source_capture

    async def execute(self, *, ledger_entry_id: str, importer_id: str) -> ConfirmActionResult:
        entry = await self._source_ledger.get(ledger_entry_id)
        if entry is None:
            return {"status": _STATUS_CAPTURE_FAILED}

        result = await self._source_capture.execute(
            action="confirm",
            suggestion_id=ledger_entry_id,  # lookup key only, never trusted content
            importer_id=importer_id,
            widget_interaction_id="",  # no widget in this path -- RCNV-01's anti-ceremony intent
            source_payload={
                "url": entry.url,
                "title": entry.title,
                "retrievedAt": entry.captured_at.isoformat() if entry.captured_at is not None else None,
            },
            conversation_id=entry.conversation_id,
        )

        if result.get("status") == _STATUS_CAPTURED:
            await self._source_ledger.set_knowledge_node_id(ledger_entry_id, str(result["node_id"]))

        return result


__all__ = ["PromoteSourceLedgerEntryUseCase"]
