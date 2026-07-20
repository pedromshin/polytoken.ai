"""Thread+cluster context gathering pipeline (Phase 54-05, CLUS-02/CLUS-06; carved from run_chat_turn.py, 999.31).

The bounded, fail-open-at-every-step (T-54-05-04) reads that feed
`assemble_cluster_context`, plus the system-prompt append entrypoint
(`system_prompt_with_cluster_context`). Formerly `self`-bound methods on
RunChatTurn — now free functions taking the same collaborators explicitly;
the facade's thin `_system_prompt_with_cluster_context` method delegates
here with its own wired collaborators. Behavior moved verbatim.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import structlog

from app.domain.services.thread_cluster_context import (
    CapturedSourceRef,
    SiblingConversationSummary,
    ThreadMessageBody,
    assemble_cluster_context,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.domain.entities.email import Email
    from app.domain.ports.chat_repositories import ChatConversation, ChatConversationRepository, ChatMessage
    from app.domain.ports.email_repository import EmailRepository
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)

# Phase 54-05 (CLUS-02/CLUS-06): bounded reads feeding the thread+cluster
# context assembler -- every count below is a hard cap on the number of rows
# fetched, independent of (and tighter than) the assembler's own char budget.
_CLUSTER_CONTEXT_EMAIL_LIMIT = 20
_CLUSTER_CONTEXT_SIBLING_LIMIT = 8
_CLUSTER_CONTEXT_SOURCE_LIMIT = 8
_CLUSTER_CONTEXT_PANEL_LIMIT = 8
# Per-field cap for a best-effort panel "title" derived from a genui spec's
# `_plan` field (see `_extract_panel_titles`).
_PANEL_TITLE_FIELD_CHARS = 80


def _extract_panel_titles(history: Sequence[ChatMessage], *, limit: int) -> tuple[str, ...]:
    """Best-effort panel titles from this conversation's own genui_spec parts (Phase 54-05, CLUS-06).

    Reuses `history` (already loaded for provider_messages -- no extra I/O).
    A spec has no dedicated title field; its `_plan` field (a short,
    model-authored reasoning summary, normally stripped before render)
    doubles as a human-readable panel description when present. Falls back
    to a turn-indexed generic label otherwise. Most-recent-first, bounded by
    `limit`.
    """
    titles: list[str] = []
    for message in sorted(history, key=lambda m: m.turn_index, reverse=True):
        for part in message.parts:
            if part.get("type") != "genui_spec":
                continue
            spec = part.get("spec")
            plan_text = spec.get("_plan") if isinstance(spec, dict) else None
            if isinstance(plan_text, str) and plan_text.strip():
                titles.append(plan_text.strip()[:_PANEL_TITLE_FIELD_CHARS])
            else:
                titles.append(f"Panel from turn {message.turn_index}")
            if len(titles) >= limit:
                return tuple(titles)
    return tuple(titles)


async def _list_sibling_conversations(
    conversations: ChatConversationRepository,
    *,
    thread_id: str,
    importer_id: str,
    exclude_conversation_id: str,
) -> list[ChatConversation]:
    """Fail-open sibling-conversation read (T-54-05-04) — [] on any failure."""
    try:
        return await conversations.list_by_thread_id(  # type: ignore[attr-defined]
            thread_id=thread_id,
            importer_id=importer_id,
            exclude_conversation_id=exclude_conversation_id,
            limit=_CLUSTER_CONTEXT_SIBLING_LIMIT,
        )
    except Exception:
        logger.warning("cluster_context_siblings_read_failed", thread_id=thread_id)
        return []


async def _list_captured_sources(
    knowledge_graph: KnowledgeGraphRepository | None,
    *,
    importer_id: str,
    conversation_ids: Sequence[str],
) -> list[CapturedSourceRef]:
    """Fail-open captured-source read (T-54-05-04) — [] when unwired or on any failure."""
    if knowledge_graph is None:
        return []
    try:
        rows = await knowledge_graph.list_captured_sources_for_conversations(
            importer_id=importer_id, conversation_ids=conversation_ids, limit=_CLUSTER_CONTEXT_SOURCE_LIMIT
        )
    except Exception:
        logger.warning("cluster_context_sources_read_failed", importer_id=importer_id)
        return []
    return [
        CapturedSourceRef(title=str(row.get("title") or "(untitled)"), url=str(row["content"]))
        for row in rows
        if row.get("content")
    ]


async def _resolve_thread_id(conversations: ChatConversationRepository, conversation_id: str) -> str | None:
    """Fail-open thread_id read (T-54-05-04) — None on any failure, including AttributeError

    raised by an older `conversations` collaborator that predates
    Phase 54-05's `get_thread_id` method entirely.
    """
    try:
        return await conversations.get_thread_id(conversation_id)  # type: ignore[attr-defined]
    except Exception:
        logger.warning("cluster_context_thread_id_unavailable", conversation_id=conversation_id)
        return None


async def _list_thread_emails(
    email_repository: EmailRepository | None, *, importer_id: str, thread_id: str
) -> list[Email]:
    """Fail-open thread-member-email read (T-54-05-04) — [] when unwired or on any failure."""
    if email_repository is None:
        return []
    try:
        return await email_repository.list_by_thread_id(
            importer_id=importer_id, thread_id=thread_id, limit=_CLUSTER_CONTEXT_EMAIL_LIMIT
        )
    except Exception:
        logger.warning("cluster_context_thread_emails_unavailable", thread_id=thread_id)
        return []


async def _assemble_cluster_block(
    *,
    conversations: ChatConversationRepository,
    knowledge_graph: KnowledgeGraphRepository | None,
    conversation_id: str,
    importer_id: str,
    thread_id: str,
    thread_emails: Sequence[Email],
    history: Sequence[ChatMessage],
) -> str | None:
    """Gather bounded sibling/source/panel context and assemble the combined block.

    Never raises (T-54-05-04) — an assembly failure resolves to None,
    same as every other fail-open step in this gathering pipeline.
    """
    siblings = await _list_sibling_conversations(
        conversations, thread_id=thread_id, importer_id=importer_id, exclude_conversation_id=conversation_id
    )
    conversation_ids = (conversation_id, *(sibling.id for sibling in siblings))
    captured_sources = await _list_captured_sources(
        knowledge_graph, importer_id=importer_id, conversation_ids=conversation_ids
    )
    panel_titles = _extract_panel_titles(history, limit=_CLUSTER_CONTEXT_PANEL_LIMIT)

    ordered_emails = sorted(thread_emails, key=lambda email: email.received_at, reverse=True)
    recent_bodies = tuple(
        ThreadMessageBody(
            sender_name=email.sender_name,
            sender_address=email.sender_address,
            received_at=email.received_at.isoformat(),
            body_text=email.body_text or "",
        )
        for email in ordered_emails
    )
    sibling_summaries = tuple(SiblingConversationSummary(title=sibling.title) for sibling in siblings)

    try:
        return assemble_cluster_context(
            thread_subject=ordered_emails[0].subject,
            thread_participants=tuple(email.sender_name or email.sender_address for email in ordered_emails),
            thread_recent_bodies=recent_bodies,
            sibling_summaries=sibling_summaries,
            captured_sources=tuple(captured_sources),
            panel_titles=panel_titles,
        )
    except Exception:
        logger.warning("cluster_context_assembly_failed", conversation_id=conversation_id)
        return None


async def build_cluster_context_block(
    *,
    conversations: ChatConversationRepository,
    knowledge_graph: KnowledgeGraphRepository | None,
    email_repository: EmailRepository | None,
    conversation_id: str,
    importer_id: str,
    history: Sequence[ChatMessage],
) -> str | None:
    """Bounded, quarantined thread+cluster context block (Phase 54-05, CLUS-02/CLUS-06).

    Fail-open at every step (T-54-05-04): no `email_repository` wired,
    a missing/absent thread_id (including an unapplied 0036 column, or
    an older `conversations` collaborator with no `get_thread_id` at
    all), or any read failure along the way all resolve to `None` — the
    turn proceeds exactly as before, never a crash. `get_thread_id` is
    not even attempted when no `email_repository` is wired (nothing
    useful could be built from a thread id alone).
    """
    if email_repository is None:
        return None
    thread_id = await _resolve_thread_id(conversations, conversation_id)
    if not thread_id:
        return None
    thread_emails = await _list_thread_emails(email_repository, importer_id=importer_id, thread_id=thread_id)
    if not thread_emails:
        return None
    return await _assemble_cluster_block(
        conversations=conversations,
        knowledge_graph=knowledge_graph,
        conversation_id=conversation_id,
        importer_id=importer_id,
        thread_id=thread_id,
        thread_emails=thread_emails,
        history=history,
    )


async def system_prompt_with_cluster_context(
    *,
    base_system_prompt: str,
    conversations: ChatConversationRepository,
    knowledge_graph: KnowledgeGraphRepository | None,
    email_repository: EmailRepository | None,
    conversation_id: str,
    importer_id: str,
    history: Sequence[ChatMessage],
) -> str:
    """Append the bounded thread+cluster context block to `base_system_prompt` when one exists."""
    cluster_context_block = await build_cluster_context_block(
        conversations=conversations,
        knowledge_graph=knowledge_graph,
        email_repository=email_repository,
        conversation_id=conversation_id,
        importer_id=importer_id,
        history=history,
    )
    if cluster_context_block:
        return f"{base_system_prompt}\n\n{cluster_context_block}"
    return base_system_prompt
