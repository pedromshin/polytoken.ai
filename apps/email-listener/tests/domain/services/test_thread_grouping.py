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

from datetime import UTC, datetime, timedelta
from pathlib import Path

_BASE = datetime(2026, 1, 1, tzinfo=UTC)
_WINDOW = timedelta(days=14)
_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "threads"


def _email(
    email_id: str,
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
        id=email_id,
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


# ---------------------------------------------------------------------------
# normalize_subject
# ---------------------------------------------------------------------------


def test_normalize_subject_strips_single_re_prefix() -> None:
    from app.domain.services.thread_grouping import normalize_subject

    assert normalize_subject("Re: Shipment update") == "shipment update"


def test_normalize_subject_strips_repeated_mixed_prefixes() -> None:
    """Fwd:/Re:/Fw:/Enc:/Res: (case-insensitive) strip in any repeated combination."""
    from app.domain.services.thread_grouping import normalize_subject

    assert normalize_subject("Fwd: Re: Fw: Enc: Res: Quarterly report") == "quarterly report"


def test_normalize_subject_collapses_whitespace_and_lowercases() -> None:
    from app.domain.services.thread_grouping import normalize_subject

    assert normalize_subject("  Multiple   Spaces   Here  ") == "multiple spaces here"


def test_normalize_subject_empty_or_none_or_whitespace_returns_empty_string() -> None:
    from app.domain.services.thread_grouping import normalize_subject

    assert normalize_subject(None) == ""
    assert normalize_subject("") == ""
    assert normalize_subject("   ") == ""


# ---------------------------------------------------------------------------
# extract_embedded_message_ids
# ---------------------------------------------------------------------------


def test_extract_embedded_message_ids_finds_forwarded_block_id() -> None:
    from app.domain.services.thread_grouping import extract_embedded_message_ids

    body = (
        "---------- Forwarded message ---------\n"
        "From: Jane <jane@example.com>\n"
        "Date: Mon, Jan 5, 2026 at 9:00 AM\n"
        "Subject: Re: Q1 shipment\n"
        "To: Bob <bob@example.com>\n"
        "Message-ID: <original123@mail.example.com>\n"
        "\n"
        "See below.\n"
    )

    assert extract_embedded_message_ids(body, None) == ("<original123@mail.example.com>",)


def test_extract_embedded_message_ids_dedupes_across_text_and_html() -> None:
    from app.domain.services.thread_grouping import extract_embedded_message_ids

    text = "Message-ID: <dup@x>\n"
    html = "Message-ID: <dup@x>\n"

    assert extract_embedded_message_ids(text, html) == ("<dup@x>",)


def test_extract_embedded_message_ids_returns_empty_tuple_when_none_present() -> None:
    from app.domain.services.thread_grouping import extract_embedded_message_ids

    assert extract_embedded_message_ids("Just a normal reply, no forward block.", None) == ()
    assert extract_embedded_message_ids(None, None) == ()


# ---------------------------------------------------------------------------
# Tier 1: embedded-Message-ID fallback (forward strips References/In-Reply-To)
# ---------------------------------------------------------------------------


def test_tier1_forwarded_email_with_embedded_message_id_joins_existing_thread() -> None:
    """A Gmail-forward with References stripped but an embedded original Message-ID joins that thread."""
    original = _email("orig", message_id="<orig@x>", subject="Contract renewal", received_at=_BASE)
    forwarded = _email(
        "fwd",
        message_id="<fwd@x>",
        # References/In-Reply-To stripped by Gmail UI forward — no header link at all
        subject="Fwd: Contract renewal",
        received_at=_BASE + timedelta(days=1),
        body_text=(
            "---------- Forwarded message ---------\n"
            "From: Jane <jane@example.com>\n"
            "Date: Thu, Jan 1, 2026 at 12:00 AM\n"
            "Subject: Contract renewal\n"
            "To: Bob <bob@example.com>\n"
            "Message-ID: <orig@x>\n"
            "\n"
            "FYI.\n"
        ),
    )

    groups = _group_emails([original, forwarded])

    assert groups == [("orig", "fwd")]


# ---------------------------------------------------------------------------
# Tier 2: conservative subject + window fallback
# ---------------------------------------------------------------------------


def test_tier2_subject_and_window_match_joins_when_no_header_or_embedded_link() -> None:
    """No header link, no embedded id, but matching normalized subject within window -> joins."""
    original = _email("orig2", message_id="<orig2@x>", subject="Booking confirmation", received_at=_BASE)
    forwarded = _email(
        "fwd2",
        message_id="<fwd2@x>",
        subject="Fwd: Booking confirmation",
        received_at=_BASE + timedelta(days=3),
    )

    groups = _group_emails([original, forwarded], window=timedelta(days=14))

    assert groups == [("orig2", "fwd2")]


def test_tier2_subject_match_outside_window_stays_split() -> None:
    """Same normalized subject but outside the bounded window -> does NOT merge."""
    original = _email("orig3", message_id="<orig3@x>", subject="Renewal notice", received_at=_BASE)
    forwarded = _email(
        "fwd3",
        message_id="<fwd3@x>",
        subject="Fwd: Renewal notice",
        received_at=_BASE + timedelta(days=30),
    )

    groups = _group_emails([original, forwarded], window=timedelta(days=14))

    assert groups == [("orig3",), ("fwd3",)]


def test_tier2_empty_subject_never_merges() -> None:
    """Empty/generic subject never triggers the Tier 2 fallback (false-split beats false-merge)."""
    original = _email("orig4", message_id="<orig4@x>", subject="", received_at=_BASE)
    forwarded = _email(
        "fwd4",
        message_id="<fwd4@x>",
        subject="",
        received_at=_BASE + timedelta(hours=1),
    )

    groups = _group_emails([original, forwarded])

    assert groups == [("orig4",), ("fwd4",)]


def test_tier2_ambiguous_subject_match_across_two_threads_stays_split() -> None:
    """A normalized subject matching two distinct existing components is ambiguous -> does NOT merge."""
    thread_a = _email("a5", message_id="<a5@x>", subject="Status update", received_at=_BASE)
    thread_b = _email(
        "b5",
        message_id="<b5@x>",
        subject="Status update",
        received_at=_BASE + timedelta(hours=1),
    )
    ambiguous = _email(
        "amb5",
        message_id="<amb5@x>",
        subject="Fwd: Status update",
        received_at=_BASE + timedelta(hours=2),
    )

    groups = _group_emails([thread_a, thread_b, ambiguous])

    assert groups == [("a5",), ("b5",), ("amb5",)]


# ---------------------------------------------------------------------------
# Task 3: real/representative .eml fixtures via parse_mime (anti-fragmentation)
# ---------------------------------------------------------------------------


def _parse_fixture(filename: str):
    from app.domain.services.mime_parser import parse_mime

    raw = (_FIXTURES_DIR / filename).read_bytes()
    return parse_mime(raw)


def _threadable_from_parsed(parsed, *, thread_id: str):
    from app.domain.services.thread_grouping import ThreadableEmail

    return ThreadableEmail(
        id=thread_id,
        message_id=parsed.message_id,
        in_reply_to=parsed.in_reply_to,
        references_ids=parsed.references_ids,
        subject=parsed.subject,
        received_at=parsed.received_at or _BASE,
        body_text=parsed.body_text,
        body_html=parsed.body_html,
    )


def test_reply_chain_fixture_via_real_mime_parsing_groups_into_one_thread() -> None:
    """A real RFC 5322 reply (In-Reply-To + References), parsed via parse_mime,

    threads correctly with its two earlier chain members (Tier 0, real-parser path).
    """
    parsed_reply = _parse_fixture("reply_chain_headers.eml")
    reply = _threadable_from_parsed(parsed_reply, thread_id="reply")

    original = _email(
        "original",
        message_id="<a-original@example.com>",
        subject="Q1 shipment update",
        received_at=_BASE,
    )
    middle = _email(
        "middle",
        message_id="<b-reply@example.com>",
        in_reply_to="<a-original@example.com>",
        subject="Re: Q1 shipment update",
        received_at=_BASE + timedelta(hours=1),
    )

    groups = _group_emails([original, middle, reply])

    assert groups == [("original", "middle", "reply")]


def test_gmail_forward_fixture_does_not_fragment_the_thread() -> None:
    """THRD-02 acceptance: a Gmail-UI-forward .eml (References/In-Reply-To stripped)

    still joins its original thread via the Tier 1 embedded-Message-ID fallback —
    the forward does NOT fragment into a separate thread.
    """
    parsed_forward = _parse_fixture("gmail_forward_stripped.eml")
    forward = _threadable_from_parsed(parsed_forward, thread_id="forward")

    original = _email(
        "original2",
        message_id="<booking-original@example.com>",
        subject="Booking confirmation BK-2026-0417",
        received_at=_BASE,
    )

    groups = _group_emails([original, forward])

    assert groups == [("original2", "forward")]
