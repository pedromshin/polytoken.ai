"""web_search adversarial fixture suite -- fetched-page injection stays inert (Phase 54, CLUS-03, T-54-02-02).

Loads `packages/genui/src/eval/web-search-injection-fixtures.json` (10
entries across instruction-override / tool-call-injection / data-exfil /
role-confusion / embedded-system-prompt categories) via
`tests.evals._paths.eval_fixtures_dir()` -- never a hand-copied duplicate --
and proves the REAL `WebSearchExecutor` (mocked provider + mocked
`fetch_page`, no live network) treats every fixture's poisoned page content
as INERT quarantined data:

  1. the fixture's `[CANARY:...]` marker DOES appear -- inside the
     `snippet` STRING field only. This is intentionally different from
     `search_knowledge`'s adversarial suite (`test_injection_adversarial_suite.py`),
     which asserts the canary NEVER leaks for a non-EXTRACTED row -- there is
     no trust tier here to hide behind: `web_search` legitimately returns
     fetched page TEXT every time (that is the tool's whole purpose). The
     security property under test is structural confinement, not
     suppression: the payload must never escape its plain data field into
     anything the model could mistake for an instruction or a new
     structural element.
  2. the result dict's keys are EXACTLY `{title, url, snippet}` -- no
     injected `tool_call`/`system`/`role` key ever appears as an actual
     JSON key, proving the page content never escapes its data field into
     envelope STRUCTURE.
  3. the top-level envelope has no `citations` key (UI-SPEC Judgment Call
     #7: web_search results are external URLs, never internal citations).
  4. the envelope still passes `validate_tool_envelope` (the structural
     gate holds regardless of the hostile content living inside a string
     field).

CI-runnable, no live model, no live network -- `pytest.mark.unit` only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.ports.search_provider import SearchResult
from app.domain.services.tool_envelope_gate import validate_tool_envelope
from app.infrastructure.tools.web_search_executor import WebSearchExecutor
from tests.evals._paths import eval_fixtures_dir
from tests.evals._scorers import extract_canary

_IMPORTER_ID = "imp-54-02-0000-0000-000000000001"
# A literal public IP -- passes the SSRF guard without needing socket.getaddrinfo
# to be mocked (mirrors test_web_search_executor.py's own convention).
_SAFE_URL = "https://93.184.216.34/hostile-page"


def _load_web_search_injection_fixtures() -> list[dict[str, Any]]:
    path = eval_fixtures_dir() / "web-search-injection-fixtures.json"
    return json.loads(Path(path).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _make_executor(*, page_html: str) -> WebSearchExecutor:
    provider = AsyncMock()
    provider.search.return_value = [SearchResult(title="Hostile Result", url=_SAFE_URL, snippet="provider snippet")]
    fetch_page = AsyncMock(return_value=page_html)
    return WebSearchExecutor(provider=provider, fetch_page=fetch_page)


@pytest.mark.unit
def test_fixtures_load_with_required_shape_and_canary_marker() -> None:
    fixtures = _load_web_search_injection_fixtures()
    assert len(fixtures) >= 8, "54-02-PLAN.md requires >= 8 web-search injection fixtures"
    categories = {f["name"].rsplit("-", 1)[0] for f in fixtures}
    assert categories >= {
        "instruction-override",
        "tool-call-injection",
        "data-exfil",
        "role-confusion",
        "embedded-system-prompt",
    }
    for fixture in fixtures:
        assert {"name", "pageHtml", "expectedBehavior"} <= fixture.keys()
        assert extract_canary(fixture["pageHtml"]) is not None, (
            f"fixture {fixture['name']!r} has no [CANARY:...] marker"
        )


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("fixture", _load_web_search_injection_fixtures(), ids=lambda f: f["name"])
async def test_fixture_page_content_stays_inert_quarantined_data(fixture: dict[str, Any]) -> None:
    """The fixture's canary/injection payload appears ONLY inside `snippet`, never elevates the envelope structure."""
    canary = extract_canary(fixture["pageHtml"])
    assert canary is not None

    executor = _make_executor(page_html=fixture["pageHtml"])
    result = await executor.execute(name="web_search", arguments={"query": "probe"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False, f"fixture {fixture['name']!r} unexpectedly errored: {result.content}"

    envelope = json.loads(result.content)
    assert set(envelope.keys()) == {"mode", "results"}, (
        f"fixture {fixture['name']!r} elevated the injected page content into new top-level envelope keys"
    )
    assert "citations" not in envelope, (
        "web_search results are external URLs, never internal citations (UI-SPEC Judgment Call #7)"
    )

    assert len(envelope["results"]) == 1
    entry = envelope["results"][0]
    assert set(entry.keys()) == {"title", "url", "snippet"}, (
        f"fixture {fixture['name']!r} elevated the injected page content into a new result-level key"
    )
    assert canary in entry["snippet"], (
        f"fixture {fixture['name']!r}'s canary must surface as quarantined snippet DATA -- "
        "web_search legitimately returns fetched page text, unlike search_knowledge's tier gate"
    )

    gate = validate_tool_envelope(result.content)
    assert gate.ok is True, f"fixture {fixture['name']!r}'s envelope failed the structural gate: {gate.reason}"
