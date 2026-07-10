---
phase: 48-token-system-extensions
plan: 04
subsystem: ui
tags: [design-tokens, tailwind, react-flow, xyflow, knowledge-canvas]

# Dependency graph
requires:
  - phase: 48-02
    provides: "color.tier.inferred/extracted (+Foreground) and color.graph.entity/emailComponent/email (+Foreground) aliases in all 6 style packs, the app-layer Tailwind bg-tier-*/bg-graph-* color groups, and CSS vars in globals.css :root/.dark"
provides:
  - "The knowledge canvas's node chrome (six xyflow node components), filter-rail color dots, and node-detail-pane badges consume the closed color.graph.* palette identically — one alias, three surfaces, zero drift"
  - "The tier edge encoding (tierEdgeStyle) + graph-legend + tier-filter-control consume the purpose-built color.tier.* ladder instead of overloading --muted-foreground; EXTRACTED now has an explicit tier-extracted stroke instead of relying on React Flow's undifferentiated library-default gray"
  - "Zero raw hex / raw HSL literal / hardcoded Tailwind palette-color classes remain anywhere in the touched knowledge components"
affects: [49-total-ui-reskin, 50-mobile-responsive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closed-palette anti-drift in practice: node chrome, filter-rail dots, and detail-pane badges all read from the SAME three graph.* aliases (graph-entity/graph-email-component/graph-email) rather than three independently hand-typed Tailwind literal sets kept in sync by convention"
    - "Tier ladder as edge color, not just badge color: tierEdgeStyle's EXTRACTED branch now returns an explicit hsl(var(--tier-extracted)) stroke (previously an empty object relying on React Flow's undifferentiated default gray) — the tier ladder now owns the FULL tri-state edge story (EXTRACTED/INFERRED/AMBIGUOUS), not just two of three states"

key-files:
  created: []
  modified:
    - apps/web/src/app/knowledge/_components/graph-nodes.tsx
    - apps/web/src/app/knowledge/_components/filter-rail.tsx
    - apps/web/src/app/knowledge/_components/node-detail-pane.tsx
    - apps/web/src/app/knowledge/_components/tier-edge-style.ts
    - apps/web/src/app/knowledge/_components/tier-edge-style.test.ts
    - apps/web/src/app/knowledge/_components/tier-filter-control.tsx
    - apps/web/src/app/knowledge/_components/graph-legend.tsx

key-decisions:
  - "EXTRACTED edges get an explicit hsl(var(--tier-extracted)) stroke rather than staying an empty style object (React Flow's undifferentiated library-default gray, #b1b1b7, entirely outside the design system) — the plan flagged this as optional; taken because the must-haves explicitly listed 'INFERRED/EXTRACTED edges' as needing to consume tier-ladder tokens, and leaving EXTRACTED unstyled would have left one of the three tiers still overloading a non-system color"
  - "tier-filter-control.tsx's active 'Confirmed only' segment now uses color.tier.extracted (border/bg/text-foreground) instead of generic color.primary — ties the filter control to the same tier system as the edges/legend it filters, since 'Confirmed' IS the EXTRACTED tier semantically"
  - "graph-legend.tsx's two inline comments were touched (not code) to describe the new tier-token strokes it inherits via tierEdgeStyle — the plan explicitly anticipated this ('if so, update graph-legend's default-swatch fallback expectation accordingly') even though the file isn't in files_modified"

requirements-completed: [TOKN-04, TOKN-05]

# Metrics
duration: ~20min
completed: 2026-07-10
---

# Phase 48 Plan 04: Knowledge Canvas Token Consumption Summary

**The xyflow knowledge canvas's node chrome, filter dots, and detail badges now render via the closed `color.graph.*` palette (entity/emailComponent/email), and the tier edge encoding + legend + filter now render via the purpose-built `color.tier.*` ladder instead of overloading `--muted-foreground` — closing the raw-color leak the v1.8 dossier flagged on the one canvas surface that still hand-typed violet/amber/slate.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3/3 completed
- **Files modified:** 7

## Accomplishments

- `graph-nodes.tsx`'s three previously hand-colored node types now source from the closed graph palette: `entity_instance` (`bg-graph-entity/10 border-graph-entity/40` + `text-graph-entity` icon, was `violet-500`), `email_component` (`bg-graph-email-component/10 border-graph-email-component/40` + icon, was `amber-500`), `email` (`bg-graph-email/10 border-graph-email/40` + icon, was `slate-100/60`/`slate-400/40` with a hand-written `dark:` override — now a single class list since the token already carries per-mode values via `globals.css`).
- `knowledge_node`'s glow shadow — a raw HSL literal `shadow-[0_0_8px_hsl(164_39%_22%/0.25)]` hand-copied from `--primary`'s value — is now a live var reference `shadow-[0_0_8px_hsl(var(--primary)/0.25)]`, so it tracks `--primary` if it's ever retuned instead of silently drifting out of sync.
- `filter-rail.tsx`'s `dotClass` map and `node-detail-pane.tsx`'s Instance/Component badges now read from the EXACT same three `graph.*` aliases as the node chrome — the anti-drift point of the closed palette (one alias, three consumers, provably in sync by construction rather than by convention).
- `tier-edge-style.ts` migrated INFERRED/AMBIGUOUS strokes off the overloaded `hsl(var(--muted-foreground))` onto `hsl(var(--tier-inferred))` (dashed/opacity encoding preserved byte-for-byte), and EXTRACTED now returns an explicit `hsl(var(--tier-extracted))` stroke instead of an empty object relying on React Flow's undifferentiated default gray — so confirmed edges now render an intentional, on-brand color rather than a library default.
- `tier-edge-style.test.ts` updated to the new expectations (4/4 passing), including a new assertion that EXTRACTED returns an explicit stroke rather than `{}`.
- `tier-filter-control.tsx`'s active "Confirmed only" segment now uses `border-tier-extracted bg-tier-extracted text-tier-extracted-foreground` instead of generic `primary` — ties the filter visually to the same tier system as the edges/legend it filters; arrow-key navigation and radiogroup semantics unchanged (className-only edit).
- `graph-legend.tsx` needed no logic change (it derives every swatch's stroke live from `tierEdgeStyle`) — its two inline comments were updated to describe the tier-token strokes now flowing through, per the plan's own anticipation of this touch.
- A before/after visual-evidence artifact (`.planning/ui-reviews/2026-07-10T21-05-50.831Z/index.md`) documents all four className/style diffs with rendered-color analysis, following the 48-03 precedent for auth-gated surfaces (textual diff evidence in lieu of a live screenshot).

## Task Commits

Each task was committed atomically:

1. **Task 1: Graph node-type palette on node chrome, filter dots, and detail badges** - `200c1bd` (feat)
2. **Task 2: Tier-ladder tokens on the tier edge encoding + filter, legend auto-follows** - `d38577e` (feat)
3. **Task 3: Before/after screenshot of the knowledge node/tier surface** - `7229c60` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/app/knowledge/_components/graph-nodes.tsx` - six xyflow node components; violet/amber/slate → graph-entity/graph-email-component/graph-email; raw HSL glow → var ref
- `apps/web/src/app/knowledge/_components/filter-rail.tsx` - `dotClass` map mirrors the same graph palette as node chrome
- `apps/web/src/app/knowledge/_components/node-detail-pane.tsx` - Instance/Component badge classes mirror the same graph palette
- `apps/web/src/app/knowledge/_components/tier-edge-style.ts` - `tierEdgeStyle()` migrated off `--muted-foreground` onto the tier ladder; EXTRACTED gains an explicit stroke
- `apps/web/src/app/knowledge/_components/tier-edge-style.test.ts` - expectations updated to tier-token stroke values + new EXTRACTED assertion
- `apps/web/src/app/knowledge/_components/tier-filter-control.tsx` - active "Confirmed" segment ties to `tier-extracted` instead of generic `primary`
- `apps/web/src/app/knowledge/_components/graph-legend.tsx` - inline comments only (no logic change), describing the inherited tier-token strokes

## Decisions Made

- EXTRACTED edges get an explicit `hsl(var(--tier-extracted))` stroke (not left as React Flow's undifferentiated default gray) — see key-decisions above for rationale.
- `tier-filter-control.tsx`'s active state ties to `color.tier.extracted`, not `color.primary` — "Confirmed" IS the EXTRACTED tier.
- `graph-legend.tsx`'s comments (not logic) were touched to stay accurate, per the plan's own anticipation of this edge case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical, plan-anticipated] EXTRACTED tier given an explicit stroke instead of staying `{}`**

- **Found during:** Task 2
- **Issue:** The plan's baseline instruction kept EXTRACTED/undefined both returning `{}` (React Flow default). But the plan's own `must_haves.truths` explicitly required "the knowledge tier encoding (INFERRED/EXTRACTED edges + legend) consumes tier-ladder tokens instead of overloading color.muted-foreground" — listing EXTRACTED by name. Leaving EXTRACTED as `{}` would mean confirmed edges kept rendering React Flow's stock gray, a color entirely outside the design system, rather than a tier-ladder token.
- **Fix:** Added an explicit `EXTRACTED` branch returning `hsl(var(--tier-extracted))` as the stroke, matching the plan's own optional escape hatch ("optionally set EXTRACTED to an explicit `hsl(var(--tier-extracted))` stroke if it reads better; if so, update graph-legend's default-swatch fallback expectation accordingly"). `undefined` (structural FK edges) still returns `{}`, correctly preserving React Flow's default look for non-tier edges.
- **Files modified:** `tier-edge-style.ts`, `tier-edge-style.test.ts`, `graph-legend.tsx` (comments only)
- **Verification:** `npm run test -w @polytoken/web -- src/app/knowledge/_components/tier-edge-style.test.ts` — 4/4 pass.
- **Committed in:** `d38577e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical, explicitly anticipated by the plan's own optional instruction)
**Impact on plan:** No scope creep — the plan's own text flagged this exact choice as optional and pre-approved; taken because the must-haves required it verbatim.

## Issues Encountered

None — both automated verify blocks (typecheck + grep gate for Task 1; typecheck + test for Task 2) passed on the first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The knowledge canvas is now fully token-driven for node-type and tier-trust differentiation — ready to be folded into Phase 49's total UI re-skin (`RSKN-03: /knowledge canvas is re-skinned — tier badges on TOKN-04 tokens, node types on TOKN-05 palette`) without further raw-color remediation on this surface.
- Live-browser visual confirmation remains deferred behind the same OAuth-gated blocker already tracked in `STATE.md` Deferred Items (unblocked once `GOOGLE-OAUTH-RUNBOOK.md` is completed) — the textual before/after artifact at `.planning/ui-reviews/2026-07-10T21-05-50.831Z/index.md` is the interim visual-truth source, consistent with 48-03's precedent.
- `apps/web/e2e/screenshot-review.spec.ts`'s `SURFACES` list already includes `/knowledge` — no harness changes are needed to close this gap once a session exists; a single `npm run screenshot:review -w @polytoken/web` run will do it.
- No new blockers introduced. The pre-existing, already-deferred `apps/web/src/app/dev/design/` scratch-dir typecheck failure (unrelated to this plan) was re-verified as unchanged and out of scope.

## Self-Check: PASSED

- FOUND: apps/web/src/app/knowledge/_components/graph-nodes.tsx
- FOUND: apps/web/src/app/knowledge/_components/filter-rail.tsx
- FOUND: apps/web/src/app/knowledge/_components/node-detail-pane.tsx
- FOUND: apps/web/src/app/knowledge/_components/tier-edge-style.ts
- FOUND: apps/web/src/app/knowledge/_components/tier-edge-style.test.ts
- FOUND: apps/web/src/app/knowledge/_components/tier-filter-control.tsx
- FOUND: apps/web/src/app/knowledge/_components/graph-legend.tsx
- FOUND: .planning/ui-reviews/2026-07-10T21-05-50.831Z/index.md
- FOUND: commit 200c1bd (feat(48-04): consume closed graph palette on knowledge node chrome)
- FOUND: commit d38577e (feat(48-04): consume tier-ladder tokens on edge encoding + filter)
- FOUND: commit 7229c60 (docs(48-04): before/after visual evidence for graph palette + tier tokens)
- No unexpected file deletions in any of the three commits (`git diff --diff-filter=D` empty for each).

---
*Phase: 48-token-system-extensions*
*Completed: 2026-07-10*
