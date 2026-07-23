"""Human curation loop use cases — D-20.

ConfirmMergeUseCase: human confirms a merge suggestion; records was_selected=True
    on the candidate link (D-09 audit trail) and appends the target's display_name
    as an alias on the surviving identity (D-11 flywheel).

RejectMergeUseCase: human rejects a merge suggestion; durably dismisses the
    candidate link so it is not re-surfaced. No identity linkage is written.

UnmergeEntityUseCase: human undoes a wrong confirmed merge; reactivates the
    previously-merged identity and clears its merge linkage (supersede-never-
    mutate — original rows are never deleted).

Architecture contract: imports ONLY domain ports. No infrastructure imports.
D-21: importer_id is derived from the loaded entity row, never a caller param.
T-10-20: cross-importer merges are rejected as ValueError → 404.
"""

from __future__ import annotations

import structlog

from app.domain.ports.entity_instance_repository import EntityInstanceRepository

logger = structlog.get_logger(__name__)


class ConfirmMergeUseCase:
    """Confirm a human-selected duplicate merge suggestion.

    Writes:
      1. select_candidate_link — sets was_selected=True on the provenance row (D-09).
      2. append_alias — adds target's display_name as alias on the subject (D-11).
      3. set_merge_state — marks the target inactive and linked into the subject.

    Raises ValueError (→ 404 at the endpoint) when:
      - Either id is not found in the repository.
      - The two identities belong to different importers (T-10-20, D-21).
    """

    def __init__(self, *, entity_instances: EntityInstanceRepository) -> None:
        self._entity_instances = entity_instances

    async def execute(
        self,
        entity_instance_id: str,
        target_id: str,
    ) -> dict[str, str]:
        """Confirm the merge of entity_instance_id and target_id.

        importer_id is derived from the loaded subject row (D-21).

        Returns:
            dict with entity_instance_id and target_id keys (echoed by endpoint).
        """
        log = logger.bind(entity_instance_id=entity_instance_id, target_id=target_id)
        log.info("confirm_merge_start")

        # RES-3 (a): a self-merge would set merged_into=own id and flip the row
        # inactive — the entity would vanish from the gallery merged into itself.
        # Reject before any load. Surfaced as 404 by the endpoint.
        if entity_instance_id == target_id:
            log.warning("confirm_merge_self_merge_rejected")
            raise ValueError(f"Cannot merge an entity into itself: {entity_instance_id}")

        # Load subject and validate existence
        subject = await self._entity_instances.find_by_id(entity_instance_id)
        if subject is None:
            log.warning("confirm_merge_subject_not_found")
            raise ValueError(f"Entity instance not found: {entity_instance_id}")

        # RES-3 (c): the survivor must be a live identity. An inactive subject is
        # itself already merged away; merging a target into it would bury the
        # target under a dead row (and enables A↔B mutual-merge cycles).
        if not subject.is_active:
            log.warning("confirm_merge_inactive_subject_rejected")
            raise ValueError(f"Cannot merge into an inactive entity: {entity_instance_id}")

        # D-21: importer_id always from the row
        importer_id = subject.importer_id
        log = log.bind(importer_id=importer_id)

        # Load target and validate existence
        target = await self._entity_instances.find_by_id(target_id)
        if target is None:
            log.warning("confirm_merge_target_not_found")
            raise ValueError(f"Entity instance not found: {target_id}")

        # T-10-20: cross-tenant merge is a security violation → treat as 404
        if target.importer_id != importer_id:
            log.warning(
                "confirm_merge_cross_importer",
                subject_importer=importer_id,
                target_importer=target.importer_id,
            )
            raise ValueError(f"Entity instance not found: {target_id}")

        # RES-3 (b/d): an inactive target is already merged elsewhere. Re-merging
        # it would silently overwrite its existing merged_into linkage and, via
        # the still-surfaced reverse suggestion, close an A↔B cycle that leaves
        # both entities inactive and unreachable. Reject.
        if not target.is_active:
            log.warning("confirm_merge_already_merged_target_rejected")
            raise ValueError(f"Cannot merge an already-merged entity: {target_id}")

        # D-09: record human decision — set was_selected=True on the candidate link
        await self._entity_instances.select_candidate_link(
            entity_instance_id=entity_instance_id,
            target_id=target_id,
        )

        # D-11: alias flywheel — append target's display_name as alias on survivor
        await self._entity_instances.append_alias(
            entity_instance_id=entity_instance_id,
            alias=target.display_name,
        )

        # Mark the merged identity inactive and link it into the survivor
        await self._entity_instances.set_merge_state(
            target_id,
            merged_into=entity_instance_id,
            is_active=False,
        )

        log.info("confirm_merge_done")
        return {"entity_instance_id": entity_instance_id, "target_id": target_id}


class RejectMergeUseCase:
    """Reject (dismiss) a merge suggestion durably.

    Calls dismiss_candidate_link so the suggestion is not re-surfaced.
    Does NOT link the identities — no alias write, no merge state change.

    Raises ValueError (→ 404) on missing or cross-importer ids (D-21, T-10-20).
    """

    def __init__(self, *, entity_instances: EntityInstanceRepository) -> None:
        self._entity_instances = entity_instances

    async def execute(
        self,
        entity_instance_id: str,
        target_id: str,
    ) -> dict[str, str]:
        """Reject the merge suggestion between entity_instance_id and target_id.

        importer_id derived from the loaded subject row (D-21).

        Returns:
            dict with entity_instance_id and target_id keys.
        """
        log = logger.bind(entity_instance_id=entity_instance_id, target_id=target_id)
        log.info("reject_merge_start")

        subject = await self._entity_instances.find_by_id(entity_instance_id)
        if subject is None:
            log.warning("reject_merge_subject_not_found")
            raise ValueError(f"Entity instance not found: {entity_instance_id}")

        # D-21: importer_id from the row
        importer_id = subject.importer_id
        log = log.bind(importer_id=importer_id)

        target = await self._entity_instances.find_by_id(target_id)
        if target is None:
            log.warning("reject_merge_target_not_found")
            raise ValueError(f"Entity instance not found: {target_id}")

        # T-10-20: cross-tenant reject → 404
        if target.importer_id != importer_id:
            log.warning(
                "reject_merge_cross_importer",
                subject_importer=importer_id,
                target_importer=target.importer_id,
            )
            raise ValueError(f"Entity instance not found: {target_id}")

        # Durably dismiss the suggestion so it is not re-surfaced (D-20)
        await self._entity_instances.dismiss_candidate_link(
            entity_instance_id=entity_instance_id,
            target_id=target_id,
        )

        log.info("reject_merge_done")
        return {"entity_instance_id": entity_instance_id, "target_id": target_id}


class UnmergeEntityUseCase:
    """Undo a confirmed merge — supersede-never-mutate (D-20).

    RES-2: the UI only ever exposes Unmerge on the SURVIVOR of a merge (the row
    other entities point their merged_into at) and passes the survivor's id. The
    survivor already has merged_into=NULL / is_active=True, so reactivating the
    passed id alone is a silent no-op — the merged children stay buried. This use
    case therefore fans out to every child merged INTO the given id, reactivating
    each and undoing the confirm-time alias write-back (D-11 reverse).

    If the id has no children (it is itself a merged child, or an ordinary row),
    it is reactivated directly — so callers may pass either end of a merge.

    Reactivations update state in-place; original rows are never deleted.
    Raises ValueError (→ 404) when the entity instance is not found.
    """

    def __init__(self, *, entity_instances: EntityInstanceRepository) -> None:
        self._entity_instances = entity_instances

    async def execute(self, entity_instance_id: str) -> dict[str, str]:
        """Unmerge the entity identified by entity_instance_id.

        importer_id derived from the loaded row (D-21).

        Returns:
            dict with entity_instance_id key for the endpoint to echo.
        """
        log = logger.bind(entity_instance_id=entity_instance_id)
        log.info("unmerge_start")

        instance = await self._entity_instances.find_by_id(entity_instance_id)
        if instance is None:
            log.warning("unmerge_not_found")
            raise ValueError(f"Entity instance not found: {entity_instance_id}")

        # D-21: importer from the row
        importer_id = instance.importer_id
        log = log.bind(importer_id=importer_id)

        # RES-2: reactivate every child merged INTO this survivor.
        children = await self._entity_instances.find_merged_children(entity_instance_id)

        if children:
            for child in children:
                await self._entity_instances.set_merge_state(
                    child.id,
                    merged_into=None,
                    is_active=True,
                )
                # Undo the D-11 confirm-time alias: the survivor gained the
                # child's display_name as an alias when the merge was confirmed.
                await self._entity_instances.remove_alias(
                    entity_instance_id,
                    child.display_name,
                )
            log.info("unmerge_done", reactivated=len(children))
        else:
            # No children point here — treat the id as a merged child (or an
            # ordinary row) and reactivate it directly.
            await self._entity_instances.set_merge_state(
                entity_instance_id,
                merged_into=None,
                is_active=True,
            )
            log.info("unmerge_done", reactivated=1)

        return {"entity_instance_id": entity_instance_id}
