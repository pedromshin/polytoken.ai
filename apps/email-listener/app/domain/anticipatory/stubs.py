"""StubAppropriatenessJudge — deterministic AppropriatenessJudge test double (D-09).

D-09: judge calls run against fixtures with a stubbed/fake provider by
default; a live Bedrock pass is a documented deferral. This stub drives
Plan 25-02's gate-chain tests (and Plan 25-03's findings harness)
deterministically, with no Bedrock call.

Imports only the port + result types (app.domain.ports.anticipatory_ports) —
no app.infrastructure import, so this stays usable from domain-pure test
contexts and satisfies the "Domain has no external deps" lint-imports
contract like every other module in this package.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.ports.anticipatory_ports import AppropriatenessJudge, AppropriatenessScore


@dataclass
class StubAppropriatenessJudge(AppropriatenessJudge):
    """Deterministic test double for AppropriatenessJudge (D-09).

    Two modes:
      - Fixed score (default): every `.score()` call returns the same
        `AppropriatenessScore(score=score_value, reason=reason)`.
      - Scripted: when `script` is non-empty, each call pops the next entry
        (FIFO) — lets one test drive several candidates through different
        verdicts without constructing a new stub per call.
    """

    score_value: float = 1.0
    reason: str = "stub_pass"
    script: list[AppropriatenessScore] = field(default_factory=list)

    async def score(self, *, proposed_prompt_text: str, rationale: str, context_summary: str) -> AppropriatenessScore:
        del proposed_prompt_text, rationale, context_summary  # stub ignores call inputs
        if self.script:
            return self.script.pop(0)
        return AppropriatenessScore(score=self.score_value, reason=self.reason)


__all__ = ["StubAppropriatenessJudge"]
