"""Domain entity for an autofill retrieval instrumentation event. No external dependencies.

RECALL-02 (Phase 31-02): one best-effort row per AutofillUseCase.execute run,
mirroring the autofill_retrieval_events table 1:1. Written best-effort — a
write failure never breaks autofill (see AutofillUseCase._record_retrieval_event).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AutofillRetrievalEvent:
    """A single autofill run's retrieval outcome (RECALL-02 instrumentation).

    seed_hits: per-example {id, score} entries from the retrieved few-shot set
        (empty tuple on cold start).
    seed_hit_count: len(seed_hits) — denormalized for cheap miss-rate queries.
    injected_entity_instance_id: the resolved entity injected as
        <known_entity_context> (RECALL-01), or None when nothing was injected.
    injected_alias_count / injected_identifier_count: size of the injected
        context, 0 when nothing was injected.
    routing_reason: mirrors ExtractionRecord.routing_reason
        ("few_shot_autofill" | "cold_start_autofill").
    """

    id: str
    component_id: str
    importer_id: str | None
    entity_type_id: str | None
    seed_hits: tuple[dict[str, object], ...]
    seed_hit_count: int
    injected_entity_instance_id: str | None
    injected_alias_count: int
    injected_identifier_count: int
    routing_reason: str
    created_at: datetime
