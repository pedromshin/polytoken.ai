"""Pipeline-health vocabulary + adapter-degradation recording (ST-04).

Two pure-domain concerns (stdlib only):

1. THE STAGE-PREFIX VOCABULARY for ``emails.parse_error``. The column stays a
   HUMAN-READABLE, length-capped text summary (it renders verbatim in the web
   ParseStatusMarker tooltip — never a JSON blob), but every entry the ingest
   use case records starts with a machine-decodable stage prefix::

       attachment[0]: bl.pdf: RuntimeError('corrupt PDF stream')
       propose_regions: RuntimeError('bedrock down')
       suggest_entity_types: TimeoutError()
       adapter_degraded[classifier]: classify_regions failed: APIError

   Entries are joined with ``"; "``. :func:`decode_failed_stages` recovers the
   stage buckets for the health endpoint (GET /v1/pipeline/health) without
   parse_error ever becoming a wire format beyond this one prefix rule.

2. ADAPTER DEGRADATION RECORDING. Several LLM adapters have a "never raises"
   contract (segmenter returns [], classifier returns (), embedder returns a
   zero-vector). Those silent fallbacks previously left no machine-readable
   trace. The adapters now call :func:`record_adapter_degradation` in their
   swallow branches; a pipeline driver that wants the events wraps its stages
   in :func:`collect_adapter_degradations`. Outside a collector the call is a
   NO-OP, so adapters stay safe to use from any context (chat tools, autofill,
   tests) with zero behavioral change.

parse_status vocabulary (emails table — the web marker already renders all of
these): ``received`` (in flight / finalizer never ran), ``parsed`` (clean),
``degraded`` (persisted + parsed, but one or more LLM adapters silently
degraded), ``failed`` (at least one post-persist stage hard-failed).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# parse_status vocabulary (persisted — treat as a wire format)
# ---------------------------------------------------------------------------

PARSE_STATUS_RECEIVED = "received"
PARSE_STATUS_PARSED = "parsed"
PARSE_STATUS_DEGRADED = "degraded"
PARSE_STATUS_FAILED = "failed"

# Attachment parse_status vocabulary (email_attachments table). 'skipped'
# (ST-04) marks the no-extension / no-registered-parser paths so an
# unparseable-by-design attachment never reads as stuck 'pending'.
ATTACHMENT_STATUS_PENDING = "pending"
ATTACHMENT_STATUS_PARSED = "parsed"
ATTACHMENT_STATUS_FAILED = "failed"
ATTACHMENT_STATUS_SKIPPED = "skipped"

# Stage bucket for failed emails whose parse_error carries no decodable
# stage prefix (legacy rows, manual writes, cap-truncated single entries).
UNKNOWN_STAGE = "unknown"

# A stage prefix is a lowercase identifier optionally followed by one
# [bracketed] qualifier, terminated by ": ". The bracket content is an index
# for attachments ("attachment[0]") and an adapter name for degradations
# ("adapter_degraded[classifier]").
_STAGE_PREFIX_RE = re.compile(r"^([a-z_]+)(\[([^\]\s]*)\])?: ")

# Degradation entries use this stage name; the qualifier names the adapter.
DEGRADED_STAGE = "adapter_degraded"


def failure_entry(stage: str, detail: str, *, qualifier: str | None = None) -> str:
    """Format one stage-prefixed, human-readable parse_error entry."""
    prefix = f"{stage}[{qualifier}]" if qualifier is not None else stage
    return f"{prefix}: {detail}"


def decode_stage_prefix(entry: str) -> tuple[str, str | None] | None:
    """Decode one parse_error fragment into (stage, qualifier), or None.

    Fragments without a recognizable prefix (e.g. the tail of an exception
    message that itself contained "; ") are not entries — callers skip them.
    The numeric attachment index is NOT part of the stage identity (buckets
    would fragment per index), so ``attachment[3]`` decodes to
    ``("attachment", "3")`` and callers bucket on the stage alone; the
    adapter_degraded qualifier IS identity and is kept by callers.
    """
    match = _STAGE_PREFIX_RE.match(entry)
    if match is None:
        return None
    return match.group(1), match.group(3)


def decode_failed_stages(parse_error: str | None) -> list[str]:
    """Recover the ordered, de-duplicated stage buckets from a parse_error.

    - ``attachment[N]`` entries collapse into one ``attachment`` bucket.
    - ``adapter_degraded[X]`` entries keep the adapter: ``adapter_degraded[X]``.
    - A non-empty parse_error with no decodable prefix yields ``[UNKNOWN_STAGE]``
      (legacy plain-text rows stay countable, never invisible).
    - None/empty yields ``[]``.
    """
    if not parse_error:
        return []
    stages: list[str] = []
    for fragment in parse_error.split("; "):
        decoded = decode_stage_prefix(fragment)
        if decoded is None:
            continue
        stage, qualifier = decoded
        bucket = f"{stage}[{qualifier}]" if stage == DEGRADED_STAGE and qualifier else stage
        if bucket not in stages:
            stages.append(bucket)
    if not stages:
        return [UNKNOWN_STAGE]
    return stages


def decode_degraded_adapters(parse_error: str | None) -> list[str]:
    """Recover the adapter names from a parse_error's adapter_degraded entries."""
    if not parse_error:
        return []
    adapters: list[str] = []
    for fragment in parse_error.split("; "):
        decoded = decode_stage_prefix(fragment)
        if decoded is None:
            continue
        stage, qualifier = decoded
        if stage == DEGRADED_STAGE and qualifier and qualifier not in adapters:
            adapters.append(qualifier)
    return adapters


# ---------------------------------------------------------------------------
# Adapter degradation recording (contextvar-scoped, no-op outside a collector)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AdapterDegradation:
    """One silent degradation emitted by a never-raise adapter."""

    adapter: str
    detail: str


_degradations: ContextVar[list[AdapterDegradation] | None] = ContextVar(
    "pipeline_adapter_degradations",
    default=None,
)


def record_adapter_degradation(adapter: str, detail: str) -> None:
    """Record that *adapter* degraded (returned an empty/zero fallback).

    Called from adapter swallow branches. No-op unless the current context is
    inside :func:`collect_adapter_degradations` — never raises, never changes
    the adapter's return contract.
    """
    events = _degradations.get()
    if events is not None:
        events.append(AdapterDegradation(adapter=adapter, detail=detail))


@contextmanager
def collect_adapter_degradations() -> Iterator[list[AdapterDegradation]]:
    """Collect adapter degradations recorded while the block runs.

    Contextvar-based: awaited child coroutines inherit the collector, so a
    use case wrapping its stages sees degradations recorded deep inside
    infrastructure adapters without any signature changes.
    """
    events: list[AdapterDegradation] = []
    token = _degradations.set(events)
    try:
        yield events
    finally:
        _degradations.reset(token)


def degradation_entries(events: list[AdapterDegradation]) -> list[str]:
    """Fold collected events into compact, human-readable parse_error entries.

    One entry per adapter (a 20-page email must not emit 20 near-identical
    lines into a 2000-char-capped column): the first detail is kept verbatim
    and further events collapse into a ``(+N more)`` suffix.
    """
    grouped: dict[str, list[str]] = {}
    for event in events:
        grouped.setdefault(event.adapter, []).append(event.detail)
    entries: list[str] = []
    for adapter, details in grouped.items():
        detail = details[0]
        if len(details) > 1:
            detail = f"{detail} (+{len(details) - 1} more)"
        entries.append(failure_entry(DEGRADED_STAGE, detail, qualifier=adapter))
    return entries
