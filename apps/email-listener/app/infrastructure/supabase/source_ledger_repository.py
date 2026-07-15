"""SupabaseSourceLedgerRepository -- implements SourceLedgerRepository port.

Persists chat_source_ledger rows (Phase 56-02, RCNV-01): the zero-ceremony,
zero-knowledge-graph-write auto-collect candidate pool. Follows the
knowledge_graph_repository.py idiom -- module-level `_entry_to_row`/
`_row_to_entry` builders wrapped in `strip_nul`, `table().upsert()/select()`
call shapes. Never writes to knowledge_nodes/knowledge_node_edges anywhere in
this file -- the ledger is a separate candidate pool (999.19).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from supabase import Client

from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.infrastructure.supabase.sanitize import strip_nul

if TYPE_CHECKING:
    from collections.abc import Sequence

# The idempotent-retry dedupe key (migration 0037's
# idx_chat_source_ledger_dedupe unique index) -- re-processing the same tool
# round is always safe to upsert against this.
_DEDUPE_CONFLICT_COLUMNS = "conversation_id,tool_use_id,result_index"


def _entry_to_row(entry: SourceLedgerEntry) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "conversation_id": entry.conversation_id,
                "importer_id": entry.importer_id,
                "tool_name": entry.tool_name,
                "tool_use_id": entry.tool_use_id,
                "result_index": entry.result_index,
                "url": entry.url,
                "title": entry.title,
                "snippet": entry.snippet,
            }
        ),
    )


def _row_to_entry(row: dict[str, Any]) -> SourceLedgerEntry:
    return SourceLedgerEntry(
        id=str(row["id"]),
        conversation_id=str(row["conversation_id"]),
        importer_id=str(row["importer_id"]) if row.get("importer_id") else None,
        tool_name=str(row["tool_name"]),
        tool_use_id=str(row["tool_use_id"]),
        result_index=int(row["result_index"]),
        url=str(row["url"]),
        title=str(row["title"]),
        snippet=str(row["snippet"]) if row.get("snippet") else None,
        captured_at=row.get("captured_at"),
        knowledge_node_id=str(row["knowledge_node_id"]) if row.get("knowledge_node_id") else None,
    )


class SupabaseSourceLedgerRepository:
    """Supabase implementation of SourceLedgerRepository (chat_source_ledger).

    Tenant isolation: rows carry conversation_id (the ownership anchor) --
    importer_id is denormalized audit only, never an ownership authority
    (mirrors chat_cost_ledger's importer_id idiom, T-56-02-03).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def insert_entries(self, entries: Sequence[SourceLedgerEntry]) -> None:
        """Upsert one row per entry against the dedupe index; a no-op for an empty sequence."""
        if not entries:
            return
        rows = [_entry_to_row(entry) for entry in entries]
        self._client.table("chat_source_ledger").upsert(rows, on_conflict=_DEDUPE_CONFLICT_COLUMNS).execute()

    async def get(self, ledger_entry_id: str) -> SourceLedgerEntry | None:
        result = self._client.table("chat_source_ledger").select("*").eq("id", ledger_entry_id).maybe_single().execute()
        if result is None or not result.data:
            return None
        return _row_to_entry(cast("dict[str, Any]", result.data))
