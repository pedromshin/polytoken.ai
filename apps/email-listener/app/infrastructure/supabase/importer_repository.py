"""SupabaseImporterRepository — implements ImporterResolver port.

Find-or-create an importer record keyed by the sender's domain slug.
Idempotent under concurrent SNS redelivery via upsert on_conflict="slug".

Malformed senders (no parseable domain) fall back to default_importer_id
WITHOUT creating any row — documented degradation so ingestion never
hard-fails on a weird From header (T-04-34).
"""

from __future__ import annotations

import re
from typing import Any, cast

import structlog
from supabase import Client

logger = structlog.get_logger(__name__)

_SLUG_INVALID_CHARS = re.compile(r"[^a-z0-9-]")


def slug_for_sender(sender_address: str) -> str | None:
    """Derive a deterministic slug from the sender's domain.

    Lowercases the address, splits on "@", takes the domain part, and
    slugifies it by replacing "." with "-" and stripping any remaining
    invalid characters.

    Returns None when there is no usable domain (no "@", or empty domain
    after splitting).
    """
    lowered = sender_address.lower().strip()
    if "@" not in lowered:
        return None
    _, _, domain = lowered.partition("@")
    if not domain:
        return None
    # Replace dots with dashes then strip any remaining non-slug characters
    slugified = domain.replace(".", "-")
    slugified = _SLUG_INVALID_CHARS.sub("", slugified)
    return slugified or None


class SupabaseImporterRepository:
    """Supabase implementation of ImporterResolver.

    Resolves a forwarding-sender address to an importer_id via find-or-create
    keyed on the sender domain slug (UNIQUE constraint on importers.slug).
    """

    def __init__(self, client: Client, *, default_importer_id: str) -> None:
        self._client = client
        self._default_importer_id = default_importer_id

    async def resolve(self, sender_address: str) -> str:
        """Resolve sender_address to an importer_id.

        - Computes the slug from the sender domain.
        - If slug is None (malformed sender): logs + returns default_importer_id,
          NO DB row created.
        - If a row exists for the slug: returns its id.
        - Otherwise: upserts a new row (on_conflict="slug" — idempotent under
          concurrent redelivery) then re-selects to return the persisted id.
        """
        slug = slug_for_sender(sender_address)
        if slug is None:
            logger.warning(
                "importer_resolver_malformed_sender",
                sender_address=sender_address,
                fallback_importer_id=self._default_importer_id,
            )
            return self._default_importer_id

        # Try to find an existing row for this slug
        result = self._client.table("importers").select("id").eq("slug", slug).execute()
        if result.data:
            row = cast("dict[str, Any]", result.data[0])
            return str(row["id"])

        # Slug not found — upsert (idempotent under concurrent SNS redelivery)
        domain = slug.replace("-", ".")
        self._client.table("importers").upsert(
            {"slug": slug, "name": domain},
            on_conflict="slug",
        ).execute()

        # Re-select to get the persisted id (upsert may not return the row)
        created = self._client.table("importers").select("id").eq("slug", slug).execute()
        created_row = cast("dict[str, Any]", created.data[0])
        importer_id = str(created_row["id"])
        logger.info(
            "importer_created",
            slug=slug,
            importer_id=importer_id,
        )
        return importer_id

    async def list_importer_ids_for_user(self, user_id: str) -> list[str]:
        """Return the importer ids owned by user_id (Phase 44, TENA-03).

        Empty list when the user owns no importers (fail-closed — callers
        must never fall back to "all importers" on an empty result).
        """
        result = self._client.table("importers").select("id").eq("user_id", user_id).execute()
        return [str(cast("dict[str, Any]", row)["id"]) for row in result.data]
