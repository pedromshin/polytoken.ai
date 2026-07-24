"""SupabaseAttachmentRepository — implements AttachmentRepository port."""

from __future__ import annotations

import asyncio
from typing import Any, cast

from supabase import Client

from app.domain.entities.attachment import Attachment


def _to_row(attachment: Attachment) -> dict[str, Any]:
    return {
        "id": attachment.id,
        "email_id": attachment.email_id,
        "importer_id": attachment.importer_id,
        "filename": attachment.filename,
        "content_type": attachment.content_type,
        "file_ext": attachment.file_ext,
        "size_bytes": attachment.size_bytes,
        "storage_key": attachment.storage_key,
        "parent_attachment_id": attachment.parent_attachment_id,
        "parse_status": attachment.parse_status,
    }


def _from_row(row: dict[str, Any]) -> Attachment:
    return Attachment(
        id=row["id"],
        email_id=row["email_id"],
        importer_id=row["importer_id"],
        filename=row.get("filename"),
        content_type=row["content_type"],
        file_ext=row.get("file_ext"),
        size_bytes=row.get("size_bytes"),
        storage_key=row["storage_key"],
        parent_attachment_id=row.get("parent_attachment_id"),
        parse_status=row["parse_status"],
    )


class SupabaseAttachmentRepository:
    """Supabase implementation of AttachmentRepository."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def save(self, attachment: Attachment) -> Attachment:
        """Upsert an attachment row; returns the persisted entity."""
        result = await asyncio.to_thread(
            lambda: self._client.table("email_attachments").upsert(_to_row(attachment), on_conflict="id").execute()
        )
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def count_by_email_ids(self, email_ids: list[str]) -> dict[str, int]:
        """Return {email_id: attachment_count} for the given email ids."""
        if not email_ids:
            return {}
        result = await asyncio.to_thread(
            lambda: self._client.table("email_attachments").select("email_id").in_("email_id", email_ids).execute()
        )
        counts: dict[str, int] = {}
        for row in result.data:
            email_id = cast("dict[str, Any]", row)["email_id"]
            counts[email_id] = counts.get(email_id, 0) + 1
        return counts

    async def find_by_email_id(self, email_id: str) -> list[Attachment]:
        """Return all attachments for the given email_id (tenant-bound via email_id)."""
        result = await asyncio.to_thread(
            lambda: self._client.table("email_attachments").select("*").eq("email_id", email_id).execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]
