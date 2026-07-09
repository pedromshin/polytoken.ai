"""Retrieval golden-set (EVAL-06) Python-side runner (Plan 35-03, Task 2; extended Plan 38-02, Task 2).

Loads the SAME retrieval-golden-set.json Plan 35-02 committed to
packages/genui/src/eval/ (via eval_fixtures_dir()'s monorepo-relative
resolver) and round-trips every entry through Phase 34's EchoToolExecutor
stub, proving the fixture -> stub -> parse -> score wiring is exact for an
identity echo. Real (non-identity) scoring lands with Phases 36/37's actual
retrieval tools -- this only proves the scaffold.

Plan 38-02 (EVAL-06 fold-in) appends real-data entries (ids 8+) sourced from
REAL rows in the local seeded dev DB -- the original 7 entries (ids 1-7) stay
untouched, still using clearly-synthetic id prefixes (`entity-`/
`email-seed-`/`node-seed-`). The companion test below proves the two sets
never overlap on that convention.
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


_SYNTHETIC_ID_PREFIXES = ("entity-", "email-seed-", "node-seed-")
_ORIGINAL_SEED_ENTRY_IDS = frozenset(range(1, 8))


@pytest.mark.unit
def test_new_real_data_entries_ids_do_not_use_synthetic_placeholder_prefixes() -> None:
    """Plan 38-02 (EVAL-06): every entry appended AFTER the original 7 seed entries carries a
    real, DB-resolvable id -- never one of the original synthetic placeholder prefixes.
    """
    entries = _load_golden_entries()
    new_entries = [e for e in entries if e["id"] not in _ORIGINAL_SEED_ENTRY_IDS]
    assert new_entries, "expected at least one real-data entry appended beyond the original 7 seed entries"

    for entry in new_entries:
        for expected in entry["expected_ids"]:
            assert not expected["id"].startswith(_SYNTHETIC_ID_PREFIXES), (
                f"entry id={entry['id']} expected_ids contains a synthetic-placeholder-prefixed id "
                f"{expected['id']!r} -- real-data entries must use real DB-resolvable ids"
            )


@pytest.mark.unit
def test_original_seed_entries_are_left_verbatim_with_synthetic_ids() -> None:
    """The original 7 seed entries (ids 1-7) are never mutated in place -- they still use the
    documented synthetic placeholder prefixes (per EVAL-DIMENSIONS.README.md's seed-vs-real split).
    """
    entries = _load_golden_entries()
    original_entries = [e for e in entries if e["id"] in _ORIGINAL_SEED_ENTRY_IDS]
    assert len(original_entries) == 7

    for entry in original_entries:
        for expected in entry["expected_ids"]:
            assert expected["id"].startswith(_SYNTHETIC_ID_PREFIXES), (
                f"original seed entry id={entry['id']} unexpectedly carries a non-synthetic id "
                f"{expected['id']!r} -- original entries must be appended-around, never mutated in place"
            )


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
