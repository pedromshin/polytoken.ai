"use client";

/**
 * code-island-node.tsx — CodeIslandNode: the canvas's `code-island` custom React
 * Flow node (Phase 76 / BTAP-03) — a bespoke disposable mini-app grounded in the
 * user's real data.
 *
 * This is the weld the whole phase exists for: the shipped jailed-eval generator
 * (Phase 20) + the reactive dataflow spine (Phase 73). Ref-only like every
 * sibling — `node.data` carries ONLY an `islandId` (+ optional label), NEVER the
 * generated code. The winning program + its input bindings rehydrate HERE via
 * `api.codeIslands.byId` (ownership-gated; a row owned by another user surfaces
 * as NULL, TENA-03). The node does NOT re-call the non-deterministic generator
 * on mount — the persisted `code` is the source of truth for THIS island.
 *
 * THE DATA FLOWS, NEVER THE CODE-TO-MODEL: the node's incoming data-edges are
 * collected through the UNCHANGED `usePanelData` overlay (`useIncomingEdgesForPanel`
 * → resolved `{targetKey: projection}` map). That map is fed into the jail as the
 * frozen `window.__ISLAND_DATA__` global (build-island-srcdoc BTAP-01) — the
 * generated app computes over the real rows, but the frame's `connect-src 'none'`
 * CSP means the network can never leak them. When a wired source's published
 * projection changes, `usePanelData` re-resolves → the injected `data` changes →
 * `<CodeIslandFrame>` re-renders the frame over the new numbers, WITHOUT
 * restarting the repair pipeline (the `code` prop is stable). Recompute for free.
 *
 * Remove is INK, not madder: dropping the card only removes the placement
 * (`deleteElements`); the `code_islands` row survives (disposability is
 * `codeIslands.remove`, BTAP-10) — mirrors spreadsheet-node.tsx.
 */

import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Boxes, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";
import { serializeIslandData } from "@polytoken/genui/sandbox";

import { api } from "~/trpc/react";
import { CodeIslandFrame } from "~/app/studio/_components/code-island-frame";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import {
  usePanelData,
  useIncomingEdgesForPanel,
} from "./canvas-store-context";
import type { CodeIslandNodeData } from "./node-data-schemas";

export type CodeIslandNodeType = Node<CodeIslandNodeData, "code-island">;

/** explicit label wins → the island's own `intent` once loaded → fallback. */
export function resolveHeaderLabel(
  customLabel: string | undefined,
  intent: string | null | undefined,
): string {
  if (customLabel !== undefined) return customLabel;
  if (intent) return intent;
  return "App";
}

export const CodeIslandNode = memo(function CodeIslandNode({
  id,
  data,
  selected,
}: NodeProps<CodeIslandNodeType>) {
  const { deleteElements } = useReactFlow();

  // Collect this node's incoming data-edges and overlay their resolved source
  // projections at their targetKeys — the SAME reactive engine every other
  // data-wired node uses (Phase 73). `panelData` is the `{targetKey: projection}`
  // map that becomes the island's __ISLAND_DATA__.
  const incomingEdges = useIncomingEdgesForPanel(id);
  const { data: panelData } = usePanelData(id, incomingEdges);

  const query = api.codeIslands.byId.useQuery({ islandId: data.islandId });
  const island = query.data;
  const headerLabel = resolveHeaderLabel(data.label, island?.intent);

  // Surface the real reason if the wired inputs can't be safely injected
  // (over-cap / pollution / unserializable) — the frame would silently degrade
  // to empty data otherwise (BTAP-01: the node surfaces the reason).
  const dataIssue = useMemo(() => {
    if (incomingEdges.length === 0) return null;
    const result = serializeIslandData(panelData);
    return result.ok ? null : result.reason;
  }, [incomingEdges.length, panelData]);

  return (
    <div
      className={`flex h-[520px] w-[560px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["code-island"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Boxes className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The island's intent is the user's own words — SERIF + data-evidence. */}
          <span
            className="truncate font-serif text-xs font-semibold text-ink"
            data-evidence
          >
            {headerLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove app"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — the jailed frame owns its own scroll/pointer, so nowheel/nodrag
          keeps the gesture inside the app instead of panning the board. */}
      <div className="nowheel nodrag relative flex flex-1 flex-col gap-2 overflow-auto p-2">
        {query.isPending ? (
          <div role="status" aria-label="Loading app" className="flex flex-col gap-2 p-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t load this app. Try again, or rebuild it from your data.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : island == null ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <Boxes className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              This app is unavailable. It may have been removed or is no longer accessible.
            </p>
          </div>
        ) : (
          <>
            {dataIssue !== null ? (
              <p className="rounded-sm border border-hair bg-leaf px-2 py-1 text-2xs text-faded">
                Wired data couldn&apos;t be passed to this app
                {dataIssue === "oversize"
                  ? " (too large — showing a bounded view)"
                  : dataIssue === "pollution"
                    ? " (unsafe keys stripped)"
                    : " (not serializable)"}
                . The app runs without it.
              </p>
            ) : null}
            {/* The jailed frame — code from the persisted row, data from the live
                overlay. The whole safety stack (allowlist + opaque origin +
                connect-src 'none') runs inside CodeIslandFrame unchanged. */}
            <CodeIslandFrame code={island.code} data={panelData} />
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
