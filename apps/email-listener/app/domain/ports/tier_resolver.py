"""TierResolver port — resolve an importer to its owning user's subscription tier.

The ingest budget guard self-derives the tier from the importer id (it NEVER
trusts a caller-passed tier): importer -> owning user -> subscription tier. The
guard maps the returned tier to a daily ingest cap via
app.domain.services.tier_entitlements. Implementations RAISE on a genuine query
error rather than swallowing it — the guard's own fail-open contract turns a
raise into "use the constructed default cap", never a silent free-tier downgrade.
"""

from __future__ import annotations

from typing import Protocol


class TierResolver(Protocol):
    """Resolve an importer id to its owning user's tier ('free' | 'pro' | 'power')."""

    async def tier_for_importer(self, importer_id: str) -> str:
        """The subscription tier for the user who owns *importer_id*.

        Returns ``'free'`` when the importer or its subscription is absent or the
        subscription is not in an active/trialing paid state. RAISES on a genuine
        query error (the guard fails open on the raise).
        """
        ...


class UserTierResolver(Protocol):
    """Resolve a user id directly to its subscription tier (vLAUNCH W5-1).

    The chat-turn cap gate's tier read: RunChatTurn self-derives the user id
    from the conversation OWNER (never a caller-passed tier or user id) and
    asks this for the tier — the chat path has no importer to pivot through
    (its importer_id is usually the shared DEFAULT importer), so this is a
    separate, narrower port rather than a second method on TierResolver.
    SupabaseTierResolver implements both.
    """

    async def tier_for_user(self, user_id: str) -> str:
        """The subscription tier for *user_id*.

        Returns ``'free'`` when the subscription is absent or not in an
        active/trialing paid state. RAISES on a genuine query error (the
        chat-turn cap gate fails open on the raise).
        """
        ...
