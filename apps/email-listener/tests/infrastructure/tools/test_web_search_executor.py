"""Tests for WebSearchExecutor -- search -> SSRF-guard -> fetch -> strip -> quarantine (Phase 54, CLUS-03, TOOL-05).

Behaviors:
  1.  happy path (mocked provider + mocked fetch_page): every provider hit is
      SSRF-checked, fetched, stripped, truncated, and assembled into a JSON
      dict envelope `{mode:"web_search", results:[{title,url,snippet}]}` that
      PASSES validate_tool_envelope.
  2.  a result whose URL fails the pre-DNS SSRF guard is dropped without ever
      being fetched -- the round still returns the safe results, is_error stays
      False.
  3.  a result whose hostname resolves (DNS) to a private IP is dropped without
      being fetched, even though the literal URL itself looked fine.
  4.  empty/missing/blank query -> is_error True with a friendly message, zero
      provider/fetch calls.
  5.  provider.search raising -> is_error True, never raises, no internals leaked.
  6.  an oversized fetched page is truncated to the per-field bound before
      entering the envelope (DoS bound, truncate_field convention).
  7.  content is capped, valid JSON (cap_tool_output convention, mirrors the
      other 3 real executors).
  8.  REGRESSION: 5 realistic near-max-length results (2 truncated fields each,
      unlike the other executors' 1) must still serialize to a VALID, gate-passing
      JSON envelope -- proves the running envelope-size budget stops adding
      results before cap_tool_output's own whole-string slice would ever need
      to cut mid-JSON (found live during this plan's own network smoke test).
"""

from __future__ import annotations

import json
import socket
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.ports.search_provider import SearchResult
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS
from app.domain.services.tool_envelope_gate import validate_tool_envelope
from app.infrastructure.tools import web_search_executor
from app.infrastructure.tools.envelope import MAX_RESULT_FIELD_CHARS
from app.infrastructure.tools.web_search_executor import WebSearchExecutor, build_web_search_tool

_IMPORTER_ID = "imp-0000-0000-0000-000000000001"

# Real public IPs used as literal-IP-host URLs -- these pass both the pre-DNS
# is_public_https_url check AND the executor's own DNS-resolution step
# WITHOUT needing socket.getaddrinfo to be mocked (literal IP hosts skip DNS
# entirely -- see url_safety.py's docstring).
_PUBLIC_URL_A = "https://93.184.216.34/page-a"
_PUBLIC_URL_B = "https://1.1.1.1/page-b"
_PRIVATE_LITERAL_URL = "https://10.0.0.5/internal"


def _make_provider(hits: list[SearchResult] | None = None, *, side_effect: Exception | None = None) -> AsyncMock:
    provider = AsyncMock()
    if side_effect is not None:
        provider.search.side_effect = side_effect
    else:
        provider.search.return_value = hits if hits is not None else []
    return provider


def _make_fetch_page(pages: dict[str, str] | None = None, *, side_effect: Exception | None = None) -> AsyncMock:
    fetch_page = AsyncMock()
    if side_effect is not None:
        fetch_page.side_effect = side_effect
    else:
        mapping = pages or {}
        fetch_page.side_effect = lambda url: mapping.get(url, "<html><body>stub page</body></html>")
    return fetch_page


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_search_fetch_strip_and_envelope_passes_gate() -> None:
    hits = [
        SearchResult(title="Page A", url=_PUBLIC_URL_A, snippet="a provider snippet"),
        SearchResult(title="Page B", url=_PUBLIC_URL_B, snippet="b provider snippet"),
    ]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page(
        {
            _PUBLIC_URL_A: "<html><body><p>Real page A content.</p></body></html>",
            _PUBLIC_URL_B: "<html><body><p>Real page B content.</p></body></html>",
        }
    )
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test query"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    provider.search.assert_awaited_once()
    assert fetch_page.await_count == 2

    envelope: dict[str, Any] = json.loads(result.content)
    assert envelope["mode"] == "web_search"
    results = envelope["results"]
    assert [r["url"] for r in results] == [_PUBLIC_URL_A, _PUBLIC_URL_B]
    assert results[0]["title"] == "Page A"
    assert "Real page A content." in results[0]["snippet"]

    gate = validate_tool_envelope(result.content)
    assert gate.ok is True, f"happy-path envelope failed the gate: {gate.reason}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_url_failing_pre_dns_ssrf_guard_is_dropped_without_fetching() -> None:
    hits = [
        SearchResult(title="Safe", url=_PUBLIC_URL_A, snippet="safe"),
        SearchResult(title="Internal", url=_PRIVATE_LITERAL_URL, snippet="hostile"),
    ]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page()
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    urls = [r["url"] for r in envelope["results"]]
    assert _PUBLIC_URL_A in urls
    assert _PRIVATE_LITERAL_URL not in urls
    fetched_urls = {call.args[0] for call in fetch_page.await_args_list}
    assert _PRIVATE_LITERAL_URL not in fetched_urls, "a literal private-IP URL must never be fetched"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_hostname_resolving_to_private_ip_is_dropped_without_fetching(monkeypatch: pytest.MonkeyPatch) -> None:
    hostile_url = "https://internal.polytoken-test.invalid/secret"

    def fake_getaddrinfo(host: str, port: int | None) -> list[tuple[Any, ...]]:
        assert host == "internal.polytoken-test.invalid"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))]

    monkeypatch.setattr(web_search_executor.socket, "getaddrinfo", fake_getaddrinfo)

    hits = [
        SearchResult(title="Safe", url=_PUBLIC_URL_A, snippet="safe"),
        SearchResult(title="Hostile", url=hostile_url, snippet="hostile"),
    ]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page()
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    urls = [r["url"] for r in envelope["results"]]
    assert _PUBLIC_URL_A in urls
    assert hostile_url not in urls
    fetched_urls = {call.args[0] for call in fetch_page.await_args_list}
    assert hostile_url not in fetched_urls, "a hostname resolving to a private IP must never be fetched"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_query_returns_error_without_provider_or_fetch_calls() -> None:
    for bad_arguments in ({}, {"query": None}, {"query": ""}, {"query": "   "}):
        provider = _make_provider()
        fetch_page = _make_fetch_page()
        executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

        result = await executor.execute(name="web_search", arguments=bad_arguments, importer_id=_IMPORTER_ID)

        assert result.is_error is True
        assert result.content
        provider.search.assert_not_called()
        fetch_page.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_provider_exception_returns_error_never_raises_no_leak() -> None:
    provider = _make_provider(side_effect=RuntimeError("upstream exploded, api_key=super-secret"))
    fetch_page = _make_fetch_page()
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    assert result.is_error is True
    assert result.content
    assert "upstream exploded" not in result.content
    assert "super-secret" not in result.content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_oversized_fetched_page_is_truncated_to_field_bound() -> None:
    huge_page = "<html><body><p>" + ("filler word " * 2000) + "</p></body></html>"
    hits = [SearchResult(title="Big Page", url=_PUBLIC_URL_A, snippet="short")]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page({_PUBLIC_URL_A: huge_page})
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    snippet = envelope["results"][0]["snippet"]
    assert len(snippet) <= MAX_RESULT_FIELD_CHARS + len("…[truncated]")
    assert snippet.endswith("…[truncated]")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_content_is_capped_and_valid_json() -> None:
    hits = [SearchResult(title="Page A", url=_PUBLIC_URL_A, snippet="a")]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page({_PUBLIC_URL_A: "<html><body>content</body></html>"})
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    parsed: Any = json.loads(result.content)
    assert isinstance(parsed, dict)
    assert "results" in parsed
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_five_realistic_near_max_length_results_still_serialize_to_valid_gate_passing_json() -> None:
    """Regression: unlike the other 3 executors (1 truncated field/result), web_search truncates
    TWO fields (title + a real fetched-page snippet) per result -- at 5 results with near-max-length
    fields the naive whole-envelope `cap_tool_output` slice would cut mid-JSON. The running
    envelope-size budget must stop adding results before that happens, never producing invalid JSON.
    """
    urls = [
        "https://93.184.216.34/page-a",
        "https://1.1.1.1/page-b",
        "https://8.8.8.8/page-c",
        "https://8.8.4.4/page-d",
        "https://9.9.9.9/page-e",
    ]
    long_title = "Realistic Long Page Title About A Topic " * 3
    long_page = "<html><body><p>" + ("Real fetched page content sentence. " * 40) + "</p></body></html>"
    hits = [SearchResult(title=long_title, url=url, snippet="provider snippet ignored") for url in urls]
    provider = _make_provider(hits=hits)
    fetch_page = _make_fetch_page(dict.fromkeys(urls, long_page))
    executor = WebSearchExecutor(provider=provider, fetch_page=fetch_page)

    result = await executor.execute(name="web_search", arguments={"query": "test"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    # The critical assertion: this must not raise -- a mid-JSON truncation would fail json.loads.
    envelope = json.loads(result.content)
    assert isinstance(envelope["results"], list)
    assert len(envelope["results"]) >= 1, "the budget must allow at least one real result through"
    assert len(envelope["results"]) <= 5
    gate = validate_tool_envelope(result.content)
    assert gate.ok is True, f"5-result realistic envelope failed the gate: {gate.reason}"
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS


@pytest.mark.unit
def test_build_web_search_tool_is_bedrock_valid_and_never_exposes_a_model_authored_limit() -> None:
    """T-37-10-style precedent: top-N is hardcoded, never model-authored -- the schema does not declare it."""
    tool = build_web_search_tool()

    assert tool["name"] == "web_search"
    schema = tool["input_schema"]
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["query"]
    assert "limit" not in schema["properties"], "top-N must be a hardcoded server constant, never a model-settable property"
    assert schema["properties"]["query"]["maxLength"] <= 200
