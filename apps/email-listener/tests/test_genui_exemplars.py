"""Tests for hand-authored exemplar assets + loader (Task 2 — TDD RED).

D-12: Exemplars are committed, hand-authored, real SpecRoot assets — never AI-fabricated.
Every exemplar must validate against load_spec_schema() with zero errors.
"""

from __future__ import annotations

import re

import pytest

# ---------------------------------------------------------------------------
# RED gate: these imports will fail until genui_exemplars.py is created
# ---------------------------------------------------------------------------

NO_PLACEHOLDER_PHRASES: tuple[str, ...] = (
    "placeholder",
    "todo",
    "fixme",
    "coming soon",
    "not available",
    "lorem ipsum",
    "tbd",
    "example.com",
    "foo bar",
    "baz",
    "dummy",
    "fake",
    "stub",
    "replace me",
    "insert here",
    "sample text",
    "sample content",
)

CORE_CATEGORIES: frozenset[str] = frozenset(
    {"dashboard", "profile", "pricing", "feed", "landing"}
)


class TestExemplarDTO:
    """Exemplar is a frozen dataclass: id, category, tags, spec."""

    def test_exemplar_can_be_created(self) -> None:
        from app.infrastructure.llm.genui_exemplars import Exemplar

        ex = Exemplar(
            id="dashboard-saas",
            category="dashboard",
            tags=("kpi", "grid", "metrics"),
            spec={"v": 1, "root": {"type": "text", "content": "test"}},
        )
        assert ex.id == "dashboard-saas"
        assert ex.category == "dashboard"
        assert "kpi" in ex.tags
        assert ex.spec["v"] == 1

    def test_exemplar_is_frozen(self) -> None:
        from dataclasses import FrozenInstanceError

        from app.infrastructure.llm.genui_exemplars import Exemplar

        ex = Exemplar(
            id="test",
            category="dashboard",
            tags=("tag",),
            spec={"v": 1, "root": {"type": "text", "content": "x"}},
        )
        with pytest.raises(FrozenInstanceError):
            ex.id = "mutated"  # type: ignore[misc]

    def test_exemplar_tags_is_tuple(self) -> None:
        from app.infrastructure.llm.genui_exemplars import Exemplar

        ex = Exemplar(
            id="pricing-basic",
            category="pricing",
            tags=("button", "card", "tiers"),
            spec={"v": 1, "root": {"type": "text", "content": "x"}},
        )
        assert isinstance(ex.tags, tuple)

    def test_exemplar_spec_is_dict(self) -> None:
        from app.infrastructure.llm.genui_exemplars import Exemplar

        ex = Exemplar(
            id="profile-detail",
            category="profile",
            tags=("key-value-list",),
            spec={"v": 1, "root": {"type": "text", "content": "Profile"}},
        )
        assert isinstance(ex.spec, dict)


class TestLoadExemplars:
    """load_exemplars() returns a non-empty tuple of Exemplar records."""

    def test_load_exemplars_returns_tuple(self) -> None:
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        assert isinstance(result, tuple)

    def test_load_exemplars_non_empty(self) -> None:
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        assert len(result) >= 5, f"Expected >=5 exemplars, got {len(result)}"

    def test_load_exemplars_all_are_exemplar_instances(self) -> None:
        from app.infrastructure.llm.genui_exemplars import Exemplar, load_exemplars

        result = load_exemplars()
        for ex in result:
            assert isinstance(ex, Exemplar), f"Expected Exemplar, got {type(ex)}"

    def test_load_exemplars_is_cached(self) -> None:
        """Calling load_exemplars() twice returns the same tuple object (lru_cache)."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result_a = load_exemplars()
        result_b = load_exemplars()
        assert result_a is result_b, "load_exemplars() should be cached (lru_cache)"

    def test_load_exemplars_covers_core_categories(self) -> None:
        """At least one exemplar per core category: dashboard, profile, pricing, feed, landing."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        found_categories = {ex.category for ex in result}
        missing = CORE_CATEGORIES - found_categories
        assert not missing, (
            f"Missing exemplars for core categories: {missing}. "
            f"Found categories: {found_categories}"
        )

    def test_exemplar_ids_are_unique(self) -> None:
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        ids = [ex.id for ex in result]
        assert len(ids) == len(set(ids)), f"Duplicate exemplar ids found: {ids}"

    def test_exemplar_ids_are_lowercase_kebab(self) -> None:
        """Exemplar ids must be lowercase kebab-case for stable referencing."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        _kebab_pattern = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
        result = load_exemplars()
        for ex in result:
            assert _kebab_pattern.match(ex.id), (
                f"Exemplar id '{ex.id}' is not lowercase kebab-case"
            )

    def test_exemplar_categories_from_known_set(self) -> None:
        """Exemplar categories must be from the fixed known set."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        allowed_categories: frozenset[str] = frozenset(
            {"dashboard", "profile", "pricing", "feed", "landing"}
        )
        result = load_exemplars()
        for ex in result:
            assert ex.category in allowed_categories, (
                f"Exemplar '{ex.id}' has unknown category '{ex.category}'. "
                f"Allowed: {allowed_categories}"
            )

    def test_exemplar_tags_non_empty(self) -> None:
        """Every exemplar must have at least one tag."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        for ex in result:
            assert len(ex.tags) >= 1, f"Exemplar '{ex.id}' has no tags"

    def test_exemplar_spec_has_v_and_root(self) -> None:
        """Every exemplar spec must have 'v' (version) and 'root' at minimum."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        result = load_exemplars()
        for ex in result:
            assert "v" in ex.spec, f"Exemplar '{ex.id}' spec missing 'v' field"
            assert ex.spec["v"] == 1, f"Exemplar '{ex.id}' spec.v must be 1"
            assert "root" in ex.spec, f"Exemplar '{ex.id}' spec missing 'root' field"


class TestExemplarSchemaValidation:
    """Every exemplar spec must validate against the genui spec schema (D-12 gate)."""

    def test_all_exemplars_validate_against_spec_schema(self) -> None:
        """D-12: Exemplars are real, renderable specs — zero schema validation errors."""
        from jsonschema import Draft7Validator

        from app.infrastructure.llm.genui_artifacts import load_spec_schema
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        schema = load_spec_schema()
        validator = Draft7Validator(schema)
        exemplars = load_exemplars()

        errors_by_id: dict[str, list[str]] = {}
        for ex in exemplars:
            validation_errors = list(validator.iter_errors(ex.spec))
            if validation_errors:
                errors_by_id[ex.id] = [
                    f"{e.json_path}: {e.message}" for e in validation_errors
                ]

        assert not errors_by_id, (
            "Schema validation failed for exemplar(s):\n"
            + "\n".join(
                f"  [{eid}]: {errs}" for eid, errs in errors_by_id.items()
            )
        )

    def test_exemplar_schema_import_available(self) -> None:
        """jsonschema package is available (required for validation gate)."""
        import jsonschema  # noqa: F401 — confirms availability


class TestNoPlaceholderPhrases:
    """No exemplar text contains placeholder/meta phrases (quality gate)."""

    def _extract_all_strings(self, obj: object) -> list[str]:
        """Recursively extract all string values from nested dicts/lists."""
        strings: list[str] = []
        if isinstance(obj, str):
            strings.append(obj)
        elif isinstance(obj, dict):
            for v in obj.values():
                strings.extend(self._extract_all_strings(v))
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                strings.extend(self._extract_all_strings(item))
        return strings

    def test_no_placeholder_in_exemplar_specs(self) -> None:
        """No exemplar spec text contains placeholder/meta phrases."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        exemplars = load_exemplars()
        violations: list[str] = []

        for ex in exemplars:
            all_text = " ".join(self._extract_all_strings(ex.spec)).lower()
            for phrase in NO_PLACEHOLDER_PHRASES:
                if phrase in all_text:
                    violations.append(
                        f"Exemplar '{ex.id}' contains placeholder phrase: '{phrase}'"
                    )

        assert not violations, (
            "Exemplar quality gate failed — placeholder phrases found:\n"
            + "\n".join(f"  {v}" for v in violations)
        )

    def test_no_placeholder_in_exemplar_ids(self) -> None:
        """Exemplar ids must not contain placeholder patterns."""
        from app.infrastructure.llm.genui_exemplars import load_exemplars

        exemplars = load_exemplars()
        for ex in exemplars:
            id_lower = ex.id.lower()
            for phrase in ("placeholder", "todo", "stub", "fake", "dummy", "test"):
                assert phrase not in id_lower, (
                    f"Exemplar id '{ex.id}' contains placeholder pattern '{phrase}'"
                )
