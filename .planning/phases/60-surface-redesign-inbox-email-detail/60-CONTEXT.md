# Phase 60: Surface Redesign — Inbox & Email Detail — Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated — the design contract + a rendered reference already exist

<domain>
## Phase Boundary

Redesign the inbox (three-pane desktop, thread groups, mobile feed) and email detail
(`/emails/[id]`, region overlays) ON the locked identity — layout, hierarchy, information density,
interactions. **Not a re-token.** Phase 51 (v1.9) already did class→token conversion and the user's
verdict was still "ugly/experimental, not a production UI" — repeating that is this phase's
failure mode.

OUT: chat/canvas (61), knowledge/studio/settings/login (62), research-canvas visuals (63).
</domain>

<decisions>
## Implementation Decisions

**The identity is locked — no grey areas about look. The design decisions are made.**

THE CONTRACT: `.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md` (D-58-01).
Three laws, non-negotiable:
1. **Colour is earned, never decorative.** Chrome is monochrome. Only verdigris (confirmed),
   pencil-amber (suggested), madder (irreversible/destructive) carry hue. Buttons, links, nav,
   selection, focus rings are INK. Enforced by `apps/web/src/app/__tests__/colour-law.test.ts`.
2. **Chrome speaks sans, evidence speaks serif.** Content from the user's own mail renders serif.
   No exceptions.
3. **Entity type is shape, never hue** (square/circle/diamond/triangle/hollow).

THE RENDERED REFERENCE: `.planning/phases/58-visual-identity-sketch-pick-human-gate/sketches/direction-final.html`
**already contains a designed inbox three-pane and email reading pane in this exact identity**,
both themes. Screenshots: `preview-final-light.png`, `preview-final-dark.png`,
`preview-final-1024.png`. Read the sketch's markup/CSS for the intended layout, hierarchy, and
density — it is the visual target. It is a SKETCH (static HTML, no real components); the job is to
realize its design in the real React surfaces, not to copy its DOM.

Phase 59 shipped the system this consumes: the 12-token ladder (every shadcn semantic token now
resolves to it), `--text-2xs..xl`, `--font-serif`, 9 `--spacing-*` steps, `--radius-card`/
`--radius-frame`, and the reusable utilities `pmark` / `pmark-confirmed` / `pmark-suggested` /
`tshape` (+5 variants) / `tabular`. **Consume these — do not reinvent them.** If a surface needs
something the system lacks, add it to the system, not to the component.

Claude's discretion: which components get restructured vs. restyled, and the exact layout mechanics
— but density/hierarchy must be a deliberate designed choice traceable to the reference, never an
inherited default.
</decisions>

<code_context>
## Existing Code Insights

- Inbox: `apps/web/src/app/_components/inbox-three-pane.tsx` (CSS-dual-tree since 53-03: a desktop
  `ResizablePanelGroup` wrapped `hidden md:block` + a `flex md:hidden` mobile single-pane
  master→detail stack), `inbox-row.tsx`, `inbox-thread-group.tsx`, `entity-chips.tsx`.
- Email detail: `apps/web/src/app/emails/[id]/`, region overlays (`region-overlay-box.tsx` — its 17
  role-coding occurrences were moved onto `color.graph.*` in 51-02; law 3 now says entity TYPE
  must be shape, not hue — expect real work here).
- `extraction-summary-panel.tsx` has `candidate: "bg-graph-email-component"` — a surface using a
  node-TYPE hue to mean a TIER. Law 3 + law 1 both bear on it; the Phase-59 planner flagged it.
- Regression rails: the 16-surface screenshot harness (`npm run screenshot:review`, needs Docker/
  local stack), `palette-ban.test.ts`, `colour-law.test.ts`, `token-contrast.test.ts`,
  `token-registration.test.ts`. Baseline after 59: 65 files / 730 tests green.
- Mobile: `useIsMobileViewport()` (`matchMedia(max-width:767px)`), `pointer-coarse:` touch targets
  (≥44px), canvas islands never mount below `md`.
- Known pre-existing, NOT this phase's to fix: the sidebar pointer-events E2E interception bug
  (backlog 999.21) and a `packages/genui` artifacts.test.ts hash drift.
</code_context>

<specifics>
## Specific Ideas

Success criterion 1 demands the inbox "visibly differ in layout, hierarchy, and density from the
pre-Phase-59 version, not just in color" — that is the whole point of this milestone. Make it
verifiable: a screenshot diff or a structural assertion, not an opinion.

The reference sketch's inbox is a registry: tabular alignment, ruled section starts, calm rhythm,
provenance marks on every extracted fact, serif for the actual email body, tabular numerals for
amounts/dates.

`/emails/[id]`'s document-preview + entity-region interaction must improve in hierarchy and density
— region overlays are where provenance is most literal (they ARE the OCR polygons the provenance
mark is derived from). This is the surface where the identity should feel most inevitable.
</specifics>

<deferred>
## Deferred Ideas

- Chat/canvas (61), knowledge/studio/settings/login (62), research-canvas visuals (63).
- D-58-03 (entity-type-as-shape) is the one user-unblessed law. If realizing it here makes a
  concrete cost visible, document it — do not silently reverse it.
- 999.21 sidebar pointer-events bug — opportunistic only.
</deferred>
