"""Tests for AnthropicEntityTypeClassifier's few-shot examples rendering (LEARN-02, Plan 57-02).

Covers the new `examples` parameter on `classify()`: cold start (no block),
non-empty examples rendered in the user turn, and the D-14 invariant that
example content never leaks into the system prompt. Mirrors
test_autofill_adapter_examples.py's shape.

All tests mock AsyncAnthropicBedrock so no real API calls are made.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

from app.domain.entities.entity_type import EntityType
from app.domain.ports.entity_type_classifier_protocol import RegionToClassify

# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

_ENTITY_TYPE_INVOICE = EntityType(
    id="et-001",
    importer_id=None,
    slug="invoice",
    label="Invoice",
    description="A tax invoice from a vendor",
    is_active=True,
    embedding=None,
    fields=(),
)

_ENTITY_TYPE_RECEIPT = EntityType(
    id="et-002",
    importer_id=None,
    slug="receipt",
    label="Receipt",
    description="A payment receipt",
    is_active=True,
    embedding=None,
    fields=(),
)

_REGION = RegionToClassify(component_id="comp-001", text="some region text")


def _make_tool_use_block(classifications: list[dict[str, Any]]) -> MagicMock:
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"classifications": classifications}
    return block


def _make_response(blocks: list[Any]) -> MagicMock:
    response = MagicMock()
    response.content = blocks
    return response


def _make_capturing_client() -> tuple[MagicMock, list[dict[str, Any]]]:
    captured: list[dict[str, Any]] = []

    async def fake_create(**kwargs: Any) -> Any:
        captured.append(kwargs)
        return _make_response([_make_tool_use_block([])])

    mock_messages = MagicMock()
    mock_messages.create = fake_create
    mock_client = MagicMock()
    mock_client.messages = mock_messages
    return mock_client, captured


# ---------------------------------------------------------------------------
# Cold-start contract regression guard
# ---------------------------------------------------------------------------


def test_cold_start_no_examples_appends_no_block() -> None:
    """classify(..., examples=()) — no <entity_type_examples> block appended (unchanged today)."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE,),
            examples=(),
        )
    )

    assert len(captured) == 1
    user_content = str(captured[0]["messages"][0]["content"])
    assert "<entity_type_examples>" not in user_content


def test_default_examples_param_omitted_matches_cold_start() -> None:
    """classify() called without the examples kwarg at all behaves identically (back-compat)."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE,),
        )
    )

    user_content = str(captured[0]["messages"][0]["content"])
    assert "<entity_type_examples>" not in user_content


# ---------------------------------------------------------------------------
# Non-empty examples: rendered in the user turn only (D-14)
# ---------------------------------------------------------------------------


def test_examples_rendered_in_user_message() -> None:
    """Non-empty examples append an <entity_type_examples> block with content + corrected slug."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    examples = (
        {
            "content_text": "Payment received, thank you.",
            "corrected_entity_type_slug": "receipt",
        },
    )

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT),
            examples=examples,
        )
    )

    user_content = str(captured[0]["messages"][0]["content"])
    assert "<entity_type_examples>" in user_content
    assert "</entity_type_examples>" in user_content
    assert "<example>" in user_content
    assert "Payment received, thank you." in user_content
    assert "receipt" in user_content


def test_multiple_examples_all_rendered() -> None:
    """Each example in the tuple gets its own <example> entry inside the block."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    examples = (
        {"content_text": "First example text", "corrected_entity_type_slug": "invoice"},
        {"content_text": "Second example text", "corrected_entity_type_slug": "receipt"},
    )

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT),
            examples=examples,
        )
    )

    user_content = str(captured[0]["messages"][0]["content"])
    assert user_content.count("<example>") == 2
    assert "First example text" in user_content
    assert "Second example text" in user_content


def test_examples_not_in_system_prompt() -> None:
    """Example content must NEVER leak into the system prompt (D-14 anti-prompt-injection)."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    examples = (
        {
            "content_text": "SECRET_EXAMPLE_MARKER",
            "corrected_entity_type_slug": "receipt",
        },
    )

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT),
            examples=examples,
        )
    )

    system_prompt = str(captured[0].get("system", ""))
    assert "SECRET_EXAMPLE_MARKER" not in system_prompt


def test_system_prompt_unchanged_by_examples() -> None:
    """The system prompt is byte-for-byte identical whether or not examples are supplied."""
    from app.infrastructure.llm.entity_type_classifier_adapter import (
        AnthropicEntityTypeClassifier,
        _build_system_prompt,
    )

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    examples = (
        {
            "content_text": "some correction example",
            "corrected_entity_type_slug": "receipt",
        },
    )

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT),
            examples=examples,
        )
    )

    expected_system_prompt = _build_system_prompt((_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT))
    assert str(captured[0]["system"]) == expected_system_prompt


# ---------------------------------------------------------------------------
# Single-call contract preserved
# ---------------------------------------------------------------------------


def test_single_bedrock_call_regardless_of_examples() -> None:
    """Adding examples never triggers more than one Bedrock call (RELIABILITY constraint)."""
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    examples = (
        {"content_text": "example one", "corrected_entity_type_slug": "invoice"},
        {"content_text": "example two", "corrected_entity_type_slug": "receipt"},
    )

    asyncio.run(
        classifier.classify(
            regions=(_REGION,),
            entity_types=(_ENTITY_TYPE_INVOICE, _ENTITY_TYPE_RECEIPT),
            examples=examples,
        )
    )

    assert len(captured) == 1


# ---------------------------------------------------------------------------
# ST-04 — silent empty-tuple fallback records a degradation event
# ---------------------------------------------------------------------------


def test_classifier_failure_records_degradation_inside_collector() -> None:
    """The never-raise () fallback names itself to a collecting pipeline
    driver, without changing the return contract."""
    from app.domain.services.pipeline_health import collect_adapter_degradations
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    async def failing_create(**kwargs: Any) -> Any:
        raise RuntimeError("bedrock down")

    mock_messages = MagicMock()
    mock_messages.create = failing_create
    mock_client = MagicMock()
    mock_client.messages = mock_messages

    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    with collect_adapter_degradations() as events:
        result = asyncio.run(
            classifier.classify(
                regions=(_REGION,),
                entity_types=(_ENTITY_TYPE_INVOICE,),
            )
        )

    assert result == ()  # contract unchanged
    assert len(events) == 1
    assert events[0].adapter == "classifier"
    assert "1 region(s) left unclassified" in events[0].detail
    assert "RuntimeError" in events[0].detail


def test_classifier_success_records_no_degradation() -> None:
    from app.domain.services.pipeline_health import collect_adapter_degradations
    from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier

    mock_client, _captured = _make_capturing_client()
    classifier = AnthropicEntityTypeClassifier(client=mock_client, model_id="test-model")

    with collect_adapter_degradations() as events:
        asyncio.run(
            classifier.classify(
                regions=(_REGION,),
                entity_types=(_ENTITY_TYPE_INVOICE,),
            )
        )

    assert events == []
