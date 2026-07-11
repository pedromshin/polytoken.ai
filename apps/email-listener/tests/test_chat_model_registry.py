"""Tests for the curated multi-provider chat model registry (D-04..D-06, D-09, FOUND-2).

Placement mirrors the existing domain-service test convention (flat top-level
tests/test_*.py, e.g. test_key_terms.py, test_mime_parser.py) rather than a new
tests/unit/ directory, keeping one test-layout convention per Clean
Architecture layer across the whole test suite.
"""

from __future__ import annotations

import pytest

from app.domain.services.chat_model_registry import (
    CHAT_MODEL_REGISTRY,
    chat_registry_version,
    genui_capable_ids,
    get_model,
)

# ---------------------------------------------------------------------------
# Curated transports present (D-04)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_registry_has_at_least_one_bedrock_entry() -> None:
    """Registry must curate at least one Bedrock (Anthropic) entry (D-04)."""
    bedrock_entries = [model for model in CHAT_MODEL_REGISTRY if model.transport == "bedrock"]
    assert len(bedrock_entries) >= 1


@pytest.mark.unit
def test_registry_has_at_least_three_openrouter_entries() -> None:
    """Registry must curate at least three OpenRouter entries (D-04)."""
    openrouter_entries = [model for model in CHAT_MODEL_REGISTRY if model.transport == "openrouter"]
    assert len(openrouter_entries) >= 3


@pytest.mark.unit
def test_registry_has_at_least_one_browser_entry() -> None:
    """Registry must curate at least one in-browser WebLLM entry (D-08)."""
    browser_entries = [model for model in CHAT_MODEL_REGISTRY if model.transport == "browser"]
    assert len(browser_entries) >= 1


# ---------------------------------------------------------------------------
# Browser entries: locus + zero pricing (D-08, D-09)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_browser_entry_is_free_and_locus_browser() -> None:
    """Browser entries must have execution_locus='browser' and $0 pricing (D-08)."""
    browser_entries = [model for model in CHAT_MODEL_REGISTRY if model.transport == "browser"]
    assert browser_entries, "expected at least one browser entry"
    for entry in browser_entries:
        assert entry.execution_locus == "browser"
        assert entry.price_in_per_mtok == 0.0
        assert entry.price_out_per_mtok == 0.0


# ---------------------------------------------------------------------------
# Honest GenUI capability flags (D-05)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_at_least_one_entry_genui_true_and_one_false() -> None:
    """The picker must be able to distinguish GenUI-reliable models from the rest (D-05)."""
    genui_flags = {model.capabilities.genui for model in CHAT_MODEL_REGISTRY}
    assert True in genui_flags
    assert False in genui_flags


@pytest.mark.unit
def test_genui_capable_ids_only_include_genui_true_entries() -> None:
    """genui_capable_ids() must be a strict, non-empty subset of genui=True entries."""
    ids = genui_capable_ids()
    assert len(ids) >= 1
    for model_id in ids:
        model = get_model(model_id)
        assert model is not None
        assert model.capabilities.genui is True


# ---------------------------------------------------------------------------
# Content-hash version (FOUND-2, mirrors registry-version.ts)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_registry_version_is_stable_across_calls() -> None:
    """chat_registry_version() must be deterministic: same content -> same hash."""
    assert chat_registry_version() == chat_registry_version()


@pytest.mark.unit
def test_registry_version_is_64_char_hex_sha256() -> None:
    """chat_registry_version() must be a 64-hex-char SHA-256 digest."""
    version = chat_registry_version()
    assert len(version) == 64
    int(version, 16)  # raises ValueError if not valid hex


# ---------------------------------------------------------------------------
# get_model / lookup
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_model_returns_entry_for_known_id() -> None:
    known_id = CHAT_MODEL_REGISTRY[0].id
    result = get_model(known_id)
    assert result is not None
    assert result.id == known_id


@pytest.mark.unit
def test_get_model_returns_none_for_unknown_id() -> None:
    assert get_model("not-a-real-model-id") is None


@pytest.mark.unit
def test_no_duplicate_ids_in_registry() -> None:
    ids = [model.id for model in CHAT_MODEL_REGISTRY]
    assert len(ids) == len(set(ids)), "registry entries must have unique ids"


# ---------------------------------------------------------------------------
# max_tool_rounds capability gate (Phase 34, LOOP-01)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_only_bedrock_claude_entries_enable_tool_rounds() -> None:
    """Only the 2 Bedrock Claude entries carry max_tool_rounds=4; everyone else stays 0."""
    sonnet = get_model("us.anthropic.claude-sonnet-4-6")
    haiku = get_model("us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert sonnet is not None
    assert haiku is not None
    assert sonnet.capabilities.max_tool_rounds == 4
    assert haiku.capabilities.max_tool_rounds == 4

    for model in CHAT_MODEL_REGISTRY:
        if model.transport != "bedrock":
            assert model.capabilities.max_tool_rounds == 0, (
                f"{model.id} (transport={model.transport}) must not enable tool rounds"
            )
