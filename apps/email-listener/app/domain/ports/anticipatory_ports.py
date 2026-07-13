"""Anticipatory-prompting SPIKE gate ports (Phase 25-02, ANTIC-02) — D-07/D-08/D-10.

Two INDEPENDENT gate ports (D-08) a surviving `AnticipatoryCandidate` (Plan
25-01) must pass BOTH of — neither substitutes for the other:

- AppropriatenessJudge: gate #1 (D-07) — an LLM-judge appropriateness score.
  Sees ONLY the neutral candidate text + rationale + a neutral context
  summary (T-25-03) — never raw chat PII.
- AnticipatoryCapStore: gate #2 (D-10) — a hard multi-window/day frequency
  cap. Reads/writes conversation-scoped "shown" state; can only DENY a
  candidate — it never approves on the appropriateness eval's behalf (D-08).

Domain-pure: no imports from app.application/app.infrastructure (lint-imports
enforces "Domain has no external deps").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AppropriatenessScore:
    """Gate #1 result (D-07) — a 0-1 score + a short reason (logged server-side only, T-25-03)."""

    score: float
    reason: str


class AppropriatenessJudge(Protocol):
    """Gate #1 port (D-07) — scores a candidate's appropriateness 0-1.

    Implementations MUST be false-positive-averse (D-07/D-09): on ANY error,
    timeout, or invalid output, return `AppropriatenessScore(score=0.0, ...)` —
    never raise, and never default toward approval (the code-island judge's
    "safe default = first candidate" posture is the OPPOSITE and must not be
    mirrored here).
    """

    async def score(self, *, proposed_prompt_text: str, rationale: str, context_summary: str) -> AppropriatenessScore:
        """Score how appropriate it is to show this candidate right now.

        Args:
            proposed_prompt_text: the candidate's would-be proposal-card text.
            rationale: the trigger's "why now" explanation.
            context_summary: a NEUTRAL summary of the surrounding context —
                never raw chat PII (T-25-03).
        """
        ...


@dataclass(frozen=True)
class CapDecision:
    """Gate #2 result (D-10) — whether the frequency cap allows a candidate through."""

    allowed: bool
    reason: str


class AnticipatoryCapStore(Protocol):
    """Gate #2 port (D-10) — the hard multi-window/day frequency cap's persistence seam.

    Two operations only: read how many candidates have been shown in a
    conversation since some epoch, and record a newly-shown candidate. The cap
    can only DENY a candidate (skip gate #1 as a cost optimization, or veto
    even when gate #1 would pass) — it never approves on the appropriateness
    eval's behalf (D-08).
    """

    async def count_shown(self, *, conversation_id: str, since_epoch_s: float) -> int:
        """Count candidates shown in `conversation_id` at or after `since_epoch_s`."""
        ...

    async def record_shown(self, *, conversation_id: str, at_epoch_s: float) -> None:
        """Record that a candidate was shown in `conversation_id` at `at_epoch_s`."""
        ...


__all__ = [
    "AnticipatoryCapStore",
    "AppropriatenessJudge",
    "AppropriatenessScore",
    "CapDecision",
]
