"""Canon knowledge-graph memory injection pipeline (AI-06; sits alongside cluster/linked context).

The chat turn's THIRD fail-open system-context injection. Where
`cluster_context.py` injects thread/cluster metadata and `linked_context.py`
resolves explicit user-drawn context edges, THIS pipeline recalls the
importer's CANON knowledge — human-confirmed (EXTRACTED-tier) knowledge edges
and entity-profile nodes — into the system prompt, and produces a
research-trace-shaped citation envelope that renders each recall back to its
`/knowledge` node (AI-06 req 3).

Three hard constraints, all encoded here and tested:

* READ-ONLY, CANON-ONLY (req 1). Canon edges come ONLY through
  `KnowledgeGraphRepository.list_injectable_edges` — the single sanctioned
  auto-injection gate (EXTRACTED + is_active by construction, T-30-02) — and
  entity profiles ONLY through `search_nodes`, whose rows are EXTRACTED-only at
  the RPC level (migration 0029). No suggested/AMBIGUOUS/inactive edge can ever
  reach the prompt. The retrieval itself performs ZERO writes.

* BOUNDED (req 4). `agent_memory.MAX_CANON_FACTS` / `MAX_ENTITY_PROFILES` cap
  the row reads AND the assembled block; a hard char budget caps the text.

* SUGGEST-ONLY WRITE-BACK (req 2). `propose_suggested_edge` is the ONLY write
  this module exposes, and it writes at INFERRED tier through the existing
  edge-proposal path (`insert_edge`), never EXTRACTED and never `promote_edge`
  — the human promotion gate is preserved. It is a seam the retrieval never
  auto-invokes (do NOT auto-canonize); a caller opts in explicitly.

Fail-open at every read step (mirrors cluster_context.py's posture): a missing
collaborator, an older stub, or any read failure resolves to "no memory
injected" and the turn proceeds exactly as before — never a crash.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

from app.domain.services.agent_memory import (
    MAX_CANON_FACTS,
    MAX_ENTITY_PROFILES,
    CanonFact,
    EntityProfile,
    build_agent_memory_block,
    build_memory_citation_envelope,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)

# Tier vocabulary (knowledge-nodes.ts trust ladder). CANON == EXTRACTED is the
# only tier ever injected; SUGGESTED == INFERRED is the only tier the
# suggest-only write-back ever writes.
_CANON_TIER = "EXTRACTED"
_SUGGESTED_TIER = "INFERRED"

# The `source` stamp for a suggest-only edge AI-06 proposes from a chat turn —
# distinguishes it in the /knowledge review queue from manual/synthesis edges.
_CHAT_SUGGESTION_SOURCE = "learned_from_chat"

# A short label for a canon edge's polymorphic target (target_ref_type + a
# trimmed id) — the target may not be a knowledge node, so it is never cited,
# only described.
_TARGET_ID_SHORT = 8


@dataclass(frozen=True)
class KnowledgeMemoryInjection:
    """Result of the canon-memory injection step.

    augmented_prompt: base prompt with the AGENT MEMORY block appended (or
        byte-identical to the base when nothing canon was found).
    citation_part: a `tool_invocation_result`-shaped assistant message part
        (toolName='knowledge_memory') carrying the research-trace citation
        envelope, or None when there is nothing to cite. The orchestrator
        seeds it as the leading part of the turn so it renders through the
        existing research-trace component.
    """

    augmented_prompt: str
    citation_part: dict[str, object] | None


async def _list_canon_edges(
    knowledge_graph: KnowledgeGraphRepository | None, *, importer_id: str
) -> list[dict[str, object]]:
    """Fail-open canon-edge read via the SANCTIONED gate — [] when unwired or on any failure.

    `list_injectable_edges` is EXTRACTED + is_active by construction (T-30-02);
    no other read path may be used for auto-injection.
    """
    if knowledge_graph is None:
        return []
    try:
        return await knowledge_graph.list_injectable_edges(importer_id)
    except Exception:
        logger.warning("knowledge_memory_canon_edges_read_failed", importer_id=importer_id)
        return []


async def _resolve_canon_facts(
    knowledge_graph: KnowledgeGraphRepository,
    edges: Sequence[dict[str, object]],
) -> list[CanonFact]:
    """Resolve each canon edge's SOURCE node (title/content) into a citable CanonFact.

    Bounded to MAX_CANON_FACTS edges (each edge is one extra get_node_by_id
    read). A per-edge resolve failure or a missing/non-canon source node drops
    that edge only (fail-open). The citation is the SOURCE node id — a real
    `/knowledge` node — never the polymorphic target_ref_id.
    """
    facts: list[CanonFact] = []
    for edge in edges[:MAX_CANON_FACTS]:
        source_node_id = edge.get("source_node_id")
        if not source_node_id:
            continue
        try:
            node = await knowledge_graph.get_node_by_id(str(source_node_id))
        except Exception:
            logger.warning("knowledge_memory_node_resolve_failed", node_id=str(source_node_id))
            continue
        if node is None:
            continue
        # Defensive belt: only surface a source node that is itself active
        # canon (the edge gate already guarantees EXTRACTED+active, this
        # re-checks the resolved node).
        if node.get("is_active") is False or node.get("tier") not in (None, _CANON_TIER):
            continue
        target_label = _target_label(edge)
        content = node.get("content")
        facts.append(
            CanonFact(
                node_id=str(source_node_id),
                node_title=str(node.get("title") or "(untitled)"),
                relation=str(edge.get("relation_type") or "related"),
                target_label=target_label,
                excerpt=str(content) if content else "",
                tier=str(edge.get("tier") or _CANON_TIER),
            )
        )
    return facts


def _target_label(edge: dict[str, object]) -> str:
    """A short, non-cited description of an edge's polymorphic target."""
    target_type = edge.get("target_ref_type")
    target_id = edge.get("target_ref_id")
    if target_type and target_id:
        return f"{target_type}:{str(target_id)[:_TARGET_ID_SHORT]}"
    if target_type:
        return str(target_type)
    return ""


async def _search_entity_profiles(
    knowledge_graph: KnowledgeGraphRepository | None,
    *,
    importer_id: str,
    query_text: str,
) -> list[EntityProfile]:
    """Fail-open EXTRACTED-only entity-profile search — [] when unwired, empty query, or on failure.

    Uses `search_nodes` (BlendedRAG over the extracted_only view; the lexical
    trgm arm alone, no embedding needed — KG-8). Rows are EXTRACTED-only by
    construction. Bounded to MAX_ENTITY_PROFILES.
    """
    if knowledge_graph is None or not query_text.strip():
        return []
    try:
        rows = await knowledge_graph.search_nodes(
            query_text=query_text,
            query_embedding=None,
            importer_id=importer_id,
            limit=MAX_ENTITY_PROFILES,
        )
    except Exception:
        logger.warning("knowledge_memory_profile_search_failed", importer_id=importer_id)
        return []
    profiles: list[EntityProfile] = []
    for row in rows:
        node_id = row.get("id")
        if not node_id:
            continue
        content = row.get("content")
        profiles.append(
            EntityProfile(
                node_id=str(node_id),
                title=str(row.get("title") or "(untitled)"),
                excerpt=str(content) if content else "",
                tier=str(row.get("tier") or _CANON_TIER),
            )
        )
    return profiles


def _build_citation_part(envelope: dict[str, object]) -> dict[str, object] | None:
    """Wrap the citation envelope in a `tool_invocation_result` part, or None when empty.

    Same part shape as build_tool_invocation_result_part (run_chat_turn_tool_loop.py)
    so it renders through the existing message-turn dispatch → research-trace.
    Emitted only when there is at least one source to cite.
    """
    sources = envelope.get("sources")
    if not isinstance(sources, list) or not sources:
        return None
    return {
        "type": "tool_invocation_result",
        "toolUseId": f"knowledge_memory:{uuid.uuid4()}",
        "toolName": "knowledge_memory",
        "content": json.dumps(envelope, ensure_ascii=False),
        "isError": False,
    }


async def build_knowledge_memory_injection(
    *,
    base_system_prompt: str,
    knowledge_graph: KnowledgeGraphRepository | None,
    importer_id: str,
    query_text: str,
) -> KnowledgeMemoryInjection:
    """Retrieve canon memory + build the injection (prompt block + citation part).

    Fail-open, canon-only, bounded, ZERO writes. When nothing canon is found
    the augmented prompt is byte-identical to `base_system_prompt` and the
    citation part is None.
    """
    if knowledge_graph is None:
        return KnowledgeMemoryInjection(augmented_prompt=base_system_prompt, citation_part=None)

    edges = await _list_canon_edges(knowledge_graph, importer_id=importer_id)
    canon_facts = await _resolve_canon_facts(knowledge_graph, edges)
    entity_profiles = await _search_entity_profiles(
        knowledge_graph, importer_id=importer_id, query_text=query_text
    )

    block = build_agent_memory_block(canon_facts, entity_profiles)
    envelope = build_memory_citation_envelope(canon_facts, entity_profiles)
    citation_part = _build_citation_part(envelope)

    augmented_prompt = f"{base_system_prompt}\n\n{block}" if block else base_system_prompt
    return KnowledgeMemoryInjection(augmented_prompt=augmented_prompt, citation_part=citation_part)


async def propose_suggested_edge(
    knowledge_graph: KnowledgeGraphRepository | None,
    *,
    source_node_id: str,
    target_ref_id: str | None,
    target_ref_type: str | None,
    relation_type: str,
    rationale: str | None = None,
) -> bool:
    """SUGGEST-ONLY write-back seam (AI-06 req 2): propose a NEW edge at INFERRED tier.

    The ONLY write this module exposes. Writes through the existing
    edge-proposal path (`insert_edge`) at the SUGGESTED (INFERRED) tier, stamped
    `source='learned_from_chat'` so it surfaces in the /knowledge review queue.
    It NEVER writes EXTRACTED and NEVER calls `promote_edge` — the human
    promotion gate is fully preserved (a proposed edge stays a suggestion until
    a person confirms it via the existing promote route).

    A hard assertion guards the tier so a future edit can never silently
    auto-canonize through this seam. Returns True when the write was issued,
    False when unwired. Never raises out of a repository hiccup (fail-open,
    mirrors this module's read posture) — a failed suggestion is logged, not
    fatal.

    The retrieval step never calls this; a caller opts in explicitly when the
    turn genuinely surfaces a new relationship worth proposing.
    """
    if knowledge_graph is None:
        return False
    # Belt-and-suspenders: this seam can ONLY ever write the suggested tier.
    assert _SUGGESTED_TIER != _CANON_TIER  # invariant guard, not input validation
    provenance: dict[str, object] = {"proposed_from": "chat_turn"}
    if rationale:
        provenance["rationale"] = rationale
    try:
        await knowledge_graph.insert_edge(
            source_node_id=source_node_id,
            target_ref_id=target_ref_id,
            target_ref_type=target_ref_type,
            relation_type=relation_type,
            tier=_SUGGESTED_TIER,
            source=_CHAT_SUGGESTION_SOURCE,
            provenance=provenance,
        )
    except Exception:
        logger.warning("knowledge_memory_suggest_edge_failed", source_node_id=source_node_id)
        return False
    return True
