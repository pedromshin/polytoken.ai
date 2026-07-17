---
phase: 66-files-vault
plan: 03
subsystem: vault-surface
tags: [ui, identity, accessibility, click-economy]
requires: ["66-01", "66-02"]
provides:
  - "/files route — browse, drill down, deep-link, keyboard-scan, download"
  - "formatBytes / formatVaultDate / KIND_GLYPH / KIND_LABEL"
  - "VaultEmpty / VaultLoading / VaultError — the SURF-06 bar"
  - "VaultListing / VaultRow — roving tabindex, focus-revealed actions"
affects: ["66-04"]
tech-stack:
  added: []
  patterns: ["roving tabindex", "URL-addressable view state", "skeleton drawn from the row"]
key-files:
  created:
    - apps/web/src/app/files/page.tsx
    - apps/web/src/app/files/_lib/vault-format.ts
    - apps/web/src/app/files/_components/vault-surface.tsx
    - apps/web/src/app/files/_components/vault-listing.tsx
    - apps/web/src/app/files/_components/vault-row.tsx
    - apps/web/src/app/files/_components/vault-states.tsx
    - apps/web/src/app/files/_lib/__tests__/vault-format.test.ts
    - apps/web/src/app/files/_components/__tests__/vault-listing.test.tsx
    - apps/web/src/app/files/_components/__tests__/vault-states.test.tsx
  modified: []
decisions: [D-66-05, D-66-08, D-66-10, D-66-11, D-66-14]
metrics:
  tasks: 3
  tests-added: 48
  completed: 2026-07-17
---

# Phase 66 Plan 03: The Vault You Can Read — Summary

`/files` renders a real folder listing, walks in and out of folders with the URL as its address,
downloads on one keystroke, and has three designed states. **Nobody has looked at it** — see the
unseen-pixels section, which is not a formality.

Commits: `264ae21` (vault-format), `25f56cf` (route, rows, states).

## 🔴 NOBODY HAS SEEN THIS SURFACE

No dev server (port 3000 is main's), no playwright, no screenshots — LANE-CONTRACTS protocol 3.
**jsdom does no layout and loads no CSS.** 48 green tests prove callbacks fire and class strings are
present; they cannot prove the surface looks like anything at all.

The memory of record: **four layout bugs shipped through green suites in a single night this
milestone** — a half-width sidebar, a rail that scrolled the page to 11,296px, a corrupted dev
server, and a madder-on-a-status that passed its gate. Every one was found by looking.

**This plan claims its tests pass. It does not claim the surface looks right.** Plan 04's SUMMARY
carries the three specific things a human must look at.

## The click budget — asserted, and honest

Every row of D-66-10's read-half budget is a test in `vault-listing.test.tsx`:

| Action | Budget | Status |
|---|---|---|
| Scan the vault | **0 clicks** | ✅ `ArrowUp`/`ArrowDown`/`Home`/`End`, clamped not wrapped |
| Enter a folder | 1 click / `Enter` | ✅ row body; **asserted no `role="menu"` opened in between** |
| Download | 1 click / `Enter` | ✅ same |
| Delete | 1 click / `Delete` | ✅ callback proven from both (Plan 04 owns the dialog) |
| Tab order | one stop, not 500 | ✅ roving tabindex, re-asserted after a move |

Nothing in the budget changed. No design decision here cost a click.

## Negative proofs — all red, all restored

| # | Sabotage | Result |
|---|---|---|
| 1 | `VaultError`'s button → `variant="destructive"` | **RED — 1 failed / 9 passed** |
| 2 | Delete trigger → conditional rendering (`{hovered && …}`) | **RED — 4 failed / 13 passed** |
| 3 | Every row `tabIndex={0}` | **RED — 2 failed / 15 passed** |
| 4 | *(extra)* `VaultKind` grows by one, maps untouched | **tsc RED** (see below) |
| 5 | *(extra)* `shadow-none` dropped from the empty state's button | **RED — 1 failed** |

### Two of these did not go red on the first attempt. That is the finding.

**Proof 1** initially stayed GREEN. Diagnosed rather than accepted: I had sabotaged only the
`variant` while leaving my `className` overrides in place, and **tailwind-merge strips every
destructive class** when `bg-leaf`/`text-ink`/`hover:bg-shade`/`shadow-none` are merged over them —
so the button genuinely rendered as ink and the test was right to report no madder. Re-run as the
realistic mistake (`<Button variant="destructive">Try again</Button>`, no overrides): **RED.**
Worth keeping in mind — *a `className` override can silently neutralize a variant*, which cuts both
ways.

**Proof 2** initially stayed GREEN because I swapped in a `hidden` CLASS rather than the specified
conditional rendering. Run as specified: **RED, 4 tests.** But the near-miss exposed a real hole and
it is now closed as far as jsdom permits — see below.

## D-66-14 (new) — where the gates actually live, measured

Three gates in this plan turned out to sit somewhere other than where the plan assumed. Recorded
because each was found by testing the gate rather than by trusting it:

1. **Kind exhaustiveness is `tsc`'s, not vitest's.** Adding an eighth `VaultKind` turns `tsc` RED
   (TS2741 on both maps) while all 21 vitest tests stay GREEN. A TS union does not exist at runtime,
   so the test's kind list is a hand-copy that cannot notice the original grew. Added a type-level
   `Exclude` guard so the list itself also fails compile when it rots — both directions pinned. The
   plan's claim that "the exhaustiveness test MUST go red" was wrong about *which* tool.
2. **The no-shadow assertion was `/shadow-/`, and the kit ships a BARE `shadow`.** It passed while
   the button had a drop shadow on it. Now bans bare `shadow` and every `shadow-*` except
   `shadow-none`; proven load-bearing by removal.
3. **jsdom cannot see `display:none`.** The reachability tests would all stay green if the delete
   trigger were concealed with a `hidden` class — no stylesheet is loaded and no layout is computed.
   A class-string check now closes that specific hole and **says in the test that it is a weaker
   instrument than a rendered one and is not pretending otherwise.** This is the repo's standing
   rendered-geometry blind spot; the real answer is the post-merge screenshot review.

## The contrast pair, which is a real bug and not a nit

`text-pencil` is legal on `--leaf`/`--bright` and **fails AA on `--shade` (4.23:1)** — brand-guide
§3. The row's hover fill *is* `bg-shade`. So the row pairs `hover:bg-shade` with
`group-hover:text-faded` on the size and date, and splitting that pair silently fails AA for as long
as the pointer rests on a row. Commented at the call site as load-bearing.

## The kit's focus ring — a knowing, stated exception

`vault-row.tsx`'s own controls use `outline-solid focus-visible:outline-2 focus-visible:outline-ink`
— outline, never ring, per D-61-03-F (`--tw-ring-offset-color` defaults to white = a halo in dark;
`globals.css` says so in its own words).

**But the kit's `Button` base carries `focus-visible:outline-none focus-visible:ring-1
focus-visible:ring-ring`**, and the four kit Buttons on this surface inherit it. Not fought, for
reasons worth stating rather than hiding:

- `--ring: var(--ink)` (globals.css:596) — the ring is **ink, not a hue**. Law 1 holds.
- There is **no `ring-offset`** on the Button base, so **the white-halo trap is absent**.
- The swept chat surface does the same (`conversation-row.tsx` uses `ring-2 ring-ink`).
- Evicting it would need `focus-visible:ring-0` — which this surface's own law gate bans, and
  `outline-solid` unprefixed cannot evict a *variant-prefixed* `focus-visible:outline-none` through
  tailwind-merge (different variant, different group).

So: the law gate governs what **this surface writes**, not what the kit inherits. Fixing
`packages/ui/src/button.tsx` is Lane A's, not ours.

## Deviations from plan

1. **[Rule 3 — Blocking] The plan's test harness does not exist.** Plans 03/04 specify "RTL +
   user-event, the app's existing idiom". **`@testing-library/react` is not a dependency of this
   repo and is not resolvable**, and installing it is orchestrator-reserved. The app's *real*
   convention is jsdom + `createRoot` + `act` from `"react"` — used by ~20 suites, and
   `markdown-renderer.test.tsx`'s header says so explicitly: *"no @testing-library/react needed —
   matches packages/genui's existing test convention."* Every assertion the plan asked for is
   present, expressed against the real DOM. **Lanes B/C/E likely hit this too.**
2. **[Rule 1 — Bug] The plan's banned-constructs grep flags its own prose.**
   `! grep -rn "ScrollArea|font-serif|…" apps/web/src/app/files/` matches the **comments** that
   document the bans, so it can never pass on a well-documented surface — the self-invalidating-gate
   trap, in the plan's own verify command. Ran comment-stripped instead: clean on code lines. Plan
   04's law gate does this properly.
3. **[Rule 1 — Bug] `shadow-none` added to kit Buttons.** The identity's only elevation device is
   the ground ladder; the kit's default variant ships a shadow. Follows `composer.tsx`'s established
   precedent.
4. **[Rule 2 — Missing] `Suspense` around the surface.** `useSearchParams` without a boundary fails
   `next build` for the whole route ("de-opted into client-side rendering"). Fallback is `null`, not
   a spinner — the surface renders its own designed loading state a beat later, and two loading
   treatments in sequence is a flash, not a courtesy.
5. **[Honest stub, resolved in Plan 04]** Plan 03 alone renders an "Upload files" button and delete
   triggers that **do nothing** — 04 wires them. Marked in `vault-surface.tsx` at the mount point,
   deliberately, so 04 is an insertion rather than a restructure. Not a stub after 04.

## ⚠ Orchestrator requests

1. **Nav/sidebar:** register `/files` → **"Files"**.
2. **Screenshot harness + geometry gate:** add `/files`, **both themes × 390 and 1440** — and
   **READ the PNGs**. This surface has never been rendered.

## Self-Check: PASSED

All nine files exist; commits `264ae21`, `25f56cf` in `git log`; `npx tsc --noEmit -p apps/web`
clean; 48/48 files tests green; `git status --short` clean outside owned paths.
