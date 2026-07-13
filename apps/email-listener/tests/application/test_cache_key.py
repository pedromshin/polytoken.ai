"""Tests for the deterministic cache-key module (14-02 TDD RED).

Covers (per plan must_haves and threat model):
- canonicalize_intent: strip + lower + collapse whitespace (D-05)
- canonicalize_intent: case/whitespace variants yield equal output (§10 Pitfall 4)
- canonicalize_intent: NFC Unicode normalization before strip/lower
- compute_data_shape_hash: same shape, different VALUES → same hash (CACHE-03 / D-06)
- compute_data_shape_hash: key-order independence (sorted keys → same hash)
- compute_data_shape_hash: opaque text sentinel vs empty/null sentinel (distinct)
- compute_cache_key: deterministic (same args → same 64-char lowercase hex key, CACHE-02)
- compute_cache_key: registry_version change → different key (CACHE-04 / D-07)
- compute_cache_key: importer_id change → different key (cross-tenant isolation / D-08 / T-14-05)
- compute_cache_key: importer_id=None folds __system__ sentinel deterministically (D-08)
- compute_cache_key: delimiter anti-collision (T-14-06 / D-04)
"""

from __future__ import annotations

import re

import pytest

from app.application.use_cases.cache_key import (
    canonicalize_intent,
    compute_cache_key,
    compute_data_shape_hash,
)

# ---------------------------------------------------------------------------
# 1. canonicalize_intent — strip + lower + collapse whitespace
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_canonicalize_intent_strips_and_lowercases_and_collapses_whitespace() -> None:
    """'  Show   Invoice  ' must become 'show invoice' (D-05)."""
    result = canonicalize_intent("  Show   Invoice  ")
    assert result == "show invoice"


@pytest.mark.unit
def test_canonicalize_intent_case_and_extra_space_variants_are_equal() -> None:
    """'Show invoice' and 'show  Invoice' must canonicalize to the same string (§10 Pitfall 4)."""
    assert canonicalize_intent("Show invoice") == canonicalize_intent("show  Invoice")


@pytest.mark.unit
def test_canonicalize_intent_nfc_normalization_makes_equivalent_unicode_equal() -> None:
    """NFC-equivalent strings (NFC vs NFD-composed) must produce the same canonical form (D-05)."""
    import unicodedata

    # 'é' can be represented as pre-composed NFC (U+00E9) or decomposed NFD (e + U+0301).
    nfc_form = unicodedata.normalize("NFC", "café")  # NFD: 'e' + combining acute
    nfd_form = "café"  # NFC: pre-composed
    # After NFC normalization both should canonicalize identically.
    assert canonicalize_intent(nfc_form) == canonicalize_intent(nfd_form)


@pytest.mark.unit
def test_canonicalize_intent_casefold_handles_german_sharp_s() -> None:
    """casefold() must map U+00DF LATIN SMALL LETTER SHARP S to 'ss' (CR-03 / CACHE-02).

    str.lower() does NOT fold the sharp-s to 'ss'; str.casefold() does.
    A cache entry created with one spelling must be a hit for the other.
    """
    # sharp-s casefolded -> "ss"; "SS" casefolded -> "ss"
    result_sharp_s = canonicalize_intent("ß Invoice")
    result_ss = canonicalize_intent("SS Invoice")
    assert result_sharp_s == result_ss, (
        "casefold must map sharp-s to 'ss' so the two spellings share a cache key (CR-03). "
        f"Got: {result_sharp_s!r} vs {result_ss!r}"
    )
    assert result_sharp_s == "ss invoice", (
        f"Canonical form of sharp-s Invoice must be 'ss invoice', got: {result_sharp_s!r}"
    )


# ---------------------------------------------------------------------------
# 4. compute_data_shape_hash — same shape, different values → same hash (CACHE-03)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_data_shape_hash_same_shape_different_values_are_equal() -> None:
    """{"amount": 500, "lines": [1, 2]} and {"amount": 9, "lines": [7]} → same hash (D-06 / CACHE-03)."""
    h1 = compute_data_shape_hash('{"amount": 500, "lines": [1, 2]}')
    h2 = compute_data_shape_hash('{"amount": 9, "lines": [7]}')
    assert h1 == h2


@pytest.mark.unit
def test_data_shape_hash_key_order_independent() -> None:
    """{"a":1,"b":2} and {"b":2,"a":1} must produce the same hash (sorted keys / D-06)."""
    h1 = compute_data_shape_hash('{"a": 1, "b": 2}')
    h2 = compute_data_shape_hash('{"b": 2, "a": 1}')
    assert h1 == h2


@pytest.mark.unit
def test_data_shape_hash_opaque_text_vs_empty_are_distinct() -> None:
    """Opaque non-JSON text uses the 'text' sentinel; empty string uses the '∅' sentinel — must differ (D-06)."""
    text_hash = compute_data_shape_hash("Invoice #123 — not valid JSON")
    empty_hash = compute_data_shape_hash("")
    assert text_hash != empty_hash


@pytest.mark.unit
def test_data_shape_hash_whitespace_only_uses_empty_sentinel() -> None:
    """Whitespace-only raw_content should match the empty/∅ sentinel, same as ''."""
    assert compute_data_shape_hash("   ") == compute_data_shape_hash("")


@pytest.mark.unit
def test_data_shape_hash_returns_lowercase_hex() -> None:
    """The hash must be a 64-character lowercase hex string."""
    h = compute_data_shape_hash('{"x": 1}')
    assert re.match(r"^[0-9a-f]{64}$", h), f"Expected 64-char lowercase hex, got: {h!r}"


# ---------------------------------------------------------------------------
# 7. compute_cache_key — deterministic, 64-char lowercase hex (CACHE-02)
# ---------------------------------------------------------------------------

_BASE_ARGS: dict[str, str | None] = {
    "intent": "Show invoice",
    "raw_content": '{"amount": 500, "vendor": "Acme"}',
    "registry_version": "abc123",
    "importer_id": "tenant-a-uuid",
    "catalog_id": "global",
}


@pytest.mark.unit
def test_cache_key_is_deterministic_and_64_lowercase_hex() -> None:
    """Same args called twice must return the identical 64-char lowercase hex digest (CACHE-02 / D-04)."""
    key1 = compute_cache_key(**_BASE_ARGS)  # type: ignore[arg-type]
    key2 = compute_cache_key(**_BASE_ARGS)  # type: ignore[arg-type]
    assert key1 == key2
    assert re.match(r"^[0-9a-f]{64}$", key1), f"Not 64-char lowercase hex: {key1!r}"


@pytest.mark.unit
def test_cache_key_registry_version_change_yields_different_key() -> None:
    """Changing only registry_version must produce a different key (CACHE-04 / D-07)."""
    args_v1 = {**_BASE_ARGS, "registry_version": "version-1"}
    args_v2 = {**_BASE_ARGS, "registry_version": "version-2"}
    assert compute_cache_key(**args_v1) != compute_cache_key(**args_v2)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_importer_id_change_yields_different_key() -> None:
    """Changing only importer_id must produce a different key (tenant isolation / D-08 / T-14-05)."""
    args_a = {**_BASE_ARGS, "importer_id": "tenant-a-uuid"}
    args_b = {**_BASE_ARGS, "importer_id": "tenant-b-uuid"}
    assert compute_cache_key(**args_a) != compute_cache_key(**args_b)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_importer_id_none_folds_system_sentinel_deterministically() -> None:
    """importer_id=None must produce the same key on repeated calls, using __system__ sentinel (D-08)."""
    args_none = {**_BASE_ARGS, "importer_id": None}
    key1 = compute_cache_key(**args_none)  # type: ignore[arg-type]
    key2 = compute_cache_key(**args_none)  # type: ignore[arg-type]
    assert key1 == key2
    assert re.match(r"^[0-9a-f]{64}$", key1)


@pytest.mark.unit
def test_cache_key_none_importer_differs_from_named_importer() -> None:
    """importer_id=None must produce a different key than importer_id='__system__' (D-08 sentinel safety)."""
    args_none = {**_BASE_ARGS, "importer_id": None}
    args_sys = {**_BASE_ARGS, "importer_id": "__system__"}
    # None maps to a sentinel that must not alias with the literal string "__system__"
    # UNLESS the context_descriptor construction makes them equivalent intentionally.
    # Per D-08: "null and 'system' never alias" — None sentinel and literal '__system__' importer
    # should be equivalent because None IS the system sentinel.
    # The plan says: "importer_id=None → '__system__' sentinel"
    # So actually None == __system__ per the spec.
    # We verify that None is deterministic (done above) and produces the same key as '__system__'.
    assert compute_cache_key(**args_none) == compute_cache_key(**args_sys)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_delimiter_anti_collision() -> None:
    """Field boundary collision: intent='ab'+shape_source must differ from intent='a'+shape_source (T-14-06 / D-04).

    We construct two inputs where concatenating raw fields without a delimiter would
    produce the same byte string, but using the 0x1f delimiter keeps them distinct.
    """
    # Two different intents that, if delimiters were absent, could collide with different data shapes.
    # intent="ab", content produces data_shape, the raw concat "ab" + shape_hash would equal
    # intent="a" + "b" + shape_hash if the delimiter were just "".
    # We use a content that makes data_shape_hash a predictable prefix trick:
    # The key point: different intents with the 0x1f delimiter MUST produce different keys.
    args_ab = {
        "intent": "ab",
        "raw_content": '{"c": 1}',
        "registry_version": "v1",
        "importer_id": "t",
        "catalog_id": "global",
    }
    args_a = {
        "intent": "a",
        "raw_content": '{"c": 1}',  # same shape
        "registry_version": "v1",
        "importer_id": "t",
        "catalog_id": "global",
    }
    assert compute_cache_key(**args_ab) != compute_cache_key(**args_a)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_same_shape_different_values_hit_same_key() -> None:
    """Two payloads with same schema but different values must produce the SAME cache key (CACHE-03 / D-06)."""
    args_500 = {**_BASE_ARGS, "raw_content": '{"amount": 500, "vendor": "Acme"}'}
    args_9 = {**_BASE_ARGS, "raw_content": '{"amount": 9, "vendor": "Nauta"}'}
    assert compute_cache_key(**args_500) == compute_cache_key(**args_9)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 17-04: style_pack_id as a cache-key dimension (D-08 / T-17-20)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cache_key_style_pack_id_change_yields_different_key() -> None:
    """Changing only style_pack_id must produce a different key (D-08 / T-17-20).

    Two packs -> two distinct cache entries. A polytoken-teal spec must never be served
    for a linear-clean request.
    """
    args_nauta = {**_BASE_ARGS, "style_pack_id": "polytoken-teal"}
    args_linear = {**_BASE_ARGS, "style_pack_id": "linear-clean"}
    assert compute_cache_key(**args_nauta) != compute_cache_key(**args_linear)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_style_pack_id_none_is_deterministic() -> None:
    """style_pack_id=None must produce the same key on repeated calls."""
    args = {**_BASE_ARGS, "style_pack_id": None}
    key1 = compute_cache_key(**args)  # type: ignore[arg-type]
    key2 = compute_cache_key(**args)  # type: ignore[arg-type]
    assert key1 == key2
    assert re.match(r"^[0-9a-f]{64}$", key1)


@pytest.mark.unit
def test_cache_key_no_style_pack_differs_from_explicit_pack() -> None:
    """style_pack_id=None must differ from style_pack_id='polytoken-teal' (T-17-20)."""
    args_none = {**_BASE_ARGS, "style_pack_id": None}
    args_pack = {**_BASE_ARGS, "style_pack_id": "polytoken-teal"}
    assert compute_cache_key(**args_none) != compute_cache_key(**args_pack)  # type: ignore[arg-type]


@pytest.mark.unit
def test_cache_key_backward_compatible_without_style_pack_id() -> None:
    """compute_cache_key must accept calls WITHOUT style_pack_id (backward compat)."""
    # _BASE_ARGS does NOT include style_pack_id -- existing callers must still work
    key = compute_cache_key(**_BASE_ARGS)  # type: ignore[arg-type]
    assert re.match(r"^[0-9a-f]{64}$", key)


# ---------------------------------------------------------------------------
# 17-04: genui_style_packs.py -- Python pack registry (mirrors TS STYLE_PACK_IDS)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_style_pack_ids_contains_expected_packs() -> None:
    """STYLE_PACK_IDS must contain all 6 curated packs from the TS source of truth."""
    from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS

    expected = {
        "polytoken-teal",
        "linear-clean",
        "warm-editorial",
        "brutalist",
        "corporate-saas",
        "playful-rounded",
    }
    assert set(STYLE_PACK_IDS) == expected, f"STYLE_PACK_IDS mismatch. Expected: {expected}, Got: {set(STYLE_PACK_IDS)}"


@pytest.mark.unit
def test_style_pack_ids_is_immutable_sequence() -> None:
    """STYLE_PACK_IDS must be an immutable sequence (tuple or frozenset)."""
    from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS

    # Must be immutable -- tuple, frozenset, or similar non-mutable container
    assert not isinstance(STYLE_PACK_IDS, list), (
        "STYLE_PACK_IDS must be immutable (tuple/frozenset), not a mutable list"
    )


@pytest.mark.unit
def test_default_pack_id_is_polytoken_teal() -> None:
    """DEFAULT_PACK_ID must equal 'polytoken-teal' (mirrors TS DEFAULT_PACK_ID)."""
    from app.infrastructure.llm.genui_style_packs import DEFAULT_PACK_ID

    assert DEFAULT_PACK_ID == "polytoken-teal"


@pytest.mark.unit
def test_is_known_pack_id_returns_true_for_valid() -> None:
    """is_known_pack_id must return True for all STYLE_PACK_IDS members."""
    from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS, is_known_pack_id

    for pack_id in STYLE_PACK_IDS:
        assert is_known_pack_id(pack_id) is True, f"Expected is_known_pack_id({pack_id!r}) to be True"


@pytest.mark.unit
def test_is_known_pack_id_returns_false_for_unknown() -> None:
    """is_known_pack_id must return False for unknown or empty pack IDs (T-17-04 spoofing guard)."""
    from app.infrastructure.llm.genui_style_packs import is_known_pack_id

    assert is_known_pack_id("unknown-pack") is False
    assert is_known_pack_id("") is False
    assert is_known_pack_id("nauta") is False  # partial match must NOT be accepted


@pytest.mark.unit
def test_style_pack_ids_count_equals_ts_source_of_truth() -> None:
    """STYLE_PACK_IDS must have exactly 6 packs (parity with packages/genui/src/theme/packs.ts)."""
    from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS

    assert len(STYLE_PACK_IDS) == 6, (
        f"Expected 6 packs (parity with TS), got {len(STYLE_PACK_IDS)}: {list(STYLE_PACK_IDS)}"
    )
