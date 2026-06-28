"""genui_style_packs.py — Python pack registry mirroring packages/genui/src/theme/packs.ts.

Provides the canonical list of known style-pack identifiers for the Python
generation pipeline. The TypeScript source of truth is STYLE_PACK_IDS in
packages/genui/src/theme/packs.ts; this module maintains parity with it.

Architecture contract:
  Imports ONLY stdlib. No infrastructure imports permitted here.
  This module is imported by cache_key.py (stdlib-only) and by the FastAPI
  route (presentation layer) for spoofing validation (T-17-04).

Named exports:
  STYLE_PACK_IDS  — immutable tuple of all known style-pack ids (parity with TS)
  DEFAULT_PACK_ID — the default pack id ('nauta-teal', parity with TS)
  is_known_pack_id — predicate for T-17-04 spoofing guard at the API boundary
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Pack registry (mirrors packages/genui/src/theme/packs.ts STYLE_PACK_IDS)
# ---------------------------------------------------------------------------

# Immutable tuple — parity contract with TS ReadonlyArray<StylePackId>.
# MUST be kept in sync with packages/genui/src/theme/packs.ts STYLE_PACK_IDS.
# Count: 6 packs.
STYLE_PACK_IDS: tuple[str, ...] = (
    "nauta-teal",
    "linear-clean",
    "warm-editorial",
    "brutalist",
    "corporate-saas",
    "playful-rounded",
)

# Mirrors TS: export const DEFAULT_PACK_ID = "nauta-teal"
DEFAULT_PACK_ID: str = "nauta-teal"

# Fast O(1) membership test — frozen at module load, never mutated.
_KNOWN_PACK_IDS: frozenset[str] = frozenset(STYLE_PACK_IDS)


def is_known_pack_id(pack_id: str) -> bool:
    """Return True if pack_id is a known, validated style-pack identifier.

    Used as the T-17-04 spoofing guard at the FastAPI route boundary:
    unknown / partial / empty pack IDs are rejected with HTTP 422 before
    they can reach the generation pipeline or pollute the cache namespace.

    Args:
        pack_id: The style-pack identifier string to validate.

    Returns:
        True for exact members of STYLE_PACK_IDS; False otherwise.
        Partial matches (e.g. 'nauta') return False — only exact matches.

    Examples:
        is_known_pack_id("nauta-teal")  -> True
        is_known_pack_id("nauta")       -> False  (partial match rejected)
        is_known_pack_id("")            -> False  (empty string rejected)
        is_known_pack_id("unknown")     -> False  (unknown id rejected)
    """
    return pack_id in _KNOWN_PACK_IDS


__all__ = ["DEFAULT_PACK_ID", "STYLE_PACK_IDS", "is_known_pack_id"]
