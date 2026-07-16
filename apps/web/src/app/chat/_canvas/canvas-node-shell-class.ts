/**
 * canvas-node-shell-class.ts — the ONE card recipe every canvas node shell
 * wears (61-06-PLAN.md Task 1).
 *
 * WHY THIS FILE EXISTS, and why the base is NOT in `canvas-vocabulary.ts`:
 * 61-02 decided it. That module's own header says the base "belongs to the
 * shell", not to the vocabulary — the vocabulary holds the SEMANTIC maps (which
 * tier claims which colour, which kind claims which geometry), and a flat card
 * is neither. This is the same split, and the same `*-class.ts` shape, as
 * `canvas-panel-button-class.ts` (61-05), `panel-action-button-class.ts` and
 * `user-bubble-class.ts`: one recipe, N call sites, held true by the compiler
 * instead of by discipline.
 *
 * It exists at all because the FIVE shells carried five near-identical hand-
 * copied strings — `rounded-lg border border-border/60 bg-background
 * transition-shadow duration-150` plus a shadow — and that is precisely how the
 * debt this plan clears accumulated. Four of them agreed by coincidence; the
 * fifth (`unknown-node-type-placeholder`) had drifted into framing itself in
 * the irreversible colour and nobody noticed for three milestones.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE SKETCH'S `.card` (direction-final.html:468-494), realized
 * ────────────────────────────────────────────────────────────────────────
 *
 *   .card { background:var(--bright); border:1px solid var(--rule);
 *           border-radius:var(--r-card); display:flex; flex-direction:column; }
 *   .card:hover { border-color:var(--rule-hi) }
 *
 * THREE THINGS TO READ CAREFULLY, because each was wrong on screen:
 *
 * 1. `--bright`, NOT `bg-background`. `--background` resolves to `--shelf`, the
 *    PAGE ground — the same tone the board itself is painted in. So every node
 *    card was the exact colour of the surface behind it, and only its border and
 *    the grid dots stopping at its edge said a card was there at all. A card
 *    sits ABOVE the page; the sketch says `--bright` and means it. Confirmed by
 *    looking at the committed capture, in both themes.
 *
 * 2. ZERO SHADOW. `shadow-elevation-1`/`-2` contradicted the identity's own
 *    summary line — "Calm registry rhythm: flat surfaces, hairline rules, zero
 *    shadow anywhere" (58-IDENTITY.md). Hover is a RULE change (`--rule-hi`),
 *    never a lift, so `transition-shadow` goes with it and `transition-colors`
 *    takes its place.
 *
 * 3. SELECTION IS AN OUTLINE, NOT A RING, and it is INK. Law 1 is explicit —
 *    "selected states ... carry NO hue" — and the shells said `ring-primary`,
 *    which resolves to `--ink` only by way of `--primary`'s indirection. That
 *    indirection is exactly what let a hue live in these files unread for three
 *    milestones, so the ink is said out loud here. Outline over ring follows
 *    D-61-05-6/D-61-03-F, decided on THIS surface one plan ago: Tailwind's
 *    `--tw-ring-offset-color` defaults to `#fff`, so `ring-offset-1` paints a
 *    white halo around every selected node in dark mode.
 */

/**
 * The flat sheet, minus its kind and its selection. Every node shell composes
 * this with a `CANVAS_NODE_KIND_GEOMETRY` value and its own dimension floors.
 *
 * Dimensions are deliberately NOT here: they are per-node FACTS (D-07 — a
 * node's dimensions never change while its spec streams, so the graph never
 * relayouts mid-stream), not a shared card decision.
 */
export const CANVAS_NODE_SHELL_BASE =
  "flex flex-col overflow-hidden rounded-card border border-rule bg-bright transition-colors hover:border-rule-hi";

/**
 * The selected treatment — ink, stated rather than inherited (see 3 above).
 *
 * `outline-offset-2` leaves the board (and its grid) visible in the gap, which
 * is why an outline is also the honest mark here: a ring's offset would have to
 * paint a solid colour over the working surface to avoid the white-halo bug.
 */
export const CANVAS_NODE_SELECTED = "outline-2 outline-offset-2 outline-ink";

/**
 * canvasNodeShellClass — base + kind + (selection). The `kindGeometry` argument
 * is passed IN rather than looked up here so that each shell names
 * `CANVAS_NODE_KIND_GEOMETRY` at its own call site: the wiring is the thing a
 * reader needs to see, and hiding it behind one more indirection is how the
 * per-file strings stopped being read in the first place.
 *
 * T-61-17: every argument this ever receives is a value from a closed map keyed
 * by a compile-time-literal kind — never a string derived from `node.data` or
 * `node.type`.
 */
export function canvasNodeShellClass(
  kindGeometry: string,
  selected: boolean,
): string {
  return selected
    ? `${CANVAS_NODE_SHELL_BASE} ${kindGeometry} ${CANVAS_NODE_SELECTED}`
    : `${CANVAS_NODE_SHELL_BASE} ${kindGeometry}`;
}
