"""Tests for SupabaseForwardingAddressRepository and token_from_recipient helper.

Uses unittest.mock to assert table/op/filter call shapes — no live DB.
Mirrors tests/test_importer_repository.py's chain-mock style.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

USER_ID = "10000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "20000000-0000-0000-0000-000000000002"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_chain_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a chainable mock for PostgREST-style supabase calls."""
    execute_result = MagicMock()
    execute_result.data = return_data or []
    chain = MagicMock()
    chain.execute.return_value = execute_result
    chain.eq.return_value = chain
    chain.select.return_value = chain
    return chain


def _make_client_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a mock supabase Client that chains table().select().eq().execute()."""
    client = MagicMock()
    chain = _make_chain_mock(return_data)
    client.table.return_value = chain
    return client


# ---------------------------------------------------------------------------
# token_from_recipient helper
# ---------------------------------------------------------------------------


def test_token_from_recipient_extracts_token() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("u-ABC123@magnitudetech.com.br") == "ABC123"


def test_token_from_recipient_preserves_case_exactly() -> None:
    """base64url tokens are case-sensitive — the extracted token must not be normalized."""
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("u-aBcDeF-_09@x.com") == "aBcDeF-_09"


def test_token_from_recipient_tolerant_of_whitespace_and_angle_brackets() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient(" <u-ABC123@x.com> ") == "ABC123"


def test_token_from_recipient_ignores_non_u_prefix() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("agent@magnitudetech.com.br") is None


def test_token_from_recipient_prefix_check_is_case_sensitive() -> None:
    """An upper-case "U-" prefix must NOT match the exact "u-" contract."""
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("U-ABC123@x.com") is None


def test_token_from_recipient_returns_none_for_no_at_sign() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("not-an-email") is None


def test_token_from_recipient_returns_none_for_empty_domain() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("u-ABC123@") is None


def test_token_from_recipient_returns_none_for_empty_token() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import token_from_recipient

    assert token_from_recipient("u-@x.com") is None


# ---------------------------------------------------------------------------
# SupabaseForwardingAddressRepository.resolve_recipients
# ---------------------------------------------------------------------------


def test_resolve_recipients_returns_user_id_for_matching_token() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    row = {"user_id": USER_ID}
    client = _make_client_mock(return_data=[row])
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(repo.resolve_recipients(["u-ABC123@magnitudetech.com.br"]))

    assert result == USER_ID
    chain = client.table.return_value
    chain.eq.assert_called_once_with("token", "ABC123")


def test_resolve_recipients_ignores_non_u_recipient() -> None:
    """A recipient whose local part is not "u-"-prefixed is skipped without any DB call."""
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    client = _make_client_mock()
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(repo.resolve_recipients(["agent@magnitudetech.com.br"]))

    assert result is None
    client.table.assert_not_called()


def test_resolve_recipients_unknown_token_returns_none() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    client = _make_client_mock(return_data=[])
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(repo.resolve_recipients(["u-UNKNOWN@magnitudetech.com.br"]))

    assert result is None


def test_resolve_recipients_multiple_recipients_first_match_wins() -> None:
    """When multiple recipients resolve, the first one wins."""
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    first_result = MagicMock(data=[{"user_id": USER_ID}])
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.execute.return_value = first_result

    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(
        repo.resolve_recipients(["u-FIRST@x.com", "u-SECOND@x.com"]),
    )

    assert result == USER_ID
    # Only the first recipient's token should have been queried.
    chain.eq.assert_called_once_with("token", "FIRST")


def test_resolve_recipients_skips_unknown_token_then_matches_next() -> None:
    """An unknown-token recipient contributes nothing; resolution continues to the next."""
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.execute.side_effect = [
        MagicMock(data=[]),  # first recipient's token unknown
        MagicMock(data=[{"user_id": OTHER_USER_ID}]),  # second recipient resolves
    ]

    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(
        repo.resolve_recipients(["u-UNKNOWN@x.com", "u-KNOWN@x.com"]),
    )

    assert result == OTHER_USER_ID
    assert chain.eq.call_args_list == [
        (("token", "UNKNOWN"),),
        (("token", "KNOWN"),),
    ]


def test_resolve_recipients_empty_list_returns_none() -> None:
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    client = _make_client_mock()
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(repo.resolve_recipients([]))

    assert result is None
    client.table.assert_not_called()


def test_resolve_recipients_near_miss_token_does_not_match() -> None:
    """A near-miss token (extra/missing char) must not match — exact equality only."""
    from app.infrastructure.supabase.forwarding_address_repository import (
        SupabaseForwardingAddressRepository,
    )

    # The mocked DB layer only "knows" the exact token "ABC123"; the .eq() filter
    # itself is exact-match, so a near-miss recipient's token simply returns no
    # rows from a real DB. Simulate that by returning empty data and asserting
    # the queried token differs from the near-miss variants.
    client = _make_client_mock(return_data=[])
    repo = SupabaseForwardingAddressRepository(client=client)

    result = asyncio.run(repo.resolve_recipients(["u-ABC1234@x.com"]))  # near-miss: extra char

    assert result is None
    chain = client.table.return_value
    chain.eq.assert_called_once_with("token", "ABC1234")
