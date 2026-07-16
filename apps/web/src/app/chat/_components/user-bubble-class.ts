/**
 * user-bubble-class.ts — the ONE user-turn bubble recipe, the sketch's
 * `.uturn` (direction-final.html:416).
 *
 * WHY ITS OWN MODULE (mirrors `panel-action-button-class.ts`'s precedent
 * exactly — same cycle, same fix): `message-turn.tsx` IMPORTS
 * `compact-interaction-entry.tsx` to render its `interaction_result` parts, so
 * the entry cannot import the class back from the turn without a circular
 * dependency. It therefore held a hand-copied duplicate, under a header
 * promising it reuses "MessageTurn's existing user-bubble classes verbatim
 * (`flex justify-end` + `max-w-[85%] rounded-lg bg-muted px-4 py-2`)".
 *
 * That promise was only ever true by discipline, and 61-04 is exactly the
 * change that breaks it: the two bubbles sit in the SAME transcript — the
 * user's typed message and the user's widget response — so any drift between
 * them ships as two marks that are supposed to be one mark, disagreeing. One
 * exported constant makes the header true by construction instead
 * ("grow the vocabulary; never improvise a local class map", 61-CONTEXT).
 *
 * APPEARANCE ONLY, never alignment: `MessageTurn` is a flex-column child and
 * right-aligns with `self-end`, while `CompactInteractionEntry` sits INSIDE a
 * turn and right-aligns with its own `flex justify-end` wrapper. Those two
 * mechanisms are properties of where each one lives; only the bubble's own
 * look is shared.
 *
 * `wrap-break-word` IS NOT COSMETIC. The transcript lives in a Radix
 * ScrollArea, whose Viewport wraps content in an inline `display:table` div
 * that shrink-wraps to CONTENT (D-61-06, 61-03-SUMMARY.md). A pasted URL with
 * no break opportunity would therefore demand its own width, widen the whole
 * table past the viewport, and push content sideways out of reach — the exact
 * defect that put the rail's Rename/Delete off-screen. `npm run test:geometry`
 * now measures `scrollWidth <= clientWidth`; this class is why the user's own
 * text cannot trip it.
 *
 * AND IT IS SPELLED THE v4 WAY ON PURPOSE (D-61-04-C). `break-words` is the
 * TAILWIND v3 NAME. In v4 it is `wrap-break-word`, and v4 emits NOTHING for
 * the old spelling — no error, no warning, just an unstyled element. Written
 * as `break-words` this guard would have been a comment describing a class
 * that does not exist, in a file whose entire justification is that guard.
 * Confirmed in the built sheet rather than reasoned about, which is the only
 * thing that catches this:
 *     .wrap-break-word{overflow-wrap:break-word}     <- emitted
 *     break-words                                    <- no rule at all
 * This is the same failure that shipped the sidebar at HALF WIDTH through 730
 * green tests (`w-[--sidebar-width]` is v3; v4 needs `w-(--sidebar-width)`).
 */

export const USER_BUBBLE_CLASS =
  "max-w-[85%] rounded-frame bg-shade px-3 py-2 wrap-break-word";
