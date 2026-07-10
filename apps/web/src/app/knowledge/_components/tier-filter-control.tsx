"use client";

/**
 * tier-filter-control.tsx — 3-segment cumulative radiogroup tier filter (GRAPH-03).
 *
 * Lives in the graph toolbar row (NOT inside FilterRail — that rail is node-type
 * filtering, a distinct concern from edge-tier filtering). Active state ties to the
 * D-48-04 tier ladder (border-tier-extracted/bg-tier-extracted/text-tier-extracted-foreground)
 * since "Confirmed" IS the EXTRACTED tier — visually coherent with the edge/legend
 * encoding, not a generic primary affordance.
 *
 * role="radiogroup" of three role="radio" Buttons, arrow-key navigation per the
 * standard radiogroup pattern. Exact UI-SPEC copy: "Confirmed only" / "+ Inferred" /
 * "+ Ambiguous".
 */

import { useCallback } from "react";

import { Button } from "@polytoken/ui/button";

import type { TierFilterState } from "./tier-filter";

// ---------------------------------------------------------------------------
// Segments — order is the cumulative narrow -> wide sequence.
// ---------------------------------------------------------------------------

const SEGMENTS: ReadonlyArray<{ readonly state: TierFilterState; readonly label: string }> = [
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
      className="flex items-center gap-1"
    >
      {SEGMENTS.map((segment, index) => {
        const active = segment.state === value;
        return (
          <Button
            key={segment.state}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            variant="outline"
            size="sm"
            className={
              active
                ? "border-tier-extracted bg-tier-extracted font-semibold text-tier-extracted-foreground hover:bg-tier-extracted hover:text-tier-extracted-foreground"
                : "border-border bg-background text-muted-foreground"
            }
            onClick={() => onChange(segment.state)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {segment.label}
          </Button>
        );
      })}
    </div>
  );
}
