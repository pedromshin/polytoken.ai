"""Retrieval golden-set (EVAL-06) Python-side runner (Plan 35-03, Task 2).

Loads the SAME retrieval-golden-set.json Plan 35-02 committed to
packages/genui/src/eval/ (via eval_fixtures_dir()'s monorepo-relative
resolver) and round-trips every entry through Phase 34's EchoToolExecutor
stub, proving the fixture -> stub -> parse -> score wiring is exact for an
identity echo. Real (non-identity) scoring lands with Phases 36/37's actual
retrieval tools -- this only proves the scaffold.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.evals._paths import eval_fixtures_dir
from tests.evals._scorers import score_retrieval_at_k
from tests.support.echo_tool_executor import EchoToolExecutor


def _load_golden_entries() -> list[dict[str, Any]]:
    path = eval_fixtures_dir() / "retrieval-golden-set.json"
    return json.loads(Path(path).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.mark.unit
def test_golden_set_loads_at_least_five_entries() -> None:
    entries = _load_golden_entries()
    assert len(entries) >= 5


@pytest.mark.unit
def test_golden_entries_have_required_non_empty_fields() -> None:
    entries = _load_golden_entries()
    for entry in entries:
        assert entry.get("id") is not None
        assert entry.get("query")
        assert entry.get("expected_ids")
        assert entry.get("notes") is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_golden_entries_round_trip_through_echo_stub_score_perfectly() -> None:
    entries = _load_golden_entries()
    executor = EchoToolExecutor()

    for entry in entries:
        arguments = {"expected_ids": entry["expected_ids"]}
        result = await executor.execute(
            name="retrieval_stub",
            arguments=arguments,
            importer_id="imp-test-0000-0000-0000-000000000001",
        )
        actual_ids = json.loads(result.content)["expected_ids"]

        recall, precision = score_retrieval_at_k(actual_ids, entry["expected_ids"], k=5)

        assert recall == 1.0, f"entry id={entry['id']} did not round-trip recall=1.0"
        assert precision == 1.0, f"entry id={entry['id']} did not round-trip precision=1.0"
