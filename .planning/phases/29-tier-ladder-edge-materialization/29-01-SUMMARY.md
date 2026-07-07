---
phase: 29-tier-ladder-edge-materialization
plan: 01
subsystem: db-schema
tags: [drizzle, postgres, migration, tier-ladder, knowledge-graph]
dependency-graph:
  requires: []
  provides:
    - knowledgeTrustTierEnum
    - knowledge_nodes.tier
    - knowledge_node_edges.tier
    - knowledge_node_edges.provenance
    - knowledge_node_edges.is_active
    - idx_knowledge_node_edges_active_identity
  affects:
    - packages/db/src/schema/knowledge-nodes.ts
    - packages/db/src/schema/knowledge-node-edges.ts
tech-stack:
  added: []
  patterns:
    - "DO-block CREATE TYPE guard (catches duplicate_object) for idempotent enum creation — new idiom, repo previously only had ALTER TYPE ... ADD VALUE IF NOT EXISTS (0012)"
key-files:
  created:
    - packages/db/migrations/0026_knowledge_trust_tier.sql
    - packages/db/scripts/verify-0026-live.ts
  modified:
    - packages/db/src/schema/knowledge-nodes.ts
    - packages/db/src/schema/knowledge-node-edges.ts
    - packages/db/migrations/meta/_journal.json
decisions:
  - "DO-block enum-create guard chosen over a pre-check query since CREATE TYPE has no native IF NOT EXISTS — mirrors the repo's existing enum-idempotency spirit (0012's ADD VALUE IF NOT EXISTS) without duplicating the enum in two migrations"
  - "Wrote a dedicated pg-based verify-0026-live.ts script rather than an ad-hoc psql one-liner, since psql is not installed in this environment and the repo already has a live-DB-assertion idiom (assert-knowledge-node-edges.ts) to follow"
metrics:
  duration_minutes: 25
  completed: 2026-07-07
---

# Phase 29 Plan 01: Tier Ladder Schema + Live Migration Summary

Added the ordinal trust-tier enum (`EXTRACTED | INFERRED | AMBIGUOUS`) to both knowledge graph
tables via a new Postgres enum + Drizzle columns, gave `knowledge_node_edges` its `provenance`
and `is_active` columns, and applied + live-verified migration 0026 against local Supabase
Postgres with a direct `pg` query (not a type check).

## What Was Built

**Task 1 — Drizzle schema.** `knowledgeTrustTierEnum` (pg name `knowledge_trust_tier`) exported
from `knowledge-nodes.ts` with values `["EXTRACTED", "INFERRED", "AMBIGUOUS"]` in ordinal order
and a doc comment stating the ordinal semantics (EXTRACTED = human-confirmed/most trust,
INFERRED = synthesis-derived suggestion, AMBIGUOUS = default/least trust). `KnowledgeNodes` gained
a `tier` column (`.notNull().default("AMBIGUOUS")`); `confidence real` left byte-identical.
`KnowledgeNodeEdges` imports the shared enum and gained `tier` (same default), `provenance`
(`jsonb`, nullable), and `isActive` → `is_active` (`boolean`, `.notNull().default(true)`), plus a
partial index `idx_knowledge_node_edges_active_identity` on
`(sourceNodeId, targetRefId, relationType) WHERE is_active` for the deterministic active-edge
identity 29-03's supersede logic will use.

**Task 2 — Migration 0026.** `packages/db/migrations/0026_knowledge_trust_tier.sql`: a DO-block
guarded `CREATE TYPE` (catches `duplicate_object`, since `CREATE TYPE` has no native
`IF NOT EXISTS`) followed by 4 `ADD COLUMN IF NOT EXISTS` statements and 1
`CREATE INDEX IF NOT EXISTS`, each idempotent. Journaled as idx 26 in `meta/_journal.json`. No RLS
touched — 0020's deny-all baseline on `knowledge_node_edges` stays.

**Task 3 — Applied + live-verified.** Ran `npm run migrate:local` from `packages/db` (the repo's
established local-apply path, same mechanism 24-01 used for migration 0025) — completed in 31ms,
22 tables. `psql` is not installed in this environment, so wrote
`packages/db/scripts/verify-0026-live.ts` (mirrors the existing `assert-knowledge-node-edges.ts`
idiom: `pg` `Client` against `POSTGRES_URL_NON_POOLING`, a true live-DB assertion) and ran it via
`npm run with-env -- tsx scripts/verify-0026-live.ts`.

### Live verification output

```
knowledge_trust_tier enum labels: EXTRACTED,INFERRED,AMBIGUOUS
Columns:
  knowledge_node_edges.is_active: type=boolean udt=bool nullable=NO default=true
  knowledge_node_edges.provenance: type=jsonb udt=jsonb nullable=YES default=null
  knowledge_node_edges.tier: type=USER-DEFINED udt=knowledge_trust_tier nullable=NO default='AMBIGUOUS'::knowledge_trust_tier
  knowledge_nodes.tier: type=USER-DEFINED udt=knowledge_trust_tier nullable=NO default='AMBIGUOUS'::knowledge_trust_tier
Partial index present: true
VERIFICATION PASSED: all assertions confirmed live.
```

All acceptance criteria confirmed against the live local Supabase Postgres: enum has exactly
`EXTRACTED,INFERRED,AMBIGUOUS` in ordinal order; `knowledge_nodes.tier` and
`knowledge_node_edges.tier/provenance/is_active` all present with correct types, nullability, and
defaults; the partial index exists.

## Deviations from Plan

None — plan executed exactly as written. The only implementation choice not explicitly dictated by
the plan was the DO-block enum-guard idiom (plan specified this exact approach in Task 2's action)
and the live-verification mechanism (plan allowed either `psql` or a direct `pg`/TS query since
`psql` was unavailable — used the repo's existing `pg`-script convention).

## Commits

- `522db20` — feat(29-01): add ordinal trust-tier enum + edge provenance/is_active columns
- `fd1c659` — feat(29-01): author migration 0026 for trust-tier enum + edge columns
- `c449ea2` — test(29-01): add live-verification script for migration 0026

## Self-Check: PASSED

- FOUND: packages/db/migrations/0026_knowledge_trust_tier.sql
- FOUND: packages/db/scripts/verify-0026-live.ts
- FOUND: commit 522db20
- FOUND: commit fd1c659
- FOUND: commit c449ea2
- Live query confirmed: enum + all 4 columns + partial index present in local Supabase Postgres
