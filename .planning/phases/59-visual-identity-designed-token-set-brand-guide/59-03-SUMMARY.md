---
phase: 59-visual-identity-designed-token-set-brand-guide
plan: 03
subsystem: docs
tags: [brand-guide, design-system-docs, skill-md, oklch, wcag-aa, colour-law]

# Dependency graph
requires:
  - phase: 59-01
    provides: The D-58-01 identity ladder (12 tokens + 14 derived) live in globals.css for both :root and .dark, shadcn semantic mapping
  - phase: 59-02
    provides: Type scale, serif role, density scale, pmark/tshape signature utilities, colour-law.test.ts
  - phase: 58-visual-identity-sketch-pick-human-gate
    provides: D-58-01 (LOCKED) — the three laws, the token ladder, the signature-element spec, the open D-58-03 flag
provides:
  - docs/design/brand-guide.md §3 "Visual identity" — palette/type-scale/spacing/signature with usage rules, gate citations, and both open flags (D-58-03, --chart-1..5), sitting alongside the existing voice/tone section
  - .claude/skills/polytoken-design-system/SKILL.md corrected — the deleted stock-teal claim removed, a D-58-01 pointer section added (three laws, pmark/tshape, type scale, four gates by path), @tweakcn flagged as a law-1 conflict, and the CSS comment-collision gotcha documented
  - apps/web/src/app/dev/design/design-data.json regenerated to reflect the shipped identity tokens
affects: [60-total-ui-re-skin-part-1, 61-total-ui-re-skin-part-2, 62-total-ui-re-skin-part-3, 63-research-canvas-visual-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "docs-only plan scope assertion via git diff --name-only against the plan's own commit range — confirms no apps/ or packages/ source changed except the explicitly-allowed build-design-data.mjs output"
    - "grep -oiE unique-string casing discipline: when an acceptance criterion counts unique matches via sort -u, every occurrence of the target word/phrase must use identical casing throughout the document, or duplicate-cased variants silently inflate the count"

key-files:
  created: []
  modified:
    - docs/design/brand-guide.md
    - .claude/skills/polytoken-design-system/SKILL.md
    - apps/web/src/app/dev/design/design-data.json

key-decisions:
  - "Visual identity inserted as new §3 (after §2 Voice principles), renumbering old §3-8 to §4-9 and fixing every internal §-cross-reference (§5→§6, §7→§8, §6→§7, §4→§5) — verified via grep -n '^## [0-9]' for contiguity and grep '§\\d' for reference correctness"
  - "The two open flags (D-58-03, --chart-1..5) live in a new subsection under §6 'NOT done — user-gated' ('Open flags carried from §3') rather than inside §3 itself, per the plan's explicit instruction to use that existing home"
  - "Heading text for the open-flags subsection deliberately avoids the literal phrase 'visual identity' (uses 'visual-identity system' with a hyphen instead) — an earlier draft's heading 'Open flags from the visual identity (§3)' accidentally matched the plan's own heading-count regex (^#+ .*[Vv]isual identity), inflating the count from 1 to 2 and failing the acceptance criterion; caught and fixed before committing"
  - "The stale stock-teal oklch literal (38.9% 0.053 173.7) was initially reintroduced in SKILL.md's own explanatory prose ('the old teal ... oklch(38.9% ...) is deleted') — the acceptance grep is a blunt string match with no semantic awareness, so even a sentence stating the value is GONE still fails the check; fixed by describing it without repeating the literal number"
  - "design-data.json (apps/web/src/app/dev/design/, a tracked build artifact) is included in this plan's commits per the plan's own <verification> exception ('docs-only... and any build-design-data.mjs output') despite the broader docs-only framing in execution rules"

patterns-established:
  - "casing-consistency check for grep -oiE + sort -u acceptance criteria: run the exact verification grep against the draft BEFORE committing, not just visually inspect — caught the duplicate-heading and stale-literal failures that a read-through missed"

requirements-completed: [IDNT-04]

# Metrics
duration: ~25min
completed: 2026-07-15
---

# Phase 59 Plan 03: Brand Guide Visual-Identity Section + SKILL.md Correction Summary

**Gave `docs/design/brand-guide.md` the visual-identity section it has never had (palette/type-scale/spacing/signature with usage rules, four gates cited by path, both open flags recorded honestly) and fixed `.claude/skills/polytoken-design-system/SKILL.md`'s stale stock-teal claim so `gsd-ui-researcher`/`gsd-ui-auditor` stop reading a palette this phase deleted — both docs now match what's actually in `globals.css`, not what was planned or what shipped before Phase 59.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-15T18:46:05Z
- **Tasks:** 2
- **Files modified:** 3 (2 docs, 1 regenerated build artifact)

## Accomplishments

- `docs/design/brand-guide.md` gained a new §3 "Visual identity" — inserted immediately after §2
  Voice principles (criterion 3's "alongside") — covering: the thesis and all three laws in the
  identity's own terms, the full 12-token oklch ladder read directly out of `globals.css` (both
  themes) with a shadcn-semantic-name lookup table answering "which token is `bg-muted`?", the
  6-step type scale + law-2 serif role + `tabular` utility, the 9-step density/spacing rhythm, and
  the signature-element (`pmark`/`pmark-confirmed`/`pmark-suggested`) + entity-shape
  (`tshape`/`tshape-supplier`/etc.) vocabulary with law 3's placement rule.
- Enforcement is split honestly, per the plan's interfaces §B: four committed gates
  (`token-contrast.test.ts`, `colour-law.test.ts`, `token-registration.test.ts`,
  `palette-ban.test.ts`) are cited by path with no re-argument, and five NOT-gateable rules (the
  serif no-exceptions rule, the shape-placement rule, madder's irreversible-only scope, the
  `--pencil`-never-on-`--shade` pairing, and the hue-addition bar) are stated as the guide's own
  job.
- Both open flags are recorded with concrete cost in a new subsection under the renumbered §6
  "NOT done — user-gated": D-58-03 (entity-type-as-shape, the one item the user hasn't explicitly
  blessed, with `extraction-summary-panel.tsx`'s type-hue-as-tier confusion as the concrete cost)
  and `--chart-1..5` (the one colour family left out of the ladder, plus the pre-existing
  out-of-scope `chart-6/7/8` defect found during Phase 59 planning).
- All 6 old sections (§3-§8) renumbered to §4-§9; every internal `§N` cross-reference fixed
  (verified: `§5`→`§6`, `§7`→`§8`, `§6`→`§7`, `§4`→`§5`), section numbering confirmed contiguous
  with no duplicates.
- `.claude/skills/polytoken-design-system/SKILL.md`'s "Where things live" tokens bullet no longer
  claims a "Brand primary `oklch(38.9% 0.053 173.7)`" — that stock-derived teal is gone from the
  file every `gsd-ui-researcher`/`gsd-ui-auditor` auto-reads. A new "Visual identity (D-58-01)"
  pointer section summarizes the three laws, the `pmark`/`tshape` utilities, the type scale, and
  the four gates by path — linking to `brand-guide.md` §3 and `58-IDENTITY.md` as the authority,
  not duplicating them.
- The `@tweakcn` row in "Approved external sources" now states plainly that hand-porting a
  generated preset would violate law 1 and fail `colour-law.test.ts`, replacing the old
  "generate, then hand-port variables" invitation.
- The CSS comment-collision gotcha (bitten three times across 59-01/59-02: a dangling `*/`
  swallowing a CSS rule, a comment's literal `--token:` corrupting the gate's regex parse, and a
  `*/` in comment prose closing a block early) is now documented in SKILL.md's Gotchas section
  with the concrete rule: never write `*/` or a colon-terminated `--name:` inside comment prose.
- `apps/web/src/app/dev/design/design-data.json` was regenerated via `build-design-data.mjs` —
  succeeded cleanly (`tokens=78 animations=8 components=56 suites=1`), now reflecting the shipped
  identity-ladder token names/values instead of the stale pre-59 set.
- The full token gate suite (`token-contrast`, `token-registration`, `colour-law`,
  `palette-ban`) re-run once as the phase-final baseline: **4 files, 284 tests, all green.**

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the visual-identity section to the brand guide** - `eabf5c7` (docs)
2. **Task 2: Update SKILL.md to the designed system and regenerate the design reference** - `2a19444` (docs)

## Files Created/Modified

- `docs/design/brand-guide.md` - New §3 "Visual identity" (228 lines added/changed); sections
  renumbered §3-§8 → §4-§9; all internal `§N` cross-references fixed; footer updated to record
  Phase 59 alongside the existing Phase 47 provenance.
- `.claude/skills/polytoken-design-system/SKILL.md` - "Where things live" tokens bullet corrected
  (stale teal claim removed, D-58-01 pointer added); new "Visual identity (D-58-01)" section;
  `@tweakcn` row updated; CSS comment-collision gotcha added to Gotchas.
- `apps/web/src/app/dev/design/design-data.json` - Regenerated via
  `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs` (succeeded, no
  manual editing).

## Final Section Numbering (docs/design/brand-guide.md)

1. USER-LOCKED naming
2. Voice principles
3. **Visual identity** (NEW)
4. Mark usage
5. Accepted collision (recorded risk, not a mitigation)
6. NOT done — user-gated (now includes the "Open flags carried from §3" subsection)
7. Bans this guide never overrides
8. Repo-level brand guard
9. Design conventions

## build-design-data.mjs Outcome

**Succeeded.** `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs` ran
cleanly against the working tree, printing `tokens=78 animations=8 components=56 suites=1` and
writing `apps/web/src/app/dev/design/design-data.json`. The diff (`git diff --stat`: 292
lines changed) is the expected shape — every identity-ladder token name (`conf`, `conf-wash`,
`conf-line`, `sugg`, `ink`, `faded`, `pencil`, `shelf`, `leaf`, `bright`, `shade`, `rule`, `hair`,
etc.) now appears with its shipped light/dark oklch values, replacing the stale pre-59 token set.
No manual edit was made to the output file.

## The Two Open Flags (restated for the phase's VERIFICATION)

1. **D-58-03 — entity type is shape, never hue.** `58-IDENTITY.md` flags this as the one item the
   user has not explicitly blessed — inferred from the colour law, not instructed. Cheap to
   revisit now, expensive after Phase 62. The Phase 59 port made the cost concrete:
   `extraction-summary-panel.tsx`'s `candidate: "bg-graph-email-component"` uses a node-TYPE hue
   to mean a TIER — exactly the confusion law 3 exists to eliminate. Laws 1 and 2 stand regardless
   of how this is resolved.
2. **`--chart-1..5`** — the one colour family left out of the D-58-01 ladder entirely. Its only
   consumer is the spreadsheet grid's `conditional-formatting-dialog.tsx` as USER-ASSIGNED cell
   annotation (same exemption category as `packages/genui/src/theme/packs.ts`), left
   byte-identical and exempted by name in `colour-law.test.ts`. Needs a user decision: fold into
   the identity, or keep as a bounded exemption. A pre-existing, out-of-scope defect was also
   surfaced: `conditional-formatting-dialog.tsx` offers `chart-6`/`chart-7`/`chart-8`, which
   `globals.css` has never defined.

Both are recorded in `docs/design/brand-guide.md` §6's new "Open flags carried from §3"
subsection — not resolved by this plan, by design.

## Decisions Made

- The open-flags subsection heading was deliberately worded to avoid the literal substring
  "visual identity" (used "visual-identity system" with a hyphen instead) so it would not
  double-match the plan's own heading-count acceptance regex.
- SKILL.md's explanation of the deleted stock-teal describes it without repeating its literal
  oklch value, since the acceptance check is a blunt string-presence grep with no semantic
  awareness of "this value is gone."
- `apps/web/src/app/dev/design/design-data.json` is included in this plan's diff per the plan's
  own `<verification>` exception, despite the broader "docs only" framing elsewhere in the
  execution rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Draft heading accidentally double-matched the visual-identity-section acceptance regex**
- **Found during:** Task 1, self-verification of `grep -ciE "^#+ .*[Vv]isual identity" docs/design/brand-guide.md` before committing
- **Issue:** The first draft's open-flags subsection was headed `### Open flags from the visual identity (§3)`. Since it starts with `###` and contains the literal (lowercase) substring "visual identity", it matched the same acceptance regex as the real §3 heading, returning a count of 2 instead of the required 1.
- **Fix:** Reworded the heading to `### Open flags carried from §3`, removing the "visual identity" substring from any non-§3 heading. Re-ran the exact acceptance grep and confirmed count=1.
- **Files modified:** `docs/design/brand-guide.md` (heading text only)
- **Verification:** `grep -ciE "^#+ .*[Vv]isual identity" docs/design/brand-guide.md` went from 2 to 1.
- **Committed in:** `eabf5c7` (Task 1) — caught and fixed before the commit.

**2. [Rule 1 - Bug] SKILL.md's own explanatory sentence reintroduced the stale-teal literal it was correcting**
- **Found during:** Task 2, self-verification of the plan's exact automated check (`grep -q "38.9% 0.053 173.7" ... && echo STALE_TEAL_STILL_PRESENT && exit 1`)
- **Issue:** The first draft of SKILL.md's "Where things live" bullet explained the removal by naming the deleted value directly ("the old stock-derived teal ... (`oklch(38.9% 0.053 173.7)`) is deleted from this product"). The acceptance check is a literal string-presence grep, not a semantic check — it has no way to distinguish "this value is gone" from a live claim, so the sentence failed the check exactly the way a stale live claim would.
- **Fix:** Reworded to describe the removal without repeating the literal oklch value ("the old stock-derived teal that used to live there is deleted from this product entirely (see `59-01-SUMMARY.md`)"). Re-ran the acceptance check and confirmed 0 occurrences.
- **Files modified:** `.claude/skills/polytoken-design-system/SKILL.md`
- **Verification:** `grep -c "38.9% 0.053 173.7" .claude/skills/polytoken-design-system/SKILL.md` went from 1 to 0; full plan verify command (`STALE_TEAL_STILL_PRESENT` / `SKILL_OK`) now prints `SKILL_OK` only.
- **Committed in:** `2a19444` (Task 2) — caught and fixed before the commit.

---

**Total deviations:** 2 auto-fixed bugs, both caught by running the plan's own acceptance-criteria grep commands against the draft before committing, not by visual read-through.
**Impact on plan:** Both fixes were text-only (heading wording, one sentence's phrasing) and were resolved before their respective task commits — no scope creep, no re-opened commits.

## Negative Proofs / Verification Evidence

- `grep -ciE "^#+ .*[Vv]isual identity" docs/design/brand-guide.md` → `1`
- `grep -n "^## .*Visual identity"` (line 54) > `grep -n "^## .*Voice principles"` (line 25) — confirms §3 sits after §2, satisfying criterion 3's "alongside".
- `grep -oiE "palette|type scale|spacing|signature" docs/design/brand-guide.md | sort -u | wc -l` → `4` (all four required subjects present, each with consistent casing throughout the document — verified this constraint explicitly since `sort -u` is case-sensitive and would silently inflate the count on a casing mismatch).
- `for t in conf sugg bad ink faded pencil shelf leaf bright shade rule hair; do grep -q -- "--$t:" apps/web/src/app/globals.css || echo "MISSING $t"; done` → no output (all 12 ladder tokens confirmed present in `globals.css`).
- `grep -c "token-contrast.test.ts\|colour-law.test.ts" docs/design/brand-guide.md` → `3` (≥ 2 required).
- `grep -q "D-58-03" docs/design/brand-guide.md && grep -q "chart-" docs/design/brand-guide.md` → both present.
- `grep -c "38.9% 0.053 173.7" .claude/skills/polytoken-design-system/SKILL.md` → `0`.
- `grep -q "58-IDENTITY.md" ... && grep -q "brand-guide.md" ...` → both present in SKILL.md.
- `grep -cE "pmark|tshape|colour-law" .claude/skills/polytoken-design-system/SKILL.md` → `6` (≥ 3 required).
- `grep -A1 "tweakcn" .claude/skills/polytoken-design-system/SKILL.md | grep -qiE "law 1|colour-law|monochrome"` → matched.
- `cd apps/web && npx vitest run src/app/__tests__/` → 4 test files, 284 tests, all green (unchanged from 59-02's baseline — confirms docs-only changes did not break any gate).
- `git diff --name-only` across this plan's two commits (`eabf5c7`, `2a19444`) → exactly `docs/design/brand-guide.md`, `.claude/skills/polytoken-design-system/SKILL.md`, `apps/web/src/app/dev/design/design-data.json` — no other `apps/` or `packages/` source touched.

## Issues Encountered

None beyond the two self-caught deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `docs/design/brand-guide.md` §3 and `.claude/skills/polytoken-design-system/SKILL.md` are both
  true against the shipped `globals.css` — Phases 60-63's `gsd-ui-researcher`/`gsd-ui-auditor`
  will read the designed system, not the deleted stock palette.
- Both open flags (D-58-03, `--chart-1..5`) remain genuinely open — carried forward for the user
  to resolve whenever convenient, not silently inherited as decided.
- Phase 59 (all three plans: 59-01 ladder port, 59-02 type/density/signature, 59-03 docs) is
  complete. ROADMAP criteria for Phase 59 / requirements IDNT-03 and IDNT-04 are both satisfied.

---
*Phase: 59-visual-identity-designed-token-set-brand-guide*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: docs/design/brand-guide.md
- FOUND: .claude/skills/polytoken-design-system/SKILL.md
- FOUND: apps/web/src/app/dev/design/design-data.json
- FOUND: commit eabf5c7 (Task 1)
- FOUND: commit 2a19444 (Task 2)
