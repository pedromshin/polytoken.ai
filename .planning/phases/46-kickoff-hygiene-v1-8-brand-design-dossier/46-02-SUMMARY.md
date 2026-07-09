---
phase: 46-kickoff-hygiene-v1-8-brand-design-dossier
plan: 02
subsystem: genui
tags: [python, asyncio, pytest, typescript, react, css-grid, colspan, generator-guidance]

# Dependency graph
requires: []
provides:
  - Python-3.13-correct asyncio.run() idiom in test_genui_retrieval_provider.py (10 tests, 11 call sites)
  - colSpan-aware Grid clamp in GridComponent (packages/genui/src/catalog/manifest.ts) enabling true asymmetric main+sidebar layouts
  - Corrected grid manifest generator guidance (colSpan documented, false "NO column spanning" claim removed)
  - Resolved todo: .planning/todos/done/2026-07-08-genui-retrieval-provider-py313-asyncio.md
affects: [genui generation quality (grid layouts), any future phase running the Python test suite under 3.13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "colSpan-aware layout clamp: detect wrapper-div style.gridColumn === 'span N' via React.Children.toArray + React.isValidElement before applying the Phase-17 child-count clamp"

key-files:
  created: []
  modified:
    - apps/email-listener/tests/test_genui_retrieval_provider.py
    - packages/genui/src/catalog/manifest.ts
    - packages/genui/src/__tests__/render-node.test.tsx
    - .planning/todos/pending/2026-07-08-genui-retrieval-provider-py313-asyncio.md (removed, moved to done/)
    - .planning/todos/done/2026-07-08-genui-retrieval-provider-py313-asyncio.md (created via move + Resolution section)

key-decisions:
  - "asyncio.get_event_loop().run_until_complete( is a byte-identical substring at all 11 call sites — used a single replace_all textual swap to asyncio.run( rather than per-test edits or restructuring into @pytest.mark.asyncio fixtures (each test awaits exactly one coroutine, so asyncio.run() is the minimal correct idiom)"
  - "GridComponent clamp branches on hasExplicitSpan (any child's wrapper div carries style.gridColumn starting with 'span '): when true, honor the model's requested cols (clamped 1-12) instead of collapsing to childCount, so an 8/4 split gets its full 12 tracks; when false, the exact pre-existing Phase-17 clamp logic runs unchanged"
  - "Generator guidance rewritten to state the default (equal columns, clamp-when-no-span) AND the escape hatch (child-level colSpan for asymmetric layouts) in one description, replacing the flatly-false 'there is NO column spanning' claim and its now-contradicted 'do NOT use grid for a single wide region' clause"

patterns-established: []

requirements-completed: [HYGN-02]

# Metrics
duration: ~15min
completed: 2026-07-09
---

# Phase 46 Plan 02: Kickoff Hygiene — pytest asyncio.run() Migration + Grid colSpan Summary

**Two backlog-999.2 debt folds landed: the 10 Python-3.13-broken `get_event_loop()` tests migrated to `asyncio.run()` (11 call sites, single textual swap), and the genui grid's Phase-17 child-count clamp made colSpan-aware so `cols:12` with 8/4-span children now renders a true 12-track asymmetric main+sidebar layout instead of collapsing to 2 columns — generator guidance corrected to match.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 4 (2 source, 1 test, 1 todo moved+annotated)

## Accomplishments

- Replaced all 11 occurrences of `asyncio.get_event_loop().run_until_complete(` with `asyncio.run(` in `test_genui_retrieval_provider.py` via a single `replace_all` edit (the substring was byte-identical at every call site — no per-test restructuring needed since each test awaits exactly one coroutine).
- Verified (grep) zero `get_event_loop`/`run_until_complete` tokens remain and 11 `asyncio.run(` calls exist (≥ the required 10).
- Ran the targeted suite: `uv run pytest tests/test_genui_retrieval_provider.py -v --no-cov` → 24 passed, 1 warning (the unrelated pre-existing `httpx`/starlette deprecation). The prior `DeprecationWarning: There is no current event loop` is gone.
- Confirmed the production `LexicalRetrievalProvider` (`app/infrastructure/llm/genui_retrieval_provider.py`) contains no `get_event_loop`/`run_until_complete` calls and was left byte-identical (`git status --porcelain` clean on that file for both commits).
- Moved `.planning/todos/pending/2026-07-08-genui-retrieval-provider-py313-asyncio.md` → `.planning/todos/done/` via `git mv` and appended a `## Resolution` section documenting the migration, the clean production provider, and the passing test command.
- In `GridComponent` (`packages/genui/src/catalog/manifest.ts`), added a `hasExplicitSpan` detector that walks `React.Children.toArray(children)`, guards with `React.isValidElement`, and tests each child's `props.style.gridColumn` for a string starting with `"span "` (the wrapper divs `renderPositionalChildren` already emits for colSpan children, Phase 18). `effectiveCols` now branches: `hasExplicitSpan` true → `Math.max(1, Math.min(12, requestedCols))` (respects the model's requested columns, no child-count collapse); `hasExplicitSpan` false → the original Phase-17 `Math.max(1, Math.min(requestedCols, childCount || 1))` clamp, unchanged.
- Rewrote the `grid` manifest `description`: removed "there is NO column spanning" and the "Do NOT use grid ... single wide region" clause; new text states the equal-column default + child-count clamp behavior AND documents `colSpan` (1-12) on grid children for asymmetric layouts, with an explicit `cols: 12` + 8-span/4-span main+sidebar example. `propsSchema` and `example` object left untouched (diff confined to `description` + `GridComponent` body — verified via `git diff`).
- Added two new tests to `render-node.test.tsx`: a `cols:12` grid with `colSpan:8` + `colSpan:4` children asserting `repeat(12,` present, `repeat(2,` absent, and both `span 8`/`span 4` present; and a `cols:12` grid with two plain (no-colSpan) children asserting `repeat(2,` (clamp preserved, backward-compatible). Existing "clamps cols to child count" and "keeps requested cols" tests stayed green unmodified.
- Ran the targeted vitest file: `npx vitest run src/__tests__/render-node.test.tsx` → 66/66 passed (all pre-existing tests green, both new tests green). Ran `npm run typecheck` in `packages/genui` → clean, zero errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate the 10 async tests to asyncio.run() and resolve the pending todo** - `e73f1dd` (fix)
2. **Task 2: Make the grid clamp colSpan-aware and correct the generator guidance** - `aaf2517` (feat)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `apps/email-listener/tests/test_genui_retrieval_provider.py` - 11 call sites migrated `get_event_loop().run_until_complete(` → `asyncio.run(`
- `.planning/todos/done/2026-07-08-genui-retrieval-provider-py313-asyncio.md` - moved from `pending/` via `git mv`; appended `## Resolution` section
- `packages/genui/src/catalog/manifest.ts` - `GridComponent` clamp made colSpan-aware (`hasExplicitSpan` detector); grid manifest `description` corrected
- `packages/genui/src/__tests__/render-node.test.tsx` - 2 new tests: asymmetric 8/4 colSpan layout, preserved no-colSpan clamp

## Decisions Made

- Used a single `replace_all` textual substitution for the asyncio migration rather than per-test edits, since `asyncio.get_event_loop().run_until_complete(` was byte-identical at all 11 call sites and only the outer call needed to change (the wrapped coroutine expression and closing parens were untouched).
- Did not restructure any test into `@pytest.mark.asyncio` fixtures — every call site awaits exactly one coroutine, so `asyncio.run()` is the minimal, Python-3.13-correct idiom per the plan's own guidance.
- Detected explicit colSpan by inspecting the rendered wrapper div's `style.gridColumn` prop (a string starting with `"span "`) rather than re-deriving colSpan from spec data — `GridComponent` only ever receives already-rendered React children, and this is the one signal `renderPositionalChildren` already emits for spanning children (per the plan's interface contract).
- Kept `effectiveCols` computation branch-exact per the plan's specified formulas: `Math.max(1, Math.min(12, requestedCols))` when spanning, `Math.max(1, Math.min(requestedCols, childCount || 1))` when not — no additional heuristics introduced.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria were met without needing any Rule 1-4 auto-fixes.

## Threat Flags

None — the threat model's own disposition (T-46-02-01 mitigate, T-46-02-02 accept) was implemented exactly as specified: `colSpan` stays a bounded integer end-to-end, and the new `GridComponent` clamp only reads `props.style.gridColumn` as a string prefix check (no eval, no injection surface). No new network endpoints, auth paths, or schema changes were introduced.

## Issues Encountered

None. In this local dev environment (Python 3.13.0), the 10 previously-reported failing tests were observed passing-with-a-DeprecationWarning rather than hard-failing before the fix — consistent with the deferred-items note already logged 2026-07-09 (38-02) that this is a known test-order-dependent variant of the same underlying issue. The migration removes the deprecated call entirely regardless, eliminating the warning and any latent failure risk under stricter pytest/asyncio configurations.

## User Setup Required

None.

## Next Phase Readiness

- HYGN-02 satisfied: both 999.2 debt folds landed with targeted, green tests.
- No blockers for 46-03 or subsequent phases. The concurrent Phase 43 track's in-flight changes (`.planning/HANDOFF.json`, `.planning/STATE.md`, `infrastructure/aws/ecs.tf`, and the `nauta-design-system` → `polytoken-design-system` skill rename) were left untouched throughout, per this plan's concurrency constraints.

---
*Phase: 46-kickoff-hygiene-v1-8-brand-design-dossier*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: apps/email-listener/tests/test_genui_retrieval_provider.py (asyncio.run present, 0 get_event_loop/run_until_complete)
- FOUND: .planning/todos/done/2026-07-08-genui-retrieval-provider-py313-asyncio.md
- FOUND: packages/genui/src/catalog/manifest.ts (colSpan in description, 0 "there is NO column spanning")
- FOUND: packages/genui/src/__tests__/render-node.test.tsx (66/66 passing)
- FOUND: commit e73f1dd (fix(46-02): migrate retrieval provider tests off get_event_loop for Python 3.13)
- FOUND: commit aaf2517 (feat(46-02): make grid clamp colSpan-aware, unlock asymmetric main+sidebar layouts)
