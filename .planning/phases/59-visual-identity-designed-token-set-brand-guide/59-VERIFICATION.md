---
phase: 59-visual-identity-designed-token-set-brand-guide
verified: 2026-07-15T19:05:03Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
deferred:
  - truth: "D-58-03 (entity type is shape, never hue) is explicitly user-blessed"
    addressed_in: "User decision (post-Phase-59, whenever convenient)"
    evidence: "58-IDENTITY.md flags D-58-03 as 'the one item the user has not explicitly blessed' — inferred from law 1, not instructed. 59-03 recorded it honestly in brand-guide.md §6 'Open flags carried from §3' with concrete cost (extraction-summary-panel.tsx's bg-graph-email-component conflating node-type hue with tier). Not a Phase 59 gap — Phase 59's job was to record the flag, which it did; resolving it is a future user decision, not owed by this phase."
  - truth: "--chart-1..5 is folded into the D-58-01 identity or a deliberate user-blessed exemption"
    addressed_in: "User decision (post-Phase-59, whenever convenient)"
    evidence: "59-01/59-02/59-03 all treat --chart-1..5 as a documented, closed-list exemption (same category as packages/genui/src/theme/packs.ts) — left byte-identical, exempted by name in colour-law.test.ts, and recorded in brand-guide.md §6 with the pre-existing chart-6/7/8 defect also surfaced. Phase 59's contract only required leaving it untouched and flagging it, which it did."
---

# Phase 59: Visual Identity — Designed Token Set & Brand Guide Verification Report

**Phase Goal:** The direction locked in Phase 58 is realized as a real designed token set — oklch
palette, type scale, spacing/density system, and a signature element that *replaces* the
stock-shadcn defaults rather than recoloring them — and the brand guide gains the visual-identity
section it has never had (today it defines only voice/tone).
**Verified:** 2026-07-15T19:05:03Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `globals.css`'s oklch token values are the designed palette from the locked direction, not a recolor of the stock-shadcn defaults | ✓ VERIFIED | `git diff 10e182b HEAD -- apps/web/src/app/globals.css` (10e182b = last globals.css commit before Phase 59, Phase 55's port) shows every semantic token value replaced with a `var()` reference onto a 12-token identity ladder holding the exact literal oklch values from `58-IDENTITY.md`'s locked ladder table (spot-checked `--conf`, `--sugg`, `--pencil`, `--shelf`, `--hair` byte-for-byte against both the contract and the brand guide — all match). `--primary: var(--ink)` and `--ring: var(--ink)` in both `:root` and `.dark` — law 1 (no brand hue) is structural, not a doc claim. |
| 2 | A defined type scale, spacing/density system, and ≥1 signature element (none present before this phase) exist as reusable tokens/utilities | ✓ VERIFIED | `--text-2xs..xl` (6 steps, each with paired `--line-height`) + `--font-serif` registered in the native `@theme` block; 9 named `--spacing-*` steps + `--radius-card`/`--radius-frame`; `@utility pmark`/`pmark-confirmed`/`pmark-suggested` (the provenance mark, solid=confirmed/dashed=suggested, var()-referenced onto the ladder) and `@utility tshape` + 5 type-variants (all hue-free) exist as genuine reusable Tailwind v4 `@utility` declarations, not one-off component code. |
| 3 | `docs/design/brand-guide.md` has a visual-identity section (palette/type/spacing/signature + usage rules) alongside voice/tone | ✓ VERIFIED | New §3 "Visual identity" sits directly after §2 "Voice principles" (line 54 vs line 25). Covers all four required subjects with usage rules and 4 gates cited by path. Spot-checked 5 palette values (conf/sugg/pencil/shelf/hair, both themes = 10 literals) directly against `globals.css` — all identical. Both open flags (D-58-03, `--chart-1..5`) recorded honestly in §6, not buried. |
| 4 | The WCAG-AA contrast + token-registration regression gates stay green against the new designed values | ✓ VERIFIED | `npx vitest run src/app/__tests__/` → 4 files, 284 tests, all green (token-contrast, token-registration, colour-law, palette-ban). Wash-pair console output reproduces 58-IDENTITY.md's published numbers exactly: light conf 4.59, light sugg 4.52 (0.02 headroom over the 4.50 floor, confirmed tight as the contract flagged), dark conf 6.72, dark sugg 6.59. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/web/src/app/globals.css` | 12-token identity ladder (both themes) + shadcn semantic mapping + `@theme inline` registration | ✓ VERIFIED | Ladder + mapping present and correct (see truth 1). 17 identity families registered in `@theme inline` (`--color-conf` etc.), all resolve via `var()`. |
| `apps/web/src/app/__tests__/token-contrast.test.ts` | oklch-aware WCAG-AA gate with `var()` resolution + alpha compositing | ✓ VERIFIED | `resolveTokenValue`, `parseOklch`, `compositeOver` all present and exercised; SEMANTIC_PAIRS/GROUND_TEXT_PAIRS/WASH_PAIRS all pass. |
| `apps/web/src/app/__tests__/token-registration.test.ts` | Token-family registration gate covering identity + type-scale + density families | ✓ VERIFIED | 51 tests green, covers 17 identity families + type scale/serif/density/card-frame-radii. |
| `apps/web/src/app/__tests__/colour-law.test.ts` | Law-1 chroma-ceiling gate + cross-theme hue/chroma invariance | ✓ VERIFIED | 187 tests green, dynamic colour-token discovery (not a hardcoded list) — self-verified this discovers `--sidebar-primary` as an alias automatically (see negative-proof re-run below). |
| `docs/design/brand-guide.md` | New visual-identity section, alongside voice/tone | ✓ VERIFIED | §3, 178 lines, palette/type/spacing/signature + enforcement split + both open flags. |
| `.claude/skills/polytoken-design-system/SKILL.md` | Updated token source + conventions | ✓ VERIFIED | Stale `38.9% 0.053 173.7` teal claim: 0 occurrences. Points at `58-IDENTITY.md` + `brand-guide.md`. Mentions `pmark`/`tshape`/`colour-law` (6 occurrences ≥ required 3). `@tweakcn` row flags the law-1 conflict. |

### Scope Fences (adversarial checks requested)

| Fence | Expected | Status | Evidence |
|---|---|---|---|
| `packages/genui/src/theme/packs.ts` | Untouched vs phase-start baseline | ✓ VERIFIED | `git diff 10e182b HEAD -- packages/genui/src/theme/packs.ts` — empty diff. |
| `--chart-1..5` | Untouched vs phase-start baseline | ✓ VERIFIED | `git diff 10e182b HEAD -- apps/web/src/app/globals.css \| grep -- "--chart-[1-5]:"` — no `+`/`-` lines; values byte-identical, exempted by name in `colour-law.test.ts`. |
| `hsl(var(--` occurrences | 0 (Phase 55's standing gate) | ✓ VERIFIED | `grep -c "hsl(var(--" apps/web/src/app/globals.css` → `0`. |

### Adversarial Spot-Checks (self-run, not trusted from SUMMARY)

| Check | Method | Result |
|---|---|---|
| Criterion-1 recolor-vs-designed distinction | Diffed `globals.css` against `10e182b` (last commit touching the file before Phase 59) and spot-verified 5 token values (both themes = 10 literals) against `58-IDENTITY.md`'s locked ladder table | Every semantic token's value changed; the new literals are the contract's literals, not a recolor. `--primary` carries no hue (law 1's sharpest test) — confirmed structurally, not just by inspection. |
| Gate-can-still-fail (negative proof, run independently of the SUMMARY's claim) | Manually edited `:root`'s `--primary` from `var(--ink)` back to the pre-Phase-59 stock teal `oklch(38.9% 0.053 173.7)`, ran `npx vitest run src/app/__tests__/colour-law.test.ts` | **3 tests went RED** (`--primary`, and — as a bonus, proving dynamic discovery — the `var()`-chain aliases `--sidebar-primary`/`--sidebar-ring`), all naming the exact chroma (0.053) and the exact ceiling (0.03) they violate. Reverted; re-ran; **187/187 green**; `git diff --stat` confirmed zero leftover state. |
| Full suite re-run (not trusting SUMMARY's recorded pass) | `npx vitest run src/app/__tests__/` from a clean tree | 4 files / 284 tests, all green; wash-pair console output (4.59/4.52/6.72/6.59) matches 58-IDENTITY.md's published contract exactly, not approximately. |
| `npm run build -w @polytoken/web` (per verification_rules note) | Ran bare — failed collecting page data with `Missing/invalid auth environment variables` (SUPABASE_URL etc.) | Confirmed this is the documented pre-existing environment gap (`apps/web` has no `.env.local`, only monorepo root does), **not a Phase 59 regression**: temporarily copied the root `.env.local` into `apps/web/`, re-ran — build completed cleanly, exit 0, all 20 routes generated (including `/dev/design`, `/chat`, `/knowledge`, `/emails/[id]`, `/entities/[id]`). Removed the temp file immediately after; `git status` confirms no leftover state. The webpack CSS compile step ("Compiled successfully") passed even on the bare run — the failure is exclusively at the auth-env-collection step, unrelated to CSS/tokens. |

### Regression Gates (re-run myself, not trusted from SUMMARY)

| Gate | Command | Result |
|---|---|---|
| Full `@polytoken/web` test suite | `npm run test -w @polytoken/web` | **65 files / 730 tests, all green** (includes the 4-file/284-test token gate suite plus every other existing test — no regression). |
| Typecheck `@polytoken/web` | `npm run typecheck -w @polytoken/web` | Clean, exit 0. |
| Typecheck `@polytoken/ui` | `npm run typecheck -w @polytoken/ui` | Clean, exit 0. |
| Typecheck `@polytoken/genui` | `npm run typecheck -w @polytoken/genui` | Clean, exit 0. |
| `grep -c "hsl(var(--" apps/web/src/app/globals.css` | grep | `0` |
| `npm run build -w @polytoken/web` | next build | Fails only on pre-existing env gap (see above); succeeds cleanly with env vars present. Not a regression. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| IDNT-03 | 59-01, 59-02 | Locked direction realized as a designed token set (palette/type scale/spacing/signature replacing stock-shadcn defaults) | ✓ SATISFIED | Truths 1 and 2 above. |
| IDNT-04 | 59-03 | Brand guide gains a visual-identity section documenting the designed system | ✓ SATISFIED | Truth 3 above. |

No orphaned requirements — REQUIREMENTS.md maps only IDNT-03/IDNT-04 to Phase 59, both claimed by plans and both satisfied.

### Anti-Patterns Found

None. Scanned every file this phase modified (`globals.css`, `colour-law.test.ts`, `token-contrast.test.ts`, `token-registration.test.ts`, `layout.tsx`, `brand-guide.md`, `SKILL.md`) for `TODO`/`FIXME`/`XXX`/`TBD`/`HACK`/`PLACEHOLDER`/"coming soon"/"not yet implemented" — zero matches. The three self-caught deviations documented in the SUMMARYs (a CSS comment colliding with the gate's regex parser, twice, and a `*/`-in-prose CSS syntax break) were all fixed before their respective commits, verified independently here by re-running the full gate suite clean.

### Deferred Items

Both open flags Phase 59 was asked to surface (not resolve) are recorded honestly in
`docs/design/brand-guide.md` §6 and carried here as `deferred`, not gaps, per the verification
instructions — Phase 59's contract was to flag them, which it did.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | D-58-03 — entity type is shape, never hue (the one item the user hasn't explicitly blessed) | User decision, post-Phase-59 | `58-IDENTITY.md` flags it; `brand-guide.md` §6 records the concrete cost (`extraction-summary-panel.tsx`'s tier/type-hue confusion) |
| 2 | `--chart-1..5` — left out of the identity ladder entirely | User decision, post-Phase-59 | `brand-guide.md` §6 records the exemption + the pre-existing `chart-6/7/8` defect found during planning |

### Human Verification Required

None. Every criterion for this phase is a token/documentation/gate-level claim verifiable by
diffing source, reading the shipped file, and re-running committed automated gates — no visual
rendering judgment call is required to confirm the goal (that judgment happens at the human gate
in Phase 58, already closed, and again when Phases 60-63 render surfaces on these tokens).

### Gaps Summary

None. All 4 ROADMAP success criteria verified with independently-reproduced evidence (not
SUMMARY-trusted): the diff proves criterion 1 is a genuine designed-palette port (not a recolor),
the negative-proof re-run proves the gates can genuinely fail and were not silently weakened, the
full 730-test suite and 3 package typechecks are clean, and the one build failure encountered is a
pre-existing, independently-confirmed environment gap unrelated to this phase's changes. The two
open flags (D-58-03, `--chart-1..5`) are intentional, honestly-recorded scope boundaries — not
defects — and are carried forward as `deferred` for a future user decision.

---

*Verified: 2026-07-15T19:05:03Z*
*Verifier: Claude (gsd-verifier)*
