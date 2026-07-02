"""GenUI code-island endpoint — POST /v1/genui/code-island/generate.

Accepts an intent + optional raw document content and returns arbitrary
self-contained JavaScript "island" code via the dual-LLM quarantine → code-generate
pipeline (D-09, SAFE-01/SAFE-02). This is a PARALLEL path to POST /v1/genui/generate
(the declarative spec endpoint), which is untouched.

Security:
  - X-API-Key auth: all routes protected via require_api_key (T-13-auth)
  - raw_content is untrusted; the use case routes it ONLY through Call A (quarantine)
  - intent_hash stored as SHA-256 in the audit row, never raw string (D-19)
  - The emitted code is inert text here — a downstream AST allowlist hard-blocks
    unsafe constructs before it is ever executed.

Note: Intentionally omits 'from __future__ import annotations'. FastAPI/Pydantic v2
needs concrete types at route registration time to build response serializers.
Using PEP 563 deferred annotations causes ApiResponse[GenerateCodeIslandView] to become
a ForwardRef that Pydantic cannot resolve at runtime (PydanticUserError: TypeAdapter
is not fully defined).
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.application.use_cases.generate_code_island import GenerateCodeIslandUseCase
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

router = APIRouter(
    prefix="/v1/genui/code-island",
    tags=["genui"],
    dependencies=[Depends(require_api_key)],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class GenerateCodeIslandRequest(BaseModel):
    """Request body for POST /v1/genui/code-island/generate."""

    intent: str = Field(
        ...,
        min_length=1,
        max_length=4096,
        description="Trusted user intent: what should be built.",
    )
    raw_content: str = Field(
        default="",
        description=(
            "Untrusted raw document content to render (quarantined in Call A). "
            "Optional — when empty, the generator uses the intent alone."
        ),
    )
    importer_id: str | None = Field(
        default=None,
        description="Optional importer context for audit rows (D-19).",
    )


class GenerateCodeIslandView(BaseModel):
    """Response view wrapping the emitted JavaScript island code."""

    code: str
    language: str
    outcome: str
    attempts: int
    candidate_count: int = 1
    """Number of candidates generated in the parallel fan-out (additive field; the web
    tRPC client ignores unknown/extra fields, so no web change is required)."""


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/generate")
@inject
async def generate_code_island(
    body: GenerateCodeIslandRequest,
    use_case: FromDishka[GenerateCodeIslandUseCase],
) -> ApiResponse[GenerateCodeIslandView]:
    """Generate a self-contained JavaScript island from a user intent + raw content.

    The pipeline (D-09, SAFE-01/SAFE-02):
      1. Call A (quarantine): enum-constrained extraction -- raw prose NEVER leaves this step.
      2. Call B (code generator): emit_code_island forced tool-use + Sonnet escalation.
      3. Audit row written best-effort (T-13-10, D-19).

    On total pipeline failure the response contains SAFE_FALLBACK_CODE (D-07) --
    the endpoint always returns 200 (the fallback IS the response, not an error).
    """
    result = await use_case.execute(
        intent=body.intent,
        raw_content=body.raw_content,
        importer_id=body.importer_id,
    )

    return ApiResponse.ok(
        GenerateCodeIslandView(
            code=result.code,
            language=result.language,
            outcome=result.outcome,
            attempts=result.attempts,
            candidate_count=result.candidate_count,
        )
    )
