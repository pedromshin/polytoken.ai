"""SupabaseEmailRepository — implements EmailRepository port.

Every query includes .eq("importer_id", ...) for multi-tenant isolation (D-05).
save() upserts on (importer_id, message_id) for idempotent ingestion.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from supabase import Client

from app.domain.entities.email import Email


def _parse_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value)


def _to_row(email: Email) -> dict[str, Any]:
    return {
        "id": email.id,
        "importer_id": email.importer_id,
        "thread_id": email.thread_id,
        "message_id": email.message_id,
        "in_reply_to": email.in_reply_to,
        "references_ids": list(email.references_ids),
        "received_at": email.received_at.isoformat(),
        "sender_address": email.sender_address,
        "sender_name": email.sender_name,
        "to_addresses": list(email.to_addresses),
        "cc_addresses": list(email.cc_addresses),
        "subject": email.subject,
        "body_html": email.body_html,
        "body_text": email.body_text,
        "raw_storage_key": email.raw_storage_key,
        "parse_status": email.parse_status,
        "parse_error": email.parse_error,
        "parsed_at": email.parsed_at.isoformat() if email.parsed_at else None,
        "created_at": email.created_at.isoformat(),
    }


def _from_row(row: dict[str, Any]) -> Email:
    return Email(
        id=row["id"],
        importer_id=row["importer_id"],
        thread_id=row.get("thread_id"),
        message_id=row["message_id"],
        in_reply_to=row.get("in_reply_to"),
        references_ids=tuple(row.get("references_ids") or []),
        received_at=datetime.fromisoformat(row["received_at"]),
        sender_address=row["sender_address"],
        sender_name=row.get("sender_name"),
        to_addresses=tuple(row.get("to_addresses") or []),
        cc_addresses=tuple(row.get("cc_addresses") or []),
        subject=row.get("subject"),
        body_html=row.get("body_html"),
        body_text=row.get("body_text"),
        raw_storage_key=row.get("raw_storage_key"),
        parse_status=row["parse_status"],
        parse_error=row.get("parse_error"),
        parsed_at=_parse_dt(row.get("parsed_at")),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


class SupabaseEmailRepository:
    """Supabase implementation of EmailRepository.

    Tenant isolation: every read/write includes .eq("importer_id", ...).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def save(self, email: Email) -> Email:
        """Upsert on (importer_id, message_id); returns the persisted entity."""
        result = self._client.table("emails").upsert(_to_row(email), on_conflict="importer_id,message_id").execute()
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_id(self, email_id: str) -> Email | None:
        result = self._client.table("emails").select("*").eq("id", email_id).execute()
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_message_id(self, importer_id: str, message_id: str) -> Email | None:
        result = (
            self._client.table("emails")
            .select("*")
            .eq("importer_id", importer_id)
            .eq("message_id", message_id)
            .execute()
        )
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def list_by_importer(self, importer_id: str | None, limit: int, offset: int) -> list[Email]:
        query = self._client.table("emails").select("*")
        if importer_id is not None:
            query = query.eq("importer_id", importer_id)
        result = query.order("received_at", desc=True).range(offset, offset + limit - 1).execute()
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def list_by_importer_ids(self, importer_ids: list[str], limit: int, offset: int) -> list[Email]:
        """Scope to the given importer ids (Phase 44, TENA-03) — never all rows."""
        if not importer_ids:
            return []
        result = (
            self._client.table("emails")
            .select("*")
            .in_("importer_id", importer_ids)
            .order("received_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def list_by_thread_id(self, *, importer_id: str, thread_id: str, limit: int, offset: int = 0) -> list[Email]:
        """Scoped to importer_id — a thread_id from a foreign importer resolves to [] (Phase 54-05, CLUS-02)."""
        result = (
            self._client.table("emails")
            .select("*")
            .eq("importer_id", importer_id)
            .eq("thread_id", thread_id)
            .order("received_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def update_parse_status(
        self, email_id: str, status: str, error: str | None, *, parsed_at: datetime | None = None
    ) -> None:
        (
            self._client.table("emails")
            .update(
                {
                    "parse_status": status,
                    "parse_error": error,
                    "parsed_at": parsed_at.isoformat() if parsed_at else None,
                }
            )
            .eq("id", email_id)
            .execute()
        )
