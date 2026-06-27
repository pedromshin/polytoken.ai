"""SupabaseUiSpecTemplateRepository — best-effort adapter for ui_spec_templates.

Phase 14-03, CACHE-01 / D-17:
- find_by_cache_key: SELECT filtered by cache_key AND validation_status='validated' (D-15).
  Any exception → return None (treat as a miss, D-17).
- persist: INSERT ... ON CONFLICT (cache_key) DO UPDATE SET ... (D-12, concurrency-safe).
  Any exception → swallow + log 'genui_template_persist_failed' (D-17).
- increment_use_count: UPDATE use_count + 1 + updated_at for the given id.
  Any exception → swallow + log 'genui_use_count_increment_failed' (D-17).

Phase 16-03, STDO-05/STDO-06:
- list_recent: SELECT summary cols (no spec_json) ORDER BY created_at DESC with pagination.
  Any exception → return [] (D-15 best-effort); log 'genui_history_list_failed'.
- find_by_id: SELECT all cols including spec_json WHERE id = $id LIMIT 1.
  Any exception → return None (D-15 best-effort); log 'genui_history_detail_failed'.

WR-06: The supabase-py Client is synchronous. All calls are offloaded to a thread-pool
worker via asyncio.to_thread() so the event loop is not blocked during network I/O.

Satisfies UiSpecTemplateRepository Protocol structurally (no explicit inheritance) to
keep the domain port lint-imports clean — matching the audit repo convention.
"""

from __future__ import annotations

import asyncio
import json as _json
from datetime import UTC, datetime
from typing import Any

import structlog
from supabase import Client

from app.domain.ports.ui_spec_template_repository import (
    CachedTemplate,
    TemplateDetail,
    TemplateSummary,
    TemplateToPersist,
)

logger = structlog.get_logger(__name__)

_TABLE = "ui_spec_templates"


def _to_row(template: TemplateToPersist) -> dict[str, Any]:
    """Map a TemplateToPersist dataclass to the ui_spec_templates column dict.

    Returns a new dict — never mutates the input (CLAUDE.md immutability).
    None values are included explicitly so the upsert can clear optional columns.
    """
    return {
        "cache_key": template.cache_key,
        "intent_text": template.intent_text,
        "data_shape_hash": template.data_shape_hash,
        "registry_version": template.registry_version,
        "catalog_id": template.catalog_id,
        "spec_json": template.spec_json,
        "validation_status": template.validation_status,
        "spec_node_count": template.spec_node_count,
        "spec_depth": template.spec_depth,
        "importer_id": template.importer_id,
    }


class SupabaseUiSpecTemplateRepository:
    """Supabase implementation of UiSpecTemplateRepository (best-effort, D-17).

    Satisfies the UiSpecTemplateRepository Protocol structurally — no explicit
    Protocol inheritance to keep the domain port lint-imports clean.
    """

    def __init__(self, *, client: Client) -> None:
        self._client = client

    async def find_by_cache_key(self, cache_key: str) -> CachedTemplate | None:
        """Look up a validated spec by exact cache_key (D-15, CACHE-02).

        Applies both validity filters (D-15):
          WHERE cache_key = $cache_key AND validation_status = 'validated'

        Offloads the blocking synchronous Supabase execute() call to a thread-pool
        worker via asyncio.to_thread() (WR-06).

        Returns:
            CachedTemplate(id, spec_json) on hit; None on miss or any error (D-17).
        """
        try:
            response = await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .select("id, spec_json")
                    .eq("cache_key", cache_key)
                    .eq("validation_status", "validated")
                    .limit(1)
                    .execute()
                )
            )
            rows: list[dict[str, Any]] = response.data or []
            if not rows:
                return None
            row = rows[0]
            # WR-02: PostgREST may return JSONB columns as either dict or str,
            # depending on supabase-py version and server configuration. Handle
            # both defensively: parse str with json.loads, pass dict as-is.
            raw_spec = row["spec_json"]
            if isinstance(raw_spec, str):
                raw_spec = _json.loads(raw_spec)
            spec_json: dict[str, Any] = raw_spec
            return CachedTemplate(
                id=str(row["id"]),
                spec_json=spec_json,
            )
        except Exception:
            logger.exception(
                "genui_cache_lookup_failed",
                table=_TABLE,
                cache_key_prefix=cache_key[:8] if cache_key else "",
            )
            return None

    async def persist(self, template: TemplateToPersist) -> None:
        """Upsert a validated spec into ui_spec_templates (D-12, concurrency-safe).

        Uses ON CONFLICT (cache_key) to handle two-simultaneous-miss race (D-12):
        the second insert updates updated_at (the first write wins for spec_json).
        This relies on Supabase upsert with on_conflict="cache_key".

        Offloads the blocking call to asyncio.to_thread() (WR-06).
        Swallows all exceptions and logs server-side (best-effort, D-17).
        """
        row = _to_row(template)
        try:
            await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .upsert(row, on_conflict="cache_key")
                    .execute()
                )
            )
        except Exception:
            logger.exception(
                "genui_template_persist_failed",
                table=_TABLE,
                cache_key_prefix=template.cache_key[:8] if template.cache_key else "",
                registry_version=template.registry_version,
                importer_id=template.importer_id,
            )

    async def increment_use_count(self, template_id: str) -> None:
        """Increment use_count for the given template row (D-03/D-12, best-effort).

        CR-01: Implements a best-effort read-modify-write approach since
        supabase-py does not support column arithmetic (SET use_count = use_count + 1)
        in the .update() builder.

        Steps:
          1. SELECT use_count WHERE id = template_id (read)
          2. UPDATE SET use_count = current + 1, updated_at = now (write)

        Under concurrent cache-hits the count may drift slightly — this is
        acceptable because use_count is a tracking metric, not a correctness
        requirement (D-17). Use strict atomicity only if exact counts are required.

        NOTE: This is a best-effort operation. Any failure is swallowed + logged.
        Offloads blocking supabase-py calls to asyncio.to_thread() (WR-06).
        """
        now_iso = datetime.now(UTC).isoformat()
        try:
            # Step 1: read current use_count
            select_resp = await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .select("use_count")
                    .eq("id", template_id)
                    .limit(1)
                    .execute()
                )
            )
            rows: list[dict[str, Any]] = select_resp.data or []
            if not rows:
                # Row not found — nothing to increment; log and return gracefully.
                logger.warning(
                    "genui_use_count_increment_row_not_found",
                    table=_TABLE,
                    template_id=template_id,
                )
                return
            current_use_count: int = int(rows[0].get("use_count") or 0)

            # Step 2: write incremented value
            await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .update({"use_count": current_use_count + 1, "updated_at": now_iso})
                    .eq("id", template_id)
                    .execute()
                )
            )
        except Exception:
            logger.exception(
                "genui_use_count_increment_failed",
                table=_TABLE,
                template_id=template_id,
            )

    async def list_recent(
        self,
        limit: int = 20,
        offset: int = 0,
        importer_id: str | None = None,
    ) -> list[TemplateSummary]:
        """Return a paginated list of recent TemplateSummary rows (D-14, STDO-05).

        Does NOT select spec_json — lightweight list payload (D-14).
        Rows are ordered by created_at DESC.

        Args:
            limit: Number of rows to return. Clamped to [1, 100].
            offset: Zero-based row offset. Clamped to >= 0.
            importer_id: When provided, filter to rows matching this importer.
                         When None, returns rows for all importers.

        Returns:
            List of TemplateSummary objects; [] on any error (D-15 best-effort).

        Offloads blocking supabase-py call to asyncio.to_thread() (WR-06).
        """
        clamped_limit = max(1, min(100, limit))
        clamped_offset = max(0, offset)
        range_start = clamped_offset
        range_end = clamped_offset + clamped_limit - 1

        summary_cols = "id, intent_text, created_at, registry_version, use_count, validation_status"

        try:
            def _query() -> Any:
                q = self._client.table(_TABLE).select(summary_cols)
                if importer_id is not None:
                    q = q.eq("importer_id", importer_id)
                return q.order("created_at", desc=True).range(range_start, range_end).execute()

            response = await asyncio.to_thread(_query)
            rows: list[dict[str, Any]] = response.data or []
            return [
                TemplateSummary(
                    id=str(row["id"]),
                    intent_text=str(row["intent_text"]),
                    created_at=str(row["created_at"]),
                    registry_version=str(row["registry_version"]),
                    use_count=int(row.get("use_count") or 0),
                    validation_status=str(row["validation_status"]),
                )
                for row in rows
            ]
        except Exception:
            logger.exception(
                "genui_history_list_failed",
                table=_TABLE,
                limit=clamped_limit,
                offset=clamped_offset,
                importer_id=importer_id,
            )
            return []

    async def find_by_id(self, template_id: str) -> TemplateDetail | None:
        """Return a single TemplateDetail row by primary key (D-14, STDO-06).

        Includes spec_json in the result — full detail payload (D-14).

        Args:
            template_id: Primary key UUID of the ui_spec_templates row.

        Returns:
            TemplateDetail on hit; None on miss or any error (D-15 best-effort).

        Offloads blocking supabase-py call to asyncio.to_thread() (WR-06).
        WR-02: handles spec_json returned as str or dict.
        """
        detail_cols = (
            "id, intent_text, created_at, registry_version, use_count, validation_status, spec_json"
        )
        try:
            response = await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .select(detail_cols)
                    .eq("id", template_id)
                    .limit(1)
                    .execute()
                )
            )
            rows: list[dict[str, Any]] = response.data or []
            if not rows:
                return None
            row = rows[0]
            # WR-02: PostgREST may return JSONB columns as either dict or str.
            raw_spec = row["spec_json"]
            if isinstance(raw_spec, str):
                raw_spec = _json.loads(raw_spec)
            spec_json: dict[str, Any] = raw_spec
            return TemplateDetail(
                id=str(row["id"]),
                intent_text=str(row["intent_text"]),
                created_at=str(row["created_at"]),
                registry_version=str(row["registry_version"]),
                use_count=int(row.get("use_count") or 0),
                validation_status=str(row["validation_status"]),
                spec_json=spec_json,
            )
        except Exception:
            logger.exception(
                "genui_history_detail_failed",
                table=_TABLE,
                template_id=template_id,
            )
            return None
