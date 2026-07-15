"use client";

/**
 * taxonomy-banner.tsx — dismissible explainer banner inside the graph canvas.
 *
 * UI-SPEC Default Render Depth banner:
 *   Position: absolute bottom-0 left-0 right-0 inside canvas (above MiniMap)
 *   Style: bg-background/95 border-t border-border/50 px-4 py-2 (RSKN-03: solid, no blur)
 *   Copy: "Your extraction schema — {N} entity types, {M} fields. Instances and
 *          knowledge rules appear as emails are processed."
 *   Dismiss: X button (aria-label "Dismiss"); parent persists to localStorage
 *            key "polytoken.knowledge.taxonomy-banner-dismissed"
 *   role="status" aria-live="polite"
 *
 * Presentational — parent (knowledge-graph.tsx) owns dismissed state + localStorage.
 * No font-medium (500).
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
      className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border/50 bg-background/95 px-4 py-2"
    >
      <p className="text-xs text-muted-foreground">
        Your extraction schema &mdash; {entityTypeCount} entity types, {fieldCount} fields.
        Instances and knowledge rules appear as emails are processed.
      </p>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="size-6 shrink-0"
        onClick={onDismiss}
      >
        <X className="size-3" aria-hidden />
      </Button>
    </div>
  );
}
