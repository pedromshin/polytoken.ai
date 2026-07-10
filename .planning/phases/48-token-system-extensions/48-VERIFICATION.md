---
phase: 48-token-system-extensions
verified: 2026-07-10T22:00:00Z
status: passed
score: 13/14 must-haves verified (1 override applied)
overrides_applied: 1
overrides:
  - must_have: "radius.pill consumed at tab pills in studio chrome (ROADMAP SC1 / TOKN-01)"
    reason: "Studio tabs are an established underline-style identity (Phase 16-04/D-21); forcing them into a pill shape was judged out of scope for a token-primitives phase and belongs in Phase 49's total re-skin if still desired. No genuine 'tab pill' component exists anywhere in the app to convert (independently confirmed by a second adversarial audit of all 3 packages/ui Tabs consumers). ROADMAP SC1 and REQUIREMENTS TOKN-01 wording amended 2026-07-10 to stop overclaiming."
    accepted_by: "orchestrator (auto-accepted per v1.8 autonomous mandate; user may veto)"
    accepted_at: "2026-07-10T22:20:00Z"
gaps:
  - truth: "radius.pill is consumed at tab pills in studio chrome (ROADMAP SC1 / TOKN-01 literal wording: \"citation chips, follow-up chips, and tab pills render true pill shapes\")"
    status: overridden
    reason: "Studio's TabsList/TabsTrigger (apps/web/src/app/studio/_components/studio-tabs.tsx) remains rounded-none border-b-2 underline-style tabs — never converted to rounded-pill. The shared @polytoken/ui Tabs primitive (packages/ui/src/tabs.tsx) also uses rounded-lg/rounded-md, not a pill shape. 48-03-PLAN's own <constraints> section discovered this during execution and explicitly instructed NOT to force tabs into pills, framing it as a documented exception under D-48-01's discretion clause — but the ROADMAP.md Success Criterion and REQUIREMENTS.md's TOKN-01 line (marked [x] Complete) both still literally claim tab pills render true pill shapes app-wide, which is not observably true."
    artifacts:
      - path: "apps/web/src/app/studio/_components/studio-tabs.tsx"
        issue: "TabsTrigger className is rounded-none border-b-2 (underline style), not rounded-pill"
      - path: "packages/ui/src/tabs.tsx"
        issue: "Shared TabsList/TabsTrigger base styling is rounded-lg/rounded-md, not pill-shaped"
    missing:
      - "Either: convert studio-tabs.tsx (and/or the shared Tabs primitive) to a true pill-shaped tab treatment, OR formally accept the underline-style exception via a VERIFICATION.md override / an explicit ROADMAP.md wording correction so TOKN-01 and Phase 48 SC1 stop overclaiming a surface that was never converted."
human_verification:
  - test: "Load /chat and /emails/[id] in a browser with a live Supabase session and visually confirm: the ProvenanceLink citation chip renders a true stadium/pill shape (not a rounded rectangle), and the confirmed-good affordances (layers-tree-row confirm dot, extraction-summary-panel confirmed swatch, confirm-deny-controls CONFIRM button) render the success-token green while the DENY/deny buttons stay destructive-red."
    expected: "Citation chips show fully rounded (9999px) pill ends; confirmed-good visuals show a legible, WCAG-AA green distinct from the destructive red; no visual regression from the className-only diffs recorded in the textual before/after artifacts."
    why_human: "Live-browser rendering cannot be captured by the Phase-47 screenshot harness in this environment — both surfaces sit behind Supabase auth middleware and OAuth remains user-gated (GOOGLE-OAUTH-RUNBOOK.md not yet completed). 48-03/48-04 substituted textual diff artifacts (.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md, .planning/ui-reviews/2026-07-10T21-05-50.831Z/index.md) documenting the exact className changes, but no actual screen render has been visually confirmed."
  - test: "Load /knowledge in a browser with a live session and visually confirm the graph node chrome (entity/email-component/email nodes), filter-rail dots, node-detail-pane badges, and the tier edge/legend/filter render the closed graph palette and tier ladder colors as intended (not React Flow's stock gray, not the old violet/amber/slate Tailwind classes)."
    expected: "Node types are visually distinguishable via the new graph-* palette; EXTRACTED edges show an explicit tier-extracted blue/teal-ish stroke instead of library-default gray; INFERRED/AMBIGUOUS edges show the dashed/faint tier-inferred stroke; the Confirmed filter segment ties visually to the tier-extracted color."
    why_human: "Same OAuth-gated blocker as above — /knowledge also sits behind auth middleware with no live session available in this environment; only a textual before/after artifact exists."
---

# Phase 48: Token-System Extensions Verification Report

**Phase Goal:** The v1.4 DTCG token system is extended (never discarded) with the primitives every re-skin, mobile, and panel-editing phase needs — pill radius, success color, code typography, tier-ladder tokens, a graph node/edge-type palette, a hover/active convention, and a breakpoint-awareness decision.

**Verified:** 2026-07-10
**Status:** passed (1 override applied — see frontmatter `overrides`; original status gaps_found)
**Re-verification:** No — initial verification (override + ROADMAP/REQUIREMENTS wording amendment applied 2026-07-10 by orchestrator under the v1.8 autonomous mandate)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `radius.pill` exists in `TOKEN_ALIASES` + all 6 style packs (brutalist exempted with documented `0rem` exception) | ✓ VERIFIED | `packages/genui/src/theme/tokens.ts:67`, all 6 pack maps in `packs.ts` define `radius.pill`; `packs.test.ts` completeness gate passes (103/103 theme tests green) |
| 2 | `radius.pill` consumed at the shared citation chip (`ProvenanceLink`) — renders a true pill | ✓ VERIFIED | `apps/web/src/components/provenance-link.tsx:36` — `CHIP_CLASS_NAME` uses `rounded-pill`; also converted the chat-canvas `data-edge.tsx` connection label |
| 3 | `radius.pill` consumed at "follow-up chips" | N/A (not counted) | No follow-up-chip component exists anywhere in the app (verified via repo-wide grep for `follow-up chip`/`FollowUpChip`) — 48-03-SUMMARY documents this absence per the plan's own discretion clause |
| 4 | `radius.pill` consumed at "tab pills in studio chrome" (ROADMAP SC1 / TOKN-01 literal text) | ✗ FAILED | `apps/web/src/app/studio/_components/studio-tabs.tsx` TabsTrigger classes are `rounded-none border-b-2` (underline style); the shared `packages/ui/src/tabs.tsx` base component is `rounded-lg`/`rounded-md` — no tab-pill surface was converted anywhere. See Gaps. |
| 5 | `color.success`/`color.successForeground` exist in all 6 packs, WCAG-AA >= 4.5:1 (computational, not eyeballed) | ✓ VERIFIED | `packs.ts` all 6 packs; `packs.test.ts` `SEMANTIC_STATUS_PAIRS` "success" pair loop — all 6 packs pass (test run: 103/103 green) |
| 6 | `color.success` consumed at confirmed-good visuals; deny/stop controls NOT relabelled | ✓ VERIFIED | `layers-tree-row.tsx`, `extraction-summary-panel.tsx`, `confirm-deny-controls.tsx` — grep for `green-\|emerald-\|lime-` returns zero matches; DENY buttons confirmed still `bg-destructive` |
| 7 | `typography.code.family` exists in all 6 packs; brutalist's JetBrains Mono migrated onto it; consumed in chat markdown + studio JSON pane | ✓ VERIFIED | `packs.ts` brutalist `typography.code.family` = `'JetBrains Mono', ...`; `markdown-renderer.tsx` + `json-pane.tsx` use `font-code` |
| 8 | Tier-ladder tokens (`color.tier.inferred`/`extracted` +Foreground) exist, distinct from accent/muted, never overloaded | ✓ VERIFIED | `tokens.ts` lines 79-82; all 6 packs define distinct hues from `color.muted`/`color.accent` (verified by inspection of all 6 pack value sets) |
| 9 | Tier ladder consumed by knowledge tier edges + legend + filter (not muted-foreground) | ✓ VERIFIED | `tier-edge-style.ts` — INFERRED/AMBIGUOUS/EXTRACTED all reference `hsl(var(--tier-*))`; `tier-edge-style.test.ts` 4/4 pass (test run confirmed); `graph-legend.tsx` auto-inherits; `tier-filter-control.tsx` active segment uses `tier-extracted` |
| 10 | Closed graph node-type palette (`color.graph.entity`/`emailComponent`/`email` +Foreground) exists, zero raw hex | ✓ VERIFIED | `tokens.ts` lines 89-94 with closed-palette anti-drift comment; `packs.test.ts` HSL-triplet + no-raw-hex gate passes for all color aliases across 6 packs |
| 11 | Graph palette consumed identically by node chrome, filter-rail dots, and detail-pane badges (one alias, one source, no drift) | ✓ VERIFIED | `graph-nodes.tsx`, `filter-rail.tsx`, `node-detail-pane.tsx` all reference the same `graph-entity`/`graph-email-component`/`graph-email` classes; zero `violet-`/`amber-`/`slate-`/`hsl(164` literals remain (grep confirmed) |
| 12 | WCAG-AA contrast gate is computational (not eyeballed) and covers success + tier + graph pairs across all 6 packs | ✓ VERIFIED | `theme/__tests__/contrast.ts` HSL→sRGB→luminance→ratio helper; `packs.test.ts` `SEMANTIC_STATUS_PAIRS` loop (6 pairs × 6 packs = 36 assertions) — all pass |
| 13 | Token-family registration gate proves every alias resolves to a non-empty CSS var (catches "var exists but never registered") | ✓ VERIFIED | `packs.test.ts` "Token-family registration" describe block iterates all 35 `TOKEN_ALIASES` × 6 packs — passes |
| 14 | Touch-target (>=44px) utility + documented `md`-breakpoint convention exist and are buildable | ✓ VERIFIED | `apps/web/src/app/globals.css` `.touch-target { min-height: 44px; min-width: 44px; }` + inline breakpoint comment |
| 15 | ONE documented hover/active-state derivation rule with worked examples from this phase's own chips/badges | ✓ VERIFIED | `docs/design/hover-active-convention.md` — two-row recipe table + 3 worked examples (ProvenanceLink, ConfirmDenyControls, TierFilterControl) |
| 16 | Breakpoint-awareness decision doc answers all 3 required questions, rejects a per-breakpoint token dimension, cited from brand guide | ✓ VERIFIED | `docs/design/breakpoint-decision.md` (768px, touch-target, Phase-50 MAY/MAY NOT); `docs/design/brand-guide.md` §8 cites both convention docs (grep-confirmed) |

**Score:** 13/14 truths verified (item 3 "follow-up chips" excluded from denominator — no such component exists to convert, a legitimate absence documented per the plan's own discretion clause; item 4 "tab pills" is the one genuine FAILED truth)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/theme/tokens.ts` | 4 utility + 4 tier + 6 graph aliases in `TOKEN_ALIASES`/`TOKEN_ALIAS_TO_CSS_VAR` | ✓ VERIFIED | 35 total aliases present, `satisfies Record<TokenAlias,string>` compiles clean |
| `packages/genui/src/theme/packs.ts` | All new values × 6 packs + `resolveVars` extension | ✓ VERIFIED | All 6 packs define all 14 new aliases with inline WCAG comments; `resolveVars` emits all 14 new CSS-var lines |
| `packages/genui/src/theme/__tests__/packs.test.ts` | Contrast gate + registration gate | ✓ VERIFIED | Both describe blocks present and passing (103/103 theme tests green, live-run confirmed) |
| `apps/web/src/app/globals.css` | New `:root`/`.dark` vars + `.touch-target` + breakpoint note | ✓ VERIFIED | All vars present in both blocks; utility + comment present |
| `packages/tailwind-config/base.ts` | `success`/`tier`/`graph` color groups | ✓ VERIFIED | All 3 groups present in the `primary` idiom |
| `packages/tailwind-config/web.ts` | `borderRadius.pill` | ✓ VERIFIED | `pill: "var(--radius-pill)"` present |
| `apps/web/tailwind.config.ts` | `fontFamily.code` | ✓ VERIFIED | Present |
| `apps/web/src/components/provenance-link.tsx` | `rounded-pill` chip | ✓ VERIFIED | Confirmed |
| `apps/web/src/app/chat/_components/markdown-renderer.tsx` | `font-code` | ✓ VERIFIED | Confirmed (inline `Code` + `Pre`) |
| `apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx` | `success`-token confirm affordance | ✓ VERIFIED | Confirmed; DENY untouched |
| `apps/web/src/app/knowledge/_components/graph-nodes.tsx` | Graph-palette node chrome, var-based glow | ✓ VERIFIED | Confirmed, zero raw hex/HSL literal |
| `apps/web/src/app/knowledge/_components/tier-edge-style.ts` | Tier-token edge encoding | ✓ VERIFIED | Confirmed, test suite green |
| `docs/design/hover-active-convention.md` | Hover/active rule + examples | ✓ VERIFIED | Substantive (111 lines), no stub markers |
| `docs/design/breakpoint-decision.md` | Breakpoint decision, TOKN-07 | ✓ VERIFIED | Substantive (104 lines), answers all 3 required questions |
| `apps/web/src/app/studio/_components/studio-tabs.tsx` | Pill-shaped tab chrome (implied by ROADMAP SC1) | ✗ NOT CONVERTED | Remains `rounded-none border-b-2` — see Gaps |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tokens.ts TOKEN_ALIASES` | `packs.test.ts` completeness/registration loops | tuple iteration | ✓ WIRED | Confirmed live-run, 103/103 pass |
| `globals.css :root` vars | `tailwind-config/base.ts`+`web.ts` utilities | `hsl(var(--success))` / `var(--radius-pill)` / `var(--font-code)` | ✓ WIRED | Confirmed by direct read of both files |
| `provenance-link.tsx CHIP_CLASS_NAME` | `rounded-pill` utility | className token | ✓ WIRED | Confirmed |
| success visuals (3 files) | `bg-success` utility | className token replacing bg-green/emerald | ✓ WIRED | Confirmed, grep-zero |
| `graph-nodes.tsx`+`filter-rail.tsx`+`node-detail-pane.tsx` | `color.graph.*` palette | `bg-graph-*`/`border-graph-*`/`text-graph-*` | ✓ WIRED | Confirmed identical across all 3 surfaces |
| `tier-edge-style.ts`+`graph-legend.tsx` (auto) | `color.tier.*` ladder | `hsl(var(--tier-*))` | ✓ WIRED | Confirmed, test suite green |
| `breakpoint-decision.md` | `.touch-target` utility + md convention (48-01) | documented mechanism reference | ✓ WIRED | Confirmed by content read |
| `hover-active-convention.md` | resting aliases (accent/success/tier) | derivation recipe | ✓ WIRED | Confirmed by content read |
| ROADMAP SC1 "tab pills in studio chrome" | `radius.pill` utility | className token | ✗ NOT WIRED | `studio-tabs.tsx` never edited to reference `rounded-pill` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| genui theme test suite passes | `cd packages/genui && npx vitest run src/theme` | 103/103 tests pass (3 files) | ✓ PASS |
| genui typecheck clean | `npm run typecheck -w @polytoken/genui` | Clean, no errors | ✓ PASS |
| web typecheck reproduces only the pre-existing deferred issue | `npm run typecheck -w @polytoken/web` | ~50 errors, ALL in `apps/web/src/app/dev/design/` (stale `@nauta/ui/*` imports, untracked scratch dir) — none reference any phase-48 identifier (`success`, `radius-pill`, `font-code`, `tier-`, `graph-`) | ✓ PASS (matches `deferred-items.md` exactly) |
| tier-edge-style + provenance-link web tests pass | `cd apps/web && npx vitest run src/app/knowledge/_components/tier-edge-style.test.ts src/components/provenance-link.test.tsx` | 10/10 tests pass | ✓ PASS |
| Zero raw hex / palette-color leaks in knowledge components | `grep -RIno "violet-\|amber-\|bg-slate-\|border-slate-\|text-slate-\|hsl(164"` over graph-nodes/filter-rail/node-detail-pane | zero matches | ✓ PASS |
| Zero green/emerald/lime leaks in success files | `grep -RIno "bg-green-\|emerald-\|bg-lime-"` over the 3 success files | zero matches | ✓ PASS |
| Studio tabs are NOT pill-shaped (falsifying the roadmap claim) | `grep -n "rounded" apps/web/src/app/studio/_components/studio-tabs.tsx` | `rounded-none border-b-2` on every TabsTrigger | ✗ FAIL (confirms the gap) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| TOKN-01 | 48-01, 48-03 | `radius.pill` alias + chip/tab/pill consumption | ⚠️ PARTIALLY SATISFIED | Alias + citation-chip consumption fully verified; "tab pills in studio chrome" NOT converted (studio tabs remain underline-style). REQUIREMENTS.md marks this `[x] Complete` — that claim is not fully accurate per codebase evidence. |
| TOKN-02 | 48-01, 48-03 | `color.success`/`successForeground` + destructive pairing | ✓ SATISFIED | Verified in full (tokens, packs, WCAG gate, 3 consumer files) |
| TOKN-03 | 48-01, 48-03 | `typography.code.family` + brutalist migration | ✓ SATISFIED | Verified in full |
| TOKN-04 | 48-02, 48-04 | Tier-ladder tokens, no overload of accent/muted | ✓ SATISFIED | Verified in full |
| TOKN-05 | 48-02, 48-04 | Closed graph palette, zero raw hex, canvas consumption | ✓ SATISFIED | Verified in full (scoped correctly to the /knowledge canvas's actual raw-color leak — the chat canvas's own node types were already token-driven with no leak to fix) |
| TOKN-06 | 48-05 | Hover/active convention documented once, applied consistently | ✓ SATISFIED | Doc exists with worked examples from this phase's actual shipped surfaces |
| TOKN-07 | 48-01, 48-05 | Breakpoint-awareness decision + minimal mechanism | ✓ SATISFIED | Doc + mechanism (`.touch-target`, `md` convention) both verified |

No orphaned requirements — all 7 TOKN-* IDs from REQUIREMENTS.md appear in at least one plan's `requirements` frontmatter field.

### Anti-Patterns Found

None. Scanned all 20 files modified across the 5 plans (tokens.ts, packs.ts, packs.test.ts, globals.css, both tailwind configs, provenance-link.tsx, markdown-renderer.tsx, json-pane.tsx, the 3 success-token files, the 5 knowledge-canvas files, and both new design docs) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"coming soon"/"not yet implemented" — zero matches in any file.

### Human Verification Required

### 1. Live-browser confirmation of chip/success surfaces

**Test:** Load `/chat` and `/emails/[id]` with a live Supabase session; visually confirm the citation chip renders a true pill and the confirmed-good visuals render the success-token green (deny/stop stays destructive-red).
**Expected:** Pill-shaped chip; legible WCAG-AA green distinct from destructive red; no visual regression.
**Why human:** Both surfaces sit behind auth middleware; OAuth remains user-gated in this environment (`GOOGLE-OAUTH-RUNBOOK.md` not yet completed). Only textual before/after diff artifacts exist (`.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md`).

### 2. Live-browser confirmation of knowledge-canvas graph/tier surfaces

**Test:** Load `/knowledge` with a live session; visually confirm node chrome, filter dots, detail badges use the closed graph palette, and tier edges/legend/filter use the tier ladder (not React Flow's default gray, not the old violet/amber/slate).
**Expected:** Visually distinct node categories; EXTRACTED edges show an explicit tier-extracted stroke; INFERRED/AMBIGUOUS show the dashed/faint tier-inferred stroke.
**Why human:** Same OAuth-gated blocker. Only a textual artifact exists (`.planning/ui-reviews/2026-07-10T21-05-50.831Z/index.md`).

### Gaps Summary

One genuine gap: the ROADMAP.md Success Criterion 1 (and REQUIREMENTS.md's TOKN-01 line, marked `[x] Complete`) literally claims `radius.pill` is consumed at "citation chips, follow-up chips, and tab pills" so that all three "render true pill shapes." Two of three hold (citation chip + the chat-canvas edge label, which the executor found and converted as a bonus). The third — tab pills in studio chrome — does not: `studio-tabs.tsx` remains underline-style (`rounded-none border-b-2`), and the shared `@polytoken/ui` Tabs primitive is `rounded-lg`/`rounded-md`, never a pill.

This was not a silent miss — 48-03-PLAN's own `<constraints>` section documents that studio tabs were inspected and found to be underline-style by design, and explicitly instructs the executor not to force them into pills, invoking the D-48-01 discretion clause. That is a defensible design call (forcing an established underline-tab identity into a pill shape without a broader design review could be a regression, not an improvement). But it means the literal ROADMAP/REQUIREMENTS claim is currently false, and no formal override was recorded to reconcile that.

**This looks intentional.** To accept this deviation, add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "radius.pill consumed at tab pills in studio chrome (ROADMAP SC1 / TOKN-01)"
    reason: "Studio tabs are an established underline-style identity (Phase 16-04/D-21); forcing them into a pill shape was judged out of scope for a token-primitives phase and belongs in Phase 49's total re-skin if still desired. No genuine 'tab pill' component exists anywhere in the app to convert."
    accepted_by: "<human>"
    accepted_at: "<ISO timestamp>"
```

Alternatively, route this to Phase 49 (which already re-skins `/studio` per its Success Criterion 4) or send back to `/gsd:plan-phase --gaps` if a pill-tab treatment is wanted now.

**RESOLUTION (2026-07-10, orchestrator):** Override accepted (see frontmatter) under the v1.8 autonomous mandate; ROADMAP SC1/SC2 and REQUIREMENTS TOKN-01/TOKN-05 wording amended to match delivered reality. An independent adversarial audit (second agent, same day) corroborated: no pill-shaped tab exists anywhere in the codebase, and the delivered graph palette correctly targeted the `/knowledge` canvas's real raw-color leak (the requirement's "(email/chat/knowledge/artifact)" category list was dossier boilerplate that never matched this codebase). The audit's two code-level findings outside phase scope — `apps/web/src/app/_components/entity-chips.tsx` (raw violet hardcodes on the inbox's entity chips, missed because 48-03's chip search was grep-scoped to `/chat`) and `apps/web/src/app/entities/[id]/_components/entity-detail.tsx` `StatusBadge` (raw amber hardcodes on the same confidence-tier semantic) — are parked as backlog 999.16 for Phase 49's zero-raw-hex re-skin. The audit's third finding (stale TierFilterControl worked example in `docs/design/hover-active-convention.md` §2c, a wave-ordering artifact) was fixed directly.

Everything else in the phase is solid: all 14 remaining truths verified against live code and live test runs (not SUMMARY narration) — 103/103 genui theme tests pass, 10/10 targeted web tests pass, zero raw hex/palette-color leaks, zero debt markers, the pre-existing `apps/web` typecheck failure is confirmed unrelated and already documented, and both design-convention docs are substantive with worked examples grounded in this phase's own shipped code.

---

*Verified: 2026-07-10*
*Verifier: Claude (gsd-verifier)*
