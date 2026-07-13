"""Tests for the five Supabase repository implementations.

Uses unittest.mock to assert table/op/filter call shapes — no live DB.
Async methods are tested via asyncio.run() since pytest-asyncio is not available.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import MagicMock

from app.domain.entities.attachment import Attachment
from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.entities.entity_type import EntityType, EntityTypeField
from app.domain.entities.extraction_record import ExtractionRecord

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)

SAMPLE_EMAIL = Email(
    id="email-001",
    importer_id="imp-abc",
    message_id="<msg-001@example.com>",
    in_reply_to=None,
    references_ids=(),
    received_at=NOW,
    sender_address="sender@example.com",
    sender_name=None,
    to_addresses=("to@example.com",),
    cc_addresses=(),
    subject="Test",
    body_html=None,
    body_text="hello",
    raw_storage_key=None,
    parse_status="pending",
    parse_error=None,
    parsed_at=None,
    created_at=NOW,
)

SAMPLE_ATTACHMENT = Attachment(
    id="att-001",
    email_id="email-001",
    importer_id="imp-abc",
    filename="invoice.pdf",
    content_type="application/pdf",
    file_ext="pdf",
    size_bytes=1024,
    storage_key="s3/key/invoice.pdf",
    parent_attachment_id=None,
    parse_status="pending",
)

SAMPLE_COMPONENT = Component(
    id="comp-001",
    email_id="email-001",
    importer_id="imp-abc",
    attachment_id="att-001",
    parent_component_id=None,
    source_type="pdf_page",
    location={"page": 1, "bbox": [0, 0, 100, 100]},
    content_text="Invoice text",
    content_markdown=None,
    content_raw=None,
    embedding=(0.1, 0.2, 0.3),
    sequence_index=0,
    extraction_status="pending",
)

SAMPLE_ENTITY_TYPE = EntityType(
    id="et-001",
    importer_id=None,
    slug="bill_of_lading",
    label="Bill of Lading",
    description=None,
    is_active=True,
    embedding=None,
    fields=(
        EntityTypeField(
            id="efield-001",
            slug="bl_number",
            label="BL Number",
            data_type="string",
            is_identifier=True,
            is_required=True,
            description=None,
            sort_order=1,
        ),
    ),
)

SAMPLE_EXTRACTION = ExtractionRecord(
    id="ex-001",
    importer_id="imp-abc",
    component_id="comp-001",
    entity_type_id="et-001",
    extracted_fields={"bl_number": "BL123"},
    confidence_score=0.95,
    confidence_breakdown=None,
    routing_reason=None,
    status="active",
    corrected_fields=None,
    retrieval_context=None,
    created_at=NOW,
    updated_at=NOW,
)


def _make_chain_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a chainable mock for PostgREST-style supabase calls."""
    execute_result = MagicMock()
    execute_result.data = return_data or []
    chain = MagicMock()
    chain.execute.return_value = execute_result
    chain.eq.return_value = chain
    chain.neq.return_value = chain
    chain.is_.return_value = chain
    chain.upsert.return_value = chain
    chain.insert.return_value = chain
    chain.update.return_value = chain
    chain.select.return_value = chain
    chain.delete.return_value = chain
    return chain


def _make_client_mock(return_data: list[dict] | None = None) -> MagicMock:
    """Build a mock supabase Client that chains table().op().execute()."""
    client = MagicMock()
    chain = _make_chain_mock(return_data)
    client.table.return_value = chain
    return client


# ---------------------------------------------------------------------------
# SupabaseEmailRepository
# ---------------------------------------------------------------------------


def test_email_repo_save_calls_upsert_on_conflict() -> None:
    from app.infrastructure.supabase.email_repository import SupabaseEmailRepository

    row = {
        "id": "email-001",
        "importer_id": "imp-abc",
        "message_id": "<msg-001@example.com>",
        "in_reply_to": None,
        "references_ids": [],
        "received_at": NOW.isoformat(),
        "sender_address": "sender@example.com",
        "sender_name": None,
        "to_addresses": ["to@example.com"],
        "cc_addresses": [],
        "subject": "Test",
        "body_html": None,
        "body_text": "hello",
        "raw_storage_key": None,
        "parse_status": "pending",
        "parse_error": None,
        "parsed_at": None,
        "created_at": NOW.isoformat(),
    }
    client = _make_client_mock(return_data=[row])
    repo = SupabaseEmailRepository(client)
    result = asyncio.run(repo.save(SAMPLE_EMAIL))

    client.table.assert_called_with("emails")
    chain = client.table.return_value
    assert chain.upsert.called, "save must call upsert"
    upsert_call = chain.upsert.call_args
    # on_conflict must include the conflict columns
    all_args = list(upsert_call.args) + list(upsert_call.kwargs.values())
    assert any("importer_id,message_id" in str(a) for a in all_args), (
        f"on_conflict='importer_id,message_id' expected, got: {upsert_call}"
    )
    assert result.id == "email-001"


def test_email_repo_find_by_message_id_filters_importer_id() -> None:
    from app.infrastructure.supabase.email_repository import SupabaseEmailRepository

    client = _make_client_mock(return_data=[])
    repo = SupabaseEmailRepository(client)
    asyncio.run(repo.find_by_message_id("imp-abc", "<msg-001@example.com>"))

    chain = client.table.return_value
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    combined = " ".join(eq_calls)
    assert "importer_id" in combined, f"importer_id filter missing from: {eq_calls}"
    assert "message_id" in combined, f"message_id filter missing from: {eq_calls}"


# ---------------------------------------------------------------------------
# SupabaseComponentRepository
# ---------------------------------------------------------------------------


def test_component_repo_save_many_upserts_list() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    row = {
        "id": "comp-001",
        "email_id": "email-001",
        "importer_id": "imp-abc",
        "attachment_id": "att-001",
        "parent_component_id": None,
        "source_type": "pdf_page",
        "location": {"page": 1, "bbox": [0, 0, 100, 100]},
        "content_text": "Invoice text",
        "content_markdown": None,
        "content_raw": None,
        "embedding": [0.1, 0.2, 0.3],
        "sequence_index": 0,
        "extraction_status": "pending",
    }
    client = _make_client_mock(return_data=[row])
    repo = SupabaseComponentRepository(client)
    result = asyncio.run(repo.save_many([SAMPLE_COMPONENT]))

    client.table.assert_called_with("email_components")
    chain = client.table.return_value
    assert chain.upsert.called, "save_many must call upsert"
    # Embedding tuple serialized to list
    upsert_payload = chain.upsert.call_args.args[0]
    assert isinstance(upsert_payload, list)
    assert isinstance(upsert_payload[0]["embedding"], list), "embedding must be serialized to list[float]"
    assert len(result) == 1


def test_component_repo_find_by_email_id_filters_email_id() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[])
    repo = SupabaseComponentRepository(client)
    asyncio.run(repo.find_by_email_id("email-001"))

    chain = client.table.return_value
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    assert any("email_id" in c for c in eq_calls), f"email_id filter missing: {eq_calls}"


def test_component_repo_find_by_page_component_id_filters_parent() -> None:
    """find_by_page_component_id must query by parent_component_id and map rows.

    Regression for the prod 500: AutofillFieldsUseCase calls this on its main path
    but the Supabase impl never implemented it (AttributeError -> 500). Fake-repo
    use-case tests masked it; this asserts the real query shape + row mapping.
    """
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[_RELATIONSHIP_ROW])
    repo = SupabaseComponentRepository(client)
    result = asyncio.run(repo.find_by_page_component_id("parent-001"))

    client.table.assert_called_with("email_components")
    chain = client.table.return_value
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    assert any("parent_component_id" in c for c in eq_calls), f"parent_component_id filter missing: {eq_calls}"
    assert len(result) == 1
    assert result[0].id == "comp-001"


def test_supabase_component_repo_implements_full_port() -> None:
    """Every ComponentRepository port method must exist on the Supabase impl.

    Class-level guard for the 09-gap CRIT-1 "fake-repo hides a real-row 500":
    dishka registers the concrete repo against the Protocol at runtime and mypy
    does not verify structural conformance there, so a port method with no impl
    (find_by_page_component_id) shipped a 500. This fails fast if any port method
    is left unimplemented in the future.
    """
    from app.domain.ports.component_repository import ComponentRepository
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    port_methods = {
        name
        for name in dir(ComponentRepository)
        if not name.startswith("_") and callable(getattr(ComponentRepository, name))
    }
    missing = sorted(m for m in port_methods if not hasattr(SupabaseComponentRepository, m))
    assert not missing, f"SupabaseComponentRepository missing port methods: {missing}"


# ---------------------------------------------------------------------------
# SupabaseComponentRepository: relationship write methods — real-row payload shape
# (TEST-DEBT 09-gap D1 — the CRIT-1 "fake-repo hides a real-row 500" class).
# These assert the EXACT column KEYS written so a schema/column drift fails the
# test (mirrors the prior data_type regression). Each row returned mirrors the
# email_components schema so _from_row maps cleanly.
# ---------------------------------------------------------------------------

_RELATIONSHIP_ROW = {
    "id": "comp-001",
    "email_id": "email-001",
    "importer_id": "imp-abc",
    "attachment_id": "att-001",
    "parent_component_id": "parent-001",
    "source_type": "region",
    "location": {"page_index": 0, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]},
    "content_text": "x",
    "content_markdown": None,
    "content_raw": None,
    "embedding": None,
    "sequence_index": 0,
    "extraction_status": "candidate",
    "role": "entity",
    "entity_type_id": "et-001",
    "entity_type_field_id": None,
}


def test_component_repo_update_role_writes_role_column() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[_RELATIONSHIP_ROW])
    repo = SupabaseComponentRepository(client)
    asyncio.run(repo.update_role("comp-001", "entity"))

    client.table.assert_called_with("email_components")
    chain = client.table.return_value
    payload = chain.update.call_args.args[0]
    # Exactly the `role` column — drift to any other key fails here.
    assert set(payload.keys()) == {"role"}, f"update_role must write only role: {payload}"
    assert payload["role"] == "entity"
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    assert any("id" in c for c in eq_calls), f"id filter missing: {eq_calls}"


def test_component_repo_update_entity_type_writes_entity_type_id_column() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[_RELATIONSHIP_ROW])
    repo = SupabaseComponentRepository(client)
    asyncio.run(repo.update_entity_type("comp-001", "et-001"))

    chain = client.table.return_value
    payload = chain.update.call_args.args[0]
    assert set(payload.keys()) == {"entity_type_id"}, f"update_entity_type must write only entity_type_id: {payload}"
    assert payload["entity_type_id"] == "et-001"


def test_component_repo_update_field_relationship_writes_both_fk_columns() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[_RELATIONSHIP_ROW])
    repo = SupabaseComponentRepository(client)
    asyncio.run(repo.update_field_relationship("comp-001", "parent-001", "field-001"))

    chain = client.table.return_value
    payload = chain.update.call_args.args[0]
    # The two D-04/D-11 FK columns are written together — and ONLY those.
    assert set(payload.keys()) == {
        "parent_component_id",
        "entity_type_field_id",
    }, f"update_field_relationship column drift: {payload}"
    assert payload["parent_component_id"] == "parent-001"
    assert payload["entity_type_field_id"] == "field-001"


def test_component_repo_clear_candidate_fields_clears_only_entity_type_field_id() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    client = _make_client_mock(return_data=[_RELATIONSHIP_ROW])
    repo = SupabaseComponentRepository(client)
    asyncio.run(repo.clear_candidate_fields("comp-001"))

    chain = client.table.return_value
    payload = chain.update.call_args.args[0]
    assert set(payload.keys()) == {"entity_type_field_id"}, f"clear_candidate_fields drift: {payload}"
    assert payload["entity_type_field_id"] is None


def test_component_repo_append_denied_polygon_calls_rpc_with_named_params() -> None:
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data=[])
    client = MagicMock()
    client.rpc.return_value = rpc_chain

    repo = SupabaseComponentRepository(client)
    polygon = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]]
    asyncio.run(repo.append_denied_polygon("parent-001", polygon))

    # MEDIUM-4: a single server-side RPC (atomic jsonb append), never a table write.
    client.rpc.assert_called_once()
    name, params = client.rpc.call_args.args
    assert name == "append_denied_polygon"
    assert set(params.keys()) == {"p_component_id", "p_polygon"}, f"RPC param drift: {params}"
    assert params["p_component_id"] == "parent-001"
    assert params["p_polygon"] == polygon
    # It must NOT fall back to a full-row table upsert (the lost-update path).
    client.table.assert_not_called()


# ---------------------------------------------------------------------------
# SupabaseExtractionRepository: supersede_active — update not delete
# ---------------------------------------------------------------------------


def test_extraction_repo_supersede_active_updates_not_deletes() -> None:
    from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository

    client = _make_client_mock()
    repo = SupabaseExtractionRepository(client)
    asyncio.run(repo.supersede_active("comp-001"))

    chain = client.table.return_value
    assert chain.update.called, "supersede_active must call update()"
    assert not chain.delete.called, "supersede_active must NOT call delete()"
    # status must be set to "superseded"
    update_args = chain.update.call_args.args[0]
    assert update_args.get("status") == "superseded", f"Expected status='superseded', got: {update_args}"
    # filtered by component_id
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    assert any("component_id" in c for c in eq_calls), f"component_id filter missing: {eq_calls}"


# ---------------------------------------------------------------------------
# SupabaseEntityTypeRepository: importer_id=None matches system defaults
# ---------------------------------------------------------------------------


def test_entity_type_repo_find_by_slug_with_none_importer_id() -> None:
    from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository

    row = {
        "id": "et-001",
        "importer_id": None,
        "slug": "bill_of_lading",
        "label": "Bill of Lading",
        "description": None,
        "is_active": True,
        "embedding": None,
        "entity_type_fields": [],
    }
    client = _make_client_mock(return_data=[row])
    repo = SupabaseEntityTypeRepository(client)
    result = asyncio.run(repo.find_by_slug(None, "bill_of_lading"))

    assert result is not None
    assert result.slug == "bill_of_lading"
    assert result.importer_id is None


# ---------------------------------------------------------------------------
# SupabaseEntityInstanceRepository: co-occurrence + selected-instance reads (29-03)
# ---------------------------------------------------------------------------


_ENTITY_COMPONENT_ROW = {
    "id": "comp-002",
    "email_id": "email-001",
    "importer_id": "imp-abc",
    "attachment_id": None,
    "parent_component_id": None,
    "source_type": "region",
    "location": {"page_index": 0, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]},
    "content_text": "Acme Corp",
    "content_markdown": None,
    "content_raw": None,
    "embedding": None,
    "sequence_index": 0,
    "extraction_status": "confirmed",
    "role": "entity",
    "entity_type_id": "et-001",
    "entity_type_field_id": None,
}

_ENTITY_INSTANCE_ROW = {
    "id": "ei-001",
    "importer_id": "imp-abc",
    "entity_type_id": "et-001",
    "nauta_id": None,
    "source": "email_extracted",
    "display_name": "Acme Corp",
    "identifiers": {},
    "aliases": [],
    "summary_text": None,
    "embedding": None,
    "is_active": True,
}


def test_entity_instance_repo_find_confirmed_entity_components_for_email_filters_email_scope() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    client = _make_client_mock(return_data=[_ENTITY_COMPONENT_ROW])
    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_confirmed_entity_components_for_email("email-001"))

    client.table.assert_called_with("email_components")
    chain = client.table.return_value
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    assert any("email_id" in c for c in eq_calls), f"email_id filter missing: {eq_calls}"
    assert any("role" in c and "entity" in c for c in eq_calls), f"role='entity' filter missing: {eq_calls}"
    assert any("extraction_status" in c and "confirmed" in c for c in eq_calls), (
        f"extraction_status='confirmed' filter missing: {eq_calls}"
    )
    assert len(result) == 1
    assert result[0].id == "comp-002"


def test_entity_instance_repo_find_selected_instance_for_component_filters_was_selected() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    link_chain = _make_chain_mock(return_data=[{"entity_instance_id": "ei-001"}])
    instance_chain = _make_chain_mock(return_data=[_ENTITY_INSTANCE_ROW])

    client = MagicMock()

    def _table(name: str) -> MagicMock:
        if name == "component_entity_candidate_links":
            return link_chain
        if name == "entity_instances":
            return instance_chain
        raise AssertionError(f"unexpected table: {name}")

    client.table.side_effect = _table

    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_selected_instance_for_component("comp-002"))

    eq_calls = [str(c) for c in link_chain.eq.call_args_list]
    assert any("component_id" in c for c in eq_calls), f"component_id filter missing: {eq_calls}"
    assert any("was_selected" in c and "True" in c for c in eq_calls), f"was_selected=True filter missing: {eq_calls}"
    assert result is not None
    assert result.id == "ei-001"


def test_entity_instance_repo_find_selected_instance_for_component_returns_none_when_absent() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    client = _make_client_mock(return_data=[])
    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_selected_instance_for_component("comp-002"))

    assert result is None


def test_entity_instance_repo_find_unconfirmed_entity_components_for_email_filters_neq_confirmed() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    client = _make_client_mock(return_data=[_ENTITY_COMPONENT_ROW])
    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_unconfirmed_entity_components_for_email("email-001"))

    client.table.assert_called_with("email_components")
    chain = client.table.return_value
    eq_calls = [str(c) for c in chain.eq.call_args_list]
    neq_calls = [str(c) for c in chain.neq.call_args_list]
    assert any("email_id" in c for c in eq_calls), f"email_id filter missing: {eq_calls}"
    assert any("role" in c and "entity" in c for c in eq_calls), f"role='entity' filter missing: {eq_calls}"
    assert any("extraction_status" in c and "confirmed" in c for c in neq_calls), (
        f"extraction_status neq 'confirmed' filter missing: {neq_calls}"
    )
    assert len(result) == 1
    assert result[0].id == "comp-002"


def test_entity_instance_repo_find_unselected_candidate_instances_for_component_resolves_each() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    link_chain = _make_chain_mock(return_data=[{"entity_instance_id": "ei-001"}])
    instance_chain = _make_chain_mock(return_data=[_ENTITY_INSTANCE_ROW])

    client = MagicMock()

    def _table(name: str) -> MagicMock:
        if name == "component_entity_candidate_links":
            return link_chain
        if name == "entity_instances":
            return instance_chain
        raise AssertionError(f"unexpected table: {name}")

    client.table.side_effect = _table

    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_unselected_candidate_instances_for_component("comp-002"))

    eq_calls = [str(c) for c in link_chain.eq.call_args_list]
    assert any("component_id" in c for c in eq_calls), f"component_id filter missing: {eq_calls}"
    assert any("was_selected" in c and "False" in c for c in eq_calls), f"was_selected=False filter missing: {eq_calls}"
    assert len(result) == 1
    assert result[0].id == "ei-001"


def test_entity_instance_repo_find_unselected_candidate_instances_drops_unresolved() -> None:
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository

    link_chain = _make_chain_mock(return_data=[{"entity_instance_id": "ei-missing"}])
    instance_chain = _make_chain_mock(return_data=[])

    client = MagicMock()

    def _table(name: str) -> MagicMock:
        if name == "component_entity_candidate_links":
            return link_chain
        if name == "entity_instances":
            return instance_chain
        raise AssertionError(f"unexpected table: {name}")

    client.table.side_effect = _table

    repo = SupabaseEntityInstanceRepository(client)
    result = asyncio.run(repo.find_unselected_candidate_instances_for_component("comp-002"))

    assert result == []
