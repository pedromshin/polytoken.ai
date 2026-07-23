"""EmbeddingAdapter — text embedding via AWS Bedrock Amazon Titan Text Embeddings V1.

Bedrock model: amazon.titan-embed-text-v1
Output dimensions: 1536 (fixed)
Auth: ECS task IAM role (bedrock:InvokeModel) — no API key.

NOTE: Titan V1 (not V2) is used deliberately. The components.embedding column and
the hybrid-retrieval RPCs are halfvec(1536); Titan V2 only emits 256/512/1024 dims,
so it cannot satisfy the 1536 contract. V1 emits exactly 1536. (A live confirm
otherwise 500s with "expected 1536 dimensions, not 1024".)

On total failure returns a zero-vector of length 1536 (never raises)
so callers can always proceed; they should treat a zero-vector as a
signal that retrieval will return empty results (cosine distance = 1.0
from any real vector). ST-04: that silent fallback additionally calls
record_adapter_degradation("embedding", ...) so a pipeline driver collecting
degradations can surface it — a no-op outside a collector, so the
never-raise contract and every other caller are unchanged.

The boto3 bedrock-runtime client is injected so it can be mocked in tests.
Sync boto3 is used (invoke_model is not async) — calls are cheap enough
that running from async context with a direct call is acceptable for now.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.domain.services.pipeline_health import record_adapter_degradation

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MODEL_ID = "amazon.titan-embed-text-v1"
_DIMENSIONS = 1536
_ZERO_VECTOR: tuple[float, ...] = tuple([0.0] * _DIMENSIONS)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class EmbeddingAdapter:
    """Embeds text via Amazon Titan Text Embeddings V2 on AWS Bedrock.

    Implements EmbeddingProtocol (structural subtyping — no import of the
    Protocol to keep infrastructure free of domain coupling at runtime).
    """

    def __init__(self, *, client: Any) -> None:
        """
        Args:
            client: boto3 bedrock-runtime client.
                    Obtained via boto3.client("bedrock-runtime", region_name=...).
                    The ECS task IAM role must have bedrock:InvokeModel permission
                    for arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1.
        """
        self._client = client

    async def embed(self, *, text: str) -> tuple[float, ...]:
        """Embed text and return a 1536-dimensional float tuple.

        Returns a zero-vector of length 1536 on total failure.
        """
        try:
            return self._invoke(text=text)
        except Exception as exc:
            logger.exception(
                "EmbeddingAdapter: Bedrock invocation failed — returning zero-vector",
                extra={"model_id": _MODEL_ID, "text_len": len(text)},
            )
            record_adapter_degradation(
                "embedding",
                f"zero-vector fallback: {type(exc).__name__}",
            )
            return _ZERO_VECTOR

    def _invoke(self, *, text: str) -> tuple[float, ...]:
        """Invoke the Bedrock embedding model synchronously."""
        body = json.dumps({"inputText": text})
        response = self._client.invoke_model(
            modelId=_MODEL_ID,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        response_body: dict[str, Any] = json.loads(response["body"].read())
        embedding: list[float] = response_body["embedding"]
        return tuple(embedding)
