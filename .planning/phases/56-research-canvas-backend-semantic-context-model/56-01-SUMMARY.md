---
phase: 56-research-canvas-backend-semantic-context-model
plan: 01
subsystem: database
tags: [drizzle, postgres, migration, schema, research-canvas]

# Dependency graph
requires:
  - phase: 54-email-cluster-workflow-e3
    provides: chat_conversations.thread_id linkage precedent (D-54), ownership.ts assertConversationOwnership taxonomy, knowledge_node_edges polymorphic-edge + partial-unique active-identity idiom
provides:
  - "chat_source_ledger table (migration 0037): conversation-anchored, zero-knowledge-graph-write candidate pool for auto-collected tool sources (RCNV-01)"
  - "chat_context_edges table (migration 0037): D-54-mandated durable semantic linkage store, jsonb sourceRef discriminated union + derived sourceRefKey, partial-unique active-identity index (RCNV-04)"
  - "Drizzle schema files + barrel exports for both tables, fully typed (ChatSourceLedgerRow/InsertChatSourceLedger, ChatContextEdgeRow/InsertChatContextEdge)"
  - "Migration 0037_serious_sugar_man.sql + meta/0037_snapshot.json + appended journal idx 37 -- AUTHORED + GENERATED, NOT APPLIED to any environment"
affects: [56-02, 56-03, 56-04, 56-05, 57, 63]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "jsonb discriminated-union sourceRef + derived text sourceRefKey column for a polymorphic edge's identity index (avoids 4 nullable typed columns, no migration needed for a future 5th source kind)"
    - "conversationId-anchored tenancy (ON DELETE CASCADE to chat_conversations), never importer_id, for chat-conversation-descendant tables"

key-files:
  created:
    - packages/db/src/schema/chat-source-ledger.ts
    - packages/db/src/schema/chat-context-edges.ts
    - packages/db/migrations/0037_serious_sugar_man.sql
    - packages/db/migrations/meta/0037_snapshot.json
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "Migration number is 0037 (drizzle-computed via drizzle-kit generate, journal idx 37, tag 0037_serious_sugar_man) -- previous head was idx 36 (0036_chat_conversation_thread_id). Downstream plans (56-02..05) must reference 0037, not an assumed number."
  - "Both new tables in ONE combined generate pass (single migration file/snapshot) rather than two separate migrations -- no ordering dependency between the two tables, matches the plan's stated discretion."
  - "sourceRef kept as a single jsonb discriminated-union column + derived sourceRefKey text column (not 4 nullable typed columns) per RESEARCH.md's Alternatives-Considered recommendation."

requirements-completed: []  # Wave 1 of 3 — data-model foundation only. Per 56-RESEARCH.md's
  # own sequencing, RCNV-01 isn't satisfied until the Python auto-collect write hook lands
  # (56-02) and RCNV-04 isn't satisfied until the linked-context read/inject pipeline lands
  # (a later wave) -- both left Pending in REQUIREMENTS.md by this plan, intentionally.

# Metrics
duration: ~20min
completed: 2026-07-15
---

# Phase 56 Plan 01: Backend Data Model Foundation Summary

**Two new additive Postgres tables (chat_source_ledger, chat_context_edges) authored as Drizzle schema and captured in migration 0037 -- generated offline, not applied to any environment.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-15T05:43:45Z
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 created schema files, 1 barrel edit, 1 generated SQL migration, 1 generated snapshot, 1 journal append)

## Accomplishments
- `chat_source_ledger` (RCNV-01): conversation-anchored zero-knowledge-graph-write candidate pool, unique (conversation_id, tool_use_id, result_index) dedupe index for idempotent-retry-safe writes, importer_id kept FK-less/denormalized.
- `chat_context_edges` (RCNV-04): D-54-mandated durable semantic linkage store with a jsonb `sourceRef` discriminated union (`source_ledger`/`knowledge_node`/`genui_panel`/`email_thread`) + derived `sourceRefKey`, partial unique active-identity index mirroring `knowledge_node_edges`.
- Migration **0037** (`0037_serious_sugar_man.sql`) generated offline (no live DB connection) via `drizzle-kit generate` -- drizzle computed the idx itself (37, previous head 36), not hand-authored. SQL is CREATE-TABLE-only: 2 `CREATE TABLE`, 3 `ALTER TABLE ADD CONSTRAINT` (FKs on the two brand-new tables only), 4 `CREATE INDEX`/`CREATE UNIQUE INDEX` -- zero `ALTER`/`DROP` against any pre-existing table.

## Task Commits

Each task was committed atomically:

1. **Task 1: chat_source_ledger Drizzle schema (RCNV-01 table)** - `2a3a766` (feat)
2. **Task 2: chat_context_edges Drizzle schema (RCNV-04 linkage store)** - `a6e6e22` (feat)
3. **Task 3: Barrel export + generate the migration (offline)** - `895253e` (feat)

**Plan metadata:** (this commit, see below)

## Files Created/Modified
- `packages/db/src/schema/chat-source-ledger.ts` - `ChatSourceLedger` pgTable, `ChatSourceLedgerRow`/`InsertChatSourceLedger` inferred types
- `packages/db/src/schema/chat-context-edges.ts` - `ChatContextEdges` pgTable, `ChatContextEdgeRow`/`InsertChatContextEdge` inferred types
- `packages/db/src/schema/index.ts` - two new `export * from` lines appended after `chat-widget-interactions.ts`
- `packages/db/migrations/0037_serious_sugar_man.sql` - generated CREATE-TABLE-only migration for both tables
- `packages/db/migrations/meta/0037_snapshot.json` - generated full-schema snapshot
- `packages/db/migrations/meta/_journal.json` - one appended entry, idx 37, tag `0037_serious_sugar_man`

## Decisions Made
- Migration number confirmed as **0037** (not the RESEARCH.md-assumed 0037/0038 split) -- both tables landed in a single generate pass since neither has an ordering dependency on the other, matching the plan's stated discretion ("Whether migrations ship as two separate migrations or one combined pass... planner's call").
- Kept `sourceRef` as jsonb + derived `sourceRefKey`, per the plan's locked column spec and RESEARCH.md's Alternatives-Considered recommendation (Assumption A5 in RESEARCH.md, flagged discretionary -- taken as-is).
- Tenancy on both tables resolves exclusively via `conversationId`/`targetConversationId` -> `chat_conversations` (ON DELETE CASCADE); `importerId` on `chat_source_ledger` is a plain uuid column with no FK, matching the `chat_cost_ledger` idiom and Pitfall 2's explicit warning.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' acceptance criteria matched the plan's specified columns, indexes, FK behaviors, and doc-comment content without modification.

## Issues Encountered

None. `npx tsc --noEmit -p tsconfig.json` was clean both per-task (Task 1/Task 2 individual greps returned "typechecks clean") and after the barrel export was wired in (Task 3, `npm run typecheck` clean, no output = success). `drizzle-kit generate` ran fully offline against `.env.local` with no live DB connection required, exactly per the 54-01/0036 precedent this plan's RESEARCH.md cited.

## User Setup Required

None - no external service configuration required. Migration 0037 is AUTHORED + GENERATED but NOT APPLIED to any environment (no `drizzle-kit push`/`migrate` run this plan). Applying it local -> staging -> prod is a documented later step, per the plan's own stated scope boundary (mirrors the 54-01/0036 "authored vs applied" distinction). Every downstream Python/TS reader/writer of these two tables MUST feature-detect via the `tableColumnExists` idiom (or equivalent table-existence check) until 0037 is actually applied.

## Next Phase Readiness

- Both tables exist as compiling, barrel-exported Drizzle schema with inferred row/insert types -- ready for 56-02 (Python auto-collect write hook), 56-03 (tRPC `createContextEdge`/`listContextEdges` seam), 56-04 (Python linked-context read/inject pipeline), and 56-05 (promotion-gate reuse adapter) to build against.
- **Migration number for all downstream plans to reference: 0037** (`0037_serious_sugar_man.sql`). Do not assume 0037/0038 split from RESEARCH.md -- confirmed as a single combined migration this session.
- No blockers. Docker/Supabase remains unverified-available this session (not probed) -- applying 0037 to a live environment is deferred, matching this milestone's standing "authored, not applied" posture for offline-authored migrations.

---
*Phase: 56-research-canvas-backend-semantic-context-model*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created files verified present on disk (chat-source-ledger.ts, chat-context-edges.ts,
0037_serious_sugar_man.sql, 0037_snapshot.json, this SUMMARY.md). All three task commits
(2a3a766, a6e6e22, 895253e) verified present in `git log --oneline --all`.
