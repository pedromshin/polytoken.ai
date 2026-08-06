"""Tests for POST /v1/emails/relabel-job — the worker's cascade re-label re-entry route (75-04).

The worker task `cascade_relabel` (apps/worker/src/tasks.ts) forwards the payload the
listener's CascadeCorrectionUseCase enqueued — `{survivor_id, absorbed_id, email_ids}` —
verbatim to this route. Contract under test:
  - auth: the route requires the api key (mirrors ingest-job's require_api_key guard);
  - happy path → 200 with per-email outcomes, ReprocessEmailUseCase invoked per email;
  - importer mismatch → that email is SKIPPED (fail-closed), the rest still run;
  - a mid-loop reprocess failure → outcome "failed", never a raised 500 (the fan-out is
    per-email best-effort; the job itself only 5xxes on structural failures);
  - unknown survivor → 404 (fail-closed: nothing is reprocessed).

Mirrors test_ingest_job.py: require_api_key overridden for the behaviour tests (auth has
its own test here), collaborators are dishka-bound fakes — no live pipeline / Supabase.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any

from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.presentation.api.v1.relabel_job import router
from app.presentation.middleware.auth import require_api_key
from app.settings import get_settings

_IMPORTER_ID = "00000000-0000-0000-0003-000000000001"
_OTHER_IMPORTER_ID = "00000000-0000-0000-0003-000000000002"
_SURVIVOR_ID = "00000000-0000-0000-0002-000000000001"
_ABSORBED_ID = "00000000-0000-0000-0002-000000000002"


class _FakeEntityInstances:
    """Serves the survivor load; only importer_id is read by the route."""

    def __init__(self, by_id: dict[str, Any] | None = None) -> None:
        self._by_id = dict(by_id or {})

    async def find_by_id(self, entity_instance_id: str) -> Any | None:
        return self._by_id.get(entity_instance_id)


class _FakeEmails:
    """Serves the per-email importer check; only importer_id is read by the route."""

    def __init__(self, by_id: dict[str, Any] | None = None) -> None:
        self._by_id = dict(by_id or {})

    async def find_by_id(self, email_id: str) -> Any | None:
        return self._by_id.get(email_id)


class _FakeReprocess:
    def __init__(self, *, raises_for: set[str] | None = None) -> None:
        self.calls: list[str] = []
        self._raises_for = raises_for or set()

    async def execute(self, *, email_id: str) -> dict[str, object]:
        self.calls.append(email_id)
        if email_id in self._raises_for:
            raise RuntimeError("reingest boom")
        return {"email_id": email_id, "superseded_components": 0, "new_regions": 1}


def _make_client(
    *,
    entities: _FakeEntityInstances | None = None,
    emails: _FakeEmails | None = None,
    reprocess: _FakeReprocess | None = None,
    override_auth: bool = True,
) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    _entities = entities or _FakeEntityInstances({_SURVIVOR_ID: SimpleNamespace(importer_id=_IMPORTER_ID)})
    _emails = emails or _FakeEmails()
    _reprocess = reprocess or _FakeReprocess()
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: _entities, provides=EntityInstanceRepository, scope=Scope.APP)
    provider.provide(lambda: _emails, provides=EmailRepository, scope=Scope.APP)
    provider.provide(lambda: _reprocess, provides=ReprocessEmailUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    if override_auth:
        # Auth is exercised by test_missing_api_key_returns_401 below; the behaviour
        # tests override it (mirrors test_ingest_job.py).
        app.dependency_overrides[require_api_key] = lambda: None
    return TestClient(app, raise_server_exceptions=False)


def _post(client: TestClient, *, email_ids: list[str], headers: dict[str, str] | None = None) -> Any:
    return client.post(
        "/v1/emails/relabel-job",
        json={"survivor_id": _SURVIVOR_ID, "absorbed_id": _ABSORBED_ID, "email_ids": email_ids},
        headers=headers or {},
    )


def test_missing_api_key_returns_401() -> None:
    old_key = os.environ.get("API_KEY")
    os.environ["API_KEY"] = "test-secret-key"
    get_settings.cache_clear()
    try:
        client = _make_client(override_auth=False)
        resp = _post(client, email_ids=["email-1"])
        assert resp.status_code == 401
    finally:
        if old_key is None:
            os.environ.pop("API_KEY", None)
        else:
            os.environ["API_KEY"] = old_key
        get_settings.cache_clear()


def test_happy_path_reprocesses_each_email_and_returns_outcomes() -> None:
    emails = _FakeEmails(
        {
            "email-1": SimpleNamespace(importer_id=_IMPORTER_ID),
            "email-2": SimpleNamespace(importer_id=_IMPORTER_ID),
        }
    )
    reprocess = _FakeReprocess()
    client = _make_client(emails=emails, reprocess=reprocess)

    resp = _post(client, email_ids=["email-1", "email-2"])

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["survivor_id"] == _SURVIVOR_ID
    assert data["absorbed_id"] == _ABSORBED_ID
    assert data["outcomes"] == [
        {"email_id": "email-1", "status": "reprocessed"},
        {"email_id": "email-2", "status": "reprocessed"},
    ]
    assert reprocess.calls == ["email-1", "email-2"]


def test_importer_mismatch_is_skipped_fail_closed() -> None:
    """A foreign-importer email is never reprocessed; the rest of the loop still runs."""
    emails = _FakeEmails(
        {
            "email-1": SimpleNamespace(importer_id=_OTHER_IMPORTER_ID),
            "email-2": SimpleNamespace(importer_id=_IMPORTER_ID),
        }
    )
    reprocess = _FakeReprocess()
    client = _make_client(emails=emails, reprocess=reprocess)

    resp = _post(client, email_ids=["email-1", "email-2"])

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["outcomes"] == [
        {"email_id": "email-1", "status": "skipped_importer_mismatch"},
        {"email_id": "email-2", "status": "reprocessed"},
    ]
    assert reprocess.calls == ["email-2"]


def test_unknown_email_is_skipped_not_raised() -> None:
    emails = _FakeEmails({"email-2": SimpleNamespace(importer_id=_IMPORTER_ID)})
    reprocess = _FakeReprocess()
    client = _make_client(emails=emails, reprocess=reprocess)

    resp = _post(client, email_ids=["email-ghost", "email-2"])

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["outcomes"] == [
        {"email_id": "email-ghost", "status": "skipped_not_found"},
        {"email_id": "email-2", "status": "reprocessed"},
    ]
    assert reprocess.calls == ["email-2"]


def test_reprocess_failure_never_raises_mid_loop() -> None:
    """One failing email yields outcome 'failed'; subsequent emails still run; 200 overall."""
    emails = _FakeEmails(
        {
            "email-1": SimpleNamespace(importer_id=_IMPORTER_ID),
            "email-2": SimpleNamespace(importer_id=_IMPORTER_ID),
        }
    )
    reprocess = _FakeReprocess(raises_for={"email-1"})
    client = _make_client(emails=emails, reprocess=reprocess)

    resp = _post(client, email_ids=["email-1", "email-2"])

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["outcomes"] == [
        {"email_id": "email-1", "status": "failed"},
        {"email_id": "email-2", "status": "reprocessed"},
    ]
    assert reprocess.calls == ["email-1", "email-2"]


def test_unknown_survivor_returns_404_and_reprocesses_nothing() -> None:
    """Fail-closed: without a loadable survivor there is no importer scope — 404, zero work."""
    reprocess = _FakeReprocess()
    client = _make_client(entities=_FakeEntityInstances({}), reprocess=reprocess)

    resp = _post(client, email_ids=["email-1"])

    assert resp.status_code == 404
    assert reprocess.calls == []


def test_empty_email_ids_is_a_clean_200_noop() -> None:
    reprocess = _FakeReprocess()
    client = _make_client(reprocess=reprocess)

    resp = _post(client, email_ids=[])

    assert resp.status_code == 200
    assert resp.json()["data"]["outcomes"] == []
    assert reprocess.calls == []
