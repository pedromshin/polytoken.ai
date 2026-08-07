"""Supabase repository providers — extracted from container.py (Track 2 decomposition).

Owns the data-access adapter bindings: the plain `Supabase*Repository -> <Port>` class
bindings plus the few `client: Client`-only factories (retrieval, correction/event writers,
and the four chat-spine persistence repos). Every new feature that adds a repository binding
touches THIS module now instead of the 1400-line container — the whole point of the split.

Factory bodies are moved verbatim from container.py (behavior byte-identical). `register`
performs the group's dishka bindings; container.py's composition root just calls it. All
factories take the already-bound `Client` as an injected param — nothing references a patched
global, so the boot tests' patch targets in container.py are unaffected.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.autofill_retrieval_event_repository import AutofillRetrievalEventRepository
from app.domain.ports.chat_context_edge_repository import ChatContextEdgeRepository
from app.domain.ports.chat_repositories import (
    ChatConversationRepository,
    ChatMessageRepository,
    ChatRunRepository,
)
from app.domain.ports.chat_turn_usage_repository import ChatTurnUsageRepository
from app.domain.ports.chat_widget_interaction_repository import ChatWidgetInteractionRepository
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_correction_repository import EntityTypeCorrectionRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.retrieval_port import RetrievalPort
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.domain.ports.tier_resolver import UserTierResolver
from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
from app.infrastructure.supabase.autofill_retrieval_event_repository import (
    SupabaseAutofillRetrievalEventRepository,
)
from app.infrastructure.supabase.chat_context_edge_repository import SupabaseChatContextEdgeRepository
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository
from app.infrastructure.supabase.entity_type_correction_repository import (
    SupabaseEntityTypeCorrectionRepository,
)
from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository
from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
from app.infrastructure.supabase.retrieval_repository import SupabaseRetrievalRepository
from app.infrastructure.supabase.source_ledger_repository import SupabaseSourceLedgerRepository
from app.infrastructure.supabase.supabase_chat_conversation_repository import (
    SupabaseChatConversationRepository,
)
from app.infrastructure.supabase.supabase_chat_message_repository import SupabaseChatMessageRepository
from app.infrastructure.supabase.supabase_chat_run_repository import SupabaseChatRunRepository
from app.infrastructure.supabase.supabase_chat_widget_interaction_repository import (
    SupabaseChatWidgetInteractionRepository,
)
from app.infrastructure.supabase.tier_resolver import SupabaseTierResolver


def _provide_retrieval(client: Client) -> RetrievalPort:
    """SupabaseRetrievalRepository — hybrid vector+trigram retrieval (RRF k=60, D-15).

    Both sub-queries filter by importer_id for cross-tenant isolation (T-04-28).
    """
    return SupabaseRetrievalRepository(client=client)


def _provide_entity_type_correction_repository(client: Client) -> EntityTypeCorrectionRepository:
    """SupabaseEntityTypeCorrectionRepository (Phase 57-01, LEARN-01).

    Mirrors _provide_retrieval: the constructor's ``client`` param is typed
    ``Any`` (matching retrieval_repository.py's exact style per the plan),
    which dishka cannot auto-inject directly — a factory typed against the
    concrete ``Client`` resolves it explicitly.
    """
    return SupabaseEntityTypeCorrectionRepository(client=client)


def _provide_autofill_retrieval_event_repository(client: Client) -> AutofillRetrievalEventRepository:
    """SupabaseAutofillRetrievalEventRepository — best-effort instrumentation writer (RECALL-02, 31-02)."""
    return SupabaseAutofillRetrievalEventRepository(client=client)


def _provide_chat_message_repository(client: Client) -> ChatMessageRepository:
    """SupabaseChatMessageRepository — chat_messages adapter (FOUND-1, D-16, D-18, Phase 22-06)."""
    return SupabaseChatMessageRepository(client=client)


def _provide_chat_run_repository(client: Client) -> ChatRunRepository:
    """SupabaseChatRunRepository — chat_runs/chat_run_events adapter (SEAM-03/04, D-27, Phase 22-06)."""
    return SupabaseChatRunRepository(client=client)


def _provide_chat_conversation_repository(client: Client) -> ChatConversationRepository:
    """SupabaseChatConversationRepository — the turn loop's chat_conversations write (D-10/D-12)."""
    return SupabaseChatConversationRepository(client=client)


def _provide_chat_widget_interaction_repository(client: Client) -> ChatWidgetInteractionRepository:
    """SupabaseChatWidgetInteractionRepository — chat_widget_interactions adapter (Phase 24-01/24-02)."""
    return SupabaseChatWidgetInteractionRepository(client=client)


def _provide_chat_turn_usage_repository(client: Client) -> ChatTurnUsageRepository:
    """SupabaseChatMessageRepository doubling as the monthlyChatTurns meter (vLAUNCH W5-1).

    The count lives on the chat_messages adapter (it is a chat_messages
    read), but is bound under its OWN port so RunChatTurn's cap gate takes
    exactly the one method it needs.
    """
    return SupabaseChatMessageRepository(client=client)


def _provide_user_tier_resolver(client: Client) -> UserTierResolver:
    """SupabaseTierResolver's user-id read for the chat-turn cap gate (vLAUNCH W5-1).

    The same adapter class the ingest budget guard uses (subscriptions tier +
    active/trialing status honouring), bound under the narrower
    UserTierResolver port — the chat path already owns the conversation
    owner's user id and skips the importer pivot.
    """
    return SupabaseTierResolver(client=client)


def register(provider: Provider) -> None:
    """Register the Supabase repository group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    "Repository adapters" + chat-spine persistence blocks they replaced.
    """
    # Plain adapter → port class bindings (dishka auto-injects the Client).
    provider.provide(SupabaseEmailRepository, provides=EmailRepository)
    provider.provide(SupabaseAttachmentRepository, provides=AttachmentRepository)
    provider.provide(SupabaseComponentRepository, provides=ComponentRepository)
    provider.provide(SupabaseEntityTypeRepository, provides=EntityTypeRepository)
    provider.provide(SupabaseExtractionRepository, provides=ExtractionRepository)
    # Entity identity repository (D-02/D-09/D-10/D-11) — bound to port Protocol.
    provider.provide(SupabaseEntityInstanceRepository, provides=EntityInstanceRepository)
    # chat_source_ledger auto-collect write adapter (Phase 56-02, RCNV-01).
    provider.provide(SupabaseSourceLedgerRepository, provides=SourceLedgerRepository)
    # chat_context_edges read adapter (Phase 56-04, RCNV-04) — linked-context pipeline read.
    provider.provide(SupabaseChatContextEdgeRepository, provides=ChatContextEdgeRepository)

    # Factory bindings (constructor's client is typed loosely, so a typed factory resolves it).
    # Retrieval-outcome instrumentation writer (RECALL-02, 31-02) — best-effort.
    provider.provide(_provide_autofill_retrieval_event_repository, provides=AutofillRetrievalEventRepository)
    # entity_type_corrections capture + trgm retrieval (Phase 57-01, LEARN-01) — best-effort.
    provider.provide(_provide_entity_type_correction_repository, provides=EntityTypeCorrectionRepository)
    # Hybrid vector+trgm retrieval (D-15 learning flywheel).
    provider.provide(_provide_retrieval, provides=RetrievalPort)

    # Chat-spine persistence repos (Phase 22-06 / 24-01).
    provider.provide(_provide_chat_message_repository, provides=ChatMessageRepository)
    provider.provide(_provide_chat_run_repository, provides=ChatRunRepository)
    provider.provide(_provide_chat_conversation_repository, provides=ChatConversationRepository)
    provider.provide(_provide_chat_widget_interaction_repository, provides=ChatWidgetInteractionRepository)
    # monthlyChatTurns cap gate reads (vLAUNCH W5-1) — meter count + user tier.
    provider.provide(_provide_chat_turn_usage_repository, provides=ChatTurnUsageRepository)
    provider.provide(_provide_user_tier_resolver, provides=UserTierResolver)
