"""Deterministic cache-key helpers for the exact-match UI spec cache (Phase 14 CACHE-02).

Architecture contract (lint-imports):
  Imports ONLY stdlib: hashlib, json, re, unicodedata.
  No infrastructure imports permitted — this module lives in the application layer
  and must remain infra-free so the use case stays lint-imports-clean (13-03 contract).

Functions exported:
  canonicalize_intent  — NFC normalize + strip + lower + collapse whitespace (D-05)
  compute_data_shape_hash — SHA-256 over VALUE-FREE structural shape (D-06)
  compute_cache_key    — SHA-256 over 0x1f-delimited fixed-order fields (D-04/D-08)

Cache-key formula (D-04):
  cache_key = SHA-256(canonical_intent ‖ 0x1f ‖ data_shape_hash ‖ 0x1f
                      ‖ registry_version ‖ 0x1f ‖ context_descriptor)
  where context_descriptor = f"{importer_id or '__system__'}|{catalog_id}"

Threat mitigations implemented here:
  T-14-05: importer_id in context_descriptor → cross-tenant key isolation (D-08)
  T-14-06: 0x1f field delimiter → boundary-collision prevention (D-04)
  T-14-07: values never enter data_shape_hash → no value leakage (D-06)
  T-14-08: registry_version in key → automatic stale-spec invalidation (CACHE-04/D-13)
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata

# Unit-separator (0x1f) used as delimiter between key fields (D-04 / T-14-06).
# This byte is not a valid JSON character, making field-boundary collisions impossible.
_FIELD_SEP = "\x1f"

# Maximum recursion depth for the shape descriptor (D-06 "Claude's Discretion").
_MAX_SHAPE_DEPTH = 8

# Shape sentinels for non-JSON / empty inputs (D-06).
_SENTINEL_EMPTY = "∅"
_SENTINEL_TEXT = "text"

# System importer sentinel when importer_id is None (D-08).
_SYSTEM_IMPORTER = "__system__"


def canonicalize_intent(intent: str) -> str:
    """Return the canonical form of an intent string (D-05).

    Steps (in order):
      1. NFC Unicode normalization — ensures NFC-equivalent codepoints are equal.
      2. strip() — remove leading/trailing whitespace.
      3. lower() — case-fold to ASCII-compatible lowercase.
      4. Collapse all internal Unicode whitespace runs to a single ASCII space.

    Args:
        intent: The raw intent string from the request.

    Returns:
        The canonical intent string (deterministic, whitespace/case-insensitive).

    Examples:
        "  Show   Invoice  " → "show invoice"
        "Show invoice" == canonicalize_intent("show  Invoice")
    """
    normalized = unicodedata.normalize("NFC", intent)
    stripped = normalized.strip().lower()
    return re.sub(r"\s+", " ", stripped)


def compute_data_shape_hash(raw_content: str) -> str:
    """Return a SHA-256 hex digest of the VALUE-FREE structural shape of raw_content (D-06).

    Shape extraction rules:
      - empty/whitespace-only raw_content → sentinel shape "∅"
      - raw_content that fails json.loads → sentinel shape "text"
      - valid JSON → recursive value-free shape descriptor:
          * dict  → {sorted_key: recurse(value), ...}
          * list  → sorted deduped set of element type descriptors (deterministic)
          * str   → "string"
          * int/float → "number"
          * bool  → "boolean"  (bool before int — isinstance(True, int) is True)
          * None  → "null"
      - recursion capped at _MAX_SHAPE_DEPTH; nodes beyond the cap are represented
        as the type name only (no further descent).

    Values NEVER enter the hash at any depth — only keys and type names.

    Args:
        raw_content: Raw document content (may be JSON, plain text, or empty).

    Returns:
        A 64-character lowercase hex SHA-256 digest of the shape descriptor.
    """
    if not raw_content or not raw_content.strip():
        shape: object = _SENTINEL_EMPTY
    else:
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, ValueError):
            shape = _SENTINEL_TEXT
        else:
            shape = _extract_shape(parsed, depth=0)

    serialized = json.dumps(shape, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def compute_cache_key(
    *,
    intent: str,
    raw_content: str,
    registry_version: str,
    importer_id: str | None,
    catalog_id: str,
) -> str:
    """Return the SHA-256 exact-match cache key for a generation request (D-04/D-08).

    Key formula (D-04):
        SHA-256(canonical_intent ‖ 0x1f ‖ data_shape_hash ‖ 0x1f
                ‖ registry_version ‖ 0x1f ‖ context_descriptor)
    where:
        context_descriptor = f"{importer_id or '__system__'}|{catalog_id}"

    The 0x1f (unit-separator) delimiter prevents field-boundary collisions (T-14-06).
    Fixed field order ensures determinism (D-04 / CACHE-02).

    Args:
        intent: Raw intent string (will be canonicalized internally).
        raw_content: Raw document content (shape extracted; values excluded — D-06).
        registry_version: Catalog version string; a change yields a new key (CACHE-04 / D-07).
        importer_id: Tenant scope UUID; None maps to '__system__' sentinel (D-08 / T-14-05).
        catalog_id: Catalog identifier, e.g. 'global' (D-08 / SEAM-03).

    Returns:
        A 64-character lowercase hex SHA-256 digest.
    """
    canonical = canonicalize_intent(intent)
    shape_hash = compute_data_shape_hash(raw_content)
    context_descriptor = f"{importer_id or _SYSTEM_IMPORTER}|{catalog_id}"

    payload = _FIELD_SEP.join([canonical, shape_hash, registry_version, context_descriptor])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _extract_shape(value: object, depth: int) -> object:
    """Recursively extract the value-free shape descriptor for a JSON value (D-06).

    Args:
        value: A Python object resulting from json.loads.
        depth: Current recursion depth; at _MAX_SHAPE_DEPTH, returns type name only.

    Returns:
        A JSON-serializable shape descriptor (dict, list, or str type name).
        Values are NEVER included — only structure and type names.
    """
    if depth >= _MAX_SHAPE_DEPTH:
        return _type_name(value)

    if isinstance(value, bool):
        # bool check MUST precede int check (bool is a subclass of int in Python).
        return "boolean"
    if isinstance(value, dict):
        return {k: _extract_shape(value[k], depth + 1) for k in sorted(value.keys())}
    if isinstance(value, list):
        if not value:
            return []
        # Collect deduped, sorted set of element type descriptors (D-06 "Claude's Discretion").
        element_shapes = {
            json.dumps(_extract_shape(item, depth + 1), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            for item in value
        }
        sorted_shapes = sorted(element_shapes)
        return [json.loads(s) for s in sorted_shapes]
    return _type_name(value)


def _type_name(value: object) -> str:
    """Return the D-06 type name for a scalar JSON value.

    Args:
        value: A Python scalar from json.loads (str, int, float, bool, None).

    Returns:
        One of: "string", "number", "boolean", "null".
    """
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    return "null"
