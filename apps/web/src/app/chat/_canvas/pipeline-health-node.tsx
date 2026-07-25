"use client";

/**
 * pipeline-health-node.tsx — PipelineHealthNode: the canvas's `pipeline-health`
 * custom React Flow node. It surfaces the ALREADY-SHIPPED inbox "Pipeline
 * health" panel as a placeable canvas card — "did my forwarded mail actually
 * make it through analysis?", now droppable on the board next to the threads
 * and landscapes it explains.
 *
 * DATA SOURCE — reuse, not reinvent. The inbox panel
 * (`app/_components/pipeline-health-panel.tsx`) already owns the fetch: its
 * exported `usePipelineHealth()` hook hits the server-keyed Next proxy
 * `GET /api/pipeline/health`, which forwards the acting user's verified id to
 * the listener's `GET /v1/pipeline/health` (per-importer counts scoped to
 * ownership server-side) and shapes the payload through
 * `shapePipelineHealth` (`~/lib/pipeline-health`). This node calls THAT SAME
 * hook — one honest data path, one place to fix on contract drift — so the
 * card renders identical rows to the rail without a second data layer. There
 * is no tRPC procedure for this listener-owned aggregate by design (the panel's
 * header explains why); the proxy IS the owner-scoped, web-reachable source.
 *
 * REF-ONLY node.data (like every sibling): the card carries only an optional
 * display `label` — never fetched counts. The rows rehydrate HERE on every
 * mount, because pipeline counts change as mail arrives and analysis runs.
 *
 * States mirror the panel's honest contract (the UI-5 lesson: errors get a
 * frame and a retry, not an infinite shimmer): loading skeleton → framed
 * error with Retry → empty ("no activity yet") → the per-importer list. A
 * failure is announced by a glyph + a border-rule frame, NEVER a hue (law 1:
 * colour is earned; a STATE earns none). Counts are `tabular`.
 *
 * GESTURE ISOLATION: the scrolling body wears `nowheel nopan nodrag` so a
 * wheel/drag over a long importer list scrolls the list instead of panning the
 * board (mirrors circle-pack-node / spreadsheet-node). The header keeps
 * `node-drag-handle`, so the card still drags by its title bar.
 *
 * Remove is INK, not madder (T-61-19): dropping the card from the board is not
 * irreversible — the pipeline, its counts, and the inbox panel are untouched;
 * only the placement drops, and it re-adds from the same popover.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Activity, TriangleAlert, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";

import { usePipelineHealth } from "~/app/_components/pipeline-health-panel";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type PipelineHealthNodeData } from "./node-data-schemas";

export type PipelineHealthNodeType = Node<PipelineHealthNodeData, "pipeline-health">;

function resolveLabel(data: PipelineHealthNodeData): string {
  return data.label ?? "Pipeline health";
}

export const PipelineHealthNode = memo(function PipelineHealthNode({
  id,
  data,
  selected,
}: NodeProps<PipelineHealthNodeType>) {
  const { deleteElements } = useReactFlow();
  const { state, reload } = usePipelineHealth();
  const label = resolveLabel(data);

  return (
    <div
      className={`flex h-[340px] w-[360px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["pipeline-health"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Activity className="size-3 shrink-0 text-faded" aria-hidden />
          {/* polytoken's word for the view — chrome, sans (law 2). */}
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove pipeline health"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* GESTURE ISOLATION — `nowheel nopan nodrag` keep a wheel/drag over the
          importer list scrolling the list rather than panning the board. */}
      <div className="nowheel nopan nodrag relative flex-1 overflow-y-auto px-3 py-2">
        {state.status === "loading" && (
          <div role="status" aria-label="Loading pipeline health" className="space-y-2">
            <Skeleton className="h-3 w-28 rounded-sm" />
            <Skeleton className="h-3 w-20 rounded-sm" />
            <Skeleton className="h-3 w-24 rounded-sm" />
            <Skeleton className="h-3 w-16 rounded-sm" />
          </div>
        )}

        {state.status === "error" && (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            {/* INK, not madder — a failed load is a STATE, never an
                irreversible action (§3: "an error is ink on a rule"). */}
            <TriangleAlert className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs font-semibold text-ink">Pipeline status unavailable.</p>
            <Button type="button" variant="outline" size="sm" className="mt-1" onClick={reload}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && state.rows.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <Activity className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              No pipeline activity yet — counts appear as mail arrives.
            </p>
          </div>
        )}

        {state.status === "ready" && state.rows.length > 0 && (
          <ul className="flex flex-col gap-2.5" aria-label="Per-importer pipeline counts">
            {state.rows.map((row) => (
              <li key={row.importerId} className="text-xs">
                {/* The importer's display name — polytoken's chrome (a label
                    it derived or a shortened id), so sans (law 2). */}
                <div className="truncate font-semibold text-ink" title={row.displayName}>
                  {row.displayName}
                </div>
                <div className="tabular mt-0.5 text-pencil">
                  {row.received} received · {row.fullyAnalyzed} analyzed
                </div>
                {row.failedTotal > 0 && (
                  <div className="mt-1 border border-rule p-1.5">
                    <div className="flex items-center gap-1 font-semibold text-ink">
                      <TriangleAlert className="size-3 shrink-0" aria-hidden />
                      <span className="tabular">{row.failedTotal} failed</span>
                    </div>
                    <ul className="tabular mt-0.5 text-pencil" aria-label="Failures by stage">
                      {row.failedByStage.map((failure) => (
                        <li key={failure.stage}>
                          {failure.stage} × {failure.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
