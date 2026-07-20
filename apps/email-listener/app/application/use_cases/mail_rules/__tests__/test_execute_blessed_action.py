"""Tests for the acting half behind the suggest-only gate (INV-6, INV-7).

Proves the four acceptance claims:
  1. a BLESSED suggestion executes -- via the registry capability it references,
     landing as a recorded fixture intent (forward -> outbound intent, label ->
     label mutation, extract-to-sheet -> row intent); no live mail (LIVE-04);
  2. an UN-BLESSED (or mismatched-bless) suggestion REFUSES to execute, and
     nothing is recorded;
  3. an UNREGISTERED capability id fails closed (`UnknownCapabilityError`), as
     does a registered capability this acting half has no intent builder for;
  4. the audit trail is COMPLETE (INV-7): suggestion id + full bless record
     (actor, timestamp, suggest-only stance) + capability + scope + intent.

Doubles are unnecessary for the happy paths: `define_mail_rule_capabilities()`
returns real capabilities and the recorder is in-memory. No `app.infrastructure`
import (lint-imports: application does not import infrastructure).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from app.application.capabilities.registry import (
    CapabilityRegistry,
    UnknownCapabilityError,
    define_capability,
)
from app.application.use_cases.mail_rules.capabilities import (
    SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
    define_mail_rule_capabilities,
)
from app.application.use_cases.mail_rules.execute_blessed_action import (
    BlessedActionAuditTrail,
    BlessedActionExecutionError,
    BlessMismatchError,
    BlessRecord,
    ExecuteBlessedAction,
    FixtureActionRecorder,
    MalformedActionArgumentsError,
    RecordedForwardIntent,
    RecordedLabelMutation,
    RecordedSheetRowIntent,
    UnblessedSuggestionError,
    UnsupportedBlessedActionError,
)
from app.application.use_cases.mail_rules.rules import RulesMatcher, Suggestion, default_mail_rules
from app.domain.entities.email import Email
from app.domain.ports.tool_executor import ToolExecutionResult

_FIXED_NOW = datetime(2026, 1, 2, 9, 0, 0, tzinfo=UTC)
_BLESSED_AT = datetime(2026, 1, 2, 8, 30, 0, tzinfo=UTC)


def _email(*, sender_address: str = "someone@example.com", subject: str | None = "Hello") -> Email:
    """Build a fixture-corpus Email, varying only the fields the rules read."""
    return Email(
        id="email-1",
        importer_id="importer-1",
        message_id="msg-1",
        in_reply_to=None,
        references_ids=(),
        received_at=_FIXED_NOW,
        sender_address=sender_address,
        sender_name=None,
        to_addresses=("me@example.com",),
        cc_addresses=(),
        subject=subject,
        body_html=None,
        body_text=None,
        raw_storage_key=None,
        parse_status="parsed",
        parse_error=None,
        parsed_at=_FIXED_NOW,
        created_at=_FIXED_NOW,
    )


def _bless(suggestion_id: str = "sugg-1") -> BlessRecord:
    return BlessRecord(suggestion_id=suggestion_id, actor="pedro@example.com", blessed_at=_BLESSED_AT)


def _use_case(recorder: FixtureActionRecorder, registry: CapabilityRegistry | None = None) -> ExecuteBlessedAction:
    return ExecuteBlessedAction(
        registry=registry if registry is not None else CapabilityRegistry(define_mail_rule_capabilities()),
        recorder=recorder,
        clock=lambda: _FIXED_NOW,
    )


def _suggestion(capability_id: str, arguments: dict[str, Any], *, rule_id: str = "rule-x") -> Suggestion:
    return Suggestion(rule_id=rule_id, capability_id=capability_id, action_arguments=arguments, describe="")


# --- 1. blessed executes: fixture-recorded intents per action ----------------


@pytest.mark.asyncio
async def test_blessed_forward_records_outbound_intent_end_to_end() -> None:
    # Fixture corpus -> matcher -> INFERRED suggestion -> human bless -> execute.
    matcher = RulesMatcher(default_mail_rules())
    (suggestion,) = matcher.match(_email(subject="Your March invoice is ready"))
    assert suggestion.applied is False  # still only a suggestion before the bless

    recorder = FixtureActionRecorder()
    trail = await _use_case(recorder).execute(
        suggestion=suggestion,
        suggestion_id="sugg-1",
        bless=_bless("sugg-1"),
        email_id="email-1",
        importer_id="importer-1",
    )

    (intent,) = recorder.records
    assert isinstance(intent, RecordedForwardIntent)
    assert intent.kind == "outbound_forward"
    assert intent.to_address == "accounting@example.com"
    assert intent.note == "Invoice for review"
    assert intent.email_id == "email-1"
    assert intent.importer_id == "importer-1"
    # It ran through the SAME registry capability the suggestion referenced.
    assert trail.capability_id == SUGGEST_FORWARD_EMAIL_CAPABILITY_ID
    payload = json.loads(trail.capability_result_content)
    assert payload["action"] == SUGGEST_FORWARD_EMAIL_CAPABILITY_ID


@pytest.mark.asyncio
async def test_blessed_label_records_label_mutation() -> None:
    recorder = FixtureActionRecorder()
    await _use_case(recorder).execute(
        suggestion=_suggestion(SUGGEST_APPLY_LABEL_CAPABILITY_ID, {"label": "Newsletters"}),
        suggestion_id="sugg-2",
        bless=_bless("sugg-2"),
        email_id="email-1",
        importer_id="importer-1",
    )

    (intent,) = recorder.records
    assert isinstance(intent, RecordedLabelMutation)
    assert intent.kind == "label_mutation"
    assert intent.label == "Newsletters"


@pytest.mark.asyncio
async def test_blessed_extract_records_sheet_row_intent() -> None:
    recorder = FixtureActionRecorder()
    await _use_case(recorder).execute(
        suggestion=_suggestion(
            SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
            {"sheet": "Expenses 2026", "fields": ["vendor", "amount", "date"]},
        ),
        suggestion_id="sugg-3",
        bless=_bless("sugg-3"),
        email_id="email-1",
        importer_id="importer-1",
    )

    (intent,) = recorder.records
    assert isinstance(intent, RecordedSheetRowIntent)
    assert intent.kind == "sheet_row"
    assert intent.sheet == "Expenses 2026"
    assert intent.fields == ("vendor", "amount", "date")


# --- 2. un-blessed refuses ----------------------------------------------------


@pytest.mark.asyncio
async def test_unblessed_suggestion_refuses_and_records_nothing() -> None:
    recorder = FixtureActionRecorder()
    with pytest.raises(UnblessedSuggestionError):
        await _use_case(recorder).execute(
            suggestion=_suggestion(SUGGEST_APPLY_LABEL_CAPABILITY_ID, {"label": "X"}),
            suggestion_id="sugg-4",
            bless=None,  # nobody blessed it
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


@pytest.mark.asyncio
async def test_bless_for_a_different_suggestion_refuses() -> None:
    # A bless is suggestion-scoped: it cannot be replayed against another one.
    recorder = FixtureActionRecorder()
    with pytest.raises(BlessMismatchError):
        await _use_case(recorder).execute(
            suggestion=_suggestion(SUGGEST_APPLY_LABEL_CAPABILITY_ID, {"label": "X"}),
            suggestion_id="sugg-5",
            bless=_bless("some-other-suggestion"),
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


def test_bless_record_requires_actor_and_aware_timestamp() -> None:
    with pytest.raises(ValueError, match="actor"):
        BlessRecord(suggestion_id="s", actor="   ", blessed_at=_BLESSED_AT)
    with pytest.raises(ValueError, match="timezone-aware"):
        BlessRecord(suggestion_id="s", actor="pedro", blessed_at=datetime(2026, 1, 2, 8, 30))  # noqa: DTZ001


def test_bless_record_stance_is_suggest_only() -> None:
    # Blessing one execution never flips the rule to auto-apply.
    assert _bless().stance == "suggest-only"


# --- 3. fails closed ------------------------------------------------------------


@pytest.mark.asyncio
async def test_unregistered_capability_fails_closed() -> None:
    recorder = FixtureActionRecorder()
    with pytest.raises(UnknownCapabilityError):
        await _use_case(recorder).execute(
            suggestion=_suggestion("suggest_frowardd_email", {"to_address": "a@b.c"}),  # typo'd id
            suggestion_id="sugg-6",
            bless=_bless("sugg-6"),
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


class _StubExecutor:
    """Minimal ToolExecutor double for capabilities outside the mail-rule set."""

    def __init__(self, *, is_error: bool = False) -> None:
        self._is_error = is_error

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        del name, arguments, importer_id
        return ToolExecutionResult(tool_use_id="", content="stub failure", is_error=self._is_error)


@pytest.mark.asyncio
async def test_registered_capability_without_intent_builder_fails_closed() -> None:
    # A capability the registry knows but this acting half was never taught to
    # enact must refuse loudly, not record a wrong intent.
    unrelated = define_capability(
        executor=_StubExecutor(),
        tool_def={
            "name": "unrelated_capability",
            "description": "Not a mail-rule action.",
            "input_schema": {"type": "object", "properties": {}},
        },
        risk="read",
        cost="free",
    )
    registry = CapabilityRegistry([*define_mail_rule_capabilities(), unrelated])
    recorder = FixtureActionRecorder()
    with pytest.raises(UnsupportedBlessedActionError):
        await _use_case(recorder, registry).execute(
            suggestion=_suggestion("unrelated_capability", {}),
            suggestion_id="sugg-7",
            bless=_bless("sugg-7"),
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


@pytest.mark.asyncio
async def test_executor_error_result_raises_and_records_nothing() -> None:
    # Same id as the real forward capability, but its executor reports an error:
    # the use case surfaces it and the recorder stays empty.
    failing = define_capability(
        executor=_StubExecutor(is_error=True),
        tool_def={
            "name": SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
            "description": "Failing double of the forward capability.",
            "input_schema": {"type": "object", "properties": {}},
        },
        risk="read",
        cost="free",
    )
    recorder = FixtureActionRecorder()
    with pytest.raises(BlessedActionExecutionError):
        await _use_case(recorder, CapabilityRegistry([failing])).execute(
            suggestion=_suggestion(SUGGEST_FORWARD_EMAIL_CAPABILITY_ID, {"to_address": "a@b.c"}),
            suggestion_id="sugg-8",
            bless=_bless("sugg-8"),
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


@pytest.mark.asyncio
async def test_malformed_arguments_fail_before_any_execution() -> None:
    recorder = FixtureActionRecorder()
    with pytest.raises(MalformedActionArgumentsError):
        await _use_case(recorder).execute(
            suggestion=_suggestion(SUGGEST_APPLY_LABEL_CAPABILITY_ID, {}),  # missing "label"
            suggestion_id="sugg-9",
            bless=_bless("sugg-9"),
            email_id="email-1",
            importer_id="importer-1",
        )
    assert recorder.records == ()


# --- 4. audit trail complete (INV-7) -------------------------------------------


@pytest.mark.asyncio
async def test_audit_trail_is_complete() -> None:
    recorder = FixtureActionRecorder()
    bless = _bless("sugg-10")
    trail = await _use_case(recorder).execute(
        suggestion=_suggestion(
            SUGGEST_APPLY_LABEL_CAPABILITY_ID, {"label": "Newsletters"}, rule_id="label-newsletters"
        ),
        suggestion_id="sugg-10",
        bless=bless,
        email_id="email-1",
        importer_id="importer-1",
    )

    assert isinstance(trail, BlessedActionAuditTrail)
    # INV-7: the suggestion id and the FULL bless record travel together.
    assert trail.suggestion_id == "sugg-10"
    assert trail.bless == bless
    assert trail.bless.actor == "pedro@example.com"
    assert trail.bless.blessed_at == _BLESSED_AT
    assert trail.bless.stance == "suggest-only"
    # Plus what ran, where, and when.
    assert trail.rule_id == "label-newsletters"
    assert trail.capability_id == SUGGEST_APPLY_LABEL_CAPABILITY_ID
    assert trail.email_id == "email-1"
    assert trail.importer_id == "importer-1"
    assert trail.executed_at == _FIXED_NOW
    assert trail.executed_at.tzinfo is not None
    assert trail.recorded_intent == recorder.records[0]
    payload = json.loads(trail.capability_result_content)
    assert payload["status"] == "suggested"
