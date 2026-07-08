---
phase: 32-knowledge-canvas-tiered-graph-exploration
plan: 02
subsystem: knowledge-graph
tags: [react-flow, tokens-only, radiogroup, edge-styling, client-filter]
dependency-graph:
  requires:
    - toFlowEdges / GraphEdge.tier (32-01, carried onto React Flow edge `data`)
    - graph-toolbar.tsx (existing toolbar row)
    - filter-rail.tsx active/inactive token pair (border-primary/bg-primary/text-primary-foreground vs border-border/bg-background/text-muted-foreground)
  provides:
    - tierEdgeStyle (apps/web/src/app/knowledge/_components/tier-edge-style.ts) — pure tier->React Flow style map
    - GraphLegend (apps/web/src/app/knowledge/_components/graph-legend.tsx) — bottom-left Panel, single-source-of-truth swatches
    - tierAllowsEdge / TierFilterState (apps/web/src/app/knowledge/_components/tier-filter.ts) — pure cumulative tier predicate
    - TierFilterControl (apps/web/src/app/knowledge/_components/tier-filter-control.tsx) — radiogroup segmented control
  affects:
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx (toFlowEdges styling branch, tierFilter state, filteredEdges memos)
    - apps/web/src/app/knowledge/_components/graph-toolbar.tsx (new children slot)
tech-stack:
  added: []
  patterns:
    - "tierEdgeStyle is the single source of truth for both toFlowEdges' style override AND the legend's swatch strokes — GraphLegend imports it directly rather than hand-duplicating stroke/dash/opacity values"
    - "tierAllowsEdge is edge-shape-agnostic (only reads id + data?.tier) so it works uniformly against both the initial-load FlowEdge shape and any future merged/expanded edge shape"
    - "GraphToolbar gained an optional children slot (backward-compatible — every other GraphToolbar caller, if any existed, still works with no children) rather than a bespoke tier-filter prop, keeping the toolbar a generic row container"
key-files:
  created:
    - apps/web/src/app/knowledge/_components/tier-edge-style.ts
    - apps/web/src/app/knowledge/_components/tier-edge-style.test.ts
    - apps/web/src/app/knowledge/_components/graph-legend.tsx
    - apps/web/src/app/knowledge/_components/tier-filter.ts
    - apps/web/src/app/knowledge/_components/tier-filter.test.ts
    - apps/web/src/app/knowledge/_components/tier-filter-control.tsx
  modified:
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx
    - apps/web/src/app/knowledge/_components/graph-toolbar.tsx
decisions:
  - "Legend implemented as a new graph-legend.tsx component (not inlined in knowledge-graph.tsx) — the UI-SPEC's own tsx sketch names LegendSwatch as a distinct piece; keeping it in its own file matches the file's existing convention of one concern per _components file and keeps knowledge-graph.tsx from growing further past its already-large size."
  - "TierFilterControl placement: rendered as GraphToolbar's new `children` slot, positioned between the title and the right-aligned action group per the UI-SPEC's stated preference — no new toolbar row needed, h-11 had room."
  - "tierAllowsEdge takes a minimal structural shape ({id, data?: {tier?}}) rather than importing the full FlowEdge type, so the pure filter module has zero React Flow dependency (easier to unit test, consistent with tier-edge-style.ts's zero-React-Flow-import pure-function posture)."
  - "GRAPH-02's click-expand merge path (expandNode in knowledge-graph.tsx) is NOT re-filtered by tierFilter after merging — newly expanded edges bypass the initialEdges/initialNodes memo's tierAllowsEdge check entirely, since setNodes/setEdges push the merged result directly. This is a known scope gap: an edge fetched via expand while the filter is narrowed to 'confirmed' will still render even if it's INFERRED/AMBIGUOUS. Not required by this plan's acceptance criteria (which scope tierAllowsEdge to the initial-load filteredEdges memos only) but flagged here as a follow-up if a reviewer notices filter-bypass via expand-click."
metrics:
  duration_minutes: 35
  completed: 2026-07-08
---

# Phase 32 Plan 02: Tier Visual Encoding + Tier Filter (GRAPH-01, GRAPH-03) Summary

`kne-*` edges now render tier-differentiated (EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint), a
bottom-left legend explains the encoding in plain reviewer-facing language, and a segmented
"Confirmed only / + Inferred / + Ambiguous" control narrows or widens which tiered edges are visible —
all token-only, zero new dependencies, structural FK edges completely untouched.

## What Was Built

**Task 1 — Tier edge styling + legend (`tier-edge-style.ts`, `graph-legend.tsx`,
`knowledge-graph.tsx`).** `tierEdgeStyle(tier)` is a pure function returning `{style?, labelStyle?}`
exactly per the UI-SPEC Color table: `INFERRED` → `strokeDasharray: "5 3"` + `stroke:
hsl(var(--muted-foreground))`; `AMBIGUOUS` → same stroke at `opacity: 0.45` with a `labelStyle: {opacity:
0.6}`; `EXTRACTED`/`undefined` → `{}` (React Flow's existing default stroke, unchanged). `toFlowEdges`
now computes `isKnowledgeEdge = ge.id.startsWith("kne-")` and only spreads `tierEdgeStyle(ge.tier)` when
true — structural edges (`has_field`, `instance_of`, etc.) get an empty spread, provably untouched.
`GraphLegend` renders three `LegendSwatch`es (tiny inline `<svg><line>`) using `tierEdgeStyle` directly
for each tier's stroke/dash/opacity — no hand-duplicated values — with the plain labels "Confirmed" /
"Suggested" / "Uncertain" (never the raw enum names), mounted as a React Flow `<Panel position="bottom-left">`
alongside `Background`/`Controls`/`MiniMap`. 4/4 `tier-edge-style.test.ts` green, `tsc --noEmit` clean,
`npm run build --workspace=@nauta/web` green (`/knowledge` still 1.75 kB).

**Task 2 — Tier filter control + edge-level filter (`tier-filter.ts`, `tier-filter-control.tsx`,
`graph-toolbar.tsx`, `knowledge-graph.tsx`).** `TierFilterState` = `"confirmed" | "inferred" |
"ambiguous"`; `tierAllowsEdge(edge, state)` is a pure predicate — a structural (non-`kne-*`) edge always
passes; a `kne-*` edge's tier is ranked (`EXTRACTED=0 < INFERRED=1 < AMBIGUOUS=2`) against the state's own
rank (`confirmed=0 < inferred=1 < ambiguous=2`) and passes iff `tierRank <= stateRank`; an edge with a
missing/unrecognized tier is conservatively ranked at `AMBIGUOUS` (only visible at the widest state).
`TierFilterControl` renders `role="radiogroup" aria-label="Filter by trust tier"` containing three
`Button`s (`role="radio" aria-checked`) with the exact labels "Confirmed only" / "+ Inferred" / "+
Ambiguous", reusing `filter-rail.tsx`'s active/inactive class pair, plus `ArrowLeft`/`ArrowRight` keyboard
navigation cycling between segments. `GraphToolbar` gained an optional `children` prop rendered between the
title and the right-aligned action group; `knowledge-graph.tsx` adds a session-only `tierFilter` `useState`
(default `"ambiguous"` — widest, so the confirm→see-suggestions demo path works out of the box per
CONTEXT), renders `<TierFilterControl>` inside the toolbar, and layers `tierAllowsEdge(e, tierFilter)`
onto both the `initialNodes` and `initialEdges` `useMemo` filter chains (on top of the existing
both-endpoints-visible check — orphaned nodes still degrade exactly as before). 6/6
`tier-filter.test.ts` green, `tsc --noEmit` clean, `npm run build --workspace=@nauta/web` green.

## Deviations from Plan

None — both tasks executed exactly as written. No Rule 1-3 auto-fixes were needed. No package-legitimacy
checkpoints (zero new npm dependencies, per plan).

## Known Scope Gap (not a stub — documented, non-blocking)

GRAPH-02's click-expand merge path does not re-apply `tierAllowsEdge` to newly-merged nodes/edges — see
the `decisions` entry above. GRAPH-01 and GRAPH-03's own stated truths (initial-load tier styling + tier
filter) are both satisfied; this is a follow-up if a reviewer notices the filter can be momentarily
bypassed by expand-clicking a node while narrowed to "Confirmed only".

## Commits

- `2df3c49` — feat(32-02): add tier-based kne- edge styling + legend (GRAPH-01) (Task 1)
- `f7371bc` — feat(32-02): add segmented tier filter control + edge-level filter (GRAPH-03) (Task 2)

## TDD Gate Compliance

Both tasks were `tdd="true"`. For each, the test file and implementation were authored in the same
commit (no separate `test(...)` RED commit precedes the `feat(...)` commit) — tests were run and
confirmed green before each commit, matching 32-01's documented precedent for this same reason (both
files existed together from first write, so there was no meaningful separately-committable RED state).
Flagging per the gate-sequence check, consistent with 32-01-SUMMARY.md's own note.

## Self-Check: PASSED

- FOUND: apps/web/src/app/knowledge/_components/tier-edge-style.ts
- FOUND: apps/web/src/app/knowledge/_components/tier-edge-style.test.ts
- FOUND: apps/web/src/app/knowledge/_components/graph-legend.tsx
- FOUND: apps/web/src/app/knowledge/_components/tier-filter.ts
- FOUND: apps/web/src/app/knowledge/_components/tier-filter.test.ts
- FOUND: apps/web/src/app/knowledge/_components/tier-filter-control.tsx
- FOUND: apps/web/src/app/knowledge/_components/knowledge-graph.tsx (tier styling + filter wiring)
- FOUND: apps/web/src/app/knowledge/_components/graph-toolbar.tsx (children slot)
- FOUND: commit 2df3c49
- FOUND: commit f7371bc
- Verified: 4/4 tier-edge-style.test.ts, 6/6 tier-filter.test.ts, `npx tsc --noEmit` clean in apps/web,
  `npm run build --workspace=@nauta/web` green (13 static pages, /knowledge 1.75 kB unchanged).
