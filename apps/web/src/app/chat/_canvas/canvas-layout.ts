/**
 * canvas-layout.ts — dagre LR layout utility for the /chat canvas (D-03),
 * a pure port of `/knowledge`'s `graph-layout.ts` `layoutGraph` using this
 * canvas's own node dimensions and rank direction.
 *
 * `layoutCanvasNodes` assigns EVERY node's position once, at materialization
 * time (canvas mount, or a fresh history-derived layout) — never mutates
 * `nodes`/`edges`, always returns a NEW node array (CLAUDE.md immutability).
 *
 * `offsetCascadePosition` is the D-03 fallback for a node materializing
 * live (a genui_spec turn completing while the canvas is already open):
 * nudges a desired rect by a fixed +32,+32 step until it clears every
 * existing node's rect — this positioning event never touches the
 * `nodes` array's volatile streaming content (D-07), only the ONE new
 * node's position, assigned once.
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Fixed node dimensions per 23-UI-SPEC.md Node Visual Language
// ---------------------------------------------------------------------------

export const CANVAS_NODE_DIMENSIONS: Readonly<
  Record<string, { readonly width: number; readonly height: number }>
> = {
  chat: { width: 400, height: 320 },
  "genui-panel": { width: 320, height: 240 },
  "knowledge-preview": { width: 320, height: 240 },
  "email-thread": { width: 320, height: 220 },
};

export const DEFAULT_CANVAS_NODE_DIMENSIONS = { width: 320, height: 240 };

function dimensionsFor(nodeType: string | undefined): {
  readonly width: number;
  readonly height: number;
} {
  return CANVAS_NODE_DIMENSIONS[nodeType ?? ""] ?? DEFAULT_CANVAS_NODE_DIMENSIONS;
}

// ---------------------------------------------------------------------------
// layoutCanvasNodes — dagre LR layout
// ---------------------------------------------------------------------------

/**
 * Apply dagre LR layout to React Flow canvas nodes/edges (chat node leads,
 * genui panels fan out to the right). Returns a NEW array of nodes with
 * computed `position` — inputs are never mutated.
 *
 * `nodesep: 64` (26-UI-SPEC.md POLISH-02): every genui-panel directly
 * connected to the chat node lands in the SAME dagre rank, so this is the
 * gutter between SIBLING panels stacked within that rank — bumped from the
 * prior `32` to the next 8-pt step so same-rank panels get real vertical
 * breathing room instead of cramming. `ranksep: 64` (rank-to-rank distance,
 * chat -> panel column) is unchanged.
 */
export function layoutCanvasNodes<NodeData extends Record<string, unknown>>(
  nodes: ReadonlyArray<Node<NodeData>>,
  edges: ReadonlyArray<Edge>,
): Array<Node<NodeData>> {
  const g = new dagre.graphlib.Graph();

  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    ranksep: 64,
    nodesep: 64,
  });

  for (const node of nodes) {
    const dims = dimensionsFor(node.type);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Map dagre center positions -> React Flow top-left positions
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const dims = dimensionsFor(node.type);

    return {
      ...node,
      position: {
        x: dagreNode.x - dims.width / 2,
        y: dagreNode.y - dims.height / 2,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// offsetCascadePosition — D-03 live-materialization fallback
// ---------------------------------------------------------------------------

export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const CASCADE_STEP_PX = 32;
// Defensive upper bound — a pathologically dense canvas (thousands of
// overlapping nodes) still terminates rather than looping forever; in
// practice a per-chat canvas holds a handful of panels (23-UI-SPEC.md).
const MAX_CASCADE_ITERATIONS = 200;

function rectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * offsetCascadePosition — nudges `desired` (a full rect: position + size)
 * by `+32,+32` steps until it clears every rect in `existing`. Pure —
 * neither argument is mutated; returns a new `{x, y}` position.
 */
export function offsetCascadePosition(
  desired: CanvasRect,
  existing: ReadonlyArray<CanvasRect>,
): { readonly x: number; readonly y: number } {
  let candidate = { x: desired.x, y: desired.y };

  for (let i = 0; i < MAX_CASCADE_ITERATIONS; i += 1) {
    const candidateRect: CanvasRect = {
      x: candidate.x,
      y: candidate.y,
      width: desired.width,
      height: desired.height,
    };
    const overlaps = existing.some((rect) => rectsOverlap(candidateRect, rect));
    if (!overlaps) {
      return candidate;
    }
    candidate = {
      x: candidate.x + CASCADE_STEP_PX,
      y: candidate.y + CASCADE_STEP_PX,
    };
  }

  return candidate;
}
