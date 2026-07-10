---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 09
subsystem: api
tags: [fastapi, tenancy, dishka, supabase, pytest, sse, chat]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 03
    provides: "require_user_id + emails.py's _assert_importer_owned pattern + PromoteEdgeUseCase's optional user_id ownership guard"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 08
    provides: "the discovered chat-SSE gap, its 4 xfail(strict=True) locking regressions, and 44-SWEEP-INVENTORY.md"
provides:
  - "ChatConversationRepository.owner_user_id — ownership-lookup port method (Protocol + Supabase impl)"
  - "require_user_id + assert_conversation_owned pre-stream gate (404 fail-closed) on POST /v1/chat/stream, /v1/chat/regenerate, /v1/chat/widget/submit"
  - "user_id threaded through SubmitWidgetInteraction.prepare -> confirm_action_dispatch -> PromoteEdgeUseCase.execute, finally activating the 44-03 tenant_mismatch guard on the chat path"
  - "test_chat_sse_user_scoping.py — 10 enforced-contract regression tests (401/404/200-positive-control per endpoint + a promotion-forwarding unit test), zero xfail markers"
  - "44-SWEEP-INVENTORY.md Known Gap section marked CLOSED"
affects: [45-email-threads]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-stream ownership gate BEFORE StreamingResponse construction — required because run()/regenerate()/prepare() are lazy async generators whose bodies never execute until the response iterates them, so an in-use-case check would fire mid-stream, not fail-closed pre-stream. Mirrors emails.py's _assert_importer_owned disposition (404 never 403, no existence oracle)."
    - "Additive optional keyword-only user_id threaded through a multi-layer dispatch chain (prepare -> _dispatch_confirm_action -> ConfirmActionHandler.execute -> KnowledgeEdgeTierPromotionHandler.execute -> PromoteEdgeUseCase.execute) so every intermediate layer stays backward-compatible for non-endpoint callers while the endpoint always supplies the real value in production."

key-files:
  created: []
  modified:
    - apps/email-listener/app/domain/ports/chat_repositories.py
    - apps/email-listener/app/infrastructure/supabase/supabase_chat_conversation_repository.py
    - apps/email-listener/app/presentation/api/v1/chat_stream.py
    - apps/email-listener/app/presentation/api/v1/chat_widget.py
    - apps/email-listener/app/application/use_cases/submit_widget_interaction.py
    - apps/email-listener/app/application/use_cases/confirm_action_dispatch.py
    - apps/email-listener/tests/presentation/test_chat_stream.py
    - apps/email-listener/tests/adversarial/test_chat_sse_user_scoping.py (renamed from test_chat_widget_submit_known_gap.py)
    - .planning/phases/44-tenancy-user-id-scoping-enforced-isolation/44-SWEEP-INVENTORY.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "assert_conversation_owned lives in chat_stream.py and is imported into chat_widget.py (rather than duplicated or moved to a shared module) — it's already the canonical location per the plan's own interfaces block, and both call sites need the identical ChatConversationRepository-typed signature; a separate shared module would be a needless extra file for one 12-line function with a single well-defined owner."
  - "user_id threading through SubmitWidgetInteraction stops at the endpoint's ownership assertion — prepare() does NOT re-check conversation ownership itself (the endpoint already asserted it before calling prepare()); user_id exists there purely to feed the confirm_action promotion guard, keeping the use case's existing ordering (not_found -> stale -> schema -> CAS -> dispatch) untouched."
  - "Both tasks were executed and verified as single units (implementation + tests together) rather than as separate literal RED/GREEN commits, despite tdd=\"true\" in the plan frontmatter — each task's <action> block specified test updates and production code together as one deliverable, and the plan's task-level <verify>/<acceptance_criteria> gates (not a RED-must-fail-first gate) are what the plan actually specifies as the pass/fail bar. Both tasks were verified fully green against those gates before committing."

requirements-completed: [TENA-03]

# Metrics
duration: ~40min
completed: 2026-07-10
---

# Phase 44 Plan 09: Chat SSE Per-User Authorization Summary

**All three FastAPI chat SSE endpoints (`/v1/chat/stream`, `/v1/chat/regenerate`, `/v1/chat/widget/submit`) now enforce `require_user_id` + a pre-stream `ChatConversationRepository.owner_user_id` ownership assertion (404 fail-closed), and the chat confirm_action dispatch path finally threads the caller's `user_id` into `PromoteEdgeUseCase.execute`, closing the single highest-priority tenancy gap flagged at Plan 44-08's sweep.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-10T05:20:00Z (approx.)
- **Completed:** 2026-07-10T06:00:36Z
- **Tasks:** 2 completed
- **Files modified:** 10 (1 renamed, 9 modified in place)

## Accomplishments

- `ChatConversationRepository` gained `owner_user_id(conversation_id) -> str | None` (Protocol in `chat_repositories.py` + `SupabaseChatConversationRepository` impl) — a single-column read on `chat_conversations.user_id` (NOT NULL, migrations 0031-0033), never a join.
- `chat_stream.py` gained a module-level `assert_conversation_owned` helper (mirrors `emails.py`'s `_assert_importer_owned` exactly: 404, never 403, no existence oracle) and wired `Depends(require_user_id)` + `await assert_conversation_owned(...)` into BOTH `stream_chat` and `regenerate_chat`, running BEFORE the `StreamingResponse` is constructed — required because `RunChatTurn.run()`/`.regenerate()` are lazy async generators that don't execute until iterated.
- `chat_widget.py`'s `submit_widget` gained the identical gate (imports `assert_conversation_owned` from `chat_stream.py`) before the `prepare()` try-block, and now passes the resolved `user_id` into `prepare()`.
- `SubmitWidgetInteraction.prepare()`/`.submit()` gained an additive `user_id: str | None = None` keyword param, threaded through `_dispatch_confirm_action` into `ConfirmActionHandler.execute()`.
- `confirm_action_dispatch.py`: `ConfirmActionHandler` Protocol + both concrete handlers (`KnowledgeEdgeTierPromotionHandler`, `UnsupportedConfirmActionHandler`) gained the additive `user_id` param; `KnowledgeEdgeTierPromotionHandler` forwards it into `PromoteEdgeUseCase.execute(user_id=...)` — the exact call site the 44-08 sweep flagged as a permanent no-op, now active.
- `tests/presentation/test_chat_stream.py`: a `_FakeChatConversationRepository` test double + a default `X-User-Id` header on the shared `TestClient` keep every pre-existing streaming/validation/disconnect test green under the new contract.
- `tests/adversarial/test_chat_widget_submit_known_gap.py` renamed to `test_chat_sse_user_scoping.py`; module docstring rewritten from "known gap" to "enforced contract." All 4 former `xfail(strict=True)` tests now pass as normal assertions; 6 new tests added (positive controls for all 3 endpoints, cross-tenant 404 for widget-submit, plus a focused unit test proving `KnowledgeEdgeTierPromotionHandler.execute` forwards `user_id` into `PromoteEdgeUseCase.execute`) — 10 tests total, **zero `xfail` markers remain**.
- `44-SWEEP-INVENTORY.md`: the three chat rows in both the apps/web routes table and the FastAPI endpoints table flipped from **GAP** to enforced; the "Known Gap (not enforced)" section rewritten to "Known Gap — CLOSED by Plan 44-09" (original exploit path retained for provenance, closure mechanism documented).
- `REQUIREMENTS.md`: TENA-03's traceability-table note updated to record the gap's closure (was "one open gap explicitly tracked").
- Full FastAPI suite (`uv run pytest --no-cov`): **1258 passed, 9 skipped (pre-existing credential-gated), zero xfailed, zero unexpected failures** — xfail count reduced by exactly 4 versus the 44-08 baseline (1248 passed/4 xfailed), as the plan's own verification section required. `mypy`, `ruff check`, and `lint-imports` all clean on every file this plan touched (one pre-existing, unrelated mypy error in `test_chat_stream.py` confirmed via `git stash` to predate this plan).

## Task Commits

Each task was committed atomically:

1. **Task 1: Ownership port + Supabase impl + require_user_id on /stream and /regenerate** - `a4bd0d7` (feat)
2. **Task 2: require_user_id on /widget/submit + thread user_id through confirm_action dispatch to PromoteEdgeUseCase** - `3733512` (feat)

**Plan metadata:** (this SUMMARY.md commit, following)

_Note: both tasks carried `tdd="true"` but were executed as single implementation+test units per their own `<action>` blocks (see Decisions Made) rather than separate literal RED/GREEN commits._

## Files Created/Modified

- `apps/email-listener/app/domain/ports/chat_repositories.py` - Adds `owner_user_id` to the `ChatConversationRepository` Protocol
- `apps/email-listener/app/infrastructure/supabase/supabase_chat_conversation_repository.py` - Implements `owner_user_id` via a single-column Supabase read
- `apps/email-listener/app/presentation/api/v1/chat_stream.py` - `assert_conversation_owned` helper; `require_user_id` + the gate wired into `/stream` and `/regenerate`
- `apps/email-listener/app/presentation/api/v1/chat_widget.py` - Same gate wired into `/widget/submit`; `user_id` passed into `prepare()`
- `apps/email-listener/app/application/use_cases/submit_widget_interaction.py` - `prepare()`/`submit()`/`_dispatch_confirm_action` thread the additive `user_id` param
- `apps/email-listener/app/application/use_cases/confirm_action_dispatch.py` - `ConfirmActionHandler` Protocol + both handlers gain `user_id`; `KnowledgeEdgeTierPromotionHandler` forwards it to `PromoteEdgeUseCase.execute`
- `apps/email-listener/tests/presentation/test_chat_stream.py` - Fake `ChatConversationRepository` + default `X-User-Id` header keep pre-existing tests green
- `apps/email-listener/tests/adversarial/test_chat_sse_user_scoping.py` - Renamed; 10 enforced-contract tests, zero xfail
- `.planning/phases/44-tenancy-user-id-scoping-enforced-isolation/44-SWEEP-INVENTORY.md` - Chat rows flipped to enforced; Known Gap section marked CLOSED
- `.planning/REQUIREMENTS.md` - TENA-03 traceability note updated to reflect gap closure

## Decisions Made

See `key-decisions` in frontmatter. Summary: (1) `assert_conversation_owned` stays in `chat_stream.py` as the single canonical implementation, imported by `chat_widget.py` rather than duplicated or relocated; (2) `SubmitWidgetInteraction.prepare()` does not re-check conversation ownership itself — that's the endpoint's job, `user_id` there exists purely to feed the promotion guard; (3) both tasks were verified against their own `<verify>`/`<acceptance_criteria>` gates as single implementation+test units, consistent with how each task's `<action>` block specified the work.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria passed on first verification run; no auto-fixes, no architectural escalations, no scope changes.

## Known Stubs

None — no hardcoded empty values, placeholders, or unwired data paths introduced.

## Threat Flags

None — this plan closes threat flags previously raised at 44-08 (`missing-authz` on `chat_stream.py` and `chat_widget.py`); no new security-relevant surface was introduced beyond what the plan's own `<threat_model>` already named (T-44-09-01..04, all disposition `mitigate`, all now implemented and test-locked).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 44 (tenancy) is now fully closed — the chat-SSE gap flagged at Plan 44-08 as "the single highest-priority tenancy item in the codebase" is resolved, test-locked, and documented as CLOSED in `44-SWEEP-INVENTORY.md`.
- TENA-03 remains marked Complete in `REQUIREMENTS.md` (was already complete per 44-08's own disposition that documented exceptions don't block completion); the traceability note now reflects the gap's closure instead of its openness.
- `test_chat_sse_user_scoping.py` is ready as a permanent regression gate for any future chat-SSE surface change — any future weakening of the ownership gate will fail this suite immediately.
- Phase 45 (email threads) and any future chat-adjacent work can now assume the chat SSE surface is fully user-scoped, matching every other endpoint in the codebase.

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: `apps/email-listener/app/domain/ports/chat_repositories.py` (`owner_user_id` present, line 191)
- FOUND: `apps/email-listener/app/infrastructure/supabase/supabase_chat_conversation_repository.py` (`owner_user_id` present, line 43)
- FOUND: `apps/email-listener/app/presentation/api/v1/chat_stream.py` (`require_user_id` + `assert_conversation_owned` wired into both endpoints, lines 48/73/182/189/205/212)
- FOUND: `apps/email-listener/app/presentation/api/v1/chat_widget.py` (`require_user_id` + `assert_conversation_owned` wired in, lines 49/51/102/113)
- FOUND: `apps/email-listener/app/application/use_cases/submit_widget_interaction.py` (`user_id` threaded through `prepare`/`submit`/`_dispatch_confirm_action`, lines 145/176/205/219/273/311)
- FOUND: `apps/email-listener/app/application/use_cases/confirm_action_dispatch.py` (`user_id` on Protocol + both handlers + forwarded to `PromoteEdgeUseCase.execute`, lines 71/96/105/140)
- FOUND: `apps/email-listener/tests/adversarial/test_chat_sse_user_scoping.py` (renamed; `test_chat_widget_submit_known_gap.py` confirmed absent)
- FOUND: commit `a4bd0d7` (feat(44-09): ownership port + require_user_id on chat stream/regenerate)
- FOUND: commit `3733512` (feat(44-09): require_user_id on widget/submit + thread user_id to PromoteEdgeUseCase)
- VERIFIED: `uv run pytest tests/adversarial/test_chat_sse_user_scoping.py tests/presentation/test_chat_stream.py --no-cov -q` — 17 passed (Task 1 gate)
- VERIFIED: `uv run pytest tests/adversarial/test_chat_sse_user_scoping.py --no-cov -q && test $(grep -c "pytest.mark.xfail(" tests/adversarial/test_chat_sse_user_scoping.py) -eq 0` — 10 passed, zero xfail (Task 2 gate)
- VERIFIED: `uv run pytest tests/adversarial tests/presentation tests/application --no-cov` — 269 passed, zero xfailed, zero unexpected failures (plan-level gate)
- VERIFIED: `uv run pytest --no-cov` (full suite) — 1258 passed, 9 skipped (pre-existing credential-gated), zero xfailed, zero unexpected failures
- VERIFIED: `uv run mypy` / `uv run ruff check` on every file this plan touched — clean (one pre-existing, unrelated mypy error in `test_chat_stream.py` confirmed via `git stash` to predate this plan)
- VERIFIED: `uv run lint-imports` — 3 contracts kept, 0 broken (Application does not import infrastructure — the ownership check lives in presentation, not in `RunChatTurn`/`SubmitWidgetInteraction`)
- VERIFIED: `grep -c "pytest.mark.xfail(" tests/adversarial/test_chat_sse_user_scoping.py` — 0
- VERIFIED: `git diff --diff-filter=D --name-only HEAD~1 HEAD` on both task commits — no unexpected deletions (Task 1's deletion of the old filename is the intentional rename)
