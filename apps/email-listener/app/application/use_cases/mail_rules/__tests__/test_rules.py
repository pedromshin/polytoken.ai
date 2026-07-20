"""Tests for suggest-only mail rules run as registry capabilities (MAIL-01/02).

Proves the three acceptance claims:
  1. a rule matches the RIGHT fixtures (and only those);
  2. a match produces a SUGGESTION -- INFERRED / `applied=False`, never an
     auto-applied action (the matcher holds no executors, so it structurally
     cannot apply anything);
  3. the actions are VALID registry capabilities -- they build a real
     `CapabilityRegistry`, every rule's `capability_id` resolves through it
     (fail-closed on a typo), and the suggest executor returns an
     `applied: false` proposal, never a performed side effect.

Doubles are unnecessary: `define_mail_rule_capabilities()` returns real
capabilities and the matcher is pure. No `app.infrastructure` import
(lint-imports: application does not import infrastructure).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from app.application.capabilities.registry import (
    Capability,
    CapabilityRegistry,
    UnknownCapabilityError,
)
from app.application.use_cases.mail_rules.capabilities import (
    SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
    define_mail_rule_capabilities,
)
from app.application.use_cases.mail_rules.rules import (
    Rule,
    RuleCondition,
    RulesMatcher,
    Suggestion,
    assert_rules_reference_registered_capabilities,
    default_mail_rules,
)
from app.domain.entities.email import Email

_FIXED_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _email(*, sender_address: str = "someone@example.com", subject: str | None = "Hello") -> Email:
    """Build an Email fixture, varying only the fields the rules read."""
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


# --- 1. rules match the right fixtures --------------------------------------


def test_subject_rule_matches_only_matching_subjects() -> None:
    matcher = RulesMatcher(default_mail_rules())

    matched = matcher.match(_email(subject="Your March invoice is ready"))
    assert [s.rule_id for s in matched] == ["forward-invoices-to-accounting"]

    # An unrelated subject trips no rule.
    assert matcher.match(_email(subject="Lunch tomorrow?")) == ()


def test_matching_is_case_insensitive() -> None:
    matcher = RulesMatcher(default_mail_rules())
    matched = matcher.match(_email(subject="INVOICE #42"))
    assert [s.rule_id for s in matched] == ["forward-invoices-to-accounting"]


def test_sender_rule_matches_on_sender() -> None:
    matcher = RulesMatcher(default_mail_rules())
    matched = matcher.match(_email(sender_address="newsletter@acme.com", subject="Weekly digest"))
    assert [s.rule_id for s in matched] == ["label-newsletters"]


def test_label_condition_requires_the_label() -> None:
    matcher = RulesMatcher(default_mail_rules())
    email = _email(subject="Receipt from the coffee shop")

    # Without the "expenses" label the extract rule does not fire.
    assert matcher.match(email) == ()

    # With it, exactly the extract rule fires.
    matched = matcher.match(email, labels=frozenset({"expenses"}))
    assert [s.rule_id for s in matched] == ["extract-receipts-to-sheet"]


def test_empty_condition_matches_nothing_fail_closed() -> None:
    # A condition with no predicates must never blanket-match the corpus.
    blanket = Rule(
        id="blanket",
        condition=RuleCondition(),
        capability_id=SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    )
    matcher = RulesMatcher([blanket])
    assert matcher.match(_email(subject="anything at all")) == ()


def test_conjunction_requires_all_predicates() -> None:
    rule = Rule(
        id="both",
        condition=RuleCondition(sender_contains="boss@", subject_contains="urgent"),
        capability_id=SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
    )
    matcher = RulesMatcher([rule])
    assert matcher.match(_email(sender_address="boss@corp.com", subject="urgent: read me"))
    # Sender matches but subject does not -> no match (AND, not OR).
    assert matcher.match(_email(sender_address="boss@corp.com", subject="fyi")) == ()


# --- 2. matches produce suggestions, never auto-actions ---------------------


def test_match_produces_inferred_unapplied_suggestion() -> None:
    matcher = RulesMatcher(default_mail_rules())
    (suggestion,) = matcher.match(_email(subject="invoice"))

    assert isinstance(suggestion, Suggestion)
    # The suggest-only invariant: INFERRED, never applied.
    assert suggestion.status == "inferred"
    assert suggestion.applied is False
    assert suggestion.capability_id == SUGGEST_FORWARD_EMAIL_CAPABILITY_ID
    assert suggestion.action_arguments["to_address"] == "accounting@example.com"


def test_every_default_suggestion_is_unapplied() -> None:
    matcher = RulesMatcher(default_mail_rules())
    # An email that trips all three rules at once.
    email = _email(sender_address="newsletter@acme.com", subject="invoice + receipt")
    suggestions = matcher.match(email, labels=frozenset({"expenses"}))
    assert {s.rule_id for s in suggestions} == {
        "forward-invoices-to-accounting",
        "label-newsletters",
        "extract-receipts-to-sheet",
    }
    assert all(s.applied is False and s.status == "inferred" for s in suggestions)


def test_matcher_holds_no_executors() -> None:
    # Structural proof it cannot apply an action: matching needs only rules.
    matcher = RulesMatcher(default_mail_rules())
    assert not hasattr(matcher, "_executors")
    assert not hasattr(matcher, "_registry")


# --- 3. actions are valid registry capabilities -----------------------------


def _registry() -> CapabilityRegistry:
    return CapabilityRegistry(define_mail_rule_capabilities())


def test_define_mail_rule_capabilities_are_valid_capabilities() -> None:
    caps = define_mail_rule_capabilities()
    assert all(isinstance(c, Capability) for c in caps)
    ids = {c.id for c in caps}
    assert ids == {
        SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
        SUGGEST_APPLY_LABEL_CAPABILITY_ID,
        SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    }
    for c in caps:
        # define_capability enforces id == tool_def["name"]; assert the rest of
        # the schema shape the LLM/registry rely on.
        assert c.tool_def["name"] == c.id
        assert c.tool_def["input_schema"]["type"] == "object"
        assert c.risk == "read"  # suggest form performs no write (INV-4: risk is data)


def test_registry_resolves_every_default_rule_capability() -> None:
    registry = _registry()
    # Fail-closed check passes for the shipped fixture rules.
    assert_rules_reference_registered_capabilities(default_mail_rules(), registry)
    # And each id resolves to a real capability.
    for rule in default_mail_rules():
        assert registry.get(rule.capability_id).id == rule.capability_id


def test_rule_pointing_at_unknown_capability_fails_closed() -> None:
    registry = _registry()
    bad = Rule(
        id="typo",
        condition=RuleCondition(subject_contains="x"),
        capability_id="suggest_frowardd_email",  # typo'd id
    )
    with pytest.raises(UnknownCapabilityError):
        assert_rules_reference_registered_capabilities([bad], registry)


@pytest.mark.asyncio
async def test_suggest_capability_executes_as_a_proposal_not_a_side_effect() -> None:
    registry = _registry()
    matcher = RulesMatcher(default_mail_rules())
    (suggestion,) = matcher.match(_email(subject="invoice"))

    # A human blessed it -> now (and only now) it runs through the SAME registry
    # the chat tools use. The result is still a PROPOSAL: applied is false.
    executor = registry.executors()[suggestion.capability_id]
    result = await executor.execute(
        name=suggestion.capability_id,
        arguments=suggestion.action_arguments,
        importer_id="importer-1",
    )

    assert result.is_error is False
    payload = json.loads(result.content)
    assert payload["status"] == "suggested"
    assert payload["applied"] is False
    assert payload["action"] == SUGGEST_FORWARD_EMAIL_CAPABILITY_ID
    assert payload["arguments"]["to_address"] == "accounting@example.com"


def test_registry_projects_matcher_ids_into_tool_defs() -> None:
    # The generality proof end to end: a rule's capability_id keys straight into
    # the registry's tool_defs()/executors() mappings the chat loop consumes.
    registry = _registry()
    tool_defs = registry.tool_defs()
    executors = registry.executors()
    for rule in default_mail_rules():
        assert rule.capability_id in tool_defs
        assert rule.capability_id in executors
