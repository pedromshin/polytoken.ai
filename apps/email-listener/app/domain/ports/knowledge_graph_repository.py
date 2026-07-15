"""KnowledgeGraphRepository port -- domain abstraction over knowledge-graph persistence.

Backs the KnowledgeSynthesizer (D-13 materialization): node upsert/reuse and
tiered, provenance-carrying edge writes with a supersede-safe (never-delete)
deactivate primitive. Plain dict/str param+return types only -- the domain
layer must not import Supabase (verified by lint-imports rule).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Sequence

# Fork 5's top-8 default result count for search_nodes (Phase 37 -- TOOL-03/TOOL-04).
DEFAULT_SEARCH_LIMIT = 8

# expand_neighbours BFS bounds (Phase 37 -- TOOL-03/TOOL-04). Mirrors expand.ts's
# MIN_DEPTH/MAX_DEPTH/EXPAND_BUDGET_CAP (Phase 32 T-32-01 precedent).
MIN_EXPAND_DEPTH = 1
MAX_EXPAND_DEPTH = 2
DEFAULT_EXPAND_NODE_BUDGET = 50

# Phase 54-05 (CLUS-06): bounded default read count for captured-source
# cluster-context lookups.
DEFAULT_CAPTURED_SOURCES_LIMIT = 8


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

    async def get_node_by_id(self, node_id: str) -> dict[str, object] | None:
        """Return the knowledge_nodes row matching node_id, tier-agnostic, or None if not found.

        Phase 56-04 (RCNV-04, D-56-A): the DIRECT read backing an explicit
        user-drawn `knowledge_node`-typed context edge — deliberately reads
        past the automatic-injection allowlist gate (`list_injectable_edges`,
        EXTRACTED-tier-only) this port also exposes, since a single
        addressed, user-selected edge is a structurally different concern
        than blind auto-injection into every prompt (see that method's own
        docstring). Does not itself fail-open on a read failure (mirrors
        `find_active_node`/`find_edge_by_id`'s un-wrapped posture on this
        same port) — the caller wraps this in its own fail-open dispatch.
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

    async def search_nodes(
        self,
        *,
        query_text: str,
        query_embedding: list[float] | None,
        importer_id: str,
        limit: int = DEFAULT_SEARCH_LIMIT,
    ) -> list[dict[str, object]]:
        """BlendedRAG search over the extracted_only view (migration 0029), RRF(k=60)-fused.

        Rows are ALWAYS EXTRACTED-tier -- belt 3, enforced at the RPC level
        (both `match_knowledge_nodes_by_embedding` and
        `match_knowledge_nodes_by_trgm` filter tier = 'EXTRACTED' explicitly,
        on top of the view's own belt-1 text-nulling). Returned dicts carry
        `id`/`title`/`content`/`scope`/`scope_ref_id`/`tier`/`confidence`.

        Vector arm is skipped (never called) when `query_embedding` is None;
        the lexical arm always runs. Either arm degrades to an empty result
        independently on an RPC failure -- this method never raises.

        Callers (the search_knowledge ToolExecutor) MUST still apply their
        own field-omission belt before these rows ever enter a prompt --
        this port alone is not the final defense (defense-in-depth, mirrors
        the existing `list_injectable_edges` / `ToolExecutor.execute`
        docstring convention in this codebase).
        """
        ...

    async def list_captured_sources_for_conversations(
        self,
        *,
        importer_id: str,
        conversation_ids: Sequence[str],
        limit: int = DEFAULT_CAPTURED_SOURCES_LIMIT,
    ) -> list[dict[str, object]]:
        """Return captured web-source nodes attached to any of conversation_ids (Phase 54-05, CLUS-06).

        A "captured source" is a knowledge_nodes row written by
        SourceCaptureHandler (Phase 54-03): source='web_search_capture',
        scope_ref_type='web_source'. Resolved via the active
        knowledge_node_edges rows whose target_ref_type='chat_conversation'
        AND target_ref_id IN conversation_ids, joined back to their source
        knowledge_nodes row — scoped to importer_id (defense-in-depth
        against cross-tenant bleed, T-54-05-02). Bounded by limit. Never
        raises (fail-open) — degrades to [] on any read failure.
        """
        ...

    async def expand_neighbours(
        self,
        *,
        node_id: str,
        importer_id: str,
        max_depth: int = MAX_EXPAND_DEPTH,
        node_budget: int = DEFAULT_EXPAND_NODE_BUDGET,
    ) -> dict[str, object]:
        """Bounded (<=2-hop, <=node_budget-node) breadth-first walk from `node_id`.

        Tenant-scoped to `importer_id` at EVERY hop (not just the seed) --
        mirrors T-32-02. Fail-closed (empty result, zero further queries) on
        an unknown, inactive, or cross-tenant seed -- mirrors T-32-03, never
        leaks whether a foreign-tenant node id exists.

        Returned shape: `{"nodes": list[dict], "edges": list[dict],
        "truncated": bool}`. Node dicts are read through
        `knowledge_nodes_extracted_only` (migration 0029), so `title`/
        `content` are populated ONLY for EXTRACTED-tier rows -- structural,
        not a runtime check. Callers MUST still apply their own
        field-omission belt before these rows ever enter a prompt (same
        defense-in-depth note as `search_nodes`).
        """
        ...
