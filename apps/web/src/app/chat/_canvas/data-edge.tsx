"use client";

/**
 * data-edge.tsx — DataEdge: the custom React Flow edge for a data-carrying
 * edge (STATE-02, D-09). `smoothstep` base path, the edge's own `markerEnd`
 * (`MarkerType.ArrowClosed`, set at construction time in `chat-canvas.tsx`),
 * and an ALWAYS-VISIBLE midpoint label pill `{sourcePath} → {targetKey}`
 * (never hidden behind a hover state — 23-UI-SPEC.md: "makes wiring legible
 * without opening the picker"). `animated` is never set true anywhere this
 * edge is constructed (reduced-motion posture, 23-UI-SPEC.md Accessibility)
 * — no flowing-dashed-edge styling.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE WIRE IS NEUTRAL — the sentence that stops the next "improvement"
 * ────────────────────────────────────────────────────────────────────────
 *
 * A `DataEdge` wires `sourcePath -> targetKey`. That is PLUMBING, not
 * PROVENANCE: it carries a value from one panel to another and makes no claim
 * about whether anything is confirmed, suggested, or true. Law 1 says colour is
 * earned, so this edge earns none — it takes `CANVAS_EDGE_TIER.neutral`, the
 * structural `--edge` wire, and no hue.
 *
 * Someone will eventually want to make it verdigris because "green means
 * connected". That is the reading law 1 exists to prevent: verdigris means
 * CONFIRMED, and a data wire confirms nothing. `CANVAS_EDGE_TIER`'s `confirmed`
 * / `suggested` members exist for /knowledge's tier edges (Phase 62) and Phase
 * 63's provenance edges. They are not for this edge.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THE PATH IS STYLED THROUGH `style` AND NOT `className` — READ FIRST
 * ────────────────────────────────────────────────────────────────────────
 *
 * This file used to force an ink stroke through a class carrying an important
 * marker, and that marker was NOT a specificity hack — it was a CASCADE-LAYER
 * workaround, which is why deleting it "to clean it up" would silently
 * un-style the wire rather than tidy it.
 *
 * `@xyflow/react/dist/style.css` is imported from a client component, so Next
 * emits it UNLAYERED, and an unlayered normal declaration beats anything in a
 * Tailwind cascade layer *before specificity is consulted*. `.react-flow__
 * edge-path` sets `stroke` AND `stroke-width` from `--xy-*` variables in that
 * unlayered rule, so a layered utility — including every class in
 * `CANVAS_EDGE_TIER.neutral.path` — can never win here. Applying that class
 * string would look right and be dead: 61-05 set `--xy-edge-stroke: var(--edge)`,
 * so the colour would AGREE by accident while the sketch's 1.5 width silently
 * lost to a stock default of 1. And the `!` cannot be re-added programmatically
 * — Tailwind v4 scans for literal strings, so a runtime `` `!${x}` `` emits
 * nothing.
 *
 * So the tier's facts arrive as VALUES (`CANVAS_EDGE_TIER_STYLE`, the projection
 * 61-06 added to the vocabulary for exactly this) applied inline, where nothing
 * can outrank them. `canvas-node-law.test.tsx` asserts that projection agrees
 * with `CANVAS_EDGE_TIER`'s class map, so the two spellings cannot drift.
 *
 * The ARROWHEAD is themed separately, at `chat-canvas.tsx`'s
 * `DATA_EDGE_MARKER_END` — React Flow computes the marker's colour in JS and
 * writes it as an inline style, so no stylesheet (and no gate that reads one)
 * can reach it. That is the one place the wire's appearance is not decided here.
 *
 * Clicking the label pill re-opens `EdgeCreationPicker` pre-filled (the
 * "edit an existing edge" interaction). React Flow's custom edge components
 * have no channel for a host-level callback beyond `data` (and stashing a
 * closure there would leak into `buildSnapshot`'s persisted payload unless
 * explicitly filtered) — `EdgeLabelClickProvider` threads a STABLE callback
 * through context instead (mirrors `CanvasSpecContext`/`ChatControllerContext`'s
 * own seam shape), so persisted `edge.data` stays exactly
 * `{ sourcePath, targetKey }` everywhere.
 */

// Explicit React import (not just the named hooks) — this file's JSX compiles
// fine under Next's SWC automatic runtime, but vitest's plain esbuild transform
// defaults to the CLASSIC runtime (React.createElement) and needs `React` in
// scope whenever a test mounts this component directly. The `React.ReactElement`
// / `React.MouseEvent` annotations below resolved through the global UMD
// namespace at TYPE level, which is why nothing ever complained: until 61-06's
// `canvas-node-law.test.tsx`, **no test had ever mounted this edge**, so the
// missing runtime binding had never been exercised. The first mount threw
// `ReferenceError: React is not defined`. (Same note as genui-panel-node.tsx.)
import * as React from "react";
import { createContext, useContext, type ReactNode } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

import { CANVAS_EDGE_TIER_STYLE } from "./canvas-vocabulary";

export interface DataEdgeClickPayload {
  readonly edgeId: string;
  readonly source: string;
  readonly target: string;
  readonly sourcePath: string;
  readonly targetKey: string;
  readonly clientX: number;
  readonly clientY: number;
}

type EdgeLabelClickHandler = (payload: DataEdgeClickPayload) => void;

const EdgeLabelClickContext = createContext<EdgeLabelClickHandler | null>(null);

export interface EdgeLabelClickProviderProps {
  readonly children: ReactNode;
  readonly onLabelClick: EdgeLabelClickHandler;
}

/** Wraps the canvas tree so every `DataEdge`'s label pill routes clicks
 * through ONE stable handler (`chat-canvas.tsx` opens `EdgeCreationPicker`
 * in "edit" mode, pre-filled from the clicked edge). */
export function EdgeLabelClickProvider({
  children,
  onLabelClick,
}: EdgeLabelClickProviderProps): React.ReactElement {
  return (
    <EdgeLabelClickContext.Provider value={onLabelClick}>
      {children}
    </EdgeLabelClickContext.Provider>
  );
}

export interface DataEdgeData extends Record<string, unknown> {
  readonly sourcePath: string;
  readonly targetKey: string;
}

/**
 * The wire's paint. A data edge states NO tier (see the file header), so this
 * is `neutral` and can never be anything else without a reason law 1 would
 * accept. Hoisted to module scope so it is one stable object rather than a new
 * one per render.
 */
const NEUTRAL_WIRE = CANVAS_EDGE_TIER_STYLE.neutral;

export function DataEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps): React.ReactElement {
  const onLabelClick = useContext(EdgeLabelClickContext);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as Partial<DataEdgeData> | undefined;
  const sourcePath = typeof edgeData?.sourcePath === "string" ? edgeData.sourcePath : "";
  const targetKey = typeof edgeData?.targetKey === "string" ? edgeData.targetKey : "";

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    onLabelClick?.({
      edgeId: id,
      source,
      target,
      sourcePath,
      targetKey,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={NEUTRAL_WIRE}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        {/* The sketch's `.edgelabel`: --faded on a --leaf chip, micro step,
            tiny radius, NO shadow (it wore `shadow-sm` and a 80%-opaque page
            ground — the identity's line is "zero shadow anywhere", and a label
            that lets the wire show through it is not a label, it is a smudge).
            ALWAYS visible, never hover-gated — 23-UI-SPEC: it "makes wiring
            legible without opening the picker". */}
        <button
          type="button"
          onClick={handleClick}
          className="nodrag nopan absolute rounded-sm border border-hair bg-leaf px-chip-x py-px text-2xs text-faded"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          aria-label={`Edit connection: ${sourcePath} to ${targetKey}`}
        >
          {sourcePath} {"→"} {targetKey}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
