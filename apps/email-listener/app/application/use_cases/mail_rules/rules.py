"""Suggest-only mail rules over the fixture corpus (MAIL-01).

A `Rule` is a matcher predicate over an email (sender / subject / label
conditions) paired with a *suggested* action (a registry capability id +
arguments). `RulesMatcher` returns one `Suggestion` per matching rule.

## Suggest-only invariant (the whole point)

The matcher NEVER applies an action. It emits `Suggestion` objects that are
INFERRED (un-blessed, `applied=False`) -- structurally the same stance entity
resolution takes: a suggestion is dashed until a human confirms it. `RulesMatcher`
holds no executors and no registry reference for matching, so it *cannot* run an
action even by accident; execution happens later, through the capability
registry's permission model, only after a human blesses the suggestion.

## Actions are registry capabilities (MAIL-02)

Each rule's `capability_id` names a `Capability` from
`define_mail_rule_capabilities()`. `assert_rules_reference_registered_capabilities`
fails closed (via the registry's `UnknownCapabilityError`) if a rule points at an
id no registry knows -- so a typo in a rule is a construction-time error, never a
silent no-op.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from app.application.use_cases.mail_rules.capabilities import (
    SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
)

if TYPE_CHECKING:
    from collections.abc import Iterable

    from app.application.capabilities.registry import CapabilityRegistry
    from app.domain.entities.email import Email

# A suggestion is INFERRED until a human blesses it -- the only status this module
# can produce. There is deliberately no "applied" / "confirmed" status here.
SuggestionStatus = Literal["inferred"]


@dataclass(frozen=True)
class RuleCondition:
    """A conjunction of optional match predicates over an email + its labels.

    Every *specified* (non-None) predicate must hold for the condition to match
    (logical AND). All matching is case-insensitive. A condition with NO
    predicates set matches nothing -- fail-closed, so an empty rule can never
    blanket-suggest across the whole corpus.
    """

    sender_contains: str | None = None
    subject_contains: str | None = None
    has_label: str | None = None

    def is_empty(self) -> bool:
        return self.sender_contains is None and self.subject_contains is None and self.has_label is None

    def matches(self, email: Email, *, labels: frozenset[str] = frozenset()) -> bool:
        if self.is_empty():
            return False  # fail-closed: no predicates => no match

        if self.sender_contains is not None:
            sender = email.sender_address or ""
            if self.sender_contains.casefold() not in sender.casefold():
                return False

        if self.subject_contains is not None:
            subject = email.subject or ""
            if self.subject_contains.casefold() not in subject.casefold():
                return False

        if self.has_label is not None:
            wanted = self.has_label.casefold()
            if not any(wanted == label.casefold() for label in labels):
                return False

        return True


@dataclass(frozen=True)
class Rule:
    """One rule: a condition + the suggested action to emit when it matches.

    - `id`            -- stable rule identifier (appears on the emitted Suggestion).
    - `condition`     -- the matcher predicate.
    - `capability_id` -- the registry capability the suggested action runs through.
    - `action_arguments` -- the arguments to propose for that capability.
    - `describe`      -- human-readable rationale surfaced on the suggestion.
    """

    id: str
    condition: RuleCondition
    capability_id: str
    action_arguments: dict[str, Any] = field(default_factory=dict)
    describe: str = ""


@dataclass(frozen=True)
class Suggestion:
    """An INFERRED, un-blessed suggested action -- never an auto-applied one.

    `applied` is fixed `False`: the matcher provides no path to set it True. A
    human blesses the suggestion downstream, after which the referenced
    `capability_id` executes through the capability registry.
    """

    rule_id: str
    capability_id: str
    action_arguments: dict[str, Any]
    describe: str
    status: SuggestionStatus = "inferred"
    applied: bool = False


class RulesMatcher:
    """Matches an email against a fixed list of rules and emits suggestions.

    Suggest-only by construction: it stores rules, not executors, so matching
    can only ever *describe* an action, never perform one.
    """

    def __init__(self, rules: Iterable[Rule]) -> None:
        self._rules: tuple[Rule, ...] = tuple(rules)

    @property
    def rules(self) -> tuple[Rule, ...]:
        return self._rules

    def match(self, email: Email, *, labels: frozenset[str] = frozenset()) -> tuple[Suggestion, ...]:
        """Return one `Suggestion` per rule whose condition matches, in rule order.

        Applies nothing. Every returned suggestion is INFERRED / `applied=False`.
        """
        return tuple(
            Suggestion(
                rule_id=rule.id,
                capability_id=rule.capability_id,
                action_arguments=dict(rule.action_arguments),
                describe=rule.describe,
            )
            for rule in self._rules
            if rule.condition.matches(email, labels=labels)
        )


def assert_rules_reference_registered_capabilities(
    rules: Iterable[Rule], registry: CapabilityRegistry
) -> None:
    """Fail closed if any rule points at a capability id the registry does not know.

    Delegates to `registry.get`, which raises `UnknownCapabilityError` (INV-5) --
    so a mistyped `capability_id` is caught at wiring time, never as a silent
    no-op suggestion that can never be executed.
    """
    for rule in rules:
        registry.get(rule.capability_id)  # raises UnknownCapabilityError if unknown


def default_mail_rules() -> tuple[Rule, ...]:
    """The small fixture rule set -- each action is a mail-rule registry capability.

    A deliberately tiny, deterministic set covering all three suggest actions:
    forward invoices to accounting, label newsletters, extract receipts to a sheet.
    """
    return (
        Rule(
            id="forward-invoices-to-accounting",
            condition=RuleCondition(subject_contains="invoice"),
            capability_id=SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
            action_arguments={"to_address": "accounting@example.com", "note": "Invoice for review"},
            describe="Invoices should be forwarded to accounting for review.",
        ),
        Rule(
            id="label-newsletters",
            condition=RuleCondition(sender_contains="newsletter@"),
            capability_id=SUGGEST_APPLY_LABEL_CAPABILITY_ID,
            action_arguments={"label": "Newsletters"},
            describe="Mail from newsletter senders belongs under the Newsletters label.",
        ),
        Rule(
            id="extract-receipts-to-sheet",
            condition=RuleCondition(subject_contains="receipt", has_label="expenses"),
            capability_id=SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
            action_arguments={"sheet": "Expenses 2026", "fields": ["vendor", "amount", "date"]},
            describe="Receipts tagged as expenses should be extracted into the expenses sheet.",
        ),
    )


__all__ = [
    "Rule",
    "RuleCondition",
    "RulesMatcher",
    "Suggestion",
    "SuggestionStatus",
    "assert_rules_reference_registered_capabilities",
    "default_mail_rules",
]
