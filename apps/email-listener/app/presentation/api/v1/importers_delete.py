"""POST /v1/importers/delete-data — listener-owned blob erasure for account deletion.

Called internally by web during account deletion (BEFORE it deletes the Supabase
auth user, whose cascade destroys the pointers this needs). Erases the raw MIME +
attachment blobs that do NOT cascade.

TENANT SAFETY (adversarial-review finding): the scope is derived server-side from
the ``X-User-Id`` header — this endpoint takes NO importer ids / keys from the
body, so no caller (even a holder of the shared API key) can name another user's
data. Guarded by ``require_api_key`` (the internal-call secret) AND a mandatory
non-empty ``X-User-Id``.

Returns ``complete`` — the web caller MUST gate the irreversible auth-user cascade
on it, so a partial blob-delete failure never strands data behind a destroyed
pointer (retry re-derives and re-deletes; every delete is idempotent).
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, Header, HTTPException

from app.application.use_cases.delete_importer_data import DeleteImporterDataUseCase
from app.presentation.middleware.auth import require_api_key

router = APIRouter(
    prefix="/v1/importers",
    tags=["importers-internal"],
    dependencies=[Depends(require_api_key)],
)


@router.post("/delete-data", status_code=200)
@inject
async def delete_importer_data(
    use_case: FromDishka[DeleteImporterDataUseCase],
    x_user_id: str = Header(..., alias="X-User-Id"),
) -> dict[str, object]:
    """Erase the listener-owned blobs for the X-User-Id user (scope self-derived)."""
    if not x_user_id.strip():
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    result = await use_case.execute(user_id=x_user_id)
    return {
        "deleted_raw": result.deleted_raw,
        "deleted_attachment_prefixes": result.deleted_attachment_prefixes,
        "requested_raw": result.requested_raw,
        "requested_attachment_prefixes": result.requested_attachment_prefixes,
        "complete": result.complete,
    }
