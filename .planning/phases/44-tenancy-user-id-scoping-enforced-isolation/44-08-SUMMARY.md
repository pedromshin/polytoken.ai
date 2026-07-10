---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 08
subsystem: api
tags: [trpc, fastapi, tenancy, adversarial-testing, vitest, pytest, security-gate]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 03
    provides: "FastAPI require_user_id + ImporterResolver.list_importer_ids_for_user + PromoteEdgeUseCase's optional user-ownership guard"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 05
    provides: "emailsRouter fully guarded (packages/api-client/src/router/_ownership.ts)"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 06
    provides: "entities/entityTypes/knowledge routers fully guarded"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 07
    provides: "chat/genui routers guarded + attachments route IDOR closed"
provides:
  - "cross-tenant-adversarial.test.ts — the tRPC/web acceptance-gate suite: two real users, every router (emails/entities/entityTypes/knowledge/chat/genui), reads AND writes, sessionless UNAUTHORIZED + cross-tenant NOT_FOUND/FORBIDDEN + positive controls"
  - "apps/web attachments cross-tenant.test.ts — dedicated 404 (non-owner) / 200 (owner) case"
  - "apps/email-listener tests/adversarial/test_cross_tenant.py — the FastAPI acceptance-gate suite: emails list/detail/download/reprocess + knowledge-promote proxy, denied for user B, 401 without X-User-Id, positive control for user A"
  - "44-SWEEP-INVENTORY.md — every tRPC procedure, FastAPI user-scoped endpoint, and apps/web route enumerated with scoping mechanism + locking test"
  - "tests/adversarial/test_chat_widget_submit_known_gap.py — 4 xfail(strict=True) regressions locking a newly-discovered, unclosed gap on the FastAPI chat SSE surface (stream/regenerate/widget-submit)"
  - "TENA-03 marked complete in REQUIREMENTS.md"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adversarial suite reuses the exact module-boundary-mock idiom (vi.mock('@polytoken/db/ownership')) established by every 44-05/06/07 per-router suite, but drives ALL SIX routers from ONE file with two real user ids, exercising session-gate + cross-tenant-deny + positive-control per router in a single adversarial pass rather than per-router isolation"
    - "xfail(strict=True) as a 'proven, tracked, non-blocking' pattern for a discovered-but-out-of-scope security gap: the test encodes the DESIRED secure contract, fails today (proving the gap is real), is suppressed so the suite stays green, and flips to a hard failure the moment someone's fix makes it pass unexpectedly — forcing deliberate marker removal instead of a silent regression risk"

key-files:
  created:
    - packages/api-client/src/router/__tests__/cross-tenant-adversarial.test.ts
    - apps/web/src/app/api/attachments/__tests__/cross-tenant.test.ts
    - apps/email-listener/tests/adversarial/__init__.py
    - apps/email-listener/tests/adversarial/test_cross_tenant.py
    - apps/email-listener/tests/adversarial/test_chat_widget_submit_known_gap.py
    - .planning/phases/44-tenancy-user-id-scoping-enforced-isolation/44-SWEEP-INVENTORY.md
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "knowledge router has NO tRPC write mutation — the only WRITE surface for knowledge_node_edges is the FastAPI promote endpoint, never proxied through packages/api-client. The tRPC adversarial suite therefore covers knowledge with two READ surfaces (byId + expandNode); the WRITE surface is covered by the FastAPI suite's promote test instead. Documented explicitly in both test-file docstrings and the inventory rather than forcing a nonexistent tRPC write test."
  - "Discovered during the sweep (not named in this plan's task list): POST /v1/chat/stream, /v1/chat/regenerate, and /v1/chat/widget/submit have ZERO require_user_id enforcement — the Next.js BFF forwards a server-verified X-User-Id on all three, but none of the FastAPI endpoints ever read it or check conversation ownership. This is broader than the originally carried-forward item (chat confirm_action -> PromoteEdgeUseCase missing user_id) — it's the entire chat SSE transport layer. NOT fixed in this plan (closing it properly requires extending ChatConversationRepository with an ownership-lookup method and threading user_id through RunChatTurn.run()/.regenerate() and SubmitWidgetInteraction.prepare(), a 5+ file change across presentation/application/domain layers touching the core, heavily-tested chat turn engine — Rule 4 architectural scale, not a same-plan patch). Locked with 4 xfail(strict=True) regressions + a dedicated 'Known Gap' section in 44-SWEEP-INVENTORY.md, per this plan's own explicit instruction that this outcome ('document as an explicit accepted gap') is sanctioned, not merely tolerated."
  - "TENA-03 marked COMPLETE despite the known gap: the requirement's own text names exactly two must-fix items (the attachments download route + the promote proxy), both fully closed and adversarially locked; the adversarial acceptance-gate suites this plan built are green; and Task 3's own acceptance criteria explicitly allow 'any exception is flagged as an open gap' rather than mandating zero gaps. The gap is prominently disclosed, not silently omitted."

requirements-completed: [TENA-03]

# Metrics
duration: ~95min
completed: 2026-07-10
---

# Phase 44 Plan 08: Adversarial Cross-Tenant Acceptance Gate Summary

**Two-user adversarial suites (26 tRPC/web tests + 2 attachments tests + 16 FastAPI tests, all green) prove no cross-tenant read/write reaches another user's data across every router/endpoint this phase swept, backed by a full sweep inventory — and the sweep itself surfaced a real, previously-undiscovered gap on the FastAPI chat SSE surface, now locked by 4 strict-xfail regressions rather than silently missed.**

## Performance

- **Duration:** ~95 min
- **Started:** 2026-07-10T03:35:00Z (approx.)
- **Completed:** 2026-07-10T05:10:00Z
- **Tasks:** 3 (plus one deviation-driven addition: the known-gap regression file)
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- `cross-tenant-adversarial.test.ts` (26 tests): seeds users A and B; drives the real `appRouter` as user B against user A's owned rows across `emails`/`entities`/`entityTypes`/`knowledge`/`chat`/`genui` — one cross-tenant READ + one cross-tenant WRITE (where a write procedure exists) per router, sessionless calls asserting `UNAUTHORIZED`, and a positive control per router proving user B still reaches user B's own data. `genui.generate` is asserted auth-gated-only (never ownership-denied) — the exact-match generation cache staying deliberately cross-tenant per SC5.
- `apps/web/.../attachments/__tests__/cross-tenant.test.ts` (2 tests): user B → 404, user A → 200, isolated as the plan's explicitly-required named case.
- `apps/email-listener/tests/adversarial/test_cross_tenant.py` (16 tests): seeds importer A (owned by user A) with an email, attachment, and knowledge edge; drives every user-scoped FastAPI endpoint as user B (list/detail/download/reprocess all deny, `POST .../promote` rejects even when B supplies A's REAL importer_id in the body — the pre-44-03 exploit path); every endpoint 401s with no `X-User-Id`; a positive control proves user A reaches user A's own data on every surface.
- `44-SWEEP-INVENTORY.md`: every tRPC procedure (34), FastAPI user-scoped endpoint (8), and apps/web route (6) enumerated with its scoping mechanism, auth requirement, and locking test file — including the `genui` generation-cache exception (SC5, deliberately unscoped) and a dedicated, detailed "Known Gap" section for the newly-discovered chat SSE issue.
- **Deviation (Rule 4 — flagged, not silently fixed):** while enumerating "every route/procedure" for the inventory, discovered that `POST /v1/chat/stream`, `POST /v1/chat/regenerate`, and `POST /v1/chat/widget/submit` have zero `require_user_id` enforcement — broader than the narrowly-scoped chat `confirm_action` item carried forward from Plans 03/07. Locked with 4 new `xfail(strict=True)` regressions in `test_chat_widget_submit_known_gap.py` (encoding the desired 401-without-`X-User-Id` contract; they fail today, proving the gap is real, and will hard-fail as an unexpected pass the moment a fix lands, forcing deliberate marker removal) rather than attempting a rushed multi-layer production fix inside this acceptance-gate plan.
- TENA-03 marked complete in `REQUIREMENTS.md` (both the checklist line and the traceability table), per the requirement's own text (both named must-fix items — attachments route + promote proxy — are closed and locked) and this plan's own Task 3 acceptance criteria (documented exceptions are explicitly sanctioned, not blocking).

## Task Commits

Each task was committed atomically:

1. **Task 1: tRPC + web cross-tenant adversarial suite** - `1d44929` (feat)
2. **Task 2: FastAPI cross-tenant adversarial suite** - `4ece6fc` (feat)
3. **Task 3: Sweep inventory doc + full-suite confirmation** (this commit, following)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `packages/api-client/src/router/__tests__/cross-tenant-adversarial.test.ts` - New: 26 tests, the tRPC/web acceptance-gate suite
- `apps/web/src/app/api/attachments/__tests__/cross-tenant.test.ts` - New: 2 tests, dedicated attachments cross-tenant case
- `apps/email-listener/tests/adversarial/__init__.py` - New: package init for the adversarial test package
- `apps/email-listener/tests/adversarial/test_cross_tenant.py` - New: 16 tests, the FastAPI acceptance-gate suite
- `apps/email-listener/tests/adversarial/test_chat_widget_submit_known_gap.py` - New: 4 `xfail(strict=True)` regressions locking the discovered chat-SSE gap
- `.planning/phases/44-tenancy-user-id-scoping-enforced-isolation/44-SWEEP-INVENTORY.md` - New: full route/procedure inventory + Known Gap section
- `.planning/REQUIREMENTS.md` - TENA-03 marked `[x]` complete, traceability table updated

## Decisions Made

See `key-decisions` in frontmatter. Summary: (1) the knowledge router's tRPC write coverage is legitimately absent (no such procedure exists — the only write is the FastAPI promote endpoint, covered by Task 2); (2) the chat SSE surface gap discovered mid-sweep is broader than the originally-flagged item and was locked with strict-xfail regressions + a detailed inventory section rather than attempted as a same-plan fix (Rule 4 — architectural scale, dedicated follow-up plan needed); (3) TENA-03 is marked complete because its own text's named must-fix items are done and green, with the newly-found gap prominently, not silently, disclosed.

## Deviations from Plan

### Auto-fixed Issues

None — every test passed on first run across all three tasks (26/26, 2/2, 16/16), zero fix-iteration cycles needed.

### Flagged (Rule 4 — architectural scale, not auto-fixed)

**1. [Rule 4 - Architectural] Discovered: FastAPI chat SSE surface (stream/regenerate/widget-submit) has no per-user enforcement**
- **Found during:** Task 3, while enumerating "every route/procedure" for the sweep inventory
- **Issue:** `POST /v1/chat/stream`, `POST /v1/chat/regenerate`, `POST /v1/chat/widget/submit` never read the `X-User-Id` header the Next.js BFF already forwards on every request, and never verify the caller owns the client-supplied `conversation_id`. This is broader than the narrow, previously-flagged "chat confirm_action promotion dispatch missing user_id" item — the whole chat turn engine (`RunChatTurn.run()`/`.regenerate()`) and the widget submit use case (`SubmitWidgetInteraction.prepare()`) are affected, not just the promotion sub-path.
- **Why not auto-fixed:** closing this properly requires extending `ChatConversationRepository` (currently `touch()`-only) with an ownership-lookup method and threading `user_id` through the core chat turn engine across 5+ files in the presentation/application/domain layers — a properly-scoped follow-up plan, not a patch bolted onto this acceptance-gate plan, per the deviation rules' own Rule 4 guidance and this plan's explicit written instruction that documenting this class of item as an open gap is a sanctioned outcome.
- **Mitigation applied instead:** 4 `xfail(strict=True)` regression tests in `test_chat_widget_submit_known_gap.py` encode the desired secure contract (401 without `X-User-Id`, matching every other endpoint in the inventory) and fail today, proving the gap is real rather than hypothetical; `strict=True` means an accidental/incidental fix would surface as a hard CI failure requiring deliberate marker removal. Full technical detail (exploit path, recommended fix shape, blast radius) recorded in `44-SWEEP-INVENTORY.md`'s "Known Gap" section.
- **Files created:** `apps/email-listener/tests/adversarial/test_chat_widget_submit_known_gap.py`
- **Verification:** `uv run pytest tests/adversarial/test_chat_widget_submit_known_gap.py --no-cov` → 4 xfailed (exactly as expected); full suite confirms zero unexpected failures.
- **Committed in:** (this Task 3 commit)

---

**Total deviations:** 1 flagged (Rule 4 — architectural-scale gap, deliberately not auto-fixed, locked and documented instead).
**Impact on plan:** No behavioral change to production code. The flagged item is a genuine, disclosed security gap requiring a dedicated follow-up plan — see "Next Phase Readiness" below.

## Known Stubs

None — no hardcoded empty values, placeholders, or unwired data paths introduced.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: missing-authz | `apps/email-listener/app/presentation/api/v1/chat_stream.py` | `POST /v1/chat/stream` + `POST /v1/chat/regenerate` accept any authenticated caller's `conversation_id` with zero ownership check — cross-tenant read (conversation context) + write (message injection). See 44-SWEEP-INVENTORY.md "Known Gap". |
| threat_flag: missing-authz | `apps/email-listener/app/presentation/api/v1/chat_widget.py` | `POST /v1/chat/widget/submit` accepts any authenticated caller's `conversation_id`/`interaction_id` with zero ownership check; the `confirm_action` dispatch path additionally calls `PromoteEdgeUseCase.execute()` without `user_id`, so its own optional guard never runs. See 44-SWEEP-INVENTORY.md "Known Gap". |

## Issues Encountered

None beyond the flagged deviation above (fully resolved via the xfail-locking approach).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 44 is now fully executed** (8/8 plans, TENA-03/TENA-04/TENA-01/TENA-02 all complete) — the tenancy milestone segment of v1.7 is done.
- **Urgent recommendation, not a phase-44 blocker:** open a dedicated fast-follow plan to close the chat SSE surface gap (`POST /v1/chat/stream`, `/v1/chat/regenerate`, `/v1/chat/widget/submit`) before any production traffic relies on multi-user chat isolation — this is the single highest-priority tenancy item in the codebase today. Recommended shape: extend `ChatConversationRepository` with an ownership-lookup method, add `Depends(require_user_id)` to all three endpoints, thread `user_id` through `RunChatTurn.run()`/`.regenerate()` and `SubmitWidgetInteraction.prepare()` (the latter through `_dispatch_confirm_action` → `PromoteEdgeUseCase.execute(user_id=...)`), and delete the 4 `xfail` markers in `test_chat_widget_submit_known_gap.py` as part of that change (they will hard-fail as unexpected passes if the fix lands without their removal).
- All three adversarial/inventory artifacts (`cross-tenant-adversarial.test.ts`, `test_cross_tenant.py`, `44-SWEEP-INVENTORY.md`) are ready as the baseline regression gate for Phase 45 (email threads) and any future tenancy-relevant work.

## Self-Check: PASSED

- FOUND: `packages/api-client/src/router/__tests__/cross-tenant-adversarial.test.ts`
- FOUND: `apps/web/src/app/api/attachments/__tests__/cross-tenant.test.ts`
- FOUND: `apps/email-listener/tests/adversarial/__init__.py`
- FOUND: `apps/email-listener/tests/adversarial/test_cross_tenant.py`
- FOUND: `apps/email-listener/tests/adversarial/test_chat_widget_submit_known_gap.py`
- FOUND: `.planning/phases/44-tenancy-user-id-scoping-enforced-isolation/44-SWEEP-INVENTORY.md`
- FOUND: commit `1d44929` (feat(44-08): tRPC + web cross-tenant adversarial suite)
- FOUND: commit `4ece6fc` (feat(44-08): FastAPI cross-tenant adversarial suite)
- Re-ran plan-level `<verification>`:
  - `cd packages/api-client && npx vitest run` → 27 files / 327 tests, all green
  - `cd apps/web && npx vitest run` → 40 files / 294 tests, all green
  - `cd apps/email-listener && uv run pytest tests/adversarial tests/presentation/api/v1 tests/application --no-cov` → 230 passed, 4 xfailed, zero unexpected failures
  - `cd apps/email-listener && uv run pytest --no-cov` (full suite) → 1248 passed, 9 skipped, 4 xfailed, zero unexpected failures
  - `npx tsc --noEmit` in `packages/api-client` and `apps/web` → zero errors in both
  - `grep -c "|"` on `44-SWEEP-INVENTORY.md` → 83 (well above the 40-line minimum)
- `git diff --diff-filter=D --name-only` on both prior task commits → no unexpected deletions
- `gsd-sdk query requirements.mark-complete TENA-03` → confirmed already complete (idempotent with the manual edit)

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
