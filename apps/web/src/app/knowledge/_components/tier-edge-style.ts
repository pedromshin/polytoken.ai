/**
 * tier-edge-style.ts — pure tier -> React Flow edge style map for kne- edges.
 *
 * Applies ONLY to `kne-*` edges (the knowledge_node_edges UNION seam). Structural
 * FK-derived edges never carry a tier and must never receive one of these overrides —
 * enforced by the caller (`toFlowEdges` in knowledge-graph.tsx), not here.
 *
 * Token-only — `hsl(var(--muted-foreground))`, never raw hex (v1.4 bans apply).
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
 * trust tier. EXTRACTED and undefined (defensive — structural edges) return an empty
 * object so React Flow's default stroke/opacity apply (solid, full-opacity).
 */
export function tierEdgeStyle(tier: string | undefined): TierEdgeStyle {
  if (tier === "INFERRED") {
    return {
      style: {
        strokeDasharray: "5 3",
        stroke: "hsl(var(--muted-foreground))",
      },
    };
  }

  if (tier === "AMBIGUOUS") {
    return {
      style: {
        stroke: "hsl(var(--muted-foreground))",
        opacity: 0.45,
      },
      labelStyle: { opacity: 0.6 },
    };
  }

  // EXTRACTED or undefined — no override, React Flow default (solid, full opacity).
  return {};
}
