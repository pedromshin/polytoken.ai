"use client";

/**
 * canvas-keyboard-hint.tsx — CanvasKeyboardHint: first-canvas-visit-per-
 * browser dismissible caption (23-UI-SPEC.md Copywriting Contract /
 * Accessibility). Same localStorage-gated dismiss pattern as
 * /knowledge's TaxonomyBanner — presentational only, parent (ChatCanvas)
 * owns dismissed state + localStorage.
 */

import { X } from "lucide-react";

import { Button } from "@polytoken/ui/button";

export const KEYBOARD_HINT_DISMISSED_KEY = "polytoken.chat.canvas-keyboard-hint-dismissed";

interface CanvasKeyboardHintProps {
  readonly onDismiss: () => void;
}

export function CanvasKeyboardHint({
  onDismiss,
}: CanvasKeyboardHintProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border/50 bg-background/95 px-4 py-2"
    >
      <p className="text-xs text-muted-foreground">
        Use arrow keys to pan, +/- to zoom, Tab to move between panels.
      </p>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="size-11 shrink-0"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
