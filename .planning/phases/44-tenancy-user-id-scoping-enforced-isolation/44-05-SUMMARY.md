---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 05
subsystem: api
tags: [trpc, tenancy, ownership, drizzle, vitest, emails-router]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 02
    provides: "@polytoken/db/ownership — userOwnedImporterIds + assertEmailOwnership/assertComponentOwnership + OwnershipError"
provides:
  - "packages/api-client/src/router/_ownership.ts — assertOwnedOrNotFound, the shared OwnershipError -> TRPCError NOT_FOUND wrapper reused by every subsequent router sweep plan (06/07)"
  - "emailsRouter fully on protectedProcedure — list/byId/detail/entitySummary + all 17 component mutations ownership-guarded"
  - "resolveListScope — the pure, DB-free helper deciding which importer ids a list-style read is allowed to query given an owned set + optional client filter"
affects: [44-06, 44-07, 44-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assertOwnedOrNotFound(assertFn) — a tiny local wrapper (mirrors _listener-config.ts's shared-helper idiom) mapping OwnershipError -> TRPCError NOT_FOUND at every id-addressed call site, called at the TOP of each resolver before any read/write"
    - "resolveListScope(owned, requestedImporterId) — DB-free pure helper (same idiom as shapeGalleryItem/aggregateEntitySummary) deciding the effective importer-id scope for a list-style read: no filter -> full owned set, owned filter -> narrowed to it, non-owned filter or owner-less caller -> { ok: false } (empty result, no query issued)"
    - "Router-level tenancy tests mock @polytoken/db/ownership at the module boundary (vi.mock + vi.importActual to keep the real OwnershipError class) rather than re-simulating Drizzle SQL filtering in a fake chain — ownership.ts's own allow/deny correctness is already exhaustively covered by packages/db/src/ownership.test.ts (44-02); router tests instead prove the WIRING (session required, ownership derived from ctx.user.id, rejection maps to NOT_FOUND, multi-id ops assert every id)"
    - "Multi-id mutations (merge, nest, setFieldRelationship) assert ownership of EVERY referenced id — nest/setFieldRelationship only when the optional parentComponentId is non-null — so a caller cannot splice a component they do not own into one they do"

key-files:
  created:
    - packages/api-client/src/router/_ownership.ts
    - packages/api-client/src/router/emails/__tests__/emails-user-scoping.test.ts
  modified:
    - packages/api-client/src/router/emails/index.ts
    - packages/api-client/src/router/emails/detail.ts
    - packages/api-client/src/router/emails/entity-summary.ts
    - packages/api-client/src/router/emails/mutations.ts
    - packages/api-client/src/router/__tests__/mutations.test.ts
    - packages/api-client/src/router/__tests__/component-relationship-mutations.test.ts

key-decisions:
  - "entitySummary scopes by EmailComponents.importerId directly (a component-level inArray filter against the caller's owned set) rather than a per-emailId assertEmailOwnership call — it is a batch endpoint (up to 100 emailIds), and email_components already carries importer_id as a first-class column (the same join assertComponentOwnership uses). A foreign emailId slipped into the batch simply yields an empty entities[] entry (aggregateEntitySummary's existing 'no rows for this id' behavior) rather than failing the whole batch — never leaks another user's rollup, but stays batch-friendly."
  - "Router-boundary tests mock @polytoken/db/ownership rather than building a SQL-interpreting fake Drizzle chain — the fake chain fixture (ownership.test.ts's own idiom) proves query-RESULT interpretation, not WHERE-clause correctness; re-simulating Drizzle's inArray/eq semantics in a second fixture would test the fixture, not the router. Mocking the already-proven ownership module isolates these tests to what Plan 05 actually changed: the wiring."
  - "assertOwnedOrNotFound extracted to a new packages/api-client/src/router/_ownership.ts shared helper (permitted by the plan's own interfaces block: 'at each call site or via a tiny local wrapper') rather than duplicating the try/catch at ~20 call sites — mirrors the existing _listener-config.ts shared-helper convention in the same directory."

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 44 Plan 05: Emails Router Ownership Sweep Summary

**The emails tRPC router (reads + 17 component mutations, the largest cluster in the TENA-03 sweep) is fully on `protectedProcedure` + `@polytoken/db/ownership`: `emails.list` scopes to `userOwnedImporterIds` via a new pure `resolveListScope` helper, `byId`/`detail`/`entitySummary` reject cross-tenant targets, and every mutation asserts ownership (including every id in multi-id ops) before proxying to FastAPI.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T02:45:00Z (approx.)
- **Completed:** 2026-07-10T03:22:12Z
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- `emails.list`: derives scope from `userOwnedImporterIds(ctx.db, ctx.user.id)`; a client-supplied `importerId` is only honored when it's in the owned set (via the new exported pure helper `resolveListScope`), otherwise the caller gets an empty page — never a query built from an unverified id.
- `emails.byId` / `emails.detail`: both call `assertEmailOwnership` at the top of the resolver, mapped to `TRPCError NOT_FOUND` through the new shared wrapper — fail-closed, no existence oracle.
- `emails.entitySummary`: scoped by `EmailComponents.importerId` (direct column) against the owned set; an owner-less caller short-circuits to an empty rollup for every requested id without issuing any DB query at all (proven by a select-call-count spy in the tests).
- All 17 `componentMutationProcedures` (accept, reject, redraw, split, merge, nest, createRegion, classifyDocument, autofillComponent, confirmComponent, reprocessEmail, setRole, setEntityType, setFieldRelationship, autofillFields, denyField, confirmField) moved to `protectedProcedure` with an ownership assert BEFORE the FastAPI proxy `fetch` call. `merge` asserts every `componentIds` entry; `nest`/`setFieldRelationship` additionally assert the optional `parentComponentId` when non-null — closing the "splice an unowned component into one you own" gap (T-44-05-03).
- New `packages/api-client/src/router/_ownership.ts`: `assertOwnedOrNotFound(assertFn)`, the shared `OwnershipError -> TRPCError NOT_FOUND` mapper reused across ~20 call sites (mirrors the existing `_listener-config.ts` shared-helper convention).
- 21 tests in the new `emails-user-scoping.test.ts` (session-gate, cross-tenant `NOT_FOUND` for reads and writes, `entitySummary`/`list` short-circuit proofs, `resolveListScope` DB-free matrix, and the write-side multi-id matrix for `merge`/`nest`) + fixed 2 pre-existing test files broken by the new tenancy gate.
- Full `packages/api-client` vitest suite (not just the touched files): 23 files, 237 tests, all green. `npx tsc --noEmit` clean except the 2 pre-existing chat `user_id` errors (`conversations.ts`, `browser-turn.ts`) explicitly scoped to Plan 44-07 (confirmed unchanged — same 2 errors as the pre-existing baseline noted in 44-02's summary).

## Task Commits

Each task was committed atomically:

1. **Task 1: Guard the emails reads (list, byId, detail, entitySummary)** - `2cf6a35` (feat)
2. **Task 2: Guard the emails component mutations (mutations.ts, ~18 procedures)** - `8ae41cd` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/api-client/src/router/_ownership.ts` - New: `assertOwnedOrNotFound` shared OwnershipError -> NOT_FOUND wrapper
- `packages/api-client/src/router/emails/index.ts` - `list`/`byId` on protectedProcedure; new exported `resolveListScope` pure helper
- `packages/api-client/src/router/emails/detail.ts` - `detail` on protectedProcedure + assertEmailOwnership; D-18 comment replaced with the tenancy contract
- `packages/api-client/src/router/emails/entity-summary.ts` - `entitySummary` on protectedProcedure, scoped via `EmailComponents.importerId` against the owned set
- `packages/api-client/src/router/emails/mutations.ts` - All 17 mutations on protectedProcedure with ownership asserts (multi-id ops assert every id)
- `packages/api-client/src/router/emails/__tests__/emails-user-scoping.test.ts` - New: 21 tests (session gate, read/write cross-tenant rejection, scoping short-circuits, pure-helper matrix)
- `packages/api-client/src/router/__tests__/mutations.test.ts` - Fixed (Rule 1): mocks `@polytoken/db/ownership`, valid `ctx.user`, so the new tenancy gate doesn't break the pre-existing proxy-behavior regressions
- `packages/api-client/src/router/__tests__/component-relationship-mutations.test.ts` - Same Rule 1 fix as above (not explicitly named in the plan's frontmatter, but broken by the same Task 2 change — see Deviations)

## Decisions Made

- `entitySummary` scopes via a component-level `inArray(EmailComponents.importerId, owned)` filter rather than per-id `assertEmailOwnership` calls, since it's a batch endpoint and `email_components` already carries `importer_id` directly — a foreign id in the batch yields an empty rollup entry rather than failing the whole request (see key-decisions in frontmatter for full rationale).
- Router-boundary tests mock `@polytoken/db/ownership` (via `vi.mock` + `vi.importActual` to preserve the real `OwnershipError` class for `instanceof` checks) instead of building a second SQL-interpreting fake Drizzle chain — `ownership.ts`'s own correctness is already proven by `packages/db/src/ownership.test.ts` (44-02); these tests isolate to what Plan 05 changed (the wiring), and the existing fake-chain idiom (`ownership.test.ts`) is reused only where the router's OWN query result needs shaping (byId/list/entitySummary short-circuit proofs).
- `assertOwnedOrNotFound` extracted as a shared file rather than duplicated inline at ~20 call sites, per the plan's own "tiny local wrapper" allowance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `component-relationship-mutations.test.ts`, broken by Task 2's tenancy gate but not named in the plan's frontmatter**
- **Found during:** Task 2, running the full `packages/api-client` vitest suite after guarding `mutations.ts`
- **Issue:** The plan's frontmatter `files_modified` and Task 2's `<files>` list name `packages/api-client/src/router/__tests__/mutations.test.ts` for the "pre-existing tests using `user: null`" fix, but a second, structurally identical test file — `component-relationship-mutations.test.ts` (covering `setRole`/`setEntityType`/`setFieldRelationship`/`autofillFields`/`denyField`/`confirmField`, all now-guarded mutations) — uses the exact same `makeCaller({ user: null, db: {} as never })` pattern and was broken by the same change. A grep for every `emails.<mutation>(` call site across `src/router/__tests__/` confirmed these are the only two affected files.
- **Fix:** Applied the identical fix (mock `@polytoken/db/ownership` resolving by default, valid `ctx.user`) to keep the suite green — squarely in scope per the deviation rules' "directly caused by the current task's changes" boundary.
- **Files modified:** `packages/api-client/src/router/__tests__/component-relationship-mutations.test.ts`
- **Verification:** Full `packages/api-client` vitest suite (23 files, 237 tests) green; this file's 12 tests pass.
- **Committed in:** `8ae41cd` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a second pre-existing test file broken by the same tenancy-gate change, not named in the plan text but directly in the blast radius of Task 2's edit).
**Impact on plan:** No behavioral or architectural change — a straightforward extension of the plan's own named fix to a sibling file with an identical breakage cause. No scope creep beyond the direct blast radius of Task 2.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 06/07 (the remaining tRPC procedure sweeps — entities/entity-types/knowledge/genui and chat respectively) can reuse `packages/api-client/src/router/_ownership.ts`'s `assertOwnedOrNotFound` wrapper directly instead of re-deriving the OwnershipError -> NOT_FOUND mapping.
- Per this plan's explicit scope instructions, `TENA-03` is **NOT** marked complete in REQUIREMENTS.md — it remains `Pending (spans Plans 02/03/05/06/07/08)` per 44-02's own correction; it completes only at Plan 44-08's adversarial cross-tenant gate.
- The known pre-existing `packages/api-client` typecheck break (2 chat insert sites missing `user_id`, `conversations.ts`/`browser-turn.ts`) is untouched by this plan and remains exactly Plan 44-07's scope — confirmed still exactly 2 errors, no new ones introduced by this plan's edits.
- No blockers for Plans 06/07/08.

## Self-Check: PASSED

- FOUND: `packages/api-client/src/router/_ownership.ts`
- FOUND: `packages/api-client/src/router/emails/__tests__/emails-user-scoping.test.ts`
- FOUND: `packages/api-client/src/router/emails/index.ts`, `detail.ts`, `entity-summary.ts`, `mutations.ts` (all modified)
- FOUND: commit `2cf6a35` (feat(44-05): guard emails reads)
- FOUND: commit `8ae41cd` (feat(44-05): guard the ~18 emails component mutations)
- Re-ran plan-level `<verification>`:
  - `npx vitest run src/router/emails/__tests__/emails-user-scoping.test.ts src/router/__tests__/mutations.test.ts` -> 29/29 passed
  - `grep -c publicProcedure` across `emails/index.ts`, `detail.ts`, `entity-summary.ts`, `mutations.ts` -> 0 in all four
  - `npx tsc --noEmit` in `packages/api-client` -> exactly 2 errors, both the pre-existing chat `user_id` baseline (Plan 44-07 scope), zero new errors
  - Full `packages/api-client` vitest suite -> 23 files / 237 tests, all green
- `git diff --diff-filter=D --name-only` on both task commits -> no unexpected deletions

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
