# Product Register & Absolute Bans

> Source: impeccable.style (Apache-2.0) — https://github.com/pbakaus/impeccable. Fetched: 2026-07-06. Paraphrased, not verbatim-copied.

This appendix paraphrases impeccable.style's product-register guidance and its cross-register
absolute-bans checklist, mapped onto this repo's own `/chat` and `/studio` surfaces and existing
design contracts (60/30/10 color split, 2-weight typography, accent-allowlist). It is background
reading for future UI phases — see `27-UI-SPEC.md`'s "Design docs convention" note.

## Product Register vs. Brand/Marketing Register

impeccable.style draws a hard line between two design registers. A **brand/marketing** register is
for surfaces where design itself sells an idea — landing pages, campaigns, portfolios. A **product**
register is for surfaces that serve a task the user is already committed to — app UI, dashboards,
settings, tools. `/chat` and `/studio` are entirely product-register surfaces; nothing in this repo
is brand/marketing.

The product bar isn't "would someone guess AI made this" — it's narrower and higher: would someone
fluent in the category's best tools (Linear, Notion, Raycast, Stripe) sit down and trust this
interface without pausing at a subtly-off control? Product UI's failure mode is strangeness without
purpose — over-decorated buttons, mismatched form controls, gratuitous motion, an invented affordance
where a standard one would do. The goal is earned familiarity: the tool disappears into the task.

Mapped onto this app's own contracts:

- **Typography** — one type family, a fixed (not fluid/clamped) scale, and a tight step ratio are
  the product default. This repo already runs exactly 2 weights (`font-normal`/`font-semibold`,
  established in Phase 26) — the product register's "don't need display/body pairing" guidance is
  why that 2-weight ceiling holds for app UI.
- **Color** — product design defaults to a *Restrained* strategy: tinted neutrals plus one accent
  used at ≤10% of the surface, reserved for primary actions, current selection, and state
  indicators — never decoration. That is exactly this repo's existing 60/30/10 + accent-allowlist
  contract (`hsl(var(--primary))` reserved for state-driven signals such as `conversation-row.tsx`'s
  `isActive` treatment or ADOPT-03's generation-in-progress ring, never an at-rest flourish).
- **Components** — every interactive component needs its full state set (default, hover, focus,
  active, disabled, loading, error), skeleton states instead of mid-content spinners, and the same
  affordance used consistently across surfaces (one button shape, one form-control vocabulary, one
  icon set — this repo already standardizes on `lucide-react`).
- **Motion** — 150-250ms on most transitions, motion conveys state and nothing else, no orchestrated
  page-load choreography. This is the same ceiling ADOPT-05's transition utilities below were
  designed against.

## 13-Item Absolute Bans Checklist

Paraphrased from impeccable.style's cross-register "Absolute bans" and "Codex-specific defects"
lists (Apache-2.0), restated against this app's own vocabulary:

1. **Accent side-stripe borders.** A `border-left`/`border-right` thicker than 1px used as a
   decorative colored accent on a card, row, or callout is never intentional here. This repo already
   prefers a full border, a background tint (`bg-primary/10`), or a leading icon for accent — see
   `conversation-row.tsx`'s `isActive` recipe — never a colored stripe as pure decoration.
2. **Gradient text.** `background-clip: text` combined with a gradient fill on a heading or label is
   banned. Emphasis in this app comes from weight (`font-semibold`) or size, never a gradient
   overlay on type.
3. **Glassmorphism as default.** Blurred "frosted glass" panels used purely for aesthetic flourish
   are banned. This app's surfaces (Code-Island fixture browser, popovers, dropdowns) stay solid
   `bg-background`/`bg-popover` — blur/backdrop-filter is not part of this app's committed material
   palette.
4. **The hero-metric template.** Big number, small label, supporting stats, gradient accent (the
   SaaS-dashboard cliché) is banned. Neither `/chat` nor `/studio` has, or should introduce, a
   landing-style hero-metric surface.
5. **Identical / nested card grids.** Repeating same-sized cards (icon + heading + text) endlessly,
   or nesting a card inside another card, is banned. This app's structured content (e.g. the
   Code-Island preset browser) uses rows and lists, not stacked card grids.
6. **Tracked uppercase eyebrow labels.** A small all-caps, letter-spaced label reflexively placed
   above every section heading is banned as default scaffolding. Section headings in this app stand
   on their own typographic weight without an eyebrow tacked on.
7. **Numbered section markers as default scaffolding.** Prefixing every section with `01 / 02 / 03`
   ordinal markers by reflex is banned. Reserve real numbering for genuinely sequential content —
   a file-tree depth indicator or an agent's numbered step list, where the order itself carries
   information.
8. **Text that overflows its container.** Headings or labels that clip or wrap awkwardly at any
   breakpoint (chat transcript width, studio panel width) are banned. Verify copy at the actual
   container width before shipping, not just at design-time defaults.
9. **The "ghost-card" pattern.** Pairing a 1px border with a soft, wide (≥16px blur) drop shadow on
   the same card, button, or row is banned. Pick one signal — a full border at the brand color, or a
   defined shadow at ≤8px blur — never both as decoration.
10. **Over-rounded corners.** `border-radius` of 32px or more on cards, panels, or inputs is banned.
    This app's rounding stays in the 8-16px range (`rounded-md`/`rounded-lg`); full-pill rounding is
    reserved for tags and buttons only.
11. **Hand-drawn / sketchy illustrations.** Doodle-style SVGs, "paper-grain" filter effects, or crude
    hand-drawn scene illustrations are banned from this app's utilitarian chat/studio surfaces. Use
    `lucide-react` icons, or no illustration at all.
12. **Decorative background overlay patterns.** Diagonal stripe repeats or two-axis dot/line grid
    overlays used purely as page-background decoration are banned, unless the surface is literally a
    canvas, map, or blueprint — e.g. the `@xyflow/react` canvas itself, where a grid is the working
    surface, not decoration.
13. **Meta-criticism copy.** Naming a concept and then undercutting it with an ironic aside, or
    staging a strawman just to "correct" it, is banned from this app's UX copy. State the claim or
    label plainly — consistent with this app's existing honesty convention for generation-state
    copy.

## Available Transition Utilities (ADOPT-05)

Three CSS transition utilities are part of this phase's design contract (hand-copied and
retokenized from `transitions.dev`, MIT — see `27-UI-SPEC.md` ADOPT-05). The CSS itself is authored
in a later plan of this phase; this section documents the contract now so the utilities are
discoverable from day one.

**`.t-modal-reveal`** — a 250ms scale-and-fade entrance (`scale(0.96)` → `scale(1)`, opacity 0 → 1,
plus a soft shadow settle) for modal content.
Designated consumer: `delete-conversation-dialog.tsx`'s inner content wrapper (the
`<AlertDialogHeader>`…`<AlertDialogFooter>` block).

**`.t-panel-reveal`** — a 400ms width transition paired with a 350ms opacity fade, for a collapsing
side panel.
Designated consumer: `conversation-rail.tsx`'s collapse/expand transition (replaces its prior ad hoc
`motion-safe:transition-[width]` pairing).

**`.t-dropdown-reveal`** — a 150ms scale-and-fade entrance (`scale(0.98)` → `scale(1)`) for
popover/dropdown content.
Designated consumer: `model-picker.tsx`'s `<Command>` wrapper inside its `<PopoverContent>`.

All three are gated under `@media (prefers-reduced-motion: reduce)` and use only this app's existing
color tokens (no new token values) — see `27-UI-SPEC.md` ADOPT-05 for the full CSS contract.

## References

- impeccable.style: https://impeccable.style (skill source: https://github.com/pbakaus/impeccable)
- License: Apache-2.0
