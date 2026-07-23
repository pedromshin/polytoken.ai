"use client";

/**
 * canvas-keyboard-hint.tsx — CanvasKeyboardHint: first-canvas-visit-per-
 * browser dismissible caption (23-UI-SPEC.md Copywriting Contract /
 * Accessibility). Same localStorage-gated dismiss pattern as
 * /knowledge's TaxonomyBanner — presentational only, parent (ChatCanvas)
 * owns dismissed state + localStorage.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 61-06 (D-61-05-B) — THE LAST OPACITY TRICK ON THE BOARD, AND IT WAS ALSO
 * SITTING ON THE ZOOM CONTROLS.
 * ────────────────────────────────────────────────────────────────────────
 *
 * This was `absolute bottom-0 left-0 right-0 ... border-t border-border/50
 * bg-background/95`: a 95%-opaque strip of the PAGE ground floated across the
 * full width of the board. 61-05 turned the top-right Panel cluster from three
 * of those ghosts into one real card and left this as the last one, which made
 * it the only piece of canvas chrome not speaking the surface's own card
 * language.
 *
 * Looking at the committed capture (`chat-canvas-desktop-dark.png`) showed the
 * strip was doing more damage than a tonal one: it spanned the whole board, so
 * it **overlapped the Controls card and clipped it in half** — the fit-view and
 * interactive buttons were underneath it, unclickable, with one of them faintly
 * GHOSTING THROUGH the 5% translucency. That is a reachability bug wearing a
 * styling bug's clothes, and an opaque ground alone would have hidden the ghost
 * while leaving the controls just as unreachable.
 *
 * So the hint is now what the rest of this surface already is: a real card
 * (`--bright` on a `--rule` hairline, `rounded-card`, zero shadow) that floats
 * bottom-CENTER, clearing the Controls card at bottom-left and the minimap at
 * bottom-right instead of lying across both. Same chrome language as the
 * Controls card and the Panel cluster, so the canvas has one vocabulary rather
 * than three.
 *
 * `role="status"`/`aria-live="polite"` and the dismiss control's `aria-label`
 * are untouched — this is a restyle, not a re-contract. The dismiss button
 * mirrors the node cards' own remove `×` exactly (`size-6` glyph with a
 * `pointer-coarse:touch-target` 44px floor, D-48-07), because it is the same
 * kind of control and this surface already spells it that way twice.
 */

import { X } from "lucide-react";

import { canvasHintItems } from "./canvas-commands";

export const KEYBOARD_HINT_DISMISSED_KEY = "polytoken.chat.canvas-keyboard-hint-dismissed";

interface CanvasKeyboardHintProps {
  readonly onDismiss: () => void;
}

/**
 * CanvasKeyboardHint — the dismissible shortcut caption. Its copy is DERIVED
 * from `canvasHintItems()` (the ONE canvas command table, CI-02) so the hint
 * can never advertise a binding that isn't actually wired: change the table,
 * the hint changes with it.
 */
export function CanvasKeyboardHint({
  onDismiss,
}: CanvasKeyboardHintProps): React.ReactElement {
  const items = canvasHintItems();
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute bottom-3 left-1/2 flex max-w-[min(90vw,44rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-rule bg-bright py-1 pl-row-x pr-1"
    >
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-2xs text-pencil">
          <span className="flex gap-0.5">
            {item.keys.map((keycap) => (
              <kbd
                key={keycap}
                className="rounded-sm border border-rule px-1 font-sans text-2xs text-ink"
              >
                {keycap}
              </kbd>
            ))}
          </span>
          {item.label}
        </span>
      ))}

      <button
        type="button"
        aria-label="Dismiss"
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
