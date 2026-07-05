"use client";

/**
 * genui-panel-node.tsx — GenuiPanelNode: the canvas's genui-panel custom
 * React Flow node (CANVAS-03, CANVAS-04, D-07, D-09).
 *
 * Renders a genui spec by provenance through the UNMODIFIED SpecRenderer via
 * the existing GenuiPartBoundary — never patched, forked, or reimplemented.
 * `node.data` carries ONLY the provenance ref (`GenuiPanelNodeData`); the
 * volatile spec content is read from `CanvasSpecContext` via `useCanvasSpec`,
 * never lifted into the React Flow `nodes` array (D-07: a streamed token must
 * never force a full-array `setNodes` identity change).
 *
 * Chrome per 23-UI-SPEC.md: the `h-9` header row is the ONLY drag handle
 * (`.node-drag-handle` — plan 23-03 sets `dragHandle=".node-drag-handle"` on
 * the mounted `<ReactFlow>`), `bg-muted/60 border-border/60`, a provenance
 * caption ("From turn {n}"), and — while streaming — an animated
 * `text-primary` pulsing dot with `aria-label="Streaming"`. The body is a
 * fixed-min-dimension (320x240) `ScrollArea` with inner scroll only — the
 * node's own dimensions never change while its spec streams, so the graph
 * never relayouts mid-stream.
 *
 * STATE-01 (23-05): the panel's own `panels.{id}.*` canvas-store slice feeds
 * into the UNMODIFIED `SpecRenderer` via `GenuiPartBoundary`'s `data` prop —
 * the node's own React Flow `id` IS its store panelId (stable across
 * reload, mirrors `use-canvas-persistence.ts`'s `genuiPanelNodeId`).
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

import { ScrollArea } from "@nauta/ui/scroll-area";

import { GenuiPartBoundary } from "../_components/genui-part-boundary";
import { usePanelData, type IncomingDataEdge } from "./canvas-store-context";
import { useCanvasSpec } from "./canvas-spec-context";
import type { GenuiPanelNodeData } from "./node-data-schemas";

export type GenuiPanelNodeType = Node<GenuiPanelNodeData, "genui-panel">;

const SELECTED_RING = "ring-2 ring-primary ring-offset-1";

/**
 * GenuiPanelNodeBody — heavy content (spec render) split from the node shell:
 * React Flow's per-drag-tick position props defeat the node component's memo,
 * but this body's props (provenance ref + turnIndex) are stable, so the
 * SpecRenderer tree never re-renders mid-drag (CANVAS-04; found live
 * 2026-07-04).
 */
const GenuiPanelNodeBody = memo(function GenuiPanelNodeBody({
  panelId,
  provenance,
  turnIndex,
  incomingEdges,
}: {
  readonly panelId: string;
  readonly provenance: GenuiPanelNodeData["provenance"];
  readonly turnIndex: number;
  readonly incomingEdges: readonly IncomingDataEdge[];
}) {
  const { specJson, isStreaming } = useCanvasSpec(provenance);
  const { data: panelData } = usePanelData(panelId, incomingEdges);

  return (
    <>
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border/60 bg-muted/60 px-3 active:cursor-grabbing">
        <span className="truncate text-xs font-normal text-muted-foreground">
          From turn {turnIndex}
        </span>
        {isStreaming && (
          <span
            className="text-primary motion-safe:animate-pulse"
            aria-label="Streaming"
          >
            ●
          </span>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <GenuiPartBoundary specJson={specJson} isStreaming={isStreaming} data={panelData} />
        </div>
      </ScrollArea>
    </>
  );
});

// Task 3 seam (STATE-02, data-carrying edges): React Flow's `NodeProps` only
// ever carries `{id, data, selected, ...}` for a custom node — there is no
// channel to pass this panel's INCOMING edges (computed from the canvas
// host's own `edges` array) straight into a `nodeTypes` component. Task 3
// wires real edges through a context seam (mirrors `CanvasSpecContext`'s own
// shape) rather than a prop; kept empty here so Task 2 lands the store
// wiring without depending on edges that don't exist yet.
const NO_INCOMING_EDGES: readonly IncomingDataEdge[] = [];

export const GenuiPanelNode = memo(function GenuiPanelNode({
  id,
  data,
  selected,
}: NodeProps<GenuiPanelNodeType>) {
  return (
    <div
      className={`flex h-full min-h-[240px] w-full min-w-[320px] flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm transition-shadow duration-150${selected ? ` ${SELECTED_RING}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <GenuiPanelNodeBody
        panelId={id}
        provenance={data.provenance}
        turnIndex={data.turnIndex}
        incomingEdges={NO_INCOMING_EDGES}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
