"""Contract tests: every real, container-registered ToolExecutor satisfies QUAR-01 (Phase 38-01).

Parameterized over 5 cases:
  3 "happy path" -- one representative real `.execute()` call per real
    executor (lookup_entity id-hit, search_emails 2+ results, search_knowledge
    search-mode with one EXTRACTED + one non-EXTRACTED row in the SAME
    response) -- proves the 3 currently-wired production executors already
    satisfy the envelope contract today (the regression proof QUAR-01 needs).
  2 "hostile" -- proves the gate itself independently catches a violation
    even though no real executor currently produces one: (i) 37-02's exact
    hostile-row shape (a non-EXTRACTED tier with a populated `label` --
    what `_belt_two_label`'s absence WOULD produce, if belt 2 ever
    regressed) fed directly to `validate_tool_envelope`; (ii) a citation
    whose `route` doesn't match its `kind`'s canonical template.

Plus one companion test asserting the exact set of tool names resolvable
from `container.py`'s real `create_container()` is
`{"lookup_entity", "search_emails", "search_knowledge", "web_search"}` --
documents WHY exactly 4, not N, executors are contract-tested
(`EchoToolExecutor` is test-only and intentionally excluded per
38-CONTEXT.md). Mirrors `test_container.py`'s
`TestSearchKnowledgeExposureGate`/`TestWebSearchExposureGate`'s exact
`monkeypatch.setenv(...)` + `get_settings.cache_clear()` before/after
pattern. `web_search`'s own envelope-contract proof (QUAR-01 applied to
fetched-page content) lives in `tests/evals/test_web_search_injection_suite.py`
-- not duplicated into this file's 3 "happy path" parameterized cases above,
which predate Phase 54 and stay scoped to the original 3 tenant-data
executors.

Executors are constructed directly with hand-built fake collaborators
(mirrors each executor's own test file's established pattern -- NOT
resolved from the real dishka container with a MagicMock'd Supabase client,
whose `.execute()` calls would hit an unusable Mock rather than exercising
real logic).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.container import create_container
from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.entities.entity_instance import EntityInstance
from app.domain.entities.entity_type import EntityType
from app.domain.ports.entity_resolution_repository import EntityCandidate
from app.domain.ports.retrieval_port import RetrievedExample
from app.domain.services.tool_envelope_gate import validate_tool_envelope
from app.infrastructure.tools.lookup_entity_executor import LOOKUP_ENTITY_TOOL_NAME, LookupEntityExecutor
from app.infrastructure.tools.search_emails_executor import SEARCH_EMAILS_TOOL_NAME, SearchEmailsExecutor
from app.infrastructure.tools.search_knowledge_executor import SEARCH_KNOWLEDGE_TOOL_NAME, SearchKnowledgeExecutor
from app.infrastructure.tools.web_search_executor import WEB_SEARCH_TOOL_NAME
from app.settings import get_settings

_IMPORTER_ID = "imp-0000-0000-0000-000000000001"
_RECEIVED_AT = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)

_ContentFactory = Callable[[], Awaitable[str]]


# ---------------------------------------------------------------------------
# Happy-path content factories -- one representative real `.execute()` call
# per real, container-registered executor (fake collaborators only, hand-built
# per each executor's own established test-file pattern).
# ---------------------------------------------------------------------------


class _FakeResolutionRepo:
    """Plain (non-Mock) SYNCHRONOUS fake -- mirrors test_lookup_entity_executor.py's convention."""

    def __init__(self, candidates: list[EntityCandidate]) -> None:
        self._candidates = candidates

    def find_candidates(self, **kwargs: Any) -> list[EntityCandidate]:
        del kwargs
        return self._candidates


async def _lookup_entity_happy_content() -> str:
    instance = EntityInstance(
        id="ent-0000-0000-0000-000000000001",
        importer_id=_IMPORTER_ID,
        entity_type_id="etype-0000-0000-0000-000000000001",
        nauta_id=None,
        source="email_extracted",
        display_name="Acme Corp",
        identifiers={"tax_id": "123"},
        aliases=[],
        summary_text=None,
        embedding=None,
        is_active=True,
    )
    entity_instances = AsyncMock()
    entity_instances.find_by_id.return_value = instance

    resolution_repo = _FakeResolutionRepo(
        candidates=[
            EntityCandidate(
                entity_instance_id="ent-0000-0000-0000-000000000002",
                display_name="Acme Corp Subsidiary",
                rrf_score=0.02,
                match_type="alias",
                similarity_score=0.8,
            )
        ]
    )
    entity_types_repo = AsyncMock()
    entity_types_repo.list_active.return_value = []
    embedder = AsyncMock()
    embedder.embed.return_value = (0.1, 0.2)

    executor = LookupEntityExecutor(
        entity_instances=entity_instances,
        resolution_repo=resolution_repo,
        entity_types=entity_types_repo,
        embedder=embedder,
    )
    result = await executor.execute(
        name=LOOKUP_ENTITY_TOOL_NAME, arguments={"name_or_id": instance.id}, importer_id=_IMPORTER_ID
    )
    assert result.is_error is False
    return result.content


class _FakeRetrieval:
    """Plain async fake -- mirrors test_search_emails_executor.py's convention."""

    def __init__(self, examples: list[RetrievedExample]) -> None:
        self._examples = examples

    async def find_similar_confirmed(self, **kwargs: Any) -> list[RetrievedExample]:
        del kwargs
        return self._examples


def _email_fixture(email_id: str) -> Email:
    return Email(
        id=email_id,
        importer_id=_IMPORTER_ID,
        message_id=f"msg-{email_id}",
        in_reply_to=None,
        references_ids=(),
        received_at=_RECEIVED_AT,
        sender_address="alice@example.com",
        sender_name="Alice Exporter",
        to_addresses=("importer@example.com",),
        cc_addresses=(),
        subject="Booking confirmation",
        body_html="<p>ignored by the executor</p>",
        body_text="ignored by the executor",
        raw_storage_key="s3://ignored/by/executor",
        parse_status="parsed",
        parse_error=None,
        parsed_at=_RECEIVED_AT,
        created_at=_RECEIVED_AT,
    )


def _component_fixture(component_id: str, *, email_id: str) -> Component:
    return Component(
        id=component_id,
        email_id=email_id,
        importer_id=_IMPORTER_ID,
        attachment_id=None,
        parent_component_id=None,
        source_type="region",
        location={},
        content_text="ignored by the executor",
        content_markdown=None,
        content_raw=None,
        embedding=None,
        sequence_index=0,
        extraction_status="confirmed",
        role="entity",
    )


async def _search_emails_happy_content() -> str:
    entity_type = EntityType(
        id="etype-0000-0000-0000-000000000002",
        importer_id=None,
        slug="shipment",
        label="Shipment",
        description=None,
        is_active=True,
        embedding=None,
        fields=(),
    )
    entity_types_repo = AsyncMock()
    entity_types_repo.list_active.return_value = [entity_type]

    examples = [
        RetrievedExample(
            component_id="cmp-1", content_text="ignored", extracted_fields={"booking_ref": "BOOK1"}, score=0.9
        ),
        RetrievedExample(
            component_id="cmp-2", content_text="ignored", extracted_fields={"booking_ref": "BOOK2"}, score=0.5
        ),
    ]

    components_by_id = {
        "cmp-1": _component_fixture("cmp-1", email_id="email-1"),
        "cmp-2": _component_fixture("cmp-2", email_id="email-2"),
    }
    components_repo = AsyncMock()
    components_repo.find_by_id.side_effect = components_by_id.get

    emails_by_id = {"email-1": _email_fixture("email-1"), "email-2": _email_fixture("email-2")}
    emails_repo = AsyncMock()
    emails_repo.find_by_id.side_effect = emails_by_id.get

    embedder = AsyncMock()
    embedder.embed.return_value = (0.1, 0.2)

    executor = SearchEmailsExecutor(
        retrieval=_FakeRetrieval(examples),  # type: ignore[arg-type]
        entity_types=entity_types_repo,
        components=components_repo,
        emails=emails_repo,
        embedder=embedder,
    )
    result = await executor.execute(
        name=SEARCH_EMAILS_TOOL_NAME, arguments={"query": "booking terms"}, importer_id=_IMPORTER_ID
    )
    assert result.is_error is False
    envelope = json.loads(result.content)
    assert len(envelope["results"]) >= 2, "happy-path fixture must exercise 2+ results"
    return result.content


async def _search_knowledge_happy_content() -> str:
    knowledge = AsyncMock()
    # One EXTRACTED row (label surfaces) + one non-EXTRACTED row (label
    # omitted by belt 2) in the SAME response -- the plan's exact fixture.
    knowledge.search_nodes.return_value = [
        {
            "id": "node-a",
            "title": "Confirmed knowledge title",
            "content": None,
            "scope": "region",
            "scope_ref_id": "region-a",
            "tier": "EXTRACTED",
            "confidence": 0.9,
        },
        {
            "id": "node-b",
            "title": None,
            "content": None,
            "scope": "region",
            "scope_ref_id": "region-b",
            "tier": "AMBIGUOUS",
            "confidence": 0.3,
        },
    ]
    embedder = AsyncMock()
    embedder.embed.return_value = (0.1, 0.2)

    executor = SearchKnowledgeExecutor(knowledge=knowledge, embedder=embedder)
    result = await executor.execute(
        name=SEARCH_KNOWLEDGE_TOOL_NAME,
        arguments={"mode": "search", "query": "booking terms"},
        importer_id=_IMPORTER_ID,
    )
    assert result.is_error is False
    envelope = json.loads(result.content)
    assert len(envelope["results"]) == 2, "happy-path fixture must exercise both an EXTRACTED and a non-EXTRACTED row"
    return result.content


# ---------------------------------------------------------------------------
# Hostile content factories -- prove the gate independently catches a
# violation, even though no real executor currently produces one.
# ---------------------------------------------------------------------------


async def _hostile_belt_two_regression_content() -> str:
    """37-02's exact hostile-row shape: a non-EXTRACTED tier WITH a populated label.

    `SearchKnowledgeExecutor`'s own belt 2 (`_belt_two_label`) can never
    actually produce this today -- this hand-builds the envelope the way a
    FUTURE regression in belt 2 WOULD produce it, proving the gate (belt 4)
    catches it independently.
    """
    return json.dumps(
        {
            "mode": "search",
            "results": [
                {
                    "node_id": "node-x",
                    "label": "LEAKED-SUGGESTION-TEXT",
                    "tier": "AMBIGUOUS",
                    "confidence": 0.3,
                    "source_region_id": "region-x",
                }
            ],
            "citations": [],
        }
    )


async def _hostile_citation_spoof_content() -> str:
    """A citations[] entry whose route doesn't match its kind's canonical template."""
    return json.dumps(
        {
            "results": [],
            "citations": [{"kind": "entity", "id": "e1", "route": "/knowledge?focus=e1"}],
        }
    )


_CONTRACT_CASES: list[tuple[str, _ContentFactory, bool]] = [
    ("lookup_entity_happy_path", _lookup_entity_happy_content, True),
    ("search_emails_happy_path", _search_emails_happy_content, True),
    ("search_knowledge_happy_path", _search_knowledge_happy_content, True),
    ("hostile_belt_two_regression", _hostile_belt_two_regression_content, False),
    ("hostile_citation_spoof", _hostile_citation_spoof_content, False),
]


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case_name", "content_factory", "expected_ok"),
    _CONTRACT_CASES,
    ids=[case[0] for case in _CONTRACT_CASES],
)
async def test_envelope_gate_contract(case_name: str, content_factory: _ContentFactory, expected_ok: bool) -> None:
    content = await content_factory()

    outcome = validate_tool_envelope(content)

    assert outcome.ok is expected_ok, case_name


# ---------------------------------------------------------------------------
# Companion test: exactly 3 real, container-registered executors -- documents
# why exactly 3, not N, executors are contract-tested above.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_container_resolves_exactly_the_four_real_tool_executors(monkeypatch: pytest.MonkeyPatch) -> None:
    """EchoToolExecutor is test-only and intentionally excluded from this contract (38-CONTEXT.md).

    Mirrors test_container.py's TestSearchKnowledgeExposureGate/
    TestWebSearchExposureGate's exact monkeypatch.setenv(...) +
    get_settings.cache_clear() before/after pattern -- forces both
    search_knowledge and web_search into scope so all 4 real executors are
    resolvable in one assertion (Phase 54-02 added web_search as the 4th).
    """
    monkeypatch.setenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", "true")
    monkeypatch.setenv("WEB_SEARCH_TOOL_ENABLED", "true")
    get_settings.cache_clear()
    try:
        with (
            patch("app.container.get_supabase_client", return_value=MagicMock()),
            patch("app.container.get_anthropic_client", return_value=MagicMock()),
            patch("app.container.boto3") as boto3_mock,
        ):
            boto3_mock.client.return_value = MagicMock()
            container = create_container()
            run_chat_turn = asyncio.run(container.get(RunChatTurn))

        assert set(run_chat_turn._tool_executors.keys()) == {
            LOOKUP_ENTITY_TOOL_NAME,
            SEARCH_EMAILS_TOOL_NAME,
            SEARCH_KNOWLEDGE_TOOL_NAME,
            WEB_SEARCH_TOOL_NAME,
        }
    finally:
        get_settings.cache_clear()
