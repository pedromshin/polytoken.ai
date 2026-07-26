"""Tests for ReprocessEmailUseCase: re-ingest-then-supersede, non-destructive.

Reprocess re-ingests FIRST, then bulk-supersedes ONLY the OLD pending
(auto-proposed) region pile — and only when re-ingest actually produced fresh
proposals. This makes reprocess non-destructive under failure (REG-3), idempotent
across repeated runs (no duplicate-region accumulation, REG-1), and preserves
human-touched regions (candidate/confirmed/rejected) and page components — the
latter enforced by the repository filter, covered by the SupabaseComponentRepository
tests below.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from postgrest.base_request_builder import CountMethod

from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.entities.email import Email
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

NOW = datetime(2026, 6, 13, 12, 0, 0, tzinfo=UTC)
EMAIL_ID = "9b0e2e4d-563b-46d1-8029-41f0048ce587"
IMPORTER_ID = "imp-001"


def _email() -> Email:
    return Email(
        id=EMAIL_ID,
        importer_id=IMPORTER_ID,
        message_id="<m@x>",
        in_reply_to=None,
        references_ids=(),
        received_at=NOW,
        sender_address="s@x.com",
        sender_name=None,
        to_addresses=("agent@x",),
        cc_addresses=(),
        subject="s",
        body_html=None,
        body_text="b",
        raw_storage_key="inbound/local/ses-abc",
        parse_status="parsed",
        parse_error=None,
        parsed_at=NOW,
        created_at=NOW,
    )


def _use_case(*, emails: AsyncMock, components: AsyncMock, ingest: AsyncMock) -> ReprocessEmailUseCase:
    return ReprocessEmailUseCase(
        emails=emails,
        components=components,
        extractions=AsyncMock(),
        ingest=ingest,
    )


def test_reprocess_reingests_then_supersedes_old_pending() -> None:
    """Happy path: re-ingest runs BEFORE supersede, and supersede targets only
    the OLD pile (created_before=cutoff) — never the freshly proposed regions."""
    emails = AsyncMock()
    emails.find_by_id.return_value = _email()

    db_cutoff = "2026-06-13T11:59:58.123456+00:00"
    components = AsyncMock()
    components.count_pending_regions_created_since.return_value = 20  # re-ingest made new boxes
    components.latest_component_created_at.return_value = db_cutoff
    components.supersede_pending_regions.return_value = 984  # the old duplicate pile

    ingest = AsyncMock()

    # Attach both to one parent so we can assert ingest happened BEFORE supersede.
    manager = MagicMock()
    manager.attach_mock(ingest.execute, "ingest")
    manager.attach_mock(components.supersede_pending_regions, "supersede")

    result = asyncio.run(_use_case(emails=emails, components=components, ingest=ingest).execute(email_id=EMAIL_ID))

    # Cutoff comes from the DB's own row timestamps (latest_component_created_at),
    # NEVER from datetime.now(UTC) on the app server (clock-skew mitigation).
    components.latest_component_created_at.assert_awaited_once_with(EMAIL_ID)
    components.supersede_pending_regions.assert_awaited_once_with(EMAIL_ID, created_before=db_cutoff)
    ingest.execute.assert_awaited_once_with("ses-abc", reprocess=True)
    # created_before cutoff keyword confines the supersede to the OLD pile.
    assert components.supersede_pending_regions.await_count == 1
    kwargs = components.supersede_pending_regions.await_args.kwargs
    assert components.supersede_pending_regions.await_args.args[0] == EMAIL_ID
    assert "created_before" in kwargs
    # Ordering: ingest must precede the supersede (non-destructive contract).
    assert [c[0] for c in manager.mock_calls] == ["ingest", "supersede"]
    assert result == {
        "email_id": EMAIL_ID,
        "superseded_components": 984,
        "new_regions": 20,
    }


def test_reprocess_skips_supersede_when_reingest_produces_no_regions() -> None:
    """REG-3: a Bedrock outage makes the segmenter return [] WITHOUT raising, so
    re-ingest completes but yields zero regions. Reprocess must NOT supersede the
    prior proposals — otherwise the overlay silently empties behind a 200."""
    emails = AsyncMock()
    emails.find_by_id.return_value = _email()

    components = AsyncMock()
    components.count_pending_regions_created_since.return_value = 0  # outage: nothing new
    ingest = AsyncMock()

    result = asyncio.run(_use_case(emails=emails, components=components, ingest=ingest).execute(email_id=EMAIL_ID))

    ingest.execute.assert_awaited_once_with("ses-abc", reprocess=True)
    components.supersede_pending_regions.assert_not_called()  # prior proposals preserved
    assert result == {
        "email_id": EMAIL_ID,
        "superseded_components": 0,
        "new_regions": 0,
    }


def test_reprocess_never_supersedes_when_reingest_raises() -> None:
    """REG-3 / RPR-2: if re-ingest raises (raw S3 object lifecycle-deleted), the
    supersede is never reached — the prior proposals are left fully intact."""
    emails = AsyncMock()
    emails.find_by_id.return_value = _email()

    components = AsyncMock()
    ingest = AsyncMock()
    ingest.execute.side_effect = RuntimeError("NoSuchKey: raw object gone")

    raised = False
    try:
        asyncio.run(_use_case(emails=emails, components=components, ingest=ingest).execute(email_id=EMAIL_ID))
    except RuntimeError:
        raised = True

    assert raised
    components.supersede_pending_regions.assert_not_called()
    components.count_pending_regions_created_since.assert_not_called()


def test_reprocess_with_no_prior_components_skips_supersede() -> None:
    """No components existed before this reprocess (cutoff is None) -> there is
    nothing old to supersede, and under re-ingest-first ordering an unbounded
    supersede would eat the FRESH proposals — so it must be skipped entirely."""
    emails = AsyncMock()
    emails.find_by_id.return_value = _email()

    components = AsyncMock()
    components.latest_component_created_at.return_value = None
    components.count_pending_regions_created_since.return_value = 5  # fresh proposals

    use_case = ReprocessEmailUseCase(
        emails=emails,
        components=components,
        extractions=AsyncMock(),
        ingest=AsyncMock(),
    )

    result = asyncio.run(use_case.execute(email_id=EMAIL_ID))

    components.count_pending_regions_created_since.assert_awaited_once_with(EMAIL_ID, None)
    components.supersede_pending_regions.assert_not_called()
    assert result == {"email_id": EMAIL_ID, "superseded_components": 0, "new_regions": 5}


def test_reprocess_unknown_email_raises_without_touching_components() -> None:
    emails = AsyncMock()
    emails.find_by_id.return_value = None
    components = AsyncMock()
    ingest = AsyncMock()

    raised = False
    try:
        asyncio.run(_use_case(emails=emails, components=components, ingest=ingest).execute(email_id="missing"))
    except ValueError:
        raised = True

    assert raised
    components.supersede_pending_regions.assert_not_called()
    components.count_pending_regions_created_since.assert_not_called()
    ingest.execute.assert_not_called()


def test_count_pending_regions_created_since_uses_exact_count() -> None:
    """Existence/size probe for fresh proposals uses count='exact' so it is not
    silently truncated by the PostgREST 1000-row SELECT cap. The bound is
    STRICT (>) over the DB timestamp string so the boundary row (the newest
    pre-existing component) never counts as fresh."""
    cutoff = "2026-06-13T12:00:00+00:00"
    client = MagicMock()
    select_chain = (
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.gt.return_value
    )
    select_chain.execute.return_value.count = 7

    repo = SupabaseComponentRepository(client)
    count = asyncio.run(repo.count_pending_regions_created_since(EMAIL_ID, cutoff))

    assert count == 7
    client.table.return_value.select.assert_called_once_with("id", count=CountMethod.exact)
    gt = client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.gt
    gt.assert_called_once_with("created_at", cutoff)


def test_count_pending_regions_with_none_cutoff_counts_all_pending() -> None:
    """cutoff=None (no components existed before re-ingest) -> no created_at
    filter; every pending region counts as fresh."""
    client = MagicMock()
    select_chain = client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value
    select_chain.execute.return_value.count = 3

    repo = SupabaseComponentRepository(client)
    count = asyncio.run(repo.count_pending_regions_created_since(EMAIL_ID, None))

    assert count == 3
    select_chain.gt.assert_not_called()


def test_supersede_pending_regions_applies_inclusive_created_at_bound() -> None:
    """With created_before set, the bulk update adds created_at <= cutoff (lte,
    inclusive — a save_many batch shares one statement timestamp) so rows
    inserted after the DB-derived snapshot are never superseded."""
    cutoff = "2026-06-13T11:59:58.123456+00:00"
    client = MagicMock()
    lte_chain = (
        client.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.lte.return_value
    )
    lte_chain.execute.return_value.data = [{"id": "r1"}]

    repo = SupabaseComponentRepository(client)
    count = asyncio.run(repo.supersede_pending_regions(EMAIL_ID, created_before=cutoff))

    assert count == 1
    third_eq = client.table.return_value.update.return_value.eq.return_value.eq.return_value.eq
    third_eq.assert_called_once_with("extraction_status", "pending")
    third_eq.return_value.lte.assert_called_once_with("created_at", cutoff)


def test_latest_component_created_at_reads_newest_db_timestamp() -> None:
    """The cutoff source is a single-row SELECT ordered by created_at desc —
    the DB's own clock, immune to app-server clock skew and the row cap."""
    client = MagicMock()
    select_chain = client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
    select_chain.execute.return_value.data = [{"created_at": "2026-06-13T12:00:01+00:00"}]

    repo = SupabaseComponentRepository(client)
    value = asyncio.run(repo.latest_component_created_at(EMAIL_ID))

    assert value == "2026-06-13T12:00:01+00:00"
    client.table.return_value.select.assert_called_once_with("created_at")
    client.table.return_value.select.return_value.eq.assert_called_once_with("email_id", EMAIL_ID)
    client.table.return_value.select.return_value.eq.return_value.order.assert_called_once_with("created_at", desc=True)
    client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.assert_called_once_with(1)


def test_latest_component_created_at_returns_none_when_email_has_no_components() -> None:
    client = MagicMock()
    select_chain = client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
    select_chain.execute.return_value.data = []

    repo = SupabaseComponentRepository(client)
    assert asyncio.run(repo.latest_component_created_at(EMAIL_ID)) is None
