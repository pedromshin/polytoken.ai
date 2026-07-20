/**
 * graph-legend.tsx — bottom-left canvas legend explaining the tier line
 * encoding (Phase 62 / SURF-03, on the locked identity).
 *
 * Reviewer-facing labels only ("Confirmed"/"Suggested"/"Uncertain") — never
 * the raw enum names. Each swatch reuses `tierEdgeStyle`'s exact
 * stroke/dash/opacity values (single source of truth with `toFlowEdges`'s
 * tier styling — no hand-duplication), so the legend can never disagree with
 * the wire it explains. This is the one place on the chrome where the tier
 * hues appear, and tier is exactly what earns them (law 1).
 *
 * Chrome register: a flat `bright` card with a hairline rule — the sketch's
 * card, zero shadow. Not dismissible — a small persistent key.
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
      <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden>
        <line
          x1="0"
          y1="4"
          x2="14"
          y2="4"
          stroke={style?.stroke ?? "var(--edge)"}
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
    <div className="rounded-card border border-rule bg-bright px-chip-x py-chip-y text-2xs text-faded">
      <div className="flex items-center gap-3">
        {/* EXTRACTED (solid verdigris) -> "Confirmed" */}
        <LegendSwatch label="Confirmed" tier="EXTRACTED" />
        {/* INFERRED (dashed amber) -> "Suggested" */}
        <LegendSwatch label="Suggested" tier="INFERRED" />
        {/* AMBIGUOUS (faint amber) -> "Uncertain" */}
        <LegendSwatch label="Uncertain" tier="AMBIGUOUS" />
      </div>
    </div>
  );
}
