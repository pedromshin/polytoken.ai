"""Behavioral tests for the extraction-eval dataset builder (E1, enforced-now part).

Offline, no DB, no LLM. Proves:
- the committed v1 dataset is byte-identical to a builder re-run from its
  fixture (SQL/builder-generated, never hand-edited);
- the snapshot admission rule (status='confirmed') is applied on every path;
- the builder degrades gracefully ("not-run: no DB") without creds and
  REFUSES non-local database hosts outright (no prod connections, ever).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from scripts.extraction_eval.build_dataset import ENV_KEY, ENV_URL, is_local_db_url, main
from scripts.extraction_eval.dataset import (
    SNAPSHOT_SQL,
    build_dataset,
    dump_jsonl,
    load_dataset,
    row_to_record,
    snapshot_sql_sha256,
)

_EVALS_DIR = Path(__file__).parent
_FIXTURE = _EVALS_DIR / "fixtures" / "extraction_seed_rows.json"
_DATASET = _EVALS_DIR / "datasets" / "extraction-eval-v1.jsonl"


# ---------------------------------------------------------------------------
# Canonical SQL definition
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_snapshot_sql_selects_only_confirmed_records_with_joined_context() -> None:
    assert "WHERE er.status = 'confirmed'" in SNAPSHOT_SQL
    assert "FROM extraction_records" in SNAPSHOT_SQL
    assert "JOIN entity_types" in SNAPSHOT_SQL
    assert "JOIN email_components" in SNAPSHOT_SQL
    assert "extracted_fields" in SNAPSHOT_SQL
    assert "corrected_fields" in SNAPSHOT_SQL
    # Deterministic snapshot ordering — datasets must be reproducible.
    assert "ORDER BY er.created_at, er.id" in SNAPSHOT_SQL


@pytest.mark.unit
def test_committed_dataset_meta_is_stamped_with_current_snapshot_sql_hash() -> None:
    """E1: the frozen set must carry the hash of the query definition that
    produced it — changing SNAPSHOT_SQL without re-snapshotting fails here."""
    meta, _ = load_dataset(_DATASET)
    assert meta.snapshot_sql_sha256 == snapshot_sql_sha256()


# ---------------------------------------------------------------------------
# Row conversion + admission rule
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_row_to_record_rejects_rows_missing_required_keys() -> None:
    with pytest.raises(ValueError, match="missing required keys"):
        row_to_record({"id": "x", "status": "confirmed"})


@pytest.mark.unit
def test_row_to_record_normalizes_empty_corrections_overlay_to_none() -> None:
    row = {
        "id": "r1",
        "entity_type_slug": "commercial_invoice",
        "component_text": "text",
        "extracted_fields": {"a": 1},
        "corrected_fields": {},
        "confidence_score": "0.9100",
        "status": "confirmed",
        "created_at": "2026-07-01T00:00:00+00:00",
    }
    record = row_to_record(row)
    assert record.corrected_fields is None
    # numeric(5,4) columns arrive as strings from Postgres — coerced to float.
    assert record.confidence_score == pytest.approx(0.91)


@pytest.mark.unit
def test_build_dataset_drops_non_confirmed_rows_on_every_path() -> None:
    rows = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    assert any(r["status"] != "confirmed" for r in rows), "fixture must exercise the admission rule"

    meta, records = build_dataset(rows, dataset_version="vtest", generated_at="2026-07-23T00:00:00+00:00", source="t")

    assert meta.record_count == len(records)
    assert all(r["id"] not in {rec.record_id for rec in records} for r in rows if r["status"] != "confirmed")
    assert len(records) == sum(1 for r in rows if r["status"] == "confirmed")


@pytest.mark.unit
def test_build_dataset_rejects_duplicate_record_ids() -> None:
    row = {
        "id": "dup",
        "entity_type_slug": "t",
        "component_text": "x",
        "extracted_fields": {},
        "status": "confirmed",
        "created_at": "2026-07-01T00:00:00+00:00",
    }
    with pytest.raises(ValueError, match="duplicate record_id"):
        build_dataset([row, dict(row)], dataset_version="v", generated_at="g", source="s")


# ---------------------------------------------------------------------------
# Committed dataset is builder-generated, byte for byte
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_committed_v1_dataset_is_byte_identical_to_a_builder_rerun(tmp_path: Path) -> None:
    """The committed JSONL must never be hand-edited: regenerating it from the
    committed fixture with the committed meta pins must reproduce it exactly."""
    meta, _ = load_dataset(_DATASET)
    out = tmp_path / "regen.jsonl"

    exit_code = main(
        [
            "--from-fixture",
            str(_FIXTURE),
            "--dataset-version",
            meta.dataset_version,
            "--generated-at",
            meta.generated_at,
            "--output",
            str(out),
        ]
    )

    assert exit_code == 0
    assert out.read_bytes() == _DATASET.read_bytes()


@pytest.mark.unit
def test_dump_and_load_round_trip_preserves_records(tmp_path: Path) -> None:
    rows = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    meta, records = build_dataset(rows, dataset_version="vrt", generated_at="2026-07-23T00:00:00+00:00", source="t")

    path = tmp_path / "rt.jsonl"
    path.write_text(dump_jsonl(meta, records), encoding="utf-8")
    meta2, records2 = load_dataset(path)

    assert meta2 == meta
    assert records2 == records


# ---------------------------------------------------------------------------
# Graceful degradation + local-only guardrail
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_main_without_db_creds_prints_not_run_and_exits_zero(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv(ENV_URL, raising=False)
    monkeypatch.delenv(ENV_KEY, raising=False)

    exit_code = main(["--dataset-version", "vx", "--output", str(tmp_path / "out.jsonl")])

    assert exit_code == 0
    assert "not-run: no DB" in capsys.readouterr().out
    assert not (tmp_path / "out.jsonl").exists()


@pytest.mark.unit
def test_main_refuses_non_local_db_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.setenv(ENV_URL, "https://example.supabase.co")
    monkeypatch.setenv(ENV_KEY, "sb_secret_test_not_a_real_key")

    exit_code = main(["--dataset-version", "vx", "--output", str(tmp_path / "out.jsonl")])

    assert exit_code == 1
    assert "REFUSED" in capsys.readouterr().out
    assert not (tmp_path / "out.jsonl").exists()


@pytest.mark.unit
@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://127.0.0.1:54321", True),
        ("http://localhost:54321", True),
        ("http://[::1]:54321", True),
        ("https://example.supabase.co", False),
        ("http://10.0.0.5:54321", False),
        ("", False),
    ],
)
def test_is_local_db_url(url: str, expected: bool) -> None:
    assert is_local_db_url(url) is expected


@pytest.mark.unit
def test_main_rejects_malformed_generated_at(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Invalid isoformat"):
        main(
            [
                "--from-fixture",
                str(_FIXTURE),
                "--dataset-version",
                "vx",
                "--generated-at",
                "yesterday-ish",
                "--output",
                str(tmp_path / "out.jsonl"),
            ]
        )
