"""LookupEntityExecutor -- thin ToolExecutor wrapper over find_candidates()/find_by_id() (Phase 36, TOOL-01).

The FIRST real, production `ToolExecutor` (Phase 34 built the mechanics
against a tenant-agnostic `EchoToolExecutor` stub). Zero new backend: this
executor calls ONLY existing repository methods --
`EntityInstanceRepository.find_by_id`, `EntityResolutionRepository.find_candidates`
(mirrors `ResolveEntityCandidatesUseCase`'s exact call shape), and
`EntityTypeRepository.list_active` -- and never raises past the
`ToolExecutor.execute()` boundary (port contract).

Tenant isolation (T-36-01, D-18 pattern): `find_by_id`'s returned row's own
`.importer_id` is compared against the caller-supplied `importer_id`. A
mismatch is treated identically to "not found" -- it falls through to the
name-search path (scoped to the CALLER's importer_id only) and never returns
the other tenant's instance, identifiers, or aliases, and never surfaces a
tenant-mismatch error that would reveal the id exists.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import structlog

from app.application.use_cases.run_chat_turn_tool_loop import cap_tool_output
from app.domain.ports.tool_executor import ToolExecutionResult
from app.infrastructure.tools.envelope import build_citation, citation_to_dict, truncate_field

if TYPE_CHECKING:
    from app.domain.ports.embedding_protocol import EmbeddingProtocol
    from app.domain.ports.entity_instance_repository import EntityInstanceRepository
    from app.domain.ports.entity_resolution_repository import EntityResolutionRepository
    from app.domain.ports.entity_type_repository import EntityTypeRepository

logger = structlog.get_logger(__name__)

LOOKUP_ENTITY_TOOL_NAME = "lookup_entity"

# top_n cap shared by both the id-hit (self + candidates) and name-search
# (merged-across-entity-types) paths -- "Top-5 results" per 36-CONTEXT.md.
_TOP_N = 5

_MATCH_TYPE_ID_EXACT = "id_exact"
_SCORE_ID_EXACT = 1.0

_EMPTY_NAME_OR_ID_TEXT = "I need a name or an entity id to look up -- please provide one."
_EXECUTION_ERROR_TEXT = "I couldn't look up that entity right now. Please try again."

_DESCRIPTION = (
    "Look up a known entity (for example a company, person, or other tracked record) by its "
    "display name or by its entity_instance id, and return grounded, cited candidate matches "
    "from this importer's own resolved entity data. Use this when the user references an "
    "entity by name or asks who/what something is and you need real, tenant-scoped data "
    "instead of guessing."
)

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name_or_id"],
    "additionalProperties": False,
    "properties": {
        "name_or_id": {
            "type": "string",
            "maxLength": 200,
            "description": "The entity's display name (e.g. a company name) or its entity_instance id.",
        },
    },
}


def build_lookup_entity_tool() -> dict[str, Any]:
    """Build the lookup_entity tool dict (Bedrock-valid: root type:object, additionalProperties:false).

    Mirrors chat_tools.py's schema conventions (maxLength defense-in-depth on
    free-text input, per 36-CONTEXT.md).
    """
    return {
        "name": LOOKUP_ENTITY_TOOL_NAME,
        "description": _DESCRIPTION,
        "input_schema": _INPUT_SCHEMA,
    }


@dataclass(frozen=True)
class EntityLookupResult:
    """One entity match surfaced by the lookup -- either the id-hit itself or a candidate.

    `display_name` is run through `truncate_field` before being stored here
    (defense-in-depth against a pathological confirmed value, independent of
    the whole-envelope `cap_tool_output` cap applied later).
    """

    entity_instance_id: str
    display_name: str
    entity_type_id: str
    match_type: str
    score: float


class LookupEntityExecutor:
    """ToolExecutor implementation for `lookup_entity` -- thin wrapper, zero new backend.

    Collaborators (all existing ports, zero new repository methods):
        entity_instances: EntityInstanceRepository -- id-lookup path.
        resolution_repo: EntityResolutionRepository -- BlendedRAG find_candidates
            (SYNCHRONOUS despite doing I/O -- confirmed by its one existing
            caller, ResolveEntityCandidatesUseCase; never awaited here).
        entity_types: EntityTypeRepository -- drives the per-entity-type
            find_candidates loop on the name-search fallback path.
        embedder: EmbeddingProtocol -- embeds the raw name_or_id text for the
            name-search fallback's dense arm.
    """

    def __init__(
        self,
        *,
        entity_instances: EntityInstanceRepository,
        resolution_repo: EntityResolutionRepository,
        entity_types: EntityTypeRepository,
        embedder: EmbeddingProtocol,
    ) -> None:
        self._entity_instances = entity_instances
        self._resolution_repo = resolution_repo
        self._entity_types = entity_types
        self._embedder = embedder

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        """Execute `lookup_entity` -- never raises past this boundary (port contract)."""
        del name  # unused -- this class serves exactly one tool

        name_or_id = arguments.get("name_or_id")
        if not isinstance(name_or_id, str) or not name_or_id.strip():
            return ToolExecutionResult(tool_use_id="", content=_EMPTY_NAME_OR_ID_TEXT, is_error=True)

        try:
            results = await self._lookup_by_id(name_or_id=name_or_id, importer_id=importer_id)
            if results is None:
                results = await self._search_by_name(name_or_id=name_or_id, importer_id=importer_id)
        except Exception as exc:  # an executor MUST NEVER raise out of the loop (port contract)
            logger.warning("lookup_entity_execution_failed", name_or_id=name_or_id, error=str(exc))
            return ToolExecutionResult(tool_use_id="", content=_EXECUTION_ERROR_TEXT, is_error=True)

        envelope = {
            "results": [dataclasses.asdict(result) for result in results],
            "citations": [citation_to_dict(build_citation("entity", result.entity_instance_id)) for result in results],
        }
        content = cap_tool_output(json.dumps(envelope, separators=(",", ":")))
        return ToolExecutionResult(tool_use_id="", content=content, is_error=False)

    async def _lookup_by_id(self, *, name_or_id: str, importer_id: str) -> list[EntityLookupResult] | None:
        """Resolve `name_or_id` as an entity_instance id, or return None to fall back to name search.

        Returns None (never an error) on: not found, cross-tenant mismatch
        (T-36-01), or an inactive instance -- all three degrade identically to
        "id lookup didn't apply, try the name search path instead".
        """
        instance = await self._entity_instances.find_by_id(name_or_id)
        if instance is None or instance.importer_id != importer_id or not instance.is_active:
            return None

        candidates = self._resolution_repo.find_candidates(
            display_name=instance.display_name,
            identifiers=instance.identifiers,
            entity_type_id=instance.entity_type_id,
            importer_id=importer_id,
            embedding=instance.embedding,
            top_n=_TOP_N,
        )

        results = [
            EntityLookupResult(
                entity_instance_id=instance.id,
                display_name=truncate_field(instance.display_name),
                entity_type_id=instance.entity_type_id,
                match_type=_MATCH_TYPE_ID_EXACT,
                score=_SCORE_ID_EXACT,
            )
        ]
        seen_ids = {instance.id}
        for candidate in candidates:
            if candidate.entity_instance_id in seen_ids:
                continue
            seen_ids.add(candidate.entity_instance_id)
            results.append(
                EntityLookupResult(
                    entity_instance_id=candidate.entity_instance_id,
                    display_name=truncate_field(candidate.display_name),
                    # find_candidates is called with a single entity_type_id and both its
                    # underlying RPCs filter on it -- every candidate it returns shares this type.
                    entity_type_id=instance.entity_type_id,
                    match_type=candidate.match_type,
                    score=candidate.rrf_score,
                )
            )
            if len(results) >= _TOP_N:
                break
        return results

    async def _search_by_name(self, *, name_or_id: str, importer_id: str) -> list[EntityLookupResult]:
        """Search across every active entity type for this importer by display name.

        Used both when `name_or_id` isn't a resolvable id (Test 2) and when it
        resolves to another tenant's instance (Test 3, T-36-01) -- in both
        cases the raw `name_or_id` string is the search term, scoped only to
        the CALLER's importer_id.
        """
        embedding = list(await self._embedder.embed(text=name_or_id))
        entity_types = await self._entity_types.list_active(importer_id)

        merged: dict[str, EntityLookupResult] = {}
        for entity_type in entity_types:
            candidates = self._resolution_repo.find_candidates(
                display_name=name_or_id,
                identifiers={},
                entity_type_id=entity_type.id,
                importer_id=importer_id,
                embedding=embedding,
                top_n=_TOP_N,
            )
            for candidate in candidates:
                existing = merged.get(candidate.entity_instance_id)
                if existing is not None and existing.score >= candidate.rrf_score:
                    continue
                merged[candidate.entity_instance_id] = EntityLookupResult(
                    entity_instance_id=candidate.entity_instance_id,
                    display_name=truncate_field(candidate.display_name),
                    entity_type_id=entity_type.id,
                    match_type=candidate.match_type,
                    score=candidate.rrf_score,
                )

        ranked = sorted(merged.values(), key=lambda result: result.score, reverse=True)
        return ranked[:_TOP_N]


__all__ = [
    "LOOKUP_ENTITY_TOOL_NAME",
    "EntityLookupResult",
    "LookupEntityExecutor",
    "build_lookup_entity_tool",
]
