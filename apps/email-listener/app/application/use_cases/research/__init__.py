"""The multi-step agentic deep-research use-case (Phase 69 / RSRCH-01, depth).

A self-contained, testable application-layer slice: a bounded multi-round loop
(plan -> search rounds -> fetch/read -> adversarial verify -> synthesize) that
emits a structured `ResearchReport` whose shape the RSRCH-05 rubric
(`scripts/research_eval/rubric.py`) can score verbatim, closing the loop where
the eval measures the real loop.

Pure orchestration over injected ports (`ChatProvider`, `ToolExecutor`) — no
`app.infrastructure` import (INV-2 / import-linter "Application does not import
infrastructure"). The composition root wires the concrete Bedrock provider and
the `web_search` executor in; `define_research_capability` hands the whole
use-case to the capability registry as one `Capability` (do NOT edit
`container.py` — call the helper from it).
"""

from __future__ import annotations

from app.application.use_cases.research.deep_research import (
    DEEP_RESEARCH_TOOL_NAME,
    Claim,
    DeepResearch,
    DeepResearchToolExecutor,
    EmitEvent,
    ResearchBudget,
    ResearchProviderError,
    ResearchReport,
    Source,
    VerifyVerdict,
    build_deep_research_tool,
    define_research_capability,
)

__all__ = [
    "DEEP_RESEARCH_TOOL_NAME",
    "Claim",
    "DeepResearch",
    "DeepResearchToolExecutor",
    "EmitEvent",
    "ResearchBudget",
    "ResearchProviderError",
    "ResearchReport",
    "Source",
    "VerifyVerdict",
    "build_deep_research_tool",
    "define_research_capability",
]
