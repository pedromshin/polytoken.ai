"""Server-side web_search result lookup for source-capture finalize (Phase 54-03, CLUS-04; carved from run_chat_turn.py, 999.31).

Pure scans over canonical `tool_invocation_result` parts that re-read a
SERVER-recorded web_search result by its `{toolUseId}:{index}` id — never
model free text (T-54-03-01). Moved verbatim — the facade re-exports every
name here under its old module path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.application.use_cases.run_chat_turn_confirm_action import extract_web_search_result

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.domain.ports.chat_repositories import ChatMessage

# Mirrors app.infrastructure.tools.web_search_executor.WEB_SEARCH_TOOL_NAME --
# defined locally (not imported) because the import-linter forbids
# app.application -> app.infrastructure (same rationale as
# EMIT_UI_SPEC_TOOL_NAME/EMIT_CONFIRM_ACTION_TOOL_NAME's own local
# redefinitions elsewhere in this package). Used by
# `_finalize_source_capture`'s persisted-part scan (Phase 54-03, CLUS-04).
_WEB_SEARCH_TOOL_NAME = "web_search"


def _find_web_search_result_in_parts(
    parts: Sequence[dict[str, Any]], *, tool_use_id: str, index: int
) -> dict[str, object] | None:
    """Scan one sequence of canonical parts for the web_search result matching tool_use_id.

    Pure w.r.t. its arguments (Phase 54-03, CLUS-04). Returns a
    `{url, title, retrievedAt}` dict built from the SERVER-recorded result
    content — never model free text (T-54-03-01). None (fail-closed) when no
    matching part exists, the part's content isn't a string, or
    `extract_web_search_result` can't resolve `index` inside it (out of
    range / malformed).
    """
    for part in parts:
        if (
            part.get("type") == "tool_invocation_result"
            and part.get("toolName") == _WEB_SEARCH_TOOL_NAME
            and part.get("toolUseId") == tool_use_id
        ):
            content = part.get("content")
            if not isinstance(content, str):
                return None
            entry = extract_web_search_result(content, index)
            if entry is None:
                return None
            url = entry.get("url")
            if not isinstance(url, str) or not url:
                return None
            title = entry.get("title")
            return {
                "url": url,
                "title": title if isinstance(title, str) and title else url,
                "retrievedAt": datetime.now(UTC).isoformat(),
            }
    return None


def _find_web_search_result(
    history: Sequence[ChatMessage], *, tool_use_id: str, index: int
) -> dict[str, object] | None:
    """Scan persisted `history` messages for the web_search result matching tool_use_id."""
    for message in history:
        found = _find_web_search_result_in_parts(message.parts, tool_use_id=tool_use_id, index=index)
        if found is not None:
            return found
    return None


def _find_latest_web_search_result_by_index(parts: Sequence[dict[str, Any]], *, index: int) -> dict[str, object] | None:
    """Resolve `index` against the MOST RECENT web_search result in this turn's parts.

    The exact-toolUseId fallback for model-mistranscribed ids (see
    `_finalize_source_capture`) — scans in reverse emission order and returns
    the first result set where `index` resolves. None when the turn ran no
    web_search (fail-closed, same 'unavailable' surface as before).
    """
    for part in reversed(parts):
        if part.get("type") == "tool_invocation_result" and part.get("toolName") == _WEB_SEARCH_TOOL_NAME:
            tool_use_id = part.get("toolUseId")
            if not isinstance(tool_use_id, str):
                continue
            found = _find_web_search_result_in_parts([part], tool_use_id=tool_use_id, index=index)
            if found is not None:
                return found
    return None
