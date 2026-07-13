"""requirements.txt ⊇ pyproject.toml runtime dependencies (Docker-image parity gate).

The Docker image installs from the hand-maintained requirements.txt while
local dev and CI install from pyproject.toml via uv — the two files CAN
drift, and did: `jsonschema` was added to pyproject (Phase 24, widget result
validation) but never to requirements.txt, so every prod ECS task built
after that crashed at import time (`ModuleNotFoundError: No module named
'jsonschema'`, found live 2026-07-13 — the deploy circuit breaker rolled
prod back on every push). This test makes the drift a CI failure instead of
a prod outage.

Comparison is by normalized distribution NAME only (PEP 503: lowercase,
runs of `-_.` collapse to `-`; extras stripped) — version specifiers may
legitimately differ between the files.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

_APP_DIR = Path(__file__).resolve().parent.parent


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(line: str) -> str | None:
    """Distribution name from one requirement line (None for blanks/comments)."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", stripped)
    return _normalize(match.group(1)) if match else None


@pytest.mark.unit
def test_requirements_txt_covers_every_pyproject_runtime_dependency() -> None:
    pyproject = tomllib.loads((_APP_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    runtime_deps = {
        name for dep in pyproject["project"]["dependencies"] if (name := _requirement_name(dep)) is not None
    }

    requirements_lines = (_APP_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines()
    requirements = {name for line in requirements_lines if (name := _requirement_name(line)) is not None}

    missing = sorted(runtime_deps - requirements)
    assert not missing, (
        f"requirements.txt is missing runtime dependencies declared in pyproject.toml: {missing}. "
        "The Docker image installs ONLY requirements.txt — a missing entry crashes every prod task "
        "at import time (see this file's docstring). Add the package to requirements.txt."
    )
