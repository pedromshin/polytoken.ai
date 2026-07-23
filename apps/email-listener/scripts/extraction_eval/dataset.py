"""Extraction eval dataset: model, JSONL (de)serialization, deterministic scoring.

The eval set is a JSONL file whose first line is a ``meta`` object and whose
remaining lines are ``record`` objects, one per confirmed extraction_records
row. The dataset is GENERATED (by scripts.extraction_eval.build_dataset from
the SNAPSHOT_SQL query below, or from a fixture for the synthetic seed set) —
never hand-written; tests prove the committed file is byte-identical to a
builder re-run.

Scoring semantics (E2, per-field accuracy — offline, no LLM):
- Ground truth per record = ``{**extracted_fields, **corrected_fields}``:
  corrected_fields is an immutable human overlay; a confirmed record whose
  field was NOT corrected asserts the extracted value was right.
- A field is CORRECT when the model output for that slug normalizes equal to
  the ground-truth value. A field the overlay ADDED (model missed it) counts
  as incorrect for the model output.
- Extra predicted fields absent from ground truth are ignored (a
  hallucinated-extra-field penalty is a later E2 refinement — README).

Normalization is deliberately conservative: strings are whitespace-stripped,
int/float compare numerically, dicts/lists compare by canonical JSON, no
cross-type coercion ("100" != 100).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_VERSION = 1

# Canonical snapshot query (E1). The builder executes the PostgREST-equivalent
# filter chain against a LOCAL Supabase stack; this constant is the single
# written definition of what a dataset row IS, and its sha256 is stamped into
# every dataset's meta line so a dataset can never silently drift from the
# definition that produced it.
SNAPSHOT_SQL = """\
SELECT er.id,
       er.component_id,
       er.entity_type_id,
       et.slug AS entity_type_slug,
       ec.content_text AS component_text,
       er.extracted_fields,
       er.corrected_fields,
       er.confidence_score,
       er.status,
       er.created_at
FROM extraction_records er
JOIN entity_types et ON et.id = er.entity_type_id
JOIN email_components ec ON ec.id = er.component_id
WHERE er.status = 'confirmed'
ORDER BY er.created_at, er.id;
"""


def snapshot_sql_sha256() -> str:
    """Content hash of the canonical snapshot query, stamped into dataset meta."""
    return hashlib.sha256(SNAPSHOT_SQL.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Dataset model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DatasetMeta:
    """First JSONL line: identity + provenance of the frozen eval set."""

    schema_version: int
    dataset_version: str
    generated_at: str
    source: str
    record_count: int
    snapshot_sql_sha256: str


@dataclass(frozen=True)
class EvalRecord:
    """One confirmed extraction_records row, frozen for replay."""

    record_id: str
    entity_type_slug: str
    component_text: str
    extracted_fields: dict[str, object]
    corrected_fields: dict[str, object] | None
    confidence_score: float | None
    created_at: str


_REQUIRED_ROW_KEYS = ("id", "entity_type_slug", "component_text", "extracted_fields", "status", "created_at")


def row_to_record(row: Mapping[str, object]) -> EvalRecord:
    """Convert one snapshot row (SQL result or fixture) into an EvalRecord.

    An empty corrected_fields overlay ({}) is normalized to None — both mean
    "confirmed with no corrections".
    """
    missing = [key for key in _REQUIRED_ROW_KEYS if key not in row]
    if missing:
        raise ValueError(f"snapshot row is missing required keys {missing}: got keys {sorted(row)}")

    extracted = row["extracted_fields"]
    if not isinstance(extracted, dict):
        raise ValueError(f"extracted_fields must be an object, got {type(extracted).__name__}")

    corrected_raw = row.get("corrected_fields")
    if corrected_raw is not None and not isinstance(corrected_raw, dict):
        raise ValueError(f"corrected_fields must be an object or null, got {type(corrected_raw).__name__}")
    corrected: dict[str, object] | None = corrected_raw if corrected_raw else None

    confidence_raw = row.get("confidence_score")
    confidence = float(str(confidence_raw)) if confidence_raw is not None else None

    return EvalRecord(
        record_id=str(row["id"]),
        entity_type_slug=str(row["entity_type_slug"]),
        component_text=str(row["component_text"]),
        extracted_fields=extracted,
        corrected_fields=corrected,
        confidence_score=confidence,
        created_at=str(row["created_at"]),
    )


def build_dataset(
    rows: Iterable[Mapping[str, object]],
    *,
    dataset_version: str,
    generated_at: str,
    source: str,
) -> tuple[DatasetMeta, list[EvalRecord]]:
    """Filter to confirmed rows, sort deterministically, and stamp meta.

    The status filter is applied here as well as in SNAPSHOT_SQL so fixture
    paths get the exact same admission rule as the SQL path.
    """
    records = [row_to_record(row) for row in rows if row.get("status") == "confirmed"]
    records.sort(key=lambda r: (r.created_at, r.record_id))

    seen: set[str] = set()
    for record in records:
        if record.record_id in seen:
            raise ValueError(f"duplicate record_id in snapshot: {record.record_id}")
        seen.add(record.record_id)

    meta = DatasetMeta(
        schema_version=SCHEMA_VERSION,
        dataset_version=dataset_version,
        generated_at=generated_at,
        source=source,
        record_count=len(records),
        snapshot_sql_sha256=snapshot_sql_sha256(),
    )
    return meta, records


# ---------------------------------------------------------------------------
# JSONL (de)serialization — canonical: sorted keys, compact separators
# ---------------------------------------------------------------------------


def _dump_line(obj: Mapping[str, object]) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def dump_jsonl(meta: DatasetMeta, records: Sequence[EvalRecord]) -> str:
    lines = [
        _dump_line(
            {
                "kind": "meta",
                "schema_version": meta.schema_version,
                "dataset_version": meta.dataset_version,
                "generated_at": meta.generated_at,
                "source": meta.source,
                "record_count": meta.record_count,
                "snapshot_sql_sha256": meta.snapshot_sql_sha256,
            }
        )
    ]
    lines.extend(
        _dump_line(
            {
                "kind": "record",
                "record_id": r.record_id,
                "entity_type_slug": r.entity_type_slug,
                "component_text": r.component_text,
                "extracted_fields": r.extracted_fields,
                "corrected_fields": r.corrected_fields,
                "confidence_score": r.confidence_score,
                "created_at": r.created_at,
            }
        )
        for r in records
    )
    return "\n".join(lines) + "\n"


def write_dataset(path: Path, meta: DatasetMeta, records: Sequence[EvalRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_jsonl(meta, records), encoding="utf-8")


def load_dataset(path: Path) -> tuple[DatasetMeta, list[EvalRecord]]:
    """Load + structurally validate a frozen dataset (the enforced-now part of E1)."""
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"eval dataset {path} is empty")

    head = json.loads(lines[0])
    if head.get("kind") != "meta":
        raise ValueError(f"eval dataset {path} first line must be kind=meta, got {head.get('kind')!r}")
    if head.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(
            f"eval dataset {path} schema_version {head.get('schema_version')!r} != supported {SCHEMA_VERSION}"
        )
    meta = DatasetMeta(
        schema_version=int(head["schema_version"]),
        dataset_version=str(head["dataset_version"]),
        generated_at=str(head["generated_at"]),
        source=str(head["source"]),
        record_count=int(head["record_count"]),
        snapshot_sql_sha256=str(head["snapshot_sql_sha256"]),
    )

    records: list[EvalRecord] = []
    for i, line in enumerate(lines[1:], start=2):
        obj = json.loads(line)
        if obj.get("kind") != "record":
            raise ValueError(f"eval dataset {path} line {i}: expected kind=record, got {obj.get('kind')!r}")
        records.append(
            EvalRecord(
                record_id=str(obj["record_id"]),
                entity_type_slug=str(obj["entity_type_slug"]),
                component_text=str(obj["component_text"]),
                extracted_fields=dict(obj["extracted_fields"]),
                corrected_fields=dict(obj["corrected_fields"]) if obj["corrected_fields"] else None,
                confidence_score=(float(obj["confidence_score"]) if obj["confidence_score"] is not None else None),
                created_at=str(obj["created_at"]),
            )
        )

    if meta.record_count != len(records):
        raise ValueError(f"eval dataset {path} meta.record_count={meta.record_count} but found {len(records)} records")
    record_ids = [r.record_id for r in records]
    if len(set(record_ids)) != len(record_ids):
        raise ValueError(f"eval dataset {path} contains duplicate record_ids")
    return meta, records


def dataset_sha256(path: Path) -> str:
    """Content hash of the frozen dataset file — pins the baseline to it (E3)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# Scoring (E2 per-field accuracy) — pure, deterministic, no I/O
# ---------------------------------------------------------------------------


def normalize_value(value: object) -> tuple[str, object]:
    """Conservative comparison canonicalization; documented in module docstring.

    Returns a (type-tag, canonical-value) pair so equality never crosses
    types: Python would otherwise make True == 1.0 and 0 == False.
    """
    if isinstance(value, str):
        return ("str", value.strip())
    if isinstance(value, bool):
        return ("bool", value)
    if isinstance(value, int | float):
        return ("num", float(value))
    if isinstance(value, dict | list):
        return ("json", json.dumps(value, sort_keys=True, ensure_ascii=False))
    return ("other", value)


def ground_truth_fields(record: EvalRecord) -> dict[str, object]:
    """Human-approved truth: corrected overlay layered over extracted fields."""
    return {**record.extracted_fields, **(record.corrected_fields or {})}


def score_fields(predicted: Mapping[str, object], ground_truth: Mapping[str, object]) -> dict[str, bool]:
    """Per-slug correctness of ``predicted`` against ``ground_truth``.

    Slugs missing from ``predicted`` are wrong; extra predicted slugs ignored.
    """
    scores: dict[str, bool] = {}
    for slug, truth in ground_truth.items():
        scores[slug] = slug in predicted and normalize_value(predicted[slug]) == normalize_value(truth)
    return scores


def score_record(record: EvalRecord) -> dict[str, bool]:
    """Score the FROZEN model output (extracted_fields) against ground truth."""
    return score_fields(record.extracted_fields, ground_truth_fields(record))


@dataclass(frozen=True)
class FieldScore:
    total: int
    correct: int

    @property
    def accuracy(self) -> float:
        return self.correct / self.total if self.total else 0.0


@dataclass(frozen=True)
class AggregateReport:
    record_count: int
    per_field: dict[str, FieldScore] = field(default_factory=dict)

    @property
    def field_total(self) -> int:
        return sum(fs.total for fs in self.per_field.values())

    @property
    def field_correct(self) -> int:
        return sum(fs.correct for fs in self.per_field.values())

    @property
    def overall_accuracy(self) -> float:
        return self.field_correct / self.field_total if self.field_total else 0.0


def _aggregate(score_maps: Sequence[Mapping[str, bool]]) -> AggregateReport:
    totals: dict[str, int] = {}
    corrects: dict[str, int] = {}
    for scores in score_maps:
        for slug, ok in scores.items():
            totals[slug] = totals.get(slug, 0) + 1
            corrects[slug] = corrects.get(slug, 0) + (1 if ok else 0)
    per_field = {slug: FieldScore(total=totals[slug], correct=corrects[slug]) for slug in totals}
    return AggregateReport(record_count=len(score_maps), per_field=per_field)


def aggregate_scores(records: Sequence[EvalRecord]) -> AggregateReport:
    """Offline E2 aggregate over the frozen set (no LLM, no I/O)."""
    return _aggregate([score_record(r) for r in records])


async def replay_with_extractor(
    records: Sequence[EvalRecord],
    extractor: Callable[[EvalRecord], Awaitable[dict[str, object]]],
) -> AggregateReport:
    """Replay extraction with a live/stub extractor and score against ground truth.

    ``extractor`` maps a record (component_text + entity_type_slug + the
    ground-truth field slugs available on the record) to predicted fields.
    The LLM-backed extractor only runs behind RUN_EXTRACTION_EVAL=1 — see
    tests/evals/test_extraction_replay.py.
    """
    score_maps: list[dict[str, bool]] = []
    for record in records:
        predicted = await extractor(record)
        score_maps.append(score_fields(predicted, ground_truth_fields(record)))
    return _aggregate(score_maps)


# ---------------------------------------------------------------------------
# Report serialization (baseline file + human-readable output)
# ---------------------------------------------------------------------------


def report_to_dict(
    report: AggregateReport,
    *,
    dataset_version: str,
    dataset_file: str,
    dataset_sha256_hex: str,
) -> dict[str, object]:
    """Canonical (sorted, rounded) report — the committed baseline's exact shape."""
    return {
        "dataset_version": dataset_version,
        "dataset_file": dataset_file,
        "dataset_sha256": dataset_sha256_hex,
        "record_count": report.record_count,
        "field_total": report.field_total,
        "field_correct": report.field_correct,
        "overall_accuracy": round(report.overall_accuracy, 6),
        "per_field": {
            slug: {
                "total": fs.total,
                "correct": fs.correct,
                "accuracy": round(fs.accuracy, 6),
            }
            for slug, fs in sorted(report.per_field.items())
        },
    }


def format_report(report: AggregateReport) -> str:
    lines = [
        f"records={report.record_count} fields={report.field_total} "
        f"correct={report.field_correct} overall_accuracy={report.overall_accuracy:.4f}"
    ]
    lines.extend(
        f"  field={slug} total={fs.total} correct={fs.correct} accuracy={fs.accuracy:.4f}"
        for slug, fs in sorted(report.per_field.items())
    )
    return "\n".join(lines)
