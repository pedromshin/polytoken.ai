"""ChatProviderRouter — model_id -> transport -> ChatProvider selection (Phase 22-06).

Selects between the two DI-injected ChatProvider implementations (BedrockChatAdapter,
OpenRouterChatAdapter — both from 22-02) purely by the picked model's curated
registry transport (chat_model_registry.CHAT_MODEL_REGISTRY). A browser-locus
model (transport='browser') raises: the server never executes those — the
browser client does (22-10 in-browser WebLLM prototype).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.domain.services.chat_model_registry import get_model

if TYPE_CHECKING:
    from app.domain.ports.chat_provider import ChatProvider


class ChatModelNotFoundError(Exception):
    """Raised when model_id is not present in the curated CHAT_MODEL_REGISTRY."""

    def __init__(self, model_id: str) -> None:
        super().__init__(f"Unknown chat model id: {model_id!r}")
        self.model_id = model_id


class UnsupportedChatTransportError(Exception):
    """Raised when a model's transport cannot be executed server-side (e.g. browser locus)."""

    def __init__(self, model_id: str, transport: str) -> None:
        super().__init__(
            f"Model {model_id!r} has transport={transport!r} — the server does not execute "
            "browser-locus models; the browser client does (22-10)."
        )
        self.model_id = model_id
        self.transport = transport


class ChatProviderRouter:
    """Routes a picked model_id to the correct injected ChatProvider implementation.

    Both bedrock/openrouter are accepted as constructor-injected ChatProvider
    instances (DI-wired in container.py) so this router stays free of any
    infrastructure import — it only ever consults the domain registry.
    """

    def __init__(self, *, bedrock: ChatProvider, openrouter: ChatProvider) -> None:
        self._bedrock = bedrock
        self._openrouter = openrouter

    def select(self, model_id: str) -> ChatProvider:
        """Return the ChatProvider implementation for model_id's registry transport.

        Raises:
            ChatModelNotFoundError: model_id is not in the curated registry.
            UnsupportedChatTransportError: model_id resolves to a transport the
                server cannot execute (transport='browser').
        """
        model = get_model(model_id)
        if model is None:
            raise ChatModelNotFoundError(model_id)
        if model.transport == "bedrock":
            return self._bedrock
        if model.transport == "openrouter":
            return self._openrouter
        raise UnsupportedChatTransportError(model_id, model.transport)
