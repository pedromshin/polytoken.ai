"""ResolveIngestEntitiesUseCase — ingest-time entity resolution + suggested edges (AI-03).

Wires the vision's "AI establishes relationships automatically" into the inbound
pipeline: after an email + its components persist, resolve the email's classified
entity components against the existing identity corpus and PROPOSE, at the
least-trusted (suggestion) tier ONLY:

  1. component_entity_candidate_links rows (was_selected=False) — pending
     duplicate-resolution suggestions. These are the SAME provenance rows the
     human review queue (EN-02, entities.reviewQueue) already consumes, so
     nothing here lands as canon: a suggestion becomes an identity assignment
     only when a human confirms it through the existing curation write path.

  2. suggested-tier (AMBIGUOUS) knowledge_node_edges from a deterministic
     per-sender knowledge node to each resolved candidate entity instance —
     "this sender is possibly associated with these known entities." AMBIGUOUS
     is the fail-toward-least-trust tier; only PromoteEdgeUseCase (a human gate)
     ever flips a suggestion edge to EXTRACTED.

SUGGEST-ONLY (D-05 / TIER ladder): this use case never writes a merge, never
sets was_selected=True, never writes an EXTRACTED-tier node or edge, and never
promotes anything. Every artifact it emits is a suggestion behind the existing
human promotion gate.

IDEMPOTENT UNDER REPROCESS (REG-1/RES-1 discipline):
  - Candidate links upsert on the table's UNIQUE(component_id, entity_instance_id)
    key, so re-resolving the same component never stacks a duplicate row.
  - The sender knowledge node is keyed DETERMINISTICALLY off
    (importer_id, normalized sender address) via uuid5 — a stable scope_ref_id
    that re-ingest reuses rather than duplicating. Its suggested edges are
    superseded deactivate-then-insert (the KnowledgeSynthesizerService idiom) on
    every run, so a reprocess re-derives exactly one fresh suggestion set instead
    of accumulating copies.

Architecture contract: imports ONLY domain ports + entities + stdlib. No
infrastructure imports permitted (verified by lint-imports).
"""

from __future__ import annotations

import asyncio
import uuid

import structlog

from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_resolution_repository import EntityResolutionRepository
from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)

_SOURCE = "ingest_resolution"

# Suggestion tiers — never EXTRACTED. AMBIGUOUS is the fail-toward-least-trust
# tier used for weak, unreviewed ingest-time associations (mirrors
# KnowledgeSynthesizerService's 'possibly_about' AMBIGUOUS edges). The sender
# node itself is INFERRED (a synthesis-derived node, not a human-confirmed one).
_TIER_NODE = "INFERRED"
_TIER_EDGE = "AMBIGUOUS"

_SCOPE_SENDER = "sender"
_SCOPE_REF_TYPE_SENDER = "sender_profile"
_TARGET_TYPE_ENTITY_INSTANCE = "entity_instance"
_RELATION_POSSIBLY_ABOUT = "possibly_about"

# display_name passed to the resolver is capped — content_text on a region can
# be a whole page of OCR text; only the leading span is a useful match key.
_NAME_MAX = 200

# Top-N candidates surfaced per component (mirrors ResolveEntityCandidatesUseCase's
# default; suggestions are cheap and human-gated, but an unbounded fan-out is not).
_TOP_N = 5

# Namespace mirroring PromoteEntityOnConfirmUseCase's deterministic instance-id
# derivation, so we can recognise (and skip) a link to a component's OWN future
# identity on reprocess of an already-promoted email.
_PROMOTE_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

# Stable namespace for the per-sender knowledge node's scope_ref_id.
_SENDER_NS = uuid.NAMESPACE_URL


def _component_instance_id(component_id: str) -> str:
    """Deterministic entity-instance id a component would promote to (see promote)."""
    return str(uuid.uuid5(_PROMOTE_NS, component_id))


def _sender_scope_ref_id(importer_id: str, sender_address: str) -> str:
    """Deterministic, importer-scoped scope_ref_id for a sender knowledge node.

    Normalised (lowercased/stripped) so the SAME sender across reprocesses maps
    to the SAME node — the idempotency anchor for the sender's suggested edges.
    """
    normalized = sender_address.strip().lower()
    return str(uuid.uuid5(_SENDER_NS, f"sender/{importer_id}/{normalized}"))


class ResolveIngestEntitiesUseCase:
    """Ingest-time resolution: pending candidate links + suggested sender edges (AI-03).

    Collaborators (all domain ports):
        components: ComponentRepository — load the email's classified entity regions.
        entity_instances: EntityInstanceRepository — upsert pending candidate links.
        resolution_repo: EntityResolutionRepository — BlendedRAG candidate surfacing.
        knowledge: KnowledgeGraphRepository — sender node + suggested-tier edges.

    execute() may RAISE — the ingest pipeline wraps this stage in the ST-04
    isolation contract (records a stage-prefixed 'entity_resolution: ...' failure
    into the email's failures list; never hard-fails ingestion). Internally it is
    otherwise best-effort per component so one bad region cannot starve siblings.
    """

    def __init__(
        self,
        *,
        components: ComponentRepository,
        entity_instances: EntityInstanceRepository,
        resolution_repo: EntityResolutionRepository,
        knowledge: KnowledgeGraphRepository,
    ) -> None:
        self._components = components
        self._entity_instances = entity_instances
        self._resolution_repo = resolution_repo
        self._knowledge = knowledge

    async def execute(
        self,
        *,
        email_id: str,
        importer_id: str,
        sender_address: str,
        sender_name: str | None = None,
    ) -> dict[str, int]:
        """Resolve the email's entity components; propose links + suggested edges.

        Returns a summary dict: {candidate_links, suggested_edges, components}.
        """
        log = logger.bind(email_id=email_id, importer_id=importer_id)
        log.info("resolve_ingest_entities_start")

        all_components = await self._components.find_by_email_id(email_id)
        # "The email's entities": regions the classifier already tagged with an
        # entity type (role='entity'). Unclassified regions carry no type to
        # resolve against and are skipped. Exclude human-rejected and superseded
        # regions (same live-region predicate as autofill_fields, D-16) so a
        # reprocess never re-proposes a suggestion a human already dismissed or
        # that a newer generation replaced.
        entity_components = [
            c
            for c in all_components
            if c.entity_type_id is not None
            and c.role == "entity"
            and c.extraction_status not in ("rejected", "superseded")
        ]

        # Deterministic, reprocess-stable sender node — the idempotency anchor
        # for the suggested edges below. Created once, reused thereafter.
        sender_node_id = await self._ensure_sender_node(
            importer_id=importer_id,
            sender_address=sender_address,
            sender_name=sender_name,
        )

        candidate_links = 0
        suggested_edges = 0
        # Dedup suggested sender->instance edges. PRE-SEEDED with the sender
        # node's ALREADY-ACTIVE edge targets (canon AND prior suggestions), so a
        # re-derive is idempotent-by-skip: we never re-insert an edge that
        # exists, and — critically — we NEVER deactivate the sender's edges.
        # The previous deactivate-then-insert idiom was tier-blind and
        # sender-global: it silently demoted human-promoted EXTRACTED edges
        # (KG-2 class) and wiped other emails' pending suggestions on every new
        # email from the same sender. Insert-if-absent touches neither.
        linked_instance_ids: set[str] = set()
        if sender_node_id is not None:
            try:
                for edge in await self._knowledge.find_active_edges_for_node(sender_node_id):
                    target = edge.get("target_ref_id")
                    if target is not None:
                        linked_instance_ids.add(str(target))
            except Exception:
                log.warning("resolve_ingest_existing_edges_failed", node_id=sender_node_id, exc_info=True)

        for component in entity_components:
            entity_type_id = component.entity_type_id
            assert entity_type_id is not None  # narrowed by the entity_components filter
            display_name = (component.content_text or "").strip()[:_NAME_MAX] or component.id
            embedding: list[float] | None = list(component.embedding) if component.embedding else None

            # EntityResolutionRepository.find_candidates is a SYNC def whose two
            # RPC arms each block on a network round-trip (WR-06). It was previously
            # called inline without await, so it ran the blocking work directly on
            # the shared uvicorn event loop. Offload it to a worker thread AND
            # actually await it so one slow resolution can't freeze the loop.
            # Pass the args straight to to_thread (it forwards *args/**kwargs) so
            # every loop-varying value is bound eagerly at call time — no lambda
            # late-binding hazard (ruff B023 / the A1 warning), and no wrapper.
            candidates = await asyncio.to_thread(
                self._resolution_repo.find_candidates,
                display_name=display_name,
                identifiers={},
                entity_type_id=entity_type_id,
                importer_id=importer_id,
                embedding=embedding,
                top_n=_TOP_N,
            )

            own_instance_id = _component_instance_id(component.id)
            for candidate in candidates:
                # On reprocess of an already-promoted email the resolver
                # lexically hits the component's OWN identity — never a
                # duplicate suggestion (mirrors promote's self-skip, D-18).
                if candidate.entity_instance_id == own_instance_id:
                    continue

                # (1) Pending candidate link — was_selected=False. Upserts on the
                # UNIQUE(component_id, entity_instance_id) key (idempotent).
                try:
                    await self._entity_instances.record_candidate_link(
                        component_id=component.id,
                        entity_instance_id=candidate.entity_instance_id,
                        entity_type_id=entity_type_id,
                        match_type=candidate.match_type,
                        similarity_score=candidate.rrf_score,
                        was_selected=False,
                    )
                    candidate_links += 1
                except Exception:
                    log.warning(
                        "resolve_ingest_candidate_link_failed",
                        component_id=component.id,
                        entity_instance_id=candidate.entity_instance_id,
                        exc_info=True,
                    )

                # (2) Suggested-tier sender->candidate edge (AMBIGUOUS), deduped.
                if sender_node_id is not None and candidate.entity_instance_id not in linked_instance_ids:
                    linked_instance_ids.add(candidate.entity_instance_id)
                    try:
                        await self._knowledge.insert_edge(
                            source_node_id=sender_node_id,
                            target_ref_id=candidate.entity_instance_id,
                            target_ref_type=_TARGET_TYPE_ENTITY_INSTANCE,
                            relation_type=_RELATION_POSSIBLY_ABOUT,
                            tier=_TIER_EDGE,
                            source=_SOURCE,
                            provenance=None,
                        )
                        suggested_edges += 1
                    except Exception:
                        log.warning(
                            "resolve_ingest_suggested_edge_failed",
                            entity_instance_id=candidate.entity_instance_id,
                            exc_info=True,
                        )

        log.info(
            "resolve_ingest_entities_done",
            components=len(entity_components),
            candidate_links=candidate_links,
            suggested_edges=suggested_edges,
        )
        return {
            "candidate_links": candidate_links,
            "suggested_edges": suggested_edges,
            "components": len(entity_components),
        }

    async def _ensure_sender_node(
        self,
        *,
        importer_id: str,
        sender_address: str,
        sender_name: str | None,
    ) -> str | None:
        """Upsert the deterministic per-sender knowledge node.

        Returns the node id, or None when the sender address is empty (no anchor
        to key on). The node is reused across reprocesses (deterministic
        scope_ref_id). Edge idempotency is handled by the caller via
        insert-if-absent against the node's active edges — this method NEVER
        deactivates edges, so human-promoted canon edges on the sender node are
        never disturbed.
        """
        address = sender_address.strip()
        if not address:
            return None

        scope_ref_id = _sender_scope_ref_id(importer_id, address)
        title = (sender_name or "").strip() or address
        return await self._knowledge.upsert_node(
            importer_id=importer_id,
            title=title,
            content=address,
            scope=_SCOPE_SENDER,
            scope_ref_id=scope_ref_id,
            scope_ref_type=_SCOPE_REF_TYPE_SENDER,
            source=_SOURCE,
            tier=_TIER_NODE,
        )


__all__ = ["ResolveIngestEntitiesUseCase"]
