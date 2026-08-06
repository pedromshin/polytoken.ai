---
phase: 75-correction-propagation-flywheel
verified: 2026-08-06T22:30:00Z
status: human_needed
score: 5/6 gate-able criteria VERIFIED (code-level); CPF-06 screenshot leg + the CPF-live loop are human-gated live seams, not failures
provenance: orchestrator-run — no per-plan PLAN.md trails exist for this phase (SPEC.md only); provenance is ORCHESTRATOR-STATE.md session blocks + AUTONOMOUS-RUN.md W7 + git SHAs (see Provenance section)
overrides_applied: 0
human_verification:
  - test: "CPF-06 screenshot leg: with a running server + seeded data, run `npm run screenshot:review` (apps/web/playwright.screenshot.config.ts) extended to cover a merge on a ReviewQueueNode with co-placed survivor + absorbed EntityNodes."
    expected: "Survivor card visibly gains the absorbed alias + updated counts; absorbed card shows its 'merged into another' null state; cascade highlight ring sweeps both."
    why_human: "The invalidation + highlight code shipped (32b21c60) with jsdom logic tests, but the SPEC explicitly requires a REAL-browser capture ('jsdom cannot see this'); apps/web/e2e/screenshot-review.spec.ts predates Phase 75 and has no cascade coverage. This is part of the wrap-up session's remaining real-browser screenshot pass (Pedro-gated)."
  - test: "CPF-live loop: apply migrations 0060+0061 (and verify 0058-0060) to prod via deploy-migrate-prod.yml (needs the 3 absent PROD_* repo secrets), provision the worker container (ecs.tf wiring, Terraform remote-state gate), flip CASCADE_CORRECTION_ENABLED, confirm a real merge, and watch the cascade_relabel job drain."
    expected: "correction_propagations gains one row (job_key cascade:{S}:{T}); the sender→S/T AMBIGUOUS edges flip to EXTRACTED with mechanism='merge_cascade'; the absorbed identity's past-email candidate links re-resolve so entities.byId.occurrences for S grows; re-running the merge cascade is a no-op."
    why_human: "Flag flip + prod migration + worker provisioning are all operator-gated live actions (no PROD_* secrets in CI, no remote Terraform state, graphile_worker schema ordering guard in 0061 fails loudly if applied first). Same live-DB deferral posture Phase 57 recorded."
  - test: "Unmerge symmetry: after a live cascade, run unmerge on the pair and inspect the ledger + promoted edges."
    expected: "Defined behavior per the SPEC risk note: unmerge reverses merge state + D-11 alias; edge DEMOTION is explicitly out of MVP scope — confirm nothing silently claims the cascade was reversed."
    why_human: "SPEC flags this as needs-live-verification; no compensating-ledger write was built (out of MVP scope, called out — not silently skipped: cascade_correction.py's ledger is insert-only by design)."
---

# Phase 75: Correction-Propagation Flywheel — Verification Report

**Phase Goal:** The user corrects the AI once (confirms a merge on a canvas node) and the correction cascades: suggestion edges promote to canon, the absorbed identity's past emails re-label onto the survivor, and every downstream canvas node re-renders live — one correction, propagated everywhere, made visible.
**Verified:** 2026-08-06 (wrap-up session; all Phase-75 commits local on `main`, about to push)
**Status:** human_needed — all six gate-able CPF criteria are implemented and test-covered at code level; the two remaining legs (real-browser screenshot, live loop) are named operator seams.
**Re-verification:** No — initial (retroactive) verification.

## Provenance — honest orchestrator-run disclosure

This phase was NOT executed through the standard GSD plan pipeline. `.planning/phases/75-correction-propagation-flywheel/` contains **SPEC.md only** — there are no 75-0N-PLAN.md / 75-0N-SUMMARY.md trails. The build ran across three orchestrator sessions; the audit trail is the orchestrator ledgers plus git:

| Slice | Commit (main) | Date | Session / ledger evidence |
|---|---|---|---|
| 75-05 web visible half (CPF-05 + CPF-06 code) | `32b21c60` | 2026-07-26 | ORCHESTRATOR-STATE.md:467-478 ("SESSION UPDATE — 2026-07-26 · session_016dmeeGLzwLPZfRwGpByHmn": "Phase 75 VISIBLE half SHIPPED (`32b21c6`, CPF-05/06)"; server cascade explicitly deferred there) |
| 75-01 ledger (migration 0060 + Drizzle schema) | `2e728ddb` | 2026-07-27 | AUTONOMOUS-RUN.md:56-85 (overnight run W7: "75-01 ledger + 75-02 CascadeCorrectionUseCase SHIPPED (additive)"), PR #11 batch |
| 75-02 CascadeCorrectionUseCase + ports + unit tests | `a34cff73` | 2026-07-27 | Same overnight-run ledger (W7, "~12:1x UTC — Phase 75-02 shipped"); 75-03/04 deliberately deferred there ("live-merge-path domain logic; wants Pedro's review") |
| 75-04 worker `cascade_relabel` task + allowlist migration 0061 | `1d1391a2` | 2026-08-06 | Wrap-up session (this one); adversarially verified, CONFIRMED findings fixed same-session |
| 75-03 ConfirmMerge wiring (flag-gated) + relabel-job route + summary threading | `d5c5b1d2` | 2026-08-06 | Wrap-up session (this one); adversarially verified, CONFIRMED findings fixed same-session |

Gate matrix at 2026-08-06 integration: worker 34 ✓ · mcp-server 32/32 ✓ · web 461 targeted + typecheck ✓ · drizzle-kit check ✓ · api-client 59 (entities) ✓ · listener targeted suites + mypy 318 + lint-imports ✓; FULL listener pytest + full TS matrix were still running at report-write time (assumed green unless the orchestrator's ledger notes otherwise).

## Goal Achievement

### Success Criteria (SPEC.md:224-260, goal-backward)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| CPF-01 | Cascade promotes exactly the active suggestion-tier sender→S/T edges via `PromoteEdgeUseCase`, never a second flip path; importer from the loaded survivor row (D-21) | VERIFIED | `cascade_correction.py:87-112` — survivor loaded first, `importer_id = survivor.importer_id`, then per-edge `self._edge_promoter.execute(edge_id, importer_id, mechanism="merge_cascade")` with `EdgeNotPromotable`/`EdgeNotFound` caught-and-skipped (the promoter's own guards stay the single source of truth for promotability). Composition threads the REAL `PromoteEdgeUseCase` as the `EdgePromoter` protocol (`entity_providers.py:188-194`) — the one canon-raise write; `promote_edge.py:90` accepts the additive `mechanism` kwarg. Test: `tests/application/test_cascade_correction.py:144-166` (`test_cpf01_...`) proves e3 (already EXTRACTED) is attempted-but-skipped, all calls carry `importer_id == "imp-1"` from the loaded row and `mechanism == "merge_cascade"`, and the edge query is scoped to `["S","T"]` + the survivor's importer. |
| CPF-02 | Idempotent re-run: same (S,T)/`job_key` promotes nothing already promoted, writes no duplicate ledger row | VERIFIED | `job_key = f"cascade:{survivor_id}:{absorbed_id}"` (`cascade_correction.py:119`); enqueue carries it (`:121-129`); ledger written LAST so a half-run never claims completion (`:131-140`). Adapter: ignore-duplicates upsert `on_conflict="job_key"` returning truthy only for a NEW row (`correction_cascade_repository.py:157-164`) against the unique index `uq_correction_propagations_job_key` (`0060_rapid_red_skull.sql:17`). Test: `test_cascade_correction.py:170-187` (`test_cpf02_rerun_is_idempotent`) — second run promotes `[]`, `ledger_written is False`, exactly 1 persisted row per key. Live-Postgres exercise of the upsert is part of the CPF-live seam. |
| CPF-03 | `correction_propagations` migration + importer-scoped ledger row (survivor, absorbed, promoted edge ids, affected email ids); cross-importer isolation (TENA-03/D-21, mirrors `entity_type_corrections`) | VERIFIED (code-level, one spec deviation noted) | Migration `0060_rapid_red_skull.sql` read in full: table with importer FK (`:12`, hard-FK to `importers`, no bare user_id), survivor/absorbed FKs to `entity_instances` (`:13-14`), importer + survivor indexes (`:15-16`), unique job_key (`:17`), RLS enabled + owner-authenticated policy mirroring 0038 (`:22-26`). Drizzle mirror `packages/db/src/schema/correction-propagations.ts:49-94`, exported (`schema/index.ts:26`), journal entries `0060`/`0061` present (`meta/_journal.json:422,429`). The write path always carries the caller-derived importer_id (`correction_cascade_repository.py:144-156`), which the use case derives from the loaded survivor row (D-21). **Deviation:** the SPEC's literal "cross-importer read returns nothing" repository test does not exist — because NO read path over the ledger exists anywhere yet (write-only capture, same 57-01 posture the SPEC itself prescribes for 75-01); isolation is delivered by the in-migration RLS wall + D-21 derivation + the reader's two-step `knowledge_nodes.importer_id` scoping (`correction_cascade_repository.py:70-88`). If a web/API read of this table is ever added, that read must bring the cross-importer test (and the `tableColumnExists` gate per SPEC Risks). |
| CPF-04 | `entities.confirmMerge` returns the cascade summary; both-side ownership still asserted BEFORE any listener call; summary passed through unmodified | VERIFIED | Listener: `curate_entity_merge.py:145-168` threads the summary onto the result under `"cascade"` strictly AFTER the three merge writes; endpoint surfaces it additively (`entity_instances.py:120-134` `CascadeSummaryView`/`MergeResultView.cascade: ... | None = None`, `:162-168`). tRPC: `mutations.ts:49-71` zod-validates the response at the boundary (`cascadeSummarySchema` + `.passthrough()`), `:141-145` parses and returns it unmodified. Tests: `mutations.test.ts:283` (Test 10 — ownership asserted BEFORE any fetch), `:306` (Test 11 — summary passed through unmodified), `:339` (Test 12 — malformed summary rejected); listener side `tests/test_entity_curation.py:691` (`test_confirm_surfaces_cascade_summary_when_present`) and `:715` (flag-off omits it). **Naming deviation:** the SPEC wrote the summary keys camelCase (`promotedEdgeIds`, …); the shipped shape is the listener's snake_case (`promoted_edge_ids`, …) passed through verbatim — the SPEC's own "passed through unmodified" clause wins; same four fields. |
| CPF-05 | On merge success the reconcile invalidates `api.entities.byId` for BOTH survivor and absorbed ids (plus existing reviewQueue + list) | VERIFIED | `use-merge-review.ts:103-119` — `settle()` now awaits `reviewQueue.invalidate()`, `list.invalidate()`, AND `entities.byId.invalidate({id})` for each affected id, with the module comment naming this the visible half of correct-once/propagate-everywhere. Test: `__tests__/merge-cascade-invalidate.test.tsx:113` ("merge success invalidates entities.byId for BOTH survivor and absorbed") + `:143` (reject repaints both too). Shipped in `32b21c60`. |
| CPF-06 | Real-browser screenshot: post-merge, survivor EntityNode gains alias/counts, absorbed shows "merged into another", via `npm run screenshot:review` | HUMAN-GATED (code shipped; capture pending) | The mechanism exists and is logic-tested: cascade-highlight signal (`cascade-highlight.ts`, `useSyncExternalStore`, non-persisted — LWW canvas row untouched, honoring the SPEC's landmine) wired into `entity-node.tsx`, ids handed to the signal on merge success (`merge-cascade-invalidate.test.tsx:132`, jsdom). The `screenshot:review` runner exists (`apps/web/package.json:19`) but `e2e/screenshot-review.spec.ts` contains no cascade/merge-repaint coverage — the SPEC demands a REAL-browser capture precisely because jsdom cannot see it (rendered-geometry blind spot). Belongs to the wrap-up session's remaining real-browser screenshot pass. |
| (live) | Re-label fan-out actually re-points the absorbed identity's past-email links in a real Postgres (`entities.byId.occurrences` for S grows) | HUMAN-GATED (named: CPF-live on the milestone runsheet) | Whole chain is built and dark: enqueue (`cascade_correction.py:121-129`) → allowlist `cascade_relabel` (`0061_enqueue_allowlist_cascade_recipe.sql:46`) → worker task POSTing verbatim to the listener, non-2xx throws → retry → dead-letter (`apps/worker/src/tasks.ts:45-47`, tests `tasks.test.ts:130-157`) → internal route re-running the pipeline per email fail-closed (`relabel_job.py:70-126`, 7 tests incl. importer-mismatch skip + mid-loop failure containment, `test_relabel_job.py:106-216`). Needs: migrations 0060+0061 applied via the migrate pipeline (3 `PROD_*` secrets absent — ORCHESTRATOR-STATE.md:440-456), worker container provisioning (ecs.tf, Terraform remote-state gate), `CASCADE_CORRECTION_ENABLED` flip. Inherits Phase 57's live-DB deferral posture. |

**Score:** 5/6 gate-able criteria VERIFIED (code-level); CPF-06's screenshot leg + the explicitly-deferred live loop are human-gated seams, not implementation gaps.

### Byte-dark-off adversarial check (the LIVE-merge-path risk)

The single scariest property — 75-03 touches the production merge path — was verified directly:

- `settings.py:373` — `CASCADE_CORRECTION_ENABLED: bool = False` (plain bool, mirrors `MORNING_BOARD_ENABLED`'s convention; only the composition provider reads it, `:369-372`).
- `entity_providers.py:185-186` — flag off ⇒ `ConfirmMergeUseCase(entity_instances=...)` with NO cascade collaborator: a **structural omission**, byte-for-byte the pre-75 merge behavior (dishka can't auto-inject the defaulted Optional, so the factory is the only decision point; `:244-250`).
- `curate_entity_merge.py:147-158` — flag on ⇒ cascade runs BEST-EFFORT strictly after the three committed merge writes; any exception is `log.exception`-swallowed, the merge never fails on propagation.
- Tests: `test_entity_curation.py:317` (flag off — no cascade call, result byte-identical), `:327` (runs after merge writes, survivor=subject), `:354` (raising cascade swallowed, merge completes, no cascade key), `:366` (a guard-rejected merge never reaches the cascade).

### Required Artifacts

| Artifact | Expected (SPEC build sketch) | Status | Details |
|----------|------------------------------|--------|---------|
| `packages/db/migrations/0060_rapid_red_skull.sql` | importer-scoped `correction_propagations` + RLS + indexes, 0038 template | VERIFIED | Read in full (27 lines): 3 FKs, 2 btree indexes, unique job_key, RLS policy hand-appended (drizzle-kit never emits policies — noted in-file). |
| `packages/db/src/schema/correction-propagations.ts` | Drizzle mirror, capture-shape-only posture | VERIFIED | Exported via `schema/index.ts:26`; journal entry present; jsonb `string[]` id-set idiom documented in-file. |
| `app/domain/ports/correction_cascade.py` | domain-pure ports | VERIFIED | Three Protocols (`EdgePromoter:20`, `CorrectionCascadeReader:38`, `CorrectionPropagationWriter:65`), stdlib-only imports — lint-imports clean (gate green). |
| `app/application/use_cases/cascade_correction.py` | promote → enqueue → ledger-LAST orchestrator | VERIFIED | 155 lines; ordering exactly as the SPEC's "Best-effort ordering" risk prescribes (ledger last, `:131-140`); frozen `CascadeSummary` dataclass. |
| `app/infrastructure/supabase/correction_cascade_repository.py` | tenancy-scoped adapter serving both cascade ports | VERIFIED | Edge read two-steps through `knowledge_nodes.importer_id` (edges carry no importer column — T-29-06 pattern, `:70-88`); affected-emails = inverse of the detail.ts occurrence join (`:101-125`, sorted for determinism); ledger upsert ignore-duplicates (`:157-164`). |
| `app/composition/entity_providers.py` | flag-gated factory wiring | VERIFIED | `_provide_confirm_merge_use_case` (`:160-195`): one adapter instance serves both ports; real `PromoteEdgeUseCase` + `JobEnqueuer` threaded in. |
| `curate_entity_merge.py` + `entity_instances.py` | best-effort invoke + additive summary surface | VERIFIED | See CPF-04 row; confirm endpoint response model gains optional `cascade` (`entity_instances.py:129-134`). |
| `app/presentation/api/v1/relabel_job.py` | worker re-entry for the fan-out | VERIFIED (deliberate SPEC deviation — see below) | `require_api_key`-guarded internal route, fail-closed per-email importer check, outcomes collected never raised (`:92-113`). |
| `apps/worker/src/tasks.ts` `cascade_relabel` | durable task, chunk/bound + idempotent | VERIFIED (bounding relocated — see deviations) | `tasks.ts:45-47` + registered in `taskList:541`; kept lock-step with the 0061 allowlist (doc `:534-535`). |
| `packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql` | allowlist widen for `cascade_relabel` | VERIFIED | CREATE OR REPLACE of the 0054 wrapper, allowlist-widen only (`:46`), graphile_worker-schema ordering guard (`:24-29`), SECURITY DEFINER + service_role-only grant (`:58-60`). Shared with Phase 73 Wave C identifiers. |
| `packages/api-client/src/router/entities/mutations.ts` | summary threading + unchanged TENA-03 | VERIFIED | See CPF-04 row. |
| `use-merge-review.ts` + `cascade-highlight.ts` + `entity-node.tsx` | visible propagation | VERIFIED | See CPF-05/06 rows; shipped `32b21c60` (5 files, +353/−13). |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `ConfirmMergeUseCase.execute` | `CascadeCorrectionUseCase.execute` | optional collaborator, best-effort AFTER the 3 merge writes | WIRED (flag-gated; `curate_entity_merge.py:151-156`) |
| `CascadeCorrectionUseCase` | `PromoteEdgeUseCase` | `EdgePromoter` protocol, `mechanism="merge_cascade"` | WIRED (`entity_providers.py:190`, `cascade_correction.py:104-107`) |
| `CascadeCorrectionUseCase` | `public.enqueue_job` | `JobEnqueuer.enqueue("cascade_relabel", …, job_key)` | WIRED (`cascade_correction.py:121-129`; identifier allowlisted `0061:46`) |
| graphile-worker | listener | `taskList.cascade_relabel` → POST `/v1/emails/relabel-job` (X-API-Key) | WIRED (`tasks.ts:45-47`; route registered `main.py:33,75`) |
| relabel route | `ReprocessEmailUseCase` | per-email, importer-checked fail-closed | WIRED (`relabel_job.py:93-113`) |
| listener confirm response | tRPC caller | additive `cascade` key, zod-validated passthrough | WIRED (`entity_instances.py:162-168` → `mutations.ts:141-145`) |
| merge success (web) | placed `EntityNode`s | `entities.byId` invalidation both ids + cascade-highlight signal | WIRED (`use-merge-review.ts:113-119`; `32b21c60`) |

### SPEC deviations (documented, not silent)

1. **75-04 route: internal `POST /v1/emails/relabel-job` instead of the SPEC's `callPython("/backfill-reprocess")`.** The SPEC's build sketch (`SPEC.md:288-291`) assumed the worker could call the existing batched backfill endpoint — but `backfill_reprocess.py` is capability-/forwarding-token-authed, and **that auth cannot be satisfied by a durable job payload** (a stored user token in job JSON would be its own defect). This is a SPEC auth defect; the fix mirrors the shipped `ingest_job.py` worker re-entry convention (`require_api_key`, localhost, off the ALB idle-timeout path) and is documented in-file (`relabel_job.py:8-11`). Fail-closed tenancy is preserved end-to-end (importer derived from the loaded survivor row, every email re-checked, `relabel_job.py:85-105`).
2. **Cascade summary keys are snake_case**, not the SPEC's camelCase spelling — resolved in favor of the SPEC's own "passed through unmodified" requirement (CPF-04); zod validates the exact snake_case shape at the boundary.
3. **CPF-03's literal "cross-importer read" repository test is absent** because the ledger has no reader yet anywhere in the codebase (deliberate 57-01/75-01 capture-only posture); isolation rests on the in-migration RLS + D-21 + the reader-side importer scoping. Becomes mandatory the day a read surface appears.
4. **≤25 chunking of the re-label batch** (SPEC 75-04 must-have "bounded batch size") is not re-imposed worker-side: the batching constraint existed to dodge the ALB idle timeout on the *public* backfill endpoint; the shipped route is called worker-locally per job and processes per-email with contained failures. The bound moved from transport-shape to per-email loop semantics. Flagged here so the live loop watches job duration on large absorbed identities.

### Anti-Patterns Found

None in the phase's touched files — scanned the cascade use case, ports, adapter, relabel route, worker task, mutations, and merge-review hook for `TODO|FIXME|HACK|PLACEHOLDER|not implemented`: zero matches; every touched function has real logic (verified by reading, not just grep).

## Gaps Summary

No code-level gaps. The two open legs are **named live seams, both Pedro-gated**, consistent with every prior phase's posture (57's live-DB deferral, the wrap-up session's seam list):

1. **CPF-live** (flag flip + prod migrations 0060/0061 via the migrate pipeline once the 3 `PROD_*` secrets exist + worker container provisioning + a real merge + relabel drain) — on the milestone live-acceptance runsheet. Until then the whole cascade is byte-dark off (`CASCADE_CORRECTION_ENABLED=False`) and a flag-on-before-migration lag degrades to "merge works, propagation deferred" by the best-effort catch — exactly the SPEC's prescribed failure mode.
2. **CPF-06 screenshot** — part of the remaining real-browser screenshot pass (prod web DB itself is currently down pending Pedro's Supabase password reset, per the wrap-up ground truth).

Unmerge symmetry (SPEC risk) is intentionally out of MVP scope: no compensating ledger write or edge demotion was built; this is disclosed above (human_verification #3) rather than silently skipped.

---
*Verified: 2026-08-06 (retroactive, wrap-up session)*
*Verifier: Claude (goal-backward against SPEC.md; orchestrator-run provenance — ORCHESTRATOR-STATE.md + AUTONOMOUS-RUN.md + git SHAs 32b21c60 · 2e728ddb · a34cff73 · 1d1391a2 · d5c5b1d2)*
