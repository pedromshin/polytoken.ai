"""validate_result_against_schema — pure re-validation against the STORED declared schema (D-10).

Phase 24-01: FastAPI owns re-validation of a submitted widget result — always against the
schema STORED on chat_widget_interactions.declared_response_schema at emit time, never a
client-supplied schema (T-24-01 mitigation). This module only re-validates a given
(result, schema) pair; loading the stored schema is the caller's responsibility (a later
plan's submit endpoint) so this stays a pure domain service with zero app.infrastructure
imports (mirrors cost_circuit_breaker.py).

Fail-closed (never a crash): a malformed OR empty declared schema is rejected outright — an
empty schema `{}` is technically valid JSON Schema (matches anything) but a widget must always
declare real constraints, so treating "empty" as untrusted/malformed is the deliberate,
conservative reading of D-10. jsonschema.SchemaError, jsonschema.exceptions.UnknownType, and any
other unexpected exception are all caught — the caller never sees a raised exception.

The returned reason is always a generic, caller-safe string (CLAUDE.md guardrail: detailed
errors logged server-side only, friendly messages surfaced elsewhere). The full jsonschema error
(which can include exact property paths / schema pointers) is logged via structlog for debugging,
never returned.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import jsonschema
import structlog

logger = structlog.get_logger(__name__)

_GENERIC_REASON = "result did not match the declared response schema"
_MALFORMED_SCHEMA_REASON = "declared response schema is invalid"


@dataclass(frozen=True)
class ValidationOutcome:
    """Immutable pass/fail verdict — `reason` never leaks schema internals (D-10)."""

    ok: bool
    reason: str = ""


def validate_result_against_schema(result: object, schema: Mapping[str, Any]) -> ValidationOutcome:
    """Re-validate a submitted widget result against the STORED declared schema (D-10).

    Fail-closed: an empty/malformed schema, or any unexpected exception while validating,
    always returns ok=False — this function never raises.
    """
    if not schema:
        logger.warning("widget_result_validation_failed", reason="empty_schema")
        return ValidationOutcome(ok=False, reason=_MALFORMED_SCHEMA_REASON)

    try:
        jsonschema.Draft7Validator.check_schema(schema)
    except Exception as exc:
        logger.warning("widget_result_validation_failed", reason="schema_check_failed", detail=str(exc))
        return ValidationOutcome(ok=False, reason=_MALFORMED_SCHEMA_REASON)

    try:
        validator = jsonschema.Draft7Validator(schema)
        errors = list(validator.iter_errors(result))
    except Exception as exc:
        logger.warning("widget_result_validation_failed", reason="validator_error", detail=str(exc))
        return ValidationOutcome(ok=False, reason=_MALFORMED_SCHEMA_REASON)

    if errors:
        logger.info(
            "widget_result_validation_failed",
            reason="schema_mismatch",
            detail=str(errors[0].message),
        )
        return ValidationOutcome(ok=False, reason=_GENERIC_REASON)

    return ValidationOutcome(ok=True)


__all__ = ["ValidationOutcome", "validate_result_against_schema"]
