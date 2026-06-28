"""Pure deterministic rubric for GenUI eval harness.

Criteria (all deterministic — no Bedrock, no Supabase, no boto3):
  - valid-spec  (weight 0.30): schema-valid + non-fallback outcome
  - composed    (weight 0.30): rich composition + no-placeholder phrases absent
  - on-intent   (weight 0.25): LLM-as-judge — NOT evaluated here (caller injects score)
  - a11y        (weight 0.15): required props present on interactive nodes

Rubric purity guarantee (D-11, grep-enforced):
  - No import from anthropic, supabase, boto3, or any network library
  - No eval/exec/compile (D-24)

Weights: valid-spec 0.30, composed 0.30, on-intent 0.25, a11y 0.15.
aggregate() renormalizes when on-intent is absent from sub_scores.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.infrastructure.llm.genui_spec_utils import (
    count_nodes as _count_nodes,
)
from app.infrastructure.llm.genui_spec_utils import (
    validate_spec as _validate_spec,
)

# ---------------------------------------------------------------------------
# Constants — must match production values exactly (D-11)
# ---------------------------------------------------------------------------

WEIGHTS: dict[str, float] = {
    "valid-spec": 0.30,
    "composed": 0.30,
    "on-intent": 0.25,
    "a11y": 0.15,
}

# No-placeholder phrases from _SYSTEM_PROMPT_TEXT (exact strings the generator
# is instructed to NEVER emit; if they appear, the spec is a placeholder).
NO_PLACEHOLDER_PHRASES: frozenset[str] = frozenset(
    {
        "this is a placeholder",
        "consider breaking this into components",
        "to build this, design each component separately",
    }
)

# Composition thresholds (from plan spec, mirrors the prompt language)
COMPOSE_MIN_NODES: int = 6
COMPOSE_MIN_TYPES: int = 3
COMPOSE_MIN_DEPTH: int = 2
COMPOSE_MIN_LAYOUT_CHILDREN: int = 1

# Layout container types that must have real children to qualify
_LAYOUT_CONTAINERS: frozenset[str] = frozenset({"stack", "grid", "card"})

# A11y prop map: node type -> required prop name
_A11Y_REQUIRED_PROPS: dict[str, str] = {
    "button": "aria-label",
    "alert": "title",
    "table": "caption",
    "key-value-list": "label",
    "separator": "aria-hidden",
}


# ---------------------------------------------------------------------------
# CriterionResult — immutable result for a single criterion
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CriterionResult:
    """Immutable result for one rubric criterion."""

    name: str
    score: float
    passed: bool


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _collect_all_nodes(node: Any) -> list[dict[str, Any]]:
    """Return a flat list of all spec nodes (depth-first)."""
    if not isinstance(node, dict):
        return []
    result: list[dict[str, Any]] = [node]
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            result.extend(_collect_all_nodes(child))
    # Some node types embed nested dicts in non-children keys
    for key, value in node.items():
        if key != "children" and isinstance(value, dict):
            result.extend(_collect_all_nodes(value))
    return result


def _spec_text_values(node: Any) -> list[str]:
    """Recursively collect all string values from a spec node tree."""
    if isinstance(node, str):
        return [node.lower()]
    if isinstance(node, dict):
        parts: list[str] = []
        for value in node.values():
            parts.extend(_spec_text_values(value))
        return parts
    if isinstance(node, list):
        parts = []
        for item in node:
            parts.extend(_spec_text_values(item))
        return parts
    return []


def _has_placeholder_text(spec: dict[str, Any]) -> bool:
    """Return True if any text value in the spec matches a no-placeholder phrase."""
    all_text = _spec_text_values(spec)
    for phrase in NO_PLACEHOLDER_PHRASES:
        phrase_lower = phrase.lower()
        for text in all_text:
            if phrase_lower in text:
                return True
    return False


def _count_layout_containers_with_children(nodes: list[dict[str, Any]]) -> int:
    """Count layout container nodes that have at least one child."""
    count = 0
    for node in nodes:
        if node.get("type") in _LAYOUT_CONTAINERS:
            children = node.get("children")
            if isinstance(children, list) and len(children) >= 1:
                count += 1
    return count


# ---------------------------------------------------------------------------
# Public criteria functions
# ---------------------------------------------------------------------------


def valid_spec(
    spec: dict[str, Any],
    outcome: Literal["ok", "fallback", "escalated"],
) -> CriterionResult:
    """Check schema validity and that the generation did not fall back.

    Scoring:
    - outcome in ('fallback', 'escalated') -> score=0.0 (generation failed)
    - schema validation error -> score=0.0
    - otherwise -> score=1.0
    """
    if outcome in ("fallback", "escalated"):
        return CriterionResult(name="valid-spec", score=0.0, passed=False)

    error = _validate_spec(spec)
    if error is not None:
        return CriterionResult(name="valid-spec", score=0.0, passed=False)

    return CriterionResult(name="valid-spec", score=1.0, passed=True)


def composed_not_placeholder(spec: dict[str, Any]) -> CriterionResult:
    """Check that the spec is richly composed and contains no placeholder text.

    Scoring: 0.0 if any no-placeholder phrase found OR composition thresholds
    not met; 1.0 otherwise.

    Composition thresholds (must pass ALL):
    - total nodes >= COMPOSE_MIN_NODES (6)
    - distinct node types >= COMPOSE_MIN_TYPES (3)
    - spec depth >= COMPOSE_MIN_DEPTH (2)
    - at least COMPOSE_MIN_LAYOUT_CHILDREN (1) layout container with real children
    """
    root = spec.get("root")
    if root is None:
        return CriterionResult(name="composed", score=0.0, passed=False)

    # Placeholder check (immediate 0.0)
    if _has_placeholder_text(spec):
        return CriterionResult(name="composed", score=0.0, passed=False)

    all_nodes = _collect_all_nodes(root)
    node_count = len(all_nodes)
    distinct_types = len({n.get("type") for n in all_nodes if isinstance(n.get("type"), str)})
    _, depth = _count_nodes(root)
    layout_with_children = _count_layout_containers_with_children(all_nodes)

    if (
        node_count < COMPOSE_MIN_NODES
        or distinct_types < COMPOSE_MIN_TYPES
        or depth < COMPOSE_MIN_DEPTH
        or layout_with_children < COMPOSE_MIN_LAYOUT_CHILDREN
    ):
        return CriterionResult(name="composed", score=0.0, passed=False)

    return CriterionResult(name="composed", score=1.0, passed=True)


def a11y(
    spec: dict[str, Any],
    pack_token_values: dict[str, str] | None = None,
) -> CriterionResult:
    """Check that interactive/structural nodes carry required accessibility props.

    A11y prop map:
      button        -> aria-label
      alert         -> title
      table         -> caption
      key-value-list -> label
      separator     -> aria-hidden

    When pack_token_values is provided, also checks WCAG-AA contrast for all
    resolved token-driven text/surface pairs in the spec (D-09 HARD no-regression).
    Any contrast failure causes score=0.0 / passed=False regardless of required-props.

    Scoring: proportion of nodes that satisfy their a11y requirement.
    If no a11y-relevant nodes exist, score=1.0 (nothing to check).
    Contrast failure always returns score=0.0 (HARD gate, D-09).

    Args:
        spec: The GenUI spec dict to evaluate.
        pack_token_values: Optional dict of token alias -> HSL triplet. When
            provided, any contrast-failing pair causes an immediate fail.
            Default None = baseline pack / backward-compatible skip.
    """
    from scripts.genui_eval.style_metrics import (  # noqa: PLC0415
        passes_aa,
        resolve_node_contrast_pairs,
    )

    root = spec.get("root")
    if root is None:
        return CriterionResult(name="a11y", score=1.0, passed=True)

    # D-09 HARD contrast gate — checked before required-props so any contrast
    # failure immediately fails the criterion regardless of prop completeness.
    if pack_token_values is not None:
        pairs = resolve_node_contrast_pairs(spec, pack_token_values)
        for fg_hsl, bg_hsl in pairs:
            if not passes_aa(fg_hsl, bg_hsl):
                return CriterionResult(name="a11y", score=0.0, passed=False)

    all_nodes = _collect_all_nodes(root)
    relevant: list[dict[str, Any]] = [
        n for n in all_nodes if n.get("type") in _A11Y_REQUIRED_PROPS
    ]

    if not relevant:
        return CriterionResult(name="a11y", score=1.0, passed=True)

    passing = sum(
        1
        for node in relevant
        if node.get(_A11Y_REQUIRED_PROPS[node["type"]]) is not None
    )
    score = passing / len(relevant)
    passed = score == 1.0
    return CriterionResult(name="a11y", score=score, passed=passed)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def aggregate(sub_scores: list[CriterionResult]) -> float:
    """Return a weighted mean of sub_scores.

    When on-intent is absent from sub_scores, its weight is excluded and the
    remaining weights are renormalized so they sum to 1.0.

    Args:
        sub_scores: List of CriterionResult instances. May omit 'on-intent'.

    Returns:
        float in [0.0, 1.0].
    """
    present_names = {r.name for r in sub_scores}
    active_weights = {k: v for k, v in WEIGHTS.items() if k in present_names}

    weight_sum = sum(active_weights.values())
    if weight_sum == 0.0:
        return 0.0

    score_map = {r.name: r.score for r in sub_scores}
    weighted_sum = sum(score_map[k] * w for k, w in active_weights.items())
    return weighted_sum / weight_sum
