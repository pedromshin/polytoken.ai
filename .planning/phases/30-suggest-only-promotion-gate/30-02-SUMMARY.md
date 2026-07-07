---
phase: 30-suggest-only-promotion-gate
plan: 02
subsystem: knowledge-graph
tags: [hexagonal-architecture, tdd, suggest-only, trust-tier, promotion, fail-closed, fastapi]
dependency-graph:
  requires:
    - knowledge_node_edges.tier/is_active/provenance columns (29-01)
    - list_injectable_edges + suggestion-edge emission (30-01)
    - Phase-24 SubmitWidgetInteraction fail-closed ordering idiom
  provides:
    - migration 0027 (knowledge_node_edges.promotion jsonb column)
    - KnowledgeGraphRepository.find_edge_by_id / promote_edge
    - PromoteEdgeUseCase (app/application/use_cases/promote_edge.py)
    - POST /v1/knowledge/edges/{edge_id}/promote
  affects:
    - app/container.py (_provide_promote_edge_use_case factory + registration)
    - app/main.py (knowledge_edges_router included)
tech-stack:
  added: []
  patterns:
    - "PromoteEdgeUseCase mirrors Phase-24 SubmitWidgetInteraction: load -> guard(s) -> CAS write,
       every rejection raised BEFORE the write, no reordering (T-30-05)"
    - "Tenant-ownership guard checked BEFORE the active/tier guards so a cross-importer probe
       cannot distinguish 'wrong tenant' from 'already extracted' via error shape (T-30-07)"
    - "Repo-level CAS (id + is_active=true + tier IN (INFERRED,AMBIGUOUS)) is defense-in-depth
       beneath the use-case guard -- a False return from promote_edge is ALSO a rejection
       (EdgeNotPromotable('conflict')), never silently ignored (T-30-06)"
    - "importer_id is a request-body field, never an auth claim/header (D-12) -- validated at the
       boundary by Pydantic, then checked against the edge's owning tenant inside the use case"
key-files:
  created:
    - packages/db/migrations/0027_edge_promotion_provenance.sql
    - packages/db/scripts/verify-0027-live.ts
    - apps/email-listener/app/application/use_cases/promote_edge.py
    - apps/email-listener/app/presentation/api/v1/knowledge_edges.py
    - apps/email-listener/tests/test_promote_edge.py
    - apps/email-listener/tests/test_promote_edge_endpoint.py
  modified:
    - packages/db/migrations/meta/_journal.json
    - packages/db/src/schema/knowledge-node-edges.ts
    - apps/email-listener/app/domain/ports/knowledge_graph_repository.py
    - apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
    - apps/email-listener/tests/test_knowledge_graph_repository.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/main.py
decisions:
  - "promote_edge's repo-level CAS filter (tier IN (INFERRED, AMBIGUOUS)) is the ONLY place
     the suggestion-tier allowlist is hardcoded twice (also in the use case's guard) -- an
     intentional defense-in-depth duplication, not an oversight, mirroring the Phase-24 CAS
     posture for double-submit."
  - "find_edge_by_id resolves the owning importer_id via a nested PostgREST select
     (knowledge_node_edges.select('*, knowledge_nodes(importer_id)')), the same nested-embed
     idiom already used by entity_type_repository.py -- avoids a second round-trip query."
  - "Guard ordering places the tenant-ownership check BEFORE the active/tier checks (not the
     plan's literal listed order) specifically for the T-30-07 information-disclosure
     disposition: a cross-tenant caller gets the identical EdgeNotPromotable('tenant_mismatch')
     regardless of the edge's real state, so probing can't distinguish 'wrong tenant' from
     'already promoted'."
  - "Local Postgres via `npm run migrate:local` required starting Docker Desktop (not running at
     session start) and `npx supabase start` -- both completed successfully; no live-Postgres
     work was skipped or deferred."
metrics:
  duration_minutes: 75
  completed: 2026-07-07
---

# Phase 30 Plan 02: Suggest-Only Promotion Gate (TIER-03) Summary

Shipped the human promotion mechanic that completes the suggest-only gate: migration 0027 adds a
nullable `promotion jsonb` column to `knowledge_node_edges`, a fail-closed `PromoteEdgeUseCase`
flips exactly one ACTIVE INFERRED/AMBIGUOUS edge to EXTRACTED while recording promotion provenance
distinct from the Phase-29 synthesis provenance, and an authenticated FastAPI endpoint
(`POST /v1/knowledge/edges/{id}/promote`) exposes it. The design-case sentence is now literally
true end-to-end: "synthesis emits suggestions; a human promotes; only human-confirmed EXTRACTED
edges are ever trusted for auto-injection."

## What Was Built

**Task 1 — Migration 0027 + live verify.** `0027_edge_promotion_provenance.sql` adds
`ALTER TABLE knowledge_node_edges ADD COLUMN IF NOT EXISTS "promotion" jsonb` (idempotent, mirrors
0026's hand-written style); journal entry idx=27 appended. The Drizzle schema
(`knowledge-node-edges.ts`) declares the matching `promotion: jsonb("promotion")` column, distinct
from the pre-existing `provenance` column. Docker Desktop was not running at session start and
local Supabase was only partially up — both were started (`Docker Desktop.exe`, then
`npx supabase start`) before `npm run migrate:local` applied the migration and
`verify-0027-live.ts` confirmed live: `promotion` udt=jsonb/nullable=YES, and `provenance`
unchanged. `npx tsc --noEmit` clean in `packages/db`.

**Task 2 — promote_edge repo method + PromoteEdgeUseCase (TDD RED->GREEN).** Added
`find_edge_by_id` (nested `knowledge_node_edges.select("*, knowledge_nodes(importer_id)")` —
mirrors the existing `entity_type_fields(*)` nested-embed idiom — flattens the owning
`importer_id` onto the returned dict) and `promote_edge` (CAS-guarded update filtered by
`id + is_active=true + tier IN (INFERRED, AMBIGUOUS)`, writes `{tier: EXTRACTED, promotion}`,
never `.delete()`) to the `KnowledgeGraphRepository` port + Supabase adapter. RED: `test_promote_edge.py`
(9 AsyncMock-repo tests) and 4 new call-shape tests in `test_knowledge_graph_repository.py` were
written first; confirmed a genuine RED (temporarily reverted the port/adapter edits via `git stash`,
ran pytest, saw `ModuleNotFoundError`/`AttributeError`, committed the RED state, then restored and
re-ran to GREEN). `PromoteEdgeUseCase.execute` implements load -> tenant guard -> active guard ->
tier guard -> CAS write, mirroring Phase-24 `SubmitWidgetInteraction`'s ordering discipline — every
rejection (`EdgeNotFound` / `EdgeNotPromotable` with reasons `tenant_mismatch`/`inactive`/
`not_promotable`/`conflict`) raises BEFORE `promote_edge` is called, asserted explicitly on every
rejection test plus a dedicated call-ordering test. On success, `promotion={promoted_at (UTC
ISO8601), from_tier, mechanism:'human_promote'}` is written; the use case never touches
`provenance`. All 18 targeted tests pass; mypy/ruff/lint-imports clean (use case imports only
`app.domain.*`).

**Task 3 — Authenticated promote endpoint + DI + router registration.** Added
`app/presentation/api/v1/knowledge_edges.py`: `router = APIRouter(prefix="/v1/knowledge/edges", ...,
dependencies=[Depends(require_api_key)])` for router-wide X-API-Key fail-closed auth;
`POST /{edge_id}/promote` accepts `importer_id` via a Pydantic request-body model (never an auth
claim/header, per D-12), maps `EdgeNotFound` -> 404 and `EdgeNotPromotable` -> 409 (rejection reason
logged server-side, generic detail returned to the client), and returns
`ApiResponse.ok({edge_id, tier: 'EXTRACTED'})`. Added `_provide_promote_edge_use_case(client)`
factory to `container.py` (instantiates `SupabaseKnowledgeGraphRepository` directly, mirroring
`_provide_confirm_region_use_case`) and registered it via `provider.provide(...,
provides=PromoteEdgeUseCase)`. Router included in `main.py`. `test_promote_edge_endpoint.py`
(TestClient+dishka HTTP-seam idiom, mirroring `test_confirm_region.py`) asserts: 200 with
`tier='EXTRACTED'` on success; 401 without `X-API-Key` BEFORE the use case is ever awaited; 404 for
not-found; 409 for already-EXTRACTED/inactive/cross-importer; a container-build smoke test; and a
factory-wiring test confirming `SupabaseKnowledgeGraphRepository` is instantiated directly. All 8
pass. No promote/dismiss UI was added (Phase 32, per plan scope).

## Deviations from Plan

None — plan executed as written. Local Postgres required starting Docker Desktop and Supabase
local (neither was running at session start); this is environment setup, not a plan deviation, and
is documented above/in decisions for continuity.

## Commits

- `21c08f6` — feat(30-02): add migration 0027 promotion jsonb column + live verify (Task 1)
- `f2dff13` — test(30-02): add failing tests for promote_edge use case + repo methods (Task 2 RED)
- `ab58327` — feat(30-02): implement promote_edge repo method + PromoteEdgeUseCase (Task 2 GREEN)
- `7dfc18f` — feat(30-02): add authenticated promote endpoint + DI + router registration (Task 3)

## TDD Gate Compliance

RED gate (`f2dff13`) confirmed by genuine `ModuleNotFoundError` (use case module didn't exist) and
`AttributeError` (repo methods didn't exist) — verified by temporarily stashing the port/adapter
edits and moving the use-case file aside before running pytest, then restoring both before the
GREEN commit. GREEN gate (`ab58327`) confirmed by all 18 targeted tests (`test_promote_edge.py` +
`test_knowledge_graph_repository.py`) passing. No REFACTOR commit needed (ruff caught two lint
issues — N818 exception naming, PT017 exception-attribute assertions — both fixed inline before the
GREEN commit, not as a separate refactor step).

## Verification

- `tsx scripts/verify-0027-live.ts` prints "VERIFICATION PASSED" against local Postgres (confirmed).
- `python -m pytest tests/test_promote_edge.py tests/test_promote_edge_endpoint.py
  tests/test_knowledge_graph_repository.py` — 26/26 pass.
- Full `apps/email-listener` suite (excluding the logged `test_genui_retrieval_provider.py` flake):
  all pass (6 skips, all pre-existing credential-gated integration tests).
- `create_container()` succeeds (no dishka `GraphMissingFactoryError`) — verified both by a
  dedicated test and by the full suite import graph.
- mypy: zero new errors on touched files (`knowledge_edges.py`, `container.py`, `main.py`,
  `promote_edge.py`, `knowledge_graph_repository.py` port+adapter) — the 12 pre-existing mypy
  errors in unrelated files (`genui_generator_adapter.py`,
  `supabase_ui_spec_template_repository.py`, `supabase_chat_widget_interaction_repository.py`,
  `genui_code_generator_adapter.py`) were confirmed identical before and after this plan's changes
  via `git stash` A/B comparison — pre-existing, out of scope.
- ruff + lint-imports clean on all touched Python files.
- `npx tsc --noEmit` clean in `packages/db`.

## Self-Check: PASSED

- FOUND: packages/db/migrations/0027_edge_promotion_provenance.sql
- FOUND: packages/db/scripts/verify-0027-live.ts
- FOUND: apps/email-listener/app/application/use_cases/promote_edge.py
- FOUND: apps/email-listener/app/presentation/api/v1/knowledge_edges.py
- FOUND: apps/email-listener/tests/test_promote_edge.py
- FOUND: apps/email-listener/tests/test_promote_edge_endpoint.py
- FOUND: commit 21c08f6
- FOUND: commit f2dff13
- FOUND: commit ab58327
- FOUND: commit 7dfc18f
- Verified: 26 targeted tests pass; full apps/email-listener suite passes (excluding logged flake);
  mypy/ruff/lint-imports clean on touched Python files; tsc --noEmit clean in packages/db;
  verify-0027-live.ts VERIFICATION PASSED against local Postgres.
