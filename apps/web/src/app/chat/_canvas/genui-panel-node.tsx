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
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

import { ScrollArea } from "@nauta/ui/scroll-area";

import { GenuiPartBoundary } from "../_components/genui-part-boundary";
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
  provenance,
  turnIndex,
}: {
  readonly provenance: GenuiPanelNodeData["provenance"];
  readonly turnIndex: number;
}) {
  const { specJson, isStreaming } = useCanvasSpec(provenance);

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
          <GenuiPartBoundary specJson={specJson} isStreaming={isStreaming} />
        </div>
      </ScrollArea>
    </>
  );
});

export const GenuiPanelNode = memo(function GenuiPanelNode({
  data,
  selected,
}: NodeProps<GenuiPanelNodeType>) {
  return (
    <div
      className={`flex h-full min-h-[240px] w-full min-w-[320px] flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm transition-shadow duration-150${selected ? ` ${SELECTED_RING}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <GenuiPanelNodeBody
        provenance={data.provenance}
        turnIndex={data.turnIndex}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
