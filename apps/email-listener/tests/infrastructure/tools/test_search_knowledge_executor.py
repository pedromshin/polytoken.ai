"""Tests for SearchKnowledgeExecutor -- mode-dispatching wrapper over 37-01's read side (TOOL-03/TOOL-04).

11 behaviors, each independently selectable via `-k`:
  1.  search happy path -> embeds, calls search_nodes, EXTRACTED results truncated + cited.
  2.  embedder raises -> degrades to trgm-only (query_embedding=None), notes it, never fails.
  3.  happy-path envelope OMITS the degraded key entirely (terse field omission, not `false`).
  4.  BELT 2 (search) -> a hostile non-EXTRACTED row with non-null title/content still gets NO label key.
  5.  expand happy path -> hardcoded depth/budget, nodes/edges/truncated mapped, cited per node.
  6.  BELT 2 (expand) -> same defensive label omission on a hostile AMBIGUOUS node.
  7.  empty/missing/blank query (search) -> is_error, zero collaborator calls.
  8.  missing/blank node_id (expand) -> is_error, zero collaborator calls.
  9.  unknown/missing mode -> is_error, zero collaborator calls.
  10. repository exception -> is_error, never raises, no internals leaked.
  11. content is capped, valid JSON (cap_tool_output convention, mirrors 36-01/36-02).

The two belt-2 tests (4 and 6) are the critical TOOL-04 proof: `_belt_two_label`
must be the SOLE gate on `title`/`content`, keyed on `tier == "EXTRACTED"` --
independent of 37-01's SQL view (belt 1) and RPC filters (belt 3). Both are
selectable together via `-k "belt_two or field_omission"`.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.ports.knowledge_graph_repository import (
    DEFAULT_EXPAND_NODE_BUDGET,
    DEFAULT_SEARCH_LIMIT,
    MAX_EXPAND_DEPTH,
)
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS
from app.infrastructure.tools.envelope import MAX_RESULT_FIELD_CHARS
from app.infrastructure.tools.search_knowledge_executor import SearchKnowledgeExecutor

_IMPORTER_ID = "imp-0000-0000-0000-000000000001"
_NODE_ID = "node-0000-0000-0000-000000000001"
_HOSTILE_TITLE = "LEAKED-SUGGESTION-TEXT-7c2e91-DO-NOT-SURFACE"


def _node_row(
    node_id: str,
    *,
    tier: str = "EXTRACTED",
    title: str | None = "Confirmed knowledge title",
    content: str | None = None,
    scope_ref_id: str | None = "region-0000-0000-0000-000000000001",
    confidence: float = 0.9,
) -> dict[str, object]:
    return {
        "id": node_id,
        "title": title,
        "content": content,
        "scope": "region",
        "scope_ref_id": scope_ref_id,
        "tier": tier,
        "confidence": confidence,
    }


def _edge_row(
    edge_id: str,
    *,
    source_node_id: str,
    target_ref_id: str,
    relation_type: str = "mentions",
    tier: str = "EXTRACTED",
    confidence: float = 0.8,
) -> dict[str, object]:
    return {
        "id": edge_id,
        "source_node_id": source_node_id,
        "target_ref_id": target_ref_id,
        "relation_type": relation_type,
        "tier": tier,
        "confidence": confidence,
    }


def _make_executor(
    *,
    search_rows: list[dict[str, object]] | None = None,
    expand_result: dict[str, object] | None = None,
    embedding: tuple[float, ...] = (0.1, 0.2),
) -> tuple[SearchKnowledgeExecutor, AsyncMock, AsyncMock]:
    knowledge = AsyncMock()
    knowledge.search_nodes.return_value = search_rows if search_rows is not None else []
    knowledge.expand_neighbours.return_value = (
        expand_result if expand_result is not None else {"nodes": [], "edges": [], "truncated": False}
    )

    embedder = AsyncMock()
    embedder.embed.return_value = embedding

    executor = SearchKnowledgeExecutor(knowledge=knowledge, embedder=embedder)
    return executor, knowledge, embedder


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_search_mode_happy_path_embeds_searches_truncates_and_cites() -> None:
    long_title = "T" * (MAX_RESULT_FIELD_CHARS + 50)
    search_rows = [
        _node_row("node-a", title=long_title, confidence=0.95),
        _node_row("node-b", title="Short title", scope_ref_id="region-b", confidence=0.4),
    ]
    executor, knowledge, embedder = _make_executor(search_rows=search_rows)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking terms"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    embedder.embed.assert_awaited_once_with(text="booking terms")
    knowledge.search_nodes.assert_awaited_once_with(
        query_text="booking terms",
        query_embedding=[0.1, 0.2],
        importer_id=_IMPORTER_ID,
        limit=DEFAULT_SEARCH_LIMIT,
    )

    envelope = json.loads(result.content)
    assert envelope["mode"] == "search"
    results = envelope["results"]
    assert [r["node_id"] for r in results] == ["node-a", "node-b"]

    first = results[0]
    assert first["label"].startswith("T" * MAX_RESULT_FIELD_CHARS)
    assert first["label"].endswith("[truncated]"), "labels must go through truncate_field (300-char Fork 5 cap)"
    assert first["tier"] == "EXTRACTED"
    assert first["confidence"] == 0.95
    assert first["source_region_id"] == "region-0000-0000-0000-000000000001"
    assert results[1]["label"] == "Short title"
    assert results[1]["source_region_id"] == "region-b"

    citations = envelope["citations"]
    assert {c["id"] for c in citations} == {"node-a", "node-b"}
    for citation in citations:
        assert citation["kind"] == "knowledge"
        assert citation["route"] == f"/knowledge?focus={citation['id']}"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_search_mode_embedder_failure_degrades_to_trgm_only_and_notes_it() -> None:
    executor, knowledge, embedder = _make_executor(search_rows=[_node_row("node-a")])
    embedder.embed.side_effect = RuntimeError("bedrock titan unavailable")

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False, "an embedding failure must NEVER fail the tool (degrade, never silent)"
    knowledge.search_nodes.assert_awaited_once_with(
        query_text="booking",
        query_embedding=None,
        importer_id=_IMPORTER_ID,
        limit=DEFAULT_SEARCH_LIMIT,
    )
    envelope = json.loads(result.content)
    assert envelope["embedding_degraded"] is True


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_search_mode_happy_path_envelope_omits_degraded_key() -> None:
    executor, _knowledge, _embedder = _make_executor(search_rows=[_node_row("node-a")])

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking"}, importer_id=_IMPORTER_ID
    )

    envelope = json.loads(result.content)
    assert "embedding_degraded" not in envelope, "omit the key entirely when not degraded, never `false`"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_search_mode_belt_two_omits_label_for_non_extracted_row() -> None:
    # Hostile fixture: simulates a hypothetical regression in 37-01's view (belt 1)
    # or RPC filter (belt 3) -- a non-EXTRACTED row arriving WITH non-null text.
    search_rows = [
        _node_row("node-ok", title="Confirmed title"),
        _node_row("node-bad", tier="INFERRED", title=_HOSTILE_TITLE, content=_HOSTILE_TITLE, confidence=0.3),
    ]
    executor, _knowledge, _embedder = _make_executor(search_rows=search_rows)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    envelope = json.loads(result.content)
    bad = next(r for r in envelope["results"] if r["node_id"] == "node-bad")
    assert "label" not in bad, "belt 2: the label KEY must be absent (not null) for a non-EXTRACTED row"
    assert bad["tier"] == "INFERRED"
    assert bad["confidence"] == 0.3
    assert bad["source_region_id"] == "region-0000-0000-0000-000000000001"
    assert _HOSTILE_TITLE not in result.content, "non-EXTRACTED text must never reach the envelope at all"
    ok = next(r for r in envelope["results"] if r["node_id"] == "node-ok")
    assert ok["label"] == "Confirmed title"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_expand_mode_happy_path_bounded_expand_maps_nodes_edges_and_cites() -> None:
    expand_result: dict[str, object] = {
        "nodes": [
            _node_row(_NODE_ID, title="Seed node"),
            _node_row("node-n1", title="Neighbour node", scope_ref_id="region-n1", confidence=0.7),
        ],
        "edges": [_edge_row("edge-1", source_node_id=_NODE_ID, target_ref_id="node-n1")],
        "truncated": True,
    }
    executor, knowledge, embedder = _make_executor(expand_result=expand_result)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "expand", "node_id": _NODE_ID}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    embedder.embed.assert_not_called()
    knowledge.expand_neighbours.assert_awaited_once_with(
        node_id=_NODE_ID,
        importer_id=_IMPORTER_ID,
        max_depth=MAX_EXPAND_DEPTH,
        node_budget=DEFAULT_EXPAND_NODE_BUDGET,
    )

    envelope = json.loads(result.content)
    assert envelope["mode"] == "expand"
    assert envelope["truncated"] is True

    nodes = envelope["nodes"]
    assert [n["node_id"] for n in nodes] == [_NODE_ID, "node-n1"]
    assert nodes[0]["label"] == "Seed node"
    assert nodes[1]["label"] == "Neighbour node"
    assert nodes[1]["source_region_id"] == "region-n1"

    edges = envelope["edges"]
    assert edges == [
        {
            "edge_id": "edge-1",
            "source_node_id": _NODE_ID,
            "target_node_id": "node-n1",
            "relation_type": "mentions",
            "tier": "EXTRACTED",
            "confidence": 0.8,
        }
    ]

    citations = envelope["citations"]
    assert {c["id"] for c in citations} == {_NODE_ID, "node-n1"}
    for citation in citations:
        assert citation["kind"] == "knowledge"
        assert citation["route"] == f"/knowledge?focus={citation['id']}"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_expand_mode_belt_two_omits_label_for_non_extracted_node() -> None:
    # Same hostile-repository simulation as the search-mode belt-2 test, on the expand path.
    expand_result: dict[str, object] = {
        "nodes": [
            _node_row(_NODE_ID, title="Seed node"),
            _node_row("node-sus", tier="AMBIGUOUS", title=_HOSTILE_TITLE, confidence=0.2),
        ],
        "edges": [],
        "truncated": False,
    }
    executor, _knowledge, _embedder = _make_executor(expand_result=expand_result)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "expand", "node_id": _NODE_ID}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    envelope = json.loads(result.content)
    sus = next(n for n in envelope["nodes"] if n["node_id"] == "node-sus")
    assert "label" not in sus, "belt 2: the label KEY must be absent (not null) for a non-EXTRACTED node"
    assert sus["tier"] == "AMBIGUOUS"
    assert sus["confidence"] == 0.2
    assert _HOSTILE_TITLE not in result.content


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_search_mode_empty_query_returns_error_without_repo_calls() -> None:
    for bad_arguments in (
        {"mode": "search"},
        {"mode": "search", "query": None},
        {"mode": "search", "query": ""},
        {"mode": "search", "query": "   "},
    ):
        executor, knowledge, embedder = _make_executor()

        result = await executor.execute(name="search_knowledge", arguments=bad_arguments, importer_id=_IMPORTER_ID)

        assert result.is_error is True
        assert result.content
        embedder.embed.assert_not_called()
        knowledge.search_nodes.assert_not_called()
        knowledge.expand_neighbours.assert_not_called()


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_expand_mode_empty_node_id_returns_error_without_repo_calls() -> None:
    for bad_arguments in (
        {"mode": "expand"},
        {"mode": "expand", "node_id": None},
        {"mode": "expand", "node_id": ""},
        {"mode": "expand", "node_id": "   "},
    ):
        executor, knowledge, embedder = _make_executor()

        result = await executor.execute(name="search_knowledge", arguments=bad_arguments, importer_id=_IMPORTER_ID)

        assert result.is_error is True
        assert result.content
        embedder.embed.assert_not_called()
        knowledge.search_nodes.assert_not_called()
        knowledge.expand_neighbours.assert_not_called()


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_unknown_or_missing_mode_returns_error_without_repo_calls() -> None:
    for bad_arguments in ({}, {"mode": None}, {"mode": "delete"}, {"mode": "SEARCH", "query": "booking"}):
        executor, knowledge, embedder = _make_executor()

        result = await executor.execute(
            name="search_knowledge",
            arguments=bad_arguments,  # type: ignore[arg-type]
            importer_id=_IMPORTER_ID,
        )

        assert result.is_error is True
        assert result.content
        embedder.embed.assert_not_called()
        knowledge.search_nodes.assert_not_called()
        knowledge.expand_neighbours.assert_not_called()


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_repository_exception_returns_error_never_raises() -> None:
    # search path
    executor, knowledge, _embedder = _make_executor()
    knowledge.search_nodes.side_effect = RuntimeError("db exploded, connection string: postgres://secret")

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is True
    assert result.content
    assert "db exploded" not in result.content
    assert "postgres://" not in result.content

    # expand path
    executor2, knowledge2, _embedder2 = _make_executor()
    knowledge2.expand_neighbours.side_effect = RuntimeError("db exploded, connection string: postgres://secret")

    result2 = await executor2.execute(
        name="search_knowledge", arguments={"mode": "expand", "node_id": _NODE_ID}, importer_id=_IMPORTER_ID
    )

    assert result2.is_error is True
    assert result2.content
    assert "db exploded" not in result2.content
    assert "postgres://" not in result2.content


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_content_is_capped_json() -> None:
    executor, _knowledge, _embedder = _make_executor(search_rows=[_node_row("node-a")])

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "booking"}, importer_id=_IMPORTER_ID
    )

    parsed: Any = json.loads(result.content)
    assert isinstance(parsed, dict)
    assert "results" in parsed
    assert "citations" in parsed
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
