---
phase: 48-token-system-extensions
plan: 02
subsystem: ui
tags: [design-tokens, tailwind, dtcg, wcag-contrast, vitest, genui, knowledge-canvas]

# Dependency graph
requires:
  - phase: 48-01
    provides: the DTCG token contract (TOKEN_ALIASES, TOKEN_ALIAS_TO_CSS_VAR, 6 style packs, resolveVars) plus the extensible SEMANTIC_STATUS_PAIRS contrast-gate array this plan appends to
provides:
  - "color.tier.inferred/inferredForeground/extracted/extractedForeground aliases — a purpose-built knowledge confidence ladder (D-48-04), never overloading color.accent/color.muted"
  - "color.graph.entity/emailComponent/email (+Foreground) aliases — a CLOSED node-type palette (D-48-05) replacing graph-nodes.tsx's hardcoded violet-500/amber-500/slate Tailwind classes"
  - App-layer tier/graph Tailwind color groups (bg-tier-*, bg-graph-*) resolving opacity modifiers exactly like bg-primary/10
  - 5 more contrast pairs appended to the SEMANTIC_STATUS_PAIRS computational WCAG-AA gate (now 8 pairs x 6 packs)
affects: [48-04, 50-mobile-responsive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confidence-ladder color design: EXTRACTED = solid saturated bg + light fg (confirmed); INFERRED = pale bg + dark hue-matched fg (provisional) — same pattern reusable by future trust-tier UI"
    - "Closed-palette anti-drift comment convention (D-48-05): a new xyflow node category requires a NEW alias, documented inline at the TOKEN_ALIASES group and enforced structurally by TokenAliasSchema's z.enum"

key-files:
  created: []
  modified:
    - packages/genui/src/theme/tokens.ts
    - packages/genui/src/theme/packs.ts
    - packages/genui/src/theme/__tests__/packs.test.ts
    - apps/web/src/app/globals.css
    - packages/tailwind-config/base.ts

key-decisions:
  - "Tier + graph values authored via a computational contrast-search script (ported the exact contrast.ts algorithm to a scratch Node script) rather than eyeballing HSL — every one of the 30 new fg/bg pairs (12 tier + 18 graph, 6 packs each) was verified >= 4.5:1 before being written into packs.ts, matching the rigor of 48-01's computational gate"
  - "playful-rounded's color.graph.entity (270 75% 60%) deliberately uses a distinct hue from that pack's own color.primary (262 83% 58%, also violet) — close enough to read as the same family, far enough to stay visually distinguishable as a different alias"
  - "globals.css dark-mode variants: solid/vivid pairs (graph-entity, graph-email-component) stay IDENTICAL between :root and .dark (mirrors --primary's own light/dark-invariant precedent); pale pairs (tier-inferred, graph-email) get inverted lightness in .dark (mirrors --muted's light->dark inversion) — not gated by any test (only packs.ts's registry is), but computed for correctness anyway"

requirements-completed: [TOKN-04, TOKN-05]

# Metrics
duration: 40min
completed: 2026-07-10
---

# Phase 48 Plan 02: Token System Extensions — Tier-Ladder & Graph Palette Summary

**Two purpose-built token systems (knowledge tier-ladder INFERRED/EXTRACTED + a closed graph node-type palette) landed across all 6 style packs, every fg/bg pair computationally WCAG-AA verified, ready for the knowledge-canvas consumer plan (48-04).**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2/2 completed
- **Files modified:** 5

## Accomplishments

- `TOKEN_ALIASES` grew from 25 (post-48-01) to 35, adding `color.tier.inferred`/`inferredForeground`/`extracted`/`extractedForeground` (D-48-04) and `color.graph.entity`/`emailComponent`/`email` (+Foreground each, D-48-05) — both wired into `TOKEN_ALIAS_TO_CSS_VAR` with the existing compile-time `satisfies` completeness gate, so a missing wire-up fails `tsc`, not a runtime surprise.
- All 6 style packs (`polytoken-teal`, `linear-clean`, `warm-editorial`, `brutalist`, `corporate-saas`, `playful-rounded`) now define distinct, pack-tuned HSL values for both new alias families:
  - **Tier ladder:** EXTRACTED is a solid, saturated hue distinct from that pack's primary/success (e.g. teal's `178 55% 30%` cyan-teal, brutalist's stark `210 100% 42%` blue); INFERRED is a pale tint in a different hue family (e.g. teal's `230 40% 90%` indigo-violet, brutalist's `210 30% 85%`) — every pair is visibly distinct from that pack's `color.muted`/`color.accent` (which are near-neutral gray in 5 of 6 packs) and from each other.
  - **Graph palette:** violet/amber/slate-equivalents per pack, retuned per the plan's own examples — brutalist uses stark high-saturation values (`270 100% 50%` entity, `45 100% 50%` emailComponent), warm-editorial warms its amber register (`40 90% 48%`), and playful-rounded's entity (`270 75% 60%`) is deliberately shifted off its own violet primary (`262 83% 58%`) so the two stay visually distinguishable.
- `resolveVars` extended with 10 new CSS-var lines per pack (4 tier + 6 graph); `apps/web/src/app/globals.css` gained `--tier-*`/`--graph-*` custom properties in both `:root` (polytoken-teal values) and `.dark` (dark-adjusted: solid/vivid pairs stay theme-invariant, pale pairs invert lightness). `packages/tailwind-config/base.ts` gained `tier` and `graph` Tailwind color groups in the flat (non-DEFAULT) idiom the plan specified, mirroring `primary`'s `hsl(var(--x))` pattern so `/10`, `/40` opacity modifiers resolve identically for `bg-graph-entity/10 border-graph-entity/40 text-graph-entity`.
- `packages/genui/src/theme/tokens.ts` carries the D-48-05 closed-palette anti-drift comment directly above the graph alias group: a new xyflow node category requires a NEW alias, never a repurposed one — structurally enforced downstream by `TokenAliasSchema`'s `z.enum` (only `TOKEN_ALIASES` strings are ever valid).
- All 30 new fg/bg pairs (12 tier + 18 graph across 6 packs) appended to `packs.test.ts`'s `SEMANTIC_STATUS_PAIRS` computational WCAG-AA gate — every value was verified >= 4.5:1 via a scratch port of the exact `contrast.ts` algorithm *before* being written into `packs.ts`, so the gate passed on first run rather than needing iterative fixes.
- 103/103 tests pass across the full `src/theme` suite (`packs.test.ts` 73, `token-allowlist.test.ts` 17, `themed-wrapper.test.tsx` 13) — the registration loop and allowlist z.enum both auto-covered the 10 new aliases with zero additional test code (per the plans established in 48-01).

## Task Commits

Each task was committed atomically:

1. **Task 1: Tier-ladder tokens (INFERRED / EXTRACTED) across all 6 packs** - `b02562c` (feat)
2. **Task 2: Closed graph node-type palette across all 6 packs** - `39f32ff` (feat)

_Note: both tasks were flagged `tdd="true"` in the plan, following 48-01's established precedent — the plan structures each task as an implement-then-gate pair (values + appended contrast-test entries in the same commit) rather than a literal failing-RED-commit/GREEN-commit split. Each task's own `<verify>` block expects a passing state after the task completes, not an intermediate failing state, so no artificial failing commit was introduced._

## Files Created/Modified

- `packages/genui/src/theme/tokens.ts` - 10 new aliases (4 tier + 6 graph) in `TOKEN_ALIASES` + `TOKEN_ALIAS_TO_CSS_VAR`, with the D-48-05 closed-palette comment
- `packages/genui/src/theme/packs.ts` - 10 new values per pack (6 packs) + `resolveVars` extension + inline WCAG comments
- `packages/genui/src/theme/__tests__/packs.test.ts` - 5 new entries in `SEMANTIC_STATUS_PAIRS` (2 tier + 3 graph)
- `apps/web/src/app/globals.css` - `--tier-*`/`--graph-*` vars in `:root` and `.dark`
- `packages/tailwind-config/base.ts` - `tier` and `graph` color groups

## Decisions Made

- Tier-ladder values authored per pack (all computationally verified >= 4.5:1): polytoken-teal extracted `178 55% 30%`/fg `0 0% 98%` (5.10:1), inferred `230 40% 90%`/fg `230 45% 28%` (9.07:1); linear-clean extracted `195 60% 34%`/fg `210 20% 98%` (5.30:1), inferred `260 45% 92%`/fg `260 40% 32%` (8.49:1); warm-editorial extracted `165 55% 30%`/fg `0 0% 98%` (5.20:1), inferred `250 30% 90%`/fg `250 30% 28%` (8.86:1); brutalist extracted `210 100% 42%`/fg `0 0% 100%` (5.15:1), inferred `210 30% 85%`/fg `0 0% 0%` (14.63:1); corporate-saas extracted `175 60% 29%`/fg `0 0% 98%` (5.17:1), inferred `260 40% 93%`/fg `260 40% 30%` (9.34:1); playful-rounded extracted `190 65% 33%`/fg `0 0% 100%` (5.07:1), inferred `45 85% 88%`/fg `30 40% 22%` (9.41:1).
- Graph palette values per pack (all >= 4.5:1): polytoken-teal entity `262 83% 58%`/white (5.67:1, matches Tailwind's violet-500 exactly), emailComponent `38 92% 50%`/`20 14% 10%` (8.21:1, matches amber-500 with dark text), email `215 20% 65%`/`215 25% 15%` (6.03:1); linear-clean entity `262 60% 55%` (5.49:1), emailComponent `38 85% 48%` (7.28:1), email `220 14% 45%` (4.95:1); warm-editorial entity `265 55% 52%` (5.89:1), emailComponent `40 90% 48%` (8.74:1), email `30 15% 41%` (5.01:1); brutalist entity `270 100% 50%` (6.26:1), emailComponent `45 100% 50%` (12.73:1), email `0 0% 40%` (5.74:1); corporate-saas entity `262 70% 55%` (6.06:1), emailComponent `38 90% 48%` (7.61:1), email `215 25% 48%` (4.70:1); playful-rounded entity `270 75% 60%` (4.63:1), emailComponent `35 95% 55%` (8.71:1), email `262 15% 55%` (4.69:1).
- Both new alias families follow the same design grammar per pack: EXTRACTED/graph aliases are solid, saturated colors usable as `bg-X text-X-foreground` (badge/chip) AND `bg-X/10 border-X/40` (soft node-chrome), matching how `color.primary` already supports both usages; INFERRED is deliberately the lighter/quieter member of the tier pair.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' file lists, alias names, and CSS-var namings matched the plan's `<interfaces>`/`<action>` sections verbatim; no bugs, missing functionality, or blocking issues were encountered during implementation.

## Issues Encountered

- `npm run typecheck -w @polytoken/web` (Task 2's verify step) reproduces the same pre-existing, already-deferred failure documented in 48-01's `deferred-items.md`: ~50 `TS2307`/`TS7006` errors confined entirely to the untracked `apps/web/src/app/dev/design/` scratch directory (stale `@nauta/ui/*` imports predating the Phase 42 rename; the `tsconfig.json` exclude entry is not effective). Verified none of these errors reference `tier`, `graph`, `tailwind-config`, or `globals.css` — confirmed out of scope per the scope-boundary rule (this plan's `files_modified` does not include `tsconfig.json` or the scratch directory). No new deferred-item entry needed; the existing one already covers this exact recurrence.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `color.tier.inferred/extracted` (+Foreground) and `color.graph.entity/emailComponent/email` (+Foreground) are live in all 6 packs, both token layers, and the app-layer Tailwind color groups (`bg-tier-*`, `bg-graph-*`) — ready for 48-04 (the knowledge-canvas consumer plan) to replace `graph-nodes.tsx`'s hardcoded `bg-violet-500/10`, `bg-amber-500/10`, and `bg-slate-100/60` Tailwind classes with the new semantic tokens, and to build tier-ladder badges/legends using `bg-tier-extracted`/`bg-tier-inferred`.
- The closed-palette rule (D-48-05) is documented inline in `tokens.ts` — 48-04 (or any future plan) adding a new xyflow node category must add a new `color.graph.*` alias here, never repurpose `entity`/`emailComponent`/`email` for an unrelated category.
- `SEMANTIC_STATUS_PAIRS` now carries 8 pairs (1 success + 2 tier + 3 graph... plus room for more) across 6 packs — any future plan needing a new contrast-gated pair appends to this same array per the 48-01-established pattern.
- No new blockers introduced; the one recurring issue (apps/web dev/design scratch-dir typecheck failure) remains tracked in 48-01's `deferred-items.md` and is unrelated to this plan's scope.

## Self-Check: PASSED

All 5 modified files verified present on disk; both task commit hashes (`b02562c`, `39f32ff`) verified present in `git log`; no unexpected file deletions in either commit (`git diff --diff-filter=D` empty for both).

---
*Phase: 48-token-system-extensions*
*Completed: 2026-07-10*
