"""EditRegionUseCase — region edit operations (accept / reject / redraw / split / merge / nest / create).

Architecture contract: imports ONLY domain ports and entities.
No infrastructure imports permitted (verified by lint-imports rule).
"""

from __future__ import annotations

import dataclasses
import uuid

import structlog

from app.application.use_cases._token_provenance import capture_text as _capture_text
from app.application.use_cases.propose_regions import _union_polygon
from app.domain.entities.component import Component
from app.domain.ports.component_repository import ComponentRepository

logger = structlog.get_logger(__name__)


def _merge_lineage(content_raw: dict[str, object] | None, **updates: object) -> dict[str, object]:
    """Return a NEW content_raw dict with the lineage sub-dict merged (immutably).

    Preserves any pre-existing content_raw keys and lineage entries (e.g. the
    original "origin"/"supersedes" markers) while recording the new ones.
    """
    merged = dict(content_raw or {})
    existing_lineage = merged.get("lineage")
    lineage: dict[str, object] = dict(existing_lineage) if isinstance(existing_lineage, dict) else {}
    lineage.update(updates)
    merged["lineage"] = lineage
    return merged


class AcceptRegionUseCase:
    """Accept a region: transition extraction_status from pending → candidate."""

    # WR-02: only these statuses may be accepted; anything else (superseded,
    # rejected, candidate) indicates a concurrent modification.
    _ACCEPTABLE_STATUSES = frozenset({"pending"})

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(self, *, component_id: str) -> Component:
        log = logger.bind(component_id=component_id)
        log.info("accept_region_start")

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("accept_region_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        # WR-02: status guard — reject the transition if a concurrent operation
        # has already moved the component out of an acceptable state.
        if component.extraction_status not in self._ACCEPTABLE_STATUSES:
            log.warning(
                "accept_region_status_conflict",
                current_status=component.extraction_status,
            )
            raise ValueError(f"Component not found: {component_id}")

        # D-18: derive tenant from component row itself
        # D-16: status-only transition — update in place via update_status()
        updated = await self._components.update_status(component_id, "candidate")
        log.info("accept_region_done")
        return updated


class RejectRegionUseCase:
    """Reject a region: transition extraction_status → rejected."""

    # WR-02: only these statuses may be rejected; superseded components are
    # effectively gone and should not be silently re-marked.
    _REJECTABLE_STATUSES = frozenset({"pending", "candidate"})

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(self, *, component_id: str) -> Component:
        log = logger.bind(component_id=component_id)
        log.info("reject_region_start")

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("reject_region_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        # WR-02: status guard — reject the transition if a concurrent operation
        # has already moved the component out of a rejectable state.
        if component.extraction_status not in self._REJECTABLE_STATUSES:
            log.warning(
                "reject_region_status_conflict",
                current_status=component.extraction_status,
            )
            raise ValueError(f"Component not found: {component_id}")

        updated = await self._components.update_status(component_id, "rejected")
        log.info("reject_region_done")
        return updated


class RedrawRegionUseCase:
    """Redraw a region: supersede the original, create a new candidate with the given polygon.

    D-16: original geometry is never mutated — a new Component row is created and
    the original is marked superseded. Lineage is recorded in content_raw.
    """

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_id: str,
        polygon: list[list[float]],
        page_index: int,
    ) -> Component:
        log = logger.bind(component_id=component_id)
        log.info("redraw_region_start")

        original = await self._components.find_by_id(component_id)
        if original is None:
            log.warning("redraw_region_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        # Load parent page component for token capture
        page_id = original.parent_component_id
        page = await self._components.find_by_id(page_id) if page_id else None

        content_text = _capture_text(page, polygon) if page is not None else ""

        new_id = str(uuid.uuid4())

        new_child = Component(
            id=new_id,
            email_id=original.email_id,
            importer_id=original.importer_id,
            attachment_id=original.attachment_id,
            parent_component_id=original.parent_component_id,
            source_type="region",
            location={"page_index": page_index, "polygon": polygon},
            content_text=content_text,
            content_markdown=None,
            content_raw={"lineage": {"origin": "human_redraw", "supersedes": component_id}},
            embedding=None,
            sequence_index=0,
            extraction_status="candidate",
        )

        # Safe ordering: persist the NEW row first so that if the subsequent
        # update_status call fails, the original row is still live (readable),
        # not orphaned.  The new row would be an unlabeled duplicate, but data
        # is NOT lost.  Reversing the order (supersede first, then save new)
        # would silently destroy the original on save_many failure.
        persisted = await self._components.save_many([new_child])
        if not persisted:
            raise RuntimeError(f"save_many returned empty result for redrawn component {new_id}")

        superseded = dataclasses.replace(
            original,
            extraction_status="superseded",
            content_raw=_merge_lineage(original.content_raw, superseded_by=new_id),
        )
        await self._components.save_many([superseded])
        log.info("redraw_region_done", new_component_id=new_id)
        return persisted[0]


class SplitRegionUseCase:
    """Split a region into ≥2 new candidates; supersede the original.

    D-16: original is never mutated — it is marked superseded. All new children
    are born candidate with lineage origin "human_split".
    """

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_id: str,
        regions: list[dict[str, object]],
    ) -> list[Component]:
        log = logger.bind(component_id=component_id)
        log.info("split_region_start", region_count=len(regions))

        # WR-04: enforce minimum region count at the use-case layer so callers
        # that bypass the HTTP layer (scripts, tests) cannot trigger undefined
        # behavior (superseding original with zero replacements).
        if len(regions) < 2:
            raise ValueError("Split requires at least 2 target regions")

        original = await self._components.find_by_id(component_id)
        if original is None:
            log.warning("split_region_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        # Load parent page for token capture
        page_id = original.parent_component_id
        page = await self._components.find_by_id(page_id) if page_id else None

        new_children: list[Component] = []
        for region in regions:
            polygon = region["polygon"]  # type: ignore[index]
            page_index = region["page_index"]  # type: ignore[index]
            new_id = str(uuid.uuid4())
            content_text = _capture_text(page, polygon) if page is not None else ""  # type: ignore[arg-type]

            child = Component(
                id=new_id,
                email_id=original.email_id,
                importer_id=original.importer_id,
                attachment_id=original.attachment_id,
                parent_component_id=original.parent_component_id,
                source_type="region",
                location={"page_index": page_index, "polygon": polygon},
                content_text=content_text,
                content_markdown=None,
                content_raw={"lineage": {"origin": "human_split", "supersedes": component_id}},
                embedding=None,
                sequence_index=0,
                extraction_status="candidate",
            )
            new_children.append(child)

        # Safe ordering: persist new children first so that if the subsequent
        # update_status call fails, the original row is still live (readable),
        # not orphaned.  See RedrawRegionUseCase for the same rationale.
        persisted = await self._components.save_many(new_children)
        if not persisted:
            raise RuntimeError(f"save_many returned empty result for split of component {component_id}")

        superseded = dataclasses.replace(
            original,
            extraction_status="superseded",
            content_raw=_merge_lineage(
                original.content_raw,
                superseded_by=[c.id for c in new_children],
            ),
        )
        await self._components.save_many([superseded])
        log.info("split_region_done", new_count=len(new_children))
        return persisted


class MergeRegionsUseCase:
    """Merge ≥2 regions into one new candidate; supersede all originals.

    Raises ValueError when component_ids do not all share the same email_id AND
    attachment_id (IDOR guard — T-06-03). Default polygon = union of originals.
    """

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_ids: list[str],
        polygon: list[list[float]] | None = None,
        page_index: int | None = None,
    ) -> Component:
        log = logger.bind(component_count=len(component_ids))
        log.info("merge_regions_start")

        originals: list[Component] = []
        for cid in component_ids:
            comp = await self._components.find_by_id(cid)
            if comp is None:
                log.warning("merge_regions_component_not_found", component_id=cid)
                raise ValueError(f"Component not found: {cid}")
            originals.append(comp)

        # T-06-03: all originals must share the same email_id AND attachment_id
        first = originals[0]
        for comp in originals[1:]:
            if comp.email_id != first.email_id or comp.attachment_id != first.attachment_id:
                log.warning(
                    "merge_regions_cross_email_rejected",
                    component_id=comp.id,
                )
                raise ValueError("Cannot merge components that do not share the same email and attachment")

        # Determine merged polygon — default = union of all originals' polygons
        if polygon is None:
            boxes: list[tuple[float, float, float, float]] = []
            for comp in originals:
                poly = comp.location.get("polygon")
                if isinstance(poly, list):
                    # WR-03: Reject non-4-point polygons rather than silently
                    # skipping them.  Silently skipping would produce an empty
                    # boxes list and then _union_polygon would compute a
                    # degenerate bounding box (Infinity/NaN values).
                    if len(poly) != 4:
                        raise ValueError(
                            "All component polygons must be 4-point rectangles for merge; "
                            f"component {comp.id} has {len(poly)} points"
                        )
                    xs = [pt[0] for pt in poly]
                    ys = [pt[1] for pt in poly]
                    left = min(xs)
                    top = min(ys)
                    width = max(xs) - left
                    height = max(ys) - top
                    boxes.append((left, top, width, height))
            if not boxes:
                raise ValueError("Cannot compute merged polygon: no components have polygon geometry")
            polygon = _union_polygon(boxes)

        # Determine page_index — default to the first original's page_index
        effective_page_index: int
        if page_index is None:
            raw_pi = first.location.get("page_index", 0)
            effective_page_index = int(raw_pi) if isinstance(raw_pi, (int, float)) else 0
        else:
            effective_page_index = page_index

        # Load parent page for token capture
        page_id = first.parent_component_id
        page = await self._components.find_by_id(page_id) if page_id else None
        content_text = _capture_text(page, polygon) if page is not None else ""

        new_id = str(uuid.uuid4())
        new_component = Component(
            id=new_id,
            email_id=first.email_id,
            importer_id=first.importer_id,
            attachment_id=first.attachment_id,
            parent_component_id=first.parent_component_id,
            source_type="region",
            location={"page_index": effective_page_index, "polygon": polygon},
            content_text=content_text,
            content_markdown=None,
            content_raw={
                "lineage": {
                    "origin": "human_merge",
                    "supersedes": [c.id for c in originals],
                }
            },
            embedding=None,
            sequence_index=0,
            extraction_status="candidate",
        )

        # Safe ordering: persist the NEW row first so that if the subsequent
        # supersede updates fail, the originals remain live (readable), not
        # orphaned.  See RedrawRegionUseCase for the same rationale.
        persisted = await self._components.save_many([new_component])
        if not persisted:
            raise RuntimeError(f"save_many returned empty result for merged component {new_id}")

        superseded_list = [
            dataclasses.replace(
                comp,
                extraction_status="superseded",
                content_raw=_merge_lineage(comp.content_raw, superseded_by=new_id),
            )
            for comp in originals
        ]
        await self._components.save_many(superseded_list)
        log.info("merge_regions_done", new_component_id=new_id)
        return persisted[0]


class NestRegionUseCase:
    """Set or clear parent_component_id on a region (no supersede)."""

    # Maximum ancestry depth to traverse when checking for cycles.
    # Bounded to avoid unbounded DB queries on pre-existing malformed data.
    _MAX_DEPTH = 20

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_id: str,
        parent_component_id: str | None,
    ) -> Component:
        log = logger.bind(component_id=component_id)
        log.info("nest_region_start", parent_component_id=parent_component_id)

        # Self-nesting guard
        if parent_component_id is not None and component_id == parent_component_id:
            raise ValueError("A component cannot be nested inside itself")

        # Cycle guard: walk the proposed parent's ancestry chain.
        # If we reach component_id anywhere in the chain, nesting would create a cycle.
        if parent_component_id is not None:
            visited: set[str] = {component_id}
            cursor_id: str | None = parent_component_id
            hops = 0
            while cursor_id is not None and hops < self._MAX_DEPTH:
                if cursor_id in visited:
                    raise ValueError(f"Nesting would create a cycle at component {cursor_id}")
                visited.add(cursor_id)
                cursor = await self._components.find_by_id(cursor_id)
                cursor_id = cursor.parent_component_id if cursor else None
                hops += 1

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("nest_region_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        updated = await self._components.update_parent(component_id, parent_component_id)
        log.info("nest_region_done")
        return updated


class CreateRegionUseCase:
    """Create a new candidate region under a page component (Add-region / zero-proposals path).

    Works when the page has zero existing region children (D-09, empty-data reality).
    Derives tenant from the loaded page row (D-18).
    """

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        page_component_id: str,
        polygon: list[list[float]],
        page_index: int,
    ) -> Component:
        log = logger.bind(page_component_id=page_component_id)
        log.info("create_region_start")

        page = await self._components.find_by_id(page_component_id)
        if page is None:
            log.warning("create_region_page_not_found")
            raise ValueError(f"Component not found: {page_component_id}")

        # D-18: derive tenant from the loaded page row
        content_text = _capture_text(page, polygon)

        new_id = str(uuid.uuid4())
        child = Component(
            id=new_id,
            email_id=page.email_id,
            importer_id=page.importer_id,
            attachment_id=page.attachment_id,
            parent_component_id=page.id,
            source_type="region",
            location={"page_index": page_index, "polygon": polygon},
            content_text=content_text,
            content_markdown=None,
            content_raw={"lineage": {"origin": "human_add"}},
            embedding=None,
            sequence_index=0,
            extraction_status="candidate",
        )

        persisted = await self._components.save_many([child])
        if not persisted:
            raise RuntimeError(f"save_many returned empty result for new component {new_id}")
        log.info("create_region_done", new_component_id=new_id)
        return persisted[0]
