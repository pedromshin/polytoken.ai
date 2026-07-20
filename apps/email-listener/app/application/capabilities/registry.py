"""The Python capability registry -- the D2 spine's chat-loop consumer (Phase 68 / REG-02, INV-1).

## Why this module exists

The chat tool loop (`RunChatTurn`, Phase 34+) used to read its tools from TWO
hand-maintained parallel dicts in `container.py`: a `tool_executors`
(name -> executor) map and a `server_tool_defs` (name -> Anthropic/Bedrock tool
schema) map, whose keys had to be kept IDENTICAL by hand. That duplication WAS
an unnamed registry -- two sources of truth for one fact ("which tools exist").

This module names it. One `Capability` declared once (its id, metadata, executor
half AND its tool-definition half), read by both consumers:
  - the LLM  -> via `registry.tool_defs()` (the `describe` + `input_schema`)
  - the loop -> via `registry.executors()` (the `execute` half)

It deliberately mirrors the shared TS package (`packages/capabilities`,
`capability.ts`, INV-1/INV-2): the SAME frozen metadata field names
(`id`/`describe`/`risk`/`cost`/`source`/`trust`) so the two registries are the
same abstraction in two languages, and a `define_capability()` ergonomic
constructor mirroring TS `defineCapability`. The Python-only half is the
execution/definition pair this consumer needs: the `ToolExecutor` port instance
plus the Bedrock/Anthropic `tool_def` dict.

## Layering (INV-2, import-linter "Application does not import infrastructure")

This lives in the APPLICATION layer. It imports only the domain `ToolExecutor`
port -- never `app.infrastructure`. The concrete executors and their
`build_*_tool()` schema dicts are wired into `Capability` objects by the
composition root (`container.py`, which is exempt from the layering contract),
exactly as the TS registry's descriptors are assembled at the composition edge.

## INV-4: risk is DATA, not code

`risk` is a FIELD (`"read"`/`"write"`/`"exec"`, mirroring the daemon-protocol
`Risk` enum re-exported by the TS package). No capability implements its own
confirm flow; the ONE permission model reads this field. All four chat tools
declared today are `"read"`.

## Fails closed (REG-04 / INV-5)

`get(id)` on an UNREGISTERED id raises `UnknownCapabilityError` -- it never
returns `None` and never silently no-ops. Duplicate ids raise
`DuplicateCapabilityError` at construction: two capabilities with one id make
resolution ambiguous, and the daemon allowlist keys on that id, so ambiguity
here is a permission bug waiting to happen (mirrors the TS `createCapabilityRegistry`).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from app.domain.ports.tool_executor import ToolExecutor

# The frozen metadata vocabulary -- mirrors packages/capabilities/src/capability.ts
# (CapabilityCost/Source/Trust) and daemon-protocol's Risk enum 1:1 so the Python
# and TS registries stay the same abstraction.
Risk = Literal["read", "write", "exec"]
CapabilityCost = Literal["free", "cheap", "moderate", "expensive"]
CapabilitySource = Literal["builtin", "external"]
CapabilityTrust = Literal["first-party", "verified", "claimed", "unvetted"]


class DuplicateCapabilityError(ValueError):
    """Two capabilities registered under one id -- resolution would be ambiguous."""

    def __init__(self, capability_id: str) -> None:
        super().__init__(f"[capabilities] duplicate capability id {capability_id!r}")
        self.capability_id = capability_id


class UnknownCapabilityError(KeyError):
    """Resolving an id that was never registered -- the fails-closed guard (INV-5).

    Subclasses `KeyError` so a `registry.get(x)` swap-in for the old
    `tool_executors[x]` dict access keeps the SAME never-silently-no-op
    failure shape the loop already relied on.
    """

    def __init__(self, capability_id: str) -> None:
        super().__init__(f"[capabilities] unknown capability id {capability_id!r}")
        self.capability_id = capability_id


@dataclass(frozen=True)
class CapabilityManifestEntry:
    """The describable projection -- the registry "pointed outward" (INV-1).

    Mirrors the TS `CapabilityManifestEntry`: everything the LLM / a future
    genui block catalogue needs to reason about a capability, with NO executable
    coupling. Nothing here can run.
    """

    id: str
    describe: str
    risk: Risk
    cost: CapabilityCost
    source: CapabilitySource
    trust: CapabilityTrust


@dataclass(frozen=True)
class Capability:
    """One executable capability: the universal metadata (frozen field names shared
    with the TS `Capability`) plus this consumer's execution/definition halves.

    - `id`        -- the stable resolution key (== `tool_def["name"]`; also the
                     daemon allowlist key, INV-2).
    - `describe`  -- what the LLM reads to decide whether to call it.
    - `risk`      -- INV-4: drives the ONE permission model's prompt. Data, not code.
    - `cost`      -- INV-1: declared even though nominal today.
    - `source`    -- INV-3: `"builtin"` today; the OSS/skills ontology populates it.
    - `trust`     -- INV-3: `"first-party"` today.
    - `executor`  -- the domain `ToolExecutor` the loop awaits. Python-only half.
    - `tool_def`  -- the Anthropic/Bedrock server tool schema dict the LLM sees.
                     Python-only half.
    """

    id: str
    describe: str
    risk: Risk
    cost: CapabilityCost
    source: CapabilitySource
    trust: CapabilityTrust
    executor: ToolExecutor
    tool_def: dict[str, Any]


def define_capability(
    *,
    executor: ToolExecutor,
    tool_def: dict[str, Any],
    risk: Risk,
    cost: CapabilityCost,
    id: str | None = None,  # noqa: A002 — `id` is the frozen cross-language registry field name (INV-1)
    describe: str | None = None,
    source: CapabilitySource = "builtin",
    trust: CapabilityTrust = "first-party",
) -> Capability:
    """Ergonomic, single-declaration constructor -- mirrors TS `defineCapability`.

    `id` and `describe` default to the tool_def's own `name`/`description` so the
    schema stays the single source of truth for both (no second place to drift).
    The id MUST equal `tool_def["name"]`: the loop offers `tool_def` to the LLM
    keyed by name and resolves the executor by that same name, so a mismatch would
    silently unwire the executor from the tool the model can actually call.
    """
    resolved_id = id if id is not None else tool_def["name"]
    resolved_describe = describe if describe is not None else tool_def["description"]
    if tool_def["name"] != resolved_id:
        raise ValueError(
            f"[capabilities] capability id {resolved_id!r} != tool_def name {tool_def['name']!r}"
        )
    return Capability(
        id=resolved_id,
        describe=resolved_describe,
        risk=risk,
        cost=cost,
        source=source,
        trust=trust,
        executor=executor,
        tool_def=tool_def,
    )


class CapabilityRegistry:
    """An immutable id -> capability map built from a list of capabilities.

    Resolution is a lookup, never a `switch`/`if` chain (INV-2). Duplicate ids
    raise at construction. `executors()` / `tool_defs()` project the ONE source
    of truth into the two read-only mappings `RunChatTurn` consumes -- replacing
    the two hand-maintained parallel dicts that used to live in `container.py`.
    """

    def __init__(self, capabilities: Iterable[Capability]) -> None:
        by_id: dict[str, Capability] = {}
        for capability in capabilities:
            if capability.id in by_id:
                raise DuplicateCapabilityError(capability.id)
            by_id[capability.id] = capability
        self._by_id: dict[str, Capability] = by_id

    @property
    def ids(self) -> tuple[str, ...]:
        """Registered ids in declaration order."""
        return tuple(self._by_id.keys())

    def get(self, capability_id: str) -> Capability:
        """Resolve a capability by id, or FAIL CLOSED (INV-5).

        Raises `UnknownCapabilityError` for an unregistered id -- it never
        returns `None` and never silently no-ops.
        """
        try:
            return self._by_id[capability_id]
        except KeyError:
            raise UnknownCapabilityError(capability_id) from None

    def list(self) -> tuple[CapabilityManifestEntry, ...]:
        """The registry pointed outward -- the describable, non-executable projection."""
        return tuple(
            CapabilityManifestEntry(
                id=c.id,
                describe=c.describe,
                risk=c.risk,
                cost=c.cost,
                source=c.source,
                trust=c.trust,
            )
            for c in self._by_id.values()
        )

    def executors(self) -> Mapping[str, ToolExecutor]:
        """The name -> `ToolExecutor` mapping the loop awaits (replaces `tool_executors`).

        Read-only: a `MappingProxyType`, mirroring the `MappingProxyType` default
        `RunChatTurn.__init__` already uses for this seam. Missing-key access on
        the returned mapping raises `KeyError` -- the loop's existing fails-closed
        `self._tool_executors[tool_name]` behavior is preserved unchanged.
        """
        return MappingProxyType({cap_id: cap.executor for cap_id, cap in self._by_id.items()})

    def tool_defs(self) -> Mapping[str, dict[str, Any]]:
        """The name -> Bedrock/Anthropic tool schema mapping the LLM sees (replaces
        `server_tool_defs`). Read-only, keyed IDENTICALLY to `executors()` by
        construction -- the two can no longer drift."""
        return MappingProxyType({cap_id: cap.tool_def for cap_id, cap in self._by_id.items()})


__all__ = [
    "Capability",
    "CapabilityCost",
    "CapabilityManifestEntry",
    "CapabilityRegistry",
    "CapabilitySource",
    "CapabilityTrust",
    "DuplicateCapabilityError",
    "Risk",
    "UnknownCapabilityError",
    "define_capability",
]
