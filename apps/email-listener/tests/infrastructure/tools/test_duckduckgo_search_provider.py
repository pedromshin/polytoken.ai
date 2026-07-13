"""Tests for DuckDuckGoSearchProvider -- keyless SearchProvider adapter (Phase 54, CLUS-03).

Behaviors:
  1.  search() parses the real keyless DDG HTML endpoint's result markup
      (title/href/snippet, unwrapping the //duckduckgo.com/l/?uddg=... redirect
      wrapper) into SearchResult[], mocked httpx -- no live network call.
  2.  results are capped at `limit`.
  3.  a network/HTTP error (raise_for_status / request exception) degrades to
      [] -- never raises (port contract).
  4.  malformed/empty HTML with no matching result markup degrades to [].
  5.  a target href that is already an absolute URL (no uddg wrapper) passes
      through unchanged.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.domain.ports.search_provider import SearchResult
from app.infrastructure.tools.duckduckgo_search_provider import DuckDuckGoSearchProvider

# Trimmed excerpt of the REAL html.duckduckgo.com/html/ result markup (captured
# live 2026-07-12 against a real query) -- two results, each wrapped in the
# //duckduckgo.com/l/?uddg=<url-encoded-target>&rut=... redirect anchor.
_SAMPLE_DDG_HTML = """
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.python.org%2F&amp;rut=abc">Welcome to Python.org</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.python.org%2F&amp;rut=abc"><b>Python</b> is a versatile and easy-to-learn language.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F3%2F&amp;rut=def">Python 3 Documentation</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F3%2F&amp;rut=def">The official Python 3 documentation.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwiki.python.org%2Fmoin%2F&amp;rut=ghi">Python Wiki</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwiki.python.org%2Fmoin%2F&amp;rut=ghi">Community wiki for Python.</a>
  </div>
</div>
"""

_SAMPLE_DDG_HTML_ABSOLUTE_HREF = """
<div class="result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://example.com/direct">Direct Example</a>
  </h2>
  <a class="result__snippet" href="https://example.com/direct">A direct, unwrapped href.</a>
</div>
"""


def _mock_client(
    *, text: str = "", status_error: Exception | None = None, request_error: Exception | None = None
) -> AsyncMock:
    client = AsyncMock(spec=httpx.AsyncClient)
    if request_error is not None:
        client.get.side_effect = request_error
        return client
    response = MagicMock()
    response.text = text
    if status_error is not None:
        response.raise_for_status.side_effect = status_error
    else:
        response.raise_for_status.return_value = None
    client.get.return_value = response
    return client


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_parses_ddg_html_into_search_results() -> None:
    client = _mock_client(text=_SAMPLE_DDG_HTML)
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="python programming language", limit=5)

    assert results == [
        SearchResult(
            title="Welcome to Python.org",
            url="https://www.python.org/",
            snippet="Python is a versatile and easy-to-learn language.",
        ),
        SearchResult(
            title="Python 3 Documentation",
            url="https://docs.python.org/3/",
            snippet="The official Python 3 documentation.",
        ),
        SearchResult(title="Python Wiki", url="https://wiki.python.org/moin/", snippet="Community wiki for Python."),
    ]
    client.get.assert_awaited_once()
    _args, kwargs = client.get.call_args
    assert kwargs["params"] == {"q": "python programming language"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_caps_results_at_limit() -> None:
    client = _mock_client(text=_SAMPLE_DDG_HTML)
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="python", limit=2)

    assert len(results) == 2
    assert [r.title for r in results] == ["Welcome to Python.org", "Python 3 Documentation"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_degrades_to_empty_list_on_http_status_error() -> None:
    client = _mock_client(
        text="", status_error=httpx.HTTPStatusError("boom", request=MagicMock(), response=MagicMock())
    )
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="anything", limit=5)

    assert results == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_degrades_to_empty_list_on_request_error() -> None:
    client = _mock_client(request_error=httpx.ConnectError("dns failure"))
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="anything", limit=5)

    assert results == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_degrades_to_empty_list_on_malformed_html() -> None:
    client = _mock_client(text="<html><body>no results here, just a 500 error page</body></html>")
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="anything", limit=5)

    assert results == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_search_passes_through_an_already_absolute_href_unchanged() -> None:
    client = _mock_client(text=_SAMPLE_DDG_HTML_ABSOLUTE_HREF)
    provider = DuckDuckGoSearchProvider(client=client)

    results = await provider.search(query="direct", limit=5)

    assert results == [
        SearchResult(title="Direct Example", url="https://example.com/direct", snippet="A direct, unwrapped href.")
    ]
