---
phase: 60-surface-redesign-inbox-email-detail
plan: 01
subsystem: ui
tags: [structural-fingerprint, anti-re-token-gate, entity-summary, provenance-mark, tdd]

# Dependency graph
requires:
  - phase: 59-visual-identity-designed-token-set-brand-guide
    provides: text-2xs..xl, font-serif, tabular, spacing-chip-x/y, radius-*, pmark/pmark-confirmed/pmark-suggested, tshape+variants (all consumed here)
  - phase: 58-visual-identity-sketch-pick-human-gate
    provides: D-58-01 (LOCKED) -- the three laws, the provenance-mark signature spec, direction-final.html as the measured reference
provides:
  - structural-fingerprint.ts's fingerprintTree(root) -- a colour-blind DOM topology fingerprint (no className/style/data-*) that Plan 02's inbox-structure.test.tsx builds its anti-re-token gate on
  - inbox-pre-60.json -- the frozen, committed pre-Phase-60 InboxThreePane DOM shape (elementCount=81, leafTextCount=32, maxDepth=10), regeneration-guarded
  - aggregateEntitySummary's per-FACT contract (componentId/typeLabel/value/tier/entityInstanceId, MAX_ENTITIES_PER_EMAIL=8, totalCount) replacing the pre-60 distinct-type rollup
  - EntityChips' D-58-01 provenance-mark rendering (value serif + typeLabel sans qualifier, tier-only colour via pmark-confirmed/pmark-suggested, neutral overflow chip, MAX_VISIBLE_CHIPS export)
affects: [60-02-surface-redesign-inbox-email-detail, 61-total-ui-re-skin-part-2, 62-total-ui-re-skin-part-3, 63-research-canvas-visual-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fingerprintTree's presence-only ARIA marker + value-carrying role marker split -- role values are structural/semantic (stable across renders) so they're read; aria-expanded/pressed/selected/hidden VALUES flip with component state so only their presence is recorded, keeping the fingerprint stable across otherwise-identical renders"
    - "per-fact aggregation via a flat emailId -> EntitySummaryEntry[] map instead of a nested emailId -> entityTypeId -> {label,count} map -- simpler than the pre-60 collapse-by-type structure since nothing collapses anymore"
    - "pmark's built-in font-family:serif is deliberately overridden back to font-sans on the OUTER chip container, then re-applied font-serif on the inner value span only -- keeps the subordinate type-qualifier span sans (law 2: chrome speaks sans) without fighting CSS inheritance"

key-files:
  created:
    - apps/web/src/app/__tests__/support/structural-fingerprint.ts
    - apps/web/src/app/_components/__tests__/capture-inbox-baseline.test.tsx
    - apps/web/src/app/_components/__tests__/__baselines__/inbox-pre-60.json
    - packages/api-client/src/router/emails/__tests__/entity-summary-aggregation.test.ts
  modified:
    - packages/api-client/src/router/emails/entity-summary.ts
    - packages/api-client/src/router/emails/__tests__/emails-user-scoping.test.ts
    - apps/web/src/app/_components/entity-chips.tsx
    - apps/web/src/app/_components/inbox-row.tsx
  deleted:
    - packages/api-client/src/router/__tests__/entity-summary.test.ts

key-decisions:
  - "EntityChips' totalCount prop is REQUIRED (matches Plan 02's own interfaces §A exactly), but inbox-row.tsx's call site currently passes entities.length as an honest-for-now stand-in -- entitiesByEmailId in inbox-three-pane.tsx does not yet carry the server's real per-email totalCount. This is a documented, deliberate stopgap: 60-02 threads the real value the rest of the way through (see 60-02-SUMMARY.md)."
  - "Value snippet cap set to 48 chars (VALUE_SNIPPET_MAX, internal to entity-summary.ts) -- mirrors region-label.ts's existing DEFAULT_SNIPPET_MAX=48 convention for the same 'detected text -> compact label' concept, kept as a local duplicate since packages/api-client cannot import from apps/web."
  - "Deleted packages/api-client/src/router/__tests__/entity-summary.test.ts outright rather than updating it in place -- it exhaustively tested the pre-60 collapse-by-type contract (count/label fields) that Task 2's <action> explicitly replaces; entity-summary-aggregation.test.ts at the plan's own declared path supersedes it with equivalent-or-greater coverage of the new per-fact contract."
  - "emails-user-scoping.test.ts Test 9's owner-less-short-circuit assertion was updated in place (added totalCount: 0) -- not in this plan's files_modified frontmatter, but required: the router's owner-less branch return shape had to grow the same field Task 2 added to EmailEntitySummary, or the existing test would break on a change this task itself caused (mirrors 59-02-SUMMARY.md's layout.tsx precedent -- a task's own necessary connectivity fix takes priority over a stale frontmatter list)."

patterns-established:
  - "toValueSnippet() in entity-summary.ts -- collapse-whitespace + trim + ellipsis-truncate, same shape as region-label.ts's contentSnippet but package-local (cross-package import from apps/web into packages/api-client is not viable)"

requirements-completed: [SURF-01, SURF-04]

# Metrics
duration: ~90min
completed: 2026-07-15
---

# Phase 60 Plan 01: Frozen Baseline + Provenance Chip Summary

**Froze the pre-Phase-60 inbox DOM shape as a committed, regeneration-guarded artifact via a colour-blind structural fingerprint (no className/style/data-*), then replaced the entity chip's distinct-type rollup with a per-FACT provenance mark (value + tier, capped at 8 with a truthful totalCount) — the chip's law-1 hue is gone, replaced by tier-only colour via the Phase-59 pmark utilities.**

## Performance

- **Duration:** ~90 min
- **Completed:** 2026-07-15
- **Tasks:** 3
- **Files modified:** 9 (5 created, 4 modified, 1 deleted)

## Accomplishments

- `structural-fingerprint.ts` exports `fingerprintTree(root)`, reading NO className, style, or `data-*` attribute — only tagName, role VALUE (structural, stable), presence-only ARIA state markers, and direct-text presence. This is the linchpin Plan 02's anti-re-token gate is built on: a pure re-token cannot move `shape`.
- `inbox-pre-60.json` is committed: **elementCount=81, leafTextCount=32, maxDepth=10**, captured against the CURRENT (pre-edit) `InboxThreePane` with a non-empty entity-chip fixture so the baseline doesn't understate pre-60 structure. Regeneration is guarded (`existsSync` throw) and proven: re-running the capture with `CAPTURE_STRUCTURE_BASELINE=1` set throws the frozen-baseline error; a plain `vitest run` neither writes nor fails (1 passed, 1 skipped).
- `aggregateEntitySummary` rewritten from a distinct-entity-TYPE rollup (`{ entityTypeId, label, count }`) into a per-FACT list (`{ componentId, entityTypeId, typeLabel, value, tier, entityInstanceId? }`) — two suppliers in one email are now two chips, not "supplier ·2". `MAX_ENTITIES_PER_EMAIL = 8` caps entries per email (T-60-03); `totalCount` on `EmailEntitySummary` reports the true pre-cap count. TDD: 12 new tests were RED against the old implementation (9/12 failed), then GREEN after the rewrite.
- The `entitySummary` procedure's `where` clause — especially `inArray(EmailComponents.importerId, owned)` (T-60-01) — is byte-identical; only the `select` grew (`id`, `contentText`, `extractionStatus`).
- `EntityChips` renders `value · typeLabel` (value in `font-serif` + `tabular`, typeLabel a subordinate sans qualifier at `text-2xs`), coloured only by tier via `pmark`/`pmark-confirmed`/`pmark-suggested`. Zero `graph-entity`, zero `rounded-pill`, no `tshape` glyph (the type word is already present beside it — the Chanel rule). Overflow chip is neutral chrome (`bg-bright border-rule text-faded`), no tier hue, derived from `totalCount - visible.length`.

## Task Commits

1. **Task 1: Colour-blind structural fingerprint + frozen pre-60 baseline** — `29517b6` (feat)
2. **Task 2: entitySummary per-FACT rewrite** — `870838f` (test — see "TDD Gate Compliance" below; this commit contains both RED and GREEN, a deviation from the ideal two-commit split)
3. **Task 3: EntityChips provenance-mark rewrite** — `1bb84e3` (feat)

## TDD Gate Compliance

Task 2 was marked `tdd="true"`. The RED phase was genuinely executed and verified BEFORE implementation — `npx vitest run entity-summary-aggregation.test.ts` was run against the pre-existing (collapse-by-type) `entity-summary.ts` and produced **9 of 12 tests failing** (captured below), proving the new tests exercise real behavioral differences, not vacuous assertions. However, due to an execution-sequencing mistake, the RED test file and the GREEN implementation were staged and committed together in a single commit (`870838f`, labeled `test(60-01): RED`) rather than as two separate `test(...)` then `feat(...)` commits. The git history therefore does not show a standalone RED commit followed by a GREEN commit — both land in one commit. The RED evidence is preserved here as the record of the gate having been honestly run:

```
 ❯ src/router/emails/__tests__/entity-summary-aggregation.test.ts (12 tests | 9 failed)
   Test 3: rows with null entityTypeId or null label are skipped — FAIL (undefined field shapes)
   Test 4: entries are NOT collapsed by type — two suppliers are two entries — FAIL
   Test 5: a confirmed and a candidate component of the SAME type yield two entries with different tiers — FAIL
   Test 6: any non-confirmed surviving status maps to suggested — FAIL
   Test 7: value is a trimmed, whitespace-collapsed, length-capped snippet of contentText — FAIL
   Test 8: null/blank contentText yields value: null — FAIL
   Test 9: a 12-entity email yields 8 entries with totalCount: 12 — FAIL (expected undefined to be 8)
   Test 10: ordering is deterministic for a fixed row order (first appearance) — FAIL
   Test 11: entityInstanceId surfaces from the row; undefined when absent — FAIL (TypeError, entries[1] undefined)
 Test Files  1 failed (1)
      Tests  9 failed | 3 passed (12)
```

After the rewrite, the same 12 tests are GREEN (see Verification below).

## Files Created/Modified

- `apps/web/src/app/__tests__/support/structural-fingerprint.ts` — **NEW.** Colour-blind DOM fingerprint helper.
- `apps/web/src/app/_components/__tests__/capture-inbox-baseline.test.tsx` — **NEW.** Freezes the pre-60 baseline, regeneration-guarded, plus an always-on existence assertion.
- `apps/web/src/app/_components/__tests__/__baselines__/inbox-pre-60.json` — **NEW.** The frozen artifact (elementCount=81, leafTextCount=32, maxDepth=10).
- `packages/api-client/src/router/emails/entity-summary.ts` — Per-fact `aggregateEntitySummary` rewrite, `MAX_ENTITIES_PER_EMAIL` export, `toValueSnippet` helper, procedure select widened (`id`/`contentText`/`extractionStatus`), owner-less short-circuit grew `totalCount: 0`.
- `packages/api-client/src/router/emails/__tests__/entity-summary-aggregation.test.ts` — **NEW.** 12 tests covering every `<behavior>` bullet.
- `packages/api-client/src/router/__tests__/entity-summary.test.ts` — **DELETED.** Tested the superseded collapse-by-type contract.
- `packages/api-client/src/router/emails/__tests__/emails-user-scoping.test.ts` — Test 9 assertion updated for the new `totalCount` field.
- `apps/web/src/app/_components/entity-chips.tsx` — Full rewrite: per-fact rendering, provenance-mark colouring, neutral overflow chip.
- `apps/web/src/app/_components/inbox-row.tsx` — One-line connectivity fix: `totalCount={entities.length}` at the `EntityChips` call site (stopgap, see key-decisions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `packages/api-client`'s stale `dist/*.d.ts` hid Task 2's type changes from `apps/web`'s `tsc --noEmit`**
- **Found during:** Task 3 verification
- **Issue:** `@polytoken/api-client`'s package.json resolves TypeScript's `types` condition to `./dist/index.d.ts` (a pre-built artifact), not `src/`. After Task 2 changed `EntitySummaryEntry`'s shape, `apps/web`'s typecheck still saw the OLD (pre-60) shape because `dist/` hadn't been rebuilt, producing a spurious `EntitySummaryEntry is missing componentId/typeLabel/value/tier` error in `inbox-three-pane.tsx`.
- **Fix:** Ran `npx tsc` inside `packages/api-client` to regenerate `dist/`. `dist/` is gitignored — no commit needed, but this is a required manual step any time `packages/api-client`'s public types change and `apps/web` needs to typecheck against them. Documented here as a project gotcha for future phases.
- **Files modified:** none (build artifact only, gitignored)
- **Verification:** `apps/web`'s `tsc --noEmit` went from 1 error to clean.

**2. [Rule 3 - Blocking issue] Doc-comment prose literally matched Task 3's own grep-based verify gate**
- **Found during:** Task 3 verification
- **Issue:** `entity-chips.tsx`'s new header doc-comment explained the pre-60 chip's tint by name (`` `graph-entity` ``) inside a `/** */` JSDoc block. Task 3's verify command filters out `^\s*//` line-comments before grepping for banned classes, but does NOT filter `/** */` block-comment lines — so the explanatory prose itself tripped the "zero `graph-entity` occurrences" check.
- **Fix:** Reworded the comment to describe the pre-60 tint without using the literal class-name substring (`"an entity-TYPE role colour (the canvas 'graph' role palette's entity swatch)"`).
- **Files modified:** `apps/web/src/app/_components/entity-chips.tsx` (comment text only)
- **Verification:** grep check went from count=1 to count=0.

**3. [Rule 3 - Blocking issue] `EntityChips`' new required `totalCount` prop broke its only call site**
- **Found during:** Task 3, immediately after drafting the new `EntityChips` signature
- **Issue:** Task 3's `<files>` tag lists only `entity-chips.tsx`, but making `totalCount` a required prop (matching Plan 02's own interfaces §A) leaves `inbox-row.tsx`'s existing `<EntityChips entities={entities} emailId={email.id} />` call site failing `tsc --noEmit`, which Task 3's own verify command runs.
- **Resolution:** Added a one-line fix at the call site (`totalCount={entities.length}`), documented as a deliberate stopgap (see key-decisions) since `inbox-three-pane.tsx` — which owns the real server `totalCount` — is out of both this plan's and Plan 02's declared file scope. Plan 02 threads the real value through when it rewrites `inbox-row.tsx` in full (see 60-02-SUMMARY.md).
- **Files modified:** `apps/web/src/app/_components/inbox-row.tsx` (one line + comment)

### Process Deviation (not a scope violation)

**4. TDD RED/GREEN combined into a single commit**
- **Found during:** post-commit review of Task 2's history
- **Issue:** Task 2 is `tdd="true"`, which calls for a `test(...)` commit (RED) followed by a separate `feat(...)` commit (GREEN). The RED phase WAS genuinely executed and verified before implementation (9/12 tests failing — captured above), but both the test file and the implementation were staged together and landed in one commit (`870838f`), mislabeled with a `test(60-01):` prefix even though it also contains the GREEN implementation.
- **Resolution:** Left as a single commit rather than rewriting history (per the git-safety protocol, only new commits are created, and rewriting `870838f` would require a destructive operation). Documented here as a TDD Gate Compliance note with the RED evidence preserved.
- **Impact:** None on correctness — both RED and GREEN were genuinely run and verified; only the commit-granularity ideal was missed.

---

**Total deviations:** 3 auto-fixed blocking issues (all resolved before their respective verify gates passed), 1 documented process deviation (commit granularity, no correctness impact).

## Known Stubs

- `inbox-row.tsx`'s `EntityChips` call passes `totalCount={entities.length}` rather than the server's true per-email `totalCount` (available on `EmailEntitySummary` since Task 2, but not yet threaded through `inbox-three-pane.tsx`'s `entitiesByEmailId` map). This under-counts the overflow chip ONLY in the rare case a single email has more than `MAX_ENTITIES_PER_EMAIL` (8) real entities — a narrow edge case, not a broken feature. Resolved in 60-02 (see its SUMMARY).

## Verification

```
cd apps/web && npx tsc --noEmit                                    -> clean
cd apps/web && npx vitest run                                      -> 66 files, 731 passed, 1 skipped
cd packages/api-client && npx vitest run src/router/emails         -> 4 files, 49 passed
apps/web/.../__baselines__/inbox-pre-60.json                       -> committed, frozen, regeneration-guarded
```

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None.

## Next Phase Readiness

- Plan 02 can consume `fingerprintTree` and `inbox-pre-60.json` directly to build `inbox-structure.test.tsx` — the anti-re-token gate. Baseline numbers to quote: **elementCount=81, leafTextCount=32, maxDepth=10**.
- Plan 02 must thread `EmailEntitySummary.totalCount` through `inbox-three-pane.tsx`'s `entitiesByEmailId` map (and `InboxRowProps`/`InboxThreadGroupProps`) to retire the `entities.length` stopgap in `inbox-row.tsx` — `inbox-three-pane.tsx` is not in either plan's original `files_modified` frontmatter but is now a required touch point.
- `EntityChipEntry`'s shape is now `{ componentId, entityTypeId, typeLabel, value, tier, entityInstanceId? }` — any future surface consuming entity chips (chat cited spans, knowledge entity labels, per D-58-01's "one mark language everywhere") should match this shape, not the pre-60 `{ entityTypeId, label, count }` shape.
- A required manual step for any future phase that changes `packages/api-client`'s public types: rebuild its `dist/` (`npx tsc` inside the package) before `apps/web`'s typecheck will see the change — `types` resolves to `dist/*.d.ts`, not `src/`.

---
*Phase: 60-surface-redesign-inbox-email-detail*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: apps/web/src/app/__tests__/support/structural-fingerprint.ts
- FOUND: apps/web/src/app/_components/__tests__/capture-inbox-baseline.test.tsx
- FOUND: apps/web/src/app/_components/__tests__/__baselines__/inbox-pre-60.json
- FOUND: packages/api-client/src/router/emails/__tests__/entity-summary-aggregation.test.ts
- FOUND: packages/api-client/src/router/emails/entity-summary.ts
- FOUND: apps/web/src/app/_components/entity-chips.tsx
- FOUND: apps/web/src/app/_components/inbox-row.tsx
- CONFIRMED DELETED: packages/api-client/src/router/__tests__/entity-summary.test.ts (intentional, superseded)
- FOUND: commit 29517b6 (Task 1)
- FOUND: commit 870838f (Task 2)
- FOUND: commit 1bb84e3 (Task 3)
