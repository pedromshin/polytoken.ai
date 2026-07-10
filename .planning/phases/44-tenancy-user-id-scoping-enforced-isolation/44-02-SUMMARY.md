---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 02
subsystem: database
tags: [drizzle, tenancy, ownership, vitest, tdd]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 01
    provides: user_id NOT NULL on importers/chat_conversations/chat_cost_ledger — the columns this helper queries
provides:
  - "@polytoken/db/ownership — userOwnedImporterIds + assertImporterOwnership/assertEmailOwnership/assertComponentOwnership/assertConversationOwnership + OwnershipError, the ONE central ownership chokepoint"
  - "packages/db vitest infra (vitest.config.ts, test script, vitest devDependency) — first test framework in this package"
affects: [44-05, 44-06, 44-07, tRPC procedures, apps/web attachments route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ownership assert functions accept the Drizzle handle as their FIRST parameter (never import the db singleton) — callers pass ctx.db (tRPC) or the imported db (web route), keeping the module test-injectable and framework-agnostic"
    - "Fail-closed OwnershipError: missing row and other-user row both throw the identical error shape — no oracle distinguishing 'not found' from 'forbidden' beyond the caller's own transport mapping"
    - "DB-free unit testing via a minimal fake Drizzle chain stub (select/from/innerJoin/where/limit all returning `this`, terminal `.then()` resolving a seeded rows array) — introduced as this plan's own fixture, since the codebase had no prior ctx.db-mocking precedent"

key-files:
  created:
    - packages/db/src/ownership.ts
    - packages/db/src/ownership.test.ts
    - packages/db/vitest.config.ts
  modified:
    - packages/db/src/index.ts
    - packages/db/package.json

key-decisions:
  - "Built a fake Drizzle chain-stub test fixture from scratch rather than following the plan's stated precedent — no existing packages/api-client test mocks ctx.db chains (confirmed via chat/__tests__/cost.test.ts's own doc comment); every prior router test exercises DB-free pure helpers instead. ownership.ts IS the query, so pure-helper testing cannot cover it."
  - "OwnershipDb type computed independently as PostgresJsDatabase<typeof schema> (matching client.ts's own drizzle() call) rather than importing typeof db from client.ts, so a grep for './client' in ownership.ts stays clean (acceptance criteria requirement) while remaining structurally identical to the real db's type."
  - "assertComponentOwnership joins EmailComponents -> Importers directly via email_components.importer_id (carried directly per components.ts) rather than routing through emails — matches the plan's interfaces note that a single join suffices."

patterns-established:
  - "Central ownership chokepoint pattern: every tenant-scoped read/write in Plans 05/06/07 calls one of these 5 functions instead of writing ad-hoc importer_id/user_id WHERE clauses inline."

requirements-completed: [TENA-03]

duration: 30min
completed: 2026-07-10
---

# Phase 44 Plan 02: Central Ownership Helper Summary

**`@polytoken/db/ownership` — one TDD'd module (userOwnedImporterIds + 4 assert* functions + fail-closed OwnershipError) covering both the importer-anchored join path and the direct-user_id chat path, exported via a new package subpath and the root barrel.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-09T23:00:00-03:00 (approx.)
- **Completed:** 2026-07-09T23:30:00-03:00 (approx.)
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `packages/db/src/ownership.ts` — `userOwnedImporterIds`, `assertImporterOwnership`, `assertEmailOwnership`, `assertComponentOwnership`, `assertConversationOwnership`, and `OwnershipError`, every function accepting the Drizzle handle as its first parameter (never importing the `db` singleton)
- Fail-closed by construction: a missing row and a row owned by a different user both throw the identical `OwnershipError` — no distinguishing oracle leaked to callers (T-44-02-01)
- All queries use parameterized `eq()`/`.limit()` Drizzle builders — zero string interpolation (T-44-02-02)
- Full RED→GREEN TDD cycle: 15 allow/deny-matrix tests (owner-allowed / other-user-rejected / missing-rejected × 4 assert functions, plus the two `userOwnedImporterIds` cases and the `OwnershipError` shape check) — all passing
- `packages/db` gained its first test framework (vitest, mirroring `packages/api-client`'s config) — a one-time infra cost folded into this TDD plan's RED phase per convention
- `@polytoken/db/ownership` resolves as a package subpath; `@polytoken/db` root barrel also re-exports it; `packages/db` typechecks clean

## Task Commits

Each task was committed atomically (Task 1 as its own RED→GREEN pair):

1. **Task 1 RED: failing test for central ownership helper** - `eb221e5` (test)
2. **Task 1 GREEN: implement central ownership helper** - `a76095f` (feat)
3. **Task 2: Export the helper as @polytoken/db/ownership** - `c2e028f` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/db/src/ownership.ts` - The central ownership helper (165 lines)
- `packages/db/src/ownership.test.ts` - Allow/deny matrix unit tests (242 lines)
- `packages/db/vitest.config.ts` - Test runner config (new for this package)
- `packages/db/src/index.ts` - Re-exports `./ownership`
- `packages/db/package.json` - Adds `"./ownership"` export subpath, `test`/`test:watch` scripts, `vitest` devDependency

## Decisions Made

- **Fake Drizzle chain-stub fixture built from scratch, not reused** — the plan's `<interfaces>` block claimed an existing "DB-free stub style already used in packages/api-client router tests" (a fake `db` whose select/from/where/limit chain returns a seeded rows array). Grepping the actual test suite found no such precedent: every router test (`gallery.test.ts`, `detail.test.ts`, `cost.test.ts`, etc.) tests DB-free *pure helper functions* only, and `cost.test.ts`'s own doc comment states explicitly "this codebase has no precedent for mocking ctx.db chains." Since `ownership.ts`'s entire value is the DB query itself (there is no pure-helper layer to peel off), a minimal chain stub (`select().from().innerJoin().where().limit()`, terminal `.then()` resolving a seeded rows array) was authored as this plan's own fixture. This is documented in the test file's header comment for future readers/planners.
- **`OwnershipDb` type computed independently, not imported from `client.ts`** — to satisfy the acceptance criterion "no `db` singleton import" (grep-checked), the Drizzle handle type is derived as `PostgresJsDatabase<typeof schema>` directly (matching `client.ts`'s own `drizzle(client, { schema })` call) rather than `typeof db` from `./client`, keeping a `grep "\./client"` on `ownership.ts` clean while remaining structurally identical to the real exported `db`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reverted premature TENA-03 "Complete" mark in REQUIREMENTS.md**
- **Found during:** State-update step (`requirements.mark-complete TENA-03`, run per this plan's own frontmatter `requirements: [TENA-03]`)
- **Issue:** `TENA-03` is listed in the frontmatter of SIX plans in this phase (02, 03, 05, 06, 07, 08 — grep-verified), not just this one. Its own REQUIREMENTS.md text explicitly requires "every web route and tRPC procedure derives tenant scope... proven by an adversarial cross-tenant test that is a phase acceptance gate" — a condition only Plan 44-08 (the adversarial-suite plan) actually proves. The mechanical `requirements.mark-complete` command flipped the checkbox to `[x]`/"Complete" after this plan (which only ships the ownership *helper*, not the sweep), which would misrepresent phase status to any reader of REQUIREMENTS.md.
- **Fix:** Reverted the checkbox to `[ ]` and the traceability table row to `Pending (spans Plans 02/03/05/06/07/08 — Plan 02 delivered the ownership helper; the requirement completes at Plan 08's adversarial gate)`.
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** Manual re-read of REQUIREMENTS.md confirms `TENA-03` now correctly shows as outstanding until Plan 08.
- **Committed in:** this plan's metadata commit

---

**Total deviations:** 1 auto-fixed (Rule 1 — documentation-correctness bug in requirement-completion tracking)
**Impact on plan:** No code impact — this is purely a `.planning/REQUIREMENTS.md` bookkeeping correction so the phase's true completion state isn't overstated. The chain-stub fixture note below documents a correction to an inaccurate premise in the plan's `<interfaces>` context, not a Rule 1-4 deviation itself: no bug was fixed, no missing-critical functionality was added, no blocker was resolved, and no architectural change was made — the task's own literal instruction ("mirror the DB-free stub style" with an implicit fallback of building one if absent) was followed as written.

## Issues Encountered

- `packages/api-client`'s `npm run typecheck` currently fails (pre-existing, NOT caused by this plan): `conversations.ts`'s `ChatConversations` insert and `browser-turn.ts`'s `ChatCostLedger` insert are both missing the now-required `user_id` field, a direct consequence of Plan 01's `NOT NULL` contract. This is expected and already scoped to Plan 44-07 (`depends_on: ["44-02"]`), whose CHAT recipe explicitly writes `user_id: ctx.user.id` on these exact call sites. Verified via `git log` that neither file has been touched since Phase 42 (rename), confirming the break originates from Plan 01's schema change, not from this plan's `packages/db` edits. No action taken here — out of this plan's scope boundary (`packages/db` only); `packages/db`'s own `npm run typecheck` is clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 05/06/07 (tRPC procedure sweep) and the attachments web route are unblocked: `assertImporterOwnership` / `assertEmailOwnership` / `assertComponentOwnership` / `assertConversationOwnership` / `userOwnedImporterIds` are importable from `@polytoken/db/ownership`.
- Flag for whoever runs Plan 07 first: `packages/api-client`'s typecheck is currently RED (pre-existing, see Issues Encountered) — Plan 07's CHAT recipe Task 1 is expected to fix it as a side effect of adding `user_id: ctx.user.id` to the two affected insert call sites. Confirm this typecheck goes green as part of Plan 07's own verification, not a surprise regression.
- Plan 03 (FastAPI repository-layer ownership, if scoped separately) is unaffected by this plan (TypeScript-only).

## Self-Check: PASSED

- Created files verified on disk: `packages/db/src/ownership.ts`, `packages/db/src/ownership.test.ts`, `packages/db/vitest.config.ts` — all FOUND
- Commits verified in `git log --oneline`: `eb221e5`, `a76095f`, `c2e028f` — all FOUND
- Re-ran plan-level `<verification>`: `npx vitest run src/ownership.test.ts` → 15/15 passed; `npm run typecheck` (packages/db) → clean
- `grep -n "export" packages/db/src/ownership.ts` shows all 6 required exports (`userOwnedImporterIds`, `assertImporterOwnership`, `assertEmailOwnership`, `assertComponentOwnership`, `assertConversationOwnership`, `OwnershipError`, plus the `OwnershipDb` type)
- `grep -n "\./client" packages/db/src/ownership.ts` → no match (no singleton import)
- `grep -n "\./ownership" packages/db/package.json` and `grep -n "ownership" packages/db/src/index.ts` → both present
- TDD gate sequence confirmed: `test(44-02)` commit (`eb221e5`) precedes `feat(44-02)` commit (`a76095f`) in `git log`

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
