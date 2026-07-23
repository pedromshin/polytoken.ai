"""Deterministic identity for the email-body component (mirrors REG-1).

An email's body is a single logical "page" of extractable content. Like
attachment pages, re-ingesting the same email must UPSERT the same body row
instead of inserting a duplicate: ComponentRepository.save_many upserts on
`id`, so the body component id must be a pure function of the email id (which
is itself reused across redelivery/reprocess).

Domain-layer module so both the application layer (which mints the body
component at ingest) and any future de-duplication logic may share it without
violating the import-linter contracts.
"""

from __future__ import annotations

import uuid


def email_body_component_id(email_id: str) -> str:
    """Return the canonical, deterministic component id for an email's body.

    Stable across re-ingests of the same email: same email id -> same uuid5,
    so save_many (upsert on id) overwrites in place rather than duplicating.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nauta-email-body/{email_id}"))
