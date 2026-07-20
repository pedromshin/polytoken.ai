"""Execute a HUMAN-BLESSED mail-rule suggestion -- the acting half behind the gate (INV-6).

`rules.py` is the suggest-only half: it emits INFERRED `Suggestion`s and holds no
executors, so it structurally cannot act. This module is the other half: given a
suggestion that a human has EXPLICITLY blessed -- a `BlessRecord` naming the
actor, the timestamp, and the suggestion it covers -- `ExecuteBlessedAction`
resolves the referenced registry capability by id and executes it.

## The gate (INV-6)

The refusal check runs FIRST, before the registry is even consulted:

- no bless record            -> `UnblessedSuggestionError` (refuse; nothing runs)
- bless for a different
  suggestion id              -> `BlessMismatchError` (refuse; nothing runs)

A `BlessRecord` is single-shot and suggest-only in stance: it blesses ONE
suggestion's execution, never a rule ("stance" is fixed `"suggest-only"` -- a
bless is not an auto-apply opt-in for future matches).

## Fixture-first (LIVE-04 is user-gated)

Actions run against the fixture corpus only -- no live mail. Executing a blessed
action produces a RECORDED INTENT, appended to a `FixtureActionRecorder`:

- forward          -> `RecordedForwardIntent`   (a recorded outbound intent)
- label            -> `RecordedLabelMutation`   (a recorded label mutation)
- extract-to-sheet -> `RecordedSheetRowIntent`  (a recorded row intent)

Nothing here sends, labels, or writes to a real mailbox or sheet; wiring the
recorded intents to live transports is the separate, user-gated LIVE-04 step.

## Fails closed (INV-5)

- Unregistered `capability_id`      -> `UnknownCapabilityError` via `registry.get`.
- Registered capability with no
  intent builder (not a mail-rule
  action this module knows)         -> `UnsupportedBlessedActionError`.
- Capability executor reports error -> `BlessedActionExecutionError`; nothing recorded.

Builder resolution is a dict lookup keyed by capability id (INV-2: lookup, not a
switch chain).

## Audit trail (INV-7)

Every successful execution returns a `BlessedActionAuditTrail` carrying the
suggestion id AND the full bless record (actor + timestamp), plus the resolved
capability id, the fixture email/importer scope, the execution timestamp, and
the recorded intent -- enough to answer "who blessed what, and what ran" without
consulting any other store.

Application layer (INV-2): imports the application registry and domain
`Suggestion` types only -- never `app.infrastructure`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal, Protocol

from app.application.use_cases.mail_rules.capabilities import (
    SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from app.application.capabilities.registry import CapabilityRegistry
    from app.application.use_cases.mail_rules.rules import Suggestion


def _utc_now() -> datetime:
    return datetime.now(UTC)


# --- Refusal / failure vocabulary (INV-5, INV-6) -----------------------------


class BlessedActionRefusedError(PermissionError):
    """Base refusal: the suggest-only gate did not open. Nothing was executed."""


class UnblessedSuggestionError(BlessedActionRefusedError):
    """No bless record -> refuse. An INFERRED suggestion never executes (INV-6)."""

    def __init__(self, suggestion_id: str) -> None:
        super().__init__(f"[mail-rules] suggestion {suggestion_id!r} is un-blessed; refusing to execute")
        self.suggestion_id = suggestion_id


class BlessMismatchError(BlessedActionRefusedError):
    """The bless record covers a DIFFERENT suggestion -> refuse.

    A bless is single-shot and suggestion-scoped; it cannot be reused to
    authorise a suggestion the human never saw.
    """

    def __init__(self, *, suggestion_id: str, blessed_suggestion_id: str) -> None:
        super().__init__(
            f"[mail-rules] bless record covers suggestion {blessed_suggestion_id!r}, "
            f"not {suggestion_id!r}; refusing to execute"
        )
        self.suggestion_id = suggestion_id
        self.blessed_suggestion_id = blessed_suggestion_id


class UnsupportedBlessedActionError(LookupError):
    """The capability resolved, but no intent builder exists for it -- fail closed.

    Guards against a registry that grew capabilities this acting half was never
    taught to enact: better to refuse loudly than record a wrong intent.
    """

    def __init__(self, capability_id: str) -> None:
        super().__init__(f"[mail-rules] no blessed-action intent builder for capability {capability_id!r}")
        self.capability_id = capability_id


class BlessedActionExecutionError(RuntimeError):
    """The registry capability's executor reported an error; nothing was recorded."""

    def __init__(self, *, capability_id: str, content: str) -> None:
        super().__init__(f"[mail-rules] capability {capability_id!r} execution failed: {content}")
        self.capability_id = capability_id
        self.content = content


class MalformedActionArgumentsError(ValueError):
    """A blessed suggestion's arguments are missing/mis-typed for its action."""

    def __init__(self, *, capability_id: str, key: str) -> None:
        super().__init__(f"[mail-rules] capability {capability_id!r} requires a non-empty string argument {key!r}")
        self.capability_id = capability_id
        self.key = key


# --- The bless record (the human's explicit confirmation) --------------------


@dataclass(frozen=True)
class BlessRecord:
    """A human's explicit blessing of ONE suggestion's execution.

    - `suggestion_id` -- the suggestion this bless covers (checked against the
                         suggestion being executed; a mismatch refuses).
    - `actor`         -- WHO blessed it. Required non-blank: an anonymous bless
                         is not a bless.
    - `blessed_at`    -- WHEN. Required timezone-aware (the audit trail must be
                         unambiguous across zones).
    - `stance`        -- fixed `"suggest-only"`: blessing one execution does NOT
                         flip the rule to auto-apply for future matches.
    """

    suggestion_id: str
    actor: str
    blessed_at: datetime
    stance: Literal["suggest-only"] = "suggest-only"

    def __post_init__(self) -> None:
        if not self.actor.strip():
            raise ValueError("[mail-rules] BlessRecord.actor must be a non-blank human identifier")
        if self.blessed_at.tzinfo is None:
            raise ValueError("[mail-rules] BlessRecord.blessed_at must be timezone-aware")


# --- Recorded intents (the fixture-mode enactments) ---------------------------


@dataclass(frozen=True)
class RecordedForwardIntent:
    """A recorded OUTBOUND intent -- what a live forward would send (LIVE-04 gated)."""

    email_id: str
    importer_id: str
    to_address: str
    note: str | None = None
    kind: Literal["outbound_forward"] = "outbound_forward"


@dataclass(frozen=True)
class RecordedLabelMutation:
    """A recorded LABEL mutation -- what a live labeler would apply (LIVE-04 gated)."""

    email_id: str
    importer_id: str
    label: str
    kind: Literal["label_mutation"] = "label_mutation"


@dataclass(frozen=True)
class RecordedSheetRowIntent:
    """A recorded ROW intent -- what a live sheet writer would append (LIVE-04 gated)."""

    email_id: str
    importer_id: str
    sheet: str
    fields: tuple[str, ...] = ()
    kind: Literal["sheet_row"] = "sheet_row"


RecordedActionIntent = RecordedForwardIntent | RecordedLabelMutation | RecordedSheetRowIntent


class FixtureActionRecorder:
    """An append-only, in-memory sink for recorded action intents.

    The ONLY place blessed executions land today: the fixture corpus stands in
    for live mail (LIVE-04 -- going live is a separate, user-gated step). Live
    transports would implement the same `record` seam behind that gate.
    """

    def __init__(self) -> None:
        self._records: list[RecordedActionIntent] = []

    def record(self, intent: RecordedActionIntent) -> None:
        self._records.append(intent)

    @property
    def records(self) -> tuple[RecordedActionIntent, ...]:
        return tuple(self._records)


# --- Intent builders: capability id -> fixture enactment (lookup, INV-2) -----


class _IntentBuilder(Protocol):
    def __call__(self, *, email_id: str, importer_id: str, arguments: Mapping[str, Any]) -> RecordedActionIntent: ...


def _require_str(arguments: Mapping[str, Any], key: str, *, capability_id: str) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip():
        raise MalformedActionArgumentsError(capability_id=capability_id, key=key)
    return value


def _build_forward_intent(*, email_id: str, importer_id: str, arguments: Mapping[str, Any]) -> RecordedActionIntent:
    note = arguments.get("note")
    return RecordedForwardIntent(
        email_id=email_id,
        importer_id=importer_id,
        to_address=_require_str(arguments, "to_address", capability_id=SUGGEST_FORWARD_EMAIL_CAPABILITY_ID),
        note=note if isinstance(note, str) else None,
    )


def _build_label_mutation(*, email_id: str, importer_id: str, arguments: Mapping[str, Any]) -> RecordedActionIntent:
    return RecordedLabelMutation(
        email_id=email_id,
        importer_id=importer_id,
        label=_require_str(arguments, "label", capability_id=SUGGEST_APPLY_LABEL_CAPABILITY_ID),
    )


def _build_sheet_row_intent(*, email_id: str, importer_id: str, arguments: Mapping[str, Any]) -> RecordedActionIntent:
    raw_fields = arguments.get("fields", ())
    fields = tuple(f for f in raw_fields if isinstance(f, str)) if isinstance(raw_fields, list | tuple) else ()
    return RecordedSheetRowIntent(
        email_id=email_id,
        importer_id=importer_id,
        sheet=_require_str(arguments, "sheet", capability_id=SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID),
        fields=fields,
    )


# Resolution is a dict lookup keyed by capability id -- never an if/elif chain
# (INV-2). Missing key => UnsupportedBlessedActionError (fail closed, INV-5).
_INTENT_BUILDERS: dict[str, _IntentBuilder] = {
    SUGGEST_FORWARD_EMAIL_CAPABILITY_ID: _build_forward_intent,
    SUGGEST_APPLY_LABEL_CAPABILITY_ID: _build_label_mutation,
    SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID: _build_sheet_row_intent,
}


# --- Audit trail (INV-7) ------------------------------------------------------


@dataclass(frozen=True)
class BlessedActionAuditTrail:
    """One execution's complete audit record (INV-7).

    Carries the suggestion id AND the full bless record (actor + timestamp +
    stance), so "who authorised this and what ran" is answerable from this one
    value. `recorded_intent` is the fixture enactment that was appended to the
    recorder; `capability_result_content` is the raw payload the registry
    capability's executor returned.
    """

    suggestion_id: str
    bless: BlessRecord
    rule_id: str
    capability_id: str
    email_id: str
    importer_id: str
    executed_at: datetime
    recorded_intent: RecordedActionIntent
    capability_result_content: str


# --- The use case -------------------------------------------------------------


class ExecuteBlessedAction:
    """Execute ONE human-blessed suggestion through the capability registry.

    Order of operations is the safety argument:

      1. GATE (INV-6): refuse un-blessed / mismatched-bless suggestions before
         anything else -- the registry is never consulted for a refused request.
      2. RESOLVE: `registry.get(capability_id)` -- fail closed on unregistered
         ids (`UnknownCapabilityError`, INV-5).
      3. PLAN: look up the intent builder BEFORE executing, so an action this
         module cannot enact fails before any executor runs.
      4. EXECUTE: await the capability's executor through the registry half.
      5. RECORD: append the fixture intent (the LIVE-04-gated stand-in for the
         real side effect) and return the audit trail (INV-7).
    """

    def __init__(
        self,
        *,
        registry: CapabilityRegistry,
        recorder: FixtureActionRecorder,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._registry = registry
        self._recorder = recorder
        self._clock = clock

    async def execute(
        self,
        *,
        suggestion: Suggestion,
        suggestion_id: str,
        bless: BlessRecord | None,
        email_id: str,
        importer_id: str,
    ) -> BlessedActionAuditTrail:
        # 1. The suggest-only gate (INV-6): no bless, no execution -- checked
        #    before the registry or any executor is touched.
        if bless is None:
            raise UnblessedSuggestionError(suggestion_id)
        if bless.suggestion_id != suggestion_id:
            raise BlessMismatchError(suggestion_id=suggestion_id, blessed_suggestion_id=bless.suggestion_id)

        # 2. Resolve via the registry the suggestion references -- fail closed
        #    (UnknownCapabilityError) on an unregistered id (INV-5).
        capability = self._registry.get(suggestion.capability_id)

        # 3. Plan the fixture enactment BEFORE running anything: a capability
        #    with no builder is not a mail-rule action -> fail closed.
        builder = _INTENT_BUILDERS.get(capability.id)
        if builder is None:
            raise UnsupportedBlessedActionError(capability.id)
        intent = builder(email_id=email_id, importer_id=importer_id, arguments=suggestion.action_arguments)

        # 4. Execute through the registry capability (the same executor half the
        #    chat loop awaits -- one permission model, one execution path).
        result = await capability.executor.execute(
            name=capability.id,
            arguments=suggestion.action_arguments,
            importer_id=importer_id,
        )
        if result.is_error:
            raise BlessedActionExecutionError(capability_id=capability.id, content=result.content)

        # 5. Record the intent against the fixture corpus and emit the audit
        #    trail (INV-7: suggestion id + full bless record travel together).
        self._recorder.record(intent)
        return BlessedActionAuditTrail(
            suggestion_id=suggestion_id,
            bless=bless,
            rule_id=suggestion.rule_id,
            capability_id=capability.id,
            email_id=email_id,
            importer_id=importer_id,
            executed_at=self._clock(),
            recorded_intent=intent,
            capability_result_content=result.content,
        )


__all__ = [
    "BlessMismatchError",
    "BlessRecord",
    "BlessedActionAuditTrail",
    "BlessedActionExecutionError",
    "BlessedActionRefusedError",
    "ExecuteBlessedAction",
    "FixtureActionRecorder",
    "MalformedActionArgumentsError",
    "RecordedActionIntent",
    "RecordedForwardIntent",
    "RecordedLabelMutation",
    "RecordedSheetRowIntent",
    "UnblessedSuggestionError",
    "UnsupportedBlessedActionError",
]
