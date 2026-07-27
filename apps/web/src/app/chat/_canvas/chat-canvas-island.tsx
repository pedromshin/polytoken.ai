"use client";

/**
 * chat-canvas-island.tsx — thin "use client" wrapper holding the
 * `dynamic(ssr: false)` call for the /chat canvas's React Flow surface.
 *
 * Next.js 15 enforces that `ssr: false` is not allowed inside Server
 * Components; this mirrors /knowledge's knowledge-graph-island.tsx exactly.
 * ChatCanvas is NEVER server-rendered.
 */

import dynamic from "next/dynamic";

import { api } from "~/trpc/react";

import type { ChatHistoryRow, ConversationController } from "../_hooks/use-conversation-controller";
import { CanvasSkeleton } from "./canvas-skeleton";
import type { SaveStatus, SourceLedgerRow } from "./use-canvas-persistence";

const ChatCanvasDynamic = dynamic(
  () => import("./chat-canvas").then((mod) => ({ default: mod.ChatCanvas })),
  {
    ssr: false,
    loading: () => <CanvasSkeleton />,
  },
);

export interface ChatCanvasIslandProps {
  readonly conversationId: string;
  readonly controller: ConversationController;
  readonly historyRows: readonly ChatHistoryRow[];
  /** Threaded through to ChatCanvas — page.tsx mounts `SaveStatusIndicator`
   * in the conversation toolbar's right zone from this callback. */
  readonly onSaveStatusChange?: (status: SaveStatus) => void;
  /** Threaded through to ChatCanvas (54-04, CLUS-01/CLUS-02) — see
   * ChatCanvasProps.onOpenConversation's own doc comment. */
  readonly onOpenConversation?: (conversationId: string) => void;
}

/** Reference-stable empty fallback for the pre-load / no-sources case — a bare
 * `?? []` default would allocate a new array every render and force ChatCanvas's
 * `sourceRows`-keyed reconcile effect to re-run needlessly. */
const EMPTY_SOURCE_ROWS: readonly SourceLedgerRow[] = [];

export function ChatCanvasIsland({
  conversationId,
  controller,
  historyRows,
  onSaveStatusChange,
  onOpenConversation,
}: ChatCanvasIslandProps): React.ReactElement {
  // RCNV-02/RSRCH-03 — the conversation's auto-collected `chat_source_ledger`
  // rows (chat.listSources), fed into ChatCanvas via the EXISTING `sourceRows`
  // prop so they materialize as `source` nodes with zero capture ceremony. The
  // read is ownership-scoped server-side; the returned shape IS the
  // `SourceLedgerRow` the reconcile pass expects, so the pass-through is 1:1
  // (no field remap). Until data arrives / when the pool is empty we hand the
  // reference-stable empty array, so the canvas stays byte-identical.
  const { data: sourceRows } = api.chat.listSources.useQuery({ conversationId });

  return (
    <ChatCanvasDynamic
      conversationId={conversationId}
      controller={controller}
      historyRows={historyRows}
      onSaveStatusChange={onSaveStatusChange}
      onOpenConversation={onOpenConversation}
      sourceRows={sourceRows ?? EMPTY_SOURCE_ROWS}
    />
  );
}
