"""SourceLedgerRepository port -- domain abstraction over chat_source_ledger persistence.

Backs RCNV-01's auto-collect hook (Phase 56-02): the zero-ceremony,
zero-knowledge-graph-write candidate pool a `web_search` tool result is
written into automatically, synchronously, inside the tool-round loop -- no
`emit_confirm_action` call, no widget, no user/model action. Contrast with
`KnowledgeGraphRepository` (confirm-ceremony writes to knowledge_nodes /
knowledge_node_edges): this port's `insert_entries` NEVER touches that graph.

Plain dataclass/str param+return types only -- the domain layer must not
import Supabase (verified by lint-imports rule).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Sequence


@dataclass(frozen=True)
class SourceLedgerEntry:
    """One chat_source_ledger row.

    Doubles as both the write-time shape (`insert_entries` -- `id`/
    `captured_at`/`knowledge_node_id` unset/None, the DB assigns them) and
    the read-time shape (`get` -- all fields populated from the persisted
    row). `importer_id` is a denormalized query/audit convenience only,
    never an ownership authority (tenancy resolves via `conversation_id`,
    Pitfall 2 / Landmine 2 in 56-RESEARCH.md).
    """

    conversation_id: str
    importer_id: str | None
    tool_name: str
    tool_use_id: str
    result_index: int
    url: str
    title: str
    snippet: str | None = None
    id: str | None = None
    captured_at: datetime | None = None
    knowledge_node_id: str | None = None


class SourceLedgerRepository(Protocol):
    """Port for persisting and retrieving chat_source_ledger rows."""

    async def insert_entries(self, entries: Sequence[SourceLedgerEntry]) -> None:
        """Upsert one row per entry, idempotent on the (conversation_id, tool_use_id,
        result_index) dedupe index -- re-processing the same tool round never
        double-inserts. A no-op (no DB call) for an empty sequence.
        """
        ...

    async def get(self, ledger_entry_id: str) -> SourceLedgerEntry | None:
        """Return the ledger row matching ledger_entry_id, or None if not found."""
        ...
