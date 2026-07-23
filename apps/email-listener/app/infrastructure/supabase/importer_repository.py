"""SupabaseImporterRepository — implements ImporterResolver port.

Find-or-create an importer record scoped to ``(user_id, domain slug)`` so two
users forwarding mail from the same sender domain never share one importer
(ING-2). Concurrent same-user redelivery re-reads the owner's existing row after
an insert conflict; a global-slug collision with a DIFFERENT tenant fails closed
to default_importer_id rather than misrouting.

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

    async def resolve(self, sender_address: str, *, user_id: str | None = None) -> str:
        """Resolve sender_address to an importer_id.

        Importer identity is scoped to ``(user_id, slug)`` — NOT the global slug
        alone — so two users forwarding mail from the same sender domain never
        collide on one importer (ING-2: cross-tenant misroute/exposure).

        - If slug is None (malformed sender): logs + returns default_importer_id,
          NO DB row created.
        - user_id is None (legacy agent@ catch-all path, no forwarding owner):
          look up by slug alone; if found return it, else fall back to
          default_importer_id (no owner to anchor a new row to — T-45-05-02).
        - user_id provided: look up the importer owned by THIS user for this slug;
          if found return it. Otherwise insert a new row anchored to user_id.

        Fail-closed: ``importers.slug`` is currently globally UNIQUE, so a slug
        already owned by ANOTHER user cannot get a second row. On such a
        collision we NEVER return the other tenant's importer — we fall back to
        default_importer_id (a benign catch-all) rather than misrouting one
        user's mail into another user's inbox.
        """
        slug = slug_for_sender(sender_address)
        if slug is None:
            logger.warning(
                "importer_resolver_malformed_sender",
                sender_address=sender_address,
                fallback_importer_id=self._default_importer_id,
            )
            return self._default_importer_id

        if user_id is None:
            return self._resolve_legacy_no_owner(slug)

        # Owner known: scope the lookup by (user_id, slug) so we never hand back
        # another tenant's importer for the same domain.
        existing_id = self._find_owned_importer_id(slug, user_id)
        if existing_id is not None:
            return existing_id

        # No importer for this owner+domain yet — insert one anchored to user_id.
        domain = slug.replace("-", ".")
        try:
            self._client.table("importers").insert(
                {"slug": slug, "name": domain, "user_id": user_id},
            ).execute()
        except Exception:
            # Either a concurrent insert by the SAME user (idempotent redelivery)
            # or a global-slug collision with a DIFFERENT tenant. Re-check
            # ownership: only OUR row is safe to return.
            owned_after_conflict = self._find_owned_importer_id(slug, user_id)
            if owned_after_conflict is not None:
                return owned_after_conflict
            logger.warning(
                "importer_resolver_cross_tenant_slug_conflict",
                slug=slug,
                user_id=user_id,
                fallback_importer_id=self._default_importer_id,
            )
            return self._default_importer_id

        created_id = self._find_owned_importer_id(slug, user_id)
        importer_id = created_id if created_id is not None else self._default_importer_id
        logger.info(
            "importer_created",
            slug=slug,
            importer_id=importer_id,
            user_id=user_id,
        )
        return importer_id

    def _resolve_legacy_no_owner(self, slug: str) -> str:
        """Legacy agent@ catch-all path: importer identity is the global slug.

        Returns the existing slug row if any, else falls back to
        default_importer_id (no forwarding owner to anchor a new row to —
        T-45-05-02).
        """
        result = self._client.table("importers").select("id").eq("slug", slug).execute()
        if result.data:
            row = cast("dict[str, Any]", result.data[0])
            return str(row["id"])
        logger.warning(
            "importer_resolver_new_domain_no_owner",
            slug=slug,
            fallback_importer_id=self._default_importer_id,
        )
        return self._default_importer_id

    def _find_owned_importer_id(self, slug: str, user_id: str) -> str | None:
        """Return the importer id owned by user_id for this slug, or None."""
        result = (
            self._client.table("importers")
            .select("id")
            .eq("slug", slug)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            row = cast("dict[str, Any]", result.data[0])
            return str(row["id"])
        return None

    async def list_importer_ids_for_user(self, user_id: str) -> list[str]:
        """Return the importer ids owned by user_id (Phase 44, TENA-03).

        Empty list when the user owns no importers (fail-closed — callers
        must never fall back to "all importers" on an empty result).
        """
        result = self._client.table("importers").select("id").eq("user_id", user_id).execute()
        return [str(cast("dict[str, Any]", row)["id"]) for row in result.data]
