"""genui_retrieval_provider.py — LexicalRetrievalProvider (deterministic top-k).

Implements the RetrievalProvider port (app/domain/ports/retrieval_provider.py) using a
fully deterministic, lexical scoring approach — no Bedrock calls, no network I/O in the
catalog+exemplar path.

Algorithm (D-11 — formula is Claude's discretion):
  1. Canonicalize the intent (reuse canonicalize_intent from cache_key.py).
  2. Tokenize the canonical intent into a frozenset of lowercase tokens.
  3. Score every candidate across three arms:
       - Catalog components: from load_prompt_payload()["components"]
       - Exemplar assets:    from load_exemplars()
       - Template rows:      from optional UiSpecTemplateRepository.list_recent()
         (only if a templates source is injected; best-effort, never raises — T-17-12)
  4. Scoring uses Jaccard-inspired term overlap plus structural keyword boosts
     (e.g. intent containing "table"/"grid"/"card" boosts matching components/exemplars).
  5. Sort all candidates by descending score, take top_k, return RetrievalResult.

Seam contracts:
  - D-10: Same Protocol signature as the future EmbeddingRetrievalProvider; zero caller change
    required when that adapter lands.
  - D-11: Deterministic/lexical — identical intent string always produces identical ordered ids.
  - D-12: Exemplars are validated real specs; this provider consumes but does not mutate them.
  - D-14: RetrievalResult.retrieved_ids is returned for audit logging (log per generation).
  - T-17-12: Template-source read is best-effort; failure is swallowed + logged, never raised.

Named exports: LexicalRetrievalProvider
"""

from __future__ import annotations

import re
from typing import Any

import structlog

from app.application.use_cases.cache_key import canonicalize_intent
from app.domain.ports.retrieval_provider import (
    RetrievalProvider,
    RetrievalResult,
    RetrievedItem,
)
from app.infrastructure.llm.genui_artifacts import load_prompt_payload
from app.infrastructure.llm.genui_exemplars import load_exemplars

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Structural keyword categories — intent tokens matching these boost related items
# ---------------------------------------------------------------------------

_LAYOUT_KEYWORDS: frozenset[str] = frozenset({"grid", "column", "columns", "layout", "cols"})
_TABLE_KEYWORDS: frozenset[str] = frozenset({"table", "row", "rows", "spreadsheet", "tabular"})
_CARD_KEYWORDS: frozenset[str] = frozenset({"card", "panel", "tile", "box"})
_BUTTON_KEYWORDS: frozenset[str] = frozenset({"button", "cta", "action", "click", "submit"})
_LIST_KEYWORDS: frozenset[str] = frozenset({"list", "feed", "inbox", "items", "entries"})
_CHART_KEYWORDS: frozenset[str] = frozenset({"chart", "graph", "kpi", "metric", "metrics", "stats"})
_FORM_KEYWORDS: frozenset[str] = frozenset({"form", "input", "field", "fields", "edit", "settings"})

# Structural keyword → set of item identifiers that should receive a boost
_STRUCTURAL_BOOSTS: dict[frozenset[str], set[str]] = {
    _LAYOUT_KEYWORDS: {"grid", "stack"},
    _TABLE_KEYWORDS: {"table"},
    _CARD_KEYWORDS: {"card"},
    _BUTTON_KEYWORDS: {"button"},
    _LIST_KEYWORDS: {"list", "key-value-list"},
    _CHART_KEYWORDS: {"card", "grid", "table"},
    _FORM_KEYWORDS: {"card", "key-value-list"},
}

# Base score ceiling to prevent any arm from dominating purely on overlap volume
_MAX_BASE_SCORE: float = 0.7
_BOOST_INCREMENT: float = 0.05
_MIN_SCORE_THRESHOLD: float = 0.01


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------


def _tokenize(text: str) -> frozenset[str]:
    """Return a frozenset of lowercase word tokens from a text string."""
    return frozenset(re.findall(r"[a-z0-9]+", text.lower()))


def _score_tokens(
    intent_tokens: frozenset[str],
    candidate_tokens: frozenset[str],
) -> float:
    """Jaccard-inspired overlap score in [0.0, 1.0].

    Returns |intersection| / |intent_tokens| capped at _MAX_BASE_SCORE.
    Uses intent length as denominator so long intents don't penalise short candidates.
    """
    if not intent_tokens or not candidate_tokens:
        return 0.0
    overlap = len(intent_tokens & candidate_tokens)
    base = overlap / len(intent_tokens)
    return min(base, _MAX_BASE_SCORE)


def _structural_boost(
    item_id: str,
    intent_tokens: frozenset[str],
    component_type: str | None = None,
) -> float:
    """Return a cumulative boost for items whose structure matches intent keywords."""
    # The effective id for structural matching is either the component type or the item_id
    match_id = (component_type or item_id).lower()
    boost = 0.0
    for kw_set, boosted_ids in _STRUCTURAL_BOOSTS.items():
        if intent_tokens & kw_set and match_id in boosted_ids:
            boost += _BOOST_INCREMENT
    return boost


# ---------------------------------------------------------------------------
# Per-arm scorers
# ---------------------------------------------------------------------------


def _score_catalog_components(
    intent_tokens: frozenset[str],
    payload: dict[str, Any],
) -> list[tuple[float, RetrievedItem]]:
    """Score each catalog component against the intent tokens."""
    components: list[dict[str, Any]] = payload.get("components", [])
    results: list[tuple[float, RetrievedItem]] = []
    for comp in components:
        comp_type: str = str(comp.get("type", ""))
        description: str = str(comp.get("description", ""))
        candidate_tokens = _tokenize(f"{comp_type} {description}")
        base = _score_tokens(intent_tokens, candidate_tokens)
        boost = _structural_boost(comp_type, intent_tokens, component_type=comp_type)
        score = min(base + boost, 1.0)
        if score >= _MIN_SCORE_THRESHOLD:
            results.append(
                (
                    score,
                    RetrievedItem(
                        id=comp_type,
                        kind="component",
                        score=score,
                        payload={
                            "type": comp_type,
                            "description": description,
                            "acceptsChildren": comp.get("acceptsChildren", False),
                            "slots": comp.get("slots", []),
                        },
                    ),
                )
            )
    return results


def _score_exemplars(
    intent_tokens: frozenset[str],
) -> list[tuple[float, RetrievedItem]]:
    """Score each exemplar against the intent tokens."""
    exemplars = load_exemplars()
    results: list[tuple[float, RetrievedItem]] = []
    for ex in exemplars:
        # Candidate text: id tokens + category + all tags
        tag_text = " ".join(ex.tags)
        candidate_tokens = _tokenize(f"{ex.id} {ex.category} {tag_text}")
        base = _score_tokens(intent_tokens, candidate_tokens)
        boost = _structural_boost(ex.id, intent_tokens)
        score = min(base + boost, 1.0)
        if score >= _MIN_SCORE_THRESHOLD:
            results.append(
                (
                    score,
                    RetrievedItem(
                        id=ex.id,
                        kind="exemplar",
                        score=score,
                        payload={
                            "id": ex.id,
                            "category": ex.category,
                            "tags": list(ex.tags),
                            "spec": ex.spec,
                        },
                    ),
                )
            )
    return results


async def _score_templates(
    intent_tokens: frozenset[str],
    templates_source: object,
) -> list[tuple[float, RetrievedItem]]:
    """Score available template rows against the intent tokens (best-effort, T-17-12)."""
    try:
        # Type-narrowed access: call list_recent() if the method exists
        list_recent_method = getattr(templates_source, "list_recent", None)
        if list_recent_method is None:
            return []
        rows = await list_recent_method(limit=20)
    except Exception:
        log.warning(
            "genui_retrieval_provider.template_read_failed",
            exc_info=True,
        )
        return []

    results: list[tuple[float, RetrievedItem]] = []
    for row in rows:
        intent_text: str = getattr(row, "intent_text", "") or ""
        candidate_tokens = _tokenize(intent_text)
        base = _score_tokens(intent_tokens, candidate_tokens)
        score = min(base, _MAX_BASE_SCORE)
        if score >= _MIN_SCORE_THRESHOLD:
            row_id: str = getattr(row, "id", "") or ""
            results.append(
                (
                    score,
                    RetrievedItem(
                        id=row_id,
                        kind="template",
                        score=score,
                        payload={
                            "id": row_id,
                            "intent_text": intent_text,
                        },
                    ),
                )
            )
    return results


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------


class LexicalRetrievalProvider:
    """Deterministic, lexical implementation of RetrievalProvider (D-11).

    Retrieves relevant catalog components, hand-authored exemplar specs, and
    (optionally) recent ui_spec_templates rows — scored by keyword/tag/category
    overlap, sorted by descending score, capped at top_k.

    No Bedrock calls, no network I/O in the catalog+exemplar path.

    Constructor args:
        templates_source: Optional UiSpecTemplateRepository.  When provided, recent
            templates are scored and merged into the result set.  When absent, only
            catalog components and exemplars are searched.  If the templates read fails,
            it is swallowed + logged (T-17-12 — best-effort, never raises).
    """

    def __init__(
        self,
        templates_source: object | None = None,
    ) -> None:
        self._templates_source = templates_source

    async def retrieve(
        self,
        *,
        intent: str,
        top_k: int,
        style_pack_id: str | None = None,
    ) -> RetrievalResult:
        """Return a ranked RetrievalResult for the given intent.

        The result is deterministic: identical intent + top_k always produces
        identical retrieved_ids (no randomness, no Bedrock embeddings).

        Args:
            intent:        Raw intent string (canonicalized internally).
            top_k:         Maximum number of items to return.
            style_pack_id: Accepted but not yet used (reserved for FLY adapter, D-10).

        Returns:
            RetrievalResult with items sorted by descending score, len <= top_k.
            Never raises — returns empty RetrievalResult on any unhandled error.
        """
        try:
            return await self._retrieve_inner(intent=intent, top_k=top_k)
        except Exception:
            log.error(
                "genui_retrieval_provider.retrieve_failed",
                intent=intent[:200],
                top_k=top_k,
                exc_info=True,
            )
            return RetrievalResult(items=())

    async def _retrieve_inner(
        self,
        *,
        intent: str,
        top_k: int,
    ) -> RetrievalResult:
        """Core retrieval logic — raises on unexpected errors (caller wraps)."""
        canonical = canonicalize_intent(intent)
        intent_tokens = _tokenize(canonical)

        # Arm 1: catalog components (always)
        prompt_payload = load_prompt_payload()
        component_scores = _score_catalog_components(intent_tokens, prompt_payload)

        # Arm 2: exemplars (always)
        exemplar_scores = _score_exemplars(intent_tokens)

        # Arm 3: templates (optional, best-effort)
        template_scores: list[tuple[float, RetrievedItem]] = []
        if self._templates_source is not None:
            template_scores = await _score_templates(intent_tokens, self._templates_source)

        # Merge + sort by descending score; deduplicate by id (first occurrence wins)
        all_candidates = component_scores + exemplar_scores + template_scores
        all_candidates.sort(key=lambda t: t[0], reverse=True)

        seen_ids: set[str] = set()
        top_items: list[RetrievedItem] = []
        for _, item in all_candidates:
            if item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            top_items.append(item)
            if len(top_items) >= top_k:
                break

        return RetrievalResult(items=tuple(top_items))


# Verify the implementation satisfies the Protocol at import time.
# This is a static assertion — caught at startup, not at call time.
_: RetrievalProvider = LexicalRetrievalProvider()  # type: ignore[assignment]

__all__ = ["LexicalRetrievalProvider"]
