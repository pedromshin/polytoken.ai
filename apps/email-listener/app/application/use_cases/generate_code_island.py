"""GenerateCodeIslandUseCase — orchestrates the code-island generation pipeline.

This is a PARALLEL use case to GenerateUiSpecUseCase. It emits arbitrary JavaScript
island code rather than a declarative SpecRoot dict. The declarative spec use case is
untouched by this module.

Architecture contract (lint-imports):
  Imports ONLY domain ports and standard library / structlog.
  No infrastructure imports permitted at module level OR under TYPE_CHECKING.
  Adapters are accepted as constructor arguments typed via Any (mirrors
  GenerateUiSpecUseCase) so the application layer stays infrastructure-free.

Pipeline (D-09, SAFE-01/SAFE-02) — PARALLEL MULTI-CANDIDATE + JUDGE:
  1. Call A: quarantine.extract(intent, raw_content)  [ONCE]
             → QuarantineExtraction (enum-constrained, raw prose quarantined)
  2. Call B: fan out N code_generator.generate(...) CONCURRENTLY (asyncio.gather),
             one per varied temperature → N CodeGeneratorResult
             (arbitrary JS, or SAFE_FALLBACK_CODE on failure).
  3. Judge:  keep only non-fallback candidates; 0 → fallback result,
             1 → that one (skip judge), ≥2 → judge.rank(...) picks the best.
  4. Audit:  GenerationAuditRepository.record(GenerationEvent) — best-effort (T-13-10)

Same wall-clock as a single generation (gather runs candidates concurrently), N-times the
tokens, higher quality. No cache: code is non-deterministic, so there is no cache step.

Security:
  - intent_hash is SHA-256 of raw intent prose — NEVER the raw string (D-19)
  - Raw prose never crosses to the generator; only the structured extraction does (SAFE-02)
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from typing import Any, Literal

import structlog

from app.domain.ports.generation_audit_repository import GenerationAuditRepository, GenerationEvent

logger = structlog.get_logger(__name__)

# Registry version marker for code-island audit rows (generic; not a spec catalog).
_REGISTRY_VERSION = "code-island-v1"

# Temperature spread bounds for the parallel multi-candidate fan-out. A single candidate
# uses the generator's balanced default; multiple candidates are spread across this band
# so the judge gets genuinely varied designs (conservative → adventurous).
_SINGLE_CANDIDATE_TEMPERATURE = 0.7
_TEMPERATURE_LOW = 0.4
_TEMPERATURE_HIGH = 1.0


@dataclass(frozen=True)
class GenerateCodeIslandResult:
    """Immutable result of a GenerateCodeIslandUseCase.execute() call."""

    code: str
    language: str
    outcome: Literal["ok", "fallback", "escalated"] = "ok"
    attempts: int = 1
    candidate_count: int = 1
    """Total number of candidates generated in the parallel fan-out (N from settings)."""
    judged: bool = False
    """True when the LLM judge ran (i.e. >= 2 non-fallback candidates were ranked)."""


class GenerateCodeIslandUseCase:
    """Orchestrate the quarantine → fan-out → judge → audit pipeline (code-island path).

    Collaborators (accepted via constructor; typed as Any to keep module infra-free):
        quarantine: GenuiQuarantineAdapter — Call A (enum-constrained extraction, reused)
        code_generator: GenuiCodeGeneratorAdapter — Call B (emit_code_island forced tool-use)
        judge: GenuiCodeJudgeAdapter — ranks N candidates, returns the best index
        audit: GenerationAuditRepository — best-effort event persistence (D-19, reused)
        candidates: number of candidates to fan out concurrently (N; from settings)

    No cache collaborator — code output is non-deterministic.
    """

    def __init__(
        self,
        *,
        quarantine: Any,
        code_generator: Any,
        judge: Any,
        audit: GenerationAuditRepository,
        candidates: int = 3,
    ) -> None:
        self._quarantine = quarantine
        self._code_generator = code_generator
        self._judge = judge
        self._audit = audit
        # At least one candidate; guard against a misconfigured setting.
        self._candidates = max(1, candidates)

    async def execute(
        self,
        *,
        intent: str,
        raw_content: str = "",
        importer_id: str | None = None,
    ) -> GenerateCodeIslandResult:
        """Run the quarantine → fan-out → judge → audit pipeline and return the best island code.

        Args:
            intent: Trusted user intent string (what to build).
            raw_content: Untrusted document content — quarantined in Call A (SAFE-01).
            importer_id: Optional importer context for audit rows (D-19).

        Returns:
            GenerateCodeIslandResult wrapping the best emitted JavaScript. When every
            candidate falls back the result carries SAFE_FALLBACK_CODE with
            outcome='fallback' — this method itself never raises (best-effort contract
            mirrors the adapters).
        """
        start_ms = int(time.monotonic() * 1000)
        intent_hash = hashlib.sha256(intent.encode()).hexdigest()

        log = logger.bind(
            intent_hash=intent_hash,
            registry_version=_REGISTRY_VERSION,
            importer_id=importer_id,
        )
        log.info("genui_code_island_start", candidates=self._candidates)

        # ── Call A: quarantine ONCE (SAFE-01, D-09) ─────────────────────────────
        # raw_content is placed ONLY in the user turn of Call A inside delimiters.
        # The adapter's extract() never raises — returns empty extraction on error.
        extraction = await self._quarantine.extract(
            intent=intent,
            raw_content=raw_content,
        )
        log.info(
            "genui_code_island_quarantine_done",
            entity_type=extraction.entity_type,
            confidence=extraction.confidence,
        )

        # ── Call B: fan out N candidates CONCURRENTLY (SAFE-02, D-02/D-05/D-07) ──
        # Only the structured QuarantineExtraction crosses to the generator. Each
        # generate() never raises — returns CodeGeneratorResult with SAFE_FALLBACK_CODE
        # on total failure. Concurrency => same wall-clock as a single generation.
        temps = _candidate_temperatures(self._candidates)
        gen_results: list[Any] = await asyncio.gather(
            *[
                self._code_generator.generate(
                    extraction=extraction,
                    importer_id=importer_id,
                    temperature=t,
                )
                for t in temps
            ]
        )
        candidate_count = len(gen_results)

        # ── Judge: pick the best non-fallback candidate ─────────────────────────
        good = [r for r in gen_results if not r.is_fallback]
        winner, judged = await self._select_winner(
            good=good,
            all_results=gen_results,
            intent_summary=extraction.intent_summary,
            log=log,
        )
        log.info(
            "genui_code_island_generate_done",
            language=winner.language,
            attempts=winner.attempts,
            escalated=winner.escalated,
            is_fallback=winner.is_fallback,
            candidate_count=candidate_count,
            good_count=len(good),
            judged=judged,
        )

        # ── Determine outcome (priority: fallback > escalated > ok) ──────────────
        outcome = _determine_outcome(escalated=winner.escalated, is_fallback=winner.is_fallback)
        gen_result = winner

        latency_ms = int(time.monotonic() * 1000) - start_ms

        # ── Audit (GEN-05, D-19, T-13-10) — reuse the existing repository ────────
        # Best-effort: audit failure is swallowed + logged, never propagated.
        # Spec-specific fields are set to neutral defaults (no spec is produced on
        # this path) rather than creating a new table/migration.
        event = GenerationEvent(
            intent_hash=intent_hash,
            model_id=_resolve_model_id(escalated=gen_result.escalated),
            input_tokens=getattr(extraction, "input_tokens", 0),
            output_tokens=getattr(extraction, "output_tokens", 0),
            attempts=gen_result.attempts,
            outcome=outcome,
            spec_validation_passed=(outcome != "fallback"),
            registry_version=_REGISTRY_VERSION,
            spec_node_count=None,
            spec_depth=None,
            latency_ms=latency_ms,
            importer_id=importer_id,
            style_pack_id=None,
            retrieved_ids=(),
            retrieved_overlap_count=0,
        )
        try:
            await self._audit.record(event)
        except Exception:
            log.warning("genui_code_island_audit_failed", exc_info=True)

        return GenerateCodeIslandResult(
            code=gen_result.code,
            language=gen_result.language,
            outcome=outcome,
            attempts=gen_result.attempts,
            candidate_count=candidate_count,
            judged=judged,
        )

    async def _select_winner(
        self,
        *,
        good: list[Any],
        all_results: list[Any],
        intent_summary: str,
        log: Any,
    ) -> tuple[Any, bool]:
        """Pick the winning candidate from the non-fallback set.

        Returns (winner, judged):
          - 0 good candidates → an actual fallback CodeGeneratorResult from the fan-out
            (it already carries SAFE_FALLBACK_CODE + attempts/escalated flags), judged=False.
          - exactly 1 good     → that candidate, judged=False (judge skipped).
          - >= 2 good          → judge.rank picks the best; judged=True. The judge
            never raises (returns 0 on error), so a judge failure yields the first
            good candidate.
        """
        if not good:
            # Every candidate fell back: return a real fallback result from the fan-out.
            # Each generate() returns SAFE_FALLBACK_CODE (is_fallback=True) on total
            # failure, so all_results[-1] already IS a safe fallback — no infra import
            # needed (lint-imports: the application layer stays infrastructure-free).
            # all_results is never empty (N >= 1, enforced in __init__).
            return (all_results[-1], False)
        if len(good) == 1:
            return (good[0], False)

        best_i = await self._judge.rank(
            intent_summary=intent_summary,
            candidates=[r.code for r in good],
        )
        # Defence-in-depth: clamp the judge's index even though rank() already clamps.
        best_i = max(0, min(best_i, len(good) - 1))
        log.info("genui_code_island_judged", best_index=best_i, good_count=len(good))
        return (good[best_i], True)


def _candidate_temperatures(n: int) -> list[float]:
    """Return the temperature spread for N concurrent candidates.

    N == 1 → [0.7] (the generator's balanced default). N >= 2 → N values evenly
    spaced across [0.4, 1.0] inclusive, so the endpoints are always the extremes
    (e.g. N=3 → [0.4, 0.7, 1.0]). This gives the judge genuinely varied designs
    (conservative → adventurous).
    """
    if n <= 1:
        return [_SINGLE_CANDIDATE_TEMPERATURE]
    step = (_TEMPERATURE_HIGH - _TEMPERATURE_LOW) / (n - 1)
    return [round(_TEMPERATURE_LOW + step * i, 4) for i in range(n)]


def _determine_outcome(
    *,
    escalated: bool,
    is_fallback: bool,
) -> Literal["ok", "fallback", "escalated"]:
    """Derive the Literal['ok','fallback','escalated'] outcome from the structural flags.

    Priority order (mirrors the declarative use case):
      1. "fallback" — generator set is_fallback=True (SAFE_FALLBACK_CODE returned).
      2. "escalated" — Sonnet escalation produced valid code (not fallback).
      3. "ok" — Haiku produced valid code on attempt 1 or 2.
    """
    if is_fallback:
        return "fallback"
    if escalated:
        return "escalated"
    return "ok"


def _resolve_model_id(*, escalated: bool) -> str:
    """Return the model ID used for the final generation attempt (audit accuracy).

    Imported lazily inside the function: settings is from app.settings (not
    infrastructure), but keeping it function-scoped avoids any circular import edge
    cases and keeps the module's top-level imports infrastructure-free (mirrors
    _resolve_model_id in generate_ui_spec).
    """
    from app.settings import get_settings  # noqa: PLC0415

    settings = get_settings()
    if escalated:
        return settings.genui_escalation_model_id
    return settings.genui_model_id
