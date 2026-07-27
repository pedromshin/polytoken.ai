"""CascadeCorrectionUseCase tests — Phase 75 CPF-01 / CPF-02.

Fakes for every port prove the orchestration contract without a DB:
  - CPF-01: promotes exactly the candidate suggestion edges via the promoter,
    skips any the promoter's guards reject (already-EXTRACTED/inactive/gone),
    stamps mechanism="merge_cascade", and scopes everything to the importer_id
    derived from the LOADED SURVIVOR row (D-21) — never a caller arg.
  - CPF-02: a re-run promotes nothing already promoted and writes no duplicate
    ledger row (job_key ON CONFLICT), i.e. the cascade is idempotent.
"""

from __future__ import annotations

import pytest

from app.application.use_cases.cascade_correction import (
    CascadeCorrectionUseCase,
    CascadeSummary,
)
from app.application.use_cases.promote_edge import EdgeNotFound, EdgeNotPromotable


class _Entity:
    def __init__(self, importer_id: str) -> None:
        self.importer_id = importer_id


class FakeEntities:
    def __init__(self, by_id: dict[str, _Entity]) -> None:
        self._by_id = by_id

    async def find_by_id(self, entity_instance_id: str) -> _Entity | None:
        return self._by_id.get(entity_instance_id)


class FakePromoter:
    """Records every promote call; raises for ids in `unpromotable` (mirrors the
    real promoter's guard rejecting an already-EXTRACTED/inactive edge)."""

    def __init__(self, unpromotable: set[str] | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self._unpromotable = unpromotable or set()

    async def execute(
        self,
        *,
        edge_id: str,
        importer_id: str,
        user_id: str | None = None,
        mechanism: str = "human_promote",
        extra: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.calls.append({"edge_id": edge_id, "importer_id": importer_id, "mechanism": mechanism})
        if edge_id in self._unpromotable:
            raise EdgeNotPromotable("not_promotable")
        return {"edge_id": edge_id, "tier": "EXTRACTED"}


class FakePromoterOnce:
    """Promotes each edge exactly once; a second attempt raises (as the real CAS
    guard would once the edge is EXTRACTED) — for the idempotency test."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self._promoted: set[str] = set()

    async def execute(
        self,
        *,
        edge_id: str,
        importer_id: str,
        user_id: str | None = None,
        mechanism: str = "human_promote",
        extra: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.calls.append(edge_id)
        if edge_id in self._promoted:
            raise EdgeNotFound(f"already promoted: {edge_id}")
        self._promoted.add(edge_id)
        return {"edge_id": edge_id, "tier": "EXTRACTED"}


class FakeReader:
    def __init__(self, edge_ids: list[str], emails: list[str]) -> None:
        self._edge_ids = edge_ids
        self._emails = emails
        self.edge_query: dict[str, object] | None = None

    async def find_promotable_suggestion_edge_ids(self, *, entity_instance_ids, importer_id: str) -> list[str]:
        self.edge_query = {"entity_instance_ids": list(entity_instance_ids), "importer_id": importer_id}
        return list(self._edge_ids)

    async def find_email_ids_for_entity(self, *, entity_instance_id: str) -> list[str]:
        return list(self._emails)


class FakeLedger:
    def __init__(self) -> None:
        self.records: list[dict[str, object]] = []
        self._job_keys: set[str] = set()

    async def record(
        self,
        *,
        importer_id: str,
        survivor_entity_instance_id: str,
        absorbed_entity_instance_id: str,
        promoted_edge_ids,
        affected_email_ids,
        job_key: str,
    ) -> bool:
        self.records.append({"job_key": job_key, "promoted_edge_ids": list(promoted_edge_ids)})
        if job_key in self._job_keys:
            return False  # ON CONFLICT DO NOTHING — already recorded (CPF-02)
        self._job_keys.add(job_key)
        return True

    def rows_for(self, job_key: str) -> int:
        # ON CONFLICT (job_key) DO NOTHING → at most one PERSISTED row per key,
        # however many times record() is called (self.records tracks calls).
        return 1 if job_key in self._job_keys else 0


class FakeEnqueuer:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def enqueue(self, identifier: str, payload, *, max_attempts: int = 8, job_key=None) -> int:
        self.calls.append({"identifier": identifier, "payload": dict(payload), "job_key": job_key})
        return len(self.calls)


def _make(entities, promoter, reader, ledger, enqueuer) -> CascadeCorrectionUseCase:
    return CascadeCorrectionUseCase(
        entity_instances=entities,  # type: ignore[arg-type]
        edge_promoter=promoter,  # type: ignore[arg-type]
        cascade_reader=reader,  # type: ignore[arg-type]
        propagations=ledger,  # type: ignore[arg-type]
        job_enqueuer=enqueuer,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_cpf01_promotes_only_promotable_edges_scoped_to_survivor_importer() -> None:
    entities = FakeEntities({"S": _Entity(importer_id="imp-1")})
    promoter = FakePromoter(unpromotable={"e3"})  # e3 already EXTRACTED → skipped
    reader = FakeReader(edge_ids=["e1", "e2", "e3"], emails=["m1", "m2"])
    ledger = FakeLedger()
    enqueuer = FakeEnqueuer()

    summary = await _make(entities, promoter, reader, ledger, enqueuer).execute(survivor_id="S", absorbed_id="T")

    # Only the promotable edges land in the summary; e3 was skipped.
    assert summary.promoted_edge_ids == ["e1", "e2"]
    # Every candidate was attempted, with the CASCADE mechanism + the importer
    # from the LOADED SURVIVOR ROW (D-21) — never a caller-supplied value.
    assert [c["edge_id"] for c in promoter.calls] == ["e1", "e2", "e3"]
    assert all(c["importer_id"] == "imp-1" for c in promoter.calls)
    assert all(c["mechanism"] == "merge_cascade" for c in promoter.calls)
    # The edge query is scoped to BOTH ids and the survivor's importer.
    assert reader.edge_query == {"entity_instance_ids": ["S", "T"], "importer_id": "imp-1"}
    # Emails enqueued under the idempotency key; ledger written once.
    assert summary.affected_email_ids == ["m1", "m2"]
    assert enqueuer.calls[0]["job_key"] == "cascade:S:T"
    assert enqueuer.calls[0]["identifier"] == "cascade_relabel"
    assert summary.ledger_written is True


@pytest.mark.asyncio
async def test_cpf02_rerun_is_idempotent() -> None:
    entities = FakeEntities({"S": _Entity(importer_id="imp-1")})
    promoter = FakePromoterOnce()
    reader = FakeReader(edge_ids=["e1", "e2"], emails=["m1"])
    ledger = FakeLedger()
    enqueuer = FakeEnqueuer()
    uc = _make(entities, promoter, reader, ledger, enqueuer)

    first = await uc.execute(survivor_id="S", absorbed_id="T")
    assert first.promoted_edge_ids == ["e1", "e2"]
    assert first.ledger_written is True

    second = await uc.execute(survivor_id="S", absorbed_id="T")
    # Nothing re-promoted (edges already EXTRACTED), and the ledger row is not
    # duplicated (job_key ON CONFLICT DO NOTHING).
    assert second.promoted_edge_ids == []
    assert second.ledger_written is False
    assert ledger.rows_for("cascade:S:T") == 1


@pytest.mark.asyncio
async def test_survivor_not_found_is_a_clean_noop() -> None:
    promoter = FakePromoter()
    reader = FakeReader(edge_ids=["e1"], emails=["m1"])
    ledger = FakeLedger()
    enqueuer = FakeEnqueuer()

    summary = await _make(FakeEntities({}), promoter, reader, ledger, enqueuer).execute(
        survivor_id="S", absorbed_id="T"
    )

    assert summary == CascadeSummary("S", "T", [], [], ledger_written=False)
    assert promoter.calls == []
    assert enqueuer.calls == []
    assert ledger.records == []


@pytest.mark.asyncio
async def test_no_affected_emails_skips_enqueue_but_still_records_ledger() -> None:
    entities = FakeEntities({"S": _Entity(importer_id="imp-1")})
    promoter = FakePromoter()
    reader = FakeReader(edge_ids=[], emails=[])
    ledger = FakeLedger()
    enqueuer = FakeEnqueuer()

    summary = await _make(entities, promoter, reader, ledger, enqueuer).execute(survivor_id="S", absorbed_id="T")

    assert summary.promoted_edge_ids == []
    assert summary.affected_email_ids == []
    assert enqueuer.calls == []  # no emails → no re-label fan-out
    assert summary.ledger_written is True  # the cascade is still recorded
