"use client";

/**
 * circle-pack-node.tsx — CirclePackNode: the canvas's `circle-pack` custom node
 * (FEATURE-CATALOG TM-03). It wraps the shared `CirclePack` primitive (TM-01,
 * `@polytoken/ui/circle-pack`) so the agent can PLACE a mailbox landscape in
 * answer to "show me what's eating my inbox" (composes with AI-01's
 * canvas.addNode — this file only registers the type + component).
 *
 * Ref-only, like every sibling: `node.data` carries a SCOPE (mailbox/importer/
 * entity id), never the aggregated tree — the sender→thread→email hierarchy
 * rehydrates HERE via `api.emails.circlePackLandscape` (owned-scoped server-
 * side). Clicking a leaf deep-links `/emails/[id]`.
 *
 * DESIGN LAW: the shell wears the shared card recipe + the `circle-pack` kind
 * geometry (a dotted, top-seamed rule — a bounded VIEW of a whole surface, law
 * 3). The hover card's subject is the MAIL's own words, so it is serif +
 * data-evidence (the pair, law 2); the sender line is polytoken's summary, so
 * it stays sans. Remove is INK — dropping a card from the board is not
 * irreversible (T-61-19); the underlying mail is untouched.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { AlertCircle, CircleDashed, X } from "lucide-react";

import { CirclePack, type CircleDatum } from "@polytoken/ui/circle-pack";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { hrefFor } from "~/components/provenance-link";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { CirclePackNodeData } from "./node-data-schemas";

export type CirclePackNodeType = Node<CirclePackNodeData, "circle-pack">;

/** The opaque leaf payload the landscape query threads to the click handler. */
interface LandscapeLeaf {
  readonly emailId: string;
  readonly subject: string | null;
  readonly senderAddress: string;
  readonly receivedAt: string;
}

const PACK_W = 344;
const PACK_H = 236;

function resolveLabel(data: CirclePackNodeData): string {
  if (data.label !== undefined) return data.label;
  return data.scope === "entity" ? "Entity landscape" : "Mailbox landscape";
}

export const CirclePackNode = memo(function CirclePackNode({
  id,
  data,
  selected,
}: NodeProps<CirclePackNodeType>) {
  const { deleteElements } = useReactFlow();
  const router = useRouter();

  // TM-02 aggregate. Entity-scoped narrowing is a documented follow-up (the
  // query is owned-mailbox / importer scoped today); `importerId` is honored.
  const query = api.emails.circlePackLandscape.useQuery({
    importerId: data.importerId,
  });

  const tree = query.data as CircleDatum<LandscapeLeaf> | undefined;
  const hasContent = tree !== undefined && (tree.children?.length ?? 0) > 0;

  return (
    <div
      className={`flex h-[320px] w-[360px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["circle-pack"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <CircleDashed className="size-3 shrink-0 text-faded" aria-hidden />
          {/* polytoken's word for the view — chrome, sans (law 2). */}
          <span className="truncate text-xs font-semibold text-ink">
            {resolveLabel(data)}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove landscape"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-2">
        {query.isPending ? (
          <div role="status" aria-label="Loading landscape" className="flex size-full items-center justify-center">
            <Skeleton className="size-[220px] rounded-full" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t load your mailbox landscape. Try again.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : hasContent && tree ? (
          <CirclePack<LandscapeLeaf>
            data={tree}
            width={PACK_W}
            height={PACK_H}
            ariaLabel={resolveLabel(data)}
            className="border-0 bg-transparent"
            onLeafActivate={(circle) => {
              const leaf = circle.datum.leaf;
              if (leaf) router.push(hrefFor("email", leaf.emailId));
            }}
            renderHoverCard={(circle) => (
              <span className="flex flex-col gap-0.5">
                {/* The mail's own subject — serif + data-evidence (the pair). */}
                <span className="truncate font-serif text-ink" data-evidence>
                  {circle.datum.name}
                </span>
                {/* polytoken's summary line — sans chrome. */}
                <span className="tabular text-2xs text-faded">
                  {circle.isLeaf
                    ? (circle.datum.leaf?.senderAddress ?? "")
                    : `${circle.value.toLocaleString()} messages`}
                </span>
              </span>
            )}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <CircleDashed className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              No mail to map yet. Forward mail to your polytoken address and it
              will appear here as a landscape.
            </p>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
