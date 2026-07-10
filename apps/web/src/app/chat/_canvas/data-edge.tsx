"use client";

/**
 * data-edge.tsx — DataEdge: the custom React Flow edge for a data-carrying
 * edge (STATE-02, D-09). `smoothstep` base path (matches `/knowledge`'s
 * default edge styling), `stroke-primary` + the edge's own `markerEnd`
 * (`MarkerType.ArrowClosed`, set at construction time in `chat-canvas.tsx`),
 * and an ALWAYS-VISIBLE midpoint label pill `{sourcePath} → {targetKey}`
 * (never hidden behind a hover state — 23-UI-SPEC.md: "makes wiring legible
 * without opening the picker"). `animated` is never set true anywhere this
 * edge is constructed (reduced-motion posture, 23-UI-SPEC.md Accessibility)
 * — no flowing-dashed-edge styling.
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

import { createContext, useContext, type ReactNode } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

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
        className="!stroke-primary"
        style={{ strokeWidth: 2 }}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={handleClick}
          className="nodrag nopan absolute rounded-pill border border-border/60 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground shadow-sm"
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
