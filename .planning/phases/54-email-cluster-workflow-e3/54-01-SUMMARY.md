---
phase: 54-email-cluster-workflow-e3
plan: 01
subsystem: database
tags: [drizzle, postgresql, trpc, zod, migration, feature-detection]

# Dependency graph
requires:
  - phase: 45-email-threads-forwarding-seam
    provides: threads table + emails.thread_id (the FK target and the sibling column this plan mirrors)
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    provides: "@polytoken/db/ownership central chokepoint (assertConversationOwnership, userOwnedImporterIds) this plan builds directly on"
provides:
  - "Migration 0036 (chat_conversations.thread_id, additive/nullable/ON DELETE SET NULL) — authored, journal+snapshot consistent, applied to NO environment"
  - "packages/api-client/src/router/_column-detect.ts — tableColumnExists(db, table, column), the repo's single feature-detection point for unapplied-migration degradation, reusable by later plans"
  - "chat.attachConversationToThread + chat.getConversationThreadId — ownership-scoped thread<->conversation linkage read/write, degrades cleanly when 0036 is unapplied"
  - "createConversation accepts an optional threadId, persisted only when the column exists"
  - "emails.threadCard — ownership-scoped single-thread projection (subject/participants/summary/latest-message) for the EmailThreadNode canvas card"
affects: [54-04-thread-card-canvas-node, 54-05-thread-cluster-context, morning-migration-apply-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Feature-detected schema columns: tableColumnExists(db, table, column) gates every read/write of a column whose migration may not be applied yet, cached per-process, fails closed to 'not present' on any error (including its own probe query failing)"
    - "Discriminated non-throwing degrade result ({attached:false, reason:'linkage_unavailable'}) instead of an exception for an expected-tonight 'migration not applied' state"

key-files:
  created:
    - packages/db/migrations/0036_chat_conversation_thread_id.sql
    - packages/db/migrations/meta/0036_snapshot.json
    - packages/api-client/src/router/_column-detect.ts
    - packages/api-client/src/router/chat/thread-link.ts
    - packages/api-client/src/router/emails/thread-card.ts
    - packages/api-client/src/router/chat/__tests__/thread-link.test.ts
    - packages/api-client/src/router/emails/__tests__/thread-card.test.ts
  modified:
    - packages/db/src/schema/chat-conversations.ts
    - packages/db/migrations/meta/_journal.json
    - packages/api-client/src/router/chat/conversations.ts
    - packages/api-client/src/router/chat/index.ts
    - packages/api-client/src/router/emails/index.ts

key-decisions:
  - "Migration 0036 generated via `npx dotenv -e ../../.env.local -- drizzle-kit generate` instead of hand-authoring — drizzle-kit generate diffs schema.ts against the last snapshot and needs no live DB connection, so it ran fully offline despite Docker being down, producing a byte-consistent 3-statement (ADD COLUMN / ADD CONSTRAINT / CREATE INDEX) migration matching 0035's exact shape plus a correctly-chained snapshot (prevId linkage verified)"
  - "Journal 'when' timestamp corrected from drizzle-kit's real-clock value (1783847524879, earlier than 0035's synthetic future date) to continue the existing day-incremented synthetic sequence (1784227200000) for chronological consistency in the journal"
  - "tableColumnExists is the PRIMARY gate (checked before any write/read touching thread_id); a try/catch around the actual query is a SECONDARY defense-in-depth layer catching a live 42703 even if the cache/probe was stale — both layers tested independently"
  - "CLUS-01/CLUS-02 requirements NOT marked complete in REQUIREMENTS.md — this plan only ships the backend linkage seam; 54-04 (canvas node UI) and 54-05 (cluster context at turn time) are the plans that deliver the actual user-facing capability, matching the established multi-plan-per-requirement precedent (MOBL-01 stayed open through 53-05, closed only at 53-06)"

patterns-established:
  - "Pattern: _column-detect.ts's tableColumnExists is now the canonical feature-detection primitive — later plans touching columns that may not exist yet (e.g. any 0036-dependent read in 54-05) should import it rather than re-implementing an information_schema probe"

requirements-completed: []  # CLUS-01/CLUS-02 partially addressed (backend seam only) — see key-decisions; NOT marked complete pending 54-04/54-05

# Metrics
duration: 25min
completed: 2026-07-12
---

# Phase 54 Plan 01: Migration 0036 + Thread-Link Seam + threadCard Summary

**Migration 0036 (chat_conversations.thread_id) authored-unapplied via offline drizzle-kit generate; ownership-scoped attach/read tRPC procedures and emails.threadCard, both degrading cleanly through a new reusable tableColumnExists feature-detection gate.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-12T09:07:00Z (approx, first Read call)
- **Completed:** 2026-07-12T09:32:00Z
- **Tasks:** 3 (Task 2 and Task 3 each TDD RED->GREEN)
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments

- Migration 0036 generated fully offline (no live DB needed for `drizzle-kit generate` — only `push`/`migrate` need connectivity), landing a byte-consistent journal/snapshot chain rather than a hand-authored/risk-prone JSON snapshot
- A single, reusable feature-detection primitive (`tableColumnExists`) that every future "migration might not be applied yet" read/write can share instead of re-implementing an `information_schema` probe per call site
- Ownership-scoped `chat.attachConversationToThread` / `chat.getConversationThreadId`, plus an optional `threadId` on `createConversation`, all of which degrade to a clean non-throwing result rather than a raw Postgres 500 while 0036 is unapplied
- `emails.threadCard`, the exact single-thread projection `EmailThreadNode` (a later plan's canvas card) will fetch — real subject, deduped "+{n} more" participants, latest snippet, ownership-scoped via the same `userOwnedImporterIds` idiom `emails.listThreads` established

## Task Commits

Each task was committed atomically (Tasks 2 and 3 followed RED->GREEN per `tdd="true"`):

1. **Task 1: Author migration 0036 + Drizzle thread_id column (unapplied)** - `acd875b` (feat)
2. **Task 2 RED: chat.attachConversationToThread + threadId read tests** - `e2cb0fb` (test)
2. **Task 2 GREEN: chat.attachConversationToThread + threadId read implementation** - `dca57e7` (feat)
3. **Task 3 RED: emails.threadCard tests** - `80d82af` (test)
3. **Task 3 GREEN: emails.threadCard implementation** - `7fd42e2` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `packages/db/migrations/0036_chat_conversation_thread_id.sql` - ADD COLUMN thread_id + FK threads(id) ON DELETE SET NULL + index, mirrors emails.thread_id (0035) exactly
- `packages/db/migrations/meta/0036_snapshot.json` - full schema snapshot at 0036, prevId-chained to 0035
- `packages/db/migrations/meta/_journal.json` - appended idx-36 entry (tag `0036_chat_conversation_thread_id`)
- `packages/db/src/schema/chat-conversations.ts` - added `threadId` column + index, imports `Threads`
- `packages/api-client/src/router/_column-detect.ts` - `tableColumnExists(db, table, column)`, cached per-process, fail-closed on any error
- `packages/api-client/src/router/chat/thread-link.ts` - `attachConversationToThread` + `getConversationThreadId`, both ownership-gated and 0036-feature-detected
- `packages/api-client/src/router/chat/conversations.ts` - `createConversation` gains an optional `threadId` input, persisted only when the column exists
- `packages/api-client/src/router/chat/index.ts` - registers `chatThreadLinkProcedures`
- `packages/api-client/src/router/emails/thread-card.ts` - pure `deriveThreadCard` + `emailThreadCardProcedures.threadCard`
- `packages/api-client/src/router/emails/index.ts` - registers `emailThreadCardProcedures`
- `packages/api-client/src/router/chat/__tests__/thread-link.test.ts` - 9 tests (attach/read/createConversation wiring + degrade paths)
- `packages/api-client/src/router/emails/__tests__/thread-card.test.ts` - 8 tests (pure helper + router scoping)

## Decisions Made

- Used `drizzle-kit generate` offline (env vars present, DB unreachable — `generate` only diffs local files) instead of hand-authoring the migration/snapshot the plan flagged as a fallback. This is strictly safer than hand-writing a ~1200-line snapshot JSON and produces output byte-consistent with the existing 0031/0035 precedent.
- Hand-corrected the journal's `when` timestamp (drizzle-kit used the real system clock, which reads earlier than this repo's synthetic future-dated sequence) to keep the journal chronologically consistent — a cosmetic fix with no functional effect on migration ordering (drizzle uses `idx`/array order, not `when`, to sequence).
- Kept `tableColumnExists` as the primary gate and added a secondary try/catch around the actual write/read as defense-in-depth against a live 42703 (e.g. if the cache were ever stale) — both layers independently unit-tested (Test 6 in thread-link.test.ts specifically forces the update to reject with 42703 while the detection probe reports "exists", proving the second layer, not just the first).
- Did NOT mark CLUS-01/CLUS-02 complete in REQUIREMENTS.md. This plan ships only the backend linkage seam; CLUS-01's actual deliverable (a canvas node showing the card) is 54-04, and CLUS-02's actual deliverable (chat header showing the link + turn-time context injection) is 54-05. Marking either requirement done now would misrepresent unshipped UI/agent-context work — mirrors the established MOBL-01 precedent from Phase 53 (stayed open across 53-01..53-05, closed only at the final contributing plan 53-06).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Journal entry idx corrected from the plan's stated "idx 35" to the actual next-available "idx 36"**
- **Found during:** Task 1
- **Issue:** The plan's `<interfaces>` section stated "last idx is 34 (0035)... 0036 is idx 35" — but the actual `_journal.json` on disk already has idx 35 assigned to `0035_threads_forwarding`. Using idx 35 for the new entry would have collided/duplicated an existing index.
- **Fix:** Used idx 36 (the actual next-available index, confirmed by reading the live file before editing), matching what `drizzle-kit generate` itself computed.
- **Files modified:** packages/db/migrations/meta/_journal.json
- **Verification:** `node -e "require('./migrations/meta/_journal.json')"` parses cleanly; last entry idx=36, tag=0036_chat_conversation_thread_id
- **Committed in:** acd875b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale plan-stated index number, corrected to match the actual repo state)
**Impact on plan:** No scope creep; purely a numeric consistency correction required for migration ordering to remain valid.

## Issues Encountered

- `THREAD_A` test fixture in `thread-link.test.ts` initially used a non-hex character (`...000t01`) in a `z.string().uuid()`-validated field, causing all 6 dependent tests to fail with a Zod validation error rather than the intended assertion. Fixed the fixture to a valid hex UUID (`...000e01`) and reran — this was a test-authoring mistake caught immediately by the RED/GREEN cycle itself, not a plan or implementation defect.

## User Setup Required

None - no external service configuration required. Migration 0036 remains UNAPPLIED to every environment tonight by design; the morning §H flow (`.planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md`) applies it local -> staging -> prod before the CLUS-07 live acceptance scenario.

## Next Phase Readiness

- 54-04 (`depends_on: [54-01]`, CLUS-01) can now build the `EmailThreadNode` canvas card directly against `emails.threadCard` — the exact shape it needs already exists and is tested.
- 54-05 (`depends_on: [54-01, 54-03]`, CLUS-02/CLUS-06) can now read/write the thread<->conversation linkage via `chat.attachConversationToThread`/`getConversationThreadId` for turn-time context assembly.
- Every consumer MUST keep routing through `tableColumnExists` (not a fresh probe) until the morning migration-apply flow confirms 0036 is live everywhere — after that, the per-process cache means only a process restart (which every deploy does) picks up the change.
- No blockers. `@polytoken/api-client`'s `dist/` was NOT rebuilt this plan (no apps/web consumer of the new procedures yet — that lands with 54-04/54-05); flagging the known dist-rebuild gotcha for whichever plan first imports these from `apps/web`.

---
*Phase: 54-email-cluster-workflow-e3*
*Completed: 2026-07-12*

## Self-Check: PASSED

All 13 declared files (7 created, 5 modified, this SUMMARY) confirmed present on disk;
all 5 task commit hashes (acd875b, e2cb0fb, dca57e7, 80d82af, 7fd42e2) confirmed in
`git log --oneline --all`.
