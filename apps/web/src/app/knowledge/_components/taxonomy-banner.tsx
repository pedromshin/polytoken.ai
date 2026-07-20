"use client";

/**
 * taxonomy-banner.tsx — dismissible explainer banner inside the graph canvas
 * (Phase 62 / SURF-03, on the locked identity).
 *
 * Position: absolute bottom-0 inset-x-0 inside the canvas. A quiet `leaf`
 * strip under a hairline — chrome speaking in its own sans voice, counts
 * tabular (law 2's numerals rule). Dismiss persists via the parent
 * (localStorage key "polytoken.knowledge.taxonomy-banner-dismissed").
 * role="status" aria-live="polite". No font-medium (500).
 */

import { X } from "lucide-react";

import { Button } from "@polytoken/ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaxonomyBannerProps {
  readonly entityTypeCount: number;
  readonly fieldCount: number;
  readonly onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaxonomyBanner({
  entityTypeCount,
  fieldCount,
  onDismiss,
}: TaxonomyBannerProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-hair bg-leaf px-4 py-2"
    >
      <p className="tabular text-xs text-faded">
        Your extraction schema &mdash; {entityTypeCount} entity types,{" "}
        {fieldCount} fields. Instances and knowledge rules appear as emails are
        processed.
      </p>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="size-6 shrink-0 text-faded hover:bg-shade hover:text-ink"
        onClick={onDismiss}
      >
        <X className="size-3" aria-hidden />
      </Button>
    </div>
  );
}
