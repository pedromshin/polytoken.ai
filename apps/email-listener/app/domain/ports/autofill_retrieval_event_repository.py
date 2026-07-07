"""AutofillRetrievalEventRepository port — domain abstraction for RECALL-02 instrumentation writes.

Phase 31-02: every autofill run should persist one AutofillRetrievalEvent (best-effort).
Implementations must never raise — a write failure is logged server-side and swallowed
by the caller (mirrors GenerationAuditRepository's best-effort contract, T-13-10).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.domain.entities.autofill_retrieval_event import AutofillRetrievalEvent


class AutofillRetrievalEventRepository(Protocol):
    """Port for persisting AutofillRetrievalEvent rows (RECALL-02).

    No mutation/update method is exposed — human-correction linkage is derived
    at query time (joining extraction_records.corrected_fields on component_id),
    never by mutating a persisted event (see packages/db/scripts/retrieval-miss-rate.ts).
    """

    async def save(self, event: AutofillRetrievalEvent) -> None:
        """Persist a single retrieval event row.

        Callers must treat this as best-effort: AutofillUseCase.execute wraps
        the call in try/except and logs a warning on failure — an instrumentation
        write failure must never break autofill.
        """
        ...
