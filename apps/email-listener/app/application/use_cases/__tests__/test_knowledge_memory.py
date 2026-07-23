"""Tests for chat/knowledge_memory — canon-memory injection + suggest-only write-back (AI-06).

Behaviors (req 5):
  build_knowledge_memory_injection:
    1.  selects CANON (EXTRACTED) edges for the conversation and injects them,
        EXCLUDING suggested-tier edges (the fake models list_injectable_edges'
        real EXTRACTED-only gate; INFERRED edges in the store never surface)
    2.  the citation part maps to REAL /knowledge node ids
    3.  retrieval performs ZERO writes (read-only)
    4.  fail-open: unwired knowledge_graph -> byte-identical prompt, no part
    5.  a resolved source node that is itself non-canon/inactive is dropped
        (defensive belt)
    6.  entity profiles from search_nodes (EXTRACTED-only) are injected + cited
  propose_suggested_edge:
    7.  writes at SUGGESTED (INFERRED) tier through insert_edge
    8.  NEVER calls promote_edge and NEVER writes EXTRACTED (promotion gate
        preserved -> no auto-canonize)
    9.  unwired -> no-op False
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import pytest

from app.application.use_cases.chat.knowledge_memory import (
    build_knowledge_memory_injection,
    propose_suggested_edge,
)


class FakeKnowledgeGraph:
    """In-memory fake modeling the REAL repository's canon gates + recording writes.

    `list_injectable_edges` returns ONLY EXTRACTED+active edges (mirrors the
    real SupabaseKnowledgeGraphRepository gate, T-30-02) even though the store
    holds suggested edges too — proving the caller can never reach them.
    `search_nodes` returns ONLY EXTRACTED nodes (migration 0029 belt).
    Every write method appends to `writes` so tests can assert read-only /
    suggest-only invariants.
    """

    def __init__(
        self,
        *,
        edges: list[dict[str, object]] | None = None,
        nodes: dict[str, dict[str, object]] | None = None,
        search_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self._edges = edges or []
        self._nodes = nodes or {}
        self._search_rows = search_rows or []
        self.writes: list[tuple[str, dict[str, object]]] = []
        self.promote_calls: list[str] = []

    async def list_injectable_edges(self, importer_id: str) -> list[dict[str, object]]:
        # THE gate: EXTRACTED + active only.
        return [e for e in self._edges if e.get("tier") == "EXTRACTED" and e.get("is_active") is True]

    async def get_node_by_id(self, node_id: str) -> dict[str, object] | None:
        return self._nodes.get(node_id)

    async def search_nodes(
        self, *, query_text: str, query_embedding: list[float] | None, importer_id: str, limit: int = 8
    ) -> list[dict[str, object]]:
        # EXTRACTED-only by construction (view belt).
        return [r for r in self._search_rows if r.get("tier") == "EXTRACTED"][:limit]

    async def insert_edge(self, **kwargs: object) -> None:
        self.writes.append(("insert_edge", dict(kwargs)))

    async def upsert_node(self, **kwargs: object) -> str:
        self.writes.append(("upsert_node", dict(kwargs)))
        return "written"

    async def deactivate_edges_for_node(self, source_node_id: str) -> None:
        self.writes.append(("deactivate_edges_for_node", {"source_node_id": source_node_id}))

    async def promote_edge(self, *, edge_id: str, promotion: dict[str, object]) -> bool:
        self.promote_calls.append(edge_id)
        self.writes.append(("promote_edge", {"edge_id": edge_id}))
        return True

    # --- Protocol methods AI-06 never exercises (present so the fake
    #     structurally satisfies KnowledgeGraphRepository for mypy). ---
    async def find_active_node(
        self, importer_id: str, scope: str, scope_ref_id: str | None
    ) -> dict[str, object] | None:
        raise NotImplementedError

    async def find_active_edges_for_node(self, source_node_id: str) -> list[dict[str, object]]:
        raise NotImplementedError

    async def find_edge_by_id(self, edge_id: str) -> dict[str, object] | None:
        raise NotImplementedError

    async def list_captured_sources_for_conversations(
        self, *, importer_id: str, conversation_ids: Sequence[str], limit: int = 20
    ) -> list[dict[str, object]]:
        raise NotImplementedError

    async def expand_neighbours(
        self, *, node_id: str, importer_id: str, max_depth: int = 2, node_budget: int = 50
    ) -> dict[str, object]:
        raise NotImplementedError


def _canon_edge(edge_id: str, source_node_id: str) -> dict[str, object]:
    return {
        "id": edge_id,
        "source_node_id": source_node_id,
        "target_ref_id": "tgt-1",
        "target_ref_type": "entity_instance",
        "relation_type": "ships_via",
        "tier": "EXTRACTED",
        "is_active": True,
    }


def _suggested_edge(edge_id: str, source_node_id: str) -> dict[str, object]:
    edge = _canon_edge(edge_id, source_node_id)
    edge["tier"] = "INFERRED"
    return edge


def _node(node_id: str, tier: str = "EXTRACTED") -> dict[str, object]:
    return {"id": node_id, "title": f"Node {node_id}", "content": f"content {node_id}", "tier": tier, "is_active": True}


# ---------------------------------------------------------------------------
# build_knowledge_memory_injection
# ---------------------------------------------------------------------------
@pytest.mark.unit
@pytest.mark.asyncio
async def test_selects_canon_edges_and_excludes_suggested() -> None:
    kg = FakeKnowledgeGraph(
        edges=[_canon_edge("e-canon", "node-canon"), _suggested_edge("e-sugg", "node-sugg")],
        nodes={"node-canon": _node("node-canon"), "node-sugg": _node("node-sugg")},
    )
    result = await build_knowledge_memory_injection(
        base_system_prompt="BASE",
        knowledge_graph=kg,
        importer_id="imp-1",
        query_text="",
    )
    assert "AGENT MEMORY" in result.augmented_prompt
    assert "[knowledge:node-canon]" in result.augmented_prompt
    # The suggested-tier edge's node is never gated in -> never cited/injected.
    assert "node-sugg" not in result.augmented_prompt


@pytest.mark.unit
@pytest.mark.asyncio
async def test_citation_part_maps_to_real_node_ids() -> None:
    kg = FakeKnowledgeGraph(
        edges=[_canon_edge("e-canon", "node-canon")],
        nodes={"node-canon": _node("node-canon")},
    )
    result = await build_knowledge_memory_injection(
        base_system_prompt="BASE", knowledge_graph=kg, importer_id="imp-1", query_text=""
    )
    assert result.citation_part is not None
    assert result.citation_part["toolName"] == "knowledge_memory"
    assert result.citation_part["type"] == "tool_invocation_result"
    envelope = json.loads(str(result.citation_part["content"]))
    ids = [s["id"] for s in envelope["sources"]]
    assert "node-canon" in ids
    assert envelope["sources"][0]["url"] == "/knowledge?node=node-canon"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_retrieval_performs_zero_writes() -> None:
    kg = FakeKnowledgeGraph(
        edges=[_canon_edge("e-canon", "node-canon")],
        nodes={"node-canon": _node("node-canon")},
        search_rows=[_node("prof-1")],
    )
    await build_knowledge_memory_injection(
        base_system_prompt="BASE", knowledge_graph=kg, importer_id="imp-1", query_text="acme shipment"
    )
    assert kg.writes == []
    assert kg.promote_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fail_open_when_unwired() -> None:
    result = await build_knowledge_memory_injection(
        base_system_prompt="BASE", knowledge_graph=None, importer_id="imp-1", query_text="q"
    )
    assert result.augmented_prompt == "BASE"
    assert result.citation_part is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_non_canon_resolved_source_node_is_dropped() -> None:
    # The gate returned a canon edge, but the resolved source node is itself
    # non-canon (defensive belt in _resolve_canon_facts) -> dropped.
    kg = FakeKnowledgeGraph(
        edges=[_canon_edge("e", "node-x")],
        nodes={"node-x": _node("node-x", tier="INFERRED")},
    )
    result = await build_knowledge_memory_injection(
        base_system_prompt="BASE", knowledge_graph=kg, importer_id="imp-1", query_text=""
    )
    assert "node-x" not in result.augmented_prompt
    assert result.augmented_prompt == "BASE"  # nothing else to inject
    assert result.citation_part is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_entity_profiles_from_search_are_injected_and_cited() -> None:
    kg = FakeKnowledgeGraph(
        edges=[],
        search_rows=[_node("prof-1"), _node("prof-nonc", tier="INFERRED")],
    )
    result = await build_knowledge_memory_injection(
        base_system_prompt="BASE", knowledge_graph=kg, importer_id="imp-1", query_text="acme"
    )
    assert "[knowledge:prof-1]" in result.augmented_prompt
    assert "prof-nonc" not in result.augmented_prompt  # non-EXTRACTED filtered by the fake gate


# ---------------------------------------------------------------------------
# propose_suggested_edge (suggest-only write-back)
# ---------------------------------------------------------------------------
@pytest.mark.unit
@pytest.mark.asyncio
async def test_propose_writes_suggested_tier_never_promotes() -> None:
    kg = FakeKnowledgeGraph()
    ok = await propose_suggested_edge(
        kg,
        source_node_id="node-a",
        target_ref_id="node-b",
        target_ref_type="entity_instance",
        relation_type="related",
        rationale="surfaced in chat",
    )
    assert ok is True
    assert len(kg.writes) == 1
    name, kwargs = kg.writes[0]
    assert name == "insert_edge"
    assert kwargs["tier"] == "INFERRED"
    assert kwargs["tier"] != "EXTRACTED"
    # The human promotion gate is preserved: no auto-canonize.
    assert kg.promote_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_propose_unwired_is_noop() -> None:
    assert await propose_suggested_edge(
        None, source_node_id="a", target_ref_id="b", target_ref_type="t", relation_type="r"
    ) is False
