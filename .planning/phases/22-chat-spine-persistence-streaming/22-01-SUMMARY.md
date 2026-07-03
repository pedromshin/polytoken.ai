---
phase: 22-chat-spine-persistence-streaming
plan: 01
subsystem: database
tags: [drizzle, postgres, supabase, rls, chat, migrations]

# Dependency graph
requires:
  - phase: 20-code-island-sandbox (v1.2)
    provides: existing Drizzle schema conventions (genui_generation_events, ui_spec_templates), RLS deny-all pattern, migration tooling
provides:
  - Five chat Drizzle table modules (chat_conversations, chat_runs, chat_messages, chat_run_events, chat_cost_ledger)
  - Migration 0023 applied to local Postgres with CHECK constraints + RLS deny-all
  - The canonical typed-message-parts persistence shape (FOUND-1) all downstream chat work reads/writes
affects: [22-02, 22-03, chat-persistence-repos, chat-streaming-agent, chat-crud, cost-breaker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-version turn tree: chat_messages.sibling_group_id + version + is_active (exactly one active row feeds context)"
    - "Append-only run_events with unique (run_id, seq) ordering; no UPDATE/DELETE paths"
    - "Cost ledger survives conversation hard-delete via ON DELETE SET NULL (not cascade)"
    - "Text + SQL CHECK instead of pgEnum for chat lifecycle/role/type columns (matches outcome-CHECK precedent)"

key-files:
  created:
    - packages/db/src/schema/chat-conversations.ts
    - packages/db/src/schema/chat-runs.ts
    - packages/db/src/schema/chat-messages.ts
    - packages/db/src/schema/chat-run-events.ts
    - packages/db/src/schema/chat-cost-ledger.ts
    - packages/db/migrations/0023_chat_spine.sql
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "chat_cost_ledger.run_id kept as a plain uuid with NO FK (mirrors the existing genui_generation_events/ui_spec_templates importer_id idiom) — a run row cascade-deletes with its conversation while its ledger row must survive (D-14), so constraining run_id would force an extra SET NULL FK for no added integrity value"
  - "chat_conversations.importer_id and chat_cost_ledger.importer_id are plain uuid with no FK, matching the established no-FK-on-optional-cross-cutting-reference idiom in this schema"
  - "Docker Desktop + local Supabase stack were not running at plan start; started both (Rule 3 blocking-issue auto-fix) to reach the [BLOCKING] Task 2 migration-apply requirement"

requirements-completed: [CHAT-01, CHAT-04, STREAM-03, SEAM-03]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 22 Plan 01: Chat Data Model Summary

**Five Drizzle tables (conversations, runs, messages with typed parts + sibling versions, append-only run_events, cost ledger) plus migration 0023 with RLS deny-all, applied to local Supabase Postgres.**

## Performance

- **Duration:** ~20 min (includes Docker Desktop cold-start + local Supabase stack bring-up)
- **Started:** 2026-07-03T15:30:00-03:00 (approx)
- **Completed:** 2026-07-03T15:43:22-03:00
- **Tasks:** 2/2 completed
- **Files modified:** 8 (5 created schema modules, 1 barrel edit, 1 migration SQL, 1 journal + 1 snapshot)

## Accomplishments
- Modeled the FOUND-1 canonical typed-message-parts store (`chat_messages.parts` jsonb) that all downstream persistence/streaming/regenerate/canvas work will read and write
- Modeled the D-16 sibling-version turn tree (`sibling_group_id` / `version` / `is_active`) so `< 1/2 >` regenerate navigation has a schema home from day one
- Modeled the SEAM-03/D-27 event-based run/run_events abstraction (append-only, unique `(run_id, seq)` ordering)
- Modeled the FOUND-3/D-20 cost ledger with `execution_locus` (D-09 sovereign/distributed-inference seam) and D-14's survives-delete `ON DELETE SET NULL` semantics
- Generated, hand-edited (CHECK constraints + RLS deny-all for all five tables), and applied migration 0023 to the local Supabase Postgres — verified via `\d` against the live database

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the five chat Drizzle table modules + barrel export** - `719f1b2` (feat)
2. **Task 2 [BLOCKING]: Generate migration 0023 with RLS deny-all + apply to LOCAL Postgres** - `654392d` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `packages/db/src/schema/chat-conversations.ts` - `chat_conversations` table: title snippet default, remembered model_id, (importer_id, updated_at) recency index
- `packages/db/src/schema/chat-runs.ts` - `chat_runs` table: one run per turn, status lifecycle CHECK, conversation-cascade FK
- `packages/db/src/schema/chat-messages.ts` - `chat_messages` table: typed `parts` jsonb, sibling-version columns, role/status CHECKs, run_id SET NULL FK
- `packages/db/src/schema/chat-run-events.ts` - `chat_run_events` append-only table: unique (run_id, seq), type CHECK
- `packages/db/src/schema/chat-cost-ledger.ts` - `chat_cost_ledger` table: execution_locus CHECK, conversation_id SET NULL FK (D-14), per-day/session indexes
- `packages/db/src/schema/index.ts` - barrel re-exports all five new modules in dependency order
- `packages/db/migrations/0023_chat_spine.sql` - CREATE TABLE (all 5) + CHECK constraints + FKs + indexes + RLS deny-all (anon + authenticated) for all 5 tables
- `packages/db/migrations/meta/_journal.json` - registered migration 0023 (tag `0023_chat_spine`)
- `packages/db/migrations/meta/0023_snapshot.json` - drizzle-kit schema snapshot (auto-generated; CHECK constraints intentionally absent here per existing 0021 precedent — they live only in the raw SQL)

## Decisions Made
- **Enums as text + CHECK, not pgEnum:** matches the plan's explicit instruction and the existing `outcome`-CHECK precedent (`genui_generation_events`, `ui_spec_templates`) rather than introducing a sixth style into `enums.ts`.
- **`chat_cost_ledger.run_id`: plain uuid, no FK.** The plan text left this column's FK unspecified. Constraining it to `chat_runs.id` would require its own `ON DELETE SET NULL` (since `chat_runs` rows cascade-delete with their conversation, same as messages) — but the codebase's established idiom for optional cross-cutting reference columns on audit/ledger-style tables (`genui_generation_events.importer_id`, `ui_spec_templates.importer_id`) is a bare `uuid` column with no FK at all. Followed that idiom for consistency and simplicity; referential correctness is enforced at the application layer when writing ledger rows.
- **`chat_conversations.importer_id` / `chat_cost_ledger.importer_id`: plain uuid, no FK** — same established idiom, and explicitly how the plan phrased these columns (no FK verb in the plan text, unlike the conversationId/runId columns which do specify FK behavior).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Started Docker Desktop and the local Supabase stack**
- **Found during:** Task 2 (migration apply)
- **Issue:** `npm run migrate:local` failed with `ECONNREFUSED 127.0.0.1:54322` — Docker Desktop's engine was not running, so the local Supabase Postgres container was down.
- **Fix:** Launched `Docker Desktop.exe`, polled until the daemon responded, then ran `npm run sb:start` (project's `supabase start` wrapper) to bring the local Postgres/Studio/etc. stack up.
- **Files modified:** none (environment-only fix)
- **Verification:** `npm run migrate:local` then succeeded ("Migrations completed in 63ms (20 tables)"); re-run confirmed idempotent ("9ms (20 tables)").
- **Committed in:** N/A (no code change; documented here per Rule 3)

**2. [Rule 3 - Blocking] Renamed drizzle-kit's auto-generated migration file/tag**
- **Found during:** Task 2 (migration generate)
- **Issue:** `npm run migration:generate` emitted `0023_sticky_big_bertha.sql` (drizzle-kit's random name generator) instead of the plan-specified `0023_chat_spine.sql`, and registered that tag in `meta/_journal.json`.
- **Fix:** Deleted the auto-named file, hand-authored `0023_chat_spine.sql` (same generated DDL plus the required `IF NOT EXISTS` guards, CHECK constraints, and RLS deny-all blocks per the plan's Task 2 instructions), and updated the journal entry's `tag` field to match.
- **Files modified:** `packages/db/migrations/0023_chat_spine.sql`, `packages/db/migrations/meta/_journal.json`
- **Verification:** `npm run migrate:local` applied cleanly against the renamed/edited file; `meta/0023_snapshot.json` (numeric, not tag-based) required no change.
- **Committed in:** `654392d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking — both required to reach the plan's [BLOCKING] migration-apply acceptance criterion; no scope creep, no code-behavior changes beyond what Task 2 already specified)
**Impact on plan:** Both auto-fixes were prerequisites for completing the explicitly-marked [BLOCKING] task exactly as written. No architectural changes, no deferred work.

## Issues Encountered
None beyond the two Rule-3 items above.

## User Setup Required
None - no external service configuration required. Local Supabase Postgres (localhost:54322) now has the migration applied; Docker Desktop + `supabase start` must remain running for any future local `packages/db` work in this session/machine.

## Threat Flags

None — all five new tables' surface (RLS deny-all, CHECK-constrained enums, SET NULL vs CASCADE semantics) was already enumerated in the plan's `<threat_model>` (T-22-01 through T-22-05) and implemented exactly as dispositioned. No new trust-boundary surface introduced beyond what the plan anticipated.

## Next Phase Readiness
- The chat data model is live in local Postgres and ready for the next plan (persistence repositories / streaming agent) to read and write against.
- Staging/prod are explicitly **PENDING DEPLOY** per this milestone's local/sandbox-only scope — `migrate:staging`/`migrate:prod` were intentionally NOT run.
- Downstream plans (repos, chat orchestration loop, cost-breaker) can now build directly on `ChatConversations` / `ChatRuns` / `ChatMessages` / `ChatRunEvents` / `ChatCostLedger` exported from `packages/db/src/schema`.

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 7 created/referenced files confirmed present on disk; both task commits (`719f1b2`, `654392d`) confirmed present in `git log --oneline --all`.
