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

    async def list_injectable_edges(self, importer_id: str) -> list[dict[str, object]]:
        """Return the ONLY sanctioned auto-injection edge set for an importer.

        Scoped to the importer's knowledge_nodes, filtered to
        tier='EXTRACTED' AND is_active=True. INFERRED/AMBIGUOUS suggestion
        edges and inactive (deactivated/superseded) edges are excluded by
        construction -- no future prompt-injection consumer may bypass this
        gate to read knowledge_node_edges directly (T-30-02, suggest-only
        hard constraint: only human-confirmed EXTRACTED edges are ever
        trusted for auto-injection).
        """
        ...

    async def find_edge_by_id(self, edge_id: str) -> dict[str, object] | None:
        """Return the edge row plus its owning importer_id, or None if not found.

        The returned dict flattens `importer_id` (resolved via the
        source_node_id -> knowledge_nodes join) alongside the raw edge
        columns (`tier`, `is_active`, etc.) -- powers PromoteEdgeUseCase's
        load + tenant-ownership guard step (T-30-07).
        """
        ...

    async def promote_edge(
        self,
        *,
        edge_id: str,
        promotion: dict[str, object],
    ) -> bool:
        """CAS-guarded promotion write: flips tier to EXTRACTED, writes `promotion`.

        The update is filtered by id AND is_active=true AND tier IN
        (INFERRED, AMBIGUOUS) -- defense-in-depth so a concurrent
        promote/dismiss cannot double-apply (T-30-06). `promotion` is
        written to the promotion column, distinct from the synthesis
        provenance column, and is NEVER a delete. Returns whether a row was
        updated (False when the CAS filter matched no row -- edge already
        promoted/deactivated concurrently).
        """
        ...
