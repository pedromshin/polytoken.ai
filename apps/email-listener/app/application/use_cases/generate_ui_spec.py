"""GenerateUiSpecUseCase — orchestrates the exact-match cache + dual-LLM generation pipeline.

Architecture contract (lint-imports):
  Imports ONLY domain ports and standard library / structlog.
  No infrastructure imports permitted at module level OR under TYPE_CHECKING.
  Adapters are accepted as constructor arguments typed via the domain port Protocol.

Pipeline (D-02, D-09, SAFE-01/SAFE-02, CACHE-01):
  0. Cache CHECK: find_by_cache_key → CachedTemplate or None (D-02, FIRST step).
     On HIT: return cached spec + increment use_count; skip steps 1-3.
  1. Call A: GenuiQuarantineAdapter.extract(intent, raw_content)
             → QuarantineExtraction (enum-constrained, raw prose quarantined)
  2. Call B: GenuiGeneratorAdapter.generate(extraction, registry_version)
             → validated SpecRoot dict (or SAFE_FALLBACK_SPEC on total failure)
  3. Cache PERSIST: persist template if not result.is_fallback (D-11, best-effort D-17).
  4. Audit:  GenerationAuditRepository.record(GenerationEvent) — best-effort (T-13-10)

Security:
  - intent_hash is SHA-256 of raw intent prose — NEVER the raw string (D-19)
  - Raw prose never crosses to the generator; only the structured extraction does (SAFE-02)
  - Cache key includes importer_id + catalog_id for cross-tenant isolation (D-08, T-14-05)
  - Cache key prefix (8 chars) only ever reaches logs — never the raw intent (D-03)
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Any, Literal

import structlog

from app.application.use_cases.cache_key import (
    canonicalize_intent,
    compute_cache_key,
    compute_data_shape_hash,
)
from app.domain.ports.generation_audit_repository import GenerationAuditRepository, GenerationEvent
from app.domain.ports.ui_spec_template_repository import TemplateToPersist, UiSpecTemplateRepository

logger = structlog.get_logger(__name__)

# Default catalog_id for v1.1 (D-08 / SEAM-03).
_DEFAULT_CATALOG_ID = "global"


@dataclass(frozen=True)
class GenerateUiSpecResult:
    """Immutable result of a GenerateUiSpecUseCase.execute() call."""

    spec: dict[str, Any]
    cache_hit: bool = False
    outcome: Literal["ok", "fallback", "escalated"] = "ok"


class GenerateUiSpecUseCase:
    """Orchestrate the cache-check → quarantine → generate → persist → audit pipeline.

    Collaborators (accepted via constructor; typed as Any to keep module infra-free):
        quarantine: GenuiQuarantineAdapter — Call A (enum-constrained extraction)
        generator: GenuiGeneratorAdapter — Call B (emit_ui_spec repair loop)
        audit: GenerationAuditRepository — best-effort event persistence (D-19)
        templates: UiSpecTemplateRepository — exact-match cache (CACHE-01, D-02)

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
        templates: UiSpecTemplateRepository,
    ) -> None:
        self._quarantine = quarantine
        self._generator = generator
        self._audit = audit
        self._templates = templates

    async def execute(
        self,
        *,
        intent: str,
        raw_content: str,
        registry_version: str,
        importer_id: str | None = None,
        catalog_id: str = _DEFAULT_CATALOG_ID,
    ) -> GenerateUiSpecResult:
        """Run the cache-check → generation pipeline and return the resulting SpecRoot.

        Step 0 (D-02): cache lookup is performed FIRST — before quarantine, generator,
        or audit. A hit short-circuits the entire pipeline (zero-Bedrock-on-hit).

        Args:
            intent: Trusted user intent string (what to display).
            raw_content: Untrusted document content — quarantined in Call A (SAFE-01).
            registry_version: Catalog/registry version string for audit (GEN-05).
            importer_id: Optional importer UUID for cross-tenant cache isolation (D-08).
            catalog_id: Catalog identifier; defaults to 'global' in v1.1 (D-08/SEAM-03).

        Returns:
            GenerateUiSpecResult wrapping the validated SpecRoot dict.
            result.cache_hit is True when served from the exact-match cache.
            On total pipeline failure the result contains SAFE_FALLBACK_SPEC —
            this method itself never raises (best-effort contract mirrors the adapters).
        """
        start_ms = int(time.monotonic() * 1000)
        intent_hash = hashlib.sha256(intent.encode()).hexdigest()

        log = logger.bind(
            intent_hash=intent_hash,
            registry_version=registry_version,
        )

        # ── Step 0: Exact-match cache CHECK (D-02, CACHE-01) ────────────────────
        # Must be the FIRST step — before quarantine, generator, and audit.
        # Best-effort: find_by_cache_key swallows errors and returns None on failure.
        # Pre-compute canonical + shape_hash once so they can be reused on the
        # persist path without a redundant SHA-256 call (WR-03).
        canonical_intent = canonicalize_intent(intent)
        data_shape_hash = compute_data_shape_hash(raw_content)
        cache_key = compute_cache_key(
            intent=intent,
            raw_content=raw_content,
            registry_version=registry_version,
            importer_id=importer_id,
            catalog_id=catalog_id,
        )
        cached = await self._templates.find_by_cache_key(cache_key)
        if cached is not None:
            # HIT: serve from cache, increment use_count, skip all LLM calls + audit.
            log.info(
                "genui_cache_hit",
                cache_key_prefix=cache_key[:8],  # never log raw intent (D-03)
            )
            try:
                await self._templates.increment_use_count(cached.id)
            except Exception:
                log.warning("genui_use_count_increment_failed", exc_info=True)
            return GenerateUiSpecResult(spec=cached.spec_json, cache_hit=True, outcome="ok")

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

        # ── Determine outcome for persist + audit (D-19, T-13-11, CR-02) ────────
        # Priority: fallback > escalated > ok
        # CR-02: use the structural is_fallback flag from GeneratorResult — never
        # content-sniff the spec (eliminates false-positive for legitimate alert specs).
        outcome = _determine_outcome(escalated=gen_result.escalated, is_fallback=gen_result.is_fallback)

        latency_ms = int(time.monotonic() * 1000) - start_ms

        # ── Step 3: Cache PERSIST — only on validated specs (D-11) ──────────────
        # CR-02: gate on the structural flag, not the outcome string, so a legitimate
        # alert spec with a title that happens to match the fallback pattern is cached.
        # Best-effort: errors are swallowed + logged (D-17).
        if not gen_result.is_fallback:
            # WR-04: compute spec node count + depth from the spec tree (D-10 metadata).
            spec_node_count, spec_depth = _count_spec_nodes(gen_result.spec)
            template = TemplateToPersist(
                cache_key=cache_key,
                intent_text=canonical_intent,        # WR-03: reuse pre-computed value
                data_shape_hash=data_shape_hash,     # WR-03: reuse pre-computed value
                registry_version=registry_version,
                catalog_id=catalog_id,
                spec_json=gen_result.spec,
                validation_status="validated",
                spec_node_count=spec_node_count,     # WR-04: populate metadata columns
                spec_depth=spec_depth,               # WR-04: populate metadata columns
                importer_id=importer_id,
            )
            try:
                await self._templates.persist(template)
            except Exception:
                log.warning("genui_template_persist_failed", exc_info=True)

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

        return GenerateUiSpecResult(spec=gen_result.spec, cache_hit=False, outcome=outcome)


def _determine_outcome(
    *,
    escalated: bool,
    is_fallback: bool,
) -> Literal["ok", "fallback", "escalated"]:
    """Derive the Literal['ok','fallback','escalated'] outcome from the structural flags.

    Priority order:
      1. "fallback" — generator set is_fallback=True (SAFE_FALLBACK_SPEC returned).
      2. "escalated" — Sonnet escalation was used AND spec is valid (not fallback).
      3. "ok" — Haiku produced a valid spec on attempt 1 or 2.

    CR-02: uses the explicit is_fallback flag from GeneratorResult — never
    content-sniffs the spec dict, so a legitimate alert spec with a title
    starting with "Unable to generate" is NOT misclassified as fallback.

    Args:
        escalated: True when the Sonnet escalation model was used on the final attempt
                   (passed through from GeneratorResult.escalated — WR-04/WR-05).
        is_fallback: True when the generator itself set SAFE_FALLBACK_SPEC (CR-02).
    """
    if is_fallback:
        return "fallback"
    if escalated:
        return "escalated"
    return "ok"


def _count_spec_nodes(spec: dict[str, Any]) -> tuple[int, int]:
    """Return (node_count, max_depth) for the root node of a SpecRoot dict (WR-04, D-10).

    Mirrors the _count_nodes walker in genui_generator_adapter so that
    spec_node_count and spec_depth columns are populated on the persist path.

    Args:
        spec: The validated SpecRoot dict from GeneratorResult.spec.

    Returns:
        (node_count, max_depth) tuple; (0, 0) if root is absent or not a dict.
    """
    root = spec.get("root")
    if not isinstance(root, dict):
        return (0, 0)
    return _walk_nodes(root, depth=0)


def _walk_nodes(node: Any, depth: int) -> tuple[int, int]:
    """Recursively count nodes and compute max depth in a spec node tree (WR-04).

    Args:
        node: A spec node dict (or any value — non-dicts return (0, depth)).
        depth: Current depth level (root = 0).

    Returns:
        (total_nodes, max_depth) tuple.
    """
    if not isinstance(node, dict):
        return (0, depth)

    total = 1
    max_d = depth

    for key, value in node.items():
        if key == "children" and isinstance(value, list):
            for child in value:
                child_count, child_depth = _walk_nodes(child, depth + 1)
                total = total + child_count
                max_d = max(max_d, child_depth)
        elif isinstance(value, dict):
            child_count, child_depth = _walk_nodes(value, depth + 1)
            total = total + child_count
            max_d = max(max_d, child_depth)

    return (total, max_d)


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
