---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 07
subsystem: api
tags: [trpc, tenancy, ownership, drizzle, vitest, chat-router, genui-router, nextjs-route]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 01
    provides: "chat_conversations.user_id / chat_cost_ledger.user_id NOT NULL, ui_spec_templates.importer_id (deliberately unscoped cache), email_attachments.importer_id"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 02
    provides: "@polytoken/db/ownership — assertConversationOwnership + assertImporterOwnership + userOwnedImporterIds + OwnershipError"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 05
    provides: "packages/api-client/src/router/_ownership.ts — assertOwnedOrNotFound (reused, not re-derived)"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 06
    provides: "packages/api-client/src/router/_scope.ts — resolveListScope (reused for genui.historyList)"
provides:
  - "chatRouter fully on protectedProcedure — direct chat_conversations.user_id scoping (create/list) + assertConversationOwnership gate on every conversationId-keyed procedure (rename/delete/setModel/getHistory/sessionCost/recordBrowserTurn/getCanvasLayout/saveCanvasLayout/getWidgetInteractions)"
  - "genui.generate/codeIslandGenerate auth-gated (protectedProcedure), generation cache left deliberately cross-tenant"
  - "genui.historyList user-scoped via owned-importer fan-out + merge (closes backlog 999.1 — never forwards importer_id omitted)"
  - "genui.historyById ownership-gated via a direct Drizzle ui_spec_templates.importer_id lookup (FastAPI detail view carries no importer_id)"
  - "apps/web attachments download route (GET /api/attachments/[id]) — session + ownership gated, closing a ZERO-scoping IDOR"
  - "packages/api-client typecheck fully clean (the 2 pre-existing chat_conversations/chat_cost_ledger user_id insert errors flagged since 44-02 are fixed)"
affects: [44-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-user_id scoping recipe (vs. importer-anchored): write user_id = ctx.user.id on create; filter eq(table.userId, ctx.user.id) on list; assertConversationOwnership BEFORE every id-addressed read/write — mirrors the importer-anchored assertImporterOwnership recipe from 44-05/44-06 but resolves against the DIRECT column instead of a join"
    - "Cross-boundary ownership check via a parallel Drizzle lookup when the proxied FastAPI response lacks the scoping column (genui.historyById) — ctx.db is used alongside the FastAPI fetch, not instead of it, to close a gap the upstream response shape cannot express without a Python change"
    - "Router-level 'prove the wiring' tests capture the query-builder argument passed to ctx.db.where()/insert().values() and assert structural equality against independently-constructed drizzle-orm eq()/and() calls (chat-user-scoping.test.ts Test 12) — used where there is no separate pure resolveListScope-style gate to test in isolation (a plain direct-column filter, not an ownership-helper call)"

key-files:
  created:
    - packages/api-client/src/router/chat/chat-user-scoping.test.ts
    - apps/web/src/app/api/attachments/__tests__/route.test.ts
  modified:
    - packages/api-client/src/router/chat/conversations.ts
    - packages/api-client/src/router/chat/history.ts
    - packages/api-client/src/router/chat/cost.ts
    - packages/api-client/src/router/chat/browser-turn.ts
    - packages/api-client/src/router/chat/canvas.ts
    - packages/api-client/src/router/chat/widget-interactions.ts
    - packages/api-client/src/router/chat/__tests__/browser-turn.test.ts
    - packages/api-client/src/router/genui/generate.ts
    - packages/api-client/src/router/genui/code-island.ts
    - packages/api-client/src/router/genui/history.ts
    - packages/api-client/src/router/genui/__tests__/generate.test.ts
    - packages/api-client/src/router/genui/__tests__/code-island.test.ts
    - packages/api-client/src/router/genui/__tests__/history.test.ts
    - apps/web/src/app/api/attachments/[id]/route.ts

key-decisions:
  - "genui.historyList fans out ONE FastAPI call per owned importer (FastAPI's importer_id filter is single-valued) rather than requiring a Python change to accept a list — merges + re-sorts client-side by createdAt desc, then slices to the requested limit. Correct for the common single-importer-per-user case; multi-importer pagination (offset) across fanned-out calls is a documented best-effort approximation, not exact cross-page ordering."
  - "genui.historyById's ownership check reads packages/db's ui_spec_templates.importer_id directly via ctx.db (bypassing FastAPI) because the FastAPI HistoryDetailView/TemplateDetail response shape does not carry importer_id at all — adding it would require a Python change outside this plan's file list (files_modified is TS-only)."
  - "A NULL-importer ui_spec_templates row is NOT_FOUND from genui.historyById (not treated as a system-default the way entity-types' NULL-importer rows are) — per the plan's own interfaces text ('a NULL-importer event is not a browsable history row for a user'); this is a browsing-surface decision only, the generation CACHE itself stays cross-tenant regardless of this row's importer_id."
  - "chat.listConversations keeps importerId as an optional NARROWING filter under the primary user_id ownership scope (and(eq(userId,...), importerId?eq(...):undefined)) rather than dropping it, preserving the pre-existing D-11 per-importer rail recency list behavior while making user_id the actual security boundary."

patterns-established:
  - "The chat-router direct-user_id recipe (this plan) is now the third scoping shape alongside 44-05/44-06's importer-anchored assertImporterOwnership/assertEmailOwnership/assertComponentOwnership recipe — both funnel through the same assertOwnedOrNotFound(OwnershipError -> TRPCError NOT_FOUND) wrapper."

requirements-completed: []  # TENA-03 spans Plans 02/03/05/06/07/08 — completes ONLY at Plan 44-08's adversarial gate (per 44-02's correction; explicitly out of this plan's authority, per this plan's own execution instructions)

# Metrics
duration: ~60min
completed: 2026-07-10
---

# Phase 44 Plan 07: Chat + GenUI Router Sweep + Attachments IDOR Close Summary

**Chat router moved onto direct `chat_conversations.user_id` scoping (not importer-anchored), genui auth-gated with its generation cache deliberately left cross-tenant while `genui.historyList`/`historyById` became owned-importer-scoped (closing backlog 999.1), and the previously completely unscoped attachments download route gained a session + `assertImporterOwnership` gate — closing a live IDOR.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-07-10T04:10:00Z (approx.)
- **Completed:** 2026-07-10T04:29:00Z
- **Tasks:** 3
- **Files modified:** 16 (2 created, 14 modified)

## Accomplishments

- All 11 chat procedures (`conversations.ts` create/list/rename/delete/setModel, `history.ts` getHistory, `cost.ts` sessionCost, `browser-turn.ts` recordBrowserTurn, `canvas.ts` get/saveCanvasLayout, `widget-interactions.ts` getWidgetInteractions) moved to `protectedProcedure`. `createConversation` writes `user_id = ctx.user.id`; `listConversations` filters `eq(chat_conversations.user_id, ctx.user.id)` (importerId now an owned-scope-nested narrowing filter, not the security boundary). Every conversationId-keyed procedure calls `assertConversationOwnership` via the shared `assertOwnedOrNotFound` wrapper BEFORE any further `ctx.db` access — fail-closed `NOT_FOUND` for a foreign conversation, proven by tests that never even provide a working fake DB method past the ownership gate.
- Fixed the pre-existing `packages/api-client` typecheck break flagged since 44-02: `chat_cost_ledger.user_id` (Plan 01 `NOT NULL`) is now written from `ctx.user.id` in `recordBrowserTurn`'s `buildBrowserTurnRows` — `BrowserTurnRowContext` gained a `userId` field, threaded through from `ctx.user.id`.
- `genui.generate` / `genui.codeIslandGenerate` moved to `protectedProcedure` — auth-gate only, exactly per the plan's "cache stays deliberately cross-tenant" instruction; no ownership scoping added to either.
- `genui.historyList`: derives the caller's owned-importer scope via `userOwnedImporterIds` + the shared `resolveListScope` helper (reused from 44-06's `_scope.ts`), then fans out one FastAPI `GET /v1/genui/history` call per owned importer (FastAPI's `importer_id` filter is single-valued), merges the pages, and re-sorts by `createdAt` desc before slicing to the requested limit. `importer_id` is **never** omitted from a forwarded call — closing the exact backlog-999.1 gap ("all importers' rows").
- `genui.historyById`: after the FastAPI fetch resolves a real row, a **parallel Drizzle lookup** on `ui_spec_templates.importer_id` (the FastAPI detail view does not carry this field) checks it against the caller's owned set — `NOT_FOUND` for both a foreign importer and a `NULL` importer (a system-level generation is not user-browsable). This ownership check runs before the existing D-17 re-validation/fallback logic, so even the malformed-response fallback path never leaks a non-owned row's metadata.
- `apps/web`'s attachments download route (`GET /api/attachments/[id]`) — previously **zero** tenant scoping — now resolves the session via `~/lib/supabase/server`'s `getUser()` (401 on null, mirroring the 43-04 promote route, never `getSession()`), widens its DB select to also fetch `importerId`, and calls `assertImporterOwnership` before minting any Supabase signed URL. `OwnershipError` and "row not found" both map to the identical 404 — fail-closed, no existence oracle.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scope the chat router on chat_conversations.user_id** - `0397deb` (feat)
2. **Task 2: Auth-gate genui + user-scope genui history (closes 999.1)** - `d46be1b` (feat)
3. **Task 3: Ownership-gate the attachments download route** - `b954f54` (fix)

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/api-client/src/router/chat/conversations.ts` - create/list/rename/delete/setModel on protectedProcedure + direct user_id scoping
- `packages/api-client/src/router/chat/history.ts` - getHistory guarded by assertConversationOwnership
- `packages/api-client/src/router/chat/cost.ts` - sessionCost guarded by assertConversationOwnership
- `packages/api-client/src/router/chat/browser-turn.ts` - recordBrowserTurn guarded; costLedgerRow now carries userId
- `packages/api-client/src/router/chat/canvas.ts` - get/saveCanvasLayout guarded by assertConversationOwnership
- `packages/api-client/src/router/chat/widget-interactions.ts` - getWidgetInteractions guarded
- `packages/api-client/src/router/chat/chat-user-scoping.test.ts` - New: 24 tests (session gate x11, direct-scoping capture proofs x2, ownership-rejection x9, gate-resolves-for-owner x2)
- `packages/api-client/src/router/chat/__tests__/browser-turn.test.ts` - Fixed (Rule 3): BASE_CTX gains the new required `userId` field
- `packages/api-client/src/router/genui/generate.ts` - protectedProcedure, auth-gate only
- `packages/api-client/src/router/genui/code-island.ts` - protectedProcedure, auth-gate only
- `packages/api-client/src/router/genui/history.ts` - historyList fan-out+merge over owned importers; historyById Drizzle ownership gate
- `packages/api-client/src/router/genui/__tests__/generate.test.ts` - Fixed (Rule 1) + new session-gate test
- `packages/api-client/src/router/genui/__tests__/code-island.test.ts` - Fixed (Rule 1) + new session-gate test
- `packages/api-client/src/router/genui/__tests__/history.test.ts` - Rewritten: session gate, owned-forward/rejected/owner-less/multi-importer-merge, historyById NOT_FOUND (foreign + NULL importer)
- `apps/web/src/app/api/attachments/[id]/route.ts` - getUser() 401 gate + assertImporterOwnership 404 gate before signed URL
- `apps/web/src/app/api/attachments/__tests__/route.test.ts` - New: 401/404-cross-tenant/200-owner + 400/404-missing/500-misconfigured

## Decisions Made

- **genui.historyList fan-out over a Python change** — FastAPI's `importer_id` list filter is single-valued; rather than touching `apps/email-listener` (outside this plan's TS-only file list), the procedure issues one call per owned importer and merges client-side. Documented as a best-effort approximation for multi-importer offset pagination (correct for the common single-importer-per-user case).
- **genui.historyById ownership check via a parallel Drizzle query** — the FastAPI `HistoryDetailView`/`TemplateDetail` response has no `importer_id` field; rather than adding one server-side (a Python change), the procedure reads `ui_spec_templates.importer_id` directly via `ctx.db` alongside the FastAPI fetch.
- **NULL-importer `ui_spec_templates` row → NOT_FOUND from historyById** — per the plan's own text; the generation CACHE (exact-match reuse) stays cross-tenant regardless, this decision only governs the history-browsing surface.
- **`chat.listConversations` keeps `importerId` as a narrowing filter, not a security boundary** — `and(eq(userId, ctx.user.id), importerId ? eq(importerId, ...) : undefined)` preserves the D-11 per-importer rail recency list while `user_id` is what actually gates access.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `chat_cost_ledger.user_id` (NOT NULL, Plan 01) was missing from `browser-turn.ts`'s insert, and `browser-turn.test.ts`'s fixture needed the new required context field**
- **Found during:** Task 1 (this was the pre-existing, previously-flagged typecheck break inherited from 44-02/44-05/44-06's summaries — expected, not a surprise)
- **Issue:** `BrowserTurnRowContext` had no `userId` field; `buildBrowserTurnRows`'s `costLedgerRow` therefore could not satisfy `InsertChatCostLedger`'s `NOT NULL user_id` requirement. `browser-turn.test.ts`'s `BASE_CTX` fixture would fail to typecheck once the field became required.
- **Fix:** Added `userId: string` to `BrowserTurnRowContext`, threaded `ctx.user.id` through `recordBrowserTurn` into `buildBrowserTurnRows`, and added a matching `userId` fixture value to `BASE_CTX` (plus asserted it in Test 2's `toMatchObject`).
- **Files modified:** `packages/api-client/src/router/chat/browser-turn.ts`, `packages/api-client/src/router/chat/__tests__/browser-turn.test.ts`
- **Verification:** `npx tsc --noEmit` in `packages/api-client` — zero errors (previously exactly 2, both at this call site's neighbor and `conversations.ts`, both now fixed)
- **Committed in:** `0397deb` (Task 1 commit)

**2. [Rule 1 - Bug] `generate.test.ts` / `code-island.test.ts` broken by Task 2's protectedProcedure switch, not named in the plan's Task 2 files**
- **Found during:** Task 2, running the genui test suite after swapping `generate.ts`/`code-island.ts` to `protectedProcedure`
- **Issue:** Both files' `makeCaller()` helpers passed `user: null`, which now fails every test with `UNAUTHORIZED` before reaching the behavior under test. The plan's Task 2 `<files>` list only named `history.test.ts`.
- **Fix:** `makeCaller()` in both files now defaults to a valid session user; added one explicit session-gate regression test to each file proving the new `UNAUTHORIZED` behavior is intentional, not accidentally bypassed.
- **Files modified:** `packages/api-client/src/router/genui/__tests__/generate.test.ts`, `packages/api-client/src/router/genui/__tests__/code-island.test.ts`
- **Verification:** Both files' full suites green (22 + 6 tests)
- **Committed in:** `d46be1b` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 — blocking NOT NULL constraint + its test fixture, 1 Rule 1 — sibling test files broken by the same tenancy-gate change, not named in the plan text but directly in Task 2's blast radius, identical in kind to 44-05/44-06's established sibling-test-fix pattern).
**Impact on plan:** No behavioral or architectural change. Both fixes were necessary for correctness (the NOT NULL constraint) or to keep the suite green after the sanctioned procedure-level change (the two sibling test files). No scope creep.

## Issues Encountered

None beyond the deviations above (all resolved inline).

## Open Item Carried to 44-08 (not in this plan's scope)

**The chat `confirm_action` promotion dispatch path is still NOT user-scoped.** Per the CARRIED FLAG noted at this plan's kickoff (from 44-03): `PromoteEdgeUseCase` (`apps/email-listener/app/application/use_cases/promote_edge.py`) has an optional `user_id` guard, but the chat-side dispatch (`apps/email-listener/app/application/use_cases/confirm_action_dispatch.py`) does not pass one — confirmed by grep: zero `user_id` references in that file. This is a **Python-side** file, outside this plan's `files_modified` list (TS-only: the 6 chat router files, 3 genui files, and the attachments route). None of Task 1's chat-router changes touch the `emit_confirm_action` / widget-dispatch mechanism — that is a separate FastAPI code path (`submit_widget_interaction.py` → `confirm_action_dispatch.py` → `promote_edge.py`), not a tRPC procedure this plan swept. **This is explicitly flagged here, unresolved, for Plan 44-08's adversarial gate to either assert as a real cross-tenant gap or record as a scoped exception.**

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `packages/api-client`'s `npx tsc --noEmit` is now **fully clean** (was flagged RED since 44-02, exactly 2 pre-existing errors both fixed as this plan's own Task 1 recipe promised).
- `apps/web`'s `npx tsc --noEmit` has **zero new errors** outside the known `src/app/dev/design/` baseline.
- Per this plan's explicit scope instructions, `TENA-03` is **NOT** marked complete in REQUIREMENTS.md — it remains `Pending (spans Plans 02/03/05/06/07/08)`; it completes only at Plan 44-08's adversarial cross-tenant gate.
- Plan 44-08 (adversarial gate) inherits: the chat router's direct-user_id recipe, genui's auth-gate + owned-importer-scoped history, and the attachments route's session+ownership gate — all ready for cross-tenant adversarial probing.
- **Carried forward, unresolved:** the chat `confirm_action` promotion dispatch path's missing `user_id` wiring (see "Open Item" above) — a Python-side gap outside this plan's file list, explicitly surfaced for 44-08.
- No other blockers for Plan 44-08.

## Self-Check: PASSED

- Created files verified on disk: `packages/api-client/src/router/chat/chat-user-scoping.test.ts`, `apps/web/src/app/api/attachments/__tests__/route.test.ts` — both FOUND
- Modified files verified on disk (all 14) — FOUND
- Commits verified in `git log --oneline`: `0397deb`, `d46be1b`, `b954f54` — all FOUND
- Re-ran plan-level `<verification>`:
  - `npx vitest run` in `packages/api-client` (full suite) → 26 files / 301 tests, all green
  - `npx vitest run` in `apps/web` (full suite) → 39 files / 292 tests, all green
  - `grep -c publicProcedure` across all 6 chat files + all 3 genui files → 0 in every file
  - `grep -n "getUser\|assertImporterOwnership"` on the attachments route → both present
  - `npx tsc --noEmit` in `packages/api-client` → **0 errors** (was 2, both fixed)
  - `npx tsc --noEmit` in `apps/web` (excluding `src/app/dev/design`) → **0 errors**
- `git diff --diff-filter=D --name-only` across all three task commits → no unexpected deletions

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
