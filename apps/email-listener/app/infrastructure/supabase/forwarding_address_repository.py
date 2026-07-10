"""SupabaseForwardingAddressRepository — implements ForwardingAddressResolver port.

Resolves a recipient's `u-{token}` local-part to the owning user_id via
forwarding_addresses.token (UNIQUE, Plan 45-01). Fail-closed: an unknown or
malformed token never discloses or invents a user (T-45-05-01/02) — it simply
contributes nothing, so ingestion falls back to the legacy/default importer
path unaffected.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, cast

import structlog
from supabase import Client

logger = structlog.get_logger(__name__)

_TOKEN_PREFIX = "u-"  # noqa: S105 — email local-part prefix, not a credential


def token_from_recipient(address: str) -> str | None:
    """Extract the forwarding token from a recipient of the form u-{token}@domain.

    Tolerant of surrounding whitespace/angle brackets (e.g. "<u-ABC@x.com>").
    The "u-" prefix check and the extracted token are both exact/case-sensitive
    — the web half's tokens (Plan 45-06) are CSPRNG base64url, which is
    case-sensitive, so this never lowercases or otherwise normalizes the
    token's characters.

    Returns None when:
    - the local part does not start with the literal "u-" prefix,
    - the address has no "@" or an empty domain, or
    - the token portion (everything after "u-") is empty.
    """
    stripped = address.strip().strip("<>").strip()
    if "@" not in stripped:
        return None
    local, _, domain = stripped.partition("@")
    if not domain or not local.startswith(_TOKEN_PREFIX):
        return None
    token = local[len(_TOKEN_PREFIX) :]
    return token or None


class SupabaseForwardingAddressRepository:
    """Supabase implementation of ForwardingAddressResolver.

    For each recipient (in the given order), extracts its token via
    token_from_recipient and looks up forwarding_addresses by exact token
    match; the first recipient that resolves wins. Non-"u-" recipients are
    skipped without a DB call; an unknown token contributes nothing and
    resolution continues to the next recipient; an exhausted/empty list
    resolves to None (fail-closed).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def resolve_recipients(self, recipients: Sequence[str]) -> str | None:
        for recipient in recipients:
            token = token_from_recipient(recipient)
            if token is None:
                continue

            result = self._client.table("forwarding_addresses").select("user_id").eq("token", token).execute()
            if result.data:
                row = cast("dict[str, Any]", result.data[0])
                user_id = str(row["user_id"])
                # Never log the recipient/token itself (it IS the secret, T-45-05-01) —
                # only the resolved user_id, which is an identifier, not a credential.
                logger.info("forwarding_address_resolved", user_id=user_id)
                return user_id

            logger.warning("forwarding_address_unknown_token")

        return None
