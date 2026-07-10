---
phase: 44-tenancy-user-id-scoping-enforced-isolation
plan: 06
subsystem: api
tags: [trpc, tenancy, ownership, drizzle, vitest, entities-router, entity-types-router, knowledge-router]

# Dependency graph
requires:
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 02
    provides: "@polytoken/db/ownership — userOwnedImporterIds + assertImporterOwnership + OwnershipError"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 05
    provides: "packages/api-client/src/router/_ownership.ts — assertOwnedOrNotFound shared wrapper (reused, not re-derived)"
provides:
  - "entities/entity-types/knowledge tRPC routers fully on protectedProcedure — every read owned-importer scoped, every id-addressed op ownership-asserted"
  - "packages/api-client/src/router/_scope.ts — resolveListScope, the shared pure list-scope helper (same semantics as emails/index.ts's 44-05 copy) used by entities.list and knowledge.list"
  - "entity-types write policy: NULL-importer (system default) types/fields are WRITE-REJECTED (FORBIDDEN) from user sessions; create rejected outright (FastAPI only mints system defaults)"
  - "knowledge.graph D-11 explicit-edge union now bounded to owned importers via the source node's importer (was completely unscoped)"
  - "knowledge.expandNode seed-ownership gate (T-44-06-03) — 'expand any node id' gap closed"
affects: [44-07, 44-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveListScope extracted to router/_scope.ts as THE shared list-scope helper for new sweeps (emails/index.ts keeps its own 44-05 copy — its tests bind to that export; consolidation is a trivial future cleanup)"
    - "Load-then-assert recipe for id-addressed rows without a dedicated assert* function: load the row's importer_id, then assertImporterOwnership(ctx.db, importerId, ctx.user.id) via assertOwnedOrNotFound; a MISSING row throws the same TRPCError NOT_FOUND directly (fail-closed, no oracle)"
    - "System-default preservation: entity_types/entity_type_fields queries use or(isNull(importerId), inArray(importerId, owned)) — collapsing to isNull-only for an owner-less caller — so the migration-seeded taxonomy stays visible (D-02 never-blank) while foreign overrides never leak; the field-scope lives in the leftJoin ON clause so a type whose field rows are all filtered still surfaces with fields: []"
    - "Queue-based fake Drizzle chain (knowledge-user-scoping.test.ts): each select() consumes the next seeded result, letting a multi-query procedure like knowledge.graph be asserted layer-by-layer (select-call count proves which tenant-bounded layers were SKIPPED for an owner-less caller)"

key-files:
  created:
    - packages/api-client/src/router/_scope.ts
    - packages/api-client/src/router/entities/entities-user-scoping.test.ts
    - packages/api-client/src/router/knowledge/knowledge-user-scoping.test.ts
  modified:
    - packages/api-client/src/router/entities/gallery.ts
    - packages/api-client/src/router/entities/detail.ts
    - packages/api-client/src/router/entities/mutations.ts
    - packages/api-client/src/router/entities/mutations.test.ts
    - packages/api-client/src/router/entity-types.ts
    - packages/api-client/src/router/entity-types-write.ts
    - packages/api-client/src/router/__tests__/entity-types-write.test.ts
    - packages/api-client/src/router/knowledge/list.ts
    - packages/api-client/src/router/knowledge/graph.ts
    - packages/api-client/src/router/knowledge/detail.ts
    - packages/api-client/src/router/knowledge/expand.ts

key-decisions:
  - "entityTypes.create is FORBIDDEN outright from user sessions (the plan's 'reject or require an owned importer' fork resolved to REJECT): the FastAPI POST /v1/entity-types use case creates system-default (importer_id NULL) types only (manage_entity_types.py D-26 docstring), so 'require an owned importer' is not implementable without touching FastAPI — outside this plan's file list. Importer-scoped creation is left as an explicit future seam."
  - "knowledge.graph fails closed to a fully EMPTY graph (no system-default taxonomy either) when a NON-OWNED importerId filter is supplied — an attacker probing a foreign id learns nothing; whereas an owner-less caller WITHOUT a filter still sees the seeded taxonomy (D-02 never-blank), with all tenant-owned layers (instance counts, instances, components, knowledge nodes, explicit edges) skipped entirely."
  - "resolveListScope extracted to a new shared _scope.ts (not in the plan's files_modified, mirroring 44-05's sanctioned _ownership.ts extraction) instead of duplicating the allow/deny matrix a 3rd and 4th time in gallery.ts + knowledge/list.ts. emails/index.ts's own copy left untouched (44-05's committed tests import it)."
  - "graph's D-11 explicit-edge union — previously a completely UNSCOPED select over knowledge_node_edges — is now innerJoined to KnowledgeNodes on sourceNodeId and bounded to owned importers (the same source-node anchor expand.ts's T-32-02 uses), satisfying the plan's 'every sub-query must be bounded' requirement."
  - "entity-types list field rows get the NULL-or-owned scope in the leftJoin ON clause (not WHERE) so a type whose visible field set is empty still surfaces — prevents both a foreign-field-override leak AND a dropped-type regression."

patterns-established:
  - "Sweep recipe for importer-anchored routers (used 3x here): protectedProcedure + userOwnedImporterIds + resolveListScope for feeds; load-importer-then-assertImporterOwnership via assertOwnedOrNotFound for id-addressed ops; multi-id ops assert EVERY referenced id."

requirements-completed: []  # TENA-03 spans Plans 02/03/05/06/07/08 — completes ONLY at Plan 44-08's adversarial gate (per 44-02's correction; explicitly out of this plan's authority)

# Metrics
duration: ~45min (including a mid-run session interruption + resume)
completed: 2026-07-10
---

# Phase 44 Plan 06: Entities / Entity-Types / Knowledge Router Sweep Summary

**The entities, entity-types, and knowledge tRPC routers (9 files, 14 procedures) are fully on `protectedProcedure` + `@polytoken/db/ownership`: feeds scope to `userOwnedImporterIds` via a shared `resolveListScope`, id-addressed reads/writes assert the row's importer, NULL-importer system-default entity types stay readable but become write-rejected, and `knowledge.expandNode`'s "expand any node id" gap is closed with a seed-ownership gate.**

## Performance

- **Duration:** ~45 min (session cut by a connection error after Task 1's gallery/detail edits; resumed from verified disk state, no rework)
- **Started:** 2026-07-10T03:20:00Z (approx.)
- **Completed:** 2026-07-10T04:01:11Z
- **Tasks:** 3
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- `entities.list`: owned-importer scope via `userOwnedImporterIds` + the new shared `resolveListScope` (`_scope.ts`); a foreign `importerId` filter or an owner-less caller gets an empty page with ZERO queries issued (select-count-proven).
- `entities.byId`: loads the entity, then asserts its `importerId` is owned — foreign rows surface as `NOT_FOUND` through the reused 44-05 `assertOwnedOrNotFound` wrapper; the missing-row `null` contract is preserved.
- `entities.confirmMerge/rejectMerge/unmerge`: every referenced entity id (BOTH merge sides) goes through `assertEntityInstanceOwned` (load importer → assert) BEFORE the FastAPI proxy fetch — a merge can never join an entity the caller does not own; a missing entity throws the identical `NOT_FOUND` (fail-closed).
- `entityTypes.list`: system defaults (`importer_id IS NULL`) OR-ed with owned overrides — never another user's overrides; the same scope applied to joined field rows via the leftJoin ON clause.
- `entityTypes` writes: `update`/`createField`/`reorderFields` gate on the type's importer, `updateField`/`deleteField` gate on the OWNING TYPE's importer (single joined load); NULL-importer targets are `FORBIDDEN` (system defaults are seed-only, T-44-06-04), foreign importers are `NOT_FOUND`; `create` is `FORBIDDEN` outright (see Decisions).
- `knowledge.list`: owned scope via `resolveListScope` (same short-circuit contract as entities/emails).
- `knowledge.graph`: client-importerId trust replaced with owned-importer derivation; the `isNull` system-default OR-branch KEPT for entity types/fields; every tenant-owned sub-query (instance counts, instances, candidate links, components, knowledge nodes, kn-links, explicit edges) bounded to owned importers and skipped entirely for owner-less callers; the previously **unscoped** D-11 explicit-edge union now innerJoins the source knowledge node and filters on its importer.
- `knowledge.byId`: node importer asserted owned after load (`NOT_FOUND` for foreign nodes); `null`-for-missing preserved.
- `knowledge.expandNode`: seed-node importer asserted owned BEFORE expansion (T-44-06-03); the T-32-03 empty-response-for-missing-seed contract and T-32-02 seed-derived neighbour scoping unchanged.
- 24 new wiring regressions across `entities-user-scoping.test.ts` (11) + `knowledge-user-scoping.test.ts` (13), plus 8 new tenancy-gate cases in the rewritten `entity-types-write.test.ts`; full `packages/api-client` suite: 25 files, 268 tests, all green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Guard the entities router (gallery, detail, mutations)** - `c41e286` (feat)
2. **Task 2: Guard the entity-types router (read + writes)** - `d3a0455` (feat)
3. **Task 3: Guard the knowledge router (list, graph, detail, expandNode)** - `f8110b6` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/api-client/src/router/_scope.ts` - New: shared `resolveListScope` pure helper (emails' 44-05 semantics, one copy for the 44-06 routers)
- `packages/api-client/src/router/entities/gallery.ts` - `list` on protectedProcedure, owned-scope via resolveListScope
- `packages/api-client/src/router/entities/detail.ts` - `byId` asserts the loaded entity's importer ownership
- `packages/api-client/src/router/entities/mutations.ts` - merge/unmerge assert EVERY referenced entity's importer before proxying; new `assertEntityInstanceOwned` local gate
- `packages/api-client/src/router/entities/entities-user-scoping.test.ts` - New: 11 wiring regressions (session gate, list isolation, byId + merge cross-tenant rejection)
- `packages/api-client/src/router/entities/mutations.test.ts` - Fixed (Rule 1): raw-resolver invocations now carry a ctx + mocked ownership
- `packages/api-client/src/router/entity-types.ts` - `list` on protectedProcedure with NULL-or-owned type AND field scoping
- `packages/api-client/src/router/entity-types-write.ts` - All 6 writes protected + ownership-gated; `assertEntityTypeWritable`/`assertFieldWritable`; create rejected
- `packages/api-client/src/router/__tests__/entity-types-write.test.ts` - Valid session + mocked ownership + fake gate-row db; 8 new tenancy-gate regressions (17 total)
- `packages/api-client/src/router/knowledge/list.ts` - Owned scope via resolveListScope
- `packages/api-client/src/router/knowledge/graph.ts` - Owned-importer derivation, system defaults preserved, all sub-queries bounded, explicit-edge union scoped
- `packages/api-client/src/router/knowledge/detail.ts` - `byId` asserts node importer ownership
- `packages/api-client/src/router/knowledge/expand.ts` - Seed-ownership gate before expansion
- `packages/api-client/src/router/knowledge/knowledge-user-scoping.test.ts` - New: 13 wiring regressions incl. queue-based multi-query graph proofs

## Decisions Made

- **`create` → FORBIDDEN (not "require an owned importer"):** FastAPI's create use case hard-codes system-default creation (importer_id NULL); requiring an owned importer would need a FastAPI change outside this plan's file list, so the plan's own sanctioned "reject" fork was taken. Importer-scoped type creation is a documented future seam.
- **Graph foreign-filter = fully empty graph; owner-less no-filter = taxonomy-only graph:** distinguishes an attack probe (learns nothing, zero queries) from a legitimate new user (sees the seeded taxonomy per D-02) — both fail closed on tenant data.
- **`resolveListScope` extracted to `_scope.ts`** rather than duplicated a 3rd/4th time; emails' committed copy untouched (its 44-05 tests import it by path).
- **Explicit-edge union scoping via the SOURCE node's importer** — the same anchor `expand.ts` already uses (T-32-02), keeping one consistent edge-tenancy rule.
- **`component-relationship-mutations.test.ts` (named in the plan's Task 1 files) required NO changes** — 44-05's deviation already applied the valid-user + mocked-ownership fix; verified passing (12/12) rather than edited.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `entities/mutations.test.ts`, broken by Task 1's tenancy gate but not named in the plan**
- **Found during:** Task 3's full-suite verification run
- **Issue:** The plan's files list named `component-relationship-mutations.test.ts` as the pre-existing test to update, but that file was already fixed in 44-05. The actually-broken file was `entities/mutations.test.ts` — a Phase-10 test that invokes the merge/unmerge resolvers RAW via `proc._def.resolver({ input })` with no ctx at all. Task 1's ownership gate makes those resolvers read `ctx.db`/`ctx.user`, crashing 5 of its 9 tests with "Cannot read properties of undefined (reading 'db')".
- **Fix:** Mocked `@polytoken/db/ownership` (resolving by default, `vi.importActual` keeps the real `OwnershipError`) and passed a `createFakeCtx()` (fake importer-load chain + valid user) into each raw-resolver invocation — the same fix shape 44-05 applied to its two broken files.
- **Files modified:** `packages/api-client/src/router/entities/mutations.test.ts`
- **Verification:** File's 9 tests pass; full suite 268/268 green.
- **Committed in:** `f8110b6` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a pre-existing raw-resolver test file directly in Task 1's blast radius).
**Impact on plan:** No behavioral change to production code — test-fixture-only fix, identical in kind to 44-05's sanctioned sibling-file fix. No scope creep.

## Issues Encountered

- Session was cut by a connection error mid-Task-1 (after the gallery.ts/detail.ts edits, before mutations.ts). Resumed from orchestrator-verified disk state: both uncommitted edits re-read and confirmed complete, no rework needed, no commits lost (none existed yet).

## Known Stubs

None — no hardcoded empty values, placeholders, or unwired data paths introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 44-07 (chat router sweep) can proceed: `_ownership.ts` + `_scope.ts` are both reusable; the 2 pre-existing chat typecheck errors (`conversations.ts`, `browser-turn.ts` missing `user_id`) remain exactly 2 — confirmed unchanged by this plan, and 44-07's recipe fixes them.
- Plan 44-08 (adversarial gate): the entities/entity-types/knowledge surface is now uniformly guarded; the write-side FORBIDDEN-vs-NOT_FOUND split (system-default vs foreign) is the behavior the adversarial suite should assert.
- **TENA-03 deliberately NOT marked complete** in REQUIREMENTS.md — it completes only at Plan 44-08's adversarial cross-tenant gate (standing correction from 44-02).
- Behavioral note for the web UI: the Phase-9 entity-type management page's writes (create/update/field CRUD) now return FORBIDDEN for the seeded system-default types under a user session — this is the intended TENA-03 posture (system defaults are seed-only), worth surfacing at 44-08/UAT.

## Self-Check: PASSED

- Created files verified on disk: `packages/api-client/src/router/_scope.ts`, `entities/entities-user-scoping.test.ts`, `knowledge/knowledge-user-scoping.test.ts` — all FOUND
- Commits verified in `git log --oneline`: `c41e286`, `d3a0455`, `f8110b6` — all FOUND
- Re-ran plan-level `<verification>`:
  - `grep -c publicProcedure` across all 9 swept files → 0 in every file
  - Targeted vitest (5 touched test files) → 62/62 passed; full `packages/api-client` suite → 25 files / 268 tests, all green
  - `npx tsc --noEmit` in `packages/api-client` → exactly the 2 pre-existing chat `user_id` errors (Plan 44-07 scope), zero new errors
- must_haves artifacts: `knowledge/graph.ts` contains `protectedProcedure` (3 occurrences incl. docs); `entities-user-scoping.test.ts` ≥ 30 lines (330+); key_link `gallery.ts → userOwnedImporterIds via @polytoken/db/ownership` present at line 25/131
- `git diff --diff-filter=D --name-only` across the three task commits → no deletions

---
*Phase: 44-tenancy-user-id-scoping-enforced-isolation*
*Completed: 2026-07-10*
