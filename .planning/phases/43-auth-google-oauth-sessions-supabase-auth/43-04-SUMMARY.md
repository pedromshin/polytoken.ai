---
phase: 43-auth-google-oauth-sessions-supabase-auth
plan: 04
subsystem: auth
tags: [supabase, fastapi, bff-proxy, identity-forwarding, x-user-id]

# Dependency graph
requires:
  - phase: 43-01
    provides: "apps/web/src/lib/supabase/server.ts — createClient().auth.getUser() server-verified identity"
provides:
  - "X-User-Id forwarding on all 4 BFF routes that proxy to FastAPI (chat/stream, chat/regenerate, chat/widget/submit, knowledge/edges/promote)"
  - "apps/email-listener/app/presentation/middleware/user_context.py — non-enforcing FastAPI X-User-Id reader (USER_ID_HEADER, extract_user_id)"
affects: [phase-44-tenancy-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BFF proxy identity forwarding: resolve supabase.auth.getUser() server-side, add X-User-Id alongside X-API-Key, 401 on null user — never forward an anonymous/client-supplied id"
    - "Additive non-enforcing FastAPI extractor: a dependency that reads a trusted-transport header (request.headers.get) and never raises, leaving enforcement to a later, explicitly-scoped phase"

key-files:
  created:
    - apps/email-listener/app/presentation/middleware/user_context.py
    - apps/email-listener/tests/presentation/test_user_context.py
  modified:
    - apps/web/src/app/api/chat/stream/route.ts
    - apps/web/src/app/api/chat/regenerate/route.ts
    - apps/web/src/app/api/chat/widget/submit/route.ts
    - apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts

key-decisions:
  - "getUser() call placed after body Zod-validation but before the upstream fetch in all 4 routes, so a null user 401s before any FastAPI call is attempted — no wasted upstream round-trip on an unauthenticated request"
  - "USER_ID_HEADER defined as a module-level constant in user_context.py itself (not settings.py) — mirrors the plan's own guidance and keeps the new, deliberately-non-enforcing surface self-contained"
  - "Verified `uv run pytest tests/presentation/test_user_context.py -x --no-cov` (not the plan's literal command minus --no-cov) — this repo's pytest addopts sets a global --cov-fail-under=80 that any single-file targeted run trips regardless of pass/fail (established precedent: Phase 46-02 used the same --no-cov workaround for the identical reason). All 4 new tests pass; --no-cov only suppresses the unrelated whole-repo coverage gate."

patterns-established:
  - "Any future FastAPI-proxying BFF route must resolve identity via getUser() (never getSession(), never an inbound header) and forward X-User-Id alongside X-API-Key, mirroring these 4 routes"

requirements-completed: [AUTH-04]

# Metrics
duration: ~25min
completed: 2026-07-10
---

# Phase 43 Plan 04: FastAPI Identity Forwarding — X-User-Id BFF Proxy Header Summary

**Server-derived X-User-Id now rides alongside X-API-Key on all 4 FastAPI-proxying BFF routes; FastAPI gained a non-enforcing `extract_user_id` reader for Phase 44 to enforce, with `require_api_key` left byte-for-byte unchanged.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-09T23:56:00Z (approx.)
- **Completed:** 2026-07-10T00:21:42Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- All 4 routes that proxy to FastAPI (`chat/stream`, `chat/regenerate`, `chat/widget/submit`, `knowledge/edges/[edgeId]/promote`) now resolve the acting user server-side via `await createClient()` + `await supabase.auth.getUser()` (never `getSession()`, never an inbound `x-user-id`/`userId` header) and add `"X-User-Id": user.id` to the existing upstream `fetch` headers, alongside the unchanged `"X-API-Key"`.
- Each route returns 401 (`jsonError("Unauthorized", 401)`) on a null user instead of forwarding an anonymous call — the id resolution happens after body Zod-validation but before the upstream `fetch`, so no wasted round-trip on an unauthenticated request.
- The `promote` route's existing `importerId` body field is untouched, exactly as scoped (its client-supplied-tenant-ID remediation is Phase 44's sweep, not this plan's).
- Created `apps/email-listener/app/presentation/middleware/user_context.py`: `USER_ID_HEADER = "X-User-Id"` constant + `async def extract_user_id(request: Request) -> str | None`, returning `request.headers.get(USER_ID_HEADER) or None`. Never raises; docstring documents the trust model explicitly (trusted because it's server-to-server from the authenticated Next.js BFF) and states enforcement is Phase 44 scope.
- Created `apps/email-listener/tests/presentation/test_user_context.py`: 4 tests — id returned when header present, `None` returned (no exception) when absent, and two regression tests proving `require_api_key` is unchanged (valid key still passes, missing/invalid key still 401s).
- `git diff apps/email-listener/app/presentation/middleware/auth.py` confirmed empty — zero modification to the existing API-key gate.
- Full Python test suite (`uv run pytest --no-cov`) ran clean: all dots/skips, zero failures — the plan's documented Phase-46 baseline of 10 pre-existing failures in `tests/test_genui_retrieval_provider.py` has already been resolved by the since-merged 46-02 plan, so this plan's own change introduces zero regressions against an even cleaner baseline than expected.
- `npx tsc --noEmit` in `apps/web`: zero new errors under `api/chat` or `api/knowledge` — confirmed against the full 53-line baseline output, all pre-existing errors confined to `src/app/dev/design/`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Forward server-derived X-User-Id on the 4 FastAPI-proxying BFF routes** - `ea2a90c` (feat)
2. **Task 2: Additive, non-enforcing FastAPI X-User-Id extractor + tests** - `2677dc8` (feat)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `apps/web/src/app/api/chat/stream/route.ts` - Added `getUser()` resolution + `X-User-Id` header + null-user 401 guard
- `apps/web/src/app/api/chat/regenerate/route.ts` - Same pattern
- `apps/web/src/app/api/chat/widget/submit/route.ts` - Same pattern
- `apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts` - Same pattern (body `importerId` untouched, in scope)
- `apps/email-listener/app/presentation/middleware/user_context.py` - New: `USER_ID_HEADER` + non-enforcing `extract_user_id` FastAPI dependency
- `apps/email-listener/tests/presentation/test_user_context.py` - New: 4 tests (present/absent extraction + `require_api_key` regression)

## Decisions Made

- `getUser()` resolution placed after Zod body validation, before the upstream `fetch`, in all 4 routes — consistent ordering across the proxy family, and 401s fast without ever touching FastAPI on an unauthenticated call.
- `USER_ID_HEADER` lives in `user_context.py` (not `settings.py`) as a plain module constant, mirroring the plan's own instruction and keeping the additive, non-enforcing surface self-contained and easy to delete/replace when Phase 44 adds real enforcement.
- Verification for Task 2 used `--no-cov` on top of the plan's literal `uv run pytest tests/presentation/test_user_context.py -x` command — this repo's `pyproject.toml` sets `--cov-fail-under=80` globally, which any single-file targeted pytest run trips regardless of whether its own tests pass (confirmed precedent: Phase 46-02 hit and worked around the identical issue). The 4 new tests pass either way; `--no-cov` only suppresses the unrelated whole-repo coverage percentage gate.

## Deviations from Plan

None - plan executed exactly as written. (See "Decisions Made" above for a verification-command clarification, not a code deviation — no implementation changed to accommodate it.)

## Issues Encountered

- The plan's literal Task 2 verify command (`uv run pytest tests/presentation/test_user_context.py -x`) exits 1 even when all 4 tests pass, because of this repo's global `--cov-fail-under=80` pytest addopts (a pre-existing, out-of-scope repo-wide config, not something this plan's files touch). Re-ran with `--no-cov` (the repo's own established workaround from Phase 46-02) to confirm a true 4/4 pass with exit 0. No code changes were made to address this — it is scope-boundary-excluded (pre-existing pytest config unrelated to this task's files).
- The plan's documented "known pre-existing 10 failures in `tests/test_genui_retrieval_provider.py` (Phase 46 baseline)" no longer applies: the since-merged Phase 46-02 plan (`eca6779`/`47bd81b` area of history) already fixed those failures via a pytest-asyncio migration. The full suite is fully green today, a stricter bar than the plan anticipated — no action needed, noted for traceability only.

## User Setup Required

None - no external service configuration required. `X-User-Id` forwarding relies entirely on the already-configured Supabase session cookies (Plan 01/02) and the existing `EMAIL_LISTENER_URL`/`EMAIL_LISTENER_API_KEY` env vars — no new env vars introduced.

## Next Phase Readiness

- AUTH-04 is code-complete: every FastAPI-proxying BFF route forwards a session-derived, non-spoofable `X-User-Id`; FastAPI has a ready-to-use, non-enforcing reader (`extract_user_id`) for Phase 44 to wire into actual tenancy scoping/rejection logic.
- `require_api_key` and the `X-API-Key` service boundary are provably untouched (empty `git diff`), and the full existing service test suite stays green.
- Phase 44 (tenancy enforcement) can now: (a) start rejecting requests where `extract_user_id` returns `None` on routes that require it, (b) scope DB queries by the forwarded id, and (c) fold in the `promote` route's `importerId` body-field remediation and the attachments route's ownership-check gap (both explicitly named as Phase 44 scope in this plan's threat model and PITFALLS.md).
- No blockers.

---
*Phase: 43-auth-google-oauth-sessions-supabase-auth*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: apps/web/src/app/api/chat/stream/route.ts (X-User-Id present)
- FOUND: apps/web/src/app/api/chat/regenerate/route.ts (X-User-Id present)
- FOUND: apps/web/src/app/api/chat/widget/submit/route.ts (X-User-Id present)
- FOUND: apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts (X-User-Id present)
- FOUND: apps/email-listener/app/presentation/middleware/user_context.py
- FOUND: apps/email-listener/tests/presentation/test_user_context.py
- FOUND: commit ea2a90c (feat(43-04): forward server-derived X-User-Id on FastAPI-proxying BFF routes)
- FOUND: commit 2677dc8 (feat(43-04): add additive non-enforcing FastAPI X-User-Id extractor)
- VERIFIED: `uv run pytest tests/presentation/test_user_context.py -x --no-cov` — 4/4 passed
- VERIFIED: `uv run pytest --no-cov` (full suite) — zero failures
- VERIFIED: `npx tsc --noEmit` (apps/web) — zero new errors outside src/app/dev/design baseline
- VERIFIED: `git diff apps/email-listener/app/presentation/middleware/auth.py` — empty
