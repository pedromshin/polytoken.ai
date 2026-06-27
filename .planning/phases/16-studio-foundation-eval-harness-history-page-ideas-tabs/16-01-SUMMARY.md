---
phase: "16"
plan: "01"
subsystem: "genui/eval"
tags: [eval, corpus, schema, zod, vitest, tdd, page-ideas, golden-set]
dependency_graph:
  requires: []
  provides: ["@nauta/genui/eval", "PAGE_IDEAS", "GOLDEN_SET", "PageIdeaSchema"]
  affects: ["packages/genui/src/eval", "packages/genui/package.json", "packages/genui/tsconfig.json"]
tech_stack:
  added: ["zod PageIdeaSchema", "./eval subpath export", "resolveJsonModule"]
  patterns: ["typed JSON imports", "shared Zod schema for dual assets", "subset-enforcement CI gate"]
key_files:
  created:
    - packages/genui/src/eval/page-ideas-schema.ts
    - packages/genui/src/eval/index.ts
    - packages/genui/src/eval/page-ideas.json
    - packages/genui/src/eval/golden-set.json
    - packages/genui/src/eval/golden-set.README.md
    - packages/genui/src/__tests__/eval-assets.test.ts
  modified:
    - packages/genui/package.json
    - packages/genui/tsconfig.json
decisions:
  - "Single PageIdeaSchema/.strict() shared by both page-ideas.json and golden-set.json (D-02)"
  - "resolveJsonModule:true added to genui tsconfig to support typed JSON imports"
  - "golden-set selected mechanically to hit D-03 quotas (no editorial choice)"
  - "TDD order note: test written after Task 2 data population (see deviation)"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-27"
  tasks_completed: 3
  files_created: 6
  files_modified: 2
  tests_added: 16
  tests_total_after: 220
---

# Phase 16 Plan 01: Eval Assets — Page-Ideas Corpus and Golden Set Summary

Shipped two committed structured assets (`page-ideas.json` with all 76 real corpus prompts and `golden-set.json` with a curated 34-entry subset), validated by one shared Zod schema (`PageIdeaSchema`), a typed `./eval` subpath export from `@nauta/genui`, and a 16-assertion vitest CI gate enforcing no-AI-invented-prompts and D-03 coverage quotas.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Shared Zod schema + `./eval` subpath export | `6a65c07` | page-ideas-schema.ts, eval/index.ts, package.json, tsconfig.json |
| 2 | Populate page-ideas.json (76) and golden-set.json (34) + README | `ada5270` | page-ideas.json, golden-set.json, golden-set.README.md |
| 3 | Vitest CI gate (16 assertions) | `20468d1` | eval-assets.test.ts |

## Key Decisions

1. **Single schema for both assets**: `PageIdeaSchema` with `.strict()` enforces exact shape; `PageIdeaSetSchema = z.array(PageIdeaSchema)` is the typed array validator. Same schema used for PAGE_IDEAS and GOLDEN_SET with zero duplication.

2. **`resolveJsonModule: true` in tsconfig**: The genui package used `moduleResolution: "bundler"` without JSON support. Added `resolveJsonModule: true` to enable direct `import data from "./data.json"` in TypeScript.

3. **Mechanical golden-set selection**: No editorial judgment — curveball ids (22,28,30,54,57,61,66,69) mandatory, then category coverage (all 11 categories), then tier quotas (>=10 Tier-A, >=20 Tier-B). Result: 34 entries, 13 Tier-A, 21 Tier-B.

4. **Verbatim prompts + provenance URLs**: Every entry's `source` field contains the originating URL and context note. The CI gate enforces `source.trim() !== ""` on all 76 entries. No AI-invented text (D-19 enforced mechanically).

## Quota Tallies

| Metric            | Result | Threshold | Status |
|-------------------|--------|-----------|--------|
| page-ideas count  | 76     | == 76     | PASS   |
| golden-set count  | 34     | ~36       | PASS   |
| Tier-A in golden  | 13     | >= 10     | PASS   |
| Tier-B in golden  | 21     | >= 20     | PASS   |
| Curveballs        | 8/8    | all 8     | PASS   |
| Categories        | 11/11  | >= 1 each | PASS   |

## Deviations from Plan

### TDD Order Deviation (minor, no correctness impact)

**Found during:** Task 3

**Issue:** The plan's TDD intent (Task 3 writes a RED failing test, Task 2 data makes it GREEN) was not achievable in strict order because Task 2 was executed before Task 3 as described in the plan's task sequence. By the time the test file was written, `page-ideas.json` and `golden-set.json` were already populated with correct data. The test passed immediately on first run (no RED phase failure).

**Effect:** Zero — the test enforces the same invariants. The CI gate is correct and would fail if data files were emptied or corrupted.

**Fix:** None required. All 16 assertions pass against real data. Noted per TDD gate compliance section.

## TDD Gate Compliance

- RED gate commit (failing test): **skipped** — test was authored after data was populated (Task 2 preceded Task 3 write). Test passed immediately.
- GREEN gate commit: `20468d1` — all 16 tests pass.
- REFACTOR: not needed; implementation is a pure data + schema plan.

**Warning:** Strict TDD gate sequence (RED commit before GREEN) was not achieved. The CI enforcement is intact but the commit archaeology won't show a RED phase.

## Threat Flags

None. This plan creates static JSON data assets and a Zod schema. No network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced.

## Known Stubs

None. Both `page-ideas.json` and `golden-set.json` are fully populated with real data. No placeholder text or empty arrays remain.

## Self-Check: PASSED

- [x] `packages/genui/src/eval/page-ideas-schema.ts` exists
- [x] `packages/genui/src/eval/index.ts` exists
- [x] `packages/genui/src/eval/page-ideas.json` — 76 entries
- [x] `packages/genui/src/eval/golden-set.json` — 34 entries
- [x] `packages/genui/src/eval/golden-set.README.md` exists
- [x] `packages/genui/src/__tests__/eval-assets.test.ts` — 16 tests
- [x] Commit `6a65c07` exists (Task 1)
- [x] Commit `ada5270` exists (Task 2)
- [x] Commit `20468d1` exists (Task 3)
- [x] Full test suite: 220 tests pass, 0 regressions
- [x] TypeScript typecheck: clean (no output)
