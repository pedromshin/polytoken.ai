/**
 * graph-legend.tsx — bottom-left canvas legend explaining the tier line encoding.
 *
 * UI-SPEC Legend: plain reviewer-facing labels only ("Confirmed"/"Suggested"/
 * "Uncertain") — never the raw enum names (EXTRACTED/INFERRED/AMBIGUOUS). Each
 * swatch reuses `tierEdgeStyle`'s exact stroke/dash/opacity values (single
 * source of truth with `toFlowEdges`'s tier styling — no hand-duplication).
 *
 * Not dismissible (unlike TaxonomyBanner) — a small persistent reference.
 */

import { tierEdgeStyle } from "./tier-edge-style";

interface LegendSwatchProps {
  readonly label: string;
  readonly tier: string | undefined;
}

function LegendSwatch({ label, tier }: LegendSwatchProps): React.ReactElement {
  const { style } = tierEdgeStyle(tier);
  return (
    <div className="flex items-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <line
          x1="0"
          y1="6"
          x2="12"
          y2="6"
          stroke={style?.stroke ?? "hsl(var(--foreground))"}
          strokeWidth={1.5}
          strokeDasharray={style?.strokeDasharray}
          opacity={style?.opacity ?? 1}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function GraphLegend(): React.ReactElement {
  return (
    <div className="rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        {/* EXTRACTED (solid, tier-extracted stroke) -> "Confirmed" */}
        <LegendSwatch label="Confirmed" tier="EXTRACTED" />
        {/* INFERRED (dashed, tier-inferred stroke) -> "Suggested" */}
        <LegendSwatch label="Suggested" tier="INFERRED" />
        {/* AMBIGUOUS (faint, tier-inferred stroke) -> "Uncertain" */}
        <LegendSwatch label="Uncertain" tier="AMBIGUOUS" />
      </div>
    </div>
  );
}
