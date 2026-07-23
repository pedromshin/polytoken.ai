"""Tests for GET /v1/pipeline/health (ST-04).

Routes resolve dependencies through dishka, so tests swap
app.state.dishka_container for a real container whose providers return mocks
(mirrors tests/test_emails_api.py).

Contract under test:
- auth: X-API-Key at the router (dev bypass in tests) + X-User-Id required;
- tenancy: counts scoped to ImporterResolver.list_importer_ids_for_user —
  a caller who owns no importers gets an empty importer list, never "all";
- shape: TOP-LEVEL {"importers": [...]} (NOT the ApiResponse envelope) —
  the Next proxy forwards this body verbatim to the web panel's zod schema
  (apps/web/src/lib/pipeline-health.ts);
- exactness: buckets reflect the repository's exact counts for the seeded
  statuses, bucketed per stage prefix.
"""

from __future__ import annotations

import pytest
from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.pipeline_health import GetPipelineHealthUseCase
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.importer_resolver import ImporterResolver
from app.main import create_app
from app.presentation.middleware.user_context import USER_ID_HEADER
from app.settings import get_settings

IMPORTER_A = "00000000-0000-0000-0000-00000000000a"
IMPORTER_B = "00000000-0000-0000-0000-00000000000b"
USER_ID = "user-00000000-0000-0000-0000-000000000001"


class FakeEmailRepo:
    """Seeded (parse_status, parse_error) rows per importer; exact counts."""

    def __init__(self, rows_by_importer: dict[str, list[tuple[str, str | None]]]) -> None:
        self._rows = rows_by_importer

    async def count_emails(self, importer_id: str, *, parse_status: str | None = None) -> int:
        rows = self._rows.get(importer_id, [])
        if parse_status is None:
            return len(rows)
        return sum(1 for status, _ in rows if status == parse_status)

    async def list_parse_errors(self, importer_id: str, *, parse_status: str) -> list[str]:
        return [
            error for status, error in self._rows.get(importer_id, []) if status == parse_status and error is not None
        ]


class FakeImporterResolver:
    def __init__(self, owned: list[str]) -> None:
        self._owned = owned

    async def resolve(self, sender_address: str, *, user_id: str | None = None) -> str:
        raise AssertionError("not used by this endpoint")

    async def list_importer_ids_for_user(self, user_id: str) -> list[str]:
        return list(self._owned)


def _client(
    rows_by_importer: dict[str, list[tuple[str, str | None]]],
    owned: list[str],
) -> TestClient:
    get_settings.cache_clear()
    provider = Provider(scope=Scope.APP)

    email_repo = FakeEmailRepo(rows_by_importer)
    importer_resolver = FakeImporterResolver(owned)

    def provide_email_repo() -> EmailRepository:
        return email_repo  # type: ignore[return-value]

    def provide_importer_resolver() -> ImporterResolver:
        return importer_resolver

    provider.provide(provide_email_repo, provides=EmailRepository)
    provider.provide(provide_importer_resolver, provides=ImporterResolver)
    provider.provide(GetPipelineHealthUseCase)

    app = create_app()
    app.state.dishka_container = make_async_container(provider)
    return TestClient(app, headers={USER_ID_HEADER: USER_ID})


@pytest.fixture
def seeded_rows() -> dict[str, list[tuple[str, str | None]]]:
    return {
        IMPORTER_A: [
            ("parsed", None),
            ("parsed", None),
            ("parsed", None),
            ("received", None),
            ("degraded", "adapter_degraded[segmentation]: page 0: retries exhausted"),
            ("degraded", "adapter_degraded[classifier]: 2 region(s) left unclassified: APIError"),
            ("failed", "attachment[0]: bl.pdf: RuntimeError('corrupt PDF stream')"),
            ("failed", "attachment[1]: x.pdf: boom; suggest_entity_types: TimeoutError()"),
            ("failed", "propose_regions: RuntimeError('bedrock down')"),
        ],
        IMPORTER_B: [("parsed", None)],
        # An importer the caller does NOT own — must never leak into totals.
        "imp-foreign": [("failed", "attachment[0]: evil.pdf: boom")] * 5,
    }


def test_health_returns_exact_per_stage_buckets(seeded_rows: dict[str, list[tuple[str, str | None]]]) -> None:
    client = _client(seeded_rows, owned=[IMPORTER_A, IMPORTER_B])

    resp = client.get("/v1/pipeline/health")

    assert resp.status_code == 200
    body = resp.json()
    # TOP-LEVEL importers array — the merged web zod contract, no envelope.
    assert set(body.keys()) == {"importers"}
    assert [i["importer_id"] for i in body["importers"]] == [IMPORTER_A, IMPORTER_B]

    a = body["importers"][0]
    assert a["received"] == 9
    assert a["fully_analyzed"] == 3
    assert a["degraded"] == 2
    assert a["failed"] == 3
    assert a["failed_by_stage"] == {
        "attachment": 2,
        "propose_regions": 1,
        "suggest_entity_types": 1,
    }
    assert a["degraded_by_adapter"] == {"classifier": 1, "segmentation": 1}

    b = body["importers"][1]
    assert b["received"] == 1
    assert b["fully_analyzed"] == 1
    assert b["failed_by_stage"] == {}


def test_health_scopes_to_owned_importers_only(seeded_rows: dict[str, list[tuple[str, str | None]]]) -> None:
    """The foreign importer's 5 failures never appear — scoping comes from
    list_importer_ids_for_user, never from anything client-supplied."""
    client = _client(seeded_rows, owned=[IMPORTER_B])

    resp = client.get("/v1/pipeline/health")

    assert resp.status_code == 200
    body = resp.json()
    assert [i["importer_id"] for i in body["importers"]] == [IMPORTER_B]
    assert body["importers"][0]["failed"] == 0


def test_health_no_owned_importers_returns_empty_list(
    seeded_rows: dict[str, list[tuple[str, str | None]]],
) -> None:
    """Zero owned importers -> empty importers array (fail-closed), never 'all'."""
    client = _client(seeded_rows, owned=[])

    resp = client.get("/v1/pipeline/health")

    assert resp.status_code == 200
    assert resp.json() == {"importers": []}


def test_health_requires_x_user_id(seeded_rows: dict[str, list[tuple[str, str | None]]]) -> None:
    client = _client(seeded_rows, owned=[IMPORTER_A])

    resp = client.get("/v1/pipeline/health", headers={USER_ID_HEADER: ""})

    assert resp.status_code == 401
