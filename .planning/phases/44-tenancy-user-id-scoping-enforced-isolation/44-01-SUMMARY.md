---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 01
subsystem: database
tags: [drizzle, postgres, supabase-auth, tenancy, migrations]

# Dependency graph
requires:
  - phase: 43-auth-google-oauth-sessions-supabase-auth
    provides: Supabase Auth (auth.users, auth.uid()) — the FK target this plan anchors to
provides:
  - user_id uuid column (nullable → NOT NULL) on importers, chat_conversations, chat_cost_ledger, each FK -> auth.users(id) ON DELETE CASCADE
  - packages/db/src/schema/_auth.ts minimal auth.users(id) reference for cross-schema FK modeling
  - migrate.ts BACKFILL_USER_ID override wiring (session GUC on a single dedicated connection)
  - PROJECT.md-recorded app-boundary-primary / RLS-defense-in-depth enforcement architecture decision (TENA-04 ordering gate)
  - genui_generation_events / ui_spec_templates documented as deliberately unscoped
affects: [44-02, 44-03, 44-04, tRPC procedures, FastAPI repositories, RLS policy work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-schema FK reference stub (pgSchema('auth').table('users', { id: uuid().primaryKey() })) instead of redeclaring the full Supabase-managed auth.users shape"
    - "Expand -> backfill -> contract as three sequential migrations (nullable add -> fail-loud backfill -> SET NOT NULL)"
    - "Fail-loud backfill guard (RAISE EXCEPTION unless exactly one auth.users row, or BACKFILL_USER_ID overrides via session GUC)"

key-files:
  created:
    - packages/db/src/schema/_auth.ts
    - packages/db/migrations/0031_add_user_id_columns.sql
    - packages/db/migrations/0032_backfill_user_id.sql
    - packages/db/migrations/0033_user_id_not_null.sql
  modified:
    - packages/db/src/schema/importers.ts
    - packages/db/src/schema/chat-conversations.ts
    - packages/db/src/schema/chat-cost-ledger.ts
    - packages/db/src/schema/index.ts
    - packages/db/src/schema/genui-generation-events.ts
    - packages/db/src/schema/ui-spec-templates.ts
    - packages/db/src/client.ts
    - packages/db/src/migrate.ts
    - packages/db/migrations/meta/_journal.json
    - .planning/PROJECT.md

key-decisions:
  - "App-boundary enforcement is PRIMARY (session-derived user_id, never client-supplied); Supabase RLS is DEFENSE-IN-DEPTH only — recorded in PROJECT.md before any RLS policy work (TENA-04), citing the Drizzle superuser-connection precedent (packages/db/src/client.ts:28-36)"
  - "genui_generation_events and ui_spec_templates stay deliberately unscoped (no user_id) — cross-tenant exact-match cache hits are the intended behavior"
  - "Seeded one deterministic local-dev-only auth.users row (10000000-0000-0000-0000-000000000001) because local auth.users had zero rows (no Google OAuth client configured yet) — not a tracked migration, ad hoc script only, documented here per the plan's fallback instruction"

patterns-established:
  - "Cross-schema FK stub tables (auth schema) must never emit CREATE TABLE in generated migrations — the migrating role lacks CREATE on schema auth; strip/guard that statement by hand after generate"
  - "Journal 'when' timestamps must exceed the previously-recorded value or the timestamp-gated migrator silently no-ops new migrations; verify entries after every generate on this repo until the historical fake-future-timestamp problem is addressed at the source"

requirements-completed: [TENA-01, TENA-02, TENA-04]

duration: 45min
completed: 2026-07-09
---

# Phase 44 Plan 01: Tenancy Schema Anchor Summary

**Added `user_id uuid REFERENCES auth.users(id)` to importers/chat_conversations/chat_cost_ledger via a live expand→backfill→contract migration sequence (0031-0033), recorded the app-boundary-primary/RLS-defense-in-depth decision in PROJECT.md, and fixed two pre-existing Drizzle tooling defects (stale snapshot drift from 0025-0030 custom migrations, and a synthetic future-dated journal timestamp that silently no-ops new migrations) that would have blocked every future migration in this repo.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-09T22:10:00-03:00 (approx.)
- **Completed:** 2026-07-09T22:56:00-03:00
- **Tasks:** 3
- **Files modified:** 14 (4 created, 10 modified) across the 3 task commits

## Accomplishments

- `importers`, `chat_conversations`, `chat_cost_ledger` each carry a `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` + btree index, live-verified against the local Supabase DB (zero null rows, contract confirmed via `information_schema`)
- `packages/db/src/schema/_auth.ts` — minimal `pgSchema("auth").table("users", { id })` stub so Drizzle can model the cross-schema FK without redeclaring Supabase's managed `auth.users` shape
- `migrate.ts` restructured to run the whole migration on ONE dedicated pool connection (not the bare `Pool`), so the `BACKFILL_USER_ID` session GUC — when set — is visible inside the same Postgres session that runs the migration transaction; `BACKFILL_USER_ID` added as an optional validated env var in `client.ts`
- `0032_backfill_user_id.sql` — fail-loud `DO $$` block: refuses to run unless `auth.users` has exactly one row (or `BACKFILL_USER_ID` overrides via `current_setting('app.backfill_user_id', true)`), idempotent `UPDATE ... WHERE user_id IS NULL`, and a post-backfill completeness assertion
- `PROJECT.md` Key Decisions: app-boundary-primary / RLS-defense-in-depth enforcement architecture recorded before any RLS work (TENA-04 ordering gate), citing the Drizzle superuser-connection precedent
- `genui_generation_events` and `ui_spec_templates` schema comments + PROJECT.md document them as deliberately unscoped

## Task Commits

1. **Task 1: Record enforcement-architecture decision + document genui cache tables as deliberately unscoped** - `bf2ffb1` (docs)
2. **Task 2: Add nullable user_id columns + FK to auth.users, generate & apply the EXPAND migration locally** - `b060ab2` (feat)
3. **Task 3: Backfill to the first real user + CONTRACT to NOT NULL, applied & verified locally** - `a950ae3` (feat)

_Note: Task 2 and Task 3 commits each bundle a hand-edited migration file plus the Drizzle tooling-drift fixes required to generate them correctly — see Deviations below._

## Files Created/Modified

- `packages/db/src/schema/_auth.ts` - Minimal `auth.users(id)` reference for cross-schema FK modeling
- `packages/db/src/schema/importers.ts` - Adds `userId` (NOT NULL, FK -> auth.users, indexed) — the tenant anchor
- `packages/db/src/schema/chat-conversations.ts` - Adds direct `userId` (NOT NULL, FK, indexed)
- `packages/db/src/schema/chat-cost-ledger.ts` - Adds direct `userId` (NOT NULL, FK, indexed)
- `packages/db/src/schema/index.ts` - Exports `_auth` before `importers` (dependency order)
- `packages/db/src/schema/genui-generation-events.ts` - Comment: deliberately unscoped
- `packages/db/src/schema/ui-spec-templates.ts` - Comment: deliberately unscoped
- `packages/db/src/client.ts` - Adds optional validated `BACKFILL_USER_ID` env var
- `packages/db/src/migrate.ts` - Single dedicated connection for the whole run; sets `app.backfill_user_id` session GUC when override present
- `packages/db/migrations/0031_add_user_id_columns.sql` - Expand: nullable `user_id` + FK + index on all three tables (CREATE TABLE auth.users stub stripped — see deviations)
- `packages/db/migrations/0032_backfill_user_id.sql` - Backfill: fail-loud, idempotent, override-able
- `packages/db/migrations/0033_user_id_not_null.sql` - Contract: `SET NOT NULL` on all three
- `packages/db/migrations/meta/_journal.json` - 3 new entries (31-33) with hand-corrected `when` timestamps
- `.planning/PROJECT.md` - Key Decisions: enforcement architecture + genui-unscoped documentation

## Decisions Made

- **App-boundary primary, RLS defense-in-depth** — recorded per plan requirement, citing `packages/db/src/client.ts:28-36` (Drizzle connects as Postgres superuser via `POSTGRES_URL_NON_POOLING`, bypassing RLS for every app query)
- **Local-dev auth.users seed** — local `auth.users` had zero rows (no Google OAuth client configured yet, per Phase 43's pending runbook). Per the plan's documented fallback, seeded one deterministic row (`10000000-0000-0000-0000-000000000001`, email `local-dev@polytoken.local`) via an ad hoc script (NOT a tracked migration — this is local-dev-only scaffolding; staging/prod will have real rows via Supabase Auth and never run this seed). All backfilled rows point at this id.
- **CREATE TABLE stub removed from 0031** — the generated migration originally included `CREATE TABLE "auth"."users"` (Drizzle doesn't know the real Supabase-managed table already exists). The migrating `postgres` role has `rolsuper = false` and lacks `CREATE` on schema `auth` (confirmed via `permission denied for schema auth` on first apply attempt); the statement was removed entirely (not just IF-NOT-EXISTS-guarded, since even that failed on the permission check before existence was evaluated).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale Drizzle snapshot metadata caused `generate` to compute 6 migrations of already-applied drift**
- **Found during:** Task 2 (first `npm run migration:generate` call)
- **Issue:** Migrations 0025-0030 were hand-written `--custom` migrations that added real schema (new tables `autofill_retrieval_events`/`chat_widget_interactions`, new columns `tier`/`provenance`/`is_active`/`promotion` on `knowledge_nodes`/`knowledge_node_edges`) but never got matching `meta/NNNN_snapshot.json` files (confirmed: `drizzle-kit generate --custom` does not emit a snapshot). `generate` therefore diffed against the last present snapshot (`0024`) and produced a migration re-creating all of 0025-0030's objects on top of this plan's actual `user_id` changes — which would have failed with "already exists" errors against the local DB (independently confirmed: all those objects already exist locally).
- **Fix:** Reverted the phase-44 schema edits temporarily (`git checkout --` for tracked files, moved `_auth.ts` aside), ran `generate` against the reverted (pre-phase-44, post-0030) schema to produce a clean reconciliation snapshot reflecting true post-0030 state, discarded that migration's SQL (already applied — verified live against the DB) and its journal entry, promoted the resulting snapshot file to fill the missing `0030_snapshot.json` gap, then restored the phase-44 schema edits and regenerated. The second `generate` produced exactly the intended 3-table `user_id` diff with no unrelated drift.
- **Files modified:** `packages/db/migrations/meta/0030_snapshot.json` (new, backfilled), `packages/db/migrations/meta/0031_snapshot.json` (new)
- **Verification:** `npm run check` (drizzle-kit check) reports "Everything's fine"; regenerated 0031 SQL contains only `auth.users` + the 3 `user_id` ALTERs, no 0025-0030 objects
- **Committed in:** `b060ab2` (Task 2 commit)

**2. [Rule 3 - Blocking] Synthetic future-dated journal timestamp silently no-ops the migrator**
- **Found during:** Task 2 (first `npm run migrate:local` after generating 0031 reported "Migrations completed" in 12ms but the `user_id` columns were absent)
- **Issue:** `migrations/meta/_journal.json` entry 30 (`0030_confirm_action_widget_kind`) carries `"when": 1783708800000` — a round-number timestamp roughly 17 hours ahead of real wall-clock time at execution (`Date.now()` ≈ `1783647774349`). Drizzle's `node-postgres` migrator (`node_modules/drizzle-orm/pg-core/dialect.js`) gates every migration on `lastDbMigration.created_at < migration.folderMillis`; since new migrations get real `Date.now()`-based `folderMillis`, they were all `<` the already-recorded (future-dated) `created_at` for entry 30, so the loop silently skipped them without error.
- **Fix:** Hand-set `when` for the newly generated entries (31, 32, 33) to values exceeding entry 30's `1783708800000`, following the existing round-day (+86400000ms) increment pattern already present in the journal history (`1783795200000`, `1783881600000`, `1783968000000`).
- **Files modified:** `packages/db/migrations/meta/_journal.json`
- **Verification:** Re-ran `npm run migrate:local` after each fix; `information_schema` queries confirmed the columns/constraints actually landed
- **Committed in:** `b060ab2`, `a950ae3` (Task 2 and Task 3 commits)
- **Follow-up flag:** This is a repo-wide latent defect, not scoped to this plan — any future `drizzle-kit generate --custom` on this repo will again produce a `when` that is likely less than entry 30 (or whatever the current max is) until real wall-clock time naturally passes it, or until someone corrects the historical entries at the source. Left undisturbed (Rule 3 scope boundary: only fixed what blocked this plan's own new entries) and flagged here for the next migration author.

**3. [Rule 3 - Blocking] Generated CREATE TABLE for auth.users failed with permission denied**
- **Found during:** Task 2 (second `npm run migrate:local` attempt, after fixing the timestamp)
- **Issue:** `auth.users` is Supabase-managed and already exists locally, but Drizzle's `generate` (seeing it declared fresh in `_auth.ts` with no prior snapshot) emitted `CREATE TABLE "auth"."users" (...)`. The migrating `postgres` role is not a true Postgres superuser (`rolsuper = false`, confirmed via `pg_roles` query) and has no `CREATE` privilege on schema `auth`, so even an `IF NOT EXISTS`-guarded version failed with `permission denied for schema auth`.
- **Fix:** Removed the `CREATE TABLE` statement from `0031_add_user_id_columns.sql` entirely — the FK constraints (`REFERENCES "auth"."users"("id")`) apply cleanly without it since the real table already exists and the role has implicit REFERENCES access.
- **Files modified:** `packages/db/migrations/0031_add_user_id_columns.sql`
- **Verification:** Migration applied cleanly afterward; FK constraints confirmed present via `pg_constraint` query
- **Committed in:** `b060ab2`

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking issues, all pre-existing Drizzle tooling/environment defects surfaced by this plan's first `generate`/`migrate:local` calls, none caused by logic errors in this plan's own schema/migration code)
**Impact on plan:** All three were necessary to make the expand→backfill→contract sequence actually apply — without them, `migrate:local` would either fail outright or silently report success while doing nothing. No scope creep: fixes were limited to what this plan's own migrations required; the historical timestamp defect (deviation 2) is flagged but not exhaustively repaired across all 30 prior entries.

## Issues Encountered

None beyond the deviations above (all resolved inline).

## User Setup Required

None - no external service configuration required. (Local-dev auth.users seed is documented above and is not something a human needs to act on; it will simply be superseded once a real Google OAuth sign-in happens locally per Phase 43's runbook.)

## Next Phase Readiness

- Plan 04 (RLS policy work) is unblocked: the PROJECT.md enforcement-architecture decision is recorded.
- Plans 02/03 (tRPC/FastAPI ownership sweep) can now reference `user_id` on all three tables; no consumer code in `apps/web` or `apps/api` currently constructs `Importers`/`ChatConversations`/`ChatCostLedger` inserts directly (grep-verified), so the new `NOT NULL` constraint does not break any existing call site — those plans will be the first to write `user_id` from `ctx.user`/`X-User-Id`.
- Flag for whoever next runs `drizzle-kit generate --custom` on this repo: verify the new journal entry's `when` exceeds the current max (currently `1783968000000` after this plan) before running `migrate:local` — see Deviation 2.

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-09*
