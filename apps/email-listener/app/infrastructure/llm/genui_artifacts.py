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
_DEFAULT_ARTIFACTS_DIR = _THIS_FILE.parents[5] / "packages" / "genui" / "artifacts"


def _get_artifacts_dir() -> Path:
    env_override = os.environ.get("GENUI_ARTIFACTS_DIR", "").strip()
    if env_override:
        return Path(env_override)
    return _DEFAULT_ARTIFACTS_DIR


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_spec_schema() -> dict[str, Any]:
    """Load and cache spec.schema.json from the genui artifacts directory.

    Raises RuntimeError if the file is missing (startup guard — not deferred
    to first request to avoid silent misconfig in production).
    """
    artifacts_dir = _get_artifacts_dir()
    schema_path = artifacts_dir / "spec.schema.json"
    if not schema_path.exists():
        raise RuntimeError(
            f"GenUI spec schema not found at {schema_path}. "
            "Set GENUI_ARTIFACTS_DIR to the directory containing spec.schema.json."
        )
    with schema_path.open(encoding="utf-8") as f:
        return json.load(f)  # type: ignore[no-any-return]


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
