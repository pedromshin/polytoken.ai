# Breakpoint-Awareness Decision

> Working reference doc, not marketing prose — sits alongside
> [`brand-guide.md`](./brand-guide.md) and
> [`hover-active-convention.md`](./hover-active-convention.md). Records D-48-07: the
> breakpoint-awareness decision the v1.8 design-pattern dossier flagged as "the largest
> structural gap found" (flow e) and scoped as its own design conversation, ahead of Phase 50's
> mobile-responsive canvas answer. The MINIMAL working mechanism this decision implements
> (`.touch-target` utility + the `md`-breakpoint convention comment) already shipped in
> [48-01](../../.planning/phases/48-token-system-extensions/48-01-SUMMARY.md) — this doc is the
> recorded decision, not new code.

## Why this exists

Today `spacing.density` is the only density-adjacent lever in the pack token model, and it is
**not breakpoint-scoped** — packs express one airiness value regardless of viewport. The dossier
flagged this as the milestone's largest structural gap and explicitly recommended scoping it as
its own design conversation rather than bolting on a single new alias. This doc is that
conversation, resolved.

## 1. The chosen shape (D-48-07)

**Pack tokens stay breakpoint-STATIC.** Breakpoint behavior lives in a small set of documented
layout primitives / Tailwind responsive conventions — **not** in the token dimension. Concretely:
`packages/genui/src/theme/packs.ts`'s six style packs define exactly one value per alias, full
stop; there is no `packs.mobile.ts` / `md:` variant of a token, and there will not be one. Layout
composition (what renders where, at what breakpoint) is a Tailwind-variant/component concern,
resolved above the token layer, same as any other responsive layout decision in this app.

Rationale: a per-breakpoint token dimension would double (or worse, per-pack x per-breakpoint
multiply) the token surface for a concern — viewport-driven layout — that Tailwind's existing
variant system already solves cleanly. Packs answer "what does this look like," not "where does
this appear."

## 2. The three required questions, answered

### (1) Which breakpoint switches canvas → feed?

**The Tailwind `md` breakpoint (768px) is the switch line.** Above `md`: the 2D infinite canvas
(today's `@xyflow/react` panel-as-node surface). Below `md`: a list/feed view. This is the only
breakpoint decision made in Phase 48 — it is a single fixed line, not a range or a per-surface
override. The convention is already recorded as a comment in `apps/web/src/app/globals.css`
(D-48-07, "the only breakpoint decision made in Phase 48").

### (2) How does `spacing.density` interact with small screens?

**`spacing.density` stays a single per-pack scalar (airiness) — it does not gain a
breakpoint-scoped variant.** A pack that reads as more spacious (e.g. `warm-editorial`) or
denser (e.g. `linear-clean`) keeps that same density value at every viewport; density is a
pack-identity property, not a responsive one.

What DOES protect small screens regardless of pack density: a **minimum touch-target guard**.
The `.touch-target` utility (`min-height: 44px; min-width: 44px`, WCAG 2.5.8 / Apple HIG /
Material's common floor) applies to interactive elements independent of whichever pack's density
scalar is active — even under a denser pack like `linear-clean`, an interactive control never
drops below the 44px floor. Density affects surrounding whitespace and rhythm; it never affects
whether a tap target is reachable.

### (3) What may Phase 50 add, and what may it NOT add?

**MAY add:**
- Layout primitives / Tailwind conventions that collapse canvas surfaces to an inline list/feed
  below `md` (the mobile-responsive canvas answer this decision exists to unblock).
- A density mechanism **only if genuinely needed by the feed layout itself** — e.g. tighter
  row spacing in a mobile feed list — scoped narrowly to that layout's own needs, not
  re-opening the token dimension question.

**MAY NOT add:**
- **A per-breakpoint token dimension.** This is explicitly rejected this milestone (see §1) and
  stays on the deferred list. If a future milestone finds pack-level breakpoint variance
  genuinely necessary, that is a new design conversation with its own decision record — not an
  incremental extension of this one.

## 3. Market evidence (rationale for inline-first-on-mobile)

Two data points from the v1.8 dossier's competitive research informed the canvas → feed
direction (not the exact `md`/768px line itself, which is a straightforward Tailwind default):

- **ChatGPT removed its Canvas feature from mobile on 2026-05-28**, citing cross-surface
  inconsistency between the desktop canvas and mobile experience.
- **Claude Artifacts render inline on mobile** rather than attempting a docked-panel canvas
  equivalent at small viewports.

Both point the same direction: a spatial 2D canvas is a desktop-native pattern, and the
market-validated mobile answer is inline-first (a feed/list), not a shrunk-down canvas. This is
the evidence behind choosing "canvas above `md`, feed below" rather than attempting to make the
canvas itself responsive.

## 4. Mechanism reference (already shipped, 48-01)

The minimal mechanism this decision codifies already exists in `apps/web/src/app/globals.css`:

- **`.touch-target`** (`@layer utilities`) — the 44px minimum guard described in §2(2), declared
  ahead of its first consumer so the primitive exists before Phase 50 needs it.
- **The `md`-breakpoint convention comment** — documents the 768px canvas → feed switch line
  described in §2(1), and states explicitly that pack tokens remain breakpoint-static.

Phase 50 consumes both directly; this doc is the decision record they implement, not a
duplicate of the CSS itself.

---

*Phase: 48-token-system-extensions*
*Established: 2026-07-10 (D-48-07)*
