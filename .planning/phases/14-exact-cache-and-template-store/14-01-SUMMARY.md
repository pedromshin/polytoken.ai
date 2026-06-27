---
phase: 14-exact-cache-and-template-store
plan: "01"
subsystem: db-schema
tags: [drizzle, migration, rls, cache, ui-spec-templates, postgres]
dependency_graph:
  requires: []
  provides: [ui_spec_templates Drizzle table, migration 0022, RLS deny-all baseline]
  affects: [packages/db/src/schema, packages/db/migrations, Plan 14-03 Supabase adapter]
tech_stack:
  added: []
  patterns: [pgTable with uniqueIndex, inline CHECK constraint, hand-authored RLS SQL, IF NOT EXISTS guards]
key_files:
  created:
    - packages/db/src/schema/ui-spec-templates.ts
    - packages/db/migrations/0022_right_firedrake.sql
    - packages/db/migrations/meta/0022_snapshot.json
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/migrations/meta/_journal.json
decisions:
  - "UNIQUE index on cache_key declared as uniqueIndex() in Drizzle (not .unique() on column), so the named index idx_ui_spec_templates_cache_key is explicit and available as ON CONFLICT target in Plan 14-03"
  - "validation_status CHECK narrowly typed to ('validated') only in v1.1 — CHECK syntax added manually post-generate (drizzle-kit does not emit CHECK from plain text columns)"
  - "migration file is 0022_right_firedrake.sql (drizzle-kit named it); journal tag=0022_right_firedrake, idx=22"
  - "RLS policies hand-written in 0022 SQL (mirrors 0020_knowledge_node_edges_rls.sql); drizzle-kit cannot emit RLS"
  - "migrate:local connects to Supabase local on port 54322 via POSTGRES_URL_NON_POOLING — verified table, CHECK, indexes, RLS via pg pool; all confirmed"
metrics:
  duration_seconds: 366
  completed: "2026-06-27"
  tasks_completed: 2
  files_created: 3
  files_modified: 2
---

# Phase 14 Plan 01: ui_spec_templates Schema + Migration 0022 Summary

Drizzle `ui_spec_templates` table (14 D-10 v1.1 columns) with UNIQUE `cache_key`, `validation_status IN ('validated')` CHECK, RLS deny-all for anon/authenticated, and migration 0022 applied to LOCAL Supabase; staging/prod flagged PENDING DEPLOY.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Define ui_spec_templates Drizzle table + barrel export | b1886a8 | packages/db/src/schema/ui-spec-templates.ts, packages/db/src/schema/index.ts |
| 2 | Generate + author migration 0022 and apply to LOCAL Postgres | ea9c335 | packages/db/migrations/0022_right_firedrake.sql, packages/db/migrations/meta/_journal.json |

## What Was Built

### Task 1 — Drizzle Schema (`ui-spec-templates.ts`)

`UiSpecTemplates = pgTable("ui_spec_templates", {...}, (t) => ({...}))` with the full D-10 v1.1 exact-cache column set:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK defaultRandom | |
| cache_key | text NOT NULL | SHA-256 hex; UNIQUE index |
| intent_text | text NOT NULL | Canonical (NFC+trim+lower+collapse) intent; plaintext (deliberate divergence from audit table hash) |
| data_shape_hash | text NOT NULL | SHA-256 over structural shape (keys+types, never values) |
| registry_version | text NOT NULL | D-07 content hash; invalidation lever |
| catalog_id | text NOT NULL DEFAULT 'global' | Per-catalog seam (SEAM-03) |
| spec_json | jsonb NOT NULL | Full validated SpecRoot |
| validation_status | text NOT NULL DEFAULT 'validated' | CHECK enforced in migration |
| spec_node_count | integer NULL | Observability metadata |
| spec_depth | integer NULL | Observability metadata |
| use_count | integer NOT NULL DEFAULT 0 | Hit-path increment signal for v1.2 promotion |
| importer_id | uuid NULL | Tenant scope, NO FK (mirrors genui_generation_events) |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

Indexes in `(t) => ({...})` block:
- `uniqueIndex("idx_ui_spec_templates_cache_key").on(t.cacheKey)` — O(1) exact-match + ON CONFLICT target
- `index("idx_ui_spec_templates_importer_catalog").on(t.importerId, t.catalogId)` — scope queries
- `index("idx_ui_spec_templates_registry_version").on(t.registryVersion)` — invalidation + observability

Exports: `UiSpecTemplateRow` ($inferSelect), `InsertUiSpecTemplate` ($inferInsert).

Barrel export appended to `packages/db/src/schema/index.ts`:
```
export * from "./ui-spec-templates";
```

TypeScript check: `npx tsc --noEmit` clean.

No deferred v1.2 columns present: embedding, binding_slots, confirm_count, regenerate_count, feedback_score, promotion_score — all absent (scope fence enforced).

### Task 2 — Migration `0022_right_firedrake.sql`

Generated via `npm run migration:generate` (drizzle-kit), then hand-edited to add:

1. `IF NOT EXISTS` guards on `CREATE TABLE` and all `CREATE INDEX/UNIQUE INDEX` statements (idempotency, T-14-04)
2. Inline `CONSTRAINT "ui_spec_templates_validation_status_check" CHECK (validation_status IN ('validated'))` on the CREATE TABLE (D-11/T-14-03 — DB-level second line against cache poisoning; drizzle-kit does not emit CHECK from plain text columns)
3. Header comment: CACHE-01/D-10/D-11/D-20 references
4. RLS deny-all block (D-20/T-14-01/T-14-02) hand-authored after the index statements, mirroring `0020_knowledge_node_edges_rls.sql`:
   - `ALTER TABLE "ui_spec_templates" ENABLE ROW LEVEL SECURITY`
   - `DROP POLICY IF EXISTS "deny_all_ui_spec_templates_anon"` then `CREATE POLICY ... AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)`
   - Same pair for `authenticated`
   - Each separated by `--> statement-breakpoint`

Journal: `meta/_journal.json` idx=22, tag=`0022_right_firedrake`.

**Migration applied to LOCAL Supabase** (port 54322 via `POSTGRES_URL_NON_POOLING`):
- `npm run migrate:local` applied cleanly in 23ms
- Re-run confirmed idempotent (8ms, no error)

**Verified via pg pool against local DB:**
- COLUMNS (14): id, cache_key, intent_text, data_shape_hash, registry_version, catalog_id, spec_json, validation_status, spec_node_count, spec_depth, use_count, importer_id, created_at, updated_at
- CHECK: `ui_spec_templates_validation_status_check` — `CHECK ((validation_status = 'validated'::text))`
- INDEXES: pkey, `idx_ui_spec_templates_cache_key` (UNIQUE), `idx_ui_spec_templates_importer_catalog`, `idx_ui_spec_templates_registry_version`
- RLS: ENABLED
- POLICIES (2): `deny_all_ui_spec_templates_anon`, `deny_all_ui_spec_templates_authenticated`
- CHECK rejection test: `INSERT ... validation_status='promoted'` → `new row for relation "ui_spec_templates" violates check constraint "ui_spec_templates_validation_status_check"` (D-11 confirmed at DB boundary)

## PENDING DEPLOY: Staging + Production

Migration `0022_right_firedrake.sql` has been applied to LOCAL only. Staging and production apply are **DEFERRED** per migrations-first discipline (deploy-playbook memory).

**Required before Plan 14-03 code reaches staging/prod:**
1. Run `npm run migrate:staging` (applies 0022 to staging ref `fyfwkjvbcrmjqjysdyqw`)
2. Run `npm run migrate:prod` (applies 0022 to prod ref `dazyccjijdahxyciptkp`)
3. Verify `ui_spec_templates` table exists on staging/prod before the writing code deploys

This must happen as part of the Phase 14 deployment wave before any of Plans 14-02, 14-03, 14-04 reach those environments.

## Deviations from Plan

None — plan executed exactly as written.

- drizzle-kit named the file `0022_right_firedrake.sql` (not `0022_ui_spec_templates.sql`). This is normal drizzle-kit behavior (random name suffix). The journal tag is `0022_right_firedrake` and idx=22 (no gap). Accepted as specified in the plan: "accept its name but confirm idx=22."

## Threat Surface Scan

All STRIDE mitigations confirmed applied:

| Threat | Status | Evidence |
|--------|--------|---------|
| T-14-01 (anon read) | Mitigated | `deny_all_ui_spec_templates_anon` RESTRICTIVE RLS policy present |
| T-14-02 (anon write) | Mitigated | Same policy WITH CHECK(false) blocks writes |
| T-14-03 (cache poisoning via non-validated spec) | Mitigated | `ui_spec_templates_validation_status_check` CHECK rejects any value != 'validated' — verified by live INSERT rejection test |
| T-14-04 (non-idempotent migration) | Mitigated | IF NOT EXISTS guards + DROP POLICY IF EXISTS — re-run confirmed idempotent |
| T-14-SC (npm/drizzle-kit dep) | Accepted | No new package installed; existing drizzle-kit ^0.31.1 used |

No new threat surface beyond the plan's threat model.

## Self-Check: PASSED

- [x] `packages/db/src/schema/ui-spec-templates.ts` — exists, 14 D-10 columns, 0 deferred v1.2 columns
- [x] `packages/db/src/schema/index.ts` — `export * from "./ui-spec-templates"` appended
- [x] `packages/db/migrations/0022_right_firedrake.sql` — exists, IF NOT EXISTS guards, CHECK constraint, RLS block
- [x] `packages/db/migrations/meta/_journal.json` — idx=22, tag=0022_right_firedrake
- [x] `packages/db/migrations/meta/0022_snapshot.json` — exists (drizzle-kit snapshot)
- [x] Commit b1886a8 — Task 1 (schema + barrel)
- [x] Commit ea9c335 — Task 2 (migration)
- [x] tsc --noEmit clean
- [x] migrate:local clean + idempotent
- [x] DB verified: 14 columns, CHECK, UNIQUE+btree indexes, RLS enabled, 2 deny-all policies
- [x] PENDING DEPLOY note: staging + prod migration apply deferred
- [x] CACHE-01 satisfied: schema ready to persist validated specs via Plan 14-03 adapter
