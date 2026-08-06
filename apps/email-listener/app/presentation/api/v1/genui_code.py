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
from pydantic import BaseModel, ConfigDict, Field, field_validator

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

# Typed-inputs manifest bounds (76-02b) — mirror the web zod caps in
# packages/api-client/src/router/genui/code-island.ts (CodeIslandInputsManifest).
_INPUTS_MAX_KEYS = 32
_INPUTS_MAX_KEY_LENGTH = 120
# Manifest keys become property names on the injected window.__ISLAND_DATA__
# global downstream — never let them be pollution vectors (mirror of the web
# FORBIDDEN_MANIFEST_KEYS + run_chat_turn_tool_loop's _clean_inputs_manifest).
_FORBIDDEN_INPUT_KEYS = frozenset({"__proto__", "constructor", "prototype"})


class CodeIslandInputField(BaseModel):
    """One field of a wired source's published projection — a name + coarse type."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=120)
    type: str | None = Field(default=None, max_length=40)


class CodeIslandInputManifestEntry(BaseModel):
    """One wired source's SHAPE descriptor, keyed by its targetKey in the manifest.

    This is the WEB shape (build-tool-flow.ts's ToolInputManifestEntry) — what
    BOTH callers actually put on the wire — NOT the emit-tool's
    {kind, columns, sample} shape. Strict (extra='forbid') + alias-only
    population mirrors the web zod's .strict() camelCase entries.
    """

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=200)
    node_type: str | None = Field(default=None, alias="nodeType", max_length=80)
    fields: list[CodeIslandInputField] | None = Field(default=None, max_length=50)
    row_count: int | None = Field(default=None, alias="rowCount", ge=0)

    @field_validator("row_count", mode="before")
    @classmethod
    def _reject_bool_row_count(cls, value: object) -> object:
        # bool is an int subclass in Python; the web zod and the sibling
        # _clean_manifest_entry gate both reject it — a bool never poses as a count.
        if isinstance(value, bool):
            raise ValueError("rowCount must be an integer, not a boolean")
        return value


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
    inputs: dict[str, CodeIslandInputManifestEntry] | None = Field(
        default=None,
        description=(
            "Optional typed-inputs SHAPE manifest (76-02b): targetKey → shape of a "
            "wired data source. Shape only, never row values — the values reach the "
            "running island at runtime as window.__ISLAND_DATA__.{targetKey}, never "
            "the model prompt. null when the caller wired no inputs."
        ),
    )

    @field_validator("inputs")
    @classmethod
    def _validate_inputs_keys(
        cls, value: dict[str, CodeIslandInputManifestEntry] | None
    ) -> dict[str, CodeIslandInputManifestEntry] | None:
        """Bound the manifest like the web zod: <=32 keys, key 1-120 chars, no pollution keys."""
        if value is None:
            return value
        if len(value) > _INPUTS_MAX_KEYS:
            raise ValueError(f"at most {_INPUTS_MAX_KEYS} typed inputs")
        for key in value:
            if not 1 <= len(key) <= _INPUTS_MAX_KEY_LENGTH:
                raise ValueError(f"input key must be 1-{_INPUTS_MAX_KEY_LENGTH} characters")
            if key in _FORBIDDEN_INPUT_KEYS:
                raise ValueError("input key must not be __proto__/constructor/prototype")
        return value


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
    # 76-02b: forward the typed-inputs manifest as plain dicts in the WEB wire
    # shape (by_alias → camelCase keys; exclude_none → absent optionals stay
    # absent, exactly as the caller sent them). None when unwired (BTAP-05).
    inputs = (
        {key: entry.model_dump(by_alias=True, exclude_none=True) for key, entry in body.inputs.items()}
        if body.inputs is not None
        else None
    )
    result = await use_case.execute(
        intent=body.intent,
        raw_content=body.raw_content,
        importer_id=body.importer_id,
        inputs=inputs,
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
