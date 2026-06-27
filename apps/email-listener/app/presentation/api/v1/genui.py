"""GenUI generation endpoint — POST /v1/genui/generate.

Accepts an intent + raw document content and returns a validated SpecRoot JSON
via the dual-LLM quarantine->generate pipeline (D-09, SAFE-01/SAFE-02).

Security:
  - X-API-Key auth: all routes protected via require_api_key (T-13-auth)
  - raw_content is untrusted; the use case routes it ONLY through Call A (quarantine)
  - intent_hash stored as SHA-256 in the audit row, never raw string (D-19)

Note: Intentionally omits 'from __future__ import annotations'. FastAPI/Pydantic v2
needs concrete types at route registration time to build response serializers.
Using PEP 563 deferred annotations causes ApiResponse[GenerateUiSpecView] to become
a ForwardRef that Pydantic cannot resolve at runtime (PydanticUserError: TypeAdapter
is not fully defined).
"""

from typing import Any

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

logger = structlog.get_logger(__name__)

router = APIRouter(
    prefix="/v1/genui",
    tags=["genui"],
    dependencies=[Depends(require_api_key)],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class GenerateUiSpecRequest(BaseModel):
    """Request body for POST /v1/genui/generate."""

    intent: str = Field(
        ...,
        min_length=1,
        description="Trusted user intent: what should be displayed.",
    )
    raw_content: str = Field(
        ...,
        min_length=1,
        description="Untrusted raw document content to render (quarantined in Call A).",
    )
    registry_version: str = Field(
        ...,
        min_length=1,
        description="Catalog/registry version for audit traceability (GEN-05).",
    )
    importer_id: str | None = Field(
        default=None,
        description="Optional importer context for audit rows (D-19).",
    )


class GenerateUiSpecView(BaseModel):
    """Response view wrapping the validated SpecRoot JSON."""

    spec: dict[str, Any]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/generate")
@inject
async def generate_ui_spec(
    body: GenerateUiSpecRequest,
    use_case: FromDishka[GenerateUiSpecUseCase],
) -> ApiResponse[GenerateUiSpecView]:
    """Generate a validated SpecRoot JSON from a user intent + raw document content.

    The pipeline (D-09, SAFE-01/SAFE-02):
      1. Call A (quarantine): enum-constrained extraction -- raw prose NEVER leaves this step.
      2. Call B (generator): emit_ui_spec forced tool-use with repair loop <=3 + Sonnet escalation.
      3. Audit row written best-effort (T-13-10, D-19).

    On total pipeline failure the response contains SAFE_FALLBACK_SPEC (D-07) --
    the endpoint always returns 200 (the fallback IS the response, not an error).
    """
    result = await use_case.execute(
        intent=body.intent,
        raw_content=body.raw_content,
        registry_version=body.registry_version,
        importer_id=body.importer_id,
    )

    return ApiResponse.ok(GenerateUiSpecView(spec=result.spec))
