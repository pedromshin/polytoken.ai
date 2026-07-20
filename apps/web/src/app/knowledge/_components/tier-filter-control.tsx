"use client";

/**
 * tier-filter-control.tsx — 3-segment cumulative radiogroup tier filter
 * (GRAPH-03), on the LOCKED identity (Phase 62 / SURF-03).
 *
 * Lives in the graph toolbar row (NOT inside FilterRail — node-type filtering
 * and edge-tier filtering are distinct concerns).
 *
 * LAW 1 — the first draft painted the active segment in the confirmed tier's
 * verdigris. That spent the earned hue on a SELECTION, which is exactly what
 * the law forbids: "selected states … carry NO hue". The active segment is
 * now an ink fill inside a `bright` well — the same selection language every
 * swept surface speaks. Tier colour stays where tier lives: on the edges and
 * in the legend.
 *
 * role="radiogroup" of three role="radio" buttons, arrow-key navigation per
 * the standard radiogroup pattern. Copy: "Confirmed only" / "+ Inferred" /
 * "+ Ambiguous" (cumulative narrow -> wide).
 */

import { useCallback } from "react";

// ---------------------------------------------------------------------------
// Segments — order is the cumulative narrow -> wide sequence.
// ---------------------------------------------------------------------------

import type { TierFilterState } from "./tier-filter";

const SEGMENTS: ReadonlyArray<{
  readonly state: TierFilterState;
  readonly label: string;
}> = [
  { state: "confirmed", label: "Confirmed only" },
  { state: "inferred", label: "+ Inferred" },
  { state: "ambiguous", label: "+ Ambiguous" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TierFilterControlProps {
  readonly value: TierFilterState;
  readonly onChange: (next: TierFilterState) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TierFilterControl({
  value,
  onChange,
}: TierFilterControlProps): React.ReactElement {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + delta + SEGMENTS.length) % SEGMENTS.length;
      const nextSegment = SEGMENTS[nextIndex];
      if (nextSegment == null) return;
      onChange(nextSegment.state);
    },
    [onChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Filter by trust tier"
      className="inline-flex items-center gap-0.5 rounded-md border border-rule bg-bright p-0.5"
    >
      {SEGMENTS.map((segment, index) => {
        const active = segment.state === value;
        return (
          <button
            key={segment.state}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`h-6 rounded-[5px] px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
              active
                ? "bg-ink font-semibold text-on-fill"
                : "text-faded hover:bg-shade hover:text-ink"
            }`}
            onClick={() => onChange(segment.state)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
