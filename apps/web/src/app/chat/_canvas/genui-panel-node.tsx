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
 * Chrome per 23-UI-SPEC.md, revised by 26-UI-SPEC.md FIX-04: the `h-9`
 * header row is the ONLY drag handle (`.node-drag-handle` — plan 23-03 sets
 * `dragHandle=".node-drag-handle"` on the mounted `<ReactFlow>`), a
 * `bg-muted/40` fill (one step lighter than `ChatNode`'s `bg-muted/60` — a
 * neutral tonal shift, never a second hue) with `border-border/60`, a
 * `PanelsTopLeft` icon + provenance caption ("From turn {n}"), and — while
 * streaming — an animated `text-primary` pulsing dot with
 * `aria-label="Streaming"`. The outer shell carries no left-edge accent
 * (that stripe is `ChatNode`-only). The body is a fixed-min-dimension
 * (320x240) `ScrollArea` with inner scroll only — the node's own dimensions
 * never change while its spec streams, so the graph never relayouts
 * mid-stream.
 *
 * STATE-01 (23-05): the panel's own `panels.{id}.*` canvas-store slice feeds
 * into the UNMODIFIED `SpecRenderer` via `GenuiPartBoundary`'s `data` prop —
 * the node's own React Flow `id` IS its store panelId (stable across
 * reload, mirrors `use-canvas-persistence.ts`'s `genuiPanelNodeId`).
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { PanelsTopLeft } from "lucide-react";

import { ScrollArea } from "@nauta/ui/scroll-area";

import { GenuiPartBoundary } from "../_components/genui-part-boundary";
import {
  InteractiveWidgetBoundary,
  type InteractiveWidgetPart,
} from "../_components/interactive-widget-boundary";
import { usePanelData, useIncomingEdgesForPanel } from "./canvas-store-context";
import { usePanelActionRegistry } from "./panel-action-bridge";
import { useCanvasPart, useCanvasSpec } from "./canvas-spec-context";
import { useOptionalChatController } from "./chat-node";
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
}: {
  readonly panelId: string;
  readonly provenance: GenuiPanelNodeData["provenance"];
  readonly turnIndex: number;
}) {
  const { specJson, isStreaming } = useCanvasSpec(provenance);
  const part = useCanvasPart(provenance);
  const controller = useOptionalChatController();
  const incomingEdges = useIncomingEdgesForPanel(panelId);
  const { data: panelData, dispatch } = usePanelData(panelId, incomingEdges);
  const actions = usePanelActionRegistry(dispatch);

  // D-08: an interactive_widget part renders the SAME InteractiveWidgetBoundary
  // as the transcript, fed by the SAME controller-derived widget surface — a
  // click in either surface updates both (one message-part source of truth).
  // Rendered variant="bare" so the node shell stays the only bordering layer.
  const isInteractiveWidget = part?.type === "interactive_widget";

  return (
    <>
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <PanelsTopLeft
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate text-xs font-normal text-muted-foreground">
            From turn {turnIndex}
          </span>
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
          {isInteractiveWidget ? (
            <InteractiveWidgetBoundary
              part={part as unknown as InteractiveWidgetPart}
              displayState={
                controller?.widgets.states[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ] ?? "pending"
              }
              submittedValue={
                controller?.widgets.submittedValues[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ]
              }
              errorMessage={
                controller?.widgets.errorMessages[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ] ?? null
              }
              onSubmitResult={(result) =>
                controller?.widgets.onSubmitResult(
                  (part as unknown as InteractiveWidgetPart).interactionId,
                  result,
                )
              }
              variant="bare"
              data={panelData}
            />
          ) : (
            <GenuiPartBoundary
              specJson={specJson}
              isStreaming={isStreaming}
              data={panelData}
              actions={actions}
              variant="bare"
            />
          )}
        </div>
      </ScrollArea>
    </>
  );
});

export const GenuiPanelNode = memo(function GenuiPanelNode({
  id,
  data,
  selected,
}: NodeProps<GenuiPanelNodeType>) {
  return (
    <div
      className={`flex h-full min-h-[240px] w-full min-w-[320px] flex-col overflow-hidden rounded-lg border border-border/60 bg-background transition-shadow duration-150 animate-in fade-in-0 zoom-in-95 duration-[250ms] motion-reduce:animate-none ${selected ? `${SELECTED_RING} shadow-elevation-2` : "shadow-elevation-1"}`}
    >
      <Handle type="target" position={Position.Left} />
      <GenuiPanelNodeBody
        panelId={id}
        provenance={data.provenance}
        turnIndex={data.turnIndex}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
