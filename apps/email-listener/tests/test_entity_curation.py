"""Tests for Phase 10-03: Human curation loop — confirm-merge, reject-merge, unmerge.

Tests cover:
  1. ConfirmMergeUseCase — sets was_selected=True on candidate link + alias write-back (D-09/D-11)
  2. ConfirmMergeUseCase — importer_id derived from row, never caller (D-21)
  3. RejectMergeUseCase — dismisses candidate link, no identity link written
  4. RejectMergeUseCase — cross-importer id raises ValueError → 404
  5. UnmergeEntityUseCase — separates confirmed merge, supersede-never-mutate
  6. UnmergeEntityUseCase — ValueError on missing id
  7. API endpoints — confirm/reject/unmerge behind X-API-Key (D-20)
"""

from __future__ import annotations

import asyncio
import os
from typing import Any
from unittest.mock import AsyncMock

import pytest
from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.curate_entity_merge import (
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)
from app.application.use_cases.promote_entity_on_confirm import PromoteEntityOnConfirmUseCase
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.domain.entities.entity_instance import EntityInstance
from app.main import create_app
from app.settings import get_settings

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_IMPORTER_ID = "00000000-0000-0000-0003-000000000001"
_OTHER_IMPORTER_ID = "00000000-0000-0000-0003-000000000002"
_ENTITY_TYPE_ID = "00000000-0000-0000-0004-000000000001"
_ENTITY_ID_A = "00000000-0000-0000-0002-000000000001"
_ENTITY_ID_B = "00000000-0000-0000-0002-000000000002"
_ENTITY_ID_CROSS = "00000000-0000-0000-0002-000000000099"  # different importer


def _make_instance(
    entity_instance_id: str = _ENTITY_ID_A,
    importer_id: str = _IMPORTER_ID,
    display_name: str = "MSCU Industries Ltd",
    is_active: bool = True,
    merged_into: str | None = None,
) -> EntityInstance:
    return EntityInstance(
        id=entity_instance_id,
        importer_id=importer_id,
        entity_type_id=_ENTITY_TYPE_ID,
        nauta_id=None,
        source="email_extracted",
        display_name=display_name,
        identifiers={},
        aliases=[],
        summary_text=None,
        embedding=None,
        is_active=is_active,
    )


# ---------------------------------------------------------------------------
# Fake repository for curation tests
# ---------------------------------------------------------------------------


class FakeCurationRepository:
    """In-memory fake implementing the extended EntityInstanceRepository port."""

    def __init__(self, instances: dict[str, EntityInstance] | None = None) -> None:
        self._instances: dict[str, EntityInstance] = dict(instances or {})
        self.candidate_links: list[dict[str, Any]] = []
        self.alias_writes: list[dict[str, Any]] = []
        self.dismissed_links: list[dict[str, Any]] = []
        self.merge_state_writes: list[dict[str, Any]] = []
        self.selected_links: list[dict[str, Any]] = []
        self.removed_aliases: list[dict[str, Any]] = []
        # Tracks the merged_into linkage per entity id (EntityInstance itself has
        # no merged_into field). Seeded via set_merge_state; read by find_merged_children.
        self._merged_into: dict[str, str | None] = {}

    async def find_by_id(self, entity_instance_id: str) -> EntityInstance | None:
        return self._instances.get(entity_instance_id)

    async def find_by_importer_and_type(self, importer_id: str, entity_type_id: str) -> list[EntityInstance]:
        return [
            i for i in self._instances.values() if i.importer_id == importer_id and i.entity_type_id == entity_type_id
        ]

    async def upsert(self, entity_instance: EntityInstance) -> EntityInstance:
        self._instances[entity_instance.id] = entity_instance
        return entity_instance

    async def record_candidate_link(
        self,
        component_id: str,
        entity_instance_id: str,
        entity_type_id: str,
        match_type: str,
        similarity_score: float,
    ) -> None:
        self.candidate_links.append(
            {
                "component_id": component_id,
                "entity_instance_id": entity_instance_id,
                "entity_type_id": entity_type_id,
                "match_type": match_type,
                "similarity_score": similarity_score,
            }
        )

    async def mark_candidate_selected(self, component_id: str, entity_instance_id: str) -> None:
        self.selected_links.append({"component_id": component_id, "entity_instance_id": entity_instance_id})

    async def append_alias(self, entity_instance_id: str, alias: str) -> None:
        self.alias_writes.append({"entity_instance_id": entity_instance_id, "alias": alias})

    async def remove_alias(self, entity_instance_id: str, alias: str) -> None:
        self.removed_aliases.append({"entity_instance_id": entity_instance_id, "alias": alias})

    async def find_merged_children(self, entity_instance_id: str) -> list[EntityInstance]:
        return [
            instance
            for cid, instance in self._instances.items()
            if self._merged_into.get(cid) == entity_instance_id
        ]

    async def list_confirmed_entity_components(self, importer_id: str) -> list[Any]:
        return []

    async def select_candidate_link(self, *, entity_instance_id: str, target_id: str) -> None:
        """Set was_selected=True on the candidate link between these two ids."""
        self.selected_links.append({"entity_instance_id": entity_instance_id, "target_id": target_id})

    async def dismiss_candidate_link(self, *, entity_instance_id: str, target_id: str) -> None:
        """Mark the candidate link as dismissed (durable reject)."""
        self.dismissed_links.append({"entity_instance_id": entity_instance_id, "target_id": target_id})

    async def set_merge_state(
        self,
        entity_instance_id: str,
        *,
        merged_into: str | None = None,
        is_active: bool = True,
    ) -> None:
        """Update merge linkage / active state on an entity instance."""
        self.merge_state_writes.append(
            {
                "entity_instance_id": entity_instance_id,
                "merged_into": merged_into,
                "is_active": is_active,
            }
        )
        # Track merge linkage so find_merged_children can resolve survivors.
        self._merged_into[entity_instance_id] = merged_into
        # Reflect changes in the in-memory store
        existing = self._instances.get(entity_instance_id)
        if existing is not None:
            self._instances[entity_instance_id] = EntityInstance(
                id=existing.id,
                importer_id=existing.importer_id,
                entity_type_id=existing.entity_type_id,
                nauta_id=existing.nauta_id,
                source=existing.source,
                display_name=existing.display_name,
                identifiers=existing.identifiers,
                aliases=existing.aliases,
                summary_text=existing.summary_text,
                embedding=existing.embedding,
                is_active=is_active,
            )


# ---------------------------------------------------------------------------
# 1. ConfirmMergeUseCase
# ---------------------------------------------------------------------------


class TestConfirmMergeUseCase:
    def _make_use_case(
        self,
        instances: dict[str, EntityInstance] | None = None,
    ) -> tuple[ConfirmMergeUseCase, FakeCurationRepository]:
        repo = FakeCurationRepository(instances)
        use_case = ConfirmMergeUseCase(entity_instances=repo)
        return use_case, repo

    def test_sets_was_selected_on_candidate_link(self) -> None:
        """ConfirmMerge calls select_candidate_link(entity_instance_id, target_id)."""
        a = _make_instance(_ENTITY_ID_A)
        b = _make_instance(_ENTITY_ID_B)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

        assert len(repo.selected_links) == 1
        assert repo.selected_links[0]["entity_instance_id"] == _ENTITY_ID_A
        assert repo.selected_links[0]["target_id"] == _ENTITY_ID_B

    def test_writes_alias_for_target_display_name(self) -> None:
        """D-11: confirm appends target's display_name as alias on the subject."""
        a = _make_instance(_ENTITY_ID_A, display_name="MSCU Industries")
        b = _make_instance(_ENTITY_ID_B, display_name="MSC United")
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

        assert len(repo.alias_writes) >= 1
        alias_targets = {w["entity_instance_id"] for w in repo.alias_writes}
        # Alias written on the surviving identity (subject)
        assert _ENTITY_ID_A in alias_targets

    def test_derives_importer_from_row_not_caller(self) -> None:
        """D-21: importer_id derived from the loaded entity row, never a param."""
        a = _make_instance(_ENTITY_ID_A, importer_id=_IMPORTER_ID)
        b = _make_instance(_ENTITY_ID_B, importer_id=_IMPORTER_ID)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        # execute() must NOT accept importer_id as a param — this test simply
        # passes, confirming the call succeeds without caller supplying importer.
        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))
        # If it reached here, importer was derived from the row
        assert len(repo.selected_links) == 1

    def test_raises_when_subject_not_found(self) -> None:
        """ValueError when subject entity not found."""
        use_case, _ = self._make_use_case({})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

    def test_raises_when_target_not_found(self) -> None:
        """ValueError when target entity not found."""
        a = _make_instance(_ENTITY_ID_A)
        use_case, _ = self._make_use_case({_ENTITY_ID_A: a})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

    def test_raises_on_cross_importer(self) -> None:
        """D-21 / T-10-20: cross-tenant merge raises ValueError."""
        a = _make_instance(_ENTITY_ID_A, importer_id=_IMPORTER_ID)
        b = _make_instance(_ENTITY_ID_B, importer_id=_OTHER_IMPORTER_ID)
        use_case, _ = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

    def test_rejects_self_merge(self) -> None:
        """RES-3(a): merging an entity into itself is rejected — no state written."""
        a = _make_instance(_ENTITY_ID_A)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a})
        with pytest.raises(ValueError, match="itself"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_A))
        assert repo.merge_state_writes == []
        assert repo.selected_links == []
        assert repo.alias_writes == []

    def test_rejects_inactive_subject(self) -> None:
        """RES-3(c): cannot merge a target into an already-merged (inactive) survivor."""
        a = _make_instance(_ENTITY_ID_A, is_active=False)
        b = _make_instance(_ENTITY_ID_B)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})
        with pytest.raises(ValueError, match="inactive"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))
        assert repo.merge_state_writes == []

    def test_rejects_already_merged_target(self) -> None:
        """RES-3(b/d): an inactive target is already merged elsewhere — reject to avoid cycles."""
        a = _make_instance(_ENTITY_ID_A, is_active=True)
        b = _make_instance(_ENTITY_ID_B, is_active=False)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})
        with pytest.raises(ValueError, match="already-merged"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))
        assert repo.merge_state_writes == []


# ---------------------------------------------------------------------------
# 2. RejectMergeUseCase
# ---------------------------------------------------------------------------


class TestRejectMergeUseCase:
    def _make_use_case(
        self,
        instances: dict[str, EntityInstance] | None = None,
    ) -> tuple[RejectMergeUseCase, FakeCurationRepository]:
        repo = FakeCurationRepository(instances)
        use_case = RejectMergeUseCase(entity_instances=repo)
        return use_case, repo

    def test_dismisses_candidate_link(self) -> None:
        """RejectMerge calls dismiss_candidate_link without linking the identities."""
        a = _make_instance(_ENTITY_ID_A)
        b = _make_instance(_ENTITY_ID_B)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

        assert len(repo.dismissed_links) == 1
        assert repo.dismissed_links[0]["entity_instance_id"] == _ENTITY_ID_A
        assert repo.dismissed_links[0]["target_id"] == _ENTITY_ID_B

    def test_does_not_write_alias_or_merge_state(self) -> None:
        """Reject must NOT link the identities — no alias, no merge state."""
        a = _make_instance(_ENTITY_ID_A)
        b = _make_instance(_ENTITY_ID_B)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

        assert repo.alias_writes == []
        assert repo.merge_state_writes == []

    def test_raises_when_subject_not_found(self) -> None:
        use_case, _ = self._make_use_case({})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))

    def test_raises_on_cross_importer(self) -> None:
        """D-21: cross-tenant reject raises ValueError."""
        a = _make_instance(_ENTITY_ID_A, importer_id=_IMPORTER_ID)
        b = _make_instance(_ENTITY_ID_B, importer_id=_OTHER_IMPORTER_ID)
        use_case, _ = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A, target_id=_ENTITY_ID_B))


# ---------------------------------------------------------------------------
# 3. UnmergeEntityUseCase
# ---------------------------------------------------------------------------


class TestUnmergeEntityUseCase:
    def _make_use_case(
        self,
        instances: dict[str, EntityInstance] | None = None,
    ) -> tuple[UnmergeEntityUseCase, FakeCurationRepository]:
        repo = FakeCurationRepository(instances)
        use_case = UnmergeEntityUseCase(entity_instances=repo)
        return use_case, repo

    def test_reactivates_merged_entity(self) -> None:
        """Unmerge sets is_active=True and clears merge linkage (supersede-never-mutate)."""
        a = _make_instance(_ENTITY_ID_A, is_active=False)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

        assert len(repo.merge_state_writes) == 1
        write = repo.merge_state_writes[0]
        assert write["entity_instance_id"] == _ENTITY_ID_A
        assert write["is_active"] is True
        assert write["merged_into"] is None

    def test_entity_is_active_after_unmerge(self) -> None:
        """In-memory store reflects is_active=True after unmerge."""
        a = _make_instance(_ENTITY_ID_A, is_active=False)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

        updated = asyncio.run(repo.find_by_id(_ENTITY_ID_A))
        assert updated is not None
        assert updated.is_active is True

    def test_raises_when_not_found(self) -> None:
        use_case, _ = self._make_use_case({})
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

    def test_returns_affected_id(self) -> None:
        """execute() returns a dict with entity_instance_id for the endpoint to echo."""
        a = _make_instance(_ENTITY_ID_A)
        use_case, _ = self._make_use_case({_ENTITY_ID_A: a})

        result = asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

        assert result["entity_instance_id"] == _ENTITY_ID_A

    def test_does_not_delete_original_rows(self) -> None:
        """Supersede-never-mutate: original rows must still exist after unmerge."""
        a = _make_instance(_ENTITY_ID_A)
        b = _make_instance(_ENTITY_ID_B)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: a, _ENTITY_ID_B: b})

        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

        # Both entities still exist
        assert asyncio.run(repo.find_by_id(_ENTITY_ID_A)) is not None
        assert asyncio.run(repo.find_by_id(_ENTITY_ID_B)) is not None

    def test_survivor_id_reactivates_merged_child(self) -> None:
        """RES-2: unmerge is invoked with the SURVIVOR id and must reactivate the child.

        The UI only ever shows Unmerge on the survivor (the row others point their
        merged_into at). Reactivating the survivor alone (already active) is a
        no-op; the fix fans out to the merged child.
        """
        survivor = _make_instance(_ENTITY_ID_A, display_name="Acme Corporation", is_active=True)
        child = _make_instance(_ENTITY_ID_B, display_name="ACME Corp", is_active=False)
        use_case, repo = self._make_use_case({_ENTITY_ID_A: survivor, _ENTITY_ID_B: child})
        # Simulate the prior confirmed merge: child B was merged INTO survivor A.
        asyncio.run(repo.set_merge_state(_ENTITY_ID_B, merged_into=_ENTITY_ID_A, is_active=False))
        repo.merge_state_writes.clear()

        # Human clicks Unmerge on the survivor page → survivor id is sent.
        asyncio.run(use_case.execute(entity_instance_id=_ENTITY_ID_A))

        child_after = asyncio.run(repo.find_by_id(_ENTITY_ID_B))
        assert child_after is not None
        assert child_after.is_active is True
        # The child was the row actually reactivated + unlinked.
        assert any(
            w["entity_instance_id"] == _ENTITY_ID_B and w["is_active"] is True and w["merged_into"] is None
            for w in repo.merge_state_writes
        )
        # The confirm-time alias (child's display_name) is removed from the survivor.
        assert {"entity_instance_id": _ENTITY_ID_A, "alias": "ACME Corp"} in repo.removed_aliases


# ---------------------------------------------------------------------------
# 4. API endpoint integration tests
# ---------------------------------------------------------------------------


def _make_api_key() -> str:
    return get_settings().API_KEY


class TestMergeEndpoints:
    """Integration tests for merge confirm/reject/unmerge via TestClient + fake DI."""

    def _build_client(
        self,
        confirm_use_case: ConfirmMergeUseCase | None = None,
        reject_use_case: RejectMergeUseCase | None = None,
        unmerge_use_case: UnmergeEntityUseCase | None = None,
    ) -> TestClient:
        repo = FakeCurationRepository(
            {
                _ENTITY_ID_A: _make_instance(_ENTITY_ID_A),
                _ENTITY_ID_B: _make_instance(_ENTITY_ID_B),
            }
        )

        _confirm = confirm_use_case or ConfirmMergeUseCase(entity_instances=repo)
        _reject = reject_use_case or RejectMergeUseCase(entity_instances=repo)
        _unmerge = unmerge_use_case or UnmergeEntityUseCase(entity_instances=repo)

        _promote_stub = AsyncMock(spec=PromoteEntityOnConfirmUseCase)
        _resolve_stub = AsyncMock(spec=ResolveEntityCandidatesUseCase)
        _backfill_stub = AsyncMock(spec=BackfillEntityIdentitiesUseCase)

        provider = Provider(scope=Scope.APP)
        provider.provide(lambda: _confirm, provides=ConfirmMergeUseCase)
        provider.provide(lambda: _reject, provides=RejectMergeUseCase)
        provider.provide(lambda: _unmerge, provides=UnmergeEntityUseCase)
        provider.provide(lambda: _promote_stub, provides=PromoteEntityOnConfirmUseCase)
        provider.provide(lambda: _resolve_stub, provides=ResolveEntityCandidatesUseCase)
        provider.provide(lambda: _backfill_stub, provides=BackfillEntityIdentitiesUseCase)

        app = create_app()
        app.state.dishka_container = make_async_container(provider)
        return TestClient(app, raise_server_exceptions=False)

    # ── Auth gate tests ───────────────────────────────────────────────────────

    def test_confirm_missing_api_key_returns_401(self) -> None:
        old_key = os.environ.get("API_KEY")
        os.environ["API_KEY"] = "test-secret-key"
        get_settings.cache_clear()
        try:
            client = self._build_client()
            resp = client.post(f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/confirm")
            assert resp.status_code == 401
        finally:
            if old_key is None:
                os.environ.pop("API_KEY", None)
            else:
                os.environ["API_KEY"] = old_key
            get_settings.cache_clear()

    def test_reject_missing_api_key_returns_401(self) -> None:
        old_key = os.environ.get("API_KEY")
        os.environ["API_KEY"] = "test-secret-key"
        get_settings.cache_clear()
        try:
            client = self._build_client()
            resp = client.post(f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/reject")
            assert resp.status_code == 401
        finally:
            if old_key is None:
                os.environ.pop("API_KEY", None)
            else:
                os.environ["API_KEY"] = old_key
            get_settings.cache_clear()

    def test_unmerge_missing_api_key_returns_401(self) -> None:
        old_key = os.environ.get("API_KEY")
        os.environ["API_KEY"] = "test-secret-key"
        get_settings.cache_clear()
        try:
            client = self._build_client()
            resp = client.post(f"/v1/entity-instances/{_ENTITY_ID_A}/unmerge")
            assert resp.status_code == 401
        finally:
            if old_key is None:
                os.environ.pop("API_KEY", None)
            else:
                os.environ["API_KEY"] = old_key
            get_settings.cache_clear()

    # ── 404 tests ─────────────────────────────────────────────────────────────

    def test_confirm_not_found_returns_404(self) -> None:
        repo = FakeCurationRepository({})  # empty — raises ValueError
        use_case = ConfirmMergeUseCase(entity_instances=repo)
        client = self._build_client(confirm_use_case=use_case)
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/confirm",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 404

    def test_reject_not_found_returns_404(self) -> None:
        repo = FakeCurationRepository({})
        use_case = RejectMergeUseCase(entity_instances=repo)
        client = self._build_client(reject_use_case=use_case)
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/reject",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 404

    def test_unmerge_not_found_returns_404(self) -> None:
        repo = FakeCurationRepository({})
        use_case = UnmergeEntityUseCase(entity_instances=repo)
        client = self._build_client(unmerge_use_case=use_case)
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/unmerge",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 404

    # ── 200 success tests ─────────────────────────────────────────────────────

    def test_confirm_returns_200_with_affected_ids(self) -> None:
        client = self._build_client()
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/confirm",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        data = body["data"]
        assert data["entity_instance_id"] == _ENTITY_ID_A
        assert data["target_id"] == _ENTITY_ID_B

    def test_reject_returns_200_with_affected_ids(self) -> None:
        client = self._build_client()
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/reject",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        data = body["data"]
        assert data["entity_instance_id"] == _ENTITY_ID_A
        assert data["target_id"] == _ENTITY_ID_B

    def test_unmerge_returns_200_with_affected_id(self) -> None:
        client = self._build_client()
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/unmerge",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        data = body["data"]
        assert data["entity_instance_id"] == _ENTITY_ID_A

    def test_confirm_cross_importer_returns_404(self) -> None:
        """T-10-20: cross-tenant merge attempt returns 404, never 500."""
        repo = FakeCurationRepository(
            {
                _ENTITY_ID_A: _make_instance(_ENTITY_ID_A, importer_id=_IMPORTER_ID),
                _ENTITY_ID_B: _make_instance(_ENTITY_ID_B, importer_id=_OTHER_IMPORTER_ID),
            }
        )
        use_case = ConfirmMergeUseCase(entity_instances=repo)
        client = self._build_client(confirm_use_case=use_case)
        resp = client.post(
            f"/v1/entity-instances/{_ENTITY_ID_A}/merge/{_ENTITY_ID_B}/confirm",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 404

    def test_malformed_uuid_returns_422(self) -> None:
        """T-10-23: malformed UUID path param → Pydantic 422 (never 500)."""
        client = self._build_client()
        resp = client.post(
            "/v1/entity-instances/not-a-uuid/merge/also-not-a-uuid/confirm",
            headers={"X-API-Key": _make_api_key()},
        )
        assert resp.status_code == 422
