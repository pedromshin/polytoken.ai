/**
 * canvas-panel-button-class.ts — the ONE recipe for the canvas's top-right
 * Panel cluster buttons (Add thread / Add knowledge preview / Toggle minimap).
 *
 * WHY ITS OWN MODULE (mirrors `panel-action-button-class.ts` and
 * `user-bubble-class.ts` — the same precedent, twice over): the three buttons
 * live in THREE different files (`add-email-thread-popover.tsx`,
 * `add-knowledge-preview-popover.tsx`, and `chat-canvas.tsx`'s own minimap
 * toggle) and render side by side as ONE cluster. They each carried a
 * hand-copied `size-11 bg-background/95`, a duplicate held true only by
 * discipline — in the one place drift is most visible, since all three sit in
 * a single card and any disagreement reads as three controls that are supposed
 * to be one control, disagreeing. One exported constant makes that true by
 * construction ("grow the vocabulary; never improvise a local class map",
 * 61-CONTEXT).
 *
 * `bg-background/95` is GONE (61-05). It was an opacity trick standing in for a
 * designed control: a 95%-opaque page ground floated over a board, so the grid
 * showed faintly THROUGH the buttons. The cluster is now a real card — the
 * container carries the `--bright` fill and the `--rule` hairline, exactly as
 * the React Flow Controls card does, so the canvas has ONE chrome language
 * rather than two.
 *
 * APPEARANCE ONLY. Each call site keeps its own `aria-label`, its own handler,
 * and (for the minimap toggle) its own `aria-pressed` — those are properties of
 * what each button DOES, not of how the cluster looks.
 *
 * `size-11` is 44px and is NOT negotiable down to the icon-button default:
 * D-48-07's touch-target floor (WCAG 2.5.8). `rounded-none` because these are
 * segments of the card, not free-floating controls; the card's own
 * `overflow-hidden` clips the hover fill to its radius. `text-ink` is stated
 * rather than inherited (61-03's rule: say the token, never reach it through
 * `primary`'s indirection). The `--shade` hover + ink hover text come from the
 * Button primitive's `ghost` variant, which already resolves to exactly those
 * two tokens.
 */

export const CANVAS_PANEL_BUTTON_CLASS = "size-11 rounded-none text-ink";
