"use client";

/**
 * graph-toolbar.tsx — the ONE chrome row above the /knowledge board
 * (Phase 62 / SURF-03). The old page-level header + toolbar pair collapsed
 * into a single h-11 row (click-economy: the previous build spent two chrome
 * rows saying "Knowledge" twice before the board began).
 *
 * Left:   title + tabular node-count chip (the inbox header register).
 * Middle: the tier-filter segmented control (GRAPH-03), injected as children.
 * Right:  one labelled action — "Fit view". The permanently-disabled layout
 *         toggle the first draft shipped is deleted outright: dead chrome is
 *         decoration, and decoration is banned in both senses (taste §1).
 *
 * Law 1: everything here is ink on the ground ladder. No hue.
 */

import { Maximize2 } from "lucide-react";

import { Button } from "@polytoken/ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GraphToolbarProps {
  readonly total: number;
  readonly onFitView: () => void;
  /** GRAPH-03 — the tier-filter control, between title and actions. */
  readonly children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphToolbar({
  total,
  onFitView,
  children,
}: GraphToolbarProps): React.ReactElement {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-hair bg-leaf px-4">
      {/* Title + count — mirrors the inbox list header */}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-sm font-semibold text-ink">Knowledge</h1>
        <span
          data-field="count"
          className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded"
        >
          {total}
        </span>
      </div>

      {/* Tier filter (GRAPH-03) — NOT inside FilterRail */}
      <div className="min-w-0 flex-1">{children}</div>

      {/* Fit view — labelled, not an anonymous icon (anti-generic tell #4) */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onFitView}
        className="shrink-0 gap-1.5 text-xs text-faded hover:bg-shade hover:text-ink"
      >
        <Maximize2 className="size-3.5" aria-hidden />
        Fit view
      </Button>
    </div>
  );
}
