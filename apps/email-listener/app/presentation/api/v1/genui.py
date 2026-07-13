"""GenUI endpoints — POST /v1/genui/generate, POST /v1/genui/retheme, GET /v1/genui/history[/{id}].

Accepts an intent + raw document content and returns a validated SpecRoot JSON
via the dual-LLM quarantine->generate pipeline (D-09, SAFE-01/SAFE-02).

Phase 16-03 (STDO-05/STDO-06): adds read-only history spine:
  - GET /v1/genui/history: paginated list of TemplateSummary (no spec_json, D-14)
  - GET /v1/genui/history/{template_id}: single TemplateDetail with spec_json (D-14)
  Both endpoints use the UiSpecTemplateRepository port (D-16: only ui_spec_templates).
  Best-effort (D-15): 404 when find_by_id returns None; list returns [] not 5xx.

Plan 52-05 (PANL-04): adds the one-shot NL re-theme resolution endpoint:
  - POST /v1/genui/retheme: {instruction, current_style_pack_id} -> validated
    {style_pack_id, token_overrides, outcome} via ResolveRethemeUseCase. ONE
    Bedrock forced-tool-use call, no repair loop, no screenshot judging
    (locked). Always 200 — a resolver failure yields outcome="fallback" with
    the caller's current pack unchanged, never a partial result.

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

from typing import Any, Literal

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase
from app.application.use_cases.resolve_retheme import ResolveRethemeUseCase
from app.domain.ports.ui_spec_template_repository import UiSpecTemplateRepository
from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS
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
        default="",
        description=(
            "Untrusted raw document content to render (quarantined in Call A). "
            "Optional — when empty, the quarantine step runs with no document content "
            "and the generator uses the intent alone (intent-only generation mode). "
            "Phase 15 studio UI will supply real content."
        ),
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
    style_pack_id: str | None = Field(
        default=None,
        description=(
            "Optional style pack identifier. Must be one of the known pack IDs: "
            f"{', '.join(STYLE_PACK_IDS)}. "
            "Unknown values are rejected with HTTP 422 (T-17-04 spoofing guard). "
            "Defaults to the polytoken-teal pack when omitted."
        ),
    )

    @field_validator("style_pack_id")
    @classmethod
    def validate_style_pack_id(cls, v: str | None) -> str | None:
        """Reject unknown style_pack_id values (T-17-04: spoofing guard)."""
        if v is not None and v not in STYLE_PACK_IDS:
            raise ValueError(f"Unknown style_pack_id '{v}'. Must be one of: {', '.join(STYLE_PACK_IDS)}")
        return v


class GenerateUiSpecView(BaseModel):
    """Response view wrapping the validated SpecRoot JSON."""

    spec: dict[str, Any]
    cache_hit: bool = False
    outcome: Literal["ok", "fallback", "escalated"] = "ok"
    style_pack_id: str | None = None
    retrieved_ids: tuple[str, ...] = ()


class RethemeRequest(BaseModel):
    """Request body for POST /v1/genui/retheme (PANL-04, 52-05)."""

    instruction: str = Field(
        ...,
        min_length=1,
        max_length=280,
        description=(
            "Free-text NL instruction describing the desired look (e.g. 'make it more playful and colorful')."
        ),
    )
    current_style_pack_id: str | None = Field(
        default=None,
        description=(
            "The panel's current active pack id — used as resolver context "
            "and as the fallback target on an unknown resolution or resolver "
            "failure. Not validated against STYLE_PACK_IDS here: an unrecognized "
            "value degrades gracefully (ResolveRethemeUseCase falls back to the "
            "default pack) rather than a hard 422 reject."
        ),
    )


class RethemeView(BaseModel):
    """Response view wrapping the validated {style_pack_id, token_overrides, outcome} envelope."""

    style_pack_id: str
    token_overrides: dict[str, str]
    outcome: Literal["ok", "fallback"] = "ok"


class HistoryRowView(BaseModel):
    """Lightweight summary row for the history list endpoint (D-14: no spec_json).

    Intentionally omits spec_json to keep the list payload small.
    Use GET /v1/genui/history/{id} to retrieve the full detail with spec_json.
    """

    id: str
    intent_text: str
    created_at: str
    registry_version: str
    use_count: int
    validation_status: str


class HistoryDetailView(BaseModel):
    """Full detail view for a single history entry (D-14: includes spec_json).

    Returned by GET /v1/genui/history/{id}.
    """

    id: str
    intent_text: str
    created_at: str
    registry_version: str
    use_count: int
    validation_status: str
    spec_json: dict[str, Any]


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
        style_pack_id=body.style_pack_id,
    )

    return ApiResponse.ok(
        GenerateUiSpecView(
            spec=result.spec,
            cache_hit=result.cache_hit,
            outcome=result.outcome,
            style_pack_id=result.style_pack_id,
            retrieved_ids=result.retrieved_ids,
        )
    )


# ---------------------------------------------------------------------------
# Re-theme endpoint (PANL-04, 52-05)
# ---------------------------------------------------------------------------


@router.post("/retheme")
@inject
async def resolve_retheme(
    body: RethemeRequest,
    use_case: FromDishka[ResolveRethemeUseCase],
) -> ApiResponse[RethemeView]:
    """Resolve a natural-language re-theme instruction to {style_pack_id, token_overrides}.

    One-shot: ONE Bedrock forced-tool-use call, no repair loop, no screenshot
    judging (locked, 52-05-PLAN.md). The Python-side validation performed by
    the use case (known-pack coercion + allowed-override-key filtering) is a
    BELT — the tRPC web boundary (genui.resolveRetheme's
    RethemeResolutionSchema) is the AUTHORITATIVE gate (GEN-03/D-08). This
    endpoint always returns 200 — even on total resolver failure the response
    carries outcome="fallback" with the caller's current pack unchanged
    (never partial, never an error status; mirrors /generate's SAFE_FALLBACK
    posture).
    """
    result = await use_case.execute(
        instruction=body.instruction,
        current_style_pack_id=body.current_style_pack_id,
    )
    return ApiResponse.ok(
        RethemeView(
            style_pack_id=result.style_pack_id,
            token_overrides=result.token_overrides,
            outcome=result.outcome,
        )
    )


# ---------------------------------------------------------------------------
# History endpoints (STDO-05 / STDO-06)
# ---------------------------------------------------------------------------


@router.get("/history")
@inject
async def list_history(
    repo: FromDishka[UiSpecTemplateRepository],
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    importer_id: str | None = Query(default=None),
) -> ApiResponse[list[HistoryRowView]]:
    """Paginated list of recent UI spec template history entries (STDO-05).

    Returns HistoryRowView rows WITHOUT spec_json (D-14 — lightweight list).
    Use GET /v1/genui/history/{id} to retrieve the full spec_json for a single entry.

    D-15 best-effort: returns [] (not 5xx) on repository errors.
    D-16: surfaces only ui_spec_templates rows, never genui_generation_events.
    """
    try:
        summaries = await repo.list_recent(limit=limit, offset=offset, importer_id=importer_id)
    except Exception:
        logger.warning("genui_list_history_failed", exc_info=True)
        summaries = []
    rows = [
        HistoryRowView(
            id=s.id,
            intent_text=s.intent_text,
            created_at=s.created_at,
            registry_version=s.registry_version,
            use_count=s.use_count,
            validation_status=s.validation_status,
        )
        for s in summaries
    ]
    return ApiResponse.ok(rows)


@router.get("/history/{template_id}")
@inject
async def get_history_detail(
    template_id: str,
    repo: FromDishka[UiSpecTemplateRepository],
) -> ApiResponse[HistoryDetailView]:
    """Return a single UI spec template history entry with full spec_json (STDO-06).

    D-14: includes spec_json in the response — full detail payload.
    D-15 best-effort: returns 404 when the repository returns None.
    D-16: surfaces only ui_spec_templates rows, never genui_generation_events.
    """
    detail = await repo.find_by_id(template_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Template not found")
    view = HistoryDetailView(
        id=detail.id,
        intent_text=detail.intent_text,
        created_at=detail.created_at,
        registry_version=detail.registry_version,
        use_count=detail.use_count,
        validation_status=detail.validation_status,
        spec_json=detail.spec_json,
    )
    return ApiResponse.ok(view)
