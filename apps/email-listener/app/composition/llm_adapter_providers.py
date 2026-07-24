"""LLM adapter providers — extracted from container.py (Track 2 decomposition).

Owns the Bedrock/OpenRouter LLM-backed port bindings: the document-processing adapters
(autofiller, entity-type classifier, segmenter) and the chat transport layer (the two
ChatProvider implementations + the router that selects between them by model transport).

Factory bodies are moved verbatim from container.py (behavior byte-identical). Each takes
the already-bound `AsyncAnthropicBedrock` / `httpx.AsyncClient` as an injected param, so
nothing references a patched global — the boot tests' patch targets in container.py
(`get_anthropic_client`, `boto3`) are unaffected. The embedder factory (which calls
`boto3.client` directly) intentionally STAYS in container.py for that reason.
"""

from __future__ import annotations

import httpx
from anthropic import AsyncAnthropicBedrock
from dishka import Provider

from app.domain.ports.autofill_protocol import AutofillProtocol
from app.domain.ports.entity_type_classifier_protocol import EntityTypeClassifierProtocol
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.services.chat_provider_router import ChatProviderRouter
from app.infrastructure.llm.autofill_adapter import AnthropicAutofiller
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter
from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier
from app.infrastructure.llm.openrouter_chat_adapter import OpenRouterChatAdapter
from app.infrastructure.llm.segmentation_adapter import AnthropicSegmenter
from app.settings import get_settings


def _provide_autofiller(client: AsyncAnthropicBedrock) -> AutofillProtocol:
    """AnthropicAutofiller backed by AWS Bedrock — implements AutofillProtocol."""
    return AnthropicAutofiller(client=client, model_id=get_settings().bedrock_model_id)


def _provide_entity_type_classifier(client: AsyncAnthropicBedrock) -> EntityTypeClassifierProtocol:
    """AnthropicEntityTypeClassifier backed by AWS Bedrock — implements EntityTypeClassifierProtocol.

    Uses the SAME configured Bedrock model as autofill (settings.bedrock_model_id).
    The hardcoded legacy haiku model 404s ("marked by provider as Legacy … upgrade
    to an active model"); the configured model is the active, invokable one. This is
    one batched call per document, so the larger model's cost/latency is fine.
    """
    return AnthropicEntityTypeClassifier(client=client, model_id=get_settings().bedrock_model_id)


def _provide_segmenter(client: AsyncAnthropicBedrock) -> SegmenterProtocol:
    """AnthropicSegmenter backed by AWS Bedrock — implements SegmenterProtocol."""
    return AnthropicSegmenter(client=client, model_id=get_settings().bedrock_model_id)


def _provide_bedrock_chat_adapter(client: AsyncAnthropicBedrock) -> BedrockChatAdapter:
    """BedrockChatAdapter — one ChatProvider implementation (Phase 22, D-22).

    Reuses the shared AsyncAnthropicBedrock client (already bound above as a
    singleton). Bound to its own concrete type (not the ChatProvider Protocol)
    because OpenRouterChatAdapter implements the SAME Protocol structurally —
    the chat orchestration layer (22-06) selects between them by the picked
    model's registry transport, not via a single Protocol-keyed binding.
    """
    settings = get_settings()
    return BedrockChatAdapter(
        client=client,
        inactivity_timeout_seconds=settings.CHAT_INACTIVITY_TIMEOUT_SECONDS,
    )


def _provide_openrouter_chat_adapter(http_client: httpx.AsyncClient) -> OpenRouterChatAdapter:
    """OpenRouterChatAdapter — the second ChatProvider implementation (Phase 22, D-07, D-22).

    Reuses the shared httpx.AsyncClient singleton. api_key is read once here via
    settings.openrouter_api_key (T-22-06, server-side only) — an empty key means
    every .stream() call raises fail-closed (D-07) until OPENROUTER_API_KEY is
    configured for this environment.
    """
    settings = get_settings()
    return OpenRouterChatAdapter(
        api_key=settings.openrouter_api_key,
        base_url=settings.OPENROUTER_BASE_URL,
        http_client=http_client,
        inactivity_timeout_seconds=settings.CHAT_INACTIVITY_TIMEOUT_SECONDS,
    )


def _provide_chat_provider_router(
    bedrock: BedrockChatAdapter,
    openrouter: OpenRouterChatAdapter,
) -> ChatProviderRouter:
    """ChatProviderRouter — routes a picked model_id to its registry transport (Phase 22-06)."""
    return ChatProviderRouter(bedrock=bedrock, openrouter=openrouter)


def register(provider: Provider) -> None:
    """Register the LLM-adapter group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    "LLM adapters" + "Chat spine — ChatProvider implementations" blocks they replaced.
    """
    # Document-processing LLM adapters (Bedrock).
    provider.provide(_provide_segmenter, provides=SegmenterProtocol)
    provider.provide(_provide_autofiller, provides=AutofillProtocol)
    # Entity-type classifier: ONE call classifies all candidate regions of a document.
    provider.provide(_provide_entity_type_classifier, provides=EntityTypeClassifierProtocol)

    # Chat transport — both adapters structurally implement ChatProvider but are bound to
    # their own concrete types; the router selects between them by the picked model's transport.
    provider.provide(_provide_bedrock_chat_adapter, provides=BedrockChatAdapter)
    provider.provide(_provide_openrouter_chat_adapter, provides=OpenRouterChatAdapter)
    provider.provide(_provide_chat_provider_router, provides=ChatProviderRouter)
