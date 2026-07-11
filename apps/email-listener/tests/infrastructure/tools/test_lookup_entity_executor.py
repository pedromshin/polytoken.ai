"""Tests for LookupEntityExecutor -- thin wrapper over find_candidates()/find_by_id() (Phase 36, TOOL-01).

7 behaviors, each independently selectable via `-k`:
  1. id hit -> self + candidates, deduped, capped at 5.
  2. id miss -> name search fallback across every active entity type, merged + ranked.
  3. cross-tenant id -> treated as not-found, falls back to name search, never leaks.
  4. empty/missing/whitespace-only name_or_id -> is_error, zero repo calls.
  5. any collaborator exception -> is_error, never raises, no internals leaked.
  6. citations[] shape -- one entry per distinct result id, server-built route.
  7. content is valid, capped JSON.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.entities.entity_instance import EntityInstance
from app.domain.entities.entity_type import EntityType
from app.domain.ports.entity_resolution_repository import EntityCandidate
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS
from app.infrastructure.tools.lookup_entity_executor import LookupEntityExecutor

_IMPORTER_ID = "imp-0000-0000-0000-000000000001"
_OTHER_IMPORTER_ID = "imp-0000-0000-0000-000000000002"
_ENTITY_TYPE_ID = "etype-0000-0000-0000-000000000001"
_OTHER_ENTITY_TYPE_ID = "etype-0000-0000-0000-000000000002"
_ENTITY_ID = "ent-0000-0000-0000-000000000001"
_CANDIDATE_ID_1 = "ent-0000-0000-0000-000000000002"
_CANDIDATE_ID_2 = "ent-0000-0000-0000-000000000003"


def _instance(
    *,
    entity_instance_id: str = _ENTITY_ID,
    importer_id: str = _IMPORTER_ID,
    entity_type_id: str = _ENTITY_TYPE_ID,
    display_name: str = "MSCU Industries Ltd",
    is_active: bool = True,
    embedding: list[float] | None = None,
) -> EntityInstance:
    return EntityInstance(
        id=entity_instance_id,
        importer_id=importer_id,
        entity_type_id=entity_type_id,
        nauta_id=None,
        source="email_extracted",
        display_name=display_name,
        identifiers={"tax_id": "123"},
        aliases=[],
        summary_text=None,
        embedding=embedding,
        is_active=is_active,
    )


def _entity_type(entity_type_id: str = _ENTITY_TYPE_ID, slug: str = "company") -> EntityType:
    return EntityType(
        id=entity_type_id,
        importer_id=None,
        slug=slug,
        label=slug.title(),
        description=None,
        is_active=True,
        embedding=None,
        fields=(),
    )


class _FakeResolutionRepo:
    """Plain (non-Mock) fake with a SYNCHRONOUS find_candidates.

    Deliberately NOT an AsyncMock: if the executor incorrectly `await`ed this
    method, every test using it would fail with a TypeError (a plain list is
    not awaitable) -- proving find_candidates is called without `await`.
    """

    def __init__(self, candidates_by_type: dict[str, list[EntityCandidate]] | None = None) -> None:
        self._candidates_by_type = candidates_by_type or {}
        self.calls: list[dict[str, Any]] = []

    def find_candidates(self, **kwargs: Any) -> list[EntityCandidate]:
        self.calls.append(kwargs)
        return self._candidates_by_type.get(kwargs["entity_type_id"], [])


def _make_executor(
    *,
    instance: EntityInstance | None = None,
    candidates_by_type: dict[str, list[EntityCandidate]] | None = None,
    entity_types: list[EntityType] | None = None,
    embedding: tuple[float, ...] = (0.1, 0.2),
) -> tuple[LookupEntityExecutor, AsyncMock, _FakeResolutionRepo, AsyncMock, AsyncMock]:
    entity_instances = AsyncMock()
    entity_instances.find_by_id.return_value = instance

    resolution_repo = _FakeResolutionRepo(candidates_by_type)

    entity_types_repo = AsyncMock()
    entity_types_repo.list_active.return_value = entity_types or []

    embedder = AsyncMock()
    embedder.embed.return_value = embedding

    executor = LookupEntityExecutor(
        entity_instances=entity_instances,
        resolution_repo=resolution_repo,
        entity_types=entity_types_repo,
        embedder=embedder,
    )
    return executor, entity_instances, resolution_repo, entity_types_repo, embedder


@pytest.mark.unit
@pytest.mark.asyncio
async def test_id_hit_returns_self_plus_candidates() -> None:
    instance = _instance()
    candidates = [
        EntityCandidate(
            entity_instance_id=_CANDIDATE_ID_1,
            display_name="MSCU Corp",
            rrf_score=0.02,
            match_type="alias",
            similarity_score=0.8,
        ),
        EntityCandidate(
            entity_instance_id=_CANDIDATE_ID_2,
            display_name="MSCU Ltd",
            rrf_score=0.015,
            match_type="semantic",
            similarity_score=0.7,
        ),
    ]
    executor, _entity_instances, resolution_repo, entity_types_repo, embedder = _make_executor(
        instance=instance,
        candidates_by_type={_ENTITY_TYPE_ID: candidates},
    )

    result = await executor.execute(
        name="lookup_entity", arguments={"name_or_id": instance.id}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    envelope = json.loads(result.content)
    results = envelope["results"]
    assert results[0]["entity_instance_id"] == instance.id
    assert results[0]["match_type"] == "id_exact"
    assert results[0]["score"] == 1.0
    ids = [r["entity_instance_id"] for r in results]
    assert ids == [instance.id, _CANDIDATE_ID_1, _CANDIDATE_ID_2]
    assert len(results) <= 5
    # id-hit path never touches the name-search collaborators.
    entity_types_repo.list_active.assert_not_called()
    embedder.embed.assert_not_called()
    assert resolution_repo.calls[0]["entity_type_id"] == _ENTITY_TYPE_ID


@pytest.mark.unit
@pytest.mark.asyncio
async def test_id_miss_falls_back_to_name_search_across_entity_types() -> None:
    entity_types = [_entity_type(_ENTITY_TYPE_ID, "company"), _entity_type(_OTHER_ENTITY_TYPE_ID, "person")]
    candidates_by_type = {
        _ENTITY_TYPE_ID: [
            EntityCandidate(
                entity_instance_id=_CANDIDATE_ID_1,
                display_name="Acme Co",
                rrf_score=0.03,
                match_type="semantic",
                similarity_score=0.9,
            )
        ],
        _OTHER_ENTITY_TYPE_ID: [
            EntityCandidate(
                entity_instance_id=_CANDIDATE_ID_2,
                display_name="Acme Person",
                rrf_score=0.01,
                match_type="alias",
                similarity_score=0.5,
            )
        ],
    }
    executor, _entity_instances, resolution_repo, entity_types_repo, embedder = _make_executor(
        instance=None, candidates_by_type=candidates_by_type, entity_types=entity_types
    )

    result = await executor.execute(name="lookup_entity", arguments={"name_or_id": "Acme"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    results = envelope["results"]
    assert [r["entity_instance_id"] for r in results] == [_CANDIDATE_ID_1, _CANDIDATE_ID_2]
    assert len(resolution_repo.calls) == 2
    embedder.embed.assert_awaited_once()
    entity_types_repo.list_active.assert_awaited_once_with(_IMPORTER_ID)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cross_tenant_id_falls_back_to_name_search_without_leaking() -> None:
    other_tenant_instance = _instance(importer_id=_OTHER_IMPORTER_ID, display_name="Secret Corp")
    entity_types = [_entity_type()]
    candidates_by_type = {
        _ENTITY_TYPE_ID: [
            EntityCandidate(
                entity_instance_id=_CANDIDATE_ID_1,
                display_name="Public Co",
                rrf_score=0.02,
                match_type="semantic",
                similarity_score=0.8,
            )
        ]
    }
    executor, *_rest = _make_executor(
        instance=other_tenant_instance, candidates_by_type=candidates_by_type, entity_types=entity_types
    )

    result = await executor.execute(
        name="lookup_entity", arguments={"name_or_id": other_tenant_instance.id}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    envelope = json.loads(result.content)
    ids = [r["entity_instance_id"] for r in envelope["results"]]
    assert other_tenant_instance.id not in ids
    assert "Secret Corp" not in result.content
    assert ids == [_CANDIDATE_ID_1]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_name_or_id_returns_error_without_repo_calls() -> None:
    for bad_arguments in ({}, {"name_or_id": None}, {"name_or_id": ""}, {"name_or_id": "   "}):
        executor, entity_instances, resolution_repo, entity_types_repo, embedder = _make_executor()

        result = await executor.execute(name="lookup_entity", arguments=bad_arguments, importer_id=_IMPORTER_ID)

        assert result.is_error is True
        assert result.content
        entity_instances.find_by_id.assert_not_called()
        entity_types_repo.list_active.assert_not_called()
        embedder.embed.assert_not_called()
        assert resolution_repo.calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_repository_exception_returns_error_never_raises() -> None:
    executor, entity_instances, _resolution_repo, _entity_types_repo, _embedder = _make_executor()
    entity_instances.find_by_id.side_effect = RuntimeError("db exploded, connection string: postgres://secret")

    result = await executor.execute(name="lookup_entity", arguments={"name_or_id": "Acme"}, importer_id=_IMPORTER_ID)

    assert result.is_error is True
    assert result.content
    assert "db exploded" not in result.content
    assert "postgres://" not in result.content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_citations_shape_matches_results() -> None:
    instance = _instance()
    candidates = [
        EntityCandidate(
            entity_instance_id=_CANDIDATE_ID_1,
            display_name="MSCU Corp",
            rrf_score=0.02,
            match_type="alias",
            similarity_score=0.8,
        )
    ]
    executor, *_rest = _make_executor(instance=instance, candidates_by_type={_ENTITY_TYPE_ID: candidates})

    result = await executor.execute(
        name="lookup_entity", arguments={"name_or_id": instance.id}, importer_id=_IMPORTER_ID
    )

    envelope = json.loads(result.content)
    result_ids = {r["entity_instance_id"] for r in envelope["results"]}
    citation_ids = {c["id"] for c in envelope["citations"]}
    assert citation_ids == result_ids
    assert len(envelope["citations"]) == len(result_ids)
    for citation in envelope["citations"]:
        assert citation["kind"] == "entity"
        assert citation["route"] == f"/entities/{citation['id']}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_content_is_capped_json() -> None:
    instance = _instance()
    executor, *_rest = _make_executor(instance=instance)

    result = await executor.execute(
        name="lookup_entity", arguments={"name_or_id": instance.id}, importer_id=_IMPORTER_ID
    )

    parsed = json.loads(result.content)
    assert isinstance(parsed, dict)
    assert "results" in parsed
    assert "citations" in parsed
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
