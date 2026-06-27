"""GenerateUiSpecUseCase — orchestrates the dual-LLM generation pipeline.

Architecture contract (lint-imports):
  Imports ONLY domain ports and standard library / structlog.
  No infrastructure imports permitted at module level OR under TYPE_CHECKING.
  Adapters are accepted as constructor arguments typed via the domain port Protocol
  (GenerationAuditRepository) and runtime duck-typing for the two LLM adapters
  (typed as Any to keep the module infrastructure-free).

Pipeline (D-09, SAFE-01/SAFE-02):
  1. Call A: GenuiQuarantineAdapter.extract(intent, raw_content)
             → QuarantineExtraction (enum-constrained, raw prose quarantined)
  2. Call B: GenuiGeneratorAdapter.generate(extraction, registry_version)
             → validated SpecRoot dict (or SAFE_FALLBACK_SPEC on total failure)
  3. Audit:  GenerationAuditRepository.record(GenerationEvent) — best-effort (T-13-10)

Security:
  - intent_hash is SHA-256 of raw intent prose — NEVER the raw string (D-19)
  - Raw prose never crosses to the generator; only the structured extraction does (SAFE-02)
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Any, Literal

import structlog

from app.domain.ports.generation_audit_repository import GenerationAuditRepository, GenerationEvent

logger = structlog.get_logger(__name__)

# Constant for the SAFE_FALLBACK_SPEC check — mirrors the hardcoded shape in the adapter.
# We only need to check the root.type to determine if fallback was used.
_FALLBACK_ROOT_TYPE = "alert"
_FALLBACK_TITLE_FRAGMENT = "Unable to generate"


@dataclass(frozen=True)
class GenerateUiSpecResult:
    """Immutable result of a GenerateUiSpecUseCase.execute() call."""

    spec: dict[str, Any]


class GenerateUiSpecUseCase:
    """Orchestrate the quarantine → generate → audit pipeline (D-09, GEN-05).

    Collaborators (accepted via constructor; typed as Any to keep module infra-free):
        quarantine: GenuiQuarantineAdapter — Call A (enum-constrained extraction)
        generator: GenuiGeneratorAdapter — Call B (emit_ui_spec repair loop)
        audit: GenerationAuditRepository — best-effort event persistence (D-19)

    Security (lint-imports contract): this class imports no infrastructure at
    module level — it accepts adapters as constructor arguments so the domain
    layer stays clean and testable.
    """

    def __init__(
        self,
        *,
        quarantine: Any,
        generator: Any,
        audit: GenerationAuditRepository,
    ) -> None:
        self._quarantine = quarantine
        self._generator = generator
        self._audit = audit

    async def execute(
        self,
        *,
        intent: str,
        raw_content: str,
        registry_version: str,
        importer_id: str | None = None,
    ) -> GenerateUiSpecResult:
        """Run the generation pipeline and return the resulting SpecRoot.

        Args:
            intent: Trusted user intent string (what to display).
            raw_content: Untrusted document content — quarantined in Call A (SAFE-01).
            registry_version: Catalog/registry version string for audit (GEN-05).
            importer_id: Optional importer context for audit (D-19).

        Returns:
            GenerateUiSpecResult wrapping the validated SpecRoot dict.
            On total pipeline failure the result contains SAFE_FALLBACK_SPEC —
            this method itself never raises (best-effort contract mirrors the adapters).
        """
        start_ms = int(time.monotonic() * 1000)
        intent_hash = hashlib.sha256(intent.encode()).hexdigest()

        log = logger.bind(
            intent_hash=intent_hash,
            registry_version=registry_version,
        )
        log.info("genui_generate_start")

        # ── Call A: quarantine (SAFE-01, D-09) ──────────────────────────────────
        # raw_content is placed ONLY in the user turn of Call A inside delimiters.
        # The adapter's extract() never raises — returns empty extraction on error.
        extraction = await self._quarantine.extract(
            intent=intent,
            raw_content=raw_content,
        )
        log.info(
            "genui_quarantine_done",
            entity_type=extraction.entity_type,
            confidence=extraction.confidence,
        )

        # ── Call B: generate (SAFE-02, D-02/D-06/D-07) ──────────────────────────
        # Only the structured QuarantineExtraction crosses to the generator.
        # generate() never raises — returns GeneratorResult with SAFE_FALLBACK_SPEC on total failure.
        gen_result = await self._generator.generate(
            extraction=extraction,
            registry_version=registry_version,
        )
        log.info(
            "genui_generate_done",
            spec_type=gen_result.spec.get("root", {}).get("type"),
            attempts=gen_result.attempts,
            escalated=gen_result.escalated,
        )

        # ── Determine outcome for audit (D-19, T-13-11, WR-04) ─────────────────
        # Priority: fallback > escalated > ok
        # "escalated" means Sonnet was used AND the spec is valid (not a fallback).
        outcome = _determine_outcome(gen_result.spec, escalated=gen_result.escalated)

        latency_ms = int(time.monotonic() * 1000) - start_ms

        # ── Audit (GEN-05, D-19, T-13-10, WR-03/04/05) ─────────────────────────
        # Best-effort: audit failure is swallowed + logged, never propagated.
        model_id = _resolve_model_id(escalated=gen_result.escalated)
        event = GenerationEvent(
            intent_hash=intent_hash,
            model_id=model_id,
            input_tokens=getattr(extraction, "input_tokens", 0),
            output_tokens=getattr(extraction, "output_tokens", 0),
            attempts=gen_result.attempts,
            outcome=outcome,
            spec_validation_passed=(outcome != "fallback"),
            registry_version=registry_version,
            latency_ms=latency_ms,
            importer_id=importer_id,
        )
        try:
            await self._audit.record(event)
        except Exception:
            log.warning("genui_audit_failed", exc_info=True)

        return GenerateUiSpecResult(spec=gen_result.spec)


def _determine_outcome(
    spec: dict[str, Any],
    *,
    escalated: bool,
) -> Literal["ok", "fallback", "escalated"]:
    """Derive the Literal['ok','fallback','escalated'] outcome from the spec + escalation flag.

    Priority order:
      1. "fallback" — spec matches SAFE_FALLBACK_SPEC shape (pipeline total failure).
      2. "escalated" — Sonnet escalation was used AND spec is valid.
      3. "ok" — Haiku produced a valid spec on attempt 1 or 2.

    Args:
        spec: The SpecRoot dict returned by the generator.
        escalated: True when the Sonnet escalation model was used on the final attempt
                   (passed through from GeneratorResult.escalated — WR-04/WR-05).
    """
    root = spec.get("root", {})
    is_fallback = (
        isinstance(root, dict)
        and root.get("type") == _FALLBACK_ROOT_TYPE
        and isinstance(root.get("title"), str)
        and root["title"].startswith(_FALLBACK_TITLE_FRAGMENT)
    )
    if is_fallback:
        return "fallback"
    if escalated:
        return "escalated"
    return "ok"


def _resolve_model_id(*, escalated: bool) -> str:
    """Return the model ID used for the final generation attempt (WR-05).

    When escalated=True, the Sonnet escalation model was used on attempt 3;
    report that model ID in the audit row rather than always reporting Haiku.

    Imported lazily inside the function: settings is from app.settings (not
    infrastructure), but keeping it function-scoped avoids any circular import
    edge cases and keeps the module's top-level imports infrastructure-free.
    """
    from app.settings import get_settings  # noqa: PLC0415

    settings = get_settings()
    if escalated:
        return settings.genui_escalation_model_id
    return settings.genui_model_id
