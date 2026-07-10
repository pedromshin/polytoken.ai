"""Tests for IngestInboundEmailUseCase's ForwardingAddressResolver wiring (Phase 45, THRD-04).

Uses fakes for ForwardingAddressResolver/ImporterResolver — no real Supabase
adapter — to prove: a resolving token anchors a NEW importer to the resolved
user_id; an EXISTING importer is reused unchanged regardless of token; a
None-token new-domain path falls back to default_importer_id without a crash;
the Gmail forwarding-verification email is ingested (email_repo.save called),
never dropped; and a resolver exception degrades to None without failing
ingestion.
"""

from __future__ import annotations

import asyncio
from email.message import EmailMessage
from unittest.mock import AsyncMock, MagicMock

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
from app.domain.entities.email import Email

DEFAULT_IMPORTER_ID = "imp-default"
FORWARDING_USER_ID = "10000000-0000-0000-0000-000000000001"
SES_MESSAGE_ID = "ses-abc-123"
RECIPIENT_TOKEN_ADDRESS = "u-ABC123@magnitudetech.com.br"  # noqa: S105 — test fixture recipient, not a credential


def _raw_email(*, sender: str = "Maria <maria@exporter.com>", subject: str = "Docs") -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = subject
    msg["Date"] = "Wed, 10 Jun 2026 14:30:00 +0000"
    msg["Message-ID"] = "<mime-001@exporter.com>"
    msg.set_content("see attached")
    return bytes(msg)


def _gmail_verification_raw_email() -> bytes:
    """A minimal facsimile of Gmail's forwarding-destination-verification email."""
    msg = EmailMessage()
    msg["From"] = "forwarding-noreply@google.com"
    msg["To"] = RECIPIENT_TOKEN_ADDRESS
    msg["Subject"] = "Gmail Forwarding Confirmation - Receipt Confirmed"
    msg["Date"] = "Wed, 10 Jun 2026 14:30:00 +0000"
    msg["Message-ID"] = "<gverify-001@google.com>"
    msg.set_content("Confirmation code: 123456")
    return bytes(msg)


def _make_use_case(
    raw: bytes,
    *,
    forwarding_resolver: MagicMock,
    importer_resolver: MagicMock | None = None,
    existing_email: Email | None = None,
) -> tuple[IngestInboundEmailUseCase, dict[str, MagicMock]]:
    raw_store = MagicMock()
    raw_store.fetch = AsyncMock(return_value=raw)
    raw_store.key_for.return_value = f"inbound/local/{SES_MESSAGE_ID}"

    email_repo = MagicMock()
    email_repo.find_by_message_id = AsyncMock(return_value=existing_email)
    email_repo.save = AsyncMock(side_effect=lambda email: email)

    attachment_repo = MagicMock()
    attachment_repo.save = AsyncMock(side_effect=lambda att: att)

    attachment_storage = MagicMock()
    attachment_storage.store = AsyncMock()

    components = MagicMock()
    components.save_many = AsyncMock(side_effect=lambda cs: cs)
    components.find_by_email_id = AsyncMock(return_value=[])

    parser_registry = MagicMock(return_value=None)

    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(return_value=[])

    if importer_resolver is None:
        importer_resolver = MagicMock()
        importer_resolver.resolve = AsyncMock(return_value=DEFAULT_IMPORTER_ID)

    thread_resolver = MagicMock()
    thread_resolver.resolve = AsyncMock(return_value=None)

    use_case = IngestInboundEmailUseCase(
        raw_store=raw_store,
        email_repo=email_repo,
        attachment_repo=attachment_repo,
        attachment_storage=attachment_storage,
        config=IngestionConfig(default_importer_id=DEFAULT_IMPORTER_ID),
        components=components,
        parser_registry=parser_registry,
        propose_regions=propose_regions,
        importer_resolver=importer_resolver,
        thread_resolver=thread_resolver,
        forwarding_resolver=forwarding_resolver,
    )
    mocks: dict[str, MagicMock] = {
        "raw_store": raw_store,
        "email_repo": email_repo,
        "attachment_repo": attachment_repo,
        "importer_resolver": importer_resolver,
        "thread_resolver": thread_resolver,
        "forwarding_resolver": forwarding_resolver,
    }
    return use_case, mocks


# ---------------------------------------------------------------------------
# New-domain importer anchoring — a resolving token anchors the new importer.
# ---------------------------------------------------------------------------


def test_resolving_token_anchors_new_importer_to_resolved_user() -> None:
    """A brand-new sender domain + a resolving token: importer_resolver.resolve
    is called with user_id=the forwarding resolver's output."""
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=FORWARDING_USER_ID)

    new_importer_id = "aaaaaaaa-0000-0000-0000-000000000002"
    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=new_importer_id)

    use_case, mocks = _make_use_case(
        _raw_email(),
        forwarding_resolver=forwarding_resolver,
        importer_resolver=importer_resolver,
    )
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID, recipients=[RECIPIENT_TOKEN_ADDRESS]))

    mocks["forwarding_resolver"].resolve_recipients.assert_awaited_once_with([RECIPIENT_TOKEN_ADDRESS])
    mocks["importer_resolver"].resolve.assert_awaited_once_with("maria@exporter.com", user_id=FORWARDING_USER_ID)
    assert email.importer_id == new_importer_id


# ---------------------------------------------------------------------------
# Existing importer reuse — a resolving token does not change reuse behavior.
# ---------------------------------------------------------------------------


def test_existing_importer_reused_unchanged_regardless_of_resolving_token() -> None:
    """An EXISTING importer for the sender domain is reused even when the
    token resolves — importer_resolver owns reuse-vs-create, not this use case."""
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=FORWARDING_USER_ID)

    existing_importer_id = "bbbbbbbb-0000-0000-0000-000000000003"
    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=existing_importer_id)

    use_case, mocks = _make_use_case(
        _raw_email(),
        forwarding_resolver=forwarding_resolver,
        importer_resolver=importer_resolver,
    )
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID, recipients=[RECIPIENT_TOKEN_ADDRESS]))

    assert email.importer_id == existing_importer_id
    mocks["importer_resolver"].resolve.assert_awaited_once_with("maria@exporter.com", user_id=FORWARDING_USER_ID)


# ---------------------------------------------------------------------------
# None-token new-domain fallback — no crash, no NOT-NULL violation risk.
# ---------------------------------------------------------------------------


def test_none_token_new_domain_falls_back_without_crash() -> None:
    """No resolving token (legacy agent@ path): importer_resolver.resolve is
    called with user_id=None; the use case must not crash."""
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=None)

    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=DEFAULT_IMPORTER_ID)

    use_case, mocks = _make_use_case(
        _raw_email(),
        forwarding_resolver=forwarding_resolver,
        importer_resolver=importer_resolver,
    )
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID, recipients=["agent@magnitudetech.com.br"]))

    mocks["importer_resolver"].resolve.assert_awaited_once_with("maria@exporter.com", user_id=None)
    assert email.importer_id == DEFAULT_IMPORTER_ID


def test_no_recipients_argument_defaults_to_none_token() -> None:
    """Calling execute() with no recipients (backward-compatible default) resolves user_id=None."""
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=None)

    use_case, mocks = _make_use_case(_raw_email(), forwarding_resolver=forwarding_resolver)
    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["forwarding_resolver"].resolve_recipients.assert_awaited_once_with(())
    mocks["importer_resolver"].resolve.assert_awaited_once_with("maria@exporter.com", user_id=None)


# ---------------------------------------------------------------------------
# Gmail verification mail — must be ingested (saved), never dropped/quarantined.
# ---------------------------------------------------------------------------


def test_gmail_verification_email_is_saved_not_dropped() -> None:
    """forwarding-noreply@google.com sending to a resolving u-{token} recipient:
    token resolves U -> importer anchored under U -> email_repo.save is called
    (the mail is stored normally, so the user can read the confirmation code)."""
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=FORWARDING_USER_ID)

    google_importer_id = "cccccccc-0000-0000-0000-000000000004"
    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=google_importer_id)

    use_case, mocks = _make_use_case(
        _gmail_verification_raw_email(),
        forwarding_resolver=forwarding_resolver,
        importer_resolver=importer_resolver,
    )
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID, recipients=[RECIPIENT_TOKEN_ADDRESS]))

    mocks["forwarding_resolver"].resolve_recipients.assert_awaited_once_with([RECIPIENT_TOKEN_ADDRESS])
    mocks["importer_resolver"].resolve.assert_awaited_once_with(
        "forwarding-noreply@google.com", user_id=FORWARDING_USER_ID
    )
    mocks["email_repo"].save.assert_awaited_once()
    assert email is not None
    assert email.importer_id == google_importer_id
    assert email.subject == "Gmail Forwarding Confirmation - Receipt Confirmed"


# ---------------------------------------------------------------------------
# Resolver failure isolation (T-45-05-03) — must never fail ingestion.
# ---------------------------------------------------------------------------


def test_forwarding_resolver_exception_degrades_to_none_and_does_not_raise() -> None:
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(side_effect=RuntimeError("resolver boom"))

    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=DEFAULT_IMPORTER_ID)

    use_case, mocks = _make_use_case(
        _raw_email(),
        forwarding_resolver=forwarding_resolver,
        importer_resolver=importer_resolver,
    )
    # Must not raise.
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID, recipients=[RECIPIENT_TOKEN_ADDRESS]))

    assert email is not None
    mocks["importer_resolver"].resolve.assert_awaited_once_with("maria@exporter.com", user_id=None)
    mocks["email_repo"].save.assert_awaited_once()
