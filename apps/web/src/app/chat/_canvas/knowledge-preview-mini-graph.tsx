"use client";

/**
 * knowledge-preview-mini-graph.tsx — KnowledgePreviewMiniGraph (PREV-01,
 * 41-UI-SPEC.md sections 2/4/5): the presentational, prop-driven renderer for
 * the `knowledge-preview` canvas node's bounded subgraph.
 *
 * SVG for edges, absolutely-positioned real Next `<Link>`s for nodes — never
 * a second node-graph library instance/provider mount (the confirmed,
 * rejected hazard). Purely presentational: this component does NOT call any
 * tRPC hook itself — the caller (knowledge-preview-node.tsx) owns
 * `knowledge.expandNode` and passes already-fetched raw nodes/edges +
 * loading/error flags down.
 *
 * Branch order (41-UI-SPEC.md section 4's table): loading -> error -> empty
 * (not found) -> empty (no connections) -> success. Every non-loading,
 * non-success branch renders inside the SAME `relative` positioned wrapper so
 * `EmptyState`'s own `absolute inset-0` centered variant anchors correctly.
 *
 * Tier encoding (edges) is imported directly from `tier-edge-style.ts`
 * (single source of truth, never hand-duplicated) so this widget's edges
 * match `/knowledge`'s own tier visual language exactly. Every node
 * dot/footer href is computed via `hrefFor("knowledge", id)` — never a
 * hand-duplicated route string.
 */

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Share2 } from "lucide-react";

import type { RouterOutputs } from "@nauta/api-client";
import { Skeleton } from "@nauta/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nauta/ui/tooltip";

import { EmptyState } from "~/components/empty-state";
import { hrefFor } from "~/components/provenance-link";
import { tierEdgeStyle } from "~/app/knowledge/_components/tier-edge-style";

import {
  layoutPreview,
  orderTwoHopByParent,
  trimPreviewGraph,
} from "./knowledge-preview-layout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreviewSourceNode = RouterOutputs["knowledge"]["expandNode"]["nodes"][number];
export type PreviewSourceEdge = RouterOutputs["knowledge"]["expandNode"]["edges"][number];

export interface KnowledgePreviewMiniGraphProps {
  readonly focusNodeId: string;
  readonly nodes: ReadonlyArray<PreviewSourceNode>;
  readonly edges: ReadonlyArray<PreviewSourceEdge>;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
}

type PreviewPositions = Record<string, { readonly x: number; readonly y: number }>;

const PREVIEW_BOX = { width: 280, height: 140 } as const;

// ---------------------------------------------------------------------------
// PreviewEdge — a single SVG line, tier-styled via tierEdgeStyle (imported,
// never hand-duplicated)
// ---------------------------------------------------------------------------

function PreviewEdge({
  edge,
  positions,
}: {
  readonly edge: PreviewSourceEdge;
  readonly positions: PreviewPositions;
}): React.ReactElement | null {
  const from = positions[edge.source];
  const to = positions[edge.target];
  if (from === undefined || to === undefined) return null;

  const style = tierEdgeStyle(edge.tier);

  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={style.style?.stroke ?? "hsl(var(--foreground))"}
      strokeWidth={1.5}
      strokeDasharray={style.style?.strokeDasharray}
      opacity={style.style?.opacity ?? 1}
    />
  );
}

// ---------------------------------------------------------------------------
// PreviewNodeDot — a real, Tooltip-wrapped <Link> per node, sized/styled by
// distance-from-focus (41-UI-SPEC.md's node-dot tables)
// ---------------------------------------------------------------------------

const DOT_SIZE_CLASS: Readonly<Record<0 | 1 | 2, string>> = {
  0: "size-5",
  1: "size-3",
  2: "size-2",
};

const DOT_COLOR_CLASS: Readonly<Record<0 | 1 | 2, string>> = {
  0: "bg-primary/15 border-2 border-primary shadow-[0_0_8px_hsl(164_39%_22%/0.35)]",
  1: "bg-primary/10 border border-primary/30",
  2: "bg-muted border border-border/60",
};

const LABEL_CLASS: Readonly<Record<0 | 1, string>> = {
  0: "text-xs font-semibold text-primary max-w-[64px] truncate",
  1: "text-xs font-normal text-foreground max-w-[56px] truncate",
};

function PreviewNodeDot({
  node,
  position,
  distance,
}: {
  readonly node: PreviewSourceNode;
  readonly position: { readonly x: number; readonly y: number } | undefined;
  readonly distance: 0 | 1 | 2;
}): React.ReactElement | null {
  if (position === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={hrefFor("knowledge", node.id)}
          aria-label={`Open ${node.label} in Knowledge graph`}
          style={{
            left: position.x,
            top: position.y,
            transform: "translate(-50%, -50%)",
          }}
          className="absolute flex min-h-6 min-w-6 flex-col items-center justify-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span
            className={`flex shrink-0 items-center justify-center rounded-full ${DOT_SIZE_CLASS[distance]} ${DOT_COLOR_CLASS[distance]}`}
          >
            {distance === 0 ? <Share2 className="size-3 text-primary" aria-hidden /> : null}
          </span>
          {distance !== 2 ? <span className={LABEL_CLASS[distance]}>{node.label}</span> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{node.label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// KnowledgePreviewMiniGraph
// ---------------------------------------------------------------------------

export function KnowledgePreviewMiniGraph({
  focusNodeId,
  nodes,
  edges,
  isLoading,
  isError,
  onRetry,
}: KnowledgePreviewMiniGraphProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading knowledge preview"
        className="relative flex flex-1 items-center justify-center gap-2 p-3"
      >
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="size-3 rounded-full" />
        <Skeleton className="size-3 rounded-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="relative flex-1">
        <EmptyState
          icon={AlertCircle}
          tone="destructive"
          layout="centered"
          size="compact"
          heading="Couldn't load this preview."
          body="Try again, or open the full graph."
          action={{ label: "Retry", onClick: onRetry }}
        />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="relative flex-1">
        <EmptyState
          icon={Share2}
          tone="muted"
          layout="centered"
          size="compact"
          heading="This preview is unavailable."
          body="The knowledge node may have been removed or is no longer accessible."
        />
      </div>
    );
  }

  if (nodes.length === 1) {
    return (
      <div className="relative flex-1">
        <EmptyState
          icon={Share2}
          tone="muted"
          layout="centered"
          size="compact"
          heading="No connections yet."
          body="This knowledge node isn't linked to others yet."
        />
      </div>
    );
  }

  const trimmed = trimPreviewGraph(focusNodeId, nodes, edges);
  const orderedTwoHop = orderTwoHopByParent(trimmed.oneHopIds, trimmed.twoHopIds, trimmed.edges);
  const positions: PreviewPositions = layoutPreview(
    focusNodeId,
    trimmed.oneHopIds,
    orderedTwoHop,
    PREVIEW_BOX,
  );

  const oneHopIdSet = new Set(trimmed.oneHopIds);
  const distanceOf = (id: string): 0 | 1 | 2 => {
    if (id === focusNodeId) return 0;
    if (oneHopIdSet.has(id)) return 1;
    return 2;
  };

  return (
    <div className="relative flex flex-1 items-center justify-center p-3">
      <div
        style={{ width: PREVIEW_BOX.width, height: PREVIEW_BOX.height }}
        className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      >
        <svg
          width={PREVIEW_BOX.width}
          height={PREVIEW_BOX.height}
          className="absolute inset-0"
          aria-hidden
        >
          {trimmed.edges.map((edge) => (
            <PreviewEdge key={edge.id} edge={edge} positions={positions} />
          ))}
        </svg>
        <TooltipProvider delayDuration={300}>
          <div role="group" aria-label="Related knowledge nodes" className="absolute inset-0">
            {trimmed.nodes.map((node) => (
              <PreviewNodeDot
                key={node.id}
                node={node}
                position={positions[node.id]}
                distance={distanceOf(node.id)}
              />
            ))}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
