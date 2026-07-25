"use client";

/**
 * review-queue-node.tsx — ReviewQueueNode: the canvas's `review-queue` custom
 * React Flow node. It surfaces the EXISTING merge-review queue (EN-02, the
 * global human gate over AI-proposed entity duplicates) as a placed board
 * card, so "act on the pending merges" is a node the agent can drop rather
 * than a route the user must navigate to.
 *
 * REF-ONLY like every sibling (see node-data-schemas.ts): `node.data` carries
 * ONLY an optional `label` — no fetched pairs, no counts. The queue rehydrates
 * HERE via `api.entities.reviewQueue.useQuery({ limit: 3, offset: 0 })`
 * (owned-importer scoped server-side, TENA-03), and Merge/Reject act through
 * the EXISTING `useMergeReview` hook, which calls the SAME
 * `entities.confirmMerge` / `entities.rejectMerge` write paths the
 * /entities/review page uses, with the same optimistic cache update. This node
 * introduces NO new backend — it is a second consumer of the review surface.
 *
 * THE QUERY INPUT AND THE HOOK INPUT ARE ONE OBJECT (`QUEUE_INPUT`): the
 * optimistic cache in `useMergeReview` keys its `setData`/`getData` on the
 * exact reviewQueue input, so the node's query and its mutation hook MUST pass
 * an identical `{ limit, offset }` or an optimistic removal would target a
 * different cache entry than the one this node reads. A module-level frozen
 * constant guarantees referential + structural identity.
 *
 * GESTURE ISOLATION: the pending-pair list scrolls, so its container wears
 * `nowheel nopan nodrag` (mirrors circle-pack-node.tsx) — a wheel/drag over
 * the list scrolls the queue instead of panning the board; the header keeps
 * `node-drag-handle` so the card still drags by its title bar.
 *
 * Remove is INK, not madder: dropping this card from the board is not
 * irreversible (the queue and every pending pair survive; only the placement
 * goes), so it follows the shared remove-button recipe.
 */

import * as React from "react";
import { memo, useEffect } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Check, GitMerge, Loader2, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { useMergeReview } from "~/app/entities/review/_components/use-merge-review";
import type { ReviewPair } from "~/app/entities/review/_components/review-pair-card";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { useCanvasPublish } from "./canvas-store-context";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type ReviewQueueNodeData } from "./node-data-schemas";

export type ReviewQueueNodeType = Node<ReviewQueueNodeData, "review-queue">;

/**
 * The node surfaces only the top slice of the queue as an at-a-glance action
 * card; the full paginated queue lives at /entities/review. `offset: 0` is
 * fixed (this card never paginates) and is passed to BOTH the query and the
 * mutation hook — see the file header on why they must be identical.
 */
const QUEUE_LIMIT = 3;
const QUEUE_INPUT = Object.freeze({ limit: QUEUE_LIMIT, offset: 0 });

function resolveLabel(data: ReviewQueueNodeData): string {
  return data.label ?? "Merge review";
}

export const ReviewQueueNode = memo(function ReviewQueueNode({
  id,
  data,
  selected,
}: NodeProps<ReviewQueueNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = resolveLabel(data);

  const query = api.entities.reviewQueue.useQuery(QUEUE_INPUT);
  const { merge, reject, busyPairs } = useMergeReview(QUEUE_INPUT);

  const items = (query.data?.items ?? []) as ReadonlyArray<ReviewPair>;
  const totalPending = query.data?.totalPending ?? 0;

  // Phase 73 Wave B (LCAN-03/04) — the publish port. Once the review-queue
  // query settles, publish a bounded, glanceable projection to
  // `shared.published.{id}` so an agent-wired edge carries the live pending
  // count through the unchanged usePanelData engine. A DERIVED read, never
  // written into node.data.
  const publish = useCanvasPublish(id);
  useEffect(() => {
    if (query.data === undefined) return;
    publish({ pendingCount: totalPending });
  }, [publish, query.data, totalPending]);

  return (
    <div
      className={`flex h-[380px] w-[340px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["review-queue"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <GitMerge className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
          {totalPending > 0 && (
            <span className="shrink-0 rounded-sm bg-ink-08 px-1.5 py-0.5 text-2xs text-faded tabular">
              {totalPending} pending
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Remove review queue"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — the pending slice scrolls; nowheel/nopan/nodrag keep the
          gesture inside the queue instead of panning the board. */}
      <div className="nowheel nopan nodrag min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div role="status" aria-label="Loading merge review queue" className="space-y-2 p-3">
            <Skeleton className="h-20 w-full rounded-card" />
            <Skeleton className="h-20 w-full rounded-card" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">Couldn&apos;t load the review queue. Try again.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Check className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">No pending merges.</p>
          </div>
        ) : (
          <ul className="divide-y divide-hair">
            {items.map((pair) => (
              <ReviewQueuePairRow
                key={pair.pairKey}
                pair={pair}
                busyAction={busyPairs.get(pair.pairKey) ?? null}
                onMerge={merge}
                onReject={reject}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer — the full queue lives at the dedicated route; this card is the
          at-a-glance top slice. */}
      {totalPending > items.length && (
        <div className="flex h-8 shrink-0 items-center justify-center border-t border-hair px-3">
          <span className="text-2xs text-faded tabular">
            Showing top {items.length} of {totalPending}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// One pending pair — subject vs candidate + shared evidence + Merge/Reject.
// ---------------------------------------------------------------------------

function ReviewQueuePairRow({
  pair,
  busyAction,
  onMerge,
  onReject,
}: {
  readonly pair: ReviewPair;
  readonly busyAction: "merge" | "reject" | null;
  readonly onMerge: (pair: ReviewPair) => void;
  readonly onReject: (pair: ReviewPair) => void;
}): React.ReactElement {
  const busy = busyAction !== null;
  const similarityPct =
    pair.maxSimilarity !== null ? `${Math.round(pair.maxSimilarity * 100)}%` : null;

  return (
    <li aria-busy={busy} data-pair-key={pair.pairKey} className="space-y-2 p-3">
      {/* Subject vs candidate — the entity names are the user's own material,
          so they are serif + data-evidence (law 2, the pair). "Keep"/"Merge in"
          and the arrow are polytoken's summary — sans chrome. */}
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wide text-faded">Keep</span>
          <span className="truncate font-serif text-ink" data-evidence>
            {pair.subject.displayName}
          </span>
        </span>
        <GitMerge className="size-3 shrink-0 text-faded" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wide text-faded">Merge in</span>
          <span className="truncate font-serif text-ink" data-evidence>
            {pair.candidate.displayName}
          </span>
        </span>
      </div>

      {/* Similarity + shared evidence — polytoken's summary of WHY they pair. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-faded">
        {similarityPct !== null && <span className="tabular">{similarityPct} similar</span>}
        {pair.sharedAliases.map((alias) => (
          <span key={`a:${alias}`}>
            same name{" "}
            <span className="font-serif text-ink" data-evidence>
              {alias}
            </span>
          </span>
        ))}
        {pair.sharedIdentifierKeys.map((key) => (
          <span key={`k:${key}`}>same {key}</span>
        ))}
      </div>

      {/* Actions — plain ink (the operation is reversible server-side: unmerge
          exists, a reject is a preference), labeled, not a bare icon row. */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          disabled={busy}
          aria-label={`Merge ${pair.candidate.displayName} into ${pair.subject.displayName}`}
          onClick={() => onMerge(pair)}
        >
          {busyAction === "merge" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="size-3.5" aria-hidden />
          )}
          Merge
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={busy}
          aria-label={`Reject merge of ${pair.candidate.displayName} and ${pair.subject.displayName}`}
          onClick={() => onReject(pair)}
        >
          {busyAction === "reject" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <X className="size-3.5" aria-hidden />
          )}
          Reject
        </Button>
      </div>
    </li>
  );
}
