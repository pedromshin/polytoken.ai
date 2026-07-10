---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 04
subsystem: database
tags: [postgres, rls, supabase-auth, tenancy, migrations, defense-in-depth]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    provides: "Plan 01's user_id columns (importers/chat_conversations/chat_cost_ledger) + the PROJECT.md app-boundary-primary/RLS-defense-in-depth decision (TENA-04 ordering gate)"
provides:
  - "Migration 0034: auth.uid()-based PERMISSIVE ownership policies replacing the authenticated RESTRICTIVE deny-all on 13 user-owned tables"
  - "Live-verified defense-in-depth RLS layer — a future PostgREST/non-superuser/anon-key path is scoped to auth.uid(), even though Drizzle (superuser) and FastAPI (service_role) bypass it today"
affects: [44-08, "any future non-superuser DB access path (PostgREST, direct anon-key clients)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RLS ownership policy shape: DROP the RESTRICTIVE authenticated deny-all from 0001/later, CREATE a PERMISSIVE <table>_owner_authenticated policy scoped to auth.uid() (direct or via one importers join)"
    - "Nullable-importer_id system-default idiom: USING allows importer_id IS NULL (read-only visibility), WITH CHECK forbids authenticated sessions from writing NULL rows"
    - "Schema-accuracy deviation: when a planned join-column assumption doesn't match the actual schema (knowledge_node_edges has no importer_id), adapt the policy to the real FK chain rather than forcing the planned shape"

key-files:
  created:
    - packages/db/migrations/0034_rls_user_scoping.sql
    - packages/db/migrations/meta/0034_snapshot.json
  modified:
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "knowledge_node_edges has no importer_id column (schema-verified against packages/db/src/schema/knowledge-node-edges.ts) — its ownership policy scopes via source_node_id -> knowledge_nodes.importer_id -> importers.user_id instead of a direct importer_id predicate"
  - "Policy naming convention established: <table>_owner_authenticated (PERMISSIVE), paired with the existing deny_all_<table>_authenticated (RESTRICTIVE, dropped) / deny_all_<table>_anon (RESTRICTIVE, untouched) precedent from 0001/0020/0022/0023"

requirements-completed: [TENA-04]

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 44 Plan 04: RLS Ownership Policies (Defense-in-Depth) Summary

**Migration 0034 replaces the authenticated RESTRICTIVE deny-all with `auth.uid()`-scoped PERMISSIVE ownership policies on 13 user-owned tables, applied and live-verified locally with zero regression across the api-client vitest and email-listener pytest suites.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T02:28:00Z (approx.)
- **Completed:** 2026-07-10T03:03:10Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `packages/db/migrations/0034_rls_user_scoping.sql` authored: for each of 13 user-owned tables, drops the `deny_all_<table>_authenticated` RESTRICTIVE policy and creates a PERMISSIVE `<table>_owner_authenticated` policy
  - Direct `user_id` (3 tables): `importers`, `chat_conversations`, `chat_cost_ledger` — `USING/WITH CHECK (user_id = auth.uid())`
  - Hard-FK importer descendants (7 tables): `emails`, `email_attachments`, `email_components`, `extraction_records`, `entity_instances`, `sender_profiles`, `knowledge_nodes` — `USING/WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))`
  - Nullable-importer_id system-default tables (2 tables): `entity_types`, `entity_type_fields` — `USING` additionally allows `importer_id IS NULL` (seeded system defaults stay readable); `WITH CHECK` forbids an authenticated session from writing `importer_id IS NULL` rows
  - `knowledge_node_edges` (1 table, schema deviation) — scoped via `source_node_id IN (SELECT kn.id FROM knowledge_nodes kn JOIN importers i ON i.id = kn.importer_id WHERE i.user_id = auth.uid())` since the table has no `importer_id` column of its own
- Applied locally via `npm run migrate:local` (23 tables, no error)
- Live-verified `pg_policies`: 13 tables now carry an `auth.uid()`-qualified policy (exceeds the plan's 8-table minimum); all 22 pre-existing `deny_all_*_anon` RESTRICTIVE policies remain untouched
- Non-regression proof: `packages/api-client` vitest (216/216 passed), `apps/email-listener` `tests/presentation/api/v1` pytest (14/14 passed) — both green post-apply, confirming the Drizzle-superuser / FastAPI-service_role RLS bypass documented in PROJECT.md holds
- `drizzle-kit check` reports "Everything's fine" and `packages/db` typecheck is clean after the migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the auth.uid() RLS ownership policies migration** - `e3185eb` (feat)
2. **Task 2: [BLOCKING] Apply RLS locally + prove zero app regression** - `544f897` (fix)

_Note: Task 2 produced no schema/code changes of its own — it applied Task 1's migration and ran live verification queries. The one artifact committed under Task 2 (`meta/0034_snapshot.json`) is a byproduct of Task 1's `drizzle-kit generate --custom` invocation that wasn't caught until the pre-commit review for Task 1 had already landed; it is purely bookkeeping metadata (drizzle-kit's internal schema-diff snapshot chain), not application logic._

## Files Created/Modified

- `packages/db/migrations/0034_rls_user_scoping.sql` - The RLS ownership policy migration (13 tables, top-of-file comment documenting the Drizzle-superuser/service_role bypass)
- `packages/db/migrations/meta/0034_snapshot.json` - drizzle-kit's schema snapshot for migration 0034 (chains cleanly from 0033; `drizzle-kit check` confirms integrity)
- `packages/db/migrations/meta/_journal.json` - New entry 34, `when` hand-corrected to `1784054400000` (the established +86400000ms round-day increment pattern from 44-01) after the known timestamp-gated-migrator gotcha reproduced verbatim

## Decisions Made

- **knowledge_node_edges join-through-knowledge_nodes** — the plan's interfaces block instructed "scope by their importer_id... confirm the column exists"; it does NOT exist on this table (confirmed against the Drizzle schema file), so the policy was adapted to join through `source_node_id -> knowledge_nodes.importer_id -> importers.user_id` instead of a direct predicate. This preserves the same ownership semantics with the real FK chain.
- **Policy naming**: no prior repo precedent for a PERMISSIVE `auth.uid()` policy existed to follow, so `<table>_owner_authenticated` was established as the paired name for the existing `deny_all_<table>_authenticated`/`deny_all_<table>_anon` convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] knowledge_node_edges has no importer_id column — adapted the policy to the real FK chain**
- **Found during:** Task 1 (read_first schema review of `knowledge-node-edges.ts`)
- **Issue:** The plan's interfaces block assumed `knowledge_node_edges` could be "scope[d] by their importer_id the same way" as `knowledge_nodes`, but the table only has `source_node_id` (FK to `knowledge_nodes.id`) — no `importer_id` column exists on it.
- **Fix:** Wrote the `USING`/`WITH CHECK` predicate as `source_node_id IN (SELECT kn.id FROM knowledge_nodes kn JOIN importers i ON i.id = kn.importer_id WHERE i.user_id = auth.uid())`, an equivalent one-hop-further join.
- **Files modified:** `packages/db/migrations/0034_rls_user_scoping.sql`
- **Verification:** `pg_policies` query confirms `knowledge_node_edges` carries an `auth.uid()`-qualified policy alongside the other 12 tables.
- **Committed in:** `e3185eb` (Task 1 commit)

**2. [Rule 3 - Blocking] Journal timestamp-gated-migrator gotcha reproduced (same defect flagged by 44-01)**
- **Found during:** Task 1 (immediately after `npm run migration:generate:custom -- --name=rls_user_scoping`)
- **Issue:** The new journal entry 34's real-`Date.now()`-based `when` (`1783652129013`) was less than entry 33's future-dated `when` (`1783968000000`), which would silently no-op the migration on the next `migrate:local` run per the mechanism 44-01 already documented (Drizzle's node-postgres migrator gates on `created_at < folderMillis`).
- **Fix:** Hand-set entry 34's `when` to `1784054400000` (entry 33's value + 86400000ms), following the exact round-day increment pattern already established in the journal history.
- **Files modified:** `packages/db/migrations/meta/_journal.json`
- **Verification:** `npm run migrate:local` completed in 59ms with "23 tables" reported, and the live `pg_policies` query subsequently confirmed the new policies actually landed (not a silent no-op).
- **Committed in:** `e3185eb` (Task 1 commit)

**3. [Rule 3 - Blocking] Uncommitted drizzle-kit snapshot byproduct discovered post-Task-1-commit**
- **Found during:** Task 2 (git status check before running verification queries)
- **Issue:** `drizzle-kit generate --custom` (run once during Task 1 to obtain the correctly-numbered empty migration file) emitted `meta/0034_snapshot.json` as a byproduct. This wasn't caught before Task 1's commit landed.
- **Fix:** Verified the snapshot chains correctly from 0033 (`drizzle-kit check` → "Everything's fine") and committed it in Task 2's commit rather than leaving it untracked.
- **Files modified:** `packages/db/migrations/meta/0034_snapshot.json` (new)
- **Verification:** `npm run check` (drizzle-kit check) reports "Everything's fine"; `npm run typecheck` clean.
- **Committed in:** `544f897` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 - schema-accuracy bug fix, 2 Rule 3 - blocking pre-existing tooling gotchas, all previously flagged/precedented by Plan 01's own deviations)
**Impact on plan:** All three were necessary for correctness (deviation 1: the planned predicate wouldn't have compiled/would have been semantically wrong; deviation 2: silent no-op would have left RLS unapplied while reporting success; deviation 3: bookkeeping completeness). No scope creep — no unrelated tables or policies touched.

## Issues Encountered

None beyond the deviations above (all resolved inline).

## User Setup Required

None - no external service configuration required. This is a local-only migration per the standing constraint; staging/prod deploy stays in the user's queue.

## pg_policies Verification (as observed)

Tables carrying an `auth.uid()`-qualified policy after applying 0034 (13, exceeding the plan's 8-table minimum):

`chat_conversations`, `chat_cost_ledger`, `email_attachments`, `email_components`, `emails`, `entity_instances`, `entity_type_fields`, `entity_types`, `extraction_records`, `importers`, `knowledge_node_edges`, `knowledge_nodes`, `sender_profiles` — each with exactly 1 matching policy (the new `<table>_owner_authenticated`).

All 22 pre-existing `deny_all_*_anon` RESTRICTIVE policies (spanning every RLS-enabled table in the schema, not just the 13 above) remain present and unmodified.

## Next Phase Readiness

- TENA-04 is now substantively complete (both halves: the PROJECT.md architecture decision from Plan 01, and the live RLS policies from this plan) — it was already checked off in REQUIREMENTS.md by Plan 01, which was premature at the time but is now accurate.
- Plan 08 (the adversarial cross-tenant test gate, TENA-03's completion point) can rely on this defense-in-depth layer being live, though it must continue to prove the PRIMARY app-boundary wall independently — RLS here is invisible to every current app query path.
- Known pre-existing, out-of-scope RED: `packages/api-client` typecheck remains red (2 chat insert sites missing `user_id`) — explicitly Plan 44-07's scope, untouched here per the sequential-executor brief.

## Self-Check: PASSED

- Created files verified on disk: `packages/db/migrations/0034_rls_user_scoping.sql`, `packages/db/migrations/meta/0034_snapshot.json` — both FOUND
- Commits verified in `git log`: `e3185eb`, `544f897` — both FOUND
- Re-ran plan-level `<verification>`: `npm run migrate:local` (23 tables, no error) — PASS; `pg_policies` shows `auth.uid()` policies on 13 user-owned tables, anon deny-all intact (22 policies) — PASS; `packages/api-client` vitest (216/216) + `apps/email-listener` `api/v1` pytest (14/14) both green post-apply — PASS

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
