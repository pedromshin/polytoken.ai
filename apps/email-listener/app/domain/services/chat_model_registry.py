"""Curated multi-provider chat model registry (D-04, D-05, D-06, D-09, FOUND-2).

"Best options only" — this is a curated, maintained list, not an everything-list
of every model a transport happens to expose. Each entry carries enough for the
picker to be honest: transport, execution locus (D-09's sovereign/distributed-
inference seam — 'remote-peer' reserved, unused today), per-Mtok pricing, and
capability flags (D-05: the GenUI tool is only offered to models flagged
reliable for it).

registry_version() mirrors packages/genui/src/registry/registry-version.ts
(REGISTRY_VERSION / computeRegistryHash): a deterministic SHA-256 content hash
over the registry's public surface, so any change to an entry flips the hash
(FOUND-2 — one registry contract, many instances).

Bedrock model ids below intentionally mirror the DEFAULT_BEDROCK_MODEL_ID /
DEFAULT_GENUI_MODEL_ID constants in app/settings.py (not imported — domain
stays free of app.settings per the existing "domain has no external deps"
import-linter contract; keep these two literal ids in sync by hand if the
settings defaults ever move).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Literal

Transport = Literal["bedrock", "openrouter", "browser"]
ExecutionLocus = Literal["server", "browser", "remote-peer"]


@dataclass(frozen=True)
class ChatModelCapabilities:
    """Honest capability flags surfaced by the picker (D-05, D-06).

    max_tool_rounds (Phase 34, LOOP-01): 0 = server tools disabled -- the
    field doubles as the capability gate for the bounded mid-turn tool loop
    (no second boolean). Only the 2 Bedrock Claude entries set this to 4;
    every other entry stays at the default 0 (OpenRouter's adapter drops
    tool blocks regardless -- this field is the honest, enforced gate).
    """

    tools: bool
    genui: bool
    streaming: bool
    context_tokens: int
    max_tool_rounds: int = 0


@dataclass(frozen=True)
class ChatModel:
    """One curated, best-in-class registry entry (D-04, D-05, FOUND-2)."""

    id: str
    display_name: str
    transport: Transport
    execution_locus: ExecutionLocus
    price_in_per_mtok: float
    price_out_per_mtok: float
    capabilities: ChatModelCapabilities
    best_for: str


# ---------------------------------------------------------------------------
# CHAT_MODEL_REGISTRY — curated entries (D-04)
#
# Pricing is per-Mtok (USD), approximate published rates at curation time —
# tune via a future plan if a provider repriced. Browser entries are always
# $0 (D-08 — local inference, no server round-trip, no metering cost).
# ---------------------------------------------------------------------------

CHAT_MODEL_REGISTRY: tuple[ChatModel, ...] = (
    ChatModel(
        id="us.anthropic.claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        transport="bedrock",
        execution_locus="server",
        price_in_per_mtok=3.0,
        price_out_per_mtok=15.0,
        capabilities=ChatModelCapabilities(
            tools=True, genui=True, streaming=True, context_tokens=200_000, max_tool_rounds=4
        ),
        best_for="Best overall quality: complex reasoning, reliable tool-calling and GenUI generation.",
    ),
    ChatModel(
        id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        display_name="Claude Haiku 4.5",
        transport="bedrock",
        execution_locus="server",
        price_in_per_mtok=1.0,
        price_out_per_mtok=5.0,
        capabilities=ChatModelCapabilities(
            tools=True, genui=True, streaming=True, context_tokens=200_000, max_tool_rounds=4
        ),
        best_for="Fast, cheap everyday chat; still reliable at tool-calling and GenUI.",
    ),
    ChatModel(
        id="deepseek/deepseek-chat",
        display_name="DeepSeek V3",
        transport="openrouter",
        execution_locus="server",
        price_in_per_mtok=0.27,
        price_out_per_mtok=1.10,
        capabilities=ChatModelCapabilities(tools=True, genui=False, streaming=True, context_tokens=64_000),
        best_for="Very cheap, strong general reasoning; not yet GenUI-tuned.",
    ),
    ChatModel(
        id="qwen/qwen-2.5-72b-instruct",
        display_name="Qwen 2.5 72B Instruct",
        transport="openrouter",
        execution_locus="server",
        price_in_per_mtok=0.35,
        price_out_per_mtok=0.40,
        capabilities=ChatModelCapabilities(tools=True, genui=False, streaming=True, context_tokens=32_000),
        best_for="Balanced open-weight model; solid multilingual and coding chat.",
    ),
    ChatModel(
        id="z-ai/glm-4.6",
        display_name="GLM 4.6",
        transport="openrouter",
        execution_locus="server",
        price_in_per_mtok=0.45,
        price_out_per_mtok=1.75,
        capabilities=ChatModelCapabilities(tools=True, genui=False, streaming=True, context_tokens=128_000),
        best_for="Strong agentic tool-use at a fraction of frontier pricing.",
    ),
    ChatModel(
        id="google/gemma-2-27b-it",
        display_name="Gemma 2 27B",
        transport="openrouter",
        execution_locus="server",
        price_in_per_mtok=0.27,
        price_out_per_mtok=0.27,
        capabilities=ChatModelCapabilities(tools=False, genui=False, streaming=True, context_tokens=8_192),
        best_for="Cheapest general-purpose chat; no tool-calling support.",
    ),
    ChatModel(
        # 22-11: D-08 named "Qwen3 4B or Gemma 3 4B" as equally acceptable
        # curated options. The vetted @mlc-ai/web-llm 0.2.84 package's
        # prebuiltAppConfig ships no Gemma-3-4B build (only Gemma3-1B) — this
        # entry was repointed from the originally-planned "webllm-gemma-3-4b"
        # to Qwen3-4B, a real, available 4B-class WebLLM prebuilt model, so
        # the picker's advertised model always matches what actually runs
        # (D-05/D-06 honesty contract). See 22-11-SUMMARY.md deviations.
        id="webllm-qwen3-4b",
        display_name="Qwen3 4B (in-browser)",
        transport="browser",
        execution_locus="browser",
        price_in_per_mtok=0.0,
        price_out_per_mtok=0.0,
        capabilities=ChatModelCapabilities(tools=False, genui=False, streaming=True, context_tokens=8_192),
        best_for="Runs entirely on-device via WebGPU: private, free, no server round-trip.",
    ),
)


def chat_registry_version() -> str:
    """Deterministic SHA-256 content hash over the registry (mirrors registry-version.ts, FOUND-2).

    Entries are sorted by id before serializing so their order in the source
    tuple never flips the hash — only a real content change does.
    """
    canonical = [asdict(model) for model in sorted(CHAT_MODEL_REGISTRY, key=lambda model: model.id)]
    serialized = json.dumps(canonical, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def get_model(model_id: str) -> ChatModel | None:
    """Return the registry entry for model_id, or None if it is not curated."""
    for model in CHAT_MODEL_REGISTRY:
        if model.id == model_id:
            return model
    return None


def genui_capable_ids() -> tuple[str, ...]:
    """IDs of models flagged reliable for the emit_ui_spec tool (D-05)."""
    return tuple(model.id for model in CHAT_MODEL_REGISTRY if model.capabilities.genui)
