"""Tests for the Python capability registry (Phase 68 / REG-02, INV-1/INV-5).

Covers the ONE source of truth the chat tool loop reads from: a `Capability`
declared once, projected into the two mappings `RunChatTurn` consumes
(`executors()` / `tool_defs()`) keyed identically by construction, plus the
fails-closed resolution guard (INV-5) and the duplicate-id guard.

`_FakeExecutor` is a local `ToolExecutor` double (the same seam Phase 34 used an
`EchoToolExecutor` stub for) -- the registry never runs it; these tests assert
wiring and metadata, not execution. It is defined locally rather than imported
from `app.infrastructure` because this file lives under `app.application` and the
"Application does not import infrastructure" lint-imports contract forbids that
cross-layer import (same convention test_evaluate_anticipatory_candidates.py uses).
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest

from app.application.capabilities.registry import (
    Capability,
    CapabilityManifestEntry,
    CapabilityRegistry,
    DuplicateCapabilityError,
    NonReadCapabilityError,
    UnknownCapabilityError,
    assert_model_callable_read_only,
    define_capability,
)
from app.domain.ports.tool_executor import ToolExecutionResult


class _FakeExecutor:
    """A local ToolExecutor double -- satisfies the port structurally, never run here."""

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        return ToolExecutionResult(tool_use_id="t", content="{}")


def _tool_def(name: str, description: str = "does a thing") -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "input_schema": {"type": "object", "additionalProperties": False},
    }


def _capability(name: str, **overrides: Any) -> Capability:
    kwargs: dict[str, Any] = {
        "executor": _FakeExecutor(),
        "tool_def": _tool_def(name),
        "risk": "read",
        "cost": "cheap",
    }
    kwargs.update(overrides)
    return define_capability(**kwargs)


# --- define_capability -----------------------------------------------------


def test_define_capability_defaults_id_and_describe_from_tool_def() -> None:
    cap = define_capability(
        executor=_FakeExecutor(),
        tool_def=_tool_def("lookup_entity", "look up an entity"),
        risk="read",
        cost="cheap",
    )

    # id/describe are sourced from the tool_def so the schema stays the single
    # source of truth (no second place to drift).
    assert cap.id == "lookup_entity"
    assert cap.describe == "look up an entity"
    # INV-3 constants today.
    assert cap.source == "builtin"
    assert cap.trust == "first-party"


def test_define_capability_is_frozen() -> None:
    cap = _capability("web_search")
    with pytest.raises(dataclasses.FrozenInstanceError):
        cap.id = "mutated"  # type: ignore[misc]


def test_define_capability_raises_when_id_disagrees_with_tool_def_name() -> None:
    # id is the resolution key AND the tool name the LLM calls -- a mismatch would
    # silently unwire the executor from the tool the model can invoke.
    with pytest.raises(ValueError, match="!= tool_def name"):
        define_capability(
            executor=_FakeExecutor(),
            tool_def=_tool_def("web_search"),
            risk="read",
            cost="cheap",
            id="not_web_search",
        )


# --- CapabilityRegistry construction ---------------------------------------


def test_registry_preserves_declaration_order_in_ids() -> None:
    registry = CapabilityRegistry(
        [_capability("lookup_entity"), _capability("search_emails"), _capability("web_search")]
    )
    assert registry.ids == ("lookup_entity", "search_emails", "web_search")


def test_registry_raises_on_duplicate_id() -> None:
    with pytest.raises(DuplicateCapabilityError, match="duplicate capability id 'lookup_entity'"):
        CapabilityRegistry([_capability("lookup_entity"), _capability("lookup_entity")])


# --- derived mappings: the two dicts, from one declaration ------------------


def test_executors_and_tool_defs_are_keyed_identically_from_one_declaration() -> None:
    lookup = _capability("lookup_entity")
    web = _capability("web_search")
    registry = CapabilityRegistry([lookup, web])

    executors = registry.executors()
    tool_defs = registry.tool_defs()

    # The invariant the old two hand-maintained parallel dicts had to uphold by
    # hand is now structural: same keys, same order, no drift possible.
    assert list(executors.keys()) == list(tool_defs.keys()) == ["lookup_entity", "web_search"]
    assert executors["lookup_entity"] is lookup.executor
    assert executors["web_search"] is web.executor
    assert tool_defs["lookup_entity"] is lookup.tool_def
    assert tool_defs["web_search"] is web.tool_def


def test_executors_mapping_is_read_only() -> None:
    registry = CapabilityRegistry([_capability("lookup_entity")])
    with pytest.raises(TypeError):
        registry.executors()["x"] = _FakeExecutor()  # type: ignore[index]


def test_tool_defs_mapping_is_read_only() -> None:
    registry = CapabilityRegistry([_capability("lookup_entity")])
    with pytest.raises(TypeError):
        registry.tool_defs()["x"] = _tool_def("x")  # type: ignore[index]


def test_missing_key_on_derived_executors_still_raises_keyerror() -> None:
    # The loop does `self._tool_executors[name]`; the derived mapping preserves
    # that never-silently-no-op access shape.
    registry = CapabilityRegistry([_capability("lookup_entity")])
    with pytest.raises(KeyError):
        _ = registry.executors()["nope"]


# --- fails-closed resolution (INV-5) ---------------------------------------


def test_get_returns_the_registered_capability() -> None:
    lookup = _capability("lookup_entity")
    registry = CapabilityRegistry([lookup])
    assert registry.get("lookup_entity") is lookup


def test_get_unregistered_id_fails_closed_and_never_returns_none() -> None:
    registry = CapabilityRegistry([_capability("lookup_entity")])
    with pytest.raises(UnknownCapabilityError):
        registry.get("unregistered_tool")


def test_unknown_capability_error_is_a_keyerror_subclass() -> None:
    # Swapping registry.get(x) in for the old tool_executors[x] dict access keeps
    # the same failure family callers may already catch.
    assert issubclass(UnknownCapabilityError, KeyError)
    registry = CapabilityRegistry([_capability("lookup_entity")])
    with pytest.raises(KeyError):
        registry.get("unregistered_tool")


# --- list(): the registry pointed outward ----------------------------------


def test_list_projects_metadata_with_no_executable_coupling() -> None:
    registry = CapabilityRegistry(
        [
            _capability("lookup_entity", risk="read", cost="cheap"),
            _capability("web_search", risk="read", cost="moderate"),
        ]
    )

    manifest = registry.list()

    assert manifest == (
        CapabilityManifestEntry(
            id="lookup_entity",
            describe="does a thing",
            risk="read",
            cost="cheap",
            source="builtin",
            trust="first-party",
        ),
        CapabilityManifestEntry(
            id="web_search",
            describe="does a thing",
            risk="read",
            cost="moderate",
            source="builtin",
            trust="first-party",
        ),
    )
    # No executable coupling on the outward projection.
    assert not any(hasattr(entry, "executor") for entry in manifest)


# --- assert_model_callable_read_only (W9-1: the ENFORCED read-tier gate) -----
#
# The chat tool loop awaits `registry.executors()[tool_name]` for whatever tool
# the model names (run_chat_turn_server_rounds.py:218) with NO risk check, and
# the model's tool choice is influenced by untrusted content (email bodies,
# web_search / deep_research page text). The ONLY thing making that safe today
# is that every chat capability is risk="read" -- a fact this module's header
# merely ASSERTED IN PROSE until this guard existed.


@pytest.mark.unit
def test_assert_model_callable_read_only_passes_for_an_all_read_registry() -> None:
    """Behaviour-preserving: today's all-read chat registry passes unchanged."""
    registry = CapabilityRegistry([_capability("lookup_entity", risk="read"), _capability("web_search", risk="read")])

    assert_model_callable_read_only(registry)  # must not raise


@pytest.mark.unit
@pytest.mark.parametrize("risk", ["write", "exec"])
def test_assert_model_callable_read_only_refuses_a_non_read_capability(risk: str) -> None:
    """A write/exec capability in the model-callable set FAILS CLOSED at wiring time."""
    registry = CapabilityRegistry([_capability("lookup_entity", risk="read"), _capability("send_email", risk=risk)])

    with pytest.raises(NonReadCapabilityError) as excinfo:
        assert_model_callable_read_only(registry)

    assert excinfo.value.capability_id == "send_email"
    assert excinfo.value.risk == risk


@pytest.mark.unit
def test_assert_model_callable_read_only_reports_the_first_offender_in_declaration_order() -> None:
    registry = CapabilityRegistry(
        [
            _capability("lookup_entity", risk="read"),
            _capability("delete_everything", risk="exec"),
            _capability("send_email", risk="write"),
        ]
    )

    with pytest.raises(NonReadCapabilityError) as excinfo:
        assert_model_callable_read_only(registry)

    assert excinfo.value.capability_id == "delete_everything"


@pytest.mark.unit
def test_assert_model_callable_read_only_accepts_an_empty_registry() -> None:
    """A registry with no capabilities is vacuously read-only (every flag off)."""
    assert_model_callable_read_only(CapabilityRegistry([]))  # must not raise
