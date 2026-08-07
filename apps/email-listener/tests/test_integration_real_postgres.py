"""Real-Postgres integration test: parse → persist → read-back against live Supabase.

The fake-repo unit suite never touches Postgres, which hid three live bugs
(NUL bytes → 22P05, missing enum values → 22P02, importer-scoped reads hiding
real data). This test exercises the exact persistence path with the real
Supabase client against a disposable importer, then cleans up after itself.

Gated behind explicit env vars so it can NEVER hit staging/prod by accident:

    INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321 \
    INTEGRATION_SUPABASE_SERVICE_KEY=<service_role key> \
    uv run pytest tests/test_integration_real_postgres.py -m integration --no-cov
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Any

import pytest

from app.domain.entities.attachment import Attachment
from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.entities.extraction_record import ExtractionRecord

INTEGRATION_URL = os.environ.get("INTEGRATION_SUPABASE_URL", "")
INTEGRATION_KEY = os.environ.get("INTEGRATION_SUPABASE_SERVICE_KEY", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (INTEGRATION_URL and INTEGRATION_KEY),
        reason="INTEGRATION_SUPABASE_URL / INTEGRATION_SUPABASE_SERVICE_KEY not set",
    ),
]

_CORPUS_PDF = Path(__file__).parent / "corpus" / "logistics_vocab" / "commercial_invoice_template.pdf"
_SENDER = "it-pipeline@integration-test.example"


class _NeverOcr:
    """OCR stub that fails loudly — corpus template PDFs have a text layer."""

    async def ocr_page(self, *, image_bytes: bytes) -> list[object]:
        raise AssertionError("OCR must not be called for a text-layer PDF")


def _client():  # type: ignore[no-untyped-def] # supabase Client typing is loose
    from supabase import create_client

    return create_client(INTEGRATION_URL, INTEGRATION_KEY)


async def _seed_email_and_attachment(
    email_repo: object,
    attachment_repo: object,
    *,
    importer_id: str,
    email_id: str,
    attachment_id: str,
    pdf_bytes: bytes,
    now: datetime,
) -> None:
    """Persist the parent email + attachment rows under the resolved importer."""
    await email_repo.save(  # type: ignore[attr-defined]
        Email(
            id=email_id,
            importer_id=importer_id,
            message_id=f"<{email_id}@integration-test.example>",
            in_reply_to=None,
            references_ids=(),
            received_at=now,
            sender_address=_SENDER,
            sender_name="Integration Test",
            to_addresses=("agent@magnitudetech.com.br",),
            cc_addresses=(),
            subject="integration: parse->persist",
            body_html=None,
            body_text="see attachment",
            raw_storage_key=f"inbound/integration/{email_id}",
            parse_status="received",
            parse_error=None,
            parsed_at=None,
            created_at=now,
        )
    )
    await attachment_repo.save(  # type: ignore[attr-defined]
        Attachment(
            id=attachment_id,
            email_id=email_id,
            importer_id=importer_id,
            filename="commercial_invoice_template.pdf",
            content_type="application/pdf",
            file_ext="pdf",
            size_bytes=len(pdf_bytes),
            storage_key=f"{importer_id}/{email_id}/{attachment_id}/invoice.pdf",
            parent_attachment_id=None,
            parse_status="pending",
        )
    )


def _find_or_create_entity_type(client: object) -> tuple[str, str | None]:
    """Return (entity_type_id, created_id) — created_id set only when inserted here."""
    existing = client.table("entity_types").select("id").limit(1).execute()  # type: ignore[attr-defined]
    if existing.data:
        return str(existing.data[0]["id"]), None
    created = (
        client.table("entity_types")  # type: ignore[attr-defined]
        .insert(
            {
                "importer_id": None,
                "slug": f"it-{uuid.uuid4().hex[:8]}",
                "label": "Integration Test Type",
                "description": "disposable",
                "is_active": False,
            }
        )
        .execute()
    )
    created_id = str(created.data[0]["id"])
    return created_id, created_id


async def _persist_components(
    component_repo: object,
    parsed: list[object],
    *,
    email_id: str,
    importer_id: str,
) -> list[str]:
    """Stitch ids, inject NUL text + an 'error' status component, persist, assert round-trip."""
    stitched = [replace(c, email_id=email_id, importer_id=importer_id) for c in parsed]  # type: ignore[type-var]
    stitched[0] = replace(stitched[0], content_text=stitched[0].content_text + "\x00tail")
    error_component = replace(
        stitched[0],
        id=str(uuid.uuid4()),
        content_text="boom\x00",
        extraction_status="error",
        sequence_index=len(stitched),
    )
    to_persist = [*stitched, error_component]

    persisted = await component_repo.save_many(to_persist)  # type: ignore[attr-defined]
    assert len(persisted) == len(to_persist)
    assert all("\x00" not in c.content_text for c in persisted)
    statuses = {c.extraction_status for c in persisted}
    assert {"pending", "error"} <= statuses  # both enum values round-trip
    return [c.id for c in to_persist]


async def _run_pipeline() -> None:
    from app.infrastructure.pdf.pdf_parser import PdfParser
    from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
    from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
    from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _client()
    email_repo = SupabaseEmailRepository(client)
    attachment_repo = SupabaseAttachmentRepository(client)
    component_repo = SupabaseComponentRepository(client)
    extraction_repo = SupabaseExtractionRepository(client)
    importer_repo = SupabaseImporterRepository(
        client=client,
        default_importer_id="00000000-0000-0000-0000-000000000001",
    )

    email_id = str(uuid.uuid4())
    attachment_id = str(uuid.uuid4())
    record_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    component_ids: list[str] = []
    created_entity_type_id: str | None = None

    try:
        # 1. Sender → importer find-or-create (D-05); not the default importer
        importer_id = await importer_repo.resolve(_SENDER)
        assert importer_id != "00000000-0000-0000-0000-000000000001"

        # 2. Persist email + attachment under the sender-resolved importer
        pdf_bytes = _CORPUS_PDF.read_bytes()
        await _seed_email_and_attachment(
            email_repo,
            attachment_repo,
            importer_id=importer_id,
            email_id=email_id,
            attachment_id=attachment_id,
            pdf_bytes=pdf_bytes,
            now=now,
        )

        # 3. Parse the real corpus PDF (text layer, real token geometry)
        parser = PdfParser(ocr=_NeverOcr())  # type: ignore[arg-type]
        parsed = await parser.parse(
            file_bytes=pdf_bytes,
            content_type="application/pdf",
            attachment_id=attachment_id,
        )
        assert parsed, "corpus PDF must yield at least one page component"
        assert parsed[0].extraction_status == "pending"  # 22P02 regression: enum value

        # 4. Stitch ids + inject the live failure modes the fakes hid:
        #    NUL bytes in text (22P05) and the 'error' enum value (22P02)
        component_ids = await _persist_components(component_repo, parsed, email_id=email_id, importer_id=importer_id)

        # 5. ExtractionRecord with NUL-bearing LLM jsonb persists (22P05 regression).
        #    entity_type_id is a NOT NULL FK — reuse a seeded row or create one.
        entity_type_id, created_entity_type_id = _find_or_create_entity_type(client)

        saved_record = await extraction_repo.save(
            ExtractionRecord(
                id=record_id,
                importer_id=importer_id,
                component_id=component_ids[0],
                entity_type_id=entity_type_id,
                extracted_fields={"po_number": "PO\x00-77"},
                confidence_score=0.5,
                confidence_breakdown=None,
                routing_reason="integration\x00test",
                status="candidate",
                corrected_fields=None,
                retrieval_context=None,
                created_at=now,
                updated_at=now,
            )
        )
        assert saved_record.extracted_fields == {"po_number": "PO-77"}

        # 6. D-18 read-back: installation-wide listing surfaces the new email
        listed = await email_repo.list_by_importer(None, limit=100, offset=0)
        assert any(e.id == email_id for e in listed)
        found = await email_repo.find_by_id(email_id)
        assert found is not None
        assert found.importer_id == importer_id
    finally:
        # Cleanup in FK order; the find-or-create importer row is left in place
        client.table("extraction_records").delete().eq("id", record_id).execute()
        if component_ids:
            client.table("email_components").delete().in_("id", component_ids).execute()
        client.table("email_attachments").delete().eq("id", attachment_id).execute()
        client.table("emails").delete().eq("id", email_id).execute()
        if created_entity_type_id:
            client.table("entity_types").delete().eq("id", created_entity_type_id).execute()


def test_parse_persist_readback_against_real_postgres() -> None:
    """End-to-end parse→persist→read-back against live Postgres (NUL + enum + D-18)."""
    asyncio.run(_run_pipeline())


async def _run_region_edit_roundtrip() -> None:
    """Persist page+region, accept then redraw via the use cases, assert the DB."""
    from app.application.use_cases.edit_region import AcceptRegionUseCase, RedrawRegionUseCase
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
    from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _client()
    email_repo = SupabaseEmailRepository(client)
    component_repo = SupabaseComponentRepository(client)
    importer_repo = SupabaseImporterRepository(
        client=client,
        default_importer_id="00000000-0000-0000-0000-000000000001",
    )

    email_id = str(uuid.uuid4())
    page_id = str(uuid.uuid4())
    region_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    cleanup_component_ids = [page_id, region_id]

    try:
        importer_id = await importer_repo.resolve(_SENDER)

        await email_repo.save(
            Email(
                id=email_id,
                importer_id=importer_id,
                message_id=f"<{email_id}@integration-test.example>",
                in_reply_to=None,
                references_ids=(),
                received_at=now,
                sender_address=_SENDER,
                sender_name="Integration Test",
                to_addresses=("agent@magnitudetech.com.br",),
                cc_addresses=(),
                subject="integration: region edit round-trip",
                body_html=None,
                body_text="region edit",
                raw_storage_key=f"inbound/integration/{email_id}",
                parse_status="received",
                parse_error=None,
                parsed_at=None,
                created_at=now,
            )
        )

        page = Component(
            id=page_id,
            email_id=email_id,
            importer_id=importer_id,
            attachment_id=None,
            parent_component_id=None,
            source_type="attachment_page",
            location={"page_index": 0},
            content_text="page text",
            content_markdown=None,
            content_raw=None,
            embedding=None,
            sequence_index=0,
            extraction_status="pending",
        )
        region = Component(
            id=region_id,
            email_id=email_id,
            importer_id=importer_id,
            attachment_id=None,
            parent_component_id=page_id,
            source_type="region",
            location={"page_index": 0, "polygon": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.4], [0.1, 0.4]]},
            content_text="region text",
            content_markdown=None,
            content_raw=None,
            embedding=None,
            sequence_index=1,
            extraction_status="pending",
        )
        await component_repo.save_many([page, region])

        # Accept: pending → candidate must be reflected in the live row
        accepted = await AcceptRegionUseCase(components=component_repo).execute(component_id=region_id)
        assert accepted.extraction_status == "candidate"
        row = client.table("email_components").select("extraction_status").eq("id", region_id).execute()
        assert row.data[0]["extraction_status"] == "candidate"

        # Redraw: original superseded, a NEW candidate row exists under the same page
        new_region = await RedrawRegionUseCase(components=component_repo).execute(
            component_id=region_id,
            polygon=[[0.2, 0.2], [0.6, 0.2], [0.6, 0.5], [0.2, 0.5]],
            page_index=0,
        )
        cleanup_component_ids.append(new_region.id)

        original_row = (
            client.table("email_components").select("extraction_status, content_raw").eq("id", region_id).execute()
        )
        assert original_row.data[0]["extraction_status"] == "superseded"
        assert original_row.data[0]["content_raw"]["lineage"]["superseded_by"] == new_region.id

        new_row = (
            client.table("email_components")
            .select("extraction_status, parent_component_id")
            .eq("id", new_region.id)
            .execute()
        )
        assert new_row.data[0]["extraction_status"] == "candidate"
        assert new_row.data[0]["parent_component_id"] == page_id
    finally:
        client.table("email_components").delete().in_("id", cleanup_component_ids).execute()
        client.table("emails").delete().eq("id", email_id).execute()


def test_region_edit_accept_redraw_roundtrip_against_real_postgres() -> None:
    """Accept flips status in the DB; redraw supersedes the original and inserts a new candidate."""
    asyncio.run(_run_region_edit_roundtrip())


# ---------------------------------------------------------------------------
# Confirm-fallback integration test (08-01)
# ---------------------------------------------------------------------------

_FAKE_EMBEDDING: tuple[float, ...] = tuple([0.1] * 1536)


class _FakeEmbedder:
    """Returns a deterministic 1536-dim embedding — avoids hitting Bedrock in integration tests."""

    async def embed(self, *, text: str) -> tuple[float, ...]:
        return _FAKE_EMBEDDING


async def _run_confirm_fallback() -> None:
    """Confirm a region that has no extraction record.

    Expected outcome (08-01 FK fix):
    - No row created in extraction_records (FK guard: entity_type_id would be "").
    - Component.embedding is non-null after ConfirmRegionUseCase runs (D-15 flywheel).
    """
    from app.application.use_cases.confirm_region import ConfirmRegionUseCase
    from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
    from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
    from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _client()
    email_repo = SupabaseEmailRepository(client)
    component_repo = SupabaseComponentRepository(client)
    extraction_repo = SupabaseExtractionRepository(client)
    importer_repo = SupabaseImporterRepository(
        client=client,
        default_importer_id="00000000-0000-0000-0000-000000000001",
    )

    email_id = str(uuid.uuid4())
    region_id = str(uuid.uuid4())
    now = datetime.now(UTC)

    try:
        importer_id = await importer_repo.resolve(_SENDER)

        # Seed parent email
        await email_repo.save(
            Email(
                id=email_id,
                importer_id=importer_id,
                message_id=f"<{email_id}@integration-test.example>",
                in_reply_to=None,
                references_ids=(),
                received_at=now,
                sender_address=_SENDER,
                sender_name="Integration Test",
                to_addresses=("agent@magnitudetech.com.br",),
                cc_addresses=(),
                subject="integration: confirm-fallback 08-01",
                body_html=None,
                body_text="confirm fallback",
                raw_storage_key=f"inbound/integration/{email_id}",
                parse_status="received",
                parse_error=None,
                parsed_at=None,
                created_at=now,
            )
        )

        # Seed region component with NO extraction record (simulate first-confirm with no autofill)
        region = Component(
            id=region_id,
            email_id=email_id,
            importer_id=importer_id,
            attachment_id=None,
            parent_component_id=None,
            source_type="region",
            location={"page_index": 0},
            content_text="BL No: MSCU2024-00551",
            content_markdown=None,
            content_raw=None,
            embedding=None,
            sequence_index=0,
            extraction_status="pending",
        )
        await component_repo.save_many([region])

        # Run ConfirmRegionUseCase — no candidate record exists
        use_case = ConfirmRegionUseCase(
            components=component_repo,
            extractions=extraction_repo,
            embedder=_FakeEmbedder(),  # type: ignore[arg-type]
        )
        await use_case.execute(component_id=region_id, importer_id=importer_id)

        # Assert: NO extraction_records row was created (FK guard)
        records_row = client.table("extraction_records").select("id").eq("component_id", region_id).execute()
        assert records_row.data == [], f"Expected no extraction_records row for {region_id}, got: {records_row.data}"

        # Assert: component embedding is non-null (D-15 flywheel ran)
        comp_row = client.table("email_components").select("embedding").eq("id", region_id).execute()
        assert comp_row.data, f"Component row not found for {region_id}"
        embedding_stored = comp_row.data[0]["embedding"]
        assert embedding_stored is not None, "Component embedding must be non-null after confirm-fallback"

    finally:
        client.table("email_components").delete().eq("id", region_id).execute()
        client.table("emails").delete().eq("id", email_id).execute()


def test_confirm_fallback_no_save_embedding_persisted() -> None:
    """Confirm-fallback (no candidate): extraction_records row NOT created; embedding IS stored."""
    asyncio.run(_run_confirm_fallback())


# ---------------------------------------------------------------------------
# LEARN-02 (57-03): dismiss-then-resolve real-Postgres exclusion, both directions
# ---------------------------------------------------------------------------


async def _run_dismiss_then_resolve_excludes_both_directions() -> None:
    """RejectMergeUseCase durably dismisses a pair; the RPC NOT EXISTS filter must
    exclude it from ResolveEntityCandidates symmetrically in BOTH directions.

    Seeds two entity_instances with an identical display_name (guarantees pg_trgm
    similarity=1.0, deterministic — no Bedrock embed call needed). Proves B resolves
    as a candidate for A BEFORE rejection. Seeds a candidate-link row in ONLY ONE
    ordering (component_id=A, entity_instance_id=B) then rejects the merge — this
    means only ONE physical row ever gets was_dismissed=true. The AFTER assertions
    then prove the SQL filter's OWN symmetric OR clause (Pitfall 1), not merely
    that dismiss_candidate_link happens to write both orderings: resolving from A
    must exclude B AND resolving from B must exclude A, even though the single
    dismissed row is keyed the first way round.
    """
    from app.application.use_cases.curate_entity_merge import RejectMergeUseCase
    from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
    from app.domain.entities.entity_instance import EntityInstance
    from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository
    from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
    from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository

    client = _client()
    entity_instances_repo = SupabaseEntityInstanceRepository(client)
    resolution_repo = SupabaseEntityResolutionRepository(client)
    importer_repo = SupabaseImporterRepository(
        client=client,
        default_importer_id="00000000-0000-0000-0000-000000000001",
    )
    resolve_use_case = ResolveEntityCandidatesUseCase(
        entity_instances=entity_instances_repo,
        resolution_repo=resolution_repo,
    )
    reject_use_case = RejectMergeUseCase(entity_instances=entity_instances_repo)

    entity_id_a = str(uuid.uuid4())
    entity_id_b = str(uuid.uuid4())
    shared_display_name = f"Integration Dismiss Test {uuid.uuid4().hex[:8]}"
    created_entity_type_id: str | None = None

    try:
        importer_id = await importer_repo.resolve(_SENDER)
        entity_type_id, created_entity_type_id = _find_or_create_entity_type(client)

        for entity_id in (entity_id_a, entity_id_b):
            await entity_instances_repo.upsert(
                EntityInstance(
                    id=entity_id,
                    importer_id=importer_id,
                    entity_type_id=entity_type_id,
                    nauta_id=None,
                    source="email_extracted",
                    display_name=shared_display_name,
                    identifiers={},
                    aliases=[],
                    summary_text=None,
                    embedding=None,
                    is_active=True,
                )
            )

        # BEFORE: B resolves as a candidate for A (identical display_name → trgm sim=1.0)
        candidates_before = await resolve_use_case.execute(entity_instance_id=entity_id_a)
        assert entity_id_b in [c.entity_instance_id for c in candidates_before], (
            "precondition failed: B must resolve as a candidate for A before rejection"
        )

        # Seed ONLY ONE candidate-link ordering so the AFTER assertions prove the SQL
        # filter's own symmetric OR clause, not the dual write in dismiss_candidate_link.
        await entity_instances_repo.record_candidate_link(
            component_id=entity_id_a,
            entity_instance_id=entity_id_b,
            entity_type_id=entity_type_id,
            match_type="semantic",
            similarity_score=1.0,
        )

        # Human rejects the merge suggestion (the correction being tested).
        await reject_use_case.execute(entity_id_a, entity_id_b)

        # AFTER: same resolution call, same inputs — B must no longer resurface for A.
        candidates_after_a = await resolve_use_case.execute(entity_instance_id=entity_id_a)
        assert entity_id_b not in [c.entity_instance_id for c in candidates_after_a]

        # AFTER (Pitfall 1 direction test): A must not resurface for B either, even
        # though the only dismissed row is keyed (component_id=A, entity_instance_id=B)
        # — the filter's OR clause must catch the reverse-subject case.
        candidates_after_b = await resolve_use_case.execute(entity_instance_id=entity_id_b)
        assert entity_id_a not in [c.entity_instance_id for c in candidates_after_b]
    finally:
        client.table("component_entity_candidate_links").delete().eq("component_id", entity_id_a).eq(
            "entity_instance_id", entity_id_b
        ).execute()
        client.table("component_entity_candidate_links").delete().eq("component_id", entity_id_b).eq(
            "entity_instance_id", entity_id_a
        ).execute()
        client.table("entity_instances").delete().in_("id", [entity_id_a, entity_id_b]).execute()
        if created_entity_type_id:
            client.table("entity_types").delete().eq("id", created_entity_type_id).execute()


def test_dismiss_then_resolve_excludes_both_directions_against_real_postgres() -> None:
    """RejectMergeUseCase's was_dismissed flag now excludes the pair from
    ResolveEntityCandidates symmetrically in both directions (LEARN-02, Pitfall 1)."""
    asyncio.run(_run_dismiss_then_resolve_excludes_both_directions())


# ---------------------------------------------------------------------------
# vLAUNCH W9-3: the monthlyChatTurns count against REAL PostgREST
# ---------------------------------------------------------------------------
#
# count_monthly_chat_turns_used is this codebase's FIRST PostgREST `!inner`
# embed, and until now it was proven only against fluent-builder mocks — which
# assert the query the code ASKS for, never that PostgREST ANSWERS it. That gap
# is the dangerous kind: if the embed 400s live, the method raises, RunChatTurn's
# cap gate FAILS OPEN by design, and the free-tier cap is silently gone while
# every suite stays green. This test makes the embed resolve for real and pins
# every filter's meaning to observed rows.


def _create_auth_user(client: Any, label: str) -> str:
    """Create a disposable GoTrue user — chat_conversations.user_id is a NOT NULL
    FK to auth.users, and a fresh owner guarantees the count sees ONLY our rows."""
    created = client.auth.admin.create_user(
        {
            "email": f"w9-cap-{label}-{uuid.uuid4().hex[:12]}@integration-test.example",
            "password": uuid.uuid4().hex,
            "email_confirm": True,
        }
    )
    user = getattr(created, "user", None)
    assert user is not None, "GoTrue admin.create_user returned no user"
    return str(user.id)


def _conversation_row(*, conversation_id: str, user_id: str, title: str) -> dict[str, Any]:
    return {
        "id": conversation_id,
        "user_id": user_id,
        "title": title,
        "model_id": "integration-test-model",
    }


def _message_row(
    *,
    conversation_id: str,
    role: str,
    is_active: bool,
    created_at: datetime,
    note: str,
) -> dict[str, Any]:
    """A chat_messages row seeded DIRECTLY (not via insert_message).

    insert_message cannot set created_at — the column defaults to now() — and
    the out-of-month rows are the whole point of the window assertion. Only the
    READ path is under test here, so seeding the write side by hand is correct.
    """
    return {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": role,
        "parts": [{"type": "text", "text": note}],
        "turn_index": 0,
        "is_active": is_active,
        "status": "completed",
        "created_at": created_at.isoformat(),
    }


def _seeded_rows(
    *,
    subject_conversation_id: str,
    other_conversation_id: str,
    moment: datetime,
    month_start: datetime,
) -> list[dict[str, Any]]:
    """The seven rows that pin every filter. Exactly TWO count for the subject.

    Each excluded row isolates ONE filter, so a filter that silently stopped
    applying changes the expected count and reds this test:
      - assistant row      -> role = 'user'
      - inactive row       -> is_active = true (regenerated-sibling semantics)
      - month_start - 1us  -> gte is EXCLUSIVE below the boundary
      - previous day       -> the coarse out-of-month case
      - other owner's row  -> the `!inner` embed's chat_conversations.user_id
                              filter (the one thing mocks cannot prove)
    The month_start row proves gte is INCLUSIVE at the boundary.
    """
    return [
        _message_row(
            conversation_id=subject_conversation_id,
            role="user",
            is_active=True,
            created_at=moment,
            note="counts: in-month active user turn",
        ),
        _message_row(
            conversation_id=subject_conversation_id,
            role="user",
            is_active=True,
            created_at=month_start,
            note="counts: exactly at the UTC month boundary (gte inclusive)",
        ),
        _message_row(
            conversation_id=subject_conversation_id,
            role="user",
            is_active=True,
            created_at=month_start - timedelta(microseconds=1),
            note="excluded: one microsecond before the boundary",
        ),
        _message_row(
            conversation_id=subject_conversation_id,
            role="user",
            is_active=True,
            created_at=month_start - timedelta(days=1),
            note="excluded: previous UTC month",
        ),
        _message_row(
            conversation_id=subject_conversation_id,
            role="assistant",
            is_active=True,
            created_at=moment,
            note="excluded: assistant reply is not a turn",
        ),
        _message_row(
            conversation_id=subject_conversation_id,
            role="user",
            is_active=False,
            created_at=moment,
            note="excluded: superseded sibling",
        ),
        _message_row(
            conversation_id=other_conversation_id,
            role="user",
            is_active=True,
            created_at=moment,
            note="excluded from the subject's count: another user's conversation",
        ),
    ]


async def _run_monthly_chat_turn_count() -> None:
    from app.infrastructure.supabase.supabase_chat_message_repository import SupabaseChatMessageRepository

    client = _client()
    repo = SupabaseChatMessageRepository(client=client)

    # `now` is pinned so the window cannot shift under a month rollover mid-run;
    # month_start is recomputed here INDEPENDENTLY of start_of_current_utc_month
    # so the test does not inherit the production helper's own arithmetic.
    moment = datetime.now(UTC)
    month_start = datetime(moment.year, moment.month, 1, tzinfo=UTC)

    subject_conversation_id = str(uuid.uuid4())
    other_conversation_id = str(uuid.uuid4())
    subject_user_id: str | None = None
    other_user_id: str | None = None
    message_ids: list[str] = []

    try:
        subject_user_id = _create_auth_user(client, "subject")
        other_user_id = _create_auth_user(client, "other")

        client.table("chat_conversations").insert(
            [
                _conversation_row(
                    conversation_id=subject_conversation_id,
                    user_id=subject_user_id,
                    title="W9-3 subject",
                ),
                _conversation_row(
                    conversation_id=other_conversation_id,
                    user_id=other_user_id,
                    title="W9-3 other owner",
                ),
            ]
        ).execute()

        rows = _seeded_rows(
            subject_conversation_id=subject_conversation_id,
            other_conversation_id=other_conversation_id,
            moment=moment,
            month_start=month_start,
        )
        message_ids = [str(row["id"]) for row in rows]
        client.table("chat_messages").insert(rows).execute()

        # THE assertion. Reaching a number at all proves the `!inner` embed
        # resolved (a broken relationship is a PostgREST 400 -> raise) AND that
        # head=True + count=exact really returns the count in Content-Range
        # (a missing count raises rather than reading as 0).
        used = await repo.count_monthly_chat_turns_used(subject_user_id, now=moment)
        assert used == 2, f"expected exactly the 2 in-window active user turns, got {used}"

        # The embed FILTERS by owner rather than merely joining: the other
        # user's single row is the only one in their count.
        other_used = await repo.count_monthly_chat_turns_used(other_user_id, now=moment)
        assert other_used == 1, f"expected the other owner's single turn, got {other_used}"

        # A user with no conversations at all counts 0 — the embed must not
        # degrade into an unfiltered count when the join matches nothing.
        unknown_used = await repo.count_monthly_chat_turns_used(str(uuid.uuid4()), now=moment)
        assert unknown_used == 0, f"expected 0 for a user with no conversations, got {unknown_used}"
    finally:
        # Each step is independently best-effort: this is the only test here
        # that creates auth.users, and a failed early delete must not strand
        # them. Steps still run in FK order; failures are reported, not raised
        # (raising in `finally` would mask the real assertion failure).
        def _best_effort(label: str, step: Callable[[], object]) -> None:
            try:
                step()
            except Exception as exc:
                # Cleanup must never mask the test's own failure — report and continue.
                print(f"[cleanup] {label} failed, may have leaked: {exc}")

        if message_ids:
            _best_effort(
                "chat_messages",
                lambda: client.table("chat_messages").delete().in_("id", message_ids).execute(),
            )
        _best_effort(
            "chat_conversations",
            lambda: client.table("chat_conversations")
            .delete()
            .in_("id", [subject_conversation_id, other_conversation_id])
            .execute(),
        )
        for user_id in (subject_user_id, other_user_id):
            if user_id:
                _best_effort(f"auth.user {user_id}", partial(client.auth.admin.delete_user, user_id))


def test_monthly_chat_turn_count_against_real_postgrest() -> None:
    """The `!inner` embed resolves live and every cap filter means what the mocks claim."""
    asyncio.run(_run_monthly_chat_turn_count())
