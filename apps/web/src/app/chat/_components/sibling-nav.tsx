"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export interface SiblingNavProps {
  /** Sibling assistant-message ids for this turn's regenerate group, in
   * version order (D-16) — length 1 means "never regenerated". */
  readonly siblings: readonly string[];
  /** 0-based index into `siblings` currently being displayed. */
  readonly activeIndex: number;
  /** Called with the target 0-based index to display locally (D-16 — swaps
   * only the rendered sibling's content, never re-fetches). */
  readonly onNavigate: (index: number) => void;
}

/**
 * SiblingNav (D-16, CHAT-04) — `‹ N/M ›` regenerate-version counter. Renders
 * nothing when there is only one version (`siblings.length <= 1`) — the
 * guard the 22-UI-SPEC.md Copywriting Contract requires ("shown only when
 * siblings.length > 1"). Navigation is purely local/visual — it never
 * affects the server's active-context sibling (only regenerate does that).
 */
export function SiblingNav({
  siblings,
  activeIndex,
  onNavigate,
}: SiblingNavProps): React.ReactElement | null {
  if (siblings.length <= 1) {
    return null;
  }

  const total = siblings.length;
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < total - 1;

  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        aria-label="Previous version"
        disabled={!canPrev}
        onClick={() => onNavigate(activeIndex - 1)}
        className="rounded p-0.5 disabled:opacity-30 enabled:hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
      </button>
      <span aria-live="off">
        {activeIndex + 1}/{total}
      </span>
      <button
        type="button"
        aria-label="Next version"
        disabled={!canNext}
        onClick={() => onNavigate(activeIndex + 1)}
        className="rounded p-0.5 disabled:opacity-30 enabled:hover:text-foreground"
      >
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
