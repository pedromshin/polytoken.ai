/**
 * tier-edge-style.ts — pure tier -> React Flow edge style map for kne- edges.
 *
 * Applies ONLY to `kne-*` edges (the knowledge_node_edges UNION seam). Structural
 * FK-derived edges never carry a tier and must never receive one of these overrides —
 * enforced by the caller (`toFlowEdges` in knowledge-graph.tsx), not here.
 *
 * Token-only — the purpose-built tier ladder (D-48-04: `hsl(var(--tier-inferred))` /
 * `hsl(var(--tier-extracted))`), never `--muted-foreground` (overloaded) and never
 * raw hex (v1.4 bans apply).
 *
 * Single source of truth for the legend's `LegendSwatch` values too — do not
 * hand-duplicate the stroke/dash/opacity numbers elsewhere.
 */

import type { CSSProperties } from "react";

export interface TierEdgeStyle {
  readonly style?: CSSProperties;
  readonly labelStyle?: CSSProperties;
}

/**
 * Returns the React Flow `style`/`labelStyle` override for a given knowledge-node-edge
 * trust tier. undefined (defensive — structural edges) returns an empty object so
 * React Flow's default stroke/opacity apply (solid, full-opacity).
 */
export function tierEdgeStyle(tier: string | undefined): TierEdgeStyle {
  if (tier === "INFERRED") {
    return {
      style: {
        strokeDasharray: "5 3",
        stroke: "hsl(var(--tier-inferred))",
      },
    };
  }

  if (tier === "AMBIGUOUS") {
    return {
      style: {
        stroke: "hsl(var(--tier-inferred))",
        opacity: 0.45,
      },
      labelStyle: { opacity: 0.6 },
    };
  }

  if (tier === "EXTRACTED") {
    return {
      style: {
        stroke: "hsl(var(--tier-extracted))",
      },
    };
  }

  // undefined — structural FK edge, no override, React Flow default (solid, full opacity).
  return {};
}
