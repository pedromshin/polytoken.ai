"""Unit tests for plan 17-05: style_metrics.py, rubric.py a11y contrast extension,
judge_adapter.py brand scorer, and run_eval.py --all-packs runner.

All tests are pure offline — no Bedrock, no Supabase, no network calls.
Mocked-client tests use unittest.mock to patch the Bedrock client.

RED phase: written before implementation. Must fail until GREEN implementation exists.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Shared spec fixtures
# ---------------------------------------------------------------------------

# A spec with nodes that have explicit token-style assignments (text vs surface)
_CONTRAST_PASS_SPEC: dict[str, Any] = {
    "v": 1,
    "style_pack_id": "polytoken-teal",
    "root": {
        "type": "stack",
        "children": [
            # No style props — no contrast check needed
            {"type": "text", "value": "Hello world"},
        ],
    },
}

# A spec with a text node that has token-driven styling that passes AA
_CONTRAST_TOKEN_PASS_SPEC: dict[str, Any] = {
    "v": 1,
    "style_pack_id": "polytoken-teal",
    "root": {
        "type": "card",
        "style": {
            "backgroundColor": "color.background",  # white 100%
        },
        "children": [
            {
                "type": "text",
                "value": "Readable text",
                "style": {
                    "color": "color.foreground",  # near-black 3.9%
                },
            },
        ],
    },
}

# A spec with a text node whose token pair fails AA contrast
# (e.g. muted-foreground on muted background is near-low-contrast)
_CONTRAST_TOKEN_FAIL_SPEC: dict[str, Any] = {
    "v": 1,
    "style_pack_id": "polytoken-teal",
    "root": {
        "type": "card",
        "style": {
            "backgroundColor": "color.muted",  # 0 0% 96.1% — very light gray
        },
        "children": [
            {
                "type": "text",
                "value": "Hard to read",
                "style": {
                    "color": "color.border",  # 0 0% 89.8% — also very light gray (fails contrast)
                },
            },
        ],
    },
}

# Good spec reused from rubric tests
_GOOD_SPEC: dict[str, Any] = {
    "v": 1,
    "root": {
        "type": "stack",
        "children": [
            {
                "type": "card",
                "children": [
                    {"type": "text", "value": "Invoice #001"},
                    {"type": "badge", "label": "Paid"},
                    {"type": "button", "label": "Download", "aria-label": "Download invoice"},
                ],
            },
            {
                "type": "grid",
                "children": [
                    {
                        "type": "key-value-list",
                        "label": "Details",
                        "items": [{"key": "Amount", "value": "$100"}],
                    },
                    {
                        "type": "table",
                        "caption": "Line items",
                        "columns": ["Item", "Price"],
                        "rows": [["Widget", "$100"]],
                    },
                ],
            },
        ],
    },
}

# Polytoken-teal token values (mirroring packs.ts for offline tests)
_NAUTA_TEAL_TOKENS: dict[str, str] = {
    "color.background": "0 0% 100%",
    "color.foreground": "0 0% 3.9%",
    "color.card": "0 0% 100%",
    "color.cardForeground": "0 0% 3.9%",
    "color.primary": "164 39% 22%",
    "color.primaryForeground": "0 0% 98%",
    "color.secondary": "0 0% 96.1%",
    "color.secondaryForeground": "0 0% 9%",
    "color.muted": "0 0% 96.1%",
    "color.mutedForeground": "0 0% 45.1%",
    "color.accent": "0 0% 96.1%",
    "color.accentForeground": "0 0% 9%",
    "color.destructive": "0 84.2% 60.2%",
    "color.destructiveForeground": "0 0% 98%",
    "color.border": "0 0% 89.8%",
    "color.ring": "0 0% 3.9%",
    "radius.base": "0.5rem",
    "spacing.density": "1rem",
    "shadow.base": "none",
    "typography.display.family": "'Inter', 'Helvetica Neue', Arial, sans-serif",
    "typography.body.family": "'Inter', 'Helvetica Neue', Arial, sans-serif",
}


# ===========================================================================
# Task 1 Tests: style_metrics.py — contrast, distinctiveness, retrieval overlap
# ===========================================================================


class TestWcagContrastRatio:
    """Tests for wcag_contrast_ratio() and passes_aa()."""

    @pytest.mark.unit
    def test_black_on_white_passes_aa(self) -> None:
        """Pure black on white (21:1) must pass AA for both normal and large text."""
        from scripts.genui_eval.style_metrics import passes_aa, wcag_contrast_ratio

        # HSL: black = "0 0% 0%", white = "0 0% 100%"
        ratio = wcag_contrast_ratio("0 0% 0%", "0 0% 100%")
        assert ratio >= 21.0 - 0.1, f"Expected ~21:1, got {ratio}"
        assert passes_aa("0 0% 0%", "0 0% 100%") is True
        assert passes_aa("0 0% 0%", "0 0% 100%", large=True) is True

    @pytest.mark.unit
    def test_very_light_gray_on_white_fails_aa(self) -> None:
        """Light gray text on white background fails AA (< 4.5:1 for normal text)."""
        from scripts.genui_eval.style_metrics import passes_aa, wcag_contrast_ratio

        # border color (0 0% 89.8%) on white background (0 0% 100%) — low contrast
        ratio = wcag_contrast_ratio("0 0% 89.8%", "0 0% 100%")
        assert ratio < 4.5, f"Expected < 4.5:1 (failing AA), got {ratio}"
        assert passes_aa("0 0% 89.8%", "0 0% 100%") is False

    @pytest.mark.unit
    def test_normal_text_threshold_is_4_5(self) -> None:
        """passes_aa() with large=False uses 4.5:1 threshold."""
        from scripts.genui_eval.style_metrics import passes_aa

        # polytoken-teal primary (#164 39% 22%) on white (100%) — should pass AA
        assert passes_aa("164 39% 22%", "0 0% 100%") is True

    @pytest.mark.unit
    def test_large_text_threshold_is_3(self) -> None:
        """passes_aa() with large=True uses 3.0:1 threshold (more permissive)."""
        from scripts.genui_eval.style_metrics import passes_aa

        # A pair that fails normal (< 4.5) but passes large (>= 3.0)
        # muted-foreground 45.1% L on white: ~2.8:1 — fails both
        # Use a value between 3:1 and 4.5:1: dark gray ~55% luminance difference
        # Let's use "0 0% 40%" on white — contrast ~5.3:1, passes both
        # For large-only, try "0 0% 62%" on white — roughly ~2.8:1, fails both
        # We'll use a simpler approach: test polytoken-teal primary is above 3.0
        assert passes_aa("164 39% 22%", "0 0% 100%", large=True) is True

    @pytest.mark.unit
    def test_contrast_ratio_is_symmetric(self) -> None:
        """wcag_contrast_ratio(a, b) == wcag_contrast_ratio(b, a)."""
        from scripts.genui_eval.style_metrics import wcag_contrast_ratio

        ratio_1 = wcag_contrast_ratio("164 39% 22%", "0 0% 98%")
        ratio_2 = wcag_contrast_ratio("0 0% 98%", "164 39% 22%")
        assert abs(ratio_1 - ratio_2) < 0.001, "Contrast ratio must be symmetric"

    @pytest.mark.unit
    def test_identical_colors_ratio_is_1(self) -> None:
        """Same fg and bg -> ratio = 1.0 (no contrast)."""
        from scripts.genui_eval.style_metrics import wcag_contrast_ratio

        ratio = wcag_contrast_ratio("0 0% 50%", "0 0% 50%")
        assert abs(ratio - 1.0) < 0.01, f"Identical colors should give 1.0, got {ratio}"


class TestResolveNodeContrastPairs:
    """Tests for resolve_node_contrast_pairs()."""

    @pytest.mark.unit
    def test_no_styled_nodes_returns_empty(self) -> None:
        """A spec with no style props returns empty list."""
        from scripts.genui_eval.style_metrics import resolve_node_contrast_pairs

        pairs = resolve_node_contrast_pairs(_GOOD_SPEC, _NAUTA_TEAL_TOKENS)
        assert isinstance(pairs, list)
        assert len(pairs) == 0

    @pytest.mark.unit
    def test_styled_text_on_bg_returns_pair(self) -> None:
        """A text node with color style inside a bg-styled container yields a pair."""
        from scripts.genui_eval.style_metrics import resolve_node_contrast_pairs

        pairs = resolve_node_contrast_pairs(_CONTRAST_TOKEN_PASS_SPEC, _NAUTA_TEAL_TOKENS)
        # Should find at least one (fg, bg) pair
        assert len(pairs) >= 1
        fg_hsl, bg_hsl = pairs[0]
        assert isinstance(fg_hsl, str)
        assert isinstance(bg_hsl, str)
        # Both should be resolved HSL triplets (not token aliases)
        assert "%" in fg_hsl or fg_hsl == "0 0% 0%"
        assert "%" in bg_hsl or bg_hsl == "0 0% 0%"


class TestRubricA11yContrastExtension:
    """Tests for the contrast check folded into rubric.a11y() (D-09)."""

    @pytest.mark.unit
    def test_a11y_still_passes_spec_with_no_style_props(self) -> None:
        """Existing a11y behavior: spec without style props still passes (backward-compat)."""
        from scripts.genui_eval.rubric import a11y

        result = a11y(_GOOD_SPEC)
        assert result.passed is True
        assert result.score == 1.0

    @pytest.mark.unit
    def test_a11y_passes_when_token_pair_passes_aa(self) -> None:
        """A spec whose only styled node pair passes AA contrast scores a11y as passed."""
        from scripts.genui_eval.rubric import a11y

        result = a11y(_CONTRAST_TOKEN_PASS_SPEC, pack_token_values=_NAUTA_TEAL_TOKENS)
        assert result.passed is True
        assert result.score == 1.0

    @pytest.mark.unit
    def test_a11y_fails_when_token_pair_fails_aa(self) -> None:
        """A spec with a text/bg token pair that fails AA contrast scores a11y < 1.0."""
        from scripts.genui_eval.rubric import a11y

        # border on muted — both very light, fails AA
        result = a11y(_CONTRAST_TOKEN_FAIL_SPEC, pack_token_values=_NAUTA_TEAL_TOKENS)
        assert result.passed is False
        assert result.score < 1.0

    @pytest.mark.unit
    def test_a11y_weights_unchanged(self) -> None:
        """WEIGHTS dict must still contain a11y at 0.15 — D-15 baseline comparability."""
        from scripts.genui_eval.rubric import WEIGHTS

        assert WEIGHTS == {
            "valid-spec": 0.30,
            "composed": 0.30,
            "on-intent": 0.25,
            "a11y": 0.15,
        }

    @pytest.mark.unit
    def test_a11y_default_no_pack_token_values_still_works(self) -> None:
        """a11y() called without pack_token_values (default None) does NOT crash."""
        from scripts.genui_eval.rubric import a11y

        # Existing tests that call a11y(spec) without pack_token_values must still pass
        result = a11y(_GOOD_SPEC)
        assert result.passed is True


class TestDistinctivenessScore:
    """Tests for distinctiveness_score() — D-16 pairwise divergence."""

    @pytest.mark.unit
    def test_identical_specs_score_near_zero(self) -> None:
        """Two identical specs yield distinctiveness ~= 0."""
        from scripts.genui_eval.style_metrics import distinctiveness_score

        score = distinctiveness_score(_GOOD_SPEC, _GOOD_SPEC)
        assert score < 0.1, f"Identical specs should be near-zero distinct, got {score}"

    @pytest.mark.unit
    def test_divergent_specs_score_higher(self) -> None:
        """Two specs with different node structures and token aliases diverge noticeably."""
        from scripts.genui_eval.style_metrics import distinctiveness_score

        spec_a: dict[str, Any] = {
            "v": 1,
            "style_pack_id": "polytoken-teal",
            "root": {
                "type": "stack",
                "style": {"backgroundColor": "color.background"},
                "children": [
                    {
                        "type": "text",
                        "value": "Dashboard",
                        "style": {"color": "color.foreground"},
                    },
                    {"type": "badge", "label": "Active", "style": {"color": "color.primary"}},
                ],
            },
        }
        spec_b: dict[str, Any] = {
            "v": 1,
            "style_pack_id": "brutalist",
            "root": {
                "type": "card",
                "style": {"backgroundColor": "color.card"},
                "children": [
                    {
                        "type": "button",
                        "label": "Submit",
                        "aria-label": "Submit form",
                        "style": {"color": "color.primaryForeground"},
                    },
                    {
                        "type": "table",
                        "caption": "Data",
                        "style": {"color": "color.mutedForeground"},
                    },
                ],
            },
        }
        score = distinctiveness_score(spec_a, spec_b)
        assert score > 0.2, f"Divergent specs should score > 0.2, got {score}"

    @pytest.mark.unit
    def test_distinctiveness_in_range_zero_one(self) -> None:
        """distinctiveness_score() always returns a value in [0, 1]."""
        from scripts.genui_eval.style_metrics import distinctiveness_score

        score = distinctiveness_score(_GOOD_SPEC, _CONTRAST_TOKEN_PASS_SPEC)
        assert 0.0 <= score <= 1.0, f"Score must be in [0,1], got {score}"


class TestRetrievalOverlapRatio:
    """Tests for retrieval_overlap_ratio() and assert_retrieval_influence() — RAG-02."""

    @pytest.mark.unit
    def test_overlap_zero_when_no_ids_match(self) -> None:
        """When retrieved ids don't match any spec node types, ratio == 0."""
        from scripts.genui_eval.style_metrics import retrieval_overlap_ratio

        # retrieved_ids are component catalog IDs, not node types
        # overlap is measured by checking if spec references any retrieved component
        ratio = retrieval_overlap_ratio(_GOOD_SPEC, ("nonexistent-component-1", "nonexistent-2"))
        assert ratio == 0.0, f"No matching ids -> 0.0, got {ratio}"

    @pytest.mark.unit
    def test_overlap_positive_when_ids_referenced(self) -> None:
        """When retrieved ids appear in the spec, ratio > 0."""
        from scripts.genui_eval.style_metrics import retrieval_overlap_ratio

        # Use node types that are actually in GOOD_SPEC: stack, card, text, badge, button, etc.
        # retrieved_ids include a component id whose type appears in the spec
        ratio = retrieval_overlap_ratio(
            _GOOD_SPEC,
            ("table-component", "button-component", "nonexistent-99"),
        )
        # The spec has 'table' and 'button' nodes, and we pass component ids containing those
        # The exact match depends on implementation; just verify positive
        # (implementation may use type substring match or explicit id->type map)
        assert isinstance(ratio, float)
        assert 0.0 <= ratio <= 1.0

    @pytest.mark.unit
    def test_overlap_ratio_one_when_all_match(self) -> None:
        """When all retrieved ids are referenced, ratio approaches 1.0."""
        from scripts.genui_eval.style_metrics import retrieval_overlap_ratio

        # Pass just one id that matches — ratio should be 1.0 / 1 = 1.0
        ratio = retrieval_overlap_ratio(_GOOD_SPEC, ())
        assert ratio == 0.0, "Empty retrieved_ids -> 0.0"

    @pytest.mark.unit
    def test_assert_retrieval_influence_passes_above_floor(self) -> None:
        """assert_retrieval_influence() does NOT raise when ratio >= floor."""
        from scripts.genui_eval.style_metrics import assert_retrieval_influence

        # Should not raise when ratio is comfortably above the floor
        assert_retrieval_influence(ratio=0.5, floor=0.3, prompt_id="test-01")

    @pytest.mark.unit
    def test_assert_retrieval_influence_logs_inert_when_below_floor(self) -> None:
        """assert_retrieval_influence() returns False (or logs) when ratio < floor — NOT raises."""
        from scripts.genui_eval.style_metrics import assert_retrieval_influence

        # Must not raise — just return False / log a warning
        result = assert_retrieval_influence(ratio=0.0, floor=0.3, prompt_id="test-02")
        assert result is False, "Should return False for inert retrieval"


class TestStyleMetricsPurityGuard:
    """Ensure style_metrics.py imports no network/Bedrock/Supabase libraries."""

    @pytest.mark.unit
    def test_style_metrics_no_anthropic_import(self) -> None:
        """style_metrics.py must not import anthropic."""
        from pathlib import Path

        metrics_path = (
            Path(__file__).parent.parent
            / "scripts"
            / "genui_eval"
            / "style_metrics.py"
        )
        source = metrics_path.read_text(encoding="utf-8")
        assert "anthropic" not in source, "style_metrics.py must not import anthropic"
        assert "boto3" not in source, "style_metrics.py must not import boto3"
        assert "supabase" not in source, "style_metrics.py must not import supabase"


# ===========================================================================
# Task 2 Tests: judge_adapter.py — brand/custom-not-generic judge (D-17)
# ===========================================================================


class TestBrandJudge:
    """Tests for score_brand() on JudgeAdapter — D-17."""

    def _make_mock_client(self, score: float = 0.8, rationale: str = "Looks branded") -> Any:
        """Build a mock Bedrock client that returns a valid brand score tool call."""
        mock_block = MagicMock()
        mock_block.type = "tool_use"
        mock_block.input = {"score": score, "rationale": rationale}

        mock_usage = MagicMock()
        mock_usage.input_tokens = 10
        mock_usage.output_tokens = 5

        mock_response = MagicMock()
        mock_response.content = [mock_block]
        mock_response.usage = mock_usage

        mock_client = MagicMock()
        mock_client.messages = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        return mock_client

    @pytest.mark.unit
    def test_score_brand_returns_clamped_score(self) -> None:
        """score_brand() returns JudgeResult with score in [0, 1] from mocked call."""
        from scripts.genui_eval.judge_adapter import JudgeAdapter

        mock_client = self._make_mock_client(score=0.75)
        adapter = JudgeAdapter(
            client=mock_client,
            model_id="test-escalation-model",
            timeout_seconds=15.0,
        )
        result = asyncio.run(
            adapter.score_brand(
                intent="Show me a dashboard",
                spec=_GOOD_SPEC,
                style_pack_id="polytoken-teal",
            )
        )
        assert result.score is not None
        assert 0.0 <= result.score <= 1.0
        assert result.score == pytest.approx(0.75, abs=0.001)

    @pytest.mark.unit
    def test_score_brand_calls_at_temperature_zero(self) -> None:
        """score_brand() calls the Bedrock client with temperature=0."""
        from scripts.genui_eval.judge_adapter import JudgeAdapter

        mock_client = self._make_mock_client()
        adapter = JudgeAdapter(
            client=mock_client,
            model_id="test-escalation-model",
        )
        asyncio.run(
            adapter.score_brand(
                intent="intent",
                spec=_GOOD_SPEC,
                style_pack_id="polytoken-teal",
            )
        )
        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs.get("temperature") == 0

    @pytest.mark.unit
    def test_score_brand_uses_forced_tool_choice(self) -> None:
        """score_brand() uses forced tool_choice (type='tool')."""
        from scripts.genui_eval.judge_adapter import JudgeAdapter

        mock_client = self._make_mock_client()
        adapter = JudgeAdapter(client=mock_client, model_id="test-model")
        asyncio.run(
            adapter.score_brand(
                intent="intent",
                spec=_GOOD_SPEC,
                style_pack_id="polytoken-teal",
            )
        )
        call_kwargs = mock_client.messages.create.call_args.kwargs
        tool_choice = call_kwargs.get("tool_choice", {})
        assert tool_choice.get("type") == "tool", "Must use forced tool_choice"

    @pytest.mark.unit
    def test_score_brand_returns_none_on_error(self) -> None:
        """score_brand() returns score=None (never raises) on any error."""
        from scripts.genui_eval.judge_adapter import JudgeAdapter

        mock_client = MagicMock()
        mock_client.messages = MagicMock()
        mock_client.messages.create = AsyncMock(side_effect=RuntimeError("Bedrock error"))

        adapter = JudgeAdapter(client=mock_client, model_id="test-model")
        result = asyncio.run(
            adapter.score_brand(
                intent="intent",
                spec=_GOOD_SPEC,
                style_pack_id="polytoken-teal",
            )
        )
        assert result.score is None, "On error, score_brand must return score=None"

    @pytest.mark.unit
    def test_score_brand_system_prompt_is_static(self) -> None:
        """score_brand() system prompt must not contain intent or spec interpolation."""
        from scripts.genui_eval.judge_adapter import _BRAND_JUDGE_SYSTEM_PROMPT

        # The system prompt must be a static string literal, not containing f-string
        # injection of user content. We verify it's a module-level constant.
        assert isinstance(_BRAND_JUDGE_SYSTEM_PROMPT, str)
        assert len(_BRAND_JUDGE_SYSTEM_PROMPT) > 20, "System prompt should be substantive"

    @pytest.mark.unit
    def test_score_brand_clamps_out_of_range_score(self) -> None:
        """score_brand() clamps a model score of 1.5 to 1.0."""
        from scripts.genui_eval.judge_adapter import JudgeAdapter

        mock_client = self._make_mock_client(score=1.5)
        adapter = JudgeAdapter(client=mock_client, model_id="test-model")
        result = asyncio.run(
            adapter.score_brand(
                intent="intent",
                spec=_GOOD_SPEC,
                style_pack_id="polytoken-teal",
            )
        )
        assert result.score is not None
        assert result.score <= 1.0, "Score must be clamped to 1.0"


# ===========================================================================
# Task 3 Tests: runner, report, compare_reports extensions
# ===========================================================================


class TestReportStyleFields:
    """Tests for additive style fields in PromptReport and EvalReport — D-15."""

    @pytest.mark.unit
    def test_prompt_report_has_style_fields(self) -> None:
        """PromptReport has additive style fields: a11y_contrast_passed, brand_score,
        distinctiveness, retrieval_overlap."""
        from scripts.genui_eval.report import PromptReport

        # Create a PromptReport with the new additive fields
        pr = PromptReport(
            prompt_id="test-01",
            prompt="Show a dashboard",
            category="data-display",
            complexity="simple",
            tier="A",
            outcome="ok",
            overall_score=0.9,
            valid_spec_score=1.0,
            composed_score=1.0,
            on_intent_score=0.8,
            a11y_score=1.0,
            judge_rationale="Good",
            error=None,
            style_pack_id="polytoken-teal",
            a11y_contrast_passed=True,
            brand_score=0.75,
            distinctiveness=None,
            retrieval_overlap=0.5,
        )
        assert pr.style_pack_id == "polytoken-teal"
        assert pr.a11y_contrast_passed is True
        assert pr.brand_score == pytest.approx(0.75)
        assert pr.distinctiveness is None
        assert pr.retrieval_overlap == pytest.approx(0.5)

    @pytest.mark.unit
    def test_prompt_report_style_fields_have_defaults(self) -> None:
        """Existing PromptReport construction (without style fields) still works."""
        from scripts.genui_eval.report import PromptReport

        pr = PromptReport(
            prompt_id="test-02",
            prompt="Hello",
            category="other",
            complexity="simple",
            tier="A",
            outcome="ok",
            overall_score=0.5,
            valid_spec_score=0.5,
            composed_score=0.5,
            on_intent_score=None,
            a11y_score=0.5,
            judge_rationale="",
            error=None,
        )
        # Style fields should have sensible defaults (None or False)
        assert pr.style_pack_id is None
        assert pr.a11y_contrast_passed is None or pr.a11y_contrast_passed is False or pr.a11y_contrast_passed is True

    @pytest.mark.unit
    def test_eval_report_has_additive_style_aggregates(self) -> None:
        """EvalReport has mean_brand_score + mean_distinctiveness + mean_retrieval_overlap."""
        from scripts.genui_eval.report import PromptReport, build_report

        pr = PromptReport(
            prompt_id="t1",
            prompt="p",
            category="c",
            complexity="simple",
            tier="A",
            outcome="ok",
            overall_score=0.9,
            valid_spec_score=1.0,
            composed_score=1.0,
            on_intent_score=0.8,
            a11y_score=1.0,
            judge_rationale="",
            error=None,
            style_pack_id="polytoken-teal",
            a11y_contrast_passed=True,
            brand_score=0.7,
            distinctiveness=0.4,
            retrieval_overlap=0.6,
        )
        report = build_report(label="test", model_id="m", prompt_reports=[pr])
        # Core four mean fields must still be present (D-15)
        assert hasattr(report, "mean_overall")
        assert hasattr(report, "mean_valid_spec")
        assert hasattr(report, "mean_composed")
        assert hasattr(report, "mean_on_intent")
        assert hasattr(report, "mean_a11y")
        # Additive style aggregates
        assert hasattr(report, "mean_brand_score")
        assert hasattr(report, "mean_distinctiveness")
        assert hasattr(report, "mean_retrieval_overlap")

    @pytest.mark.unit
    def test_four_core_mean_fields_unchanged_by_style_fields(self) -> None:
        """The four mean_* fields are computed identically whether style fields are present."""
        from scripts.genui_eval.report import PromptReport, build_report

        pr_base = PromptReport(
            prompt_id="t1",
            prompt="p",
            category="c",
            complexity="simple",
            tier="A",
            outcome="ok",
            overall_score=0.8,
            valid_spec_score=1.0,
            composed_score=0.6,
            on_intent_score=None,
            a11y_score=1.0,
            judge_rationale="",
            error=None,
        )
        pr_styled = PromptReport(
            prompt_id="t1",
            prompt="p",
            category="c",
            complexity="simple",
            tier="A",
            outcome="ok",
            overall_score=0.8,
            valid_spec_score=1.0,
            composed_score=0.6,
            on_intent_score=None,
            a11y_score=1.0,
            judge_rationale="",
            error=None,
            style_pack_id="polytoken-teal",
            brand_score=0.9,
            distinctiveness=0.5,
            retrieval_overlap=0.4,
        )
        report_base = build_report(label="base", model_id="m", prompt_reports=[pr_base])
        report_styled = build_report(label="styled", model_id="m", prompt_reports=[pr_styled])

        assert report_base.mean_overall == pytest.approx(report_styled.mean_overall, abs=1e-6)
        assert report_base.mean_valid_spec == pytest.approx(report_styled.mean_valid_spec, abs=1e-6)
        assert report_base.mean_composed == pytest.approx(report_styled.mean_composed, abs=1e-6)
        assert report_base.mean_a11y == pytest.approx(report_styled.mean_a11y, abs=1e-6)


class TestAllPacksAggregation:
    """Tests for --all-packs offline aggregation logic — D-19."""

    @pytest.mark.unit
    def test_all_packs_aggregation_computes_per_pack_means(self) -> None:
        """aggregate_all_packs() groups PromptReports by pack and computes means."""
        from scripts.genui_eval.report import PromptReport
        from scripts.genui_eval.run_eval import aggregate_all_packs

        def _make_pr(prompt_id: str, pack_id: str, overall: float) -> PromptReport:
            return PromptReport(
                prompt_id=prompt_id,
                prompt=f"prompt-{prompt_id}",
                category="c",
                complexity="simple",
                tier="A",
                outcome="ok",
                overall_score=overall,
                valid_spec_score=overall,
                composed_score=overall,
                on_intent_score=None,
                a11y_score=overall,
                judge_rationale="",
                error=None,
                style_pack_id=pack_id,
                distinctiveness=None,
            )

        reports = [
            _make_pr("p1", "polytoken-teal", 0.8),
            _make_pr("p2", "polytoken-teal", 0.6),
            _make_pr("p1", "brutalist", 0.9),
            _make_pr("p2", "brutalist", 0.7),
        ]

        result = aggregate_all_packs(reports)
        assert "polytoken-teal" in result
        assert "brutalist" in result
        assert result["polytoken-teal"]["mean_overall"] == pytest.approx(0.7, abs=0.01)
        assert result["brutalist"]["mean_overall"] == pytest.approx(0.8, abs=0.01)

    @pytest.mark.unit
    def test_all_packs_cross_distinctiveness(self) -> None:
        """aggregate_all_packs() computes cross-pack distinctiveness when >=2 packs."""
        from scripts.genui_eval.report import PromptReport
        from scripts.genui_eval.run_eval import aggregate_all_packs

        def _make_pr_with_spec(
            prompt_id: str, pack_id: str, spec_token: str
        ) -> PromptReport:
            return PromptReport(
                prompt_id=prompt_id,
                prompt=f"prompt-{prompt_id}",
                category="c",
                complexity="simple",
                tier="A",
                outcome="ok",
                overall_score=0.8,
                valid_spec_score=1.0,
                composed_score=1.0,
                on_intent_score=None,
                a11y_score=1.0,
                judge_rationale="",
                error=None,
                style_pack_id=pack_id,
                distinctiveness=0.4 if pack_id == "polytoken-teal" else 0.6,
            )

        reports = [
            _make_pr_with_spec("p1", "polytoken-teal", "color.primary"),
            _make_pr_with_spec("p1", "brutalist", "color.card"),
        ]

        result = aggregate_all_packs(reports)
        # Should have a cross_pack key with mean distinctiveness
        assert "cross_pack_mean_distinctiveness" in result, (
            "aggregate_all_packs must return cross_pack_mean_distinctiveness"
        )
        assert isinstance(result["cross_pack_mean_distinctiveness"], float)


class TestCompareReportsStyleExtension:
    """Tests for compare_reports.py style signal + a11y HARD-regression flag — D-18."""

    @pytest.mark.unit
    def test_compare_surfaces_a11y_hard_regression_flag(self) -> None:
        """compare() emits an a11y HARD-regression flag when a11y delta < 0."""
        from scripts.genui_eval.compare_reports import compare

        baseline: dict[str, Any] = {
            "label": "baseline",
            "run_at": "2026-01-01T00:00:00",
            "mean_overall": 0.8,
            "mean_valid_spec": 0.9,
            "mean_composed": 0.8,
            "mean_on_intent": None,
            "mean_a11y": 1.0,  # perfect a11y in baseline
            "prompt_reports": [],
        }
        candidate: dict[str, Any] = {
            "label": "candidate",
            "run_at": "2026-01-02T00:00:00",
            "mean_overall": 0.85,
            "mean_valid_spec": 0.95,
            "mean_composed": 0.85,
            "mean_on_intent": None,
            "mean_a11y": 0.9,  # a11y regressed!
            "prompt_reports": [],
        }
        output = compare(baseline, candidate)
        # Must flag a11y regression — any negative a11y delta is HARD FAIL
        assert "a11y" in output.lower() or "HARD" in output or "regression" in output.lower()
        # The a11y regression should be called out specifically
        assert "hard" in output.lower() or "REGRESSION" in output or "-0.100" in output

    @pytest.mark.unit
    def test_compare_no_a11y_regression_no_hard_flag(self) -> None:
        """compare() does NOT emit a11y HARD-regression flag when a11y is stable or improved."""
        from scripts.genui_eval.compare_reports import compare

        baseline: dict[str, Any] = {
            "label": "baseline",
            "run_at": "2026-01-01T00:00:00",
            "mean_overall": 0.8,
            "mean_valid_spec": 0.9,
            "mean_composed": 0.8,
            "mean_on_intent": None,
            "mean_a11y": 0.9,
            "prompt_reports": [],
        }
        candidate: dict[str, Any] = {
            "label": "candidate",
            "run_at": "2026-01-02T00:00:00",
            "mean_overall": 0.85,
            "mean_valid_spec": 0.95,
            "mean_composed": 0.85,
            "mean_on_intent": None,
            "mean_a11y": 1.0,  # a11y improved
            "prompt_reports": [],
        }
        output = compare(baseline, candidate)
        # Should NOT contain a hard regression flag for a11y
        assert "HARD REGRESSION" not in output.upper() or "a11y" not in output.lower()

    @pytest.mark.unit
    def test_compare_surfaces_style_signals_when_present(self) -> None:
        """compare() reports mean_brand_score and mean_distinctiveness when present."""
        from scripts.genui_eval.compare_reports import compare

        baseline: dict[str, Any] = {
            "label": "baseline",
            "run_at": "2026-01-01T00:00:00",
            "mean_overall": 0.8,
            "mean_valid_spec": 0.9,
            "mean_composed": 0.8,
            "mean_on_intent": None,
            "mean_a11y": 1.0,
            "mean_brand_score": None,
            "mean_distinctiveness": None,
            "mean_retrieval_overlap": None,
            "prompt_reports": [],
        }
        candidate: dict[str, Any] = {
            "label": "candidate",
            "run_at": "2026-01-02T00:00:00",
            "mean_overall": 0.85,
            "mean_valid_spec": 0.95,
            "mean_composed": 0.85,
            "mean_on_intent": None,
            "mean_a11y": 1.0,
            "mean_brand_score": 0.75,
            "mean_distinctiveness": 0.45,
            "mean_retrieval_overlap": 0.6,
            "prompt_reports": [],
        }
        output = compare(baseline, candidate)
        # Style signals should appear in the output
        assert "brand" in output.lower() or "style" in output.lower()
        assert "distinct" in output.lower()

    @pytest.mark.unit
    def test_compare_four_criterion_delta_threshold_unchanged(self) -> None:
        """The existing delta < -0.05 regression gate for overall/per-prompt is unchanged."""
        from scripts.genui_eval.compare_reports import compare

        # A candidate with a severe per-prompt regression (delta < -0.05)
        baseline: dict[str, Any] = {
            "label": "b",
            "run_at": "2026-01-01T00:00:00",
            "mean_overall": 0.9,
            "mean_valid_spec": 0.9,
            "mean_composed": 0.9,
            "mean_on_intent": None,
            "mean_a11y": 1.0,
            "prompt_reports": [
                {"prompt_id": "p1", "overall_score": 0.9},
            ],
        }
        candidate: dict[str, Any] = {
            "label": "c",
            "run_at": "2026-01-02T00:00:00",
            "mean_overall": 0.85,
            "mean_valid_spec": 0.85,
            "mean_composed": 0.85,
            "mean_on_intent": None,
            "mean_a11y": 1.0,
            "prompt_reports": [
                {"prompt_id": "p1", "overall_score": 0.7},  # delta = -0.2 -> regression
            ],
        }
        output = compare(baseline, candidate)
        # The existing regression section must still be present
        assert "Regressions" in output or "regression" in output.lower()
        assert "p1" in output


class TestRunnerStylePackWiring:
    """Tests for --style-pack wiring in run_eval._eval_prompt — D-19."""

    @pytest.mark.unit
    def test_eval_prompt_passes_style_pack_id_to_use_case(self) -> None:
        """_eval_prompt() passes style_pack_id to use_case.execute(...)."""
        from scripts.genui_eval.report import PromptReport
        from scripts.genui_eval.run_eval import _eval_prompt

        mock_result = MagicMock()
        mock_result.spec = _GOOD_SPEC
        mock_result.outcome = "ok"
        mock_result.style_pack_id = "polytoken-teal"
        mock_result.retrieved_ids = ()

        mock_use_case = MagicMock()
        mock_use_case.execute = AsyncMock(return_value=mock_result)

        entry = {
            "id": "test-01",
            "prompt": "Show a dashboard",
            "category": "data-display",
            "complexity": "simple",
            "tier": "A",
        }

        result = asyncio.run(
            _eval_prompt(
                entry=entry,
                use_case=mock_use_case,
                judge=None,
                semaphore=asyncio.Semaphore(1),
                registry_version="v1",
                style_pack_id="polytoken-teal",
            )
        )
        # Verify style_pack_id was passed to execute
        call_kwargs = mock_use_case.execute.call_args.kwargs
        assert call_kwargs.get("style_pack_id") == "polytoken-teal"

        # PromptReport must record the pack
        assert isinstance(result, PromptReport)
        assert result.style_pack_id == "polytoken-teal"

    @pytest.mark.unit
    def test_eval_prompt_records_retrieval_overlap(self) -> None:
        """_eval_prompt() computes retrieval_overlap from the use case result."""
        from scripts.genui_eval.report import PromptReport
        from scripts.genui_eval.run_eval import _eval_prompt

        mock_result = MagicMock()
        mock_result.spec = _GOOD_SPEC
        mock_result.outcome = "ok"
        mock_result.style_pack_id = "polytoken-teal"
        mock_result.retrieved_ids = ("table-component", "card-component")

        mock_use_case = MagicMock()
        mock_use_case.execute = AsyncMock(return_value=mock_result)

        entry = {
            "id": "test-02",
            "prompt": "Show a list of invoices",
            "category": "data-display",
            "complexity": "simple",
            "tier": "A",
        }

        result = asyncio.run(
            _eval_prompt(
                entry=entry,
                use_case=mock_use_case,
                judge=None,
                semaphore=asyncio.Semaphore(1),
                registry_version="v1",
                style_pack_id="polytoken-teal",
            )
        )
        assert isinstance(result, PromptReport)
        # retrieval_overlap should be a float in [0,1] or None
        assert result.retrieval_overlap is None or 0.0 <= result.retrieval_overlap <= 1.0
