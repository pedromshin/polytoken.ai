# Hover/Active-State Convention

> Working reference doc, not marketing prose — sits alongside
> [`brand-guide.md`](./brand-guide.md) and
> [`product-register-and-bans.md`](./product-register-and-bans.md). Records D-48-06: the
> ONE hover/active-state derivation rule for this app. Interactive-state styling stops being
> ad-hoc per component — every new chip, badge, button, or filter segment derives its
> hover/active treatment from this recipe, not a bespoke opacity guess.

## Why this exists

The v1.8 design-pattern dossier (flow c) flagged that style packs define exactly one resting
value per alias, while hover/active derivation was left entirely to component-level Tailwind
opacity utilities — no token or convention governed it. That risks per-pack, per-component
inconsistency as more packs and more interactive surfaces are added (Phase 49 applies this rule
broadly). This doc is the fix: one fixed recipe, derived from the resting alias, applied
consistently.

## 1. The rule (D-48-06)

Interactive-state styling is **derived from the resting alias**, never invented per component.
There are exactly two families, one recipe each:

| Element family | Resting state | Hover | Active/pressed | Focus-visible |
|---|---|---|---|---|
| **Neutral / ghost** (chips, muted rows, outline buttons, unselected filter segments) | `bg-muted`/`bg-background` + `text-muted-foreground` | Move to the accent surface pair: `hover:bg-accent hover:text-accent-foreground` | The accent pair already reads as the "engaged" state for neutral elements — see §3 for the documented exception when an element is already pinned to a persistent active/selected state | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` (or `-2`, component-dependent) |
| **Filled semantic** (primary / success / destructive fills) | `bg-{alias}` + `text-{alias}-foreground` | One step stronger fill of the **same alias**: `hover:bg-{alias}/90` | One step stronger again: `active:bg-{alias}/80` (or the equivalent pressed-state utility the component library exposes) | Same `ring-ring`/`ring-offset` pattern — never removed by this recipe |

Rules of derivation:

- **Token-driven where cheap, documented utility where not.** If a token-level hover/active
  alias existed (it doesn't yet — see dossier gap above), it would win. Until then, the
  opacity-modifier utility (`/90`, `/80`) applied to the SAME resting alias is the documented,
  repeatable substitute — never a new hardcoded color.
- **Neutral elements move surfaces (muted → accent); filled elements intensify their own
  fill.** Do not hover a filled `bg-success` element onto `bg-accent` — that swaps semantic
  meaning (success vs. neutral) instead of just intensifying state.
- **`focus-visible:ring-ring ring-offset-*` is orthogonal to hover/active** and is never dropped
  or reinterpreted by this rule — it is the existing, separate keyboard-focus contract.
- **This is ONE recipe, not a per-component table.** If a new component needs a hover/active
  treatment, classify it as neutral/ghost or filled/semantic first, then apply the matching row
  above — do not derive a bespoke value.

## 2. Worked examples

The three examples below are the actual chips/badges this phase touched — not hypothetical
cases.

### a. Citation chip — `ProvenanceLink` (neutral/ghost recipe)

`apps/web/src/components/provenance-link.tsx`'s shared `CHIP_CLASS_NAME`:

```
bg-muted ... text-muted-foreground ... hover:bg-accent hover:text-accent-foreground
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
```

Resting: `bg-muted`/`text-muted-foreground` (neutral surface). Hover: moves to the accent
surface pair exactly per the neutral/ghost row above. This chip has no separate "pressed" state
(it's a `<Link>`, not a toggle) — the accent pair on hover is the full derivation.

### b. Success confirm affordance — `ConfirmDenyControls` (filled semantic recipe)

`apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx`'s confirm (✓) button:

```
bg-success hover:bg-success/90 text-success-foreground
```

Resting: `bg-success` filled. Hover: `/90` — one step stronger fill of the same alias, exactly
per the filled/semantic row. The adjacent deny (✗) button follows the identical recipe against
`bg-destructive`/`hover:bg-destructive/90` — same recipe, different alias, proving the rule
generalizes across semantic fills without a new per-color table.

### c. Knowledge tier filter — `TierFilterControl` (documented pinned-state exception)

`apps/web/src/app/knowledge/_components/tier-filter-control.tsx`'s three-segment cumulative
radiogroup:

```
active:  border-tier-extracted bg-tier-extracted font-semibold text-tier-extracted-foreground hover:bg-tier-extracted hover:text-tier-extracted-foreground
inactive: border-border bg-background text-muted-foreground
```

*(Updated 2026-07-10: 48-04 migrated this control's active segment from the generic `primary`
pair onto the purpose-built `tier-extracted` pair — the recipe below is unchanged, only the
alias moved.)*

The **inactive** segments are the neutral/ghost case (unselected `Button variant="outline"`
picks up the component's own accent-pair hover by default — no override needed here). The
**active** (currently-selected) segment is the documented exception this rule allows: once a
segment is pinned to its selected/persistent-active state, hover is intentionally a no-op
(`hover:bg-tier-extracted hover:text-tier-extracted-foreground` reasserts the same values rather
than intensifying further). Selected state already represents the "engaged" tier for a toggle/radio
control; further intensifying it on hover would read as a second, competing state change and
risk being mistaken for a transient hover on an otherwise-static selection. **This is the one
allowed deviation from the two-row table above** — persistent selected/active state suppresses
the transient hover step; it does not invent a new recipe.

## 3. Scope and ownership

- This convention governs **interactive-state derivation only** — resting alias values
  themselves are unchanged and still live in `packages/genui/src/theme/packs.ts` (this doc
  never restates token values, per the phase's constraint).
- **Phase 49 applies this rule broadly** across the total UI re-skin — this doc is the source
  of truth it implements against. New components should be classified into one of the two
  families above before any hover/active class is written.
- The pinned-state exception (§2c) is the only sanctioned deviation. Any other component that
  appears to need a third recipe should be re-examined against the two-row table first — it is
  very likely a variant of neutral/ghost or filled/semantic, not a genuinely new case.

---

*Phase: 48-token-system-extensions*
*Established: 2026-07-10 (D-48-06)*
