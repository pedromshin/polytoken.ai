"""Tests for ChatProviderRouter — model_id -> transport -> ChatProvider selection (Phase 22-06).

Verifies:
- a bedrock registry model id resolves to the injected BedrockChatAdapter instance
- an openrouter registry model id resolves to the injected OpenRouterChatAdapter instance
- a browser-locus registry model id raises UnsupportedChatTransportError (server never
  executes browser models — 22-10)
- an id not in CHAT_MODEL_REGISTRY raises ChatModelNotFoundError

This file lives at the FLAT tests/ level (not tests/unit/) to match this repo's
established convention for domain-service tests (test_chat_model_registry.py,
test_cost_circuit_breaker.py) — see 22-02-SUMMARY.md / 22-04-SUMMARY.md deviations,
repeated here for the same reason (chat_provider_router.py is a domain service).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.domain.services.chat_provider_router import (
    ChatModelNotFoundError,
    ChatProviderRouter,
    UnsupportedChatTransportError,
)
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter
from app.infrastructure.llm.openrouter_chat_adapter import OpenRouterChatAdapter

# Real curated registry ids (chat_model_registry.CHAT_MODEL_REGISTRY, 22-02).
_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
_OPENROUTER_MODEL_ID = "deepseek/deepseek-chat"
_BROWSER_MODEL_ID = "webllm-gemma-3-4b"


@pytest.fixture
def bedrock_adapter() -> BedrockChatAdapter:
    return BedrockChatAdapter(client=MagicMock())


@pytest.fixture
def openrouter_adapter() -> OpenRouterChatAdapter:
    return OpenRouterChatAdapter(api_key="test-key", base_url="https://example.invalid", http_client=MagicMock())


@pytest.fixture
def router(bedrock_adapter: BedrockChatAdapter, openrouter_adapter: OpenRouterChatAdapter) -> ChatProviderRouter:
    return ChatProviderRouter(bedrock=bedrock_adapter, openrouter=openrouter_adapter)


@pytest.mark.unit
def test_bedrock_model_id_selects_bedrock_adapter(
    router: ChatProviderRouter, bedrock_adapter: BedrockChatAdapter
) -> None:
    assert router.select(_BEDROCK_MODEL_ID) is bedrock_adapter


@pytest.mark.unit
def test_openrouter_model_id_selects_openrouter_adapter(
    router: ChatProviderRouter, openrouter_adapter: OpenRouterChatAdapter
) -> None:
    assert router.select(_OPENROUTER_MODEL_ID) is openrouter_adapter


@pytest.mark.unit
def test_browser_model_id_raises_unsupported_transport(router: ChatProviderRouter) -> None:
    with pytest.raises(UnsupportedChatTransportError):
        router.select(_BROWSER_MODEL_ID)


@pytest.mark.unit
def test_unknown_model_id_raises_not_found(router: ChatProviderRouter) -> None:
    with pytest.raises(ChatModelNotFoundError):
        router.select("not-a-real-model")
