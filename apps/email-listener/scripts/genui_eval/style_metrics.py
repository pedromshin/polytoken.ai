"""Pure deterministic style metrics for the GenUI eval harness.

Computes:
  - WCAG-AA contrast ratio (relative luminance formula on HSL triplet strings)
  - Token-driven contrast pair resolution from spec nodes
  - Pairwise distinctiveness score for cross-pack divergence (D-16)
  - Retrieval-overlap ratio for RAG-02 inert-retrieval detection

Purity guarantee (mirrors rubric.py discipline, T-17-30):
  - No network library imports (LLM clients, database drivers, cloud SDKs)
  - No eval/exec/compile (D-24)
  - All computations are deterministic pure functions
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WCAG-AA contrast ratio
# ---------------------------------------------------------------------------

# WCAG 2.1 contrast thresholds
_WCAG_AA_NORMAL: float = 4.5
_WCAG_AA_LARGE: float = 3.0


def _parse_hsl(hsl: str) -> tuple[float, float, float]:
    """Parse an HSL triplet string "H S% L%" into (h, s, l) floats.

    Accepts "H S% L%" or "H S L" (percent signs optional).
    Returns (hue, saturation 0-1, lightness 0-1).
    """
    parts = hsl.strip().split()
    if len(parts) != 3:
        raise ValueError(f"Expected 3 parts in HSL string, got: {hsl!r}")
    h = float(parts[0])
    s = float(parts[1].rstrip("%")) / 100.0
    lum = float(parts[2].rstrip("%")) / 100.0
    return h, s, lum


def _hsl_to_rgb(h: float, s: float, lum: float) -> tuple[float, float, float]:
    """Convert HSL (h: 0-360, s: 0-1, lum: 0-1) to linear RGB (0-1 each).

    Uses the standard CSS Color Level 4 algorithm.
    """
    if s == 0.0:
        return lum, lum, lum

    def _hue_to_rgb(p: float, q: float, t: float) -> float:
        t = t % 1.0
        if t < 1.0 / 6.0:
            return p + (q - p) * 6.0 * t
        if t < 1.0 / 2.0:
            return q
        if t < 2.0 / 3.0:
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0
        return p

    q = lum * (1.0 + s) if lum < 0.5 else lum + s - lum * s
    p = 2.0 * lum - q
    h_norm = h / 360.0
    r = _hue_to_rgb(p, q, h_norm + 1.0 / 3.0)
    g = _hue_to_rgb(p, q, h_norm)
    b = _hue_to_rgb(p, q, h_norm - 1.0 / 3.0)
    return r, g, b


def _linearise(channel: float) -> float:
    """Convert a sRGB gamma-encoded value [0,1] to linear light.

    Threshold 0.04045 is the IEC 61966-2-1:1999 / WCAG 2.x specification value.
    The older 0.03928 figure (IN-01) came from an earlier IEC draft and is
    slightly incorrect; the difference is negligible in practice but we use the
    authoritative value to stay spec-compliant.
    """
    if channel <= 0.04045:
        return channel / 12.92
    return float(((channel + 0.055) / 1.055) ** 2.4)


def _relative_luminance(r: float, g: float, b: float) -> float:
    """Compute WCAG relative luminance from linear sRGB values."""
    r_lin = _linearise(r)
    g_lin = _linearise(g)
    b_lin = _linearise(b)
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin


def wcag_contrast_ratio(fg_hsl: str, bg_hsl: str) -> float:
    """Compute the WCAG 2.1 contrast ratio between two HSL triplet strings.

    Args:
        fg_hsl: Foreground colour as "H S% L%" (e.g. "0 0% 3.9%")
        bg_hsl: Background colour as "H S% L%" (e.g. "0 0% 100%")

    Returns:
        Contrast ratio in [1.0, 21.0]. The ratio is symmetric:
        wcag_contrast_ratio(a, b) == wcag_contrast_ratio(b, a).

    Raises:
        ValueError: If either HSL string cannot be parsed.
    """
    h_fg, s_fg, lum_fg_in = _parse_hsl(fg_hsl)
    h_bg, s_bg, lum_bg_in = _parse_hsl(bg_hsl)

    r_fg, g_fg, b_fg = _hsl_to_rgb(h_fg, s_fg, lum_fg_in)
    r_bg, g_bg, b_bg = _hsl_to_rgb(h_bg, s_bg, lum_bg_in)

    lum_fg = _relative_luminance(r_fg, g_fg, b_fg)
    lum_bg = _relative_luminance(r_bg, g_bg, b_bg)

    lighter = max(lum_fg, lum_bg)
    darker = min(lum_fg, lum_bg)
    return (lighter + 0.05) / (darker + 0.05)


def passes_aa(fg_hsl: str, bg_hsl: str, *, large: bool = False) -> bool:
    """Return True when the fg/bg pair meets WCAG AA contrast.

    Args:
        fg_hsl: Foreground HSL triplet string.
        bg_hsl: Background HSL triplet string.
        large: If True, use the 3.0:1 large-text threshold. Default is 4.5:1.

    Returns:
        True if the pair meets the applicable AA threshold.
    """
    threshold = _WCAG_AA_LARGE if large else _WCAG_AA_NORMAL
    return wcag_contrast_ratio(fg_hsl, bg_hsl) >= threshold


# ---------------------------------------------------------------------------
# Contrast pair resolution from spec nodes (T-17-30)
# ---------------------------------------------------------------------------

# Style property names that represent text/foreground colour
_FG_STYLE_KEYS: frozenset[str] = frozenset({"color", "textColor", "foregroundColor"})

# Style property names that represent surface/background colour
_BG_STYLE_KEYS: frozenset[str] = frozenset({"backgroundColor", "background"})


def _resolve_token(value: str, pack_token_values: dict[str, str]) -> str | None:
    """Resolve a token alias (e.g. 'color.primary') to its HSL value.

    Returns the HSL string if found, else None (non-token or unknown alias).
    """
    return pack_token_values.get(value)


def _collect_nodes_with_styles(node: Any) -> list[dict[str, Any]]:
    """Return a flat list of all spec nodes that have a 'style' dict."""
    if not isinstance(node, dict):
        return []
    results: list[dict[str, Any]] = []
    if isinstance(node.get("style"), dict):
        results.append(node)
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            results.extend(_collect_nodes_with_styles(child))
    return results


def _extract_fg_bg_from_node(
    node: dict[str, Any],
    pack_token_values: dict[str, str],
    inherited_bg: str | None,
) -> tuple[str | None, str | None]:
    """Extract resolved foreground and background HSL values from a node's style dict."""
    style: dict[str, Any] = node.get("style", {})
    fg: str | None = None
    bg: str | None = None

    for key in _FG_STYLE_KEYS:
        raw = style.get(key)
        if raw is not None:
            resolved = _resolve_token(str(raw), pack_token_values)
            if resolved is not None:
                fg = resolved
                break

    for key in _BG_STYLE_KEYS:
        raw = style.get(key)
        if raw is not None:
            resolved = _resolve_token(str(raw), pack_token_values)
            if resolved is not None:
                bg = resolved
                break

    # Use inherited background when this node doesn't declare its own
    if bg is None:
        bg = inherited_bg

    return fg, bg


def _walk_spec_for_contrast_pairs(
    node: Any,
    pack_token_values: dict[str, str],
    inherited_bg: str | None,
    acc: list[tuple[str, str]],
) -> None:
    """Recursively walk spec nodes and accumulate (fg_hsl, bg_hsl) contrast pairs."""
    if not isinstance(node, dict):
        return

    fg, bg = _extract_fg_bg_from_node(node, pack_token_values, inherited_bg)

    # Only record if we have BOTH a resolved foreground AND background
    if fg is not None and bg is not None:
        acc.append((fg, bg))

    # Pass the current node's bg downward as the inherited context for children
    next_inherited_bg = bg if bg is not None else inherited_bg

    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            _walk_spec_for_contrast_pairs(child, pack_token_values, next_inherited_bg, acc)


def resolve_node_contrast_pairs(
    spec: dict[str, Any],
    pack_token_values: dict[str, str],
) -> list[tuple[str, str]]:
    """Walk all spec nodes and return (fg_hsl, bg_hsl) pairs from token-driven styles.

    Only pairs where BOTH fg and bg resolve to known token values are returned.
    The background is inherited from ancestor nodes when not explicitly declared.

    Args:
        spec: The GenUI spec dict.
        pack_token_values: Mapping of token alias -> HSL triplet string.

    Returns:
        List of (fg_hsl, bg_hsl) pairs suitable for WCAG contrast checking.
    """
    pairs: list[tuple[str, str]] = []
    root = spec.get("root")
    if root is None:
        return pairs
    _walk_spec_for_contrast_pairs(root, pack_token_values, None, pairs)
    return pairs


# ---------------------------------------------------------------------------
# Distinctiveness score (D-16 pairwise divergence)
# ---------------------------------------------------------------------------

# Token aliases from the DTCG spec (21 aliases)
_TOKEN_ALIASES: frozenset[str] = frozenset(
    {
        "color.background",
        "color.foreground",
        "color.card",
        "color.cardForeground",
        "color.popover",
        "color.popoverForeground",
        "color.primary",
        "color.primaryForeground",
        "color.secondary",
        "color.secondaryForeground",
        "color.muted",
        "color.mutedForeground",
        "color.accent",
        "color.accentForeground",
        "color.destructive",
        "color.destructiveForeground",
        "color.border",
        "color.input",
        "color.ring",
        "radius.base",
        "typography.body.family",
    }
)


def _collect_token_aliases(node: Any) -> list[str]:
    """Recursively collect all token alias strings referenced in style props."""
    if not isinstance(node, dict):
        return []
    aliases: list[str] = []
    style = node.get("style")
    if isinstance(style, dict):
        for value in style.values():
            if isinstance(value, str) and value in _TOKEN_ALIASES:
                aliases.append(value)
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            aliases.extend(_collect_token_aliases(child))
    return aliases


def _collect_node_types(node: Any) -> list[str]:
    """Recursively collect all node types from a spec tree."""
    if not isinstance(node, dict):
        return []
    types: list[str] = []
    node_type = node.get("type")
    if isinstance(node_type, str):
        types.append(node_type)
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            types.extend(_collect_node_types(child))
    return types


def _jaccard_distance(a: Counter[str], b: Counter[str]) -> float:
    """Compute Jaccard distance between two multisets (frequency counters).

    Returns 0.0 for identical multisets, 1.0 for completely disjoint ones.
    """
    all_keys: set[str] = set(a) | set(b)
    if not all_keys:
        return 0.0

    intersection_sum = sum(min(a[k], b[k]) for k in all_keys)
    union_sum = sum(max(a[k], b[k]) for k in all_keys)
    if union_sum == 0:
        return 0.0
    return 1.0 - (intersection_sum / union_sum)


def distinctiveness_score(spec_a: dict[str, Any], spec_b: dict[str, Any]) -> float:
    """Compute a pairwise distinctiveness score in [0, 1] between two specs.

    Higher values indicate greater divergence in emitted token aliases and
    node-type structure. ~0 for identical specs, closer to 1 for specs
    generated by very different style packs or intent strategies.

    Formula: average of Jaccard distance on token-alias multiset and
    node-type multiset (D-16 deterministic pairwise).

    Args:
        spec_a: First GenUI spec dict.
        spec_b: Second GenUI spec dict.

    Returns:
        Float in [0.0, 1.0].
    """
    root_a = spec_a.get("root", {})
    root_b = spec_b.get("root", {})

    aliases_a = Counter(_collect_token_aliases(root_a))
    aliases_b = Counter(_collect_token_aliases(root_b))

    types_a = Counter(_collect_node_types(root_a))
    types_b = Counter(_collect_node_types(root_b))

    token_dist = _jaccard_distance(aliases_a, aliases_b)
    type_dist = _jaccard_distance(types_a, types_b)

    score = (token_dist + type_dist) / 2.0
    # Clamp to [0, 1] as a defence-in-depth measure
    return max(0.0, min(1.0, score))


# ---------------------------------------------------------------------------
# Retrieval overlap ratio (RAG-02, D-14)
# ---------------------------------------------------------------------------

# Documented floor: 25% of retrieved component ids must be referenced in the spec
RETRIEVAL_OVERLAP_FLOOR: float = 0.25


def retrieval_overlap_ratio(
    spec: dict[str, Any],
    retrieved_ids: tuple[str, ...] | list[str],
) -> float:
    """Compute fraction of retrieved component ids referenced in the emitted spec.

    A retrieved component id is considered "referenced" when the id (or a
    significant substring matching a node type) appears in the spec node tree.

    Implementation: for each retrieved id, check if the id contains a substring
    that matches a node type present in the spec. This is a permissive heuristic
    that does not require exact id->type mapping in the eval harness.

    Args:
        spec: The generated GenUI spec dict.
        retrieved_ids: Sequence of component catalog IDs from the RAG retriever.

    Returns:
        Float in [0.0, 1.0]. 0.0 if retrieved_ids is empty.
    """
    if not retrieved_ids:
        return 0.0

    root = spec.get("root")
    if root is None:
        return 0.0

    # Collect all node types present in the spec
    node_types: frozenset[str] = frozenset(
        t.lower() for t in _collect_node_types(root)
    )

    referenced = 0
    for rid in retrieved_ids:
        rid_lower = rid.lower()
        # Check if any node type is a substring of the retrieved id
        # e.g. "table-component" matches node type "table"
        if any(node_type in rid_lower for node_type in node_types if len(node_type) >= 3):
            referenced += 1

    return referenced / len(retrieved_ids)


def assert_retrieval_influence(
    *,
    ratio: float,
    floor: float = RETRIEVAL_OVERLAP_FLOOR,
    prompt_id: str = "",
) -> bool:
    """Assert that retrieval overlap is above the documented floor.

    Does NOT raise — returns False and logs a warning when below the floor.
    This is advisory only: a low overlap may indicate inert retrieval (RAG-02).

    Args:
        ratio: The retrieval_overlap_ratio value.
        floor: Minimum acceptable ratio (default: RETRIEVAL_OVERLAP_FLOOR = 0.25).
        prompt_id: Optional prompt ID for log context.

    Returns:
        True if ratio >= floor, False if inert retrieval detected.
    """
    if ratio >= floor:
        return True

    logger.warning(
        "genui_eval_inert_retrieval prompt_id=%s ratio=%.2f floor=%.2f — "
        "retrieved components may not be influencing spec generation (RAG-02)",
        prompt_id,
        ratio,
        floor,
    )
    return False
