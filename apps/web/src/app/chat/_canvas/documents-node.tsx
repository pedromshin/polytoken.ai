"use client";

/**
 * documents-node.tsx — DocumentsNode: the canvas's `documents` custom React Flow
 * node. It surfaces the caller's RECENT documents as a placed, scrollable browser
 * card, so "what have I generated lately, open one" is a node the agent can drop
 * rather than a route the user must navigate to.
 *
 * DISTINCT FROM `document` (singular): the `document` node carries ONE
 * `documentId` ref and rehydrates that single document's title/spec (DOCS-02).
 * THIS node carries NO id at all — it is a live LIST view over the whole
 * owner-scoped documents collection (a browser, not a bound artifact), so a
 * dropped card always reflects the newest documents without re-placement.
 *
 * NO NEW BACKEND. This node is a second consumer of the EXISTING owner-scoped
 * read path the /documents list page uses — `api.documents.list` (documentsRouter,
 * scoped to `ctx.user.id` server-side, newest-first, `spec` omitted from the
 * projection so no document body is ever streamed into the list). Each row's
 * projection is `{ id, title, sourceLedgerId, createdAt }`; this card renders
 * title + created date and links to `/documents/<id>`. Read-only — no writes.
 *
 * REF-ONLY node.data (like every sibling, node-data-schemas.ts): `node.data`
 * carries at most an optional display `label`. The list is DERIVED, owner-scoped
 * server-side, and changes constantly — so it is fetched live HERE, never
 * persisted into node.data (`.strict()`).
 *
 * States mirror the established branch order (loading -> error -> empty ->
 * success): loading = query pending; error = query errored (Retry refetches);
 * empty = zero documents; success = the recent slice, scrollable.
 *
 * GESTURE ISOLATION: the scrollable body wears `nowheel nopan nodrag` so a wheel
 * or drag over the list scrolls the documents instead of panning the board; the
 * header keeps `node-drag-handle`, so the card still drags by its title bar
 * (mirrors brief-node / review-queue-node).
 *
 * Remove is INK, not madder: dropping this card from the board is not
 * irreversible (every document survives; only the placement goes), so it follows
 * the shared remove-button recipe.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import Link from "next/link";
import { AlertCircle, FileText, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type DocumentsNodeData } from "./node-data-schemas";

export type DocumentsNodeType = Node<DocumentsNodeData, "documents">;

/**
 * The card surfaces only the top slice of the collection as an at-a-glance
 * browser; the full paginated list lives at /documents. `offset: 0` is fixed
 * (this card never paginates). A module-level frozen constant keeps the query
 * input referentially stable across renders.
 */
const LIST_LIMIT = 12;
const LIST_INPUT = Object.freeze({ limit: LIST_LIMIT, offset: 0 });

/** Created-date column — short, tabular, month + day (year only implicitly). */
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function resolveLabel(data: DocumentsNodeData): string {
  return data.label ?? "Recent documents";
}

/** Coerce the projection's `createdAt` (a Date across the tRPC boundary, but a
 * string if a persisted/serialized payload ever reaches here) into a formatted
 * label, degrading to null rather than throwing on an unparseable value. */
function formatCreated(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

export const DocumentsNode = memo(function DocumentsNode({
  id,
  data,
  selected,
}: NodeProps<DocumentsNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = resolveLabel(data);

  const query = api.documents.list.useQuery(LIST_INPUT);
  const items = query.data?.items ?? [];

  return (
    <div
      className={`flex h-[360px] w-[320px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["documents"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove documents"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — the recent slice scrolls; nowheel/nopan/nodrag keep the gesture
          inside the list instead of panning the board. */}
      <div className="nowheel nopan nodrag min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div role="status" aria-label="Loading documents" className="space-y-2 p-3">
            <Skeleton className="h-8 w-full rounded-card" />
            <Skeleton className="h-8 w-full rounded-card" />
            <Skeleton className="h-8 w-full rounded-card" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">Couldn&apos;t load your documents. Try again.</p>
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
            <FileText className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">No documents yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-hair">
            {items.map((doc) => {
              const created = formatCreated(doc.createdAt);
              return (
                <li key={doc.id}>
                  {/* The document TITLE is the user's own material — serif +
                      data-evidence (law 2). The date is polytoken's chrome —
                      sans, tabular, faded. */}
                  <Link
                    href={`/documents/${doc.id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-ink-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-serif text-xs text-ink"
                      data-evidence
                    >
                      {doc.title}
                    </span>
                    {created !== null ? (
                      <span className="shrink-0 tabular text-2xs text-faded">{created}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer — the full list lives at the dedicated route; this card is the
          at-a-glance recent slice. */}
      {query.data?.hasMore === true && (
        <div className="flex h-8 shrink-0 items-center justify-center border-t border-hair px-3">
          <Link
            href="/documents"
            className="text-2xs text-faded underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            View all documents
          </Link>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
