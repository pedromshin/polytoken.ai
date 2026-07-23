"""Tests for SupabaseImporterRepository and slug_for_sender helper.

Uses unittest.mock to assert table/op/filter call shapes — no live DB.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

DEFAULT_IMPORTER_ID = "00000000-0000-0000-0000-000000000001"
NEW_IMPORTER_ID = "aaaaaaaa-0000-0000-0000-000000000002"
FORWARDING_USER_ID = "10000000-0000-0000-0000-000000000099"


# ---------------------------------------------------------------------------
# Helpers (mirror test_supabase_repositories.py style)
# ---------------------------------------------------------------------------


def _make_chain_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a chainable mock for PostgREST-style supabase calls."""
    execute_result = MagicMock()
    execute_result.data = return_data or []
    chain = MagicMock()
    chain.execute.return_value = execute_result
    chain.eq.return_value = chain
    chain.upsert.return_value = chain
    chain.insert.return_value = chain
    chain.select.return_value = chain
    return chain


def _make_client_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a mock supabase Client that chains table().op().execute()."""
    client = MagicMock()
    chain = _make_chain_mock(return_data)
    client.table.return_value = chain
    return client


# ---------------------------------------------------------------------------
# slug_for_sender helper
# ---------------------------------------------------------------------------


def test_slug_for_sender_normalizes_domain() -> None:
    from app.infrastructure.supabase.importer_repository import slug_for_sender

    assert slug_for_sender("maria@exporter.com") == "exporter-com"


def test_slug_for_sender_is_case_insensitive() -> None:
    from app.infrastructure.supabase.importer_repository import slug_for_sender

    assert slug_for_sender("Maria@Exporter.COM") == "exporter-com"


def test_slug_for_sender_returns_none_for_no_at_sign() -> None:
    from app.infrastructure.supabase.importer_repository import slug_for_sender

    assert slug_for_sender("noatsign") is None


def test_slug_for_sender_returns_none_for_empty_string() -> None:
    from app.infrastructure.supabase.importer_repository import slug_for_sender

    assert slug_for_sender("") is None


def test_slug_for_sender_returns_none_for_empty_domain() -> None:
    from app.infrastructure.supabase.importer_repository import slug_for_sender

    assert slug_for_sender("user@") is None


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — known sender (slug already in DB)
# ---------------------------------------------------------------------------


def test_resolve_returns_existing_id_without_inserting() -> None:
    """When a slug row exists, resolve returns the id without any upsert."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    existing_row = {"id": NEW_IMPORTER_ID, "slug": "exporter-com", "name": "exporter.com"}
    client = _make_client_mock(return_data=[existing_row])
    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)

    result = asyncio.run(repo.resolve("maria@exporter.com"))

    assert result == NEW_IMPORTER_ID
    # upsert must NOT have been called
    chain = client.table.return_value
    chain.upsert.assert_not_called()


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — unknown sender + resolved owner (must
# upsert anchored to user_id, then re-select) — Phase 45, THRD-04
# ---------------------------------------------------------------------------


def test_resolve_creates_new_importer_anchored_to_user_id_for_unknown_sender() -> None:
    """For an unknown sender WITH a resolved forwarding user, resolve inserts a
    new row anchored to user_id and returns its id."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    new_row = {"id": NEW_IMPORTER_ID, "slug": "exporter-com", "name": "exporter.com", "user_id": FORWARDING_USER_ID}

    # First (user_id-scoped) select returns empty — this user has no importer yet
    first_select_result = MagicMock()
    first_select_result.data = []
    # insert execute result (return value unused)
    insert_result = MagicMock()
    insert_result.data = []
    # Re-select after insert returns the new row
    second_select_result = MagicMock()
    second_select_result.data = [new_row]

    chain = MagicMock()
    chain.eq.return_value = chain
    chain.insert.return_value = chain
    chain.select.return_value = chain
    # Three execute() calls: owner-scoped select, insert, re-select
    chain.execute.side_effect = [first_select_result, insert_result, second_select_result]

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)
    result = asyncio.run(repo.resolve("maria@exporter.com", user_id=FORWARDING_USER_ID))

    assert result == NEW_IMPORTER_ID
    # insert must be called once with a user_id-anchored payload
    insert_calls = chain.insert.call_args_list
    assert len(insert_calls) == 1
    payload = insert_calls[0].args[0] if insert_calls[0].args else {}
    assert payload.get("slug") == "exporter-com"
    assert payload.get("user_id") == FORWARDING_USER_ID


def test_resolve_scopes_existing_lookup_by_user_id_not_slug_alone() -> None:
    """ING-2 regression: an existing slug lookup must be filtered by user_id.

    User B forwarding mail from a domain User A already anchored must NOT be
    handed A's importer. Here the owner-scoped select finds no row for B and the
    insert succeeds (composite ownership), so B gets its OWN importer — never A's.
    """
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    user_b = "20000000-0000-0000-0000-0000000000bb"
    b_importer = "bbbbbbbb-0000-0000-0000-0000000000bb"

    empty = MagicMock()
    empty.data = []
    inserted = MagicMock()
    inserted.data = []
    reselect = MagicMock()
    reselect.data = [{"id": b_importer, "slug": "acme-com", "user_id": user_b}]

    chain = MagicMock()
    chain.eq.return_value = chain
    chain.insert.return_value = chain
    chain.select.return_value = chain
    chain.execute.side_effect = [empty, inserted, reselect]

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)
    result = asyncio.run(repo.resolve("jose@acme.com", user_id=user_b))

    assert result == b_importer
    # The existence lookup must filter on BOTH slug and user_id (two .eq calls)
    eq_call_keys = [c.args[0] for c in chain.eq.call_args_list if c.args]
    assert "slug" in eq_call_keys
    assert "user_id" in eq_call_keys


def test_resolve_cross_tenant_slug_conflict_fails_closed_to_default() -> None:
    """ING-2 regression: a global-slug collision with another tenant must NOT
    return that tenant's importer — it fails closed to default_importer_id."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    user_b = "20000000-0000-0000-0000-0000000000bb"

    empty_before = MagicMock()
    empty_before.data = []
    empty_after = MagicMock()
    empty_after.data = []  # still no row OWNED by B after the conflict

    chain = MagicMock()
    chain.eq.return_value = chain
    chain.insert.return_value = chain
    chain.select.return_value = chain
    # owner-scoped select (empty), insert RAISES (unique(slug) collision),
    # ownership re-check (still empty for B)
    chain.execute.side_effect = [empty_before, RuntimeError("duplicate key value violates unique constraint"), empty_after]

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)
    result = asyncio.run(repo.resolve("jose@acme.com", user_id=user_b))

    assert result == DEFAULT_IMPORTER_ID


def test_resolve_concurrent_same_user_insert_conflict_returns_own_row() -> None:
    """A concurrent same-user insert race resolves to the user's OWN row, not default."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    empty_before = MagicMock()
    empty_before.data = []
    own_after = MagicMock()
    own_after.data = [{"id": NEW_IMPORTER_ID, "slug": "exporter-com", "user_id": FORWARDING_USER_ID}]

    chain = MagicMock()
    chain.eq.return_value = chain
    chain.insert.return_value = chain
    chain.select.return_value = chain
    chain.execute.side_effect = [empty_before, RuntimeError("duplicate key"), own_after]

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)
    result = asyncio.run(repo.resolve("maria@exporter.com", user_id=FORWARDING_USER_ID))

    assert result == NEW_IMPORTER_ID


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — unknown sender + NO resolved owner
# (T-45-05-02: falls back to default rather than a NOT-NULL-violating row)
# ---------------------------------------------------------------------------


def test_resolve_unknown_sender_no_user_id_falls_back_to_default_no_row_created() -> None:
    """For an unknown sender with NO resolved forwarding user (legacy agent@
    path), resolve falls back to default_importer_id WITHOUT any upsert —
    importers.user_id is NOT NULL since Phase 44 (T-45-05-02)."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    first_select_result = MagicMock()
    first_select_result.data = []

    chain = MagicMock()
    chain.eq.return_value = chain
    chain.select.return_value = chain
    chain.execute.return_value = first_select_result

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)
    result = asyncio.run(repo.resolve("maria@exporter.com"))

    assert result == DEFAULT_IMPORTER_ID
    chain.upsert.assert_not_called()


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — idempotency (same result on second call)
# ---------------------------------------------------------------------------


def test_resolve_is_idempotent_for_same_sender() -> None:
    """Second resolve for the same sender returns the same id (upsert on_conflict guarantees no dup)."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    existing_row = {"id": NEW_IMPORTER_ID, "slug": "exporter-com", "name": "exporter.com"}
    client = _make_client_mock(return_data=[existing_row])
    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)

    first = asyncio.run(repo.resolve("maria@exporter.com"))
    second = asyncio.run(repo.resolve("maria@exporter.com"))

    assert first == second == NEW_IMPORTER_ID


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — case insensitivity
# ---------------------------------------------------------------------------


def test_resolve_case_insensitive_same_slug() -> None:
    """Upper-case sender resolves to the same slug/id as lower-case."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    row = {"id": NEW_IMPORTER_ID, "slug": "exporter-com", "name": "exporter.com"}
    client = _make_client_mock(return_data=[row])
    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)

    lower_result = asyncio.run(repo.resolve("maria@exporter.com"))
    upper_result = asyncio.run(repo.resolve("Maria@Exporter.COM"))

    assert lower_result == upper_result == NEW_IMPORTER_ID


# ---------------------------------------------------------------------------
# SupabaseImporterRepository.resolve — malformed sender fallback (no row created)
# ---------------------------------------------------------------------------


def test_resolve_malformed_sender_falls_back_to_default_no_row_created() -> None:
    """Malformed senders (no domain) fall back to default_importer_id without any DB write."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _make_client_mock()
    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)

    result = asyncio.run(repo.resolve("noatsign"))

    assert result == DEFAULT_IMPORTER_ID
    # No table operations must occur
    client.table.assert_not_called()


def test_resolve_empty_sender_falls_back_to_default_no_row_created() -> None:
    """Empty sender string falls back to default_importer_id without any DB write."""
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _make_client_mock()
    repo = SupabaseImporterRepository(client=client, default_importer_id=DEFAULT_IMPORTER_ID)

    result = asyncio.run(repo.resolve(""))

    assert result == DEFAULT_IMPORTER_ID
    client.table.assert_not_called()
