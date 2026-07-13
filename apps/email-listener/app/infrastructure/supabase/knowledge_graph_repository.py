"""SupabaseKnowledgeGraphRepository — implements KnowledgeGraphRepository port.

Persists knowledge_nodes / knowledge_node_edges rows: tiered, provenance-
carrying edges with supersede-safe (never-delete) is_active transitions.
Follows the component_repository idiom: module-level _to_row builders
wrapped in strip_nul, table().upsert/insert/update().execute() call shapes.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from typing import Any, cast

from supabase import Client

from app.domain.ports.knowledge_graph_repository import (
    DEFAULT_CAPTURED_SOURCES_LIMIT,
    DEFAULT_EXPAND_NODE_BUDGET,
    DEFAULT_SEARCH_LIMIT,
    MAX_EXPAND_DEPTH,
    MIN_EXPAND_DEPTH,
)
from app.infrastructure.supabase.sanitize import strip_nul

logger = logging.getLogger(__name__)

# Captured-source literal contract (Phase 54-03's SourceCaptureHandler writes
# these exact literals; Phase 54-02's WebSearchExecutor establishes the
# "SHARED CONTRACT" note this mirrors) -- redeclared locally per this file's
# self-contained-repo convention (see module docstring above).
_CAPTURED_SOURCE_SOURCE = "web_search_capture"
_CAPTURED_SOURCE_SCOPE_REF_TYPE = "web_source"
_CAPTURED_SOURCE_TARGET_REF_TYPE = "chat_conversation"

# ---------------------------------------------------------------------------
# RRF helpers (pure functions -- testable in isolation). Copied verbatim from
# entity_resolution_repository.py's pattern rather than imported cross-module
# (this codebase's established convention: each Supabase repo file is
# self-contained).
# ---------------------------------------------------------------------------

_K_DEFAULT = 60

_VECTOR_RPC = "match_knowledge_nodes_by_embedding"
_TRGM_RPC = "match_knowledge_nodes_by_trgm"
_SEARCH_CANDIDATE_LIMIT = 20


def _rrf_score(rank: int, k: int = _K_DEFAULT) -> float:
    """Reciprocal rank fusion score: 1 / (k + rank). rank is 0-based (rank=0 is the top result)."""
    return 1.0 / (k + rank)


def _merge_rrf(ranked_lists: list[list[str]]) -> list[str]:
    """Merge multiple ranked lists of ids using RRF.

    Returns a deduplicated list of ids sorted by descending summed RRF scores.
    Handles empty lists safely.
    """
    scores: dict[str, float] = {}
    for ranked in ranked_lists:
        for rank, item_id in enumerate(ranked):
            scores[item_id] = scores.get(item_id, 0.0) + _rrf_score(rank)
    return sorted(scores, key=lambda eid: scores[eid], reverse=True)


def _clamp_depth(max_depth: int) -> int:
    """Clamp max_depth to [MIN_EXPAND_DEPTH, MAX_EXPAND_DEPTH]. Mirrors expand.ts's clampDepth."""
    if max_depth < MIN_EXPAND_DEPTH:
        return MIN_EXPAND_DEPTH
    if max_depth > MAX_EXPAND_DEPTH:
        return MAX_EXPAND_DEPTH
    return max_depth


def _filter_edges_to_node_set(edges: Iterable[dict[str, Any]], kept_ids: set[str]) -> list[dict[str, Any]]:
    """Keep only edges whose source_node_id AND target_ref_id (when non-null) are both in kept_ids.

    Mirrors expand.ts's final scopedEdges filter / capBudget's edge-drop step
    -- the definitive tenant/existence boundary for edges (an edge touching
    an id that failed view resolution, or fell outside the budget cap, is
    silently dropped).
    """
    return [
        edge
        for edge in edges
        if str(edge.get("source_node_id")) in kept_ids
        and (edge.get("target_ref_id") is None or str(edge.get("target_ref_id")) in kept_ids)
    ]


def _node_to_row(
    *,
    importer_id: str,
    title: str,
    content: str | None,
    scope: str,
    scope_ref_id: str | None,
    scope_ref_type: str | None,
    source: str,
    tier: str,
    embedding: list[float] | None,
) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "importer_id": importer_id,
                "title": title,
                "content": content,
                "scope": scope,
                "scope_ref_id": scope_ref_id,
                "scope_ref_type": scope_ref_type,
                "source": source,
                "tier": tier,
                "embedding": embedding,
            }
        ),
    )


def _edge_to_row(
    *,
    source_node_id: str,
    target_ref_id: str | None,
    target_ref_type: str | None,
    relation_type: str,
    tier: str,
    source: str,
    provenance: dict[str, object] | None,
) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "source_node_id": source_node_id,
                "target_ref_id": target_ref_id,
                "target_ref_type": target_ref_type,
                "relation_type": relation_type,
                "tier": tier,
                "source": source,
                "provenance": provenance,
                "is_active": True,
            }
        ),
    )


class SupabaseKnowledgeGraphRepository:
    """Supabase implementation of KnowledgeGraphRepository.

    Tenant isolation: node writes always carry importer_id; edges have no
    importer_id column, so isolation holds transitively via
    source_node_id -> knowledge_nodes.importer_id (T-29-06).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

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
        """Insert or update a knowledge_nodes row; returns the persisted node id.

        Reuses an existing active node when `find_active_node` located one for
        this (importer_id, scope, scope_ref_id) -- updates that row in place.
        Otherwise inserts a fresh row.
        """
        existing = await self.find_active_node(importer_id, scope, scope_ref_id)
        payload = _node_to_row(
            importer_id=importer_id,
            title=title,
            content=content,
            scope=scope,
            scope_ref_id=scope_ref_id,
            scope_ref_type=scope_ref_type,
            source=source,
            tier=tier,
            embedding=embedding,
        )
        if existing is not None:
            node_id = str(cast("dict[str, Any]", existing)["id"])
            self._client.table("knowledge_nodes").update(payload).eq("id", node_id).execute()
            return node_id

        result = self._client.table("knowledge_nodes").insert(payload).execute()
        if not result.data:
            raise ValueError(f"knowledge_nodes insert returned no data: importer_id={importer_id}")
        return str(cast("dict[str, Any]", result.data[0])["id"])

    async def find_active_node(
        self,
        importer_id: str,
        scope: str,
        scope_ref_id: str | None,
    ) -> dict[str, object] | None:
        query = (
            self._client.table("knowledge_nodes")
            .select("*")
            .eq("importer_id", importer_id)
            .eq("scope", scope)
            .eq("is_active", True)
        )
        query = (
            query.eq("scope_ref_id", scope_ref_id) if scope_ref_id is not None else query.is_("scope_ref_id", "null")
        )
        result = query.execute()
        if not result.data:
            return None
        return cast("dict[str, object]", result.data[0])

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
        payload = _edge_to_row(
            source_node_id=source_node_id,
            target_ref_id=target_ref_id,
            target_ref_type=target_ref_type,
            relation_type=relation_type,
            tier=tier,
            source=source,
            provenance=provenance,
        )
        self._client.table("knowledge_node_edges").insert(payload).execute()

    async def deactivate_edges_for_node(self, source_node_id: str) -> None:
        """Set is_active=False on all active edges for source_node_id.

        NEVER deletes rows -- supersede is a status transition, preserving
        the audit trail (T-29-05).
        """
        (
            self._client.table("knowledge_node_edges")
            .update({"is_active": False})
            .eq("source_node_id", source_node_id)
            .eq("is_active", True)
            .execute()
        )

    async def find_active_edges_for_node(self, source_node_id: str) -> list[dict[str, object]]:
        result = (
            self._client.table("knowledge_node_edges")
            .select("*")
            .eq("source_node_id", source_node_id)
            .eq("is_active", True)
            .execute()
        )
        return [cast("dict[str, object]", row) for row in result.data]

    async def list_injectable_edges(self, importer_id: str) -> list[dict[str, object]]:
        """THE single sanctioned auto-injection read path (T-30-02).

        Resolves the importer's knowledge_nodes ids, then selects
        knowledge_node_edges scoped to those ids with
        tier='EXTRACTED' AND is_active=True. INFERRED/AMBIGUOUS suggestion
        edges and inactive edges are excluded by construction -- see port
        docstring. No other consumer may read knowledge_node_edges for
        auto-injection purposes.
        """
        nodes_result = self._client.table("knowledge_nodes").select("id").eq("importer_id", importer_id).execute()
        node_ids = [str(cast("dict[str, Any]", row)["id"]) for row in nodes_result.data]
        if not node_ids:
            return []

        result = (
            self._client.table("knowledge_node_edges")
            .select("*")
            .in_("source_node_id", node_ids)
            .eq("tier", "EXTRACTED")
            .eq("is_active", True)
            .execute()
        )
        return [cast("dict[str, object]", row) for row in result.data]

    async def find_edge_by_id(self, edge_id: str) -> dict[str, object] | None:
        """Load an edge plus its owning importer_id via a nested knowledge_nodes select.

        Mirrors the entity_types(*) nested-embed idiom (entity_type_repository.py)
        -- PostgREST resolves the source_node_id -> knowledge_nodes FK
        automatically. Flattens the nested `knowledge_nodes.importer_id` onto
        the returned dict for PromoteEdgeUseCase's tenant guard (T-30-07).
        """
        result = (
            self._client.table("knowledge_node_edges")
            .select("*, knowledge_nodes(importer_id)")
            .eq("id", edge_id)
            .execute()
        )
        if not result.data:
            return None
        row = dict(cast("dict[str, Any]", result.data[0]))
        node = row.pop("knowledge_nodes", None)
        row["importer_id"] = node.get("importer_id") if isinstance(node, dict) else None
        return cast("dict[str, object]", row)

    async def promote_edge(
        self,
        *,
        edge_id: str,
        promotion: dict[str, object],
    ) -> bool:
        """CAS-guarded promotion write (T-30-06): id + is_active=true + tier in suggestion tiers.

        NEVER .delete() -- flips tier to EXTRACTED and writes `promotion`
        (distinct from the synthesis `provenance` column) in one filtered
        update call. Returns True only when a row actually matched the CAS
        filter and was updated.
        """
        payload = cast("dict[str, Any]", strip_nul({"tier": "EXTRACTED", "promotion": promotion}))
        result = (
            self._client.table("knowledge_node_edges")
            .update(payload)
            .eq("id", edge_id)
            .eq("is_active", True)
            .in_("tier", ["INFERRED", "AMBIGUOUS"])
            .execute()
        )
        return bool(result.data)

    async def search_nodes(
        self,
        *,
        query_text: str,
        query_embedding: list[float] | None,
        importer_id: str,
        limit: int = DEFAULT_SEARCH_LIMIT,
    ) -> list[dict[str, object]]:
        """BlendedRAG search over knowledge_nodes_extracted_only (migration 0029).

        Mirrors SupabaseEntityResolutionRepository.find_candidates's structure:
        vector arm skipped when query_embedding is None (D-12), lexical arm
        always runs, both degrade to [] independently on an RPC failure
        (never raises), fused via RRF(k=60), deduped by id, capped at limit.
        No additional filtering here -- the RPCs already enforce
        EXTRACTED-only via migration 0029's belt 3.
        """
        vector_rows: list[dict[str, Any]] = []
        if query_embedding is not None:
            vector_rows = await self._vector_search_query(embedding=list(query_embedding), importer_id=importer_id)

        trgm_rows = await self._trgm_search_query(query_text=query_text, importer_id=importer_id)

        if not vector_rows and not trgm_rows:
            return []

        vector_ids = [str(row["id"]) for row in vector_rows]
        trgm_ids = [str(row["id"]) for row in trgm_rows]
        merged_ids = _merge_rrf([vector_ids, trgm_ids])[:limit]

        row_map: dict[str, dict[str, Any]] = {}
        for row in trgm_rows:
            row_map.setdefault(str(row["id"]), row)
        for row in vector_rows:
            row_map.setdefault(str(row["id"]), row)

        return [cast("dict[str, object]", dict(row_map[node_id])) for node_id in merged_ids if node_id in row_map]

    async def _vector_search_query(self, *, embedding: list[float], importer_id: str) -> list[dict[str, Any]]:
        """Dense cosine similarity query over knowledge_nodes.embedding (HNSW)."""
        try:
            result = self._client.rpc(
                _VECTOR_RPC,
                {
                    "query_embedding": embedding,
                    "match_importer_id": importer_id,
                    "match_count": _SEARCH_CANDIDATE_LIMIT,
                },
            ).execute()
            return cast("list[dict[str, Any]]", result.data or [])
        except Exception:
            logger.exception(
                "SupabaseKnowledgeGraphRepository: vector search query failed -- returning empty",
                extra={"importer_id": importer_id},
            )
            return []

    async def _trgm_search_query(self, *, query_text: str, importer_id: str) -> list[dict[str, Any]]:
        """pg_trgm similarity query over knowledge_nodes title/content."""
        try:
            result = self._client.rpc(
                _TRGM_RPC,
                {
                    "query_text": query_text,
                    "match_importer_id": importer_id,
                    "match_count": _SEARCH_CANDIDATE_LIMIT,
                },
            ).execute()
            return cast("list[dict[str, Any]]", result.data or [])
        except Exception:
            logger.exception(
                "SupabaseKnowledgeGraphRepository: trigram search query failed -- returning empty",
                extra={"importer_id": importer_id},
            )
            return []

    async def list_captured_sources_for_conversations(
        self,
        *,
        importer_id: str,
        conversation_ids: Sequence[str],
        limit: int = DEFAULT_CAPTURED_SOURCES_LIMIT,
    ) -> list[dict[str, object]]:
        """Resolve captured-source knowledge_nodes via their chat_conversation edges.

        Two-step read (edges -> nodes), scoped to importer_id on the node
        side (defense-in-depth, T-54-05-02). Never raises -- degrades to []
        on any read failure (fail-open, mirrors _vector_search_query /
        _trgm_search_query's existing posture in this same file).
        """
        ids = [cid for cid in conversation_ids if cid]
        if not ids:
            return []
        try:
            edges_result = (
                self._client.table("knowledge_node_edges")
                .select("source_node_id")
                .eq("target_ref_type", _CAPTURED_SOURCE_TARGET_REF_TYPE)
                .in_("target_ref_id", ids)
                .eq("is_active", True)
                .execute()
            )
            edge_rows = cast("list[dict[str, Any]]", edges_result.data or [])
            node_ids = list({str(row["source_node_id"]) for row in edge_rows if row.get("source_node_id")})
            if not node_ids:
                return []
            nodes_result = (
                self._client.table("knowledge_nodes")
                .select("id, title, content")
                .in_("id", node_ids)
                .eq("importer_id", importer_id)
                .eq("source", _CAPTURED_SOURCE_SOURCE)
                .eq("scope_ref_type", _CAPTURED_SOURCE_SCOPE_REF_TYPE)
                .eq("is_active", True)
                .execute()
            )
        except Exception:
            logger.exception(
                "SupabaseKnowledgeGraphRepository: captured-sources read failed -- returning empty",
                extra={"importer_id": importer_id},
            )
            return []
        rows = cast("list[dict[str, Any]]", nodes_result.data or [])
        return [cast("dict[str, object]", row) for row in rows[:limit]]

    async def expand_neighbours(
        self,
        *,
        node_id: str,
        importer_id: str,
        max_depth: int = MAX_EXPAND_DEPTH,
        node_budget: int = DEFAULT_EXPAND_NODE_BUDGET,
    ) -> dict[str, object]:
        """Bounded BFS neighbour walk reading through knowledge_nodes_extracted_only.

        Fail-closed (empty result, zero further queries) on an unknown,
        inactive, or cross-tenant seed (T-37-03). Every hop's frontier
        resolution filters .eq("importer_id", importer_id) against the view
        (T-37-02) -- an id that fails to resolve there (foreign-importer,
        inactive, or not a knowledge_node at all) is silently dropped and
        never added to the next hop's frontier. The budget cap is applied
        ONCE after the walk (mirrors TS capBudget), not per-hop.
        """
        if not await self._seed_is_valid(node_id=node_id, importer_id=importer_id):
            return {"nodes": [], "edges": [], "truncated": False}

        seed_view_rows = await self._resolve_view_rows(candidate_ids={node_id}, importer_id=importer_id)
        if node_id not in seed_view_rows:
            # Defense-in-depth: the base-table check above already confirmed
            # is_active + same-importer; this should always resolve. Fail
            # closed anyway rather than surface a partially-resolved seed.
            return {"nodes": [], "edges": [], "truncated": False}

        clamped_depth = _clamp_depth(max_depth)
        node_ids, edges_by_id = await self._walk_bfs(
            seed_id=node_id,
            seed_row=seed_view_rows[node_id],
            importer_id=importer_id,
            clamped_depth=clamped_depth,
        )

        kept_ids = set(node_ids.keys())
        kept_edges = _filter_edges_to_node_set(edges_by_id.values(), kept_ids)

        node_id_list = list(node_ids.keys())
        if len(node_id_list) <= node_budget:
            return {"nodes": list(node_ids.values()), "edges": kept_edges, "truncated": False}

        capped_ids = set(node_id_list[:node_budget])
        nodes_out = [node_ids[nid] for nid in node_id_list[:node_budget]]
        edges_out = _filter_edges_to_node_set(kept_edges, capped_ids)
        return {"nodes": nodes_out, "edges": edges_out, "truncated": True}

    async def _seed_is_valid(self, *, node_id: str, importer_id: str) -> bool:
        """Fail-closed seed check: exists, is_active, and same-importer as the caller (T-37-03)."""
        seed_result = (
            self._client.table("knowledge_nodes").select("id, importer_id, is_active").eq("id", node_id).execute()
        )
        seed_rows = cast("list[dict[str, Any]]", seed_result.data or [])
        if not seed_rows:
            return False
        seed_row = seed_rows[0]
        return seed_row.get("is_active") is True and str(seed_row.get("importer_id")) == importer_id

    async def _walk_bfs(
        self,
        *,
        seed_id: str,
        seed_row: dict[str, Any],
        importer_id: str,
        clamped_depth: int,
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        """Breadth-first walk from seed_id, tenant-scoped to importer_id at every hop.

        Returns (node_ids, edges_by_id) -- both insertion-ordered by
        discovery, which the budget cap this feeds into relies on.
        """
        node_ids: dict[str, dict[str, Any]] = {seed_id: seed_row}
        edges_by_id: dict[str, dict[str, Any]] = {}
        frontier: set[str] = {seed_id}

        for _hop in range(clamped_depth):
            if not frontier:
                break
            next_candidates = await self._collect_hop_candidates(
                frontier=frontier, node_ids=node_ids, edges_by_id=edges_by_id
            )
            if not next_candidates:
                break
            resolved = await self._resolve_view_rows(candidate_ids=next_candidates, importer_id=importer_id)
            frontier = set()
            for candidate_id, row in resolved.items():
                if candidate_id not in node_ids:
                    node_ids[candidate_id] = row
                    frontier.add(candidate_id)

        return node_ids, edges_by_id

    async def _collect_hop_candidates(
        self,
        *,
        frontier: set[str],
        node_ids: dict[str, dict[str, Any]],
        edges_by_id: dict[str, dict[str, Any]],
    ) -> set[str]:
        """Fetch active edges touching every node in frontier; mutates edges_by_id in place.

        Returns the set of newly-discovered (not already in node_ids) endpoint ids.
        """
        next_candidates: set[str] = set()
        for current_id in frontier:
            edge_rows = await self._fetch_edges_for_node(current_id)
            for edge in edge_rows:
                edges_by_id[str(edge["id"])] = edge
                for candidate in (edge.get("source_node_id"), edge.get("target_ref_id")):
                    if candidate is not None and str(candidate) not in node_ids:
                        next_candidates.add(str(candidate))
        return next_candidates

    async def _resolve_view_rows(self, *, candidate_ids: set[str], importer_id: str) -> dict[str, dict[str, Any]]:
        """Batched, tenant-scoped resolve of candidate node ids through knowledge_nodes_extracted_only.

        THE tenant boundary for expand_neighbours (T-37-02, defense-in-depth
        mirroring T-32-02): the view already filters is_active=true
        internally, and this adds .eq("importer_id", importer_id) -- any id
        that fails to resolve here (foreign-importer, inactive, or not a
        knowledge_node at all -- a polymorphic target_ref_id) is silently
        excluded from the returned mapping.
        """
        if not candidate_ids:
            return {}
        result = (
            self._client.table("knowledge_nodes_extracted_only")
            .select("id, title, content, scope, scope_ref_id, tier, confidence")
            .in_("id", list(candidate_ids))
            .eq("importer_id", importer_id)
            .execute()
        )
        rows = cast("list[dict[str, Any]]", result.data or [])
        return {str(row["id"]): row for row in rows}

    async def _fetch_edges_for_node(self, node_id: str) -> list[dict[str, Any]]:
        """Fetch active knowledge_node_edges rows touching node_id as either endpoint."""
        result = (
            self._client.table("knowledge_node_edges")
            .select("*")
            .or_(f"source_node_id.eq.{node_id},target_ref_id.eq.{node_id}")
            .eq("is_active", True)
            .execute()
        )
        return cast("list[dict[str, Any]]", result.data or [])
