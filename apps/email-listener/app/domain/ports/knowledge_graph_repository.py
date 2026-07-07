"""KnowledgeGraphRepository port -- domain abstraction over knowledge-graph persistence.

Backs the KnowledgeSynthesizer (D-13 materialization): node upsert/reuse and
tiered, provenance-carrying edge writes with a supersede-safe (never-delete)
deactivate primitive. Plain dict/str param+return types only -- the domain
layer must not import Supabase (verified by lint-imports rule).
"""

from __future__ import annotations

from typing import Protocol


class KnowledgeGraphRepository(Protocol):
    """Port for persisting and retrieving knowledge_nodes / knowledge_node_edges rows."""

    async def upsert_node(
        self,
        *,
        importer_id: str,
        title: str,
        content: str | None,
        scope: str,
        scope_ref_id: str | None,
        scope_ref_type: str | None,
        source: str,
        tier: str,
        embedding: list[float] | None = None,
    ) -> str:
        """Insert or update a knowledge_nodes row; returns the persisted node id."""
        ...

    async def find_active_node(
        self,
        importer_id: str,
        scope: str,
        scope_ref_id: str | None,
    ) -> dict[str, object] | None:
        """Return the active node matching (importer_id, scope, scope_ref_id), or None.

        Used for node reuse -- avoids creating duplicate nodes for the same
        scope on repeated confirmations.
        """
        ...

    async def insert_edge(
        self,
        *,
        source_node_id: str,
        target_ref_id: str | None,
        target_ref_type: str | None,
        relation_type: str,
        tier: str,
        source: str,
        provenance: dict[str, object] | None,
    ) -> None:
        """Insert a knowledge_node_edges row with an explicit tier and is_active=True.

        `provenance` carries the OCR token-polygon grounding
        ({component_id, page_index, polygon, tokens}) when derived from a
        confirmed region.
        """
        ...

    async def deactivate_edges_for_node(self, source_node_id: str) -> None:
        """Set is_active=False on all active edges for the given source node.

        The supersede primitive -- NEVER deletes rows (audit trail preserved).
        """
        ...

    async def find_active_edges_for_node(self, source_node_id: str) -> list[dict[str, object]]:
        """Return all active edges for the given source node."""
        ...
