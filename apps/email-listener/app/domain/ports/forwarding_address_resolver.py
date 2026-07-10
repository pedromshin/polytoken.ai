"""ForwardingAddressResolver port — domain abstraction over recipient-token resolution."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class ForwardingAddressResolver(Protocol):
    """Resolve SES envelope recipients to the owning user_id of a forwarding token.

    Fail-closed contract (T-45-05-01/02): an unknown or malformed token
    resolves to None. The resolver never invents or discloses a user for a
    token it cannot match — ingestion continues normally, with importer
    creation falling back to the legacy/default path.
    """

    async def resolve_recipients(self, recipients: Sequence[str]) -> str | None:
        """Resolve the first matching u-{token} recipient to its owning user_id.

        Args:
            recipients: SES envelope destination recipient addresses (may
                include non-forwarding addresses, e.g. the legacy agent@
                catch-all — those are silently ignored, not errors).

        Returns:
            The user_id (UUID string) that owns the first token-matching
            recipient's forwarding_addresses row. None when no recipient
            resolves — including an empty list, no "u-" recipient, or every
            "u-" recipient's token being unknown (fail-closed).
        """
        ...
