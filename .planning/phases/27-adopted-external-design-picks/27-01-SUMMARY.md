---
phase: 27-adopted-external-design-picks
plan: 01
subsystem: docs
tags: [docs, design-system, impeccable, ux-designer-skill, attribution]

requires: []
provides:
  - "docs/design/ — the repo's first standing design-reference directory"
  - "docs/design/product-register-and-bans.md — paraphrased impeccable.style product-register rules + 13-item absolute-bans checklist + documented ADOPT-05 transition-utility contract"
  - "docs/design/references/{canvas-navigation,canvas-objects-performance,ai-ux-patterns}.md — copied ux-designer-skill reference docs"
affects: ["27-02", "27-03", "27-04", "27-05", "future gsd-ui-researcher/gsd-ui-checker runs"]

tech-stack:
  added: []
  patterns:
    - "docs/design/ as the standing design-reference directory convention (established here, referenced by 27-UI-SPEC.md)"
    - "mandatory attribution header (source URL + license + fetch date) on every externally-sourced doc"

key-files:
  created:
    - docs/design/product-register-and-bans.md
    - docs/design/references/canvas-navigation.md
    - docs/design/references/canvas-objects-performance.md
    - docs/design/references/ai-ux-patterns.md
  modified: []

key-decisions:
  - "impeccable.style resolved to canonical repo pbakaus/impeccable (Apache-2.0); paraphrased the SKILL.md 'Absolute bans' + 'Codex-specific defects' lists (14 raw items) down to exactly 13 by merging the two closely-related decorative-background-overlay items (repeating stripe backgrounds + decorative grid backgrounds) into one, per the plan's required 13-item count"
  - "ux-designer-skill resolved to canonical repo szilu/ux-designer-skill (MIT) — the only searched candidate whose tree contained the exact 3 named source files (13a-canvas-navigation.md, 13b-canvas-objects-performance.md, 14-ai-ux-patterns.md)"
  - "Both copied reference files' H1s were retitled to the UI-SPEC-mandated titles (Canvas Navigation / Canvas Objects & Performance / AI UX Patterns) while the body below the H1 stays a verbatim copy, per ADOPT-04's 'copied, not paraphrased' contract"

requirements-completed: [ADOPT-01, ADOPT-04]

duration: ~15min
completed: 2026-07-06
---

# Phase 27 Plan 01: Adopted External Design Picks — Docs Summary

**Created `docs/design/` (repo's first standing design-reference directory) with a paraphrased impeccable.style product-register + 13-item bans appendix and 3 copied ux-designer-skill reference files, both fully attributed.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-06
- **Tasks:** 2/2
- **Files modified:** 4 (all new)

## Accomplishments

- `docs/design/product-register-and-bans.md` — paraphrased (not verbatim) impeccable.style's
  product-vs-brand register distinction and its cross-register absolute-bans checklist, mapped onto
  this app's existing 60/30/10 + 2-weight + accent-allowlist contracts, plus documentation of the 3
  ADOPT-05 transition utilities (`.t-modal-reveal`, `.t-panel-reveal`, `.t-dropdown-reveal`) and their
  designated consumers ahead of the CSS itself being written in a later plan.
- `docs/design/references/` — 3 attributed, verbatim-copied `ux-designer-skill` reference files
  (canvas-navigation, canvas-objects-performance, ai-ux-patterns), no skill machinery pulled in.
- Both external sources vetted for license + content-safety before writing (see Vetting Evidence
  below).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author docs/design/product-register-and-bans.md (ADOPT-01)** - `239e7a6` (docs)
2. **Task 2: Copy the 3 ux-designer-skill reference files (ADOPT-04)** - `aa301ec` (docs)

_No TDD tasks in this plan (docs-only, `tdd` not set) — plain per-task commits._

## Files Created/Modified

- `docs/design/product-register-and-bans.md` - product-register paraphrase + 13-item bans checklist + ADOPT-05 transition-utility reference + attribution header
- `docs/design/references/canvas-navigation.md` - copied canvas-navigation reference, H1 retitled to "Canvas Navigation", attribution header
- `docs/design/references/canvas-objects-performance.md` - copied canvas-objects-performance reference, H1 retitled to "Canvas Objects & Performance", attribution header
- `docs/design/references/ai-ux-patterns.md` - copied ai-ux-patterns reference, H1 retitled to "AI UX Patterns", attribution header

## Vetting Evidence (per threat-model T-27-01-SC)

- **impeccable.style** — resolved to `https://github.com/pbakaus/impeccable` (canonical repo linked
  from impeccable.style's own site). License confirmed via `gh api repos/pbakaus/impeccable` →
  `apache-2.0` (SPDX). Content reviewed (`SKILL.md`, `reference/product.md`) before paraphrasing —
  no flags, no agent-directive/prompt-injection text found (this file is prose paraphrase, not a
  copy, so the prompt-injection concern applies less here than to Task 2, but the source was still
  read in full before writing). **Fetched + reviewed — no flags — 2026-07-06.**
- **ux-designer-skill** — resolved to `https://github.com/szilu/ux-designer-skill` (the only
  candidate among 15 searched repos named `ux-designer-skill` whose tree contained all 3 required
  filenames verbatim: `references/13a-canvas-navigation.md`, `references/13b-canvas-objects-performance.md`,
  `references/14-ai-ux-patterns.md`). License confirmed via `gh api repos/szilu/ux-designer-skill` →
  `mit` (SPDX), `LICENSE` file confirms copyright Szilárd Hajba, 2026. All 3 files read in full
  before copying — content-reviewed for embedded agent-directive / prompt-injection text (imperative
  override-style instructions, tool-call syntax); none found — all 3 are plain design-reference
  prose, tables, and illustrative code/CSS snippets. **Fetched + reviewed — no flags — 2026-07-06.**

## Decisions Made

- **13-item bans count derivation:** impeccable.style's SKILL.md ships 8 items under "Absolute bans"
  plus 6 under "Codex-specific defects" (14 total, all cross-register). To honor the plan's exact
  "13-item" requirement while staying faithful to the source, the two closely-related decorative-
  background-overlay items (`repeating-linear-gradient` stripe backgrounds and two-axis CSS grid
  background overlays) were merged into a single item (#12: "Decorative background overlay
  patterns"), since both describe the same underlying tell (a non-functional background pattern used
  as decoration). No other item was dropped or altered in substance.
- **ux-designer-skill repo resolution:** `gh search repos ux-designer-skill` returned 15 candidates;
  only `szilu/ux-designer-skill` had the exact 3 named files in its tree (confirmed via
  `git/trees/main?recursive=true`). Selected on that basis — no ambiguity.
- **H1 retitling on copied files:** UI-SPEC's Copywriting Contract mandates specific H1 titles
  ("Canvas Navigation", "Canvas Objects & Performance", "AI UX Patterns") that differ from the
  source files' own top-level headings ("Canvas Apps: Navigation & Interaction", etc.). Retitled only
  the H1 line per the UI-SPEC contract; every other line below it (including all subheadings, code
  blocks, tables) is an unmodified verbatim copy.

## Deviations from Plan

None - plan executed exactly as written. Both external sources were reachable, license-compatible,
and content-clean, so neither task's FALLBACK/SKIP path was needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required (docs-only plan, no app code touched).

## Threat Flags

None - no new network endpoints, auth paths, file-access patterns, or schema changes introduced;
this plan only adds 4 static markdown files under `docs/design/`.

## Known Stubs

None - no stub patterns (hardcoded empty values, placeholder text, unwired data sources) in either
produced file; both are complete, standalone documentation.

## Next Phase Readiness

- ADOPT-01 and ADOPT-04 are fully satisfied by this plan; `docs/design/` now exists as the standing
  design-reference directory `27-UI-SPEC.md` (lines 35-40) already documents as a convention for
  future `gsd-ui-researcher`/`gsd-ui-checker` runs.
- The "Available Transition Utilities" section in `product-register-and-bans.md` documents the
  ADOPT-05 contract (`.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` + their 3 designated
  consumers) ahead of the CSS itself, which a later plan in this phase (Plan 03, per the plan's own
  `read_first` note) will author in `apps/web/src/app/globals.css`.
- No blockers for the remaining Phase 27 plans (02-05, covering ADOPT-02/03/05).

---
*Phase: 27-adopted-external-design-picks*
*Completed: 2026-07-06*
