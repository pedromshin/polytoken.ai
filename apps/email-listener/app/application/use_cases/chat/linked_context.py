"""Linked-context injection pipeline (Phase 56-04, RCNV-04; carved from run_chat_turn.py, 999.31).

A SECOND, INDEPENDENT fail-open pipeline (56-RESEARCH.md Pattern 3) from the
cluster-context module: resolves a conversation's active `chat_context_edges`
rows into a bounded, quarantined LINKED CONTEXT block — never gated on
thread linkage. Formerly `self`-bound methods on RunChatTurn — now free
functions taking the same collaborators explicitly; the facade's thin
`_system_prompt_with_linked_context` method delegates here. Behavior moved
verbatim.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import structlog

from app.domain.services.linked_context import (
    EmailThreadMessageBody,
    LinkedContextEntry,
    build_linked_context_block,
    resolve_email_thread_entry,
    resolve_genui_panel_entry,
    resolve_knowledge_node_entry,
    resolve_source_ledger_entry,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from app.domain.ports.chat_context_edge_repository import ChatContextEdgeRepository, ContextEdge
    from app.domain.ports.chat_repositories import ChatMessageRepository
    from app.domain.ports.email_repository import EmailRepository
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository
    from app.domain.ports.source_ledger_repository import SourceLedgerRepository

logger = structlog.get_logger(__name__)

# Phase 56-04 (RCNV-04): bounded reads feeding the SECOND, INDEPENDENT
# linked-context injection pipeline -- a defensive cap on how many active
# chat_context_edges rows are ever resolved per turn (network I/O per edge),
# independent of (and tighter than) build_linked_context_block's own
# `_MAX_LINKED_ENTRIES`/char-budget caps on what actually makes the prompt.
_MAX_CONTEXT_EDGES_RESOLVED = 20
# Bounded recent-email-body count for an email_thread-typed edge's resolver
# read -- mirrors _CLUSTER_CONTEXT_EMAIL_LIMIT's idiom, deliberately smaller
# since only ONE edge's thread is being resolved here (not a whole cluster).
_LINKED_CONTEXT_EMAIL_LIMIT = 6


async def _list_active_context_edges(
    context_edges: ChatContextEdgeRepository | None, conversation_id: str
) -> Sequence[ContextEdge]:
    """Fail-open active-edges read -- [] when unwired or on any failure.

    Mirrors `_list_captured_sources`'s belt-and-suspenders posture: the
    adapter itself already fails open (SupabaseChatContextEdgeRepository),
    this wrapper adds a second layer so an OLDER/malformed collaborator
    (or an AttributeError from a stub) can never crash the turn either.
    """
    if context_edges is None:
        return []
    try:
        return await context_edges.list_active_context_edges(conversation_id)
    except Exception:
        logger.warning("linked_context_edges_read_failed", conversation_id=conversation_id)
        return []


async def _resolve_source_ledger_ref(
    source_ledger: SourceLedgerRepository | None, source_ref: Mapping[str, Any]
) -> LinkedContextEntry | None:
    """source_ledger-typed edge -> chat_source_ledger row (reuses 56-02's SourceLedgerRepository.get)."""
    if source_ledger is None:
        return None
    ledger_id = source_ref.get("ledgerId")
    if not ledger_id:
        return None
    entry = await source_ledger.get(str(ledger_id))
    if entry is None:
        return None
    return resolve_source_ledger_entry(title=entry.title, url=entry.url, snippet=entry.snippet)


async def _resolve_knowledge_node_ref(
    knowledge_graph: KnowledgeGraphRepository | None, source_ref: Mapping[str, Any]
) -> LinkedContextEntry | None:
    """knowledge_node-typed edge -> a DIRECT tier-agnostic get-by-id (D-56-A).

    NEVER routed through `list_injectable_edges` -- that allowlist gates
    automatic injection, a structurally different concern from this
    single, explicitly user-drawn edge (Landmine 3 / T-56-04-04).
    """
    if knowledge_graph is None:
        return None
    node_id = source_ref.get("nodeId")
    if not node_id:
        return None
    node = await knowledge_graph.get_node_by_id(str(node_id))
    if node is None:
        return None
    content = node.get("content")
    return resolve_knowledge_node_entry(
        title=str(node.get("title") or "(untitled)"),
        content=str(content) if content else None,
    )


async def _resolve_genui_panel_ref(
    messages: ChatMessageRepository, source_ref: Mapping[str, Any]
) -> LinkedContextEntry | None:
    """genui_panel-typed edge -> a chat_messages row's parts[partIndex] genui_spec.

    The target message may live in ANY conversation, not just this
    turn's own -- `get_by_id` is a plain by-id lookup (Phase 56-04
    addition to ChatMessageRepository), not scoped to one conversation's
    active history.
    """
    message_id = source_ref.get("messageId")
    part_index = source_ref.get("partIndex")
    if not message_id or not isinstance(part_index, int):
        return None
    message = await messages.get_by_id(str(message_id))
    if message is None:
        return None
    return resolve_genui_panel_entry(parts=message.parts, part_index=part_index)


async def _resolve_email_thread_ref(
    email_repository: EmailRepository | None,
    source_ref: Mapping[str, Any],
    *,
    importer_id: str,
    importer_ids: Sequence[str] | None = None,
) -> LinkedContextEntry | None:
    """email_thread-typed edge -> EmailRepository thread read (reuses the CLUS-02 read).

    When the caller supplies its owned `importer_ids` (chat_stream resolves
    them from the verified user), the read spans that whole owned set — real
    emails live under per-(user, sender-domain) importers, so the old
    single-importer read (scoped to the DEFAULT importer) silently returned
    [] and the LINKED CONTEXT block was dropped. Empty/None importer_ids
    falls back to the original single-importer path (existing callers/tests
    unchanged).
    """
    if email_repository is None:
        return None
    thread_id = source_ref.get("threadId")
    if not thread_id:
        return None
    if importer_ids:
        emails = await email_repository.list_by_thread_id_for_importers(
            importer_ids=importer_ids, thread_id=str(thread_id), limit=_LINKED_CONTEXT_EMAIL_LIMIT
        )
    else:
        emails = await email_repository.list_by_thread_id(
            importer_id=importer_id, thread_id=str(thread_id), limit=_LINKED_CONTEXT_EMAIL_LIMIT
        )
    if not emails:
        return None
    ordered = sorted(emails, key=lambda email: email.received_at, reverse=True)
    bodies = tuple(
        EmailThreadMessageBody(
            sender_name=email.sender_name,
            sender_address=email.sender_address,
            received_at=email.received_at.isoformat(),
            body_text=email.body_text or "",
        )
        for email in ordered
    )
    return resolve_email_thread_entry(subject=ordered[0].subject, bodies=bodies)


async def _resolve_context_edge(
    edge: ContextEdge,
    *,
    importer_id: str,
    importer_ids: Sequence[str] | None = None,
    source_ledger: SourceLedgerRepository | None,
    knowledge_graph: KnowledgeGraphRepository | None,
    messages: ChatMessageRepository,
    email_repository: EmailRepository | None,
) -> LinkedContextEntry | None:
    """Fail-open per-edge resolve dispatch (T-56-04-03) -- None on any read failure, unrecognized
    sourceRef.type, or malformed sourceRef shape. Small named per-type dispatch (mirrors
    `_extract_panel_titles`'s style), not a generic resolver.
    """
    source_ref = edge.source_ref if isinstance(edge.source_ref, dict) else {}
    ref_type = source_ref.get("type")
    try:
        if ref_type == "source_ledger":
            return await _resolve_source_ledger_ref(source_ledger, source_ref)
        if ref_type == "knowledge_node":
            return await _resolve_knowledge_node_ref(knowledge_graph, source_ref)
        if ref_type == "genui_panel":
            return await _resolve_genui_panel_ref(messages, source_ref)
        if ref_type == "email_thread":
            return await _resolve_email_thread_ref(
                email_repository, source_ref, importer_id=importer_id, importer_ids=importer_ids
            )
    except Exception:
        logger.warning("linked_context_edge_resolve_failed", edge_id=edge.id, source_ref_type=ref_type)
        return None
    return None


async def system_prompt_with_linked_context(
    *,
    base_system_prompt: str,
    conversation_id: str,
    importer_id: str,
    importer_ids: Sequence[str] | None = None,
    context_edges: ChatContextEdgeRepository | None,
    source_ledger: SourceLedgerRepository | None,
    knowledge_graph: KnowledgeGraphRepository | None,
    messages: ChatMessageRepository,
    email_repository: EmailRepository | None,
) -> str:
    """Append the bounded, quarantined LINKED CONTEXT block to `base_system_prompt` when one exists.

    A SECOND, INDEPENDENT fail-open pipeline from
    `system_prompt_with_cluster_context` -- never gated on thread
    linkage, never nested inside that pipeline's own gate (RESEARCH
    Pattern 3). Byte-identical to `base_system_prompt` when unwired, when
    the conversation has no active edges, or when every edge fails to
    resolve.
    """
    edges = await _list_active_context_edges(context_edges, conversation_id)
    if not edges:
        return base_system_prompt
    entries: list[LinkedContextEntry] = []
    for edge in edges[:_MAX_CONTEXT_EDGES_RESOLVED]:
        entry = await _resolve_context_edge(
            edge,
            importer_id=importer_id,
            importer_ids=importer_ids,
            source_ledger=source_ledger,
            knowledge_graph=knowledge_graph,
            messages=messages,
            email_repository=email_repository,
        )
        if entry is not None:
            entries.append(entry)
    linked_context_block = build_linked_context_block(entries)
    if linked_context_block:
        return f"{base_system_prompt}\n\n{linked_context_block}"
    return base_system_prompt
