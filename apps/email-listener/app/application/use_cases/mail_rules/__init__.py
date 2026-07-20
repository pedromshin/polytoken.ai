"""Suggest-only mail rules, executed as registry capabilities (MAIL-01/02).

A tiny rules engine that matches an inbound email against a list of rules and,
for each match, emits a *suggested* action -- never an auto-applied one. Each
action is expressed as a `Capability` (`define_capability`) so it runs through
the SAME capability registry the chat tools use. That is the MAIL-02 generality
proof: the registry (Phase 68 / REG-02) is not a one-consumer abstraction; a
second, unrelated consumer (mail rules) declares its actions the same way.

The suggest-only stance mirrors entity resolution: a suggestion is INFERRED
(dashed, un-blessed) until a human confirms it. The matcher has no path to
apply an action; blessing + execution happen downstream through the registry's
permission model (INV-4: `risk` is data).

Entry helper for the composition root: `define_mail_rule_capabilities()`.
"""

from __future__ import annotations

from app.application.use_cases.mail_rules.capabilities import define_mail_rule_capabilities
from app.application.use_cases.mail_rules.rules import (
    Rule,
    RuleCondition,
    RulesMatcher,
    Suggestion,
    assert_rules_reference_registered_capabilities,
    default_mail_rules,
)

__all__ = [
    "Rule",
    "RuleCondition",
    "RulesMatcher",
    "Suggestion",
    "assert_rules_reference_registered_capabilities",
    "default_mail_rules",
    "define_mail_rule_capabilities",
]
