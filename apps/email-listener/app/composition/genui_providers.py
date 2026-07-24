"""GenUI generation providers — extracted from container.py (Track 2 decomposition).

Owns the dual-LLM declarative-spec pipeline (quarantine + generator + audit + templates +
retrieval), the parallel code-island path (code generator + judge), and the one-shot
NL re-theme resolver. Factory bodies are moved verbatim from container.py — behavior is
byte-identical; only their home changed. `register(provider)` performs this group's dishka
bindings so container.py's composition root just calls it.

The client-singleton factories (Supabase/Anthropic/boto3) intentionally STAY in container.py:
the boot tests patch `app.container.get_anthropic_client` etc., and these factories take the
already-bound `AsyncAnthropicBedrock`/`Client` as injected params, so nothing here references
a patched global.
"""

from __future__ import annotations

from anthropic import AsyncAnthropicBedrock
from dishka import Provider
from supabase import Client

from app.application.use_cases.generate_code_island import GenerateCodeIslandUseCase
from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase
from app.application.use_cases.resolve_retheme import ResolveRethemeUseCase
from app.domain.ports.generation_audit_repository import GenerationAuditRepository
from app.domain.ports.retrieval_provider import RetrievalProvider
from app.domain.ports.ui_spec_template_repository import UiSpecTemplateRepository
from app.infrastructure.llm.genui_code_generator_adapter import GenuiCodeGeneratorAdapter
from app.infrastructure.llm.genui_code_judge_adapter import GenuiCodeJudgeAdapter
from app.infrastructure.llm.genui_generator_adapter import GenuiGeneratorAdapter
from app.infrastructure.llm.genui_quarantine_adapter import GenuiQuarantineAdapter
from app.infrastructure.llm.genui_retheme_adapter import GenuiRethemeAdapter
from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider
from app.infrastructure.llm.genui_style_packs import DEFAULT_PACK_ID, is_known_pack_id
from app.infrastructure.supabase.supabase_generation_audit_repository import (
    SupabaseGenerationAuditRepository,
)
from app.infrastructure.supabase.supabase_ui_spec_template_repository import (
    SupabaseUiSpecTemplateRepository,
)
from app.settings import get_settings


def _provide_genui_quarantine_adapter(client: AsyncAnthropicBedrock) -> GenuiQuarantineAdapter:
    """GenuiQuarantineAdapter — Call A of the dual-LLM generation pipeline (D-09, SAFE-01)."""
    settings = get_settings()
    return GenuiQuarantineAdapter(
        client=client,
        model_id=settings.genui_model_id,
        max_tokens=settings.GENUI_QUARANTINE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
    )


def _provide_genui_generator_adapter(client: AsyncAnthropicBedrock) -> GenuiGeneratorAdapter:
    """GenuiGeneratorAdapter — Call B of the dual-LLM generation pipeline (D-09, SAFE-02)."""
    settings = get_settings()
    return GenuiGeneratorAdapter(
        client=client,
        model_id=settings.genui_model_id,
        escalation_model_id=settings.genui_escalation_model_id,
        max_tokens=settings.GENUI_GENERATOR_MAX_TOKENS,
        timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
    )


def _provide_genui_retheme_adapter(client: AsyncAnthropicBedrock) -> GenuiRethemeAdapter:
    """GenuiRethemeAdapter — PANL-04's one-shot NL re-theme resolution (Plan 52-05).

    Reuses the SAME AsyncAnthropicBedrock client + primary model as the
    declarative generator (genui_model_id) — this is a cheap, one-shot
    classification-shaped call, not a full generation, so it shares the
    generator's model tier rather than introducing a new one.
    """
    settings = get_settings()
    return GenuiRethemeAdapter(
        client=client,
        model_id=settings.genui_model_id,
        max_tokens=settings.GENUI_RETHEME_MAX_TOKENS,
        timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
    )


def _provide_resolve_retheme_use_case(resolver: GenuiRethemeAdapter) -> ResolveRethemeUseCase:
    """Factory for ResolveRethemeUseCase — injects the is_known_pack_id predicate + default pack id.

    is_known_pack_id/DEFAULT_PACK_ID are imported here at the composition
    root (not inside resolve_retheme.py itself) so the use case module stays
    lint-imports-clean — it never imports app.infrastructure directly (see
    resolve_retheme.py's module docstring for the full rationale).
    """
    return ResolveRethemeUseCase(
        resolver=resolver,
        is_known_pack_id=is_known_pack_id,
        default_pack_id=DEFAULT_PACK_ID,
    )


def _provide_genui_code_generator_adapter(client: AsyncAnthropicBedrock) -> GenuiCodeGeneratorAdapter:
    """GenuiCodeGeneratorAdapter — Call B of the PARALLEL code-island path (D-09, SAFE-02).

    Emits arbitrary JS island code instead of a declarative SpecRoot. Uses a DEDICATED,
    larger tier (Sonnet + big token budget + longer timeout): arbitrary UI code is
    quality-/size-critical and non-cacheable, and the compact-spec budget (3000 tokens)
    truncates a full custom design → invalid tool call → fallback.
    """
    settings = get_settings()
    return GenuiCodeGeneratorAdapter(
        client=client,
        model_id=settings.genui_code_model_id,
        escalation_model_id=settings.genui_code_escalation_model_id,
        max_tokens=settings.GENUI_CODE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_CODE_TIMEOUT_SECONDS,
    )


def _provide_genui_code_judge_adapter(client: AsyncAnthropicBedrock) -> GenuiCodeJudgeAdapter:
    """GenuiCodeJudgeAdapter — ranks N code-island candidates and picks the best.

    Part of the PARALLEL multi-candidate code-island path: the generator fans out N
    candidates concurrently (varied temperature) and this judge ranks them. Uses the
    dedicated judge model (Sonnet by default); output is tiny (an index + reason) so it
    reuses the code-island timeout as an upper bound on the small, fast ranking call.
    """
    settings = get_settings()
    return GenuiCodeJudgeAdapter(
        client=client,
        model_id=settings.genui_code_judge_model_id,
        max_tokens=settings.GENUI_CODE_JUDGE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_CODE_TIMEOUT_SECONDS,
    )


def _provide_generation_audit_repository(client: Client) -> GenerationAuditRepository:
    """SupabaseGenerationAuditRepository — best-effort audit for generation events (GEN-05, D-19)."""
    return SupabaseGenerationAuditRepository(client=client)


def _provide_ui_spec_template_repository(client: Client) -> UiSpecTemplateRepository:
    """SupabaseUiSpecTemplateRepository — exact-match cache for validated UI specs (CACHE-01, D-17)."""
    return SupabaseUiSpecTemplateRepository(client=client)


def _provide_lexical_retrieval_provider() -> RetrievalProvider:
    """LexicalRetrievalProvider bound to RetrievalProvider port (17-04, RAG-01)."""
    return LexicalRetrievalProvider()


def _provide_generate_ui_spec_use_case(
    quarantine: GenuiQuarantineAdapter,
    generator: GenuiGeneratorAdapter,
    audit: GenerationAuditRepository,
    templates: UiSpecTemplateRepository,
    retrieval_provider: RetrievalProvider,
) -> GenerateUiSpecUseCase:
    """Factory for GenerateUiSpecUseCase — orchestrates the cache→quarantine→generate→audit pipeline."""
    return GenerateUiSpecUseCase(
        quarantine=quarantine,
        generator=generator,
        audit=audit,
        templates=templates,
        retrieval_provider=retrieval_provider,
    )


def _provide_generate_code_island_use_case(
    quarantine: GenuiQuarantineAdapter,
    code_generator: GenuiCodeGeneratorAdapter,
    judge: GenuiCodeJudgeAdapter,
    audit: GenerationAuditRepository,
) -> GenerateCodeIslandUseCase:
    """Factory for GenerateCodeIslandUseCase — orchestrates the PARALLEL quarantine→fan-out→judge→audit pipeline.

    Reuses the quarantine adapter (Call A) and the audit repository; no cache (code is
    non-deterministic). Fans out GENUI_CODE_CANDIDATES generations concurrently (varied
    temperature) and ranks them with the judge. Mirrors _provide_generate_ui_spec_use_case.
    """
    return GenerateCodeIslandUseCase(
        quarantine=quarantine,
        code_generator=code_generator,
        judge=judge,
        audit=audit,
        candidates=get_settings().GENUI_CODE_CANDIDATES,
    )


def register(provider: Provider) -> None:
    """Register the GenUI generation group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    block they replaced (declarative dual-LLM pipeline, code-island path, re-theme resolver).
    """
    # Dual-LLM declarative-spec pipeline (D-09, SAFE-01/SAFE-02).
    provider.provide(_provide_genui_quarantine_adapter, provides=GenuiQuarantineAdapter)
    provider.provide(_provide_genui_generator_adapter, provides=GenuiGeneratorAdapter)
    provider.provide(_provide_generation_audit_repository, provides=GenerationAuditRepository)
    provider.provide(_provide_ui_spec_template_repository, provides=UiSpecTemplateRepository)
    provider.provide(_provide_lexical_retrieval_provider, provides=RetrievalProvider)
    provider.provide(_provide_generate_ui_spec_use_case, provides=GenerateUiSpecUseCase)

    # One-shot NL re-theme resolution (PANL-04, Plan 52-05).
    provider.provide(_provide_genui_retheme_adapter, provides=GenuiRethemeAdapter)
    provider.provide(_provide_resolve_retheme_use_case, provides=ResolveRethemeUseCase)

    # Parallel code-island path.
    provider.provide(_provide_genui_code_generator_adapter, provides=GenuiCodeGeneratorAdapter)
    provider.provide(_provide_genui_code_judge_adapter, provides=GenuiCodeJudgeAdapter)
    provider.provide(_provide_generate_code_island_use_case, provides=GenerateCodeIslandUseCase)
