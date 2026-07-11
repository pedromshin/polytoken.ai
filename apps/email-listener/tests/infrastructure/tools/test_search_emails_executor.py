"""Tests for SearchEmailsExecutor -- thin wrapper over find_similar_confirmed() (Phase 36, TOOL-02).

7 behaviors, each independently selectable via `-k`:
  1. happy path -> merges across entity types, dedupes by resulting email, ranked, capped at 5 emails.
  2. tenant defense-in-depth -> a cross-tenant component/email is skipped entirely.
  3. tier2 (never raw body) -> a marker string planted in the raw source fixtures never leaks.
  4. empty/missing/whitespace-only query -> is_error, zero repo calls.
  5. no active entity types / no confirmed matches -> empty, non-error envelope.
  6. any collaborator exception -> is_error, never raises, no internals leaked.
  7. citations[] shape -- one entry per distinct email id, server-built route.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.entities.entity_type import EntityType
from app.domain.ports.retrieval_port import RetrievedExample
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS
from app.infrastructure.tools.search_emails_executor import SearchEmailsExecutor

_IMPORTER_ID = "imp-0000-0000-0000-000000000001"
_OTHER_IMPORTER_ID = "imp-0000-0000-0000-000000000002"
_ENTITY_TYPE_A = "etype-0000-0000-0000-000000000001"
_ENTITY_TYPE_B = "etype-0000-0000-0000-000000000002"

_RECEIVED_AT = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)


def _entity_type(entity_type_id: str, slug: str = "shipment") -> EntityType:
    return EntityType(
        id=entity_type_id,
        importer_id=None,
        slug=slug,
        label=slug.title(),
        description=None,
        is_active=True,
        embedding=None,
        fields=(),
    )


def _component(component_id: str, *, email_id: str, importer_id: str = _IMPORTER_ID) -> Component:
    return Component(
        id=component_id,
        email_id=email_id,
        importer_id=importer_id,
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


def _email(
    email_id: str,
    *,
    importer_id: str = _IMPORTER_ID,
    subject: str | None = "Booking confirmation",
    sender_name: str | None = "Alice Exporter",
    sender_address: str = "alice@example.com",
) -> Email:
    return Email(
        id=email_id,
        importer_id=importer_id,
        message_id=f"msg-{email_id}",
        in_reply_to=None,
        references_ids=(),
        received_at=_RECEIVED_AT,
        sender_address=sender_address,
        sender_name=sender_name,
        to_addresses=("importer@example.com",),
        cc_addresses=(),
        subject=subject,
        body_html="<p>ignored by the executor</p>",
        body_text="ignored by the executor",
        raw_storage_key="s3://ignored/by/executor",
        parse_status="parsed",
        parse_error=None,
        parsed_at=_RECEIVED_AT,
        created_at=_RECEIVED_AT,
    )


def _example(component_id: str, *, score: float, extracted_fields: dict[str, object] | None = None) -> RetrievedExample:
    return RetrievedExample(
        component_id=component_id,
        content_text="ignored by the executor",
        extracted_fields=extracted_fields or {"booking_ref": "BOOK123"},
        score=score,
    )


class _FakeRetrieval:
    """Plain async fake keyed by entity_type_id -- mirrors 36-01's _FakeResolutionRepo shape."""

    def __init__(self, examples_by_type: dict[str, list[RetrievedExample]] | None = None) -> None:
        self._examples_by_type = examples_by_type or {}
        self.calls: list[dict[str, Any]] = []

    async def find_similar_confirmed(self, **kwargs: Any) -> list[RetrievedExample]:
        self.calls.append(kwargs)
        return self._examples_by_type.get(kwargs["entity_type_id"], [])


def _make_executor(
    *,
    examples_by_type: dict[str, list[RetrievedExample]] | None = None,
    entity_types: list[EntityType] | None = None,
    components_by_id: dict[str, Component] | None = None,
    emails_by_id: dict[str, Email] | None = None,
    embedding: tuple[float, ...] = (0.1, 0.2),
) -> tuple[SearchEmailsExecutor, _FakeRetrieval, AsyncMock, AsyncMock, AsyncMock, AsyncMock]:
    retrieval = _FakeRetrieval(examples_by_type)

    entity_types_repo = AsyncMock()
    entity_types_repo.list_active.return_value = entity_types if entity_types is not None else [_entity_type(_ENTITY_TYPE_A)]

    components_repo = AsyncMock()
    components_map = components_by_id or {}
    components_repo.find_by_id.side_effect = components_map.get

    emails_repo = AsyncMock()
    emails_map = emails_by_id or {}
    emails_repo.find_by_id.side_effect = emails_map.get

    embedder = AsyncMock()
    embedder.embed.return_value = embedding

    executor = SearchEmailsExecutor(
        retrieval=retrieval,  # type: ignore[arg-type]
        entity_types=entity_types_repo,
        components=components_repo,
        emails=emails_repo,
        embedder=embedder,
    )
    return executor, retrieval, entity_types_repo, components_repo, emails_repo, embedder


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_merges_dedupes_ranks_and_caps_at_five_emails() -> None:
    entity_types = [_entity_type(_ENTITY_TYPE_A, "shipment"), _entity_type(_ENTITY_TYPE_B, "invoice")]
    examples_by_type = {
        _ENTITY_TYPE_A: [
            _example("cmp-1", score=0.9),  # -> email-1 (kept, highest)
            _example("cmp-2", score=0.5),  # -> email-2
            _example("cmp-3", score=0.3),  # -> email-3
            _example("cmp-5", score=0.7),  # -> email-1 (dup, lower score -- must NOT override cmp-1)
        ],
        _ENTITY_TYPE_B: [
            _example("cmp-6", score=0.95),  # -> email-5 (highest overall)
            _example("cmp-4", score=0.75),  # -> email-4
            _example("cmp-7", score=0.6),  # -> email-6 (6th distinct email -- must be dropped by the cap)
        ],
    }
    components_by_id = {
        "cmp-1": _component("cmp-1", email_id="email-1"),
        "cmp-2": _component("cmp-2", email_id="email-2"),
        "cmp-3": _component("cmp-3", email_id="email-3"),
        "cmp-4": _component("cmp-4", email_id="email-4"),
        "cmp-5": _component("cmp-5", email_id="email-1"),
        "cmp-6": _component("cmp-6", email_id="email-5"),
        "cmp-7": _component("cmp-7", email_id="email-6"),
    }
    emails_by_id = {f"email-{i}": _email(f"email-{i}") for i in range(1, 7)}

    executor, retrieval, entity_types_repo, *_rest = _make_executor(
        examples_by_type=examples_by_type,
        entity_types=entity_types,
        components_by_id=components_by_id,
        emails_by_id=emails_by_id,
    )

    result = await executor.execute(name="search_emails", arguments={"query": "container booking"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    results = envelope["results"]
    ids = [r["email_id"] for r in results]
    assert ids == ["email-5", "email-1", "email-4", "email-6", "email-2"], "ranked desc, dedup keeps highest, capped at 5"
    assert len(results) == 5
    assert "email-3" not in ids, "lowest-scoring 6th distinct email must be dropped by the top-5 cap"
    entity_types_repo.list_active.assert_awaited_once_with(_IMPORTER_ID)
    assert len(retrieval.calls) == 2, "one find_similar_confirmed call PER active entity type"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tenant_defense_in_depth_skips_cross_tenant_component_and_email() -> None:
    examples_by_type = {
        _ENTITY_TYPE_A: [
            _example("cmp-cross-component", score=0.9),
            _example("cmp-cross-email", score=0.8),
            _example("cmp-valid", score=0.5),
        ],
    }
    components_by_id = {
        # Component itself belongs to another tenant -- must be skipped.
        "cmp-cross-component": _component("cmp-cross-component", email_id="email-x", importer_id=_OTHER_IMPORTER_ID),
        # Component is fine, but the EMAIL it resolves to belongs to another tenant (hypothetical
        # data-inconsistency scenario) -- must also be skipped (T-36-06 belt-and-suspenders).
        "cmp-cross-email": _component("cmp-cross-email", email_id="email-y"),
        "cmp-valid": _component("cmp-valid", email_id="email-z"),
    }
    emails_by_id = {
        "email-y": _email("email-y", importer_id=_OTHER_IMPORTER_ID),
        "email-z": _email("email-z"),
    }
    executor, *_rest = _make_executor(
        examples_by_type=examples_by_type, components_by_id=components_by_id, emails_by_id=emails_by_id
    )

    result = await executor.execute(name="search_emails", arguments={"query": "anything"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    envelope = json.loads(result.content)
    ids = [r["email_id"] for r in envelope["results"]]
    assert ids == ["email-z"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tier2_never_surfaces_raw_source_text() -> None:
    marker = "SECRET-MARKER-9f3a1c-DO-NOT-LEAK"
    component = _component("cmp-1", email_id="email-1")
    # Plant the marker in BOTH the region's raw text and the email's raw body fields.
    component = Component(**{**component.__dict__, "content_text": marker})
    email = _email("email-1")
    email = Email(**{**email.__dict__, "body_text": marker, "body_html": f"<p>{marker}</p>"})

    examples_by_type = {_ENTITY_TYPE_A: [_example("cmp-1", score=0.9)]}
    components_by_id = {"cmp-1": component}
    emails_by_id = {"email-1": email}
    executor, *_rest = _make_executor(
        examples_by_type=examples_by_type, components_by_id=components_by_id, emails_by_id=emails_by_id
    )

    result = await executor.execute(name="search_emails", arguments={"query": "booking"}, importer_id=_IMPORTER_ID)

    assert result.is_error is False
    assert marker not in result.content
    envelope = json.loads(result.content)
    assert all("content_text" not in result_dict for result_dict in envelope["results"])
    for key in ("content_text", "body_html", "body_text", "raw_storage_key"):
        assert key not in result.content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_query_returns_error_without_repo_calls() -> None:
    for bad_arguments in ({}, {"query": None}, {"query": ""}, {"query": "   "}):
        executor, retrieval, entity_types_repo, components_repo, emails_repo, embedder = _make_executor()

        result = await executor.execute(name="search_emails", arguments=bad_arguments, importer_id=_IMPORTER_ID)

        assert result.is_error is True
        assert result.content
        entity_types_repo.list_active.assert_not_called()
        embedder.embed.assert_not_called()
        components_repo.find_by_id.assert_not_called()
        emails_repo.find_by_id.assert_not_called()
        assert retrieval.calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_active_entity_types_or_no_matches_returns_empty_non_error() -> None:
    # Sub-case A: no active entity types at all.
    executor, *_rest = _make_executor(entity_types=[])
    result = await executor.execute(name="search_emails", arguments={"query": "anything"}, importer_id=_IMPORTER_ID)
    assert result.is_error is False
    envelope = json.loads(result.content)
    assert envelope["results"] == []
    assert envelope["citations"] == []

    # Sub-case B: active entity types exist, but every retrieval call returns [].
    executor2, *_rest2 = _make_executor(entity_types=[_entity_type(_ENTITY_TYPE_A)], examples_by_type={})
    result2 = await executor2.execute(name="search_emails", arguments={"query": "anything"}, importer_id=_IMPORTER_ID)
    assert result2.is_error is False
    envelope2 = json.loads(result2.content)
    assert envelope2["results"] == []
    assert envelope2["citations"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_collaborator_exception_returns_error_never_raises() -> None:
    executor, _retrieval, entity_types_repo, *_rest = _make_executor()
    entity_types_repo.list_active.side_effect = RuntimeError("db exploded, connection string: postgres://secret")

    result = await executor.execute(name="search_emails", arguments={"query": "anything"}, importer_id=_IMPORTER_ID)

    assert result.is_error is True
    assert result.content
    assert "db exploded" not in result.content
    assert "postgres://" not in result.content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_citations_shape_matches_results() -> None:
    examples_by_type = {_ENTITY_TYPE_A: [_example("cmp-1", score=0.9), _example("cmp-2", score=0.5)]}
    components_by_id = {
        "cmp-1": _component("cmp-1", email_id="email-1"),
        "cmp-2": _component("cmp-2", email_id="email-2"),
    }
    emails_by_id = {"email-1": _email("email-1"), "email-2": _email("email-2")}
    executor, *_rest = _make_executor(
        examples_by_type=examples_by_type, components_by_id=components_by_id, emails_by_id=emails_by_id
    )

    result = await executor.execute(name="search_emails", arguments={"query": "booking"}, importer_id=_IMPORTER_ID)

    envelope = json.loads(result.content)
    result_ids = {r["email_id"] for r in envelope["results"]}
    citation_ids = {c["id"] for c in envelope["citations"]}
    assert citation_ids == result_ids
    assert len(envelope["citations"]) == len(result_ids)
    for citation in envelope["citations"]:
        assert citation["kind"] == "email"
        assert citation["route"] == f"/emails/{citation['id']}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_content_is_capped_json() -> None:
    examples_by_type = {_ENTITY_TYPE_A: [_example("cmp-1", score=0.9)]}
    components_by_id = {"cmp-1": _component("cmp-1", email_id="email-1")}
    emails_by_id = {"email-1": _email("email-1")}
    executor, *_rest = _make_executor(
        examples_by_type=examples_by_type, components_by_id=components_by_id, emails_by_id=emails_by_id
    )

    result = await executor.execute(name="search_emails", arguments={"query": "booking"}, importer_id=_IMPORTER_ID)

    parsed = json.loads(result.content)
    assert isinstance(parsed, dict)
    assert "results" in parsed
    assert "citations" in parsed
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
