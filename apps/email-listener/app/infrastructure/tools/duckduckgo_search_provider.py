"""DuckDuckGoSearchProvider -- keyless SearchProvider adapter over html.duckduckgo.com/html/ (Phase 54, CLUS-03).

No API key exists for this codebase (no search-API credentials are
provisioned) -- DuckDuckGo's keyless HTML endpoint is the only search step,
consumed via the ALREADY-a-dependency `httpx` (no new package). Parses the
plain result markup with the stdlib `html.parser.HTMLParser` (no new HTML
library either): each result's `<a class="result__a">` supplies the title +
a `//duckduckgo.com/l/?uddg=<url-encoded-target>` redirect href, and the
sibling `<a class="result__snippet">` supplies the short blurb. This module
unwraps the `uddg` redirect wrapper so `WebSearchExecutor` fetches the REAL
target page directly, never DuckDuckGo's own redirect endpoint.

Port contract (`SearchProvider.search`): NEVER raises past this boundary --
any network error, non-2xx status, or unparseable response degrades to `[]`.
"""

from __future__ import annotations

from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import httpx
import structlog

from app.domain.ports.search_provider import SearchResult

logger = structlog.get_logger(__name__)

_DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/"
_REQUEST_TIMEOUT_SECONDS = 10.0
# A descriptive, honest User-Agent -- DuckDuckGo's keyless HTML endpoint has
# no documented bot policy requiring a specific string; this identifies the
# adapter without impersonating a browser.
_USER_AGENT = "polytoken-web-search/1.0 (+https://polytoken.ai)"

_RESULT_TITLE_CLASS = "result__a"
_RESULT_SNIPPET_CLASS = "result__snippet"


class _DdgResultParser(HTMLParser):
    """Extracts (title, href, snippet) triples from DDG's result markup.

    Walks the flat sequence of `<a class="result__a">`/`<a class="result__snippet">`
    anchors in document order and pairs each title with the snippet that
    follows it -- mirrors the real markup's own ordering (title anchor,
    then extras, then the snippet anchor), never assumes a specific DOM
    nesting depth (`html.parser` is a streaming tag scanner, not a DOM tree).
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._current_field: str | None = None
        self._buffer: list[str] = []
        self._pending_title: str | None = None
        self._pending_href: str | None = None
        self.raw_results: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attrs_dict = dict(attrs)
        classes = (attrs_dict.get("class") or "").split()
        if _RESULT_TITLE_CLASS in classes:
            self._current_field = "title"
            self._pending_href = attrs_dict.get("href")
            self._buffer = []
        elif _RESULT_SNIPPET_CLASS in classes:
            self._current_field = "snippet"
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._current_field is not None:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._current_field is None:
            return
        text = "".join(self._buffer).strip()
        if self._current_field == "title":
            self._pending_title = text
        elif self._current_field == "snippet" and self._pending_title is not None and self._pending_href is not None:
            self.raw_results.append((self._pending_title, self._pending_href, text))
            self._pending_title = None
            self._pending_href = None
        self._current_field = None
        self._buffer = []


def _resolve_target_url(href: str | None) -> str | None:
    """Unwrap a `//duckduckgo.com/l/?uddg=<url-encoded-target>` redirect href to its real target.

    A href that is already an absolute, non-DDG-redirect URL passes through
    unchanged (protocol-relative `//host/...` hrefs are normalized to
    `https://host/...`). Returns None for an empty/unparseable href.
    """
    if not href:
        return None
    normalized = "https:" + href if href.startswith("//") else href
    parsed = urlparse(normalized)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        query = parse_qs(parsed.query)
        targets = query.get("uddg")
        return targets[0] if targets else None
    return normalized


def _parse_ddg_html(html_text: str, *, limit: int) -> list[SearchResult]:
    parser = _DdgResultParser()
    parser.feed(html_text)
    results: list[SearchResult] = []
    for title, href, snippet in parser.raw_results:
        target_url = _resolve_target_url(href)
        if not target_url:
            continue
        results.append(SearchResult(title=title, url=target_url, snippet=snippet))
        if len(results) >= limit:
            break
    return results


class DuckDuckGoSearchProvider:
    """SearchProvider impl over the keyless `html.duckduckgo.com/html/` endpoint.

    No API key -- degrades to `[]` on ANY network or parse error (port
    contract: "a provider failure degrades to []", never raises).
    """

    def __init__(self, *, client: httpx.AsyncClient) -> None:
        self._client = client

    async def search(self, *, query: str, limit: int) -> list[SearchResult]:
        try:
            response = await self._client.get(
                _DDG_HTML_ENDPOINT,
                params={"q": query},
                headers={"User-Agent": _USER_AGENT},
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except Exception as exc:  # port contract: a provider failure degrades to [], never raises
            logger.warning("duckduckgo_search_request_failed", error_type=type(exc).__name__)
            return []

        try:
            return _parse_ddg_html(response.text, limit=limit)
        except Exception as exc:  # malformed/unexpected markup must also degrade, never raise
            logger.warning("duckduckgo_search_parse_failed", error_type=type(exc).__name__)
            return []


__all__ = ["DuckDuckGoSearchProvider"]
