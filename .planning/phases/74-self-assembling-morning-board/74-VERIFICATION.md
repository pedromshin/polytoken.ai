---
phase: 74-self-assembling-morning-board
verified: 2026-08-06T19:10:00Z
status: passed
score: 6/7 success criteria verified; 1 human-gated (MORN-07 live overnight acceptance)
overrides_applied: 0
provenance: >
  RETROACTIVE, orchestrator-run verification. Phase 74 was built by the grand-orchestrator
  sessions (2026-07-25/26), NOT the per-plan GSD pipeline — there are no 74-0x-PLAN.md /
  SUMMARY.md trails in this phase directory (SPEC.md only). Ground truth is therefore
  .planning/ORCHESTRATOR-STATE.md (the "PRE-COMPACT CHECKPOINT — 2026-07-25" block, Phase 74
  entries; and "ULTRACODE ROUND 3 — MERGED TO MAIN + LISTENER DEPLOYED — 2026-07-27" for deploy
  provenance) plus the git SHAs below — every claim in this report was re-grounded against the
  ACTUAL code on main, not trusted from the ledger.
commits:
  - "f573c3dc 2026-07-26 — MVP: one-click client 'Assemble board' on /chat (visible, no flag)"
  - "1fe5b802 2026-07-26 — worker: cron + dispatch_morning_boards fan-out + migration 0054 allowlist (74-01)"
  - "01055ac8 2026-07-26 — listener: composer + tenancy-safe service-role home writer + /v1/home/assemble-job + MORNING_BOARD_ENABLED (74-02/03/04)"
  - "f5eef75b 2026-07-26 — web: /home renders the composed board as a real canvas (HomeCanvas, MORN-07 paint slice)"
  - "1d1391a2 2026-08-06 — migration 0061 supersedes 0054 via CREATE OR REPLACE, RETAINS both morning-board identifiers (verified line-level below)"
  - "all five confirmed ancestors of main via `git merge-base --is-ancestor` on 2026-08-06"
---

# Phase 74: The Self-Assembling Morning Board — Verification Report

**Phase Goal:** Overnight, a scheduled agent run composes (and each morning refreshes) the user's
`home`-scoped canvas — brief, review queue, spend meter — materialized as real canvas nodes on the
pinned home board before the user ever opens `/home`. Worker cron → per-user fan-out → listener
composer → service-role home writer → `/home` paints it.
**Verified:** 2026-08-06 (retroactive, wrap-up session)
**Status:** passed — all six gate-able criteria verified against code; MORN-07 is the named
human-gated live seam (worker container not provisioned), not a failure.

## Goal Achievement

### Observable Truths (SPEC.md success criteria, goal-backward)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| MORN-01 | `assemble_morning_board` accepted by the `enqueue_job` allowlist (forward migration, 0053 untouched) and present in the worker `taskList`; unknown identifier still raises | ✓ VERIFIED | Migration `packages/db/migrations/0054_enqueue_allowlist_morning_board.sql:36-43` adds `assemble_morning_board` + `dispatch_morning_boards` via CREATE OR REPLACE (0053 not edited). **Superseded-but-preserved check (the regression that would silently kill this):** today's `0061_enqueue_allowlist_cascade_recipe.sql:41-51` re-replaces the function and RETAINS both morning identifiers (`:44-45`) alongside the new cascade/recipe ones; unknown identifier still `RAISE EXCEPTION` (`:50`). Worker `taskList` carries both: `apps/worker/src/tasks.ts:537-544` (`assemble_morning_board` handler `:56-58` POSTs `/v1/home/assemble-job`; `dispatch_morning_boards` `:113-124`). Allowlist accept/reject exercised in `apps/worker/src/__tests__/worker-integration.test.ts:130` ("accepts the morning-board identifiers and rejects an unknown one (MORN-01)") — see the harness-gating caveat below. |
| MORN-02 | Worker `crontab` enqueues `assemble_morning_board` on schedule AND fans out one idempotent job per active user (N users → N jobs, same-day re-run replaces) | ✓ VERIFIED | Crontab line `"0 5 * * * dispatch_morning_boards"` at `apps/worker/src/index.ts:44`, included in `run()`'s crontab (`:94`) when `MORNING_BOARD_ENABLED` is truthy (`:63-65`, `:81-87` — the ship-dark composition, see MORN-06). Dispatcher enumerates active users = home-board owners (`ACTIVE_USERS_SQL`, `tasks.ts:103-104`) and enqueues each THROUGH the guarded `public.enqueue_job` wrapper (`tasks.ts:113-124`). Fan-out contract is pure + unit-proven: `fanOutMorningBoards` (`tasks.ts:84-94`), `morningJobKey` = `morning:<uid>:<yyyy-mm-dd>` (`:71-73`); tests `tasks.test.ts:84-128` ("one job per user with morning:<uid>:<day> keys", "N users → N jobs; empty → zero", "idempotent per day: same-day re-run yields identical keys; next day differs"). The job_key-replaces-pending semantics are graphile-worker's documented contract, additionally exercised in `worker-integration.test.ts:155` (harness-gated). The cron actually FIRING at 05:00 UTC is only provable live → folded into the MORN-07 seam. |
| MORN-03 | `/v1/home/assemble-job` raises (→ 5xx) on any failure and is api-key-guarded | ✓ VERIFIED | Route `apps/email-listener/app/presentation/api/v1/home_assemble.py:28` — `dependencies=[Depends(require_api_key)]` on the router; no try/except anywhere in the handler (`:42-56`), docstring names the no-swallow contract explicitly. Use case propagates writer failures (`assemble_morning_board.py:48-60`, no except). Tests `test_home_assemble.py`: `test_assembly_failure_returns_500_so_graphile_retries` (`:83`) — the swallow-to-200 regression test the SPEC demanded — and `test_route_is_api_key_guarded` (`:103`); worker side mirrors it (`tasks.test.ts:59-82`: non-2xx throws, no swallow). Re-ran: 16/16 green (see gates). |
| MORN-04 | Service-role home writer keys on the job's `user_id` (not a session), stamps `scope='home'`, tenancy-safe (user A can never land on user B's row) | ✓ VERIFIED | `apps/email-listener/app/infrastructure/supabase/home_canvas_layout_writer.py`: probe AND update both filter `.eq("user_id", user_id).eq("scope", "home")` (`:62-71`, `:74-78`); insert stamps `user_id` + `scope='home'` + `conversation_id=None` itself (`:82-88`). Identity can never leak from the snapshot: `snapshot.py:96-103` (`to_row_columns` returns ONLY content columns — tenancy columns stamped by the writer, documented "this serializer can never carry an identity"). `user_id` arrives from the job payload via the route (`home_assemble.py:15-18`, `:55`), never a session. Tests `test_home_canvas_layout_writer.py`: `test_write_stamps_user_id_and_home_scope` (`:92`), `test_two_users_produce_two_distinct_rows` (`:107`), `test_same_user_twice_overwrites_in_place_lww` (`:122`) — the `home-canvas.ts:15-23` ownership invariant mirrored, as the SPEC required. |
| MORN-05 | Composed snapshot validates against `CanvasSnapshotSchema`; every emitted node type resolves in `node-types.ts` (or degrades to placeholder) | ✓ VERIFIED | Deterministic composer `compose_morning_board.py:58-83` emits `brief`/`review-queue`/`usage` (`_STARTER_NODES` `:51-55`), hardcoded ids/positions/non-overlapping row, pure (no I/O). Domain mirror of the Zod contract: `app/domain/canvas/snapshot.py` (`to_dict` `:45-62`, `to_snapshot_dict` `:81-94` — strict-key shape, optional width/height/viewport omitted when None). Tests `test_compose_morning_board.py`: `test_composer_output_validates_against_snapshot_shape` (`:106`, structural mirror of `CanvasSnapshotSchema` incl. `.strict()` key sets, `min(1)` strings, D-05 spec/root ban, proto-pollution ban `:57-103`), `test_composer_emits_only_registered_node_types` (`:113`, checked against the transcribed `NODE_TYPE_REGISTRY` set `:24-51`), plus non-overlap + determinism (`:124`, `:134`). All three types resolve in `apps/web/src/app/chat/_canvas/node-types.ts:61,64,65`; unknown types degrade to `UnknownNodeTypePlaceholder` (`node-types.ts:88-90`) — no blank canvas. Caveat: the registered-type set in the pytest is a *transcription* of the TS registry, not a build-time import (cross-language) — drift would need both sides to move; the placeholder degrade is the runtime backstop. |
| MORN-06 | `MORNING_BOARD_ENABLED=False` fully darkens the path (no cron enqueue, no assembly) | ✓ VERIFIED | BOTH ends read the same env var. Listener: `settings.py:361` (`MORNING_BOARD_ENABLED: bool = False`, sibling to the anticipatory switch per the SPEC); composition root passes it as `enabled` (`morning_board_providers.py:32-39`); use case short-circuits BEFORE composer and writer (`assemble_morning_board.py:55-56`); route returns a 200 no-op with `assembled: false` so the worker contract stays stable (`home_assemble.py:10-13`). Worker: the morning crontab line is only composed when the flag is truthy (`index.ts:63-65`, `:81-87`) — default OFF means `run()` receives NO crontab (`:94`), so nothing is enqueued nightly. Tests: `test_settings_morning_board.py:19-27` (defaults False, is bool — the settings test the SPEC named), `test_dark_use_case_returns_200_noop` (`test_home_assemble.py:75`), `test_disabled_flag_composes_and_writes_nothing` (`test_assemble_morning_board.py:30`). Caveat (honest): the worker-side `crontab()` composition function itself has no unit test — `index.ts` is the process entrypoint; verified here by code inspection, and the listener-side dark short-circuit is belt-and-braces behind it. |
| MORN-07 (LIVE) | After a real scheduled overnight run, `/home` in a fresh browser shows the pre-assembled board with correct counts + timestamp (`screenshot:review`) | ⛔ HUMAN-GATED (named live seam — not a failure) | **The paint slice IS shipped and verified:** `f5eef75b` — `HomeCanvas` (`apps/web/src/app/home/_components/home-canvas.tsx:62-125`) renders the home layout's nodes via the shared /chat `nodeTypes` map (`:36`, `:108`) inside `CanvasStoreProvider`; reached only through `home-canvas-island.tsx:16-26` (`dynamic(ssr:false)`); `home-board.tsx:151-152,194-198` switches to the canvas whenever the layout has nodes, else the fixed panels; the client "Assemble board" button writes the SAME starter node set the overnight composer draws (`home-board.tsx:31,119-137` vs `compose_morning_board.py:51-55` — same types, same 360/48 row geometry) into the SAME home layout row the composer's writer targets, so flipping the flag makes the pre-assembled board simply appear. Test: `home-board.test.tsx:208` ("Assemble board writes the composed node set to the home layout (Phase 74/MORN-07)"), 6/6 green re-run. **What remains is exactly the live loop, all Pedro-gated:** see Human Verification Required below. jsdom does no layout (CLAUDE.md rendered-geometry landmine) — this criterion is DEFINED as a real-browser gate and cannot be closed from here. |

**Score:** 6/7 verified · 1 human-gated · 0 gaps

### Required Artifacts (SPEC build sketch → what actually shipped)

| Artifact (SPEC plan) | Expected | Status | Details |
|---|---|---|---|
| 74-01 scheduler + fan-out (worker/db) | crontab + dispatcher + per-user fan-out + allowlist migration | ✓ VERIFIED | `1fe5b802`: `apps/worker/src/index.ts` (crontab, flag-gated), `tasks.ts` (`assemble_morning_board`, `dispatch_morning_boards`, `fanOutMorningBoards`, `morningJobKey`), `packages/db/migrations/0054_*.sql`. 0053 untouched; 0061 (`1d1391a2`) re-verified to carry the identifiers forward. |
| 74-02 governor flag (listener) | `MORNING_BOARD_ENABLED=False` + short-circuit test | ✓ VERIFIED | `01055ac8`: `settings.py:361` + `test_settings_morning_board.py` (2 tests). |
| 74-03 assembly use case + internal route | `/v1/home/assemble-job` mirroring `ingest_job.py`, deterministic composer | ✓ VERIFIED | `01055ac8`: `home_assemble.py` (api-key, raise-on-failure), `assemble_morning_board.py`, `compose_morning_board.py` (deterministic composer — the SPEC's lower-risk MVP option, agentic version deferred as planned). DI wiring: `composition/morning_board_providers.py` (+ `container.py:223` boot reference, `test_container_boot.py` covers boot). |
| 74-04 service-role home writer | session-less, explicit-`userId`, `scope='home'`-stamping writer | ✓ VERIFIED | `01055ac8`: `home_canvas_layout_writer.py` + `domain/ports/home_canvas_writer.py` + `domain/canvas/snapshot.py`. Deviation from SPEC option (a) documented in-file (`:14-20`): PostgREST cannot target the partial unique index via `on_conflict`, so it is a keyed read-then-write (probe → UPDATE | INSERT) instead of a single upsert — safe as LWW because one home row per user + a single 5am writer; the race window is named in the file and in the SPEC's own landmine list. |
| 74-05 home first-paint + live gate | `/home` renders server-written nodes; screenshot gate | ◐ PAINT VERIFIED / LIVE GATE HUMAN-GATED | `f5eef75b`: `home-canvas.tsx`, `home-canvas-island.tsx`, `home-board.tsx` canvas branch, `page.tsx:28-30` mounts it. The screenshot leg is MORN-07 (below). |
| MVP demo (SPEC "vertical slice") | enqueue → agent → screen, no typing | ◐ CLIENT HALF LIVE | `f573c3dc` ships the user-triggered equivalent (Add-node → Assemble board on /chat; `home-board.tsx:119-137` the /home button). The worker-driven `enqueue → screen` loop needs the provisioned worker (human-gated). |

### Adversarial Spot-Checks (self-run 2026-08-06, not trusted from the ledger)

| Check | Method | Result |
|---|---|---|
| Allowlist survives the 0061 supersede | Read `0061_enqueue_allowlist_cascade_recipe.sql:41-51` line-by-line (this migration CREATE OR REPLACEs the same function TODAY — dropping the morning identifiers here would have silently un-shipped MORN-01 with every Phase-74 test still green) | Both `assemble_morning_board` (`:44`) and `dispatch_morning_boards` (`:45`) present; unknown-identifier RAISE intact (`:50`); SECURITY DEFINER + REVOKE/GRANT posture identical (`:37`, `:58-60`). No regression. |
| Commits actually on main | `git merge-base --is-ancestor <sha> main` for f573c3dc, 1fe5b802, 01055ac8, f5eef75b, 1d1391a2 | All five confirmed ancestors of main. |
| Client and server compose the SAME board | Diffed `home-board.tsx` `STARTER_BOARD`/`BOARD_NODE_W=360`/`BOARD_NODE_GAP=48`/`HOME_REGISTRY_VERSION="home-v1"` (`:31-33,43`) against `compose_morning_board.py` `_STARTER_NODES`/`_CARD_WIDTH=360.0`/`_CARD_GAP=48.0`/`HOME_REGISTRY_VERSION="home-v1"` (`:38,42-44,51-55`) | Same three types, same row geometry, same registry tag — the "written but not painted" gap is genuinely closed: one write target, one reader. (Node ids differ by design: composer uses stable ids for LWW overwrite `:47-50`; client mints uuids — both valid per schema.) |
| Snapshot serializer can't leak identity | Read `snapshot.py:96-110` | `to_row_columns` emits content columns only; `user_id`/`scope`/`conversation_id` stamped exclusively by the writer from the job payload (`home_canvas_layout_writer.py:82-87`). Cross-tenant write requires the writer to be handed the wrong `user_id` — which only the api-key-guarded route supplies. |
| Ship-dark is structural at both ends | Read `index.ts:79-94` + `morning_board_providers.py:32-39` | Worker: flag off → no crontab key passed to `run()` at all. Listener: flag read at composition root, use case short-circuits before composer AND writer. Handlers stay registered (deliberate — a manually-enqueued dev job still runs, `index.ts:58-61`), which is the SPEC's MVP-demo affordance, not a leak: nothing can enqueue nightly while dark. |

### Regression Gates (re-run myself 2026-08-06)

| Gate | Command | Result |
|---|---|---|
| Worker suite | `npx vitest run` in `apps/worker` | **34 passed** (tasks.test.ts) · 4 skipped (worker-integration.test.ts — see caveat). Matches the wrap-up ledger's "worker 34". |
| Listener Phase-74 targeted suites | `uv run pytest` over the 5 morning-board test files (`--no-cov`; a targeted run trips the global 80% coverage floor by construction, not by failure) | **16 passed** (settings 2 · assemble 3 · compose 4 · writer 3 · route 4). |
| Web /home suites | `npx vitest run src/app/home` in `apps/web` | **13 passed** (home-board 6 · morning-brief 7). |
| Full matrices | Per the wrap-up session ledger: FULL listener pytest + full TS matrix running at integration (worker 34, mcp 32/32, web 461 targeted + typecheck, drizzle check, api-client 59, listener mypy 318 + lint-imports) | Reported green by the orchestrator's ledger; the targeted re-runs above are this report's independent floor. |

**Honest caveat — harness-gated proofs:** `worker-integration.test.ts` (the MORN-01 allowlist
accept/reject and MORN-02 job_key-replaces proofs against a REAL graphile_worker schema)
self-skips without `WORKER_TEST_DATABASE_URL` (`:21`, `:63`) and skipped in this re-run — no local
pg16 cluster here. Those two properties rest on (a) the migration SQL read line-by-line above,
(b) graphile-worker's documented `job_key` contract, and (c) the test existing for any
environment that provisions the harness. Also note the integration file pins the 0054-era
allowlist inline (`:29-31`) — it predates 0061's widening; harmless (it tests accept/reject
mechanics, not the full production list) but worth a refresh when the harness next runs.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| MORN-01 | ✓ SATISFIED | Truth 1 |
| MORN-02 | ✓ SATISFIED | Truth 2 (schedule-firing leg folded into MORN-07) |
| MORN-03 | ✓ SATISFIED | Truth 3 |
| MORN-04 | ✓ SATISFIED | Truth 4 |
| MORN-05 | ✓ SATISFIED | Truth 5 |
| MORN-06 | ✓ SATISFIED | Truth 6 |
| MORN-07 | ⛔ HUMAN-GATED | Truth 7 — live seam, named below |

`.planning/REQUIREMENTS.md:208-214` maps exactly these seven to Phase 74; no orphans.

### Anti-Patterns Found

None material. Scanned every Phase-74 file (composer, use case, writer, port, route, providers,
snapshot, worker tasks/index, HomeCanvas, island, home-board) for TODO/FIXME/HACK/PLACEHOLDER/
stub markers — zero. The `9dd2020e` ruff-format pass later touched the morning-board tests
(formatting-only, verified no semantic diff in the ledger). Two deliberate, documented deviations
(read-then-write upsert; transcribed type registry) are recorded honestly in Required Artifacts /
Truth 5 — both have named runtime backstops.

### Human Verification Required (the MORN-07 live seam — all Pedro-gated)

MORN-07 is defined as a real-overnight-run + real-browser gate; every prerequisite is an
operator action, not missing code:

1. **Worker container provisioning** — `apps/worker` is not wired in `ecs.tf`; Terraform `apply`
   is blocked on the remote-state import runbook (live SES rules would be recreated = mail
   outage). Runbook: `docs/DURABLE-WORKER-RUNBOOK.md`.
2. **graphile_worker schema + migrations on prod** — `0054` (and `0061` which supersedes it, plus
   the 0058-0060 verify) must be applied via the MIGRATE-PROD pipeline once the 3 absent `PROD_*`
   secrets exist; both migrations RAISE by design while the `graphile_worker` schema is absent
   (`0054:19-24`, `0061:24-29` ordering guards) — that schema needs `apps/worker` install-schema
   against a real PG connection first.
3. **Flag flip** — `MORNING_BOARD_ENABLED` at BOTH ends (worker container env → crontab appears;
   listener env → use case assembles). One env var, two consumers, per `index.ts:54-57`.
4. **The live acceptance itself** — after a real 05:00 UTC firing against the seed user's real
   inbox: fresh browser → `/home` → pre-assembled board with correct counts → `screenshot:review`
   capture (jsdom does no layout; per CLAUDE.md this MUST be a real-browser gate).
5. **Context (wrap-up 2026-08-06):** prod Supabase projects were auto-paused (9 days) and are
   restored, but DB passwords changed — prod web DB is down pending Pedro's password reset+paste,
   so the live gate is doubly blocked until that incident closes.

Also carried from the SPEC's landmine list as a live-verification seam: the LWW clobber window
(a user editing /home at exactly 05:00 UTC could be overwritten by the whole-snapshot write —
mitigated by stable composer node ids, single nightly writer; observe on first live runs).

### Gaps Summary

None. Everything the phase promised that is provable from the tree is in the tree and green:
the enqueue → route → composer → tenancy-safe writer chain exists end-to-end with the exact
guard properties the SPEC named (allowlist raise, no-swallow 5xx, api-key, `(user_id,
scope='home')` wall, schema-valid deterministic snapshot, single-flag darkness), the /home
surface paints the same layout row the overnight writer targets, and the client-triggered MVP
delivers the board today with no flag. The single open item (MORN-07) is the phase's own named
live-loop criterion, blocked exclusively on operator-gated infrastructure (worker provisioning,
prod migrations, flag flips, prod-DB incident) — a seam, not a defect.

---

*Verified: 2026-08-06 · retroactive, orchestrator-run provenance (no per-plan PLAN.md trails —
grounded in ORCHESTRATOR-STATE.md rounds + git SHAs + direct code re-verification)*
*Verifier: Claude (wrap-up session subagent)*
