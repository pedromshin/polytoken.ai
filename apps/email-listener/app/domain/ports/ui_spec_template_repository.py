"""UiSpecTemplateRepository port — domain abstraction for the exact-match UI spec cache.

Phase 14-03, CACHE-01 / D-17:
- find_by_cache_key: exact + validity-filtered lookup (D-15); any error → None (miss).
- persist: upsert validated spec into ui_spec_templates (D-12, ON CONFLICT cache_key).
- increment_use_count: increment use_count on a hit row (D-03/D-12).

Phase 16-03, STDO-05/STDO-06:
- list_recent: paginated list of TemplateSummary rows (D-14: no spec_json); best-effort.
- find_by_id: single TemplateDetail row with spec_json (D-14); best-effort.

D-15 contract enforced at the adapter level:
- persist and increment_use_count are best-effort (swallow+log, never raise).
- find_by_cache_key treats any lookup error as a miss (returns None, never raises).
- list_recent: any error → return [] (D-15 best-effort).
- find_by_id: any error → return None (D-15 best-effort).

CachedTemplate, TemplateToPersist, TemplateSummary, and TemplateDetail are
frozen dataclasses (immutable, CLAUDE.md).
No infrastructure imports are permitted in this module — this is a pure domain port.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class CachedTemplate:
    """Immutable result of a cache hit — the fields needed to serve the response (D-15).

    id: Primary key of the matched ui_spec_templates row (used for use_count increment).
    spec_json: The full validated SpecRoot JSON, ready to be returned to the caller.
    """

    id: str
    spec_json: dict[str, Any]


@dataclass(frozen=True)
class TemplateSummary:
    """Immutable summary row for the history list endpoint (D-14: no spec_json).

    Returned by list_recent — lightweight payload without the full spec_json blob.
    id: Primary key of the ui_spec_templates row.
    intent_text: The canonical intent text used to generate the spec.
    created_at: ISO 8601 timestamp string from the DB.
    registry_version: Catalog content hash in effect when the spec was generated.
    use_count: Number of times this spec has been served from cache.
    validation_status: Always 'validated' for surfaced rows.
    """

    id: str
    intent_text: str
    created_at: str
    registry_version: str
    use_count: int
    validation_status: str


@dataclass(frozen=True)
class TemplateDetail:
    """Immutable detail row for the history detail endpoint (D-14: includes spec_json).

    Returned by find_by_id — full payload including the spec_json blob.
    id: Primary key of the ui_spec_templates row.
    intent_text: The canonical intent text used to generate the spec.
    created_at: ISO 8601 timestamp string from the DB.
    registry_version: Catalog content hash in effect when the spec was generated.
    use_count: Number of times this spec has been served from cache.
    validation_status: Always 'validated' for surfaced rows.
    spec_json: The full validated SpecRoot JSON.
    """

    id: str
    intent_text: str
    created_at: str
    registry_version: str
    use_count: int
    validation_status: str
    spec_json: dict[str, Any]


@dataclass(frozen=True)
class TemplateToPersist:
    """Immutable write payload for persisting a validated spec to ui_spec_templates (D-10/D-11).

    All fields map directly to the ui_spec_templates columns (14-01 schema).

    cache_key: SHA-256 hex from compute_cache_key (D-04) — the ON CONFLICT target.
    intent_text: Canonical (D-05 normalised) intent — stored plaintext for v1.2 retrieval (D-10).
    data_shape_hash: SHA-256 of the value-free shape descriptor (D-06).
    registry_version: Catalog content hash (D-07) — the invalidation lever (D-13).
    catalog_id: Per-catalog seam, defaults to 'global' in v1.1 (D-08 / SEAM-03).
    spec_json: The full validated SpecRoot JSON (D-11 — only validated specs are ever persisted).
    validation_status: Always 'validated' in v1.1 (D-11, DB CHECK enforces this).
    spec_node_count: Optional node count from _count_nodes walker (D-10 metadata).
    spec_depth: Optional depth from _count_nodes walker (D-10 metadata).
    importer_id: Tenant scope UUID; None for system-level generations (D-08 / D-10).
    """

    cache_key: str
    intent_text: str
    data_shape_hash: str
    registry_version: str
    catalog_id: str
    spec_json: dict[str, Any]
    validation_status: str = "validated"
    spec_node_count: int | None = None
    spec_depth: int | None = None
    importer_id: str | None = None


class UiSpecTemplateRepository(Protocol):
    """Port for the exact-match UI spec cache (CACHE-01, D-15/D-17).

    Implementations must honour the best-effort contract:
    - find_by_cache_key: any lookup error → return None (treat as a miss).
    - persist: failures are logged server-side and swallowed — never raises.
    - increment_use_count: failures are logged server-side and swallowed — never raises.
    - list_recent: any error → return [] (D-15 best-effort).
    - find_by_id: any error → return None (D-15 best-effort).
    """

    async def find_by_cache_key(self, cache_key: str) -> CachedTemplate | None:
        """Look up a validated spec by its exact cache_key (D-15).

        Applies both filters:
          WHERE cache_key = $cache_key AND validation_status = 'validated'

        Returns:
            CachedTemplate with id + spec_json on a hit; None on a miss or any error.

        Must not raise under any circumstance — errors are treated as misses (D-17).
        """
        ...

    async def persist(self, template: TemplateToPersist) -> None:
        """Upsert a validated spec into ui_spec_templates (D-12, ON CONFLICT cache_key).

        Uses ON CONFLICT (cache_key) to handle concurrent misses safely (D-12):
        two simultaneous cold generations will not error or duplicate.

        Must not raise under any circumstance — failures are swallowed+logged (D-17).
        """
        ...

    async def increment_use_count(self, template_id: str) -> None:
        """Increment use_count for the given template row (D-03/D-12, best-effort).

        Called on every cache hit to track reuse frequency for v1.2 promotion (D-03).

        Must not raise under any circumstance — failures are swallowed+logged (D-17).
        """
        ...

    async def list_recent(
        self,
        limit: int = 20,
        offset: int = 0,
        importer_id: str | None = None,
    ) -> list[TemplateSummary]:
        """Return a paginated list of recent TemplateSummary rows (D-14, STDO-05).

        Does NOT include spec_json in the result — lightweight list payload (D-14).
        Rows are ordered by created_at DESC.

        Args:
            limit: Number of rows to return. Clamped to [1, 100].
            offset: Zero-based row offset. Clamped to >= 0.
            importer_id: When provided, filter to rows matching this importer.
                         When None, returns rows for all importers (D-16).

        Returns:
            List of TemplateSummary objects; [] on any error (D-15 best-effort).

        Must not raise under any circumstance — errors are logged server-side (D-15).
        """
        ...

    async def find_by_id(self, template_id: str) -> TemplateDetail | None:
        """Return a single TemplateDetail row by primary key (D-14, STDO-06).

        Includes spec_json in the result — full detail payload (D-14).

        Args:
            template_id: Primary key UUID of the ui_spec_templates row.

        Returns:
            TemplateDetail on hit; None on miss or any error (D-15 best-effort).

        Must not raise under any circumstance — errors are logged server-side (D-15).
        """
        ...
