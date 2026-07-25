"use client";

/**
 * usage-node.tsx — UsageNode: the canvas's `usage` custom React Flow node. A
 * live SPEND METER (system-to-user): today's model spend measured against the
 * configured day cap, as a small bar plus the numbers behind it.
 *
 * NO NEW TABLE. This node reads the EXISTING chat_cost_ledger through the
 * owner-scoped `chat.summary` query (packages/api-client's chat/cost.ts, added
 * this wave). That query is the READ side of the same accounting the FastAPI
 * cost breaker (22-04) ENFORCES: the breaker gates turns and never exposes a
 * cap parameter; this meter only reports the caller's spend against those caps.
 * The day sum is scoped by `ctx.user.id` (the ledger's direct ownership anchor,
 * Phase 44) over the SAME UTC-day window the breaker's `_day_cap_breached`
 * uses, so the meter and the gate agree on what "today" means.
 *
 * REF-ONLY node.data (like every sibling, node-data-schemas.ts): `node.data`
 * carries at most an optional display `label`. The spend is DERIVED,
 * owner-scoped server-side, and changes every turn — so it is fetched live
 * HERE, never persisted into node.data (`.strict()`). The node passes NO
 * conversationId, so it renders the day meter (spendSessionUsd is null and
 * unused here).
 *
 * States mirror the established branch order (loading -> error -> success). The
 * meter has no "empty" state distinct from success: zero spend is a legitimate,
 * meaningful reading ("$0.00 of $5.00 today"), not an absence — so a fresh
 * account renders a real, empty bar rather than an empty-state placeholder.
 *
 * GESTURE ISOLATION: the body wears `nowheel nopan nodrag` so a wheel/drag over
 * the meter doesn't pan the board; the header keeps `node-drag-handle`, so the
 * card still drags by its title bar (mirrors brief-node / review-queue-node).
 *
 * Remove is INK, not madder: dropping this card from the board is not
 * irreversible (the ledger and every usage row survive; only the placement
 * goes), so it follows the shared remove-button recipe.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Gauge, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type UsageNodeData } from "./node-data-schemas";

export type UsageNodeType = Node<UsageNodeData, "usage">;

/** USD, cents-precise — what a spend meter reads at. */
const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function resolveLabel(data: UsageNodeData): string {
  return data.label ?? "Today's spend";
}

/** Fraction of the day cap consumed, clamped to [0, 1] for the bar width. A
 * spend that has somehow crossed the cap still pins the bar at full rather than
 * overflowing the track. */
function fractionOfCap(spent: number, cap: number): number {
  if (!(cap > 0)) return 0;
  const f = spent / cap;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export const UsageNode = memo(function UsageNode({
  id,
  data,
  selected,
}: NodeProps<UsageNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = resolveLabel(data);

  // Owner-scoped: no conversationId — this is the day meter (chat/cost.ts).
  const summary = api.chat.summary.useQuery({});

  const spent = summary.data?.spendTodayUsd ?? 0;
  const cap = summary.data?.caps.perDayUsd ?? 0;
  const fraction = fractionOfCap(spent, cap);
  const atCap = cap > 0 && spent >= cap;

  return (
    <div
      className={`flex h-[180px] w-[280px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["usage"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove spend meter"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — the meter. nowheel/nopan/nodrag keep a gesture over the card
          from panning the board. */}
      <div className="nowheel nopan nodrag flex flex-1 flex-col justify-center gap-2 px-3 py-3">
        {summary.isPending ? (
          <div role="status" aria-label="Loading spend meter" className="flex flex-col gap-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : summary.isError ? (
          // Compact card-embedded error (mirrors brief-node / review-queue-node)
          // — the icon is INK: a failure is a state, not an irreversible action.
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">Couldn&apos;t load your spend. Try again.</p>
            <button
              type="button"
              onClick={() => void summary.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* The number — the user's own accounting, so it is serif +
                data-evidence (law 2); tabular so the digits don't jump as it
                ticks up. The cap is polytoken's chrome — sans, faded. */}
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-serif text-2xl leading-none text-ink tabular"
                data-evidence
              >
                {usdFmt.format(spent)}
              </span>
              <span className="text-xs text-faded tabular">
                / {usdFmt.format(cap)} today
              </span>
            </div>

            {/* The bar — a flat INK track fill on a hairline rail (law 3: the
                meter states magnitude by LENGTH, never by hue). At the cap the
                fill is fully drawn; it never overflows the rail. */}
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-ink-08"
              role="progressbar"
              aria-label="Spend against today's cap"
              aria-valuemin={0}
              aria-valuemax={Math.round(cap * 100)}
              aria-valuenow={Math.round(spent * 100)}
            >
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(fraction * 100).toFixed(1)}%` }}
              />
            </div>

            {/* The reading in words — polytoken's summary, sans chrome. At the
                cap it says so plainly; a breach is a STATE, so it is ink, not
                madder (law 1). */}
            <p className="text-2xs text-faded tabular">
              {atCap ? (
                <span className="text-ink">Day cap reached</span>
              ) : (
                <>{Math.round(fraction * 100)}% of your day cap used</>
              )}
            </p>
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
