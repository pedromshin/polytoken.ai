---
phase: 24-dual-channel-genui
plan: 01
subsystem: db-schema, python-domain, python-infrastructure
tags: [dual-channel-genui, widget-interaction, cas-lock, jsonschema, persistence]

# Dependency graph
requires: []
provides:
  - "chat_widget_interactions Drizzle table + migration 0025 (state machine, stored declared schema, staleness columns, unique lock index, RLS deny-all)"
  - "ChatWidgetInteractionRepository port + WidgetInteraction frozen entity"
  - "SupabaseChatWidgetInteractionRepository (create_pending/get/try_submit CAS/is_stale)"
  - "validate_result_against_schema pure re-validation domain service (ValidationOutcome)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "try_submit is a DB-level compare-and-swap: the conditional UPDATE carries BOTH eq(\"id\", ...) AND eq(\"state\", \"pending\") — Postgres only updates rows matching every eq() predicate, so a second submit against an already-flipped row matches zero rows and returns False with no read-then-write race window (D-11)"
    - "is_stale queries chat_messages directly (not the interaction row) for the emitting message's is_active flag and for any strictly-newer turn_index in the same conversation — two sequential SELECTs, first short-circuits on inactive (D-12)"
    - "validate_result_against_schema treats an empty {} declared schema as fail-closed rejection even though {} is technically valid JSON Schema (matches anything) — a widget must always declare real constraints, so empty is read as malformed/untrusted input, not permissive-by-design"
    - "jsonschema.Draft7Validator matches the existing convention in genui_spec_utils.py (not Draft202012Validator) — one draft version across the codebase"
    - "ValidationOutcome.reason is always a generic caller-safe string; the real jsonschema error (property paths/schema pointers) is logged server-side only via structlog (widget_result_validation_failed), never returned — CLAUDE.md guardrail"

key-files:
  created:
    - packages/db/src/schema/chat-widget-interactions.ts
    - packages/db/migrations/0025_chat_widget_interactions.sql
    - apps/email-listener/app/domain/ports/chat_widget_interaction_repository.py
    - apps/email-listener/app/infrastructure/supabase/supabase_chat_widget_interaction_repository.py
    - apps/email-listener/app/infrastructure/supabase/__tests__/test_supabase_chat_widget_interaction_repository.py
    - apps/email-listener/app/domain/services/widget_result_validator.py
    - apps/email-listener/app/domain/services/__tests__/test_widget_result_validator.py
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "Empty declared schema {} is a deliberate fail-closed rejection (not delegated to jsonschema's technically-permissive behavior) — matches the plan's explicit 'malformed/empty' pairing in the Task 3 <behavior> spec"
  - "Draft7Validator chosen over Draft202012Validator to match the one already used elsewhere in this codebase (genui_spec_utils.py) — avoids two JSON-Schema-draft conventions coexisting"
  - "WidgetInteraction/ValidationOutcome are frozen dataclasses (CLAUDE.md immutability); every method on the Supabase adapter propagates exceptions rather than swallowing them — pending-widget state is correctness data, same posture as supabase_chat_message_repository.py, not the best-effort posture used for audit logging"

requirements-completed: [DCUI-04]

# Metrics
duration: ~35min
completed: 2026-07-05
---

# Phase 24 Plan 01: Widget-Interaction Persistence + Safety-Primitive Spine Summary

**A `chat_widget_interactions` table stores each pending widget's declared response schema and lifecycle state, backed by a DB-level compare-and-swap double-submit lock (`try_submit`), a staleness query (`is_stale`), and a pure fail-closed JSON-Schema re-validator (`validate_result_against_schema`) — the safety spine every later Phase-24 plan (tool emission, submit endpoint, UI) builds on top of.**

## Performance

- **Duration:** ~35 min (this session; Task 1 + Task 2 RED were already committed from a prior session — this session confirmed Task 1's local-Supabase state, completed Task 2's GREEN commit, and executed all of Task 3 RED→GREEN)
- **Tasks:** 3/3 completed (Task 1 `type="auto"`; Tasks 2 and 3 `type="auto" tdd="true"`, each RED then GREEN)
- **Files created:** 7 (1 Drizzle schema, 1 migration, 1 domain port, 1 infra adapter, 1 domain service, 2 test files)
- **Files modified:** 2 (schema barrel, migrations journal)

## Accomplishments

- **Task 1 — `chat_widget_interactions` table + migration 0025 (local-pushed, BLOCKING):** `packages/db/src/schema/chat-widget-interactions.ts` mirrors `chat-canvas-layouts.ts`'s structure: `id`/`conversationId` (FK→chat_conversations, cascade)/`messageId` (FK→chat_messages, cascade)/`partIndex`/`turnIndex`/`siblingGroupId` (nullable, D-12 staleness)/`widgetKind`/`declaration` (jsonb, server-resolved payload)/`declaredResponseSchema` (jsonb, D-01/D-10)/`state` (default `'pending'`)/`submittedValue` (nullable jsonb)/timestamps, plus `uniqueIndex` on `(messageId, partIndex)` and an index on `conversationId`. Migration `0025_chat_widget_interactions.sql` hand-authored mirroring 0023/0024: `CREATE TABLE IF NOT EXISTS`, CHECK constraints on `widget_kind IN ('proposal_cards','clarify_widget')` and `state IN ('pending','submitted','superseded','stale')`, both FKs, both indexes, RESTRICTIVE `deny_all_*_anon`/`deny_all_*_authenticated` RLS. Journal + schema barrel updated. **Verified live against local Supabase this session** (`information_schema.columns`, `pg_constraint`, `pg_policies`, `pg_indexes` queried directly via a `pg` client): all 13 columns present, both CHECK constraints present verbatim, both RESTRICTIVE RLS policies present (anon + authenticated), the unique `(message_id, part_index)` index and the `conversation_id` index both present. `packages/db` `tsc --noEmit` clean.

- **Task 2 — `ChatWidgetInteractionRepository` port + Supabase adapter (TDD):** `chat_widget_interaction_repository.py` defines the frozen `WidgetInteraction` entity + `WidgetInteractionState`/`WidgetKind` Literal unions + the `ChatWidgetInteractionRepository` Protocol (`create_pending`/`get`/`try_submit`/`is_stale`). `supabase_chat_widget_interaction_repository.py` implements it: every blocking supabase-py call wrapped in `asyncio.to_thread`; `try_submit` issues `.update({...}).eq("id", interaction_id).eq("state", "pending").execute()` and returns `len(result.data) == 1` — the CAS lock (D-11); `is_stale` queries `chat_messages` for the emitting row's `is_active` (short-circuits True if inactive) then for any row with a strictly-greater `turn_index` in the same conversation (D-12). Exceptions propagate (correctness data). 8 unit tests (mocked fluent-builder Supabase client) cover: insert carries `state="pending"`; `get` returns `None` on empty / returns a row from any conversation (ownership enforced by the caller); the CAS update carries both `eq("id",...)` and `eq("state","pending")` and returns `True`/`False` on 1-row/0-row results; `is_stale` True/False across inactive-emitter, newer-turn, and both-clear cases. RED `cae4e57` → GREEN `126eba9`. `uv run ruff check` + `uv run lint-imports` clean (port imports zero `app.infrastructure`).

- **Task 3 — `validate_result_against_schema` pure re-validation service (TDD, D-10):** `widget_result_validator.py` exports `ValidationOutcome` (frozen `{ok, reason}`) and `validate_result_against_schema(result, schema)`. Uses `jsonschema.Draft7Validator` (matching the existing `genui_spec_utils.py` convention): an empty/falsy schema is rejected immediately (fail-closed by design — D-10's "malformed/empty" pairing), `Draft7Validator.check_schema` catches a structurally-invalid schema, `iter_errors` catches instance-level mismatches, and any unexpected exception (e.g. `jsonschema.exceptions.UnknownType` from a bad `type` keyword, confirmed live in this session) is caught rather than propagated. The `reason` string is always one of two generic constants — never the raw jsonschema error, which is logged server-side via `structlog.get_logger(__name__).warning/info("widget_result_validation_failed", ...)` instead. 7 unit tests cover valid-pass, missing-required, wrong-type, extra-key-under-`additionalProperties:false`, malformed schema, empty schema, and a reason-never-leaks-internals assertion. RED `79b6d55` → GREEN `4945651`. `uv run ruff check` + `uv run mypy` + `uv run lint-imports` all clean (zero `app.infrastructure` imports).

## Task Commits

Each task was committed atomically:

1. **Task 1: chat_widget_interactions table + migration 0025** — `a676b83` (feat) — *committed in a prior session; verified live against local Supabase this session (see Accomplishments)*
2. **Task 2 RED: failing tests for ChatWidgetInteractionRepository CAS + staleness** — `cae4e57` (test) — *committed in a prior session*
2. **Task 2 GREEN: SupabaseChatWidgetInteractionRepository adapter (CAS + staleness)** — `126eba9` (feat) — *this session*
3. **Task 3 RED: failing tests for validate_result_against_schema (D-10)** — `79b6d55` (test) — *this session*
3. **Task 3 GREEN: validate_result_against_schema pure re-validation service (D-10)** — `4945651` (feat) — *this session*

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

Tasks 2 and 3 both carry `tdd="true"`. Gate sequence verified in `git log --oneline`: `test(24-01)` commits precede their corresponding `feat(24-01)` commits for both tasks, with no intervening unrelated commits. No REFACTOR-phase commit was needed for either task. Compliant. (Task 1 has no `tdd` attribute — a single `feat` commit is correct per the plan.)

## Files Created/Modified

- `packages/db/src/schema/chat-widget-interactions.ts` — `ChatWidgetInteractions` Drizzle table + `ChatWidgetInteractionRow`/`InsertChatWidgetInteraction` inferred types
- `packages/db/migrations/0025_chat_widget_interactions.sql` — CHECK constraints, FKs, unique + conversation indexes, RESTRICTIVE RLS deny-all
- `packages/db/src/schema/index.ts` — barrel export added after `chat-canvas-layouts`
- `packages/db/migrations/meta/_journal.json` — 0025 entry appended after 0024
- `apps/email-listener/app/domain/ports/chat_widget_interaction_repository.py` — `WidgetInteraction` frozen dataclass + `ChatWidgetInteractionRepository` Protocol
- `apps/email-listener/app/infrastructure/supabase/supabase_chat_widget_interaction_repository.py` — the CAS + staleness adapter
- `apps/email-listener/app/infrastructure/supabase/__tests__/test_supabase_chat_widget_interaction_repository.py` — 8 unit tests
- `apps/email-listener/app/domain/services/widget_result_validator.py` — `ValidationOutcome` + `validate_result_against_schema`
- `apps/email-listener/app/domain/services/__tests__/test_widget_result_validator.py` — 7 unit tests

## Decisions Made

See `key-decisions` in frontmatter. Summarized: empty declared schema `{}` is deliberately fail-closed (not delegated to jsonschema's permissive-by-default reading); `Draft7Validator` chosen to match the one existing JSON-Schema-draft convention already in this codebase; both new entities are frozen dataclasses and both new repository/service methods propagate exceptions (never swallow) since pending-widget state and schema validation are correctness-critical, not best-effort telemetry.

## Deviations from Plan

None — plan executed exactly as written. Task 1 and Task 2's RED commit were already present from a prior session (confirmed live: local Supabase migration state matches the plan's acceptance criteria exactly, and the RED test file's assertions match Task 2's `<behavior>` spec verbatim); this session's work was Task 2's GREEN commit plus all of Task 3, both completed without any auto-fixes, architectural deviations, or scope changes.

## Issues Encountered

None.

## User Setup Required

None. No new dependencies (jsonschema/drizzle/supabase-py already in the repo, per the plan's threat-model T-24-SC disposition); migration 0025 is already applied to local Supabase. Staging/prod deploy of migration 0025 remains a standard pending-deploy item (consistent with every prior chat-spine/canvas migration in this milestone) — not blocking further Phase 24 plan execution, which continues against local Supabase.

## Known Stubs

None. Zero UI, zero tool, zero endpoint code in this plan by design (per the plan's own `<objective>` — this is persistence + safety primitives only). No stub data flows exist because there is no rendering surface yet for this plan to stub.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated — all four dispositions (T-24-01, T-24-02, T-24-03, T-24-04) and the supply-chain check (T-24-SC) are implemented exactly as planned:
- T-24-01 — the declared response schema is STORED in `chat_widget_interactions.declared_response_schema` at emit time; `validate_result_against_schema` re-validates against whatever schema the CALLER passes in — a later plan's submit endpoint is responsible for loading it from the stored row, never from client input (this plan's function signature has no way to accept a client-supplied schema implicitly).
- T-24-02 — `try_submit`'s CAS `eq("state", "pending")` predicate mitigates double-submit/replay exactly as specified; confirmed via the RED→GREEN unit tests.
- T-24-03 — RESTRICTIVE deny-all RLS confirmed live on local Supabase for both `anon` and `authenticated` roles.
- T-24-04 — accepted disposition unchanged; no client writes this table directly in this plan.
- T-24-SC — no new packages installed.

## Next Phase Readiness

- The persistence + CAS lock + staleness query + pure validator are all proven and available for 24-02 (the `emit_interactive_widget` tool + tool-registry wiring) and 24-03/24-04 (the submit endpoint + transcript/canvas rendering) to build on directly — no further schema or safety-primitive work is needed before those plans start.
- The `interactive_widget`/`interaction_result` typed message-part contract documented in `24-CONTEXT.md`'s `<interfaces>` block is unaffected by this plan (parts are emitted/read by later plans) — this plan only guarantees the row those parts' `interactionId` points at exists, is locked, and is re-validatable.

---
*Phase: 24-dual-channel-genui*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 9 created/modified source files confirmed present on disk. All 5 commits
(`a676b83`, `cae4e57`, `126eba9`, `79b6d55`, `4945651`) confirmed present in
`git log --oneline`. `apps/email-listener` pytest: 15/15 green (8 repository +
7 validator tests, `--no-cov` since single-file runs don't need the whole-repo
80% coverage gate per project convention). `uv run ruff check` + `uv run mypy` +
`uv run lint-imports` all clean on every new domain/infra file. `packages/db`
`tsc --noEmit` clean. Migration 0025 confirmed live on local Supabase: all
columns, both CHECK constraints, both RESTRICTIVE RLS policies, and both
indexes present (queried directly via `pg` client against
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
