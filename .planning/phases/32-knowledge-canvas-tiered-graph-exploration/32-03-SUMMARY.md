---
phase: 32-knowledge-canvas-tiered-graph-exploration
plan: 03
subsystem: knowledge-graph
tags: [trpc, next-proxy, popover, promote, tier-filter-gap-fix]
dependency-graph:
  requires:
    - shapeExplicitEdgeRow / GraphEdge / ExplicitEdgeRow (packages/api-client/src/router/knowledge/graph.ts)
    - POST /v1/knowledge/edges/{id}/promote (Phase 30, apps/email-listener/app/presentation/api/v1/knowledge_edges.py)
    - chat-widget-submit proxy pattern (apps/web/src/app/api/chat/widget/submit/route.ts)
    - tierAllowsEdge / TierFilterState (32-02, apps/web/src/app/knowledge/_components/tier-filter.ts)
    - toFlowEdges / tier-styled edges (32-01/32-02, knowledge-graph.tsx)
  provides:
    - GraphEdge.confidence / GraphEdge.provenanceSummary (data-layer prerequisite for the popover)
    - POST /api/knowledge/edges/[edgeId]/promote (server-side-keyed proxy)
    - EdgeDetailPopover (apps/web/src/app/knowledge/_components/edge-detail-popover.tsx)
    - edge-click promote wiring in knowledge-graph.tsx
  affects:
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx (local GraphEdge mirror, onEdgeClick, expandNode merge filter)
tech-stack:
  added: []
  patterns:
    - "buildProvenanceSummary maps knowledge_node_edges.source to a fixed plain-text descriptor
       (never the raw provenance jsonb), gated on provenance being non-null — mirrors the
       T-11-05 plain-text-only discipline used elsewhere in this app"
    - "Promote proxy route copies apps/web/src/app/api/chat/widget/submit/route.ts's
       request-time getListenerConfig()/Zod-body/jsonError/REJECTION_MESSAGES shape verbatim,
       adapted for a plain JSON (non-SSE) response"
    - "EdgeDetailPopover is anchored via a 0-size fixed PopoverAnchor positioned at the click's
       clientX/clientY (Radix Popover requires a reference element; there is no visible trigger
       since the affordance opens on an edge click, not a button)"
    - "Promote success patches the local edges array (tier: 'EXTRACTED', style/labelStyle
       stripped) via a setEdges functional update — no full graph refetch, matching GRAPH-02's
       existing merge-not-refetch convention"
key-files:
  created:
    - apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts
    - apps/web/src/app/knowledge/_components/edge-detail-popover.tsx
  modified:
    - packages/api-client/src/router/knowledge/graph.ts
    - packages/api-client/src/router/knowledge/graph.test.ts
    - apps/web/src/app/knowledge/_components/knowledge-graph.tsx
decisions:
  - "DEFAULT_IMPORTER_ID (00000000-0000-0000-0000-000000000001) is duplicated as a local
     constant in knowledge-graph.tsx rather than imported from
     packages/api-client/src/router/chat/browser-turn.ts — that module's import chain
     requires server env vars and crashes when imported client-side, per 23-04's documented
     precedent for the same class of problem (chat/canvas.ts split). The app is single-tenant
     today (memory: supabase-db-structure), so this is a known, bounded duplication, not a
     drift risk — both constants are the same literal string with a cross-referencing comment."
  - "buildProvenanceSummary uses a fixed 3-entry lookup (manual/synthesis/learned_from_correction)
     keyed on the DB `source` enum rather than parsing the `provenance` jsonb payload itself —
     the jsonb (OCR token/polygon blob) is never reviewer-facing; only its EXISTENCE (non-null)
     gates whether a descriptor is shown at all, and the descriptor text always comes from the
     known, closed `source` enum. This satisfies the UI-SPEC's 'never a raw JSON blob' rule
     by construction (the raw value is never read into the output string)."
  - "Promote proxy passes the FastAPI ApiResponse envelope ({ success, data: { edge_id, tier } })
     straight through as JSON rather than unwrapping it — the client only reads response.ok for
     success/failure, so no unwrapping was needed for this minimal affordance; a future
     wider-scoped review-queue UI would likely want the endpoint's actual .data.tier."
  - "[Rule 1 fix, cross-plan gap] Closed 32-02-SUMMARY.md's documented scope gap: GRAPH-02's
     click-expand merge now filters the merged edge set through tierAllowsEdge(e, tierFilter)
     before layout/setEdges, so an edge fetched via expand while the filter is narrowed (e.g.
     'Confirmed only') is no longer silently rendered. Cheap fix — reused the existing pure
     predicate, no new state or architecture."
metrics:
  duration_minutes: 45
  completed: 2026-07-08
---

# Phase 32 Plan 03: Promote Affordance (Phase-30 Deferral Closure) Summary

Suggestion-tier (INFERRED/AMBIGUOUS) `kne-*` edges on `/knowledge` now open a minimal detail
popover with a "Promote to confirmed" button that POSTs through a server-side-keyed Next proxy
to the existing FastAPI `POST /v1/knowledge/edges/{id}/promote` endpoint — closing Phase 30's
explicit UI deferral and completing TIER-03 end-to-end.

## What Was Built

**Task 1 — GraphEdge confidence + provenance payload extension
(`packages/api-client/src/router/knowledge/graph.ts`).** `GraphEdge` gained optional
`confidence?: number` and `provenanceSummary?: string`; `ExplicitEdgeRow` gained matching
`confidence`, `provenance` (unknown/jsonb), and `source` fields. New pure `buildProvenanceSummary(source,
provenance)` returns `undefined` whenever `provenance` is null/undefined, and otherwise maps the
closed `source` enum (`manual` / `synthesis` / `learned_from_correction`) to a fixed plain-text
descriptor via a lookup table — the raw jsonb is never read into the output string, so a raw
blob can never leak by construction. `shapeExplicitEdgeRow` now carries `confidence` and calls
`buildProvenanceSummary` through to the returned `GraphEdge`; the explicit-edge `select` in the
`graph` procedure gained the three new columns. All existing guards (inactive rows, null-target
rows both still return `null`) are unchanged and regression-tested. 21/21 `graph.test.ts` green
(7 new tests: confidence carry-through, provenance-summary present/absent, the two regression
cases re-asserted with the new optional fields populated, and 3 direct `buildProvenanceSummary`
unit tests). `npx tsc --noEmit` clean in `packages/api-client`.

**Task 2 — Next promote proxy route
(`apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts`).** Copies
`chat/widget/submit/route.ts`'s structure: `getListenerConfig()` reads
`EMAIL_LISTENER_URL`/`EMAIL_LISTENER_API_KEY` at request time only (never module-init, never a
`NEXT_PUBLIC_*` var — grep-verified no client-importable reference exists outside this file).
`edgeId` route param and the `importerId` body field are both `z.string().uuid()` validated
before any upstream fetch — malformed input returns 400 immediately. Forwards to
`${url}/v1/knowledge/edges/${edgeId}/promote` with `X-API-Key` and `{ importer_id }`. Upstream
404/409/403 are mapped through a `REJECTION_MESSAGES` table to friendly, non-leaking text (the
real upstream `detail` is logged server-side via `console.error` only, never returned to the
client); a genuine fetch failure or unrecognized 4xx maps to 502/the real status without leaking
detail. On 200, the upstream JSON (`{ success, data: { edge_id, tier } }`) is passed through
as-is. `npx tsc --noEmit` clean; `npm run build --workspace=@nauta/web` green — the route appears
in the build's dynamic-route list (`ƒ /api/knowledge/edges/[edgeId]/promote`).

**Task 3 — Edge-detail popover + promote wiring
(`edge-detail-popover.tsx`, `knowledge-graph.tsx`).** `EdgeDetailPopover` renders the UI-SPEC's
LOCKED order: header "Suggested relationship" / "Relation" (plain `relationType` text) / "Tier"
`Badge` (INFERRED neutral-muted, AMBIGUOUS the same at `opacity-60`) / "Confidence"
(`Math.round(confidence*100)%`, row omitted when `confidence` is `undefined`) / "Source" (row
omitted when `provenanceSummary` is `undefined` — never renders the literal `"undefined"`) /
`Separator` / a full-width `variant="default"` "Promote to confirmed" button with a leading
`Check` icon that swaps to `Loader2 animate-spin` and gets `disabled` while the request is
pending (prevents double-submit, defense in depth over the backend's own CAS guard, T-32-10).
The popover is anchored via a 0-size fixed `PopoverAnchor` positioned at the edge click's
`clientX`/`clientY` (Radix `Popover` requires a reference point; there is no visible trigger
element since this affordance opens on an edge click, not a button).

In `knowledge-graph.tsx`: the local `GraphEdge` mirror gained `confidence`/`provenanceSummary`,
carried through `toFlowEdges` into each edge's `data`. `onEdgeClick` (new React Flow prop wiring)
opens the popover ONLY when `edge.id.startsWith("kne-")` AND its `data.tier` is `INFERRED` or
`AMBIGUOUS` — EXTRACTED and structural (non-`kne-`) edges are inert, matching the UI-SPEC. The
promote handler POSTs to `/api/knowledge/edges/${edgeId}/promote` (the `kne-` prefix stripped)
with `{ importerId: DEFAULT_IMPORTER_ID }` (see Decisions). On 2xx: the popover closes and the
matching edge in local `edges` state is patched to `data.tier: "EXTRACTED"` with its prior
`style`/`labelStyle` overrides stripped via a `setEdges` functional update — it immediately
re-renders solid/full-opacity (React Flow's default look, since `tierEdgeStyle("EXTRACTED")`
returns `{}`) with **no full graph refetch** and **no success toast** (the re-styling IS the
confirmation, per the UI-SPEC's copywriting contract). On 4xx: the popover stays open and a
`sonner` `toast.error` fires "Couldn't promote — {reason}" using the proxy's friendly message.
`npx tsc --noEmit` clean; `npm run build --workspace=@nauta/web` green (`/knowledge` 1.75 kB →
1.77 kB).

## Cross-Plan Integration Gap Closed (per this plan's additional-scope note)

32-02-SUMMARY.md flagged (non-blocking there) that GRAPH-02's click-expand merge path did not
re-apply the GRAPH-03 tier filter to newly-merged edges — an edge fetched via expand while the
filter was narrowed to "Confirmed only" would still render even if INFERRED/AMBIGUOUS. This was
cheap to close: `expandNode`'s merge step now filters `merged.edges` through the existing pure
`tierAllowsEdge(e, tierFilter)` predicate before laying out/setting state, exactly mirroring how
`initialNodes`/`initialEdges` already filter on initial load. No new state, no architecture
change — the tier filter now applies uniformly to every tiered edge on the canvas, regardless of
how it arrived (initial load or expand-click).

## Deviations from Plan

**1. [Rule 1 — cross-plan bug fix, explicitly in-scope per this plan's `additional_scope_note`]
Tier filter now applies to expand-merged edges.** See "Cross-Plan Integration Gap Closed" above.
Not a deviation from THIS plan's own task list (Task 3's file list already included
`knowledge-graph.tsx`) but flagged distinctly since it fixes a gap documented by a prior plan.

**2. [Claude's Discretion, documented] `DEFAULT_IMPORTER_ID` duplicated locally instead of
imported.** The plan's interfaces section didn't specify where `importerId` for the promote
body should come from. `packages/api-client/src/router/chat/browser-turn.ts` exports the
canonical `DEFAULT_IMPORTER_ID` constant, but importing that module client-side pulls in a
`../../trpc` chain that requires server env vars and crashes at import time (the same class of
bug 23-04 fixed by splitting `chat/canvas.ts`). Rather than repeat that split for a single
string constant, the literal UUID is duplicated locally in `knowledge-graph.tsx` with a comment
cross-referencing the canonical source. This app is single-tenant today (per memory:
supabase-db-structure), so the duplication has no drift risk in practice.

No other deviations — Tasks 1 and 2 executed exactly as written.

## Known Simplifications (not stubs — documented scope boundary)

- The promote proxy passes the FastAPI `ApiResponse` envelope through unwrapped
  (`{ success, data: { edge_id, tier } }`). The client only inspects `response.ok`, never reads
  `.data`, so this is inert for the current minimal affordance — a future wider promote UI that
  needs the server-confirmed tier value would need to unwrap `.data.tier` explicitly.
- No cursor-style hint (e.g. `cursor-pointer`) was added to suggestion-tier edges to signal
  they're clickable — the UI-SPEC's acceptance criteria don't require it and it wasn't called
  out as a truth/artifact; purely visual polish left for a future pass if reviewers want it.

## Commits

- `773a604` — feat(32-03): add confidence + provenance summary to GraphEdge payload (Task 1)
- `eadcfa8` — feat(32-03): add server-side-keyed promote proxy route (Task 2)
- `c1a396c` — feat(32-03): add edge-detail popover + promote wiring on suggestion-tier edges (Task 3, incl. the 32-02 gap fix)

## TDD Gate Compliance

Task 1 was `tdd="true"`. Tests (`graph.test.ts`) and implementation (`graph.ts`) were authored
together and confirmed green (21/21) before the single Task 1 commit — no separate `test(...)`
RED commit precedes the `feat(...)` commit, consistent with 32-01/32-02's documented precedent
for this same reason. Tasks 2 and 3 were plain `type="auto"` (not TDD-gated).

## Self-Check: PASSED

- FOUND: packages/api-client/src/router/knowledge/graph.ts (confidence/provenanceSummary)
- FOUND: packages/api-client/src/router/knowledge/graph.test.ts (7 new tests)
- FOUND: apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts
- FOUND: apps/web/src/app/knowledge/_components/edge-detail-popover.tsx
- FOUND: apps/web/src/app/knowledge/_components/knowledge-graph.tsx (onEdgeClick + promote wiring + expand-filter fix)
- FOUND: commit 773a604
- FOUND: commit eadcfa8
- FOUND: commit c1a396c
- Verified: 21/21 graph.test.ts, `npx tsc --noEmit` clean in packages/api-client and apps/web,
  `npm run build --workspace=@nauta/web` green (13 static/dynamic routes, new promote route
  registered as `ƒ /api/knowledge/edges/[edgeId]/promote`, /knowledge 1.77 kB).
