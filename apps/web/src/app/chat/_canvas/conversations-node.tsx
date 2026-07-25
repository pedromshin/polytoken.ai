"use client";

/**
 * conversations-node.tsx — ConversationsNode: the canvas's `conversations`
 * custom React Flow node. It surfaces the caller's RECENT chats as a placed,
 * scrollable rail-on-the-board, so "which conversations was I in, jump back
 * into one" is a node the agent can drop rather than a rail the user must
 * reach for.
 *
 * NO NEW BACKEND. This node is a second consumer of the EXACT owner-scoped read
 * the conversation rail already uses — `api.chat.listConversations`
 * (chat/conversations.ts, filtered on `ctx.user.id` server-side, T-44-07-01,
 * ordered updatedAt-desc, MAX_LIST_ROWS-capped). Its projection is
 * `{ id, title, modelId, updatedAt }`; this card renders title + updated-date
 * and, on click, SWITCHES the visible conversation. Read-only — no writes.
 *
 * WHY A CLICK, NOT A `/chat?conversation=<id>` LINK. /chat does not select a
 * conversation from the URL at all — `apps/web/src/app/chat/page.tsx` holds the
 * selection in component state (`selectedId`) and threads an `onOpenConversation`
 * callback down through `chat-canvas.tsx` into `CanvasPersistenceContext`. A URL
 * link would land on /chat and auto-open the MOST-RECENT conversation, ignoring
 * the id. So this node does exactly what `email-thread-node.tsx`'s "Attach chat"
 * does for the same "switch the visible conversation" purpose: it reads
 * `onOpenConversation` off `useCanvasPersistenceContext()` and calls it with the
 * chosen id — "the visible conversation switch IS the confirmation"
 * (54-UI-SPEC.md). `onOpenConversation` is optional (undefined in a standalone
 * test mount), so a click is a no-op when no host wiring is present, never a throw.
 *
 * THE CURRENTLY-OPEN CONVERSATION is the one whose canvas we are looking at —
 * its id is `conversationId` off the same context. That row is marked "Current"
 * (aria-current) and is non-interactive: jumping into the conversation you are
 * already in is a no-op, so it is stated, not offered.
 *
 * REF-ONLY node.data (like every sibling, node-data-schemas.ts): `node.data`
 * carries at most an optional display `label`. The list is DERIVED, owner-scoped
 * server-side, and changes constantly — so it is fetched live HERE, never
 * persisted into node.data (`.strict()`).
 *
 * States mirror the established branch order (loading -> error -> empty ->
 * success): loading = query pending; error = query errored (Retry refetches);
 * empty = zero conversations; success = the recent slice, scrollable.
 *
 * LAW 2: a conversation title is user-authored OR polytoken-generated (the D-12
 * first-message snippet) — it is CHROME, so it stays sans, exactly as
 * email-thread-node.tsx keeps the chat node's title sans while giving the mail's
 * OWN words the serif. No `data-evidence` on this card; nothing here is the
 * user's raw material.
 *
 * GESTURE ISOLATION: the scrollable body wears `nowheel nopan nodrag` so a wheel
 * or drag over the list scrolls the conversations instead of panning the board;
 * the header keeps `node-drag-handle`, so the card still drags by its title bar
 * (mirrors documents-node / brief-node / review-queue-node).
 *
 * Remove is INK, not madder: dropping this card from the board is not
 * irreversible (every conversation survives; only the placement goes), so it
 * follows the shared remove-button recipe.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, MessagesSquare, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { useCanvasPersistenceContext } from "./panel-overlay-context";
import { type ConversationsNodeData } from "./node-data-schemas";

export type ConversationsNodeType = Node<ConversationsNodeData, "conversations">;

/**
 * The card surfaces only the top slice of the caller's conversations as an
 * at-a-glance recent list; the full rail lives beside the /chat column.
 * `listConversations` takes no client-facing limit (it is server-capped at
 * MAX_LIST_ROWS), so a frozen empty input keeps the query referentially stable
 * across renders and the slice is taken client-side.
 */
const LIST_INPUT = Object.freeze({});
const RECENT_LIMIT = 15;

/** Updated-date column — short, tabular, month + day (mirrors documents-node). */
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function resolveLabel(data: ConversationsNodeData): string {
  return data.label ?? "Recent chats";
}

/** Coerce the projection's `updatedAt` (a Date across the tRPC boundary, but a
 * string if a persisted/serialized payload ever reaches here) into a formatted
 * label, degrading to null rather than throwing on an unparseable value. */
function formatUpdated(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

export const ConversationsNode = memo(function ConversationsNode({
  id,
  data,
  selected,
}: NodeProps<ConversationsNodeType>) {
  const { deleteElements } = useReactFlow();
  // Same context email-thread-node reads: the id of the conversation whose
  // canvas this is, plus the optional host callback that switches it.
  const { conversationId, onOpenConversation } = useCanvasPersistenceContext();
  const label = resolveLabel(data);

  const query = api.chat.listConversations.useQuery(LIST_INPUT);
  const items = (query.data ?? []).slice(0, RECENT_LIMIT);
  const totalCount = query.data?.length ?? 0;

  return (
    <div
      className={`flex h-[360px] w-[300px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["conversations"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <MessagesSquare className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove conversations"
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
          <div role="status" aria-label="Loading conversations" className="space-y-2 p-3">
            <Skeleton className="h-8 w-full rounded-card" />
            <Skeleton className="h-8 w-full rounded-card" />
            <Skeleton className="h-8 w-full rounded-card" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">Couldn&apos;t load your conversations. Try again.</p>
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
            <MessagesSquare className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">No conversations yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-hair">
            {items.map((conversation) => {
              const updated = formatUpdated(conversation.updatedAt);
              const isCurrent = conversation.id === conversationId;
              return (
                <li key={conversation.id}>
                  {/* Jump back in — a button, because /chat switches the
                      conversation in place via onOpenConversation, not via a
                      route (see file header). The CURRENT conversation's row is
                      non-interactive: you cannot jump into the one you are in. */}
                  <button
                    type="button"
                    disabled={isCurrent}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onOpenConversation?.(conversation.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {/* The title is CHROME (user-authored or the D-12 snippet) —
                        sans, ink, no data-evidence (law 2). */}
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {conversation.title}
                    </span>
                    {isCurrent ? (
                      <span className="shrink-0 rounded-sm bg-ink-08 px-1.5 py-0.5 text-2xs text-faded">
                        Current
                      </span>
                    ) : updated !== null ? (
                      <span className="shrink-0 tabular text-2xs text-faded">{updated}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer — this card is the recent slice; the full rail lives beside the
          /chat column. */}
      {totalCount > items.length && (
        <div className="flex h-8 shrink-0 items-center justify-center border-t border-hair px-3">
          <span className="text-2xs text-faded tabular">
            Showing {items.length} of {totalCount}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
