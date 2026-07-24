"""Anticipatory-prompting spike providers — extracted from container.py (Track 2 decomposition).

The Phase-25-02 dark gate-chain pipeline: registered so it is real, DI-constructible
infrastructure, but NOT invoked in the live turn loop (ANTICIPATORY_PROMPTING_ENABLED
defaults to False, checked by the caller). Factory bodies moved verbatim; `register` performs
the group's bindings. The judge takes the already-bound `AsyncAnthropicBedrock` as an injected
param — no patched global — so container.py's boot-test patch targets are unaffected.
"""

from __future__ import annotations

from anthropic import AsyncAnthropicBedrock
from dishka import Provider

from app.application.use_cases.evaluate_anticipatory_candidates import EvaluateAnticipatoryCandidates
from app.domain.ports.anticipatory_ports import AnticipatoryCapStore, AppropriatenessJudge
from app.infrastructure.anticipatory.in_memory_cap_store import InMemoryAnticipatoryCapStore
from app.infrastructure.llm.anticipatory_judge_adapter import BedrockAppropriatenessJudgeAdapter
from app.settings import get_settings


def _provide_anticipatory_judge(client: AsyncAnthropicBedrock) -> AppropriatenessJudge:
    """BedrockAppropriatenessJudgeAdapter — gate #1 of the ANTIC-02 dark pipeline (D-07/D-09).

    Registered so the pipeline is DI-constructible (D-01); the pipeline itself
    is not invoked anywhere in the live turn loop (D-12 — dark by default via
    ANTICIPATORY_PROMPTING_ENABLED=False, checked by the caller, not here).
    """
    settings = get_settings()
    return BedrockAppropriatenessJudgeAdapter(
        client=client,
        model_id=settings.anticipatory_judge_model_id,
        max_tokens=settings.ANTICIPATORY_JUDGE_MAX_TOKENS,
        timeout_seconds=settings.ANTICIPATORY_JUDGE_TIMEOUT_SECONDS,
        threshold=settings.ANTICIPATORY_APPROPRIATENESS_THRESHOLD,
    )


def _provide_evaluate_anticipatory_candidates(
    judge: AppropriatenessJudge,
    cap_store: AnticipatoryCapStore,
) -> EvaluateAnticipatoryCandidates:
    """Factory for EvaluateAnticipatoryCandidates — the ANTIC-02 gate-chain use case (D-01/D-08).

    Both collaborators are the domain PORTS (not concrete adapters) — mirrors
    every other Protocol-typed use case factory in this module.
    """
    return EvaluateAnticipatoryCandidates(judge=judge, cap_store=cap_store)


def register(provider: Provider) -> None:
    """Register the anticipatory-spike group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    "Anticipatory-prompting SPIKE" block they replaced (dark by default; DI-constructible).
    """
    provider.provide(_provide_anticipatory_judge, provides=AppropriatenessJudge)
    provider.provide(InMemoryAnticipatoryCapStore, provides=AnticipatoryCapStore)
    provider.provide(_provide_evaluate_anticipatory_candidates, provides=EvaluateAnticipatoryCandidates)
