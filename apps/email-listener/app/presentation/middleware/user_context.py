"""X-User-Id extraction — non-enforcing reader + enforcing dependency (Phase 44, TENA-03).

Trust model: FastAPI is reachable only server-to-server through the
authenticated BFF (Next.js) — see `require_api_key` in `auth.py`, which this
module MUST NOT touch. The `X-User-Id` header value is trusted because it was
computed server-side by the trusted Next.js process from a server-verified
Supabase session (`supabase.auth.getUser()`), never from a client-suppliable
field (Phase 43 Plan 04, T-43-P4-01/03).

`extract_user_id` stays non-enforcing (never raises) for genuinely optional
surfaces. `require_user_id` is the Phase 44 enforcing sibling: it 401s when
the header is absent/empty. Neither one performs an OWNERSHIP check — that
lives in the repository/service layer (e.g. `ImporterResolver.
list_importer_ids_for_user`), never in this middleware. This dependency only
guards PRESENCE of a trusted-transport caller identity.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

USER_ID_HEADER = "X-User-Id"


async def extract_user_id(request: Request) -> str | None:
    """Return the caller-asserted user id from the trusted BFF, or None.

    Non-enforcing by design: a missing or empty header is not an error.
    """
    return request.headers.get(USER_ID_HEADER) or None


async def require_user_id(request: Request) -> str:
    """Return the caller-asserted user id from the trusted BFF, or 401.

    Enforcing sibling of `extract_user_id` (Phase 44, T-43-P4-04). Mirrors
    `require_api_key`'s raise style (`auth.py`). Ownership of any specific
    resource is verified downstream in the repository/service layer — this
    dependency only guards that SOME trusted caller identity is present.
    """
    user_id = request.headers.get(USER_ID_HEADER)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user_id
