# Phase 44: Tenancy — user_id Scoping + Enforced Isolation - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — 3 grey areas proposed, all recommendations auto-accepted per autonomous contract

**Rename note:** Executes after Phase 42 (scopes are `@polytoken/*`) and Phase 43 (session identity exists).

<domain>
## Phase Boundary

Every row of user-owned data belongs to a user and is unreachable across users. Enforcement is at the app boundary (PRIMARY — session-derived user_id, never client-supplied), with RLS policies as defense-in-depth. Includes schema migration + backfill, the route/procedure sweep, and the adversarial cross-tenant test gate. NOT in this phase: org/team tenancy, per-request JWT-forwarded RLS (`SET ROLE`) as primary boundary (explicitly out of scope in REQUIREMENTS.md).

</domain>

<decisions>
## Implementation Decisions

### Data model & migration
- `user_id uuid` referencing `auth.users(id)` directly (Supabase-canonical; no profiles/mirror table in v1.7)
- Anchoring per research: `user_id` on `importers` (one join scopes the 7 hard-FK descendant tables — zero migration on them); DIRECT `user_id` on `chat_conversations` and `chat_cost_ledger`; genui exact-match cache tables DELIBERATELY unscoped (cross-tenant cache hits are the point) — documented in schema comments and PROJECT.md
- Expand→backfill→contract as three migrations: (1) add nullable `user_id` columns, (2) backfill to the first real user — the single existing `auth.users` row; migration fails loudly if 0 or >1 rows exist unless `BACKFILL_USER_ID` env var overrides, (3) contract to NOT NULL
- Migrations are LOCAL-only per standing constraint — staging/prod deploy stays in the user's queue

### App-boundary enforcement (primary)
- Central ownership helper(s) — scoped query builders / `assertImporterOwnership` — used by every tRPC procedure and web route; NO per-procedure ad-hoc checks
- tRPC procedures derive scope from `ctx.user` (Phase 43's `protectedProcedure`); any client-supplied importer ID is validated against ownership, never trusted for scoping
- FastAPI: user-scoped endpoints require the BFF-forwarded `X-User-Id` (Phase 43 seam) and validate importer ownership in the repository/service layer; known fix targets from research: `attachments/[id]/route.ts:44-49` (ZERO tenant scoping today), `promote/route.ts:21` (client-body importerId), `emails.py:113-116` (query-param importer)
- The enforcement-architecture decision (app-boundary primary, RLS defense-in-depth, Drizzle-connects-as-superuser precedent from `packages/db/src/client.ts:28-36`) is RECORDED in PROJECT.md Key Decisions BEFORE policy work begins (TENA-04 ordering requirement)

### RLS + adversarial gate
- RLS enabled with `auth.uid()`-based policies on user-owned tables (importers subtree anchor + chat tables); understood and documented that the Drizzle superuser connection bypasses them — they defend PostgREST/future non-superuser paths
- Adversarial cross-tenant suite is the PHASE ACCEPTANCE GATE: create a second test user; attempt cross-tenant reads AND writes through EVERY route/procedure (including attachments download and knowledge-promote proxy); vitest for web/tRPC surfaces, pytest for FastAPI
- Sweep deliverable: enumerated route/procedure inventory with scoping status + regression tests locking each one (TENA-03, absorbs backlog 999.1 as per-user scoping)

### Claude's Discretion
- Helper API shape, test fixture mechanics for the second user, exact policy SQL, migration file organization (follow packages/db/migrations conventions, journal gotcha noted in memory)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 43 delivers `ctx.user` + `protectedProcedure` + `X-User-Id` forwarding — this phase consumes them
- Drizzle schema + migrations live in `packages/db` (migrations 0026–0030 exist local-only; this phase appends)

### Established Patterns
- Drizzle deliberately connects via session-mode URL as Postgres superuser (`packages/db/src/client.ts:28-36`) because the transaction-mode pooler broke `auth.uid()` — RLS alone is therefore theater for app queries; app-boundary enforcement is the real wall
- Repository pattern in FastAPI service; scoping belongs in repositories/services, not handlers

### Integration Points
- `importers` table (anchor), `chat_conversations`, `chat_cost_ledger` (direct), attachments route, promote proxy, `emails.py` list endpoints, every tRPC procedure

</code_context>

<specifics>
## Specific Ideas

- The sweep + adversarial test is worth more than the RLS policies (research conclusion) — prioritize it if time-boxing
- Success criterion 1 requires live-verified locally: run migrations against local DB and verify backfill counts

</specifics>

<deferred>
## Deferred Ideas

- Org/team tenancy primitives — different problem, out of scope
- `SET ROLE authenticated` per-request RLS-primary architecture — measurement-gated evolution, documented in Out of Scope
- Staging/prod migration deploy — user's queue

</deferred>
