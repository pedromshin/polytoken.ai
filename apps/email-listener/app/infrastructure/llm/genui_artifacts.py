"""GenUI artifact loader — loads spec schema and prompt payload from disk.

Artifacts live at packages/genui/artifacts/ in the monorepo root.
At runtime (Docker ECS) the monorepo root is mounted at /app/monorepo or the
artifacts path is configured via GENUI_ARTIFACTS_DIR env var.

Both loaders are @lru_cache backed: first call reads disk, subsequent calls
return the cached result.  Missing files raise RuntimeError at startup (not a
FileNotFoundError buried in a request handler).

Security note (D-11, D-14): artifacts are trusted static content loaded from
the Docker image / monorepo — not from user-supplied paths.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Artifact path resolution
# ---------------------------------------------------------------------------

# Default: walk up from this file to find the monorepo root (packages/genui/artifacts/).
# In Docker the env var GENUI_ARTIFACTS_DIR overrides this.
_THIS_FILE = Path(__file__).resolve()


def _get_artifacts_dir() -> Path:
    env_override = os.environ.get("GENUI_ARTIFACTS_DIR", "").strip()
    if env_override:
        return Path(env_override)
    # Dev/host fallback: walk up to the monorepo root
    # (repo_root/packages/genui/artifacts). Bounded so it never IndexErrors in a
    # container layout where this file sits shallower than the monorepo root —
    # containers/production MUST set GENUI_ARTIFACTS_DIR (see the Dockerfile),
    # which short-circuits this branch entirely.
    parents = _THIS_FILE.parents
    if len(parents) > 5:
        return parents[5] / "packages" / "genui" / "artifacts"
    raise RuntimeError(
        "GENUI_ARTIFACTS_DIR is not set and the monorepo root could not be located "
        f"from {_THIS_FILE}. In Docker/production set GENUI_ARTIFACTS_DIR to the "
        "directory containing spec.schema.json (see apps/email-listener/Dockerfile)."
    )


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_spec_schema() -> dict[str, Any]:
    """Load and cache spec.schema.json from the genui artifacts directory.

    Raises RuntimeError if the file is missing (startup guard — not deferred
    to first request to avoid silent misconfig in production) or if the schema
    root is not a Bedrock-valid object schema (see _assert_bedrock_input_schema).
    """
    artifacts_dir = _get_artifacts_dir()
    schema_path = artifacts_dir / "spec.schema.json"
    if not schema_path.exists():
        raise RuntimeError(
            f"GenUI spec schema not found at {schema_path}. "
            "Set GENUI_ARTIFACTS_DIR to the directory containing spec.schema.json."
        )
    with schema_path.open(encoding="utf-8") as f:
        schema = json.load(f)
    _assert_bedrock_input_schema(schema, schema_path)
    return schema  # type: ignore[no-any-return]


def _assert_bedrock_input_schema(schema: Any, schema_path: Path) -> None:
    """Guard that the spec schema is a valid Bedrock/Anthropic tool input_schema.

    Anthropic/Bedrock requires the forced-tool ``input_schema`` root to carry a
    top-level ``"type": "object"``. A zod-to-json-schema wrapper root of the form
    ``{"$ref": "#/definitions/SpecRoot", "definitions": {...}}`` has NO root
    ``type`` and makes EVERY live generation fail at the API boundary with the
    cryptic ``tools.0.custom.input_schema.type: Field required`` 400 (BUG-B).

    We fail fast here with a clear, actionable error instead of letting that
    surface as an opaque Bedrock 400 inside the request path.
    """
    if not isinstance(schema, dict):
        raise RuntimeError(f"GenUI spec schema at {schema_path} must be a JSON object, got {type(schema).__name__}.")
    root_type = schema.get("type")
    if root_type != "object":
        raise RuntimeError(
            f"GenUI spec schema at {schema_path} has an invalid root for a Bedrock "
            f'tool input_schema: expected top-level "type": "object", got '
            f"{root_type!r}. Re-run `npm run gen:artifacts -w @polytoken/genui` so the "
            "SpecRoot definition is inlined at the schema root (BUG-B)."
        )


@lru_cache(maxsize=1)
def load_prompt_payload() -> dict[str, Any]:
    """Load and cache genui-prompt.json from the genui artifacts directory.

    Raises RuntimeError if the file is missing (startup guard).
    """
    artifacts_dir = _get_artifacts_dir()
    prompt_path = artifacts_dir / "genui-prompt.json"
    if not prompt_path.exists():
        raise RuntimeError(
            f"GenUI prompt payload not found at {prompt_path}. "
            "Set GENUI_ARTIFACTS_DIR to the directory containing genui-prompt.json."
        )
    with prompt_path.open(encoding="utf-8") as f:
        return json.load(f)  # type: ignore[no-any-return]
