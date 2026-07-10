# Screenshot review — 2026-07-10T21-05-50.831Z (Phase 48 Plan 04, D-48-08)

## Why this is a textual artifact, not PNGs

The Phase-47 `screenshot:review` harness (`apps/web/e2e/screenshot-review.spec.ts`)
captures `/knowledge` as one of its six surfaces, but that surface is behind the
auth middleware. Per the same-run 47-05 artifact
(`.planning/ui-reviews/2026-07-10T18-39-30-080Z/index.md`) and the 48-03 artifact
(`.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md`), every protected route
redirects to `/login` with no session in this environment — OAuth remains
user-gated per `STATE.md` Deferred Items ("OAuth/deploys/domain still hard-parked").
Re-running the harness in this window would only re-confirm the same
`redirected to /login (no session)` result already twice on record; it would not
render the node chrome or tier encoding this plan touched. Standing up a live
session to force it would mean touching `supabase/`/auth config, explicitly out
of scope, and this plan also runs in a concurrent wave-2 window alongside other
plans, so starting a competing local dev server on :3000 is avoided.

Per the plan's own fallback instruction (D-48-08 / 48-04-PLAN.md Task 3 /
executor's `important_project_notes`, following the 48-03 precedent exactly),
this artifact documents the before/after via the actual committed diffs — the
exact source of visual truth for a pure className-swap change (no new markup,
no new components, no layout change).

## Before/after 1 — Node chrome: violet/amber/slate -> the closed graph palette (Task 1, `200c1bd`)

**File:** `apps/web/src/app/knowledge/_components/graph-nodes.tsx`

```diff
- className={nodeClasses("bg-violet-500/10 border-violet-500/40", selected)}
+ className={nodeClasses("bg-graph-entity/10 border-graph-entity/40", selected)}
  ...
- <Box className="size-4 shrink-0 text-violet-500" aria-hidden />
+ <Box className="size-4 shrink-0 text-graph-entity" aria-hidden />

- className={nodeClasses("bg-amber-500/10 border-amber-500/40", selected)}
+ className={nodeClasses("bg-graph-email-component/10 border-graph-email-component/40", selected)}
  ...
- <Layers className="size-3 shrink-0 text-amber-500" aria-hidden />
+ <Layers className="size-3 shrink-0 text-graph-email-component" aria-hidden />

- className={nodeClasses(
-   "bg-slate-100/60 border-slate-400/40 dark:bg-slate-800/40 dark:border-slate-600/40",
-   selected,
- )}
+ className={nodeClasses(
+   "bg-graph-email/10 border-graph-email/40",
+   selected,
+ )}
  ...
- <Mail className="size-4 shrink-0 text-slate-500" aria-hidden />
+ <Mail className="size-4 shrink-0 text-graph-email" aria-hidden />

- className={`${nodeClasses("bg-primary/15 border-primary/60", selected)} shadow-[0_0_8px_hsl(164_39%_22%/0.25)]`}
+ className={`${nodeClasses("bg-primary/15 border-primary/60", selected)} shadow-[0_0_8px_hsl(var(--primary)/0.25)]`}
```

**Visual delta:** `color.graph.*`'s `polytoken-teal` pack values were computationally
tuned in 48-02 to match the Tailwind stock shades almost exactly — `graph-entity`
`262 83% 58%` (identical hue/lightness to `violet-500`), `graph-email-component`
`38 92% 50%` (identical to `amber-500`), `graph-email` `215 20% 65%` (a cooler-gray
analog of `slate-400`, single light-mode value that now ALSO flips correctly in
`.dark` via the CSS var, where the old `slate-100/60` + hand-written `dark:` override
only approximated it). So the default `polytoken-teal` pack renders visually
near-identical to before — the real change is architectural: every node's color
now resolves through a single closed `color.graph.*` alias family (documented
anti-drift comment in `tokens.ts`) that also participates in style-pack switching
and dark mode automatically, where the previous hardcoded Tailwind classes did
not. The `knowledge_node`'s glow shadow changed from a raw HSL literal
(`hsl(164 39% 22%)`, hand-copied from `--primary`'s value) to a live var reference
(`hsl(var(--primary))`) — same rendered color today, but now tracks `--primary`
if it's ever retuned instead of silently drifting.

## Before/after 2 — Filter-rail dots + detail-pane badges mirror the same palette (Task 1, `200c1bd`)

**File:** `apps/web/src/app/knowledge/_components/filter-rail.tsx`

```diff
- dotClass: "bg-violet-500/80 border-violet-500/40",   // Instances
+ dotClass: "bg-graph-entity/80 border-graph-entity/40",
- dotClass: "bg-slate-400/80 border-slate-400/40",      // Emails
+ dotClass: "bg-graph-email/80 border-graph-email/40",
- dotClass: "bg-amber-500/80 border-amber-500/40",      // Components
+ dotClass: "bg-graph-email-component/80 border-graph-email-component/40",
```

**File:** `apps/web/src/app/knowledge/_components/node-detail-pane.tsx`

```diff
- className="bg-violet-500/10 text-violet-700 border-violet-500/30"   // Instance badge
+ className="bg-graph-entity/10 text-graph-entity border-graph-entity/30"
- className="bg-amber-500/10 text-amber-700 border-amber-500/30"      // Component badge
+ className="bg-graph-email-component/10 text-graph-email-component border-graph-email-component/30"
```

**Visual delta:** identical color story to Before/after 1 — the filter-rail color
dots (the small `size-2` circles next to each node-type checkbox) and the
node-detail-pane's type badges now source from the EXACT same three `graph.*`
aliases as the node chrome itself, closing the anti-drift gap the dossier
flagged: previously three independent hand-typed Tailwind literal sets (node
chrome / dots / badges) had to be kept in visual sync by hand; now they are
provably the same value by construction (one alias, three consumers).

## Before/after 3 — Tier edges + legend: `--muted-foreground` -> the tier ladder (Task 2, `d38577e`)

**File:** `apps/web/src/app/knowledge/_components/tier-edge-style.ts`

```diff
  if (tier === "INFERRED") {
    return {
      style: {
        strokeDasharray: "5 3",
-       stroke: "hsl(var(--muted-foreground))",
+       stroke: "hsl(var(--tier-inferred))",
      },
    };
  }

  if (tier === "AMBIGUOUS") {
    return {
      style: {
-       stroke: "hsl(var(--muted-foreground))",
+       stroke: "hsl(var(--tier-inferred))",
        opacity: 0.45,
      },
      labelStyle: { opacity: 0.6 },
    };
  }

+ if (tier === "EXTRACTED") {
+   return {
+     style: {
+       stroke: "hsl(var(--tier-extracted))",
+     },
+   };
+ }

- // EXTRACTED or undefined — no override, React Flow default (solid, full opacity).
+ // undefined — structural FK edge, no override, React Flow default (solid, full opacity).
  return {};
```

**Visual delta:** `color.tier.inferred` (`230 40% 90%` in `polytoken-teal`, a pale
indigo-violet) is a visibly DIFFERENT hue from `--muted-foreground`
(a near-neutral gray) — the INFERRED/AMBIGUOUS edges (dashed / faint) now read as
a distinct, intentional "provisional" hue rather than "this edge just looks
disabled/grayed-out", which is exactly the drift the phase's must-haves called
out ("consumes tier-ladder tokens instead of overloading color.muted-foreground").
The EXTRACTED tier — previously an empty style object relying on React Flow's
library-default stroke color (a mid-gray, `#b1b1b7`, entirely outside the design
system) — now renders `color.tier.extracted` (`178 55% 30%`, a saturated
cyan-teal): confirmed edges go from an undifferentiated library-default gray line
to a deliberate, on-brand "confirmed" color. `graph-legend.tsx`'s three swatches
(`Confirmed`/`Suggested`/`Uncertain`) inherit all three changes automatically —
no edit needed there beyond the two comment-accuracy touch-ups — since every
swatch reads its stroke live from `tierEdgeStyle`.

## Before/after 4 — Tier filter's "Confirmed" segment ties to the extracted token (Task 2, `d38577e`)

**File:** `apps/web/src/app/knowledge/_components/tier-filter-control.tsx`

```diff
  active
-   ? "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground"
+   ? "border-tier-extracted bg-tier-extracted font-semibold text-tier-extracted-foreground hover:bg-tier-extracted hover:text-tier-extracted-foreground"
    : "border-border bg-background text-muted-foreground"
```

**Visual delta:** the active "Confirmed only" segment button now fills with
`color.tier.extracted` — the SAME color as an EXTRACTED edge/legend swatch —
instead of the generic teal `--primary` used everywhere else in the app chrome.
Because `polytoken-teal`'s `--tier-extracted` (`178 55% 30%`) and `--primary`
(`164 39% 22%`) are both saturated teal-family hues at similar lightness, the
default pack shows a subtle rather than jarring shift; the meaningful change is
that "Confirmed" (the filter), the solid tier-extracted edge stroke, and the
legend's "Confirmed" swatch now all visually agree as one system, where before
the filter control borrowed the unrelated primary-brand color by coincidence.
Arrow-key navigation and `role="radiogroup"`/`role="radio"` semantics are
byte-identical (only the `className` string changed).

## Verification performed (in lieu of live-browser evidence)

- `npm run typecheck -w @polytoken/web` — clean (only the pre-existing,
  already-deferred `apps/web/src/app/dev/design/` scratch-dir errors, unrelated
  to any file this plan touches).
- `npm run test -w @polytoken/web -- src/app/knowledge/_components/tier-edge-style.test.ts`
  — 4/4 pass (updated expectations for the new tier-token stroke values,
  including the new EXTRACTED-returns-an-explicit-stroke case).
- `grep -Rino "violet-\|amber-\|bg-slate-\|border-slate-\|text-slate-\|hsl(164"` over
  `graph-nodes.tsx`, `filter-rail.tsx`, `node-detail-pane.tsx` — zero matches
  (exit 1) after the edits.
- `grep -n "muted-foreground"` over `tier-edge-style.ts` / `tier-filter-control.tsx`
  — the only remaining hits are (1) a comment explicitly documenting the
  no-longer-overloaded var, and (2) the tier-filter's INACTIVE segment text
  color, which is the correct semantic `muted-foreground` alias (unrelated to
  the tier ladder) per the plan's own instruction ("inactive stays muted").

## Gap recorded

Live-browser visual confirmation (an actual screenshot of the node chrome, the
filter dots, the detail-pane badges, and the tier-colored edges/legend
rendering in a browser) is DEFERRED pending the user completing
`GOOGLE-OAUTH-RUNBOOK.md` (unblocks a real session) — tracked in `STATE.md`
Deferred Items alongside the other OAuth-gated UAT items from Phases 43/45 and
the same gap recorded by 48-03. Once a session exists, re-run
`npm run screenshot:review -w @polytoken/web` to capture `/knowledge` for real
(it is already in the harness's `SURFACES` list — no spec change needed) and
close this gap for both 48-03 and 48-04 in one pass.
