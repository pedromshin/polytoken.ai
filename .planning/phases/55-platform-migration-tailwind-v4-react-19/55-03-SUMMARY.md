---
phase: 55-platform-migration-tailwind-v4-react-19
plan: 03
subsystem: frontend-design-tokens
tags: [tailwindcss-v4, oklch, wcag-aa, vitest, regression-guard, css-theme]

# Dependency graph
requires: ["55-01", "55-02"]
provides:
  - "token-contrast.test.ts rewritten to parse oklch(L C H) tokens (self-contained OKLab->linear-sRGB conversion, no new dependency) — the WCAG-AA neutral-pair gate stays a REAL regression gate on the v4/oklch engine"
  - "token-registration.test.ts rewritten off tailwindcss/resolveConfig (gone in v4) to string-parse globals.css's @theme inline / native @theme blocks directly, reusing token-contrast's readTokenBlock — the unregistered-utility-class gate stays real"
  - "npm run test -w @polytoken/web fully green again (64/64 files, 464/464 tests) — the two Stage-2 expected failures from 55-02 are now resolved, STCK-01 complete"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "oklch(L C H) -> linear-sRGB conversion implemented self-contained via the standard Bjorn Ottosson OKLab forward matrices (hue -> a/b via cos/sin, OKLab -> LMS' via the 3x3 mix matrix, cube, LMS -> linear-sRGB via the second 3x3 matrix, clamp to [0,1]) — no culori/color-space runtime dependency added, per 55-RESEARCH.md's 'Don't Hand-Roll' guidance (the oklch literals were already precomputed once in 55-02, so the gate only ever parses already-final values, never converts at app runtime)"
    - "CSS-block string-parsing (readTokenBlock, exported from token-contrast.test.ts) is the one shared parser for BOTH gates — token-registration.test.ts imports it rather than reimplementing a second CSS-block reader, per the plan's explicit 'do not write a third parser' instruction"

key-files:
  created: []
  modified:
    - apps/web/src/app/__tests__/token-contrast.test.ts
    - apps/web/src/app/__tests__/token-registration.test.ts

key-decisions:
  - "Comments referencing the old parser names (parseHslTriplet, hslToLinearRgb, resolveConfig) were reworded to avoid those literal substrings entirely — the plan's own acceptance criteria specify `grep -c` must return exactly 0 for those tokens, which a purely-explanatory code comment mentioning the old name would have violated on a literal count basis, even though the runtime code itself had already fully replaced them"
  - "oklch alpha component (`/ N%`) is parsed-and-discarded (non-capturing) rather than rejected, since CSS oklch() syntax permits it even though none of the 3 gated NEUTRAL_PAIRS in globals.css currently use it — keeps the parser forward-compatible without weakening the fail-loud contract for genuinely malformed values"
  - "token-registration's @theme (native, non-inline) block read relies on the same readTokenBlock regex distinguishing '@theme inline {' from '@theme {' purely by exact-substring-then-whitespace-then-brace matching (verified: '@theme inline' followed immediately by '{' after only whitespace matches the inline block; '@theme' followed immediately by '{' after only whitespace does NOT match inside '@theme inline {' since 'inline' intervenes) — no new selector-disambiguation logic needed, the existing helper's regex behavior already produces the correct block for each call"

patterns-established:
  - "Pattern: when a CI-gate rewrite has an acceptance criterion of the form `grep -c \"<old-name>\" file` == 0, treat that as literal (including comments) — rewrite explanatory prose to avoid the old identifier string entirely, not just remove the code that used it"

requirements-completed: ["STCK-01"]  # STCK-01 spanned 55-01 (engine swap) -> 55-02 (oklch token port) -> 55-03 (this plan, gate rewrites) — completes here per the established multi-plan-per-requirement precedent (54-01/MOBL-01, 55-01/55-02-SUMMARY.md)

# Metrics
duration: ~25min
completed: 2026-07-15
---

# Phase 55 Plan 03: Rewrite the WCAG-AA + Token-Registration Gates for Tailwind v4 Summary

**Both STCK-01-named CI gates rewritten for the v4/oklch engine — `token-contrast.test.ts` now parses `oklch(L C H)` directly via a self-contained OKLab-to-linear-sRGB conversion (no new dependency), and `token-registration.test.ts` string-parses `globals.css`'s `@theme inline`/`@theme` blocks instead of the now-nonexistent `tailwindcss/resolveConfig` — both proven to still fail on an injected regression before being reverted, and the full `@polytoken/web` vitest suite is green again (64/64 files, 464/464 tests).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (both `type="auto"`, `tdd="true"`)
- **Files touched:** 2 modified, 1 commit

## Accomplishments

- `token-contrast.test.ts`: `parseHslTriplet`/`hslToLinearRgb` replaced with `parseOklch` (regex-parses `oklch(L C H)` / `oklch(L% C H)`, optional discarded alpha, fail-loud on unparseable input) + `oklchToLinearRgb` (Bjorn Ottosson's standard OKLab forward matrices — hue to a/b via cos/sin, OKLab to LMS' via the first 3x3 mix, cube, LMS to linear-sRGB via the second 3x3 mix, clamp to `[0,1]` for the gamut-clipping edge case). `readTokenBlock`, `relativeLuminance`, `contrastRatio`, `NEUTRAL_PAIRS`, `MODES`, and the `>=4.5:1` assertion loop are byte-identical to the pre-migration version — only the value-parsing/color-math layer changed. All 6 gated pairs (muted, secondary, accent x2 modes) pass against the live oklch tokens.
- `token-registration.test.ts`: the dead `tailwindcss/resolveConfig` import and `describe.skip` wrapper (both carried over from 55-01) removed; the file now imports `readTokenBlock` from `token-contrast.test.ts` and reads globals.css's `@theme inline` block (color-family mappings, incl. the 8-entry sidebar family and 5 chart entries) and native `@theme` block (3-entry elevation shadow scale, xl/2xl radius) directly. Same 4 `it(...)` groupings (sidebar / chart / elevation / radius) preserved verbatim from the pre-migration test names.
- Both gates independently verified to still catch a real regression: a temporary `--muted-foreground` lightness edit collapsed the light-mode contrast ratio to 1.21 (gate failed with the exact computed value in the assertion message, as designed — "never hardcoded expected numbers"); a temporary deletion of the `--color-sidebar-ring` mapping line failed the sidebar-family test with a targeted error naming the missing token. Both edits reverted; `git diff --stat apps/web/src/app/globals.css` confirmed empty (byte-identical) after each revert.
- `npm run test -w @polytoken/web` — **64 files passed / 464 tests passed, 0 failed, 0 skipped** (up from 55-02's 62 passed + 1 failed + 1 skipped). `npm run typecheck -w @polytoken/web` — exit 0.

## Task Commits

1. **Task 1 + Task 2 (single combined commit — both gate files rewritten together, verified together):** `8099fc3` (test)

## Files Created/Modified

- `apps/web/src/app/__tests__/token-contrast.test.ts` — `parseHslTriplet`/`hslToLinearRgb`/`HslTriplet` type replaced with `parseOklch`/`oklchToLinearRgb`/`OklchColor` type; `readTokenBlock`, `relativeLuminance`, `contrastRatio`, `LinearRgb` type, `NEUTRAL_PAIRS`/`MODES`/describe-it structure unchanged
- `apps/web/src/app/__tests__/token-registration.test.ts` — full rewrite: `resolveConfig`/`appConfig` imports and `describe.skip` removed; now imports `readTokenBlock` and directly parses `@theme inline` / `@theme` blocks; same 4 test names preserved

## Negative-Test Verification (Gate-Not-Hollowed Proof)

Per the plan's explicit instruction and this plan's `<threat_model>` (T-55-03), each rewritten gate was proven to still fail on a deliberately-broken token, then reverted — not just proven to pass on the current (correct) state.

**1. token-contrast — injected contrast regression:**
- Edit: `apps/web/src/app/globals.css` line 334, `:root`'s `--muted-foreground: oklch(53.2% 0.014 178)` -> `oklch(90% 0.014 178)` (pushed close to `--muted`'s own `96.5%` lightness).
- Result: `npm run test -w @polytoken/web -- token-contrast` — 1/6 failed: `muted/muted-foreground clears 4.5:1 in light (:root)` — `expected 1.2119151797584138 to be greater than or equal to 4.5`.
- Reverted; `git diff --stat apps/web/src/app/globals.css` confirmed empty.

**2. token-registration — injected unregistered-family regression:**
- Edit: `apps/web/src/app/globals.css` line 61, deleted the `--color-sidebar-ring: var(--sidebar-ring);` line from the `@theme inline` block entirely.
- Result: `npm run test -w @polytoken/web -- token-registration` — 1/10 failed: `registers the full sidebar family against the --sidebar-* vars` — `Expected globals.css's @theme block to register "--color-sidebar-ring" -- not found.`
- Reverted; `git diff --stat apps/web/src/app/globals.css` confirmed empty.

Both gates therefore still fail on the exact bug classes they exist to catch (a real WCAG-AA contrast drop; a declared-but-unregistered token family) — the rewrite preserved intent, it did not hollow the gate.

## Contrast-Ratio Sanity Cross-Check (vs. 55-02's Recorded Numbers)

The gate's own live output (all 6 tests passing with no hardcoded expected values) is itself the proof, but as an explicit cross-check against 55-02-SUMMARY.md's precomputed table (all values within 0.03 of the pre-migration HSL contrast):

| Mode | Pair | 55-02 recorded (oklch round-trip) | This gate's live computed ratio |
|------|------|-------------------------------------|----------------------------------|
| light (:root) | muted/muted-foreground | 4.698 | PASS (>=4.5, exact value not re-printed by a passing `toBeGreaterThanOrEqual` assertion — confirmed via the negative-test above, where breaking this exact pair produced a directly comparable failing ratio of 1.21, proving the live computation path is wired correctly against the same token) |
| light (:root) | secondary/secondary-foreground | 14.718 | PASS |
| light (:root) | accent/accent-foreground | 14.506 | PASS |
| dark (.dark) | muted/muted-foreground | 6.286 | PASS |
| dark (.dark) | secondary/secondary-foreground | 12.520 | PASS |
| dark (.dark) | accent/accent-foreground | 12.448 | PASS |

All 6 assertions pass with `expect(ratio).toBeGreaterThanOrEqual(4.5)` against the file's live oklch values — consistent with 55-02's independently-precomputed table.

## Deviations from Plan

None. Plan executed exactly as written, with one acceptance-criteria-driven wording adjustment (see `key-decisions`): explanatory comments that named the old `resolveConfig`/`parseHslTriplet`/`hslToLinearRgb` identifiers (for context, not code) were reworded to avoid the literal substrings, since the plan's acceptance criteria specify `grep -c` must return exactly 0 for those strings anywhere in the file, not just in executable code.

## Environment / Gate Results

- **`npm run test -w @polytoken/web -- token-contrast`** -> exit 0, 6/6 tests pass
- **`npm run test -w @polytoken/web -- token-registration`** -> exit 0, 10/10 tests pass
- **`npm run typecheck -w @polytoken/web`** -> exit 0
- **`npm run test -w @polytoken/web`** (full suite) -> exit 0, **64 files / 464 tests, 0 failed, 0 skipped**
- Acceptance-criteria greps: `grep -c "resolveConfig\|parseHslTriplet\|hslToLinearRgb" token-contrast.test.ts` -> 0; `grep -c "oklch" token-contrast.test.ts` -> 13; `grep -c "resolveConfig" token-registration.test.ts` -> 0; no `tailwind.config` import string remains in `token-registration.test.ts`
- Negative-test verification: both gates proven to fail on an injected regression, then reverted (see above) — `git diff --stat apps/web/src/app/globals.css` empty after each

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources.

## Threat Flags

None. Per this plan's own `<threat_model>` (T-55-03), the only threat named (silent gate rot from a hollowed rewrite) is the exact thing the negative-test verification above disproves — no new dependency, no new endpoint, no new trust boundary.

## Issues Encountered

None. Both gates rewrote cleanly on the first implementation; no fix-attempt cycles were needed on either task.

## User Setup Required

None.

## Next Phase Readiness

- STCK-01 is now fully satisfied across its 3-plan span (55-01 engine swap -> 55-02 oklch token port -> 55-03 this plan's gate rewrites) — `REQUIREMENTS.md` checkbox flips via `requirements mark-complete`.
- 55-04 (React 19 bump) and 55-05 (Radix decision + registry proof) are unblocked — this plan's own scope (the two named vitest gates) is closed, and the full `apps/web` vitest suite is a clean baseline for those plans' own regression checks.
- Two pre-existing, out-of-scope items remain logged in `deferred-items.md` from 55-02 (the `/knowledge` E2E click-interception failure and the `packages/genui` `artifacts.test.ts` registry-hash drift) — neither is a vitest failure in `@polytoken/web`, both explicitly out of this plan's and this workspace's scope per the execution context's own framing.

---
*Phase: 55-platform-migration-tailwind-v4-react-19*
*Completed: 2026-07-15*

## Self-Check: PASSED

Both modified files (`apps/web/src/app/__tests__/token-contrast.test.ts`,
`apps/web/src/app/__tests__/token-registration.test.ts`) confirmed present on disk with the
rewritten content. Commit hash `8099fc3` confirmed present via `git log --oneline -3`.
