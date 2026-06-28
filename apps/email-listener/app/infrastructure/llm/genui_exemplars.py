"""genui_exemplars.py — Loader for hand-authored exemplar SpecRoot assets.

D-12: Exemplars are committed, hand-authored, real SpecRoot compositions — never
AI-fabricated. They serve as quality anchors the generator imitates: if the generator
sees a real, schema-valid dashboard spec, it learns structure, not filler.

Each exemplar is a frozen record with:
  - id:       Stable lowercase-kebab identifier (e.g. "dashboard-saas").
  - category: One of the fixed category set: dashboard / profile / pricing / feed / landing.
  - tags:     Immutable tuple of searchable keyword tags (used by LexicalRetrievalProvider
              for relevance scoring — D-11).
  - spec:     The SpecRoot dict (must pass load_spec_schema() validation — D-12 gate).

Named exports: Exemplar, load_exemplars
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from functools import lru_cache

from app.infrastructure.llm.exemplars import EXEMPLAR_ASSETS

# ---------------------------------------------------------------------------
# DTO
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Exemplar:
    """Frozen record representing a single hand-authored exemplar asset.

    Attributes:
        id:       Stable lowercase-kebab identifier. Unique across the corpus.
        category: Category bucket. One of: dashboard, profile, pricing, feed, landing.
        tags:     Immutable tuple of keyword tags. Used by LexicalRetrievalProvider for
                  relevance scoring. Tags are lowercase, single-word or hyphenated terms
                  that describe the component types and intent keywords in this exemplar.
        spec:     The raw SpecRoot dict. Must be schema-valid (validated in CI via
                  TestExemplarSchemaValidation in test_genui_exemplars.py — D-12).
    """

    id: str
    category: str
    tags: tuple[str, ...]
    spec: dict[str, object]


# ---------------------------------------------------------------------------
# Metadata: per-exemplar id, category, tags
# ---------------------------------------------------------------------------

_EXEMPLAR_META: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    # (id, category, tags)
    (
        "dashboard-saas",
        "dashboard",
        (
            "dashboard",
            "kpi",
            "metrics",
            "sales",
            "grid",
            "card",
            "table",
            "revenue",
            "pipeline",
        ),
    ),
    (
        "profile-contact",
        "profile",
        (
            "profile",
            "contact",
            "detail",
            "key-value-list",
            "badge",
            "button",
            "card",
        ),
    ),
    (
        "pricing-tiers",
        "pricing",
        (
            "pricing",
            "tiers",
            "plans",
            "cta",
            "button",
            "card",
            "grid",
            "key-value-list",
        ),
    ),
    (
        "feed-email-inbox",
        "feed",
        (
            "feed",
            "inbox",
            "list",
            "email",
            "table",
            "badge",
            "pagination",
            "button",
        ),
    ),
    (
        "landing-product",
        "landing",
        (
            "landing",
            "hero",
            "cta",
            "features",
            "button",
            "card",
            "grid",
            "alert",
        ),
    ),
)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_exemplars() -> tuple[Exemplar, ...]:
    """Return all hand-authored exemplar assets as frozen Exemplar records.

    Cached via lru_cache — the corpus is read once and the same tuple is returned
    on every subsequent call.  This makes it safe to call from hot retrieval paths
    without per-request allocation overhead.

    Returns:
        A tuple of frozen Exemplar records.  The order matches the authoring order
        in the exemplars package (dashboard → profile → pricing → feed → landing).
        Callers should NOT assume any particular ordering — use tags/category for
        relevance filtering.

    Raises:
        Nothing — if metadata and asset counts are mismatched at module import time
        an AssertionError is raised at startup (fast-fail for developer errors).
    """
    assert len(_EXEMPLAR_META) == len(EXEMPLAR_ASSETS), (
        f"Metadata length {len(_EXEMPLAR_META)} != asset count {len(EXEMPLAR_ASSETS)}. "
        "Add/remove both _EXEMPLAR_META entry and the corresponding asset in exemplars/__init__.py."
    )

    return tuple(
        Exemplar(
            id=meta_id,
            category=category,
            tags=tags,
            spec=copy.deepcopy(dict(spec_asset)),
        )
        for (meta_id, category, tags), spec_asset in zip(_EXEMPLAR_META, EXEMPLAR_ASSETS, strict=True)
    )


__all__ = ["Exemplar", "load_exemplars"]
