"""Snapshot confirmed extraction_records into a versioned JSONL eval set.

The dataset is SQL-GENERATED, never hand-written: dataset.SNAPSHOT_SQL is the
canonical definition, and this builder executes its PostgREST-equivalent
filter chain against a LOCAL Supabase stack (the same
INTEGRATION_SUPABASE_URL / INTEGRATION_SUPABASE_SERVICE_KEY convention as
tests/test_integration_real_postgres.py, which is documented as
never-hits-prod). Non-local hosts are refused outright.

Degrades gracefully with "not-run: no DB" (exit 0) when creds are absent so
CI without a database still passes.

Usage:
    cd apps/email-listener

    # Real snapshot from the local seeded stack:
    INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321 \
    INTEGRATION_SUPABASE_SERVICE_KEY=<service_role key> \
    uv run python -m scripts.extraction_eval.build_dataset \
        --dataset-version v2 \
        --output tests/evals/datasets/extraction-eval-v2.jsonl

    # Deterministic regeneration of the committed synthetic seed set:
    uv run python -m scripts.extraction_eval.build_dataset \
        --from-fixture tests/evals/fixtures/extraction_seed_rows.json \
        --dataset-version v1 \
        --generated-at 2026-07-23T00:00:00+00:00 \
        --output tests/evals/datasets/extraction-eval-v1.jsonl

Not imported by any app code — standalone script (like scripts.backfill_threads).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scripts.extraction_eval.dataset import build_dataset, write_dataset

ENV_URL = "INTEGRATION_SUPABASE_URL"
ENV_KEY = "INTEGRATION_SUPABASE_SERVICE_KEY"

# Hard guardrail: this builder NEVER talks to a non-local database. There is
# deliberately no env-var override — extend this allowlist in code (reviewed
# diff) if a dedicated non-prod eval DB ever exists.
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_local_db_url(url: str) -> bool:
    """True only for URLs whose host is a loopback name/address."""
    try:
        host = urlparse(url).hostname
    except ValueError:
        return False
    return host in _LOCAL_HOSTS


def fetch_confirmed_rows(client: Any) -> list[dict[str, object]]:
    """Execute the PostgREST equivalent of dataset.SNAPSHOT_SQL.

    Embedded resources (entity_types.slug, email_components.content_text)
    stand in for the SQL joins; the status filter and ordering match the
    canonical query. Flattens to the row shape row_to_record() expects.
    """
    response = (
        client.table("extraction_records")
        .select(
            "id, component_id, entity_type_id, extracted_fields, corrected_fields, "
            "confidence_score, status, created_at, "
            "entity_types(slug), email_components(content_text)"
        )
        .eq("status", "confirmed")
        .order("created_at")
        .order("id")
        .execute()
    )
    rows: list[dict[str, object]] = []
    for raw in response.data or []:
        entity_type = raw.get("entity_types") or {}
        component = raw.get("email_components") or {}
        rows.append(
            {
                "id": raw["id"],
                "entity_type_slug": entity_type.get("slug") or raw["entity_type_id"],
                "component_text": component.get("content_text") or "",
                "extracted_fields": raw.get("extracted_fields") or {},
                "corrected_fields": raw.get("corrected_fields"),
                "confidence_score": raw.get("confidence_score"),
                "status": raw["status"],
                "created_at": raw["created_at"],
            }
        )
    return rows


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Snapshot confirmed extraction_records into a JSONL eval set.")
    parser.add_argument("--output", required=True, type=Path, help="Path of the JSONL dataset to write.")
    parser.add_argument("--dataset-version", required=True, help="Dataset version tag, e.g. v1.")
    parser.add_argument(
        "--generated-at",
        default=None,
        help="ISO-8601 timestamp stamped into meta (default: now UTC). Fix it for reproducible regeneration.",
    )
    parser.add_argument(
        "--from-fixture",
        default=None,
        type=Path,
        help="Build from a JSON fixture of snapshot rows instead of a database (seed-set regeneration).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if args.generated_at is not None:
        # Validate early — a bad timestamp must not produce a dataset.
        datetime.fromisoformat(args.generated_at)
        generated_at = args.generated_at
    else:
        generated_at = datetime.now(UTC).isoformat(timespec="seconds")

    if args.from_fixture is not None:
        rows = json.loads(args.from_fixture.read_text(encoding="utf-8"))
        source = f"fixture:{args.from_fixture.name}"
    else:
        url = os.environ.get(ENV_URL, "")
        key = os.environ.get(ENV_KEY, "")
        if not (url and key):
            print(f"not-run: no DB ({ENV_URL} / {ENV_KEY} not set)")
            return 0
        if not is_local_db_url(url):
            print(
                f"REFUSED: {ENV_URL} host is not local ({url!r}). "
                "This builder only ever runs against a local/test stack — no prod DB connections."
            )
            return 1
        from supabase import create_client  # noqa: PLC0415 — only needed on the live-DB path

        client = create_client(url, key)
        rows = fetch_confirmed_rows(client)
        source = "sql-snapshot"

    meta, records = build_dataset(
        rows,
        dataset_version=args.dataset_version,
        generated_at=generated_at,
        source=source,
    )
    if not records:
        print("not-run: 0 confirmed extraction_records to snapshot — nothing written")
        return 0

    write_dataset(args.output, meta, records)
    print(
        f"wrote {meta.record_count} records to {args.output} "
        f"(dataset_version={meta.dataset_version} source={meta.source} generated_at={meta.generated_at})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
