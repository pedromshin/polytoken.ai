"""POST /v1/home/assemble-job — internal worker re-entry that assembles the morning board (Phase 74).

The durable worker drains an ``assemble_morning_board`` job (one per active user)
and calls THIS route with the job's ``{ user_id }`` pointer. It mirrors
ingest_job.py EXACTLY: guarded by ``require_api_key`` (``API_KEY`` is already a
container secret), called over localhost in-task off the ALB idle-timeout path,
and — critically — it does NOT swallow failures. Any exception propagates to a
5xx so the worker throws and graphile retries before dead-lettering (MORN-03).

Ship-dark (MORN-06): when ``MORNING_BOARD_ENABLED`` is False the underlying use
case short-circuits — it composes nothing and writes nothing — and this route
returns a 200 no-op (``assembled: false``). The route still EXISTS so the
worker's re-entry contract is stable regardless of the flag.

TENANCY (MORN-04): the ``user_id`` from the payload is the EXPLICIT home-board
owner. It flows to the service-role writer, which keys the write on
``(user_id, scope='home')`` — a write for user A can never land on user B.
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.application.use_cases.assemble_morning_board import AssembleMorningBoardUseCase
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

router = APIRouter(prefix="/v1/home", tags=["home-internal"], dependencies=[Depends(require_api_key)])


class AssembleJobIn(BaseModel):
    """The pointer payload the worker forwards from an ``assemble_morning_board`` job."""

    user_id: str = Field(min_length=1)


class AssembleJobAck(BaseModel):
    assembled: bool
    node_count: int


@router.post("/assemble-job", status_code=200)
@inject
async def run_assemble_job(
    payload: AssembleJobIn,
    use_case: FromDishka[AssembleMorningBoardUseCase],
) -> ApiResponse[AssembleJobAck]:
    """Assemble one user's morning board (or no-op when the feature is dark).

    NO bare-except-200 here (the opposite of the SNS receiver's flag-off path): a
    failure must raise → FastAPI 500 → the worker throws → graphile retries. That
    5xx-on-failure contract is precisely the property the durable queue depends on
    to not lose the job (MORN-03).
    """
    outcome = await use_case.execute(payload.user_id)
    return ApiResponse.ok(
        AssembleJobAck(assembled=outcome.assembled, node_count=outcome.node_count)
    )
