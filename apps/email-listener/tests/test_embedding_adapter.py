"""Tests for EmbeddingAdapter (infrastructure/llm/embedding_adapter.py).

All tests mock the AWS Bedrock boto3 client so no real API calls are made.

Behavior contract:
  - EmbeddingAdapter.embed(text=...) returns a tuple[float, ...] of length 1536.
  - Uses Amazon Titan Text Embeddings V1 via AWS Bedrock boto3 bedrock-runtime client.
  - On total failure returns a zero-vector of length 1536 (documented in adapter).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.infrastructure.llm.embedding_adapter import EmbeddingAdapter

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DIM = 1536
# Titan V1 emits exactly 1536 dims, matching the halfvec(1536) column + RPCs.
# Titan V2 only emits 256/512/1024, which broke live confirm (22000: expected 1536).
_TITAN_MODEL_ID = "amazon.titan-embed-text-v1"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_bedrock_response(embedding: list[float]) -> dict[str, Any]:
    """Mock boto3 bedrock-runtime invoke_model response body."""
    body_bytes = json.dumps({"embedding": embedding}).encode()
    mock_body = MagicMock()
    mock_body.read.return_value = body_bytes
    return {"body": mock_body}


@pytest.fixture
def mock_bedrock_client() -> MagicMock:
    client = MagicMock()
    embedding = [0.1] * _DIM
    client.invoke_model.return_value = _make_bedrock_response(embedding)
    return client


@pytest.fixture
def adapter(mock_bedrock_client: MagicMock) -> EmbeddingAdapter:
    return EmbeddingAdapter(client=mock_bedrock_client)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_embed_returns_tuple_of_floats(adapter: EmbeddingAdapter, mock_bedrock_client: MagicMock) -> None:
    """embed() must return a tuple[float, ...] (not a list)."""
    result = asyncio.run(adapter.embed(text="test document region"))
    assert isinstance(result, tuple)
    assert all(isinstance(v, float) for v in result)


def test_embed_returns_correct_dimensionality(adapter: EmbeddingAdapter) -> None:
    """embed() must return exactly 1536 dimensions (Amazon Titan Text Embeddings V1)."""
    result = asyncio.run(adapter.embed(text="bill of lading MSCU1234567"))
    assert len(result) == _DIM


def test_embed_calls_bedrock_with_titan_model(
    adapter: EmbeddingAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """embed() must invoke the Amazon Titan Text Embeddings V1 model."""
    asyncio.run(adapter.embed(text="test text"))
    mock_bedrock_client.invoke_model.assert_called_once()
    call_kwargs = mock_bedrock_client.invoke_model.call_args[1]
    assert call_kwargs.get("modelId") == _TITAN_MODEL_ID


def test_embed_sends_input_text_in_body(
    adapter: EmbeddingAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """embed() must pass the input text in the request body."""
    text = "commercial invoice INV-9999"
    asyncio.run(adapter.embed(text=text))
    call_kwargs = mock_bedrock_client.invoke_model.call_args[1]
    body_payload = json.loads(call_kwargs["body"])
    assert body_payload.get("inputText") == text


def test_embed_returns_zero_vector_on_failure() -> None:
    """embed() returns a zero-vector of length 1536 on total failure."""
    broken_client = MagicMock()
    broken_client.invoke_model.side_effect = Exception("Bedrock unavailable")
    adapter = EmbeddingAdapter(client=broken_client)
    result = asyncio.run(adapter.embed(text="some text"))
    assert len(result) == _DIM
    assert all(v == 0.0 for v in result)


def test_embed_values_match_bedrock_response(
    mock_bedrock_client: MagicMock,
) -> None:
    """embed() values must exactly match what Bedrock returned."""
    expected = [float(i) / _DIM for i in range(_DIM)]
    mock_bedrock_client.invoke_model.return_value = _make_bedrock_response(expected)
    adapter = EmbeddingAdapter(client=mock_bedrock_client)
    result = asyncio.run(adapter.embed(text="text"))
    assert list(result) == expected


# ---------------------------------------------------------------------------
# ST-04 — silent zero-vector fallback records a degradation event
# ---------------------------------------------------------------------------


def test_embed_failure_records_degradation_inside_collector() -> None:
    """The zero-vector swallow branch names itself to a collecting pipeline
    driver (record_adapter_degradation), without changing the return contract."""
    from app.domain.services.pipeline_health import collect_adapter_degradations

    broken_client = MagicMock()
    broken_client.invoke_model.side_effect = Exception("Bedrock unavailable")
    adapter = EmbeddingAdapter(client=broken_client)

    with collect_adapter_degradations() as events:
        result = asyncio.run(adapter.embed(text="some text"))

    assert all(v == 0.0 for v in result)  # contract unchanged
    assert len(events) == 1
    assert events[0].adapter == "embedding"
    assert "zero-vector" in events[0].detail


def test_embed_success_records_no_degradation() -> None:
    from app.domain.services.pipeline_health import collect_adapter_degradations

    client = MagicMock()
    client.invoke_model.return_value = _make_bedrock_response([0.1] * _DIM)
    adapter = EmbeddingAdapter(client=client)

    with collect_adapter_degradations() as events:
        asyncio.run(adapter.embed(text="ok"))

    assert events == []


def test_embed_failure_outside_collector_is_still_silent() -> None:
    """No collector in context -> the never-raise contract holds and nothing
    leaks into a later collector."""
    from app.domain.services.pipeline_health import collect_adapter_degradations

    broken_client = MagicMock()
    broken_client.invoke_model.side_effect = Exception("Bedrock unavailable")
    adapter = EmbeddingAdapter(client=broken_client)

    result = asyncio.run(adapter.embed(text="orphan"))
    assert all(v == 0.0 for v in result)

    with collect_adapter_degradations() as events:
        pass
    assert events == []
