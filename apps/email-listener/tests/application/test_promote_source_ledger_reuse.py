"""Promotion-gate reuse proof for chat_source_ledger (Phase 56-05, RCNV-01 seam).

Two sections, one per task of the plan:

1. Adapter tests (`SupabaseSourceLedgerRepository.set_knowledge_node_id`, call-shape
   via MagicMock, no live DB -- mirrors test_run_chat_turn_source_ledger.py's
   adapter-test convention): a single parameterized update against
   chat_source_ledger.knowledge_node_id, and a missing row never raises.

2. The reuse proof (`PromoteSourceLedgerEntryUseCase`, mirrors
   test_source_capture_promote_reuse.py's CLUS-05 zero-diff pattern exactly):
   a captured chat_source_ledger row is reshaped into the exact source_payload
   shape the UNCHANGED `SourceCaptureHandler.execute()` already accepts, called
   verbatim, and on success the node id is back-referenced onto the ledger row.
   This file adds ZERO new production promotion code -- see the git diff --stat
   assertion below (confirm_action_dispatch.py / promote_edge.py unchanged).
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
from app.application.use_cases.promote_source_ledger_entry import PromoteSourceLedgerEntryUseCase
from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.infrastructure.supabase.source_ledger_repository import SupabaseSourceLedgerRepository

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"
_LEDGER_ENTRY_ID = "ledger-1"
_URL = "https://example.com/article"

# The commit immediately BEFORE Phase 56-05 (this plan) started -- the fixed
# base ref the zero-diff proof below compares against. Neither
# confirm_action_dispatch.py nor promote_edge.py may show any diff between
# this commit and the working tree once 56-05 lands (the reuse proof).
_PRE_PLAN_BASE_SHA = "8bb10f4"

# ---------------------------------------------------------------------------
# Task 1: set_knowledge_node_id back-reference (adapter, call-shape via MagicMock)
# ---------------------------------------------------------------------------


def _make_update_chain_mock(execute_return: Any) -> MagicMock:
    chain = MagicMock()
    chain.update.return_value = chain
    chain.eq.return_value = chain
    chain.execute.return_value = execute_return
    return chain


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_set_knowledge_node_id_backref_issues_single_parameterized_update() -> None:
    execute_result = MagicMock()
    execute_result.data = [{"id": _LEDGER_ENTRY_ID, "knowledge_node_id": "node-1"}]
    chain = _make_update_chain_mock(execute_result)
    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseSourceLedgerRepository(client=client)

    await repo.set_knowledge_node_id(_LEDGER_ENTRY_ID, "node-1")

    client.table.assert_called_with("chat_source_ledger")
    chain.update.assert_called_once_with({"knowledge_node_id": "node-1"})
    chain.eq.assert_called_once_with("id", _LEDGER_ENTRY_ID)
    assert chain.execute.called


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_set_knowledge_node_id_backref_missing_row_does_not_raise() -> None:
    """update-by-id of an absent row simply affects zero rows -- never raises."""
    execute_result = MagicMock()
    execute_result.data = []  # zero rows matched
    chain = _make_update_chain_mock(execute_result)
    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseSourceLedgerRepository(client=client)

    await repo.set_knowledge_node_id("missing-id", "node-1")  # must not raise


# ---------------------------------------------------------------------------
# Task 2: PromoteSourceLedgerEntryUseCase -- reuse proof
# ---------------------------------------------------------------------------


class FakeSourceLedgerRepository:
    """Holds ledger rows keyed by id; records set_knowledge_node_id calls."""

    def __init__(self, entry: SourceLedgerEntry | None = None) -> None:
        self._by_id: dict[str, SourceLedgerEntry] = {entry.id: entry} if entry is not None and entry.id else {}
        self.set_knowledge_node_id_calls: list[tuple[str, str]] = []

    async def insert_entries(self, entries: Any) -> None:  # pragma: no cover - unused this file
        raise NotImplementedError

    async def get(self, ledger_entry_id: str) -> SourceLedgerEntry | None:
        return self._by_id.get(ledger_entry_id)

    async def set_knowledge_node_id(self, ledger_entry_id: str, node_id: str) -> None:
        self.set_knowledge_node_id_calls.append((ledger_entry_id, node_id))
        entry = self._by_id.get(ledger_entry_id)
        if entry is not None:
            self._by_id[ledger_entry_id] = SourceLedgerEntry(**{**entry.__dict__, "knowledge_node_id": node_id})


class FakeKnowledgeGraphRepository:
    """The exact SourceCaptureHandler collaborator fake from test_source_capture_dispatch.py."""

    def __init__(self, *, raise_on: str | None = None) -> None:
        self._raise_on = raise_on
        self._nodes: dict[tuple[str, str, str], dict[str, object]] = {}
        self._next_id = 0
        self.find_active_node_calls: list[tuple[str, str, str | None]] = []
        self.upsert_node_calls: list[dict[str, object]] = []
        self.insert_edge_calls: list[dict[str, object]] = []

    async def find_active_node(
        self, importer_id: str, scope: str, scope_ref_id: str | None
    ) -> dict[str, object] | None:
        self.find_active_node_calls.append((importer_id, scope, scope_ref_id))
        if self._raise_on == "find_active_node":
            raise RuntimeError("simulated DB hiccup")
        return self._nodes.get((importer_id, scope, scope_ref_id or ""))

    async def upsert_node(self, **kwargs: Any) -> str:
        self.upsert_node_calls.append(kwargs)
        if self._raise_on == "upsert_node":
            raise RuntimeError("simulated DB hiccup")
        self._next_id += 1
        node_id = f"node-{self._next_id}"
        self._nodes[(kwargs["importer_id"], kwargs["scope"], kwargs["scope_ref_id"] or "")] = {"id": node_id}
        return node_id

    async def insert_edge(self, **kwargs: Any) -> None:
        self.insert_edge_calls.append(kwargs)
        if self._raise_on == "insert_edge":
            raise RuntimeError("simulated DB hiccup")


def _ledger_entry(**overrides: object) -> SourceLedgerEntry:
    base: dict[str, object] = {
        "id": _LEDGER_ENTRY_ID,
        "conversation_id": _CONVERSATION_ID,
        "importer_id": _IMPORTER_ID,
        "tool_name": "web_search",
        "tool_use_id": "toolu_1",
        "result_index": 0,
        "url": _URL,
        "title": "An Article",
        "snippet": "a snippet",
        "captured_at": datetime(2026, 7, 12, tzinfo=UTC),
        "knowledge_node_id": None,
    }
    base.update(overrides)
    return SourceLedgerEntry(**base)  # type: ignore[arg-type]


@pytest.mark.unit
def test_captured_ledger_row_promotes_through_unchanged_source_capture_handler() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    source_capture = SourceCaptureHandler(knowledge_graph=knowledge)
    source_ledger = FakeSourceLedgerRepository(_ledger_entry())
    use_case = PromoteSourceLedgerEntryUseCase(source_ledger=source_ledger, source_capture=source_capture)

    result = asyncio.run(use_case.execute(ledger_entry_id=_LEDGER_ENTRY_ID, importer_id=_IMPORTER_ID))

    assert result["status"] == "captured"
    node_id = result["node_id"]
    assert isinstance(node_id, str)
    assert node_id

    # Reshaped correctly onto the UNCHANGED SourceCaptureHandler's own inputs.
    assert len(knowledge.upsert_node_calls) == 1
    upsert_call = knowledge.upsert_node_calls[0]
    assert upsert_call["importer_id"] == _IMPORTER_ID
    assert upsert_call["tier"] == "INFERRED"
    assert upsert_call["scope_ref_id"] == str(uuid.uuid5(uuid.NAMESPACE_URL, _URL))
    assert len(knowledge.insert_edge_calls) == 1
    edge_call = knowledge.insert_edge_calls[0]
    assert edge_call["target_ref_id"] == _CONVERSATION_ID
    assert edge_call["provenance"]["url"] == _URL

    # The ONE new write this seam performs beyond the reused promotion
    # machinery: the node id is back-referenced onto the ledger row.
    assert source_ledger.set_knowledge_node_id_calls == [(_LEDGER_ENTRY_ID, node_id)]


@pytest.mark.unit
def test_missing_ledger_row_returns_capture_failed_without_calling_handler() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    source_capture = SourceCaptureHandler(knowledge_graph=knowledge)
    source_ledger = FakeSourceLedgerRepository(entry=None)
    use_case = PromoteSourceLedgerEntryUseCase(source_ledger=source_ledger, source_capture=source_capture)

    result = asyncio.run(use_case.execute(ledger_entry_id="does-not-exist", importer_id=_IMPORTER_ID))

    assert result == {"status": "capture_failed"}
    assert knowledge.upsert_node_calls == []
    assert knowledge.insert_edge_calls == []
    assert source_ledger.set_knowledge_node_id_calls == []


@pytest.mark.unit
def test_use_case_contains_no_promotion_logic_of_its_own() -> None:
    """The adapter reshapes + delegates only -- no tier flip / node-upsert / edge-insert literals."""
    import inspect

    source = inspect.getsource(PromoteSourceLedgerEntryUseCase)
    for forbidden in ("EXTRACTED", "upsert_node(", "insert_edge(", "find_active_node("):
        assert forbidden not in source, f"promote_source_ledger_entry.py must not contain {forbidden!r}"


@pytest.mark.unit
def test_confirm_action_dispatch_and_promote_edge_show_zero_diff() -> None:
    """The reuse proof: comparing the pre-56-05 base commit to the current working tree,
    NEITHER confirm_action_dispatch.py NOR promote_edge.py shows any diff -- promotion
    happens exclusively through the unchanged machinery. Mirrors
    test_source_capture_promote_reuse.py's own (docstring-stated) zero-diff claim, made
    explicit here as a real git-based assertion (git-diff, no shell, fixed argv).
    """
    repo_subdir = Path(__file__).resolve().parents[2]  # .../apps/email-listener
    git_executable = shutil.which("git") or "git"
    result = subprocess.run(  # noqa: S603 - fixed argv, no shell, test-only introspection
        [
            git_executable,
            "diff",
            "--stat",
            _PRE_PLAN_BASE_SHA,
            "--",
            "app/application/use_cases/confirm_action_dispatch.py",
            "app/application/use_cases/promote_edge.py",
        ],
        cwd=repo_subdir,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        # CI checks out with a shallow clone (actions/checkout fetch-depth: 1), so a historical
        # base commit is genuinely absent from the local object database — git reports "bad/unknown
        # revision". That is an environment limitation, not a violation of the reuse invariant, so
        # the proof SKIPS rather than fails; it still runs (and guards the invariant) against any
        # full-history checkout. This is what unblocked the staging/prod deploy pipeline.
        stderr = result.stderr.lower()
        if any(m in stderr for m in ("bad revision", "unknown revision", "ambiguous argument")):
            pytest.skip(
                f"base commit {_PRE_PLAN_BASE_SHA} is not present in this checkout "
                "(shallow clone / CI) — the zero-diff reuse proof only runs against full history"
            )
        raise AssertionError(f"git diff failed: {result.stderr}")
    assert result.stdout.strip() == "", (
        "confirm_action_dispatch.py / promote_edge.py must show ZERO diff since "
        f"{_PRE_PLAN_BASE_SHA} -- the promotion-gate reuse seam adds NO new promotion "
        f"machinery. Got:\n{result.stdout}"
    )
