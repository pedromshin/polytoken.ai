"""TDD test suite for app.domain.services.thread_grouping.

Task 1 (Tier 0): Union-Find header grouping — reply chains group via
Message-ID / In-Reply-To / References; disjoint conversations stay split;
a late-arriving bridging email merges two partial clusters; unlinked emails
stay singleton; group + intra-group ordering is deterministic
(sorted by received_at then id).

Task 2 adds Tier 1 (embedded-Message-ID) + Tier 2 (subject/window fallback)
cases below the Tier 0 section.

Task 3 adds a real/representative-fixture integration test at the bottom.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_WINDOW = timedelta(days=14)


def _email(
    id: str,
    *,
    message_id: str | None = None,
    in_reply_to: str | None = None,
    references_ids: tuple[str, ...] = (),
    subject: str | None = None,
    received_at: datetime = _BASE,
    body_text: str | None = None,
    body_html: str | None = None,
):
    from app.domain.services.thread_grouping import ThreadableEmail

    return ThreadableEmail(
        id=id,
        message_id=message_id,
        in_reply_to=in_reply_to,
        references_ids=references_ids,
        subject=subject,
        received_at=received_at,
        body_text=body_text,
        body_html=body_html,
    )


def _group_emails(emails, *, window: timedelta = _WINDOW):
    from app.domain.services.thread_grouping import group_emails

    return group_emails(emails, window=window)


# ---------------------------------------------------------------------------
# Tier 0: header-based grouping (Message-ID / In-Reply-To / References)
# ---------------------------------------------------------------------------


def test_reply_chain_groups_into_one_thread() -> None:
    """A -> B (in_reply_to A) -> C (references A, B) group into one thread."""
    a = _email("a", message_id="<a@x>", subject="Q1 shipment", received_at=_BASE)
    b = _email(
        "b",
        message_id="<b@x>",
        in_reply_to="<a@x>",
        subject="Re: Q1 shipment",
        received_at=_BASE + timedelta(hours=1),
    )
    c = _email(
        "c",
        message_id="<c@x>",
        references_ids=("<a@x>", "<b@x>"),
        subject="Re: Q1 shipment",
        received_at=_BASE + timedelta(hours=2),
    )

    groups = _group_emails([a, b, c])

    assert groups == [("a", "b", "c")]


def test_two_disjoint_chains_stay_split() -> None:
    """Two independent 2-email chains with no shared header links stay as two groups."""
    a1 = _email("a1", message_id="<a1@x>", subject="Booking ABC", received_at=_BASE)
    a2 = _email(
        "a2",
        message_id="<a2@x>",
        in_reply_to="<a1@x>",
        subject="Re: Booking ABC",
        received_at=_BASE + timedelta(hours=1),
    )
    b1 = _email(
        "b1",
        message_id="<b1@x>",
        subject="Invoice 999",
        received_at=_BASE + timedelta(hours=5),
    )
    b2 = _email(
        "b2",
        message_id="<b2@x>",
        in_reply_to="<b1@x>",
        subject="Re: Invoice 999",
        received_at=_BASE + timedelta(hours=6),
    )

    groups = _group_emails([a1, a2, b1, b2])

    assert groups == [("a1", "a2"), ("b1", "b2")]


def test_bridging_email_merges_two_partial_clusters() -> None:
    """A late-arriving email referencing both existing chains merges them into one group."""
    a = _email("a", message_id="<a@x>", subject="Thread A", received_at=_BASE)
    b = _email("b", message_id="<b@x>", subject="Thread B", received_at=_BASE + timedelta(minutes=1))
    bridge = _email(
        "bridge",
        message_id="<bridge@x>",
        references_ids=("<a@x>", "<b@x>"),
        subject="Fwd: merged",
        received_at=_BASE + timedelta(hours=2),
    )

    groups = _group_emails([a, b, bridge])

    assert groups == [("a", "b", "bridge")]


def test_unlinked_emails_stay_as_singleton_groups() -> None:
    """Emails with no message-id links and unrelated subjects form N singleton groups."""
    a = _email("a", message_id="<a@x>", subject="Alpha", received_at=_BASE)
    b = _email("b", message_id="<b@x>", subject="Beta", received_at=_BASE + timedelta(hours=1))
    c = _email("c", message_id="<c@x>", subject="Gamma", received_at=_BASE + timedelta(hours=2))

    groups = _group_emails([a, b, c])

    assert groups == [("a",), ("b",), ("c",)]


def test_group_and_member_order_is_deterministic_regardless_of_input_order() -> None:
    """Members within a group sort by (received_at, id); input order must not matter."""
    a = _email("a", message_id="<a@x>", subject="Order test", received_at=_BASE)
    b = _email(
        "b",
        message_id="<b@x>",
        in_reply_to="<a@x>",
        subject="Re: Order test",
        received_at=_BASE + timedelta(hours=1),
    )
    c = _email(
        "c",
        message_id="<c@x>",
        in_reply_to="<b@x>",
        subject="Re: Order test",
        received_at=_BASE + timedelta(hours=2),
    )

    groups_forward = _group_emails([a, b, c])
    groups_reversed = _group_emails([c, b, a])

    assert groups_forward == [("a", "b", "c")]
    assert groups_reversed == [("a", "b", "c")]


def test_empty_input_returns_empty_list() -> None:
    """No emails -> no groups."""
    assert _group_emails([]) == []
