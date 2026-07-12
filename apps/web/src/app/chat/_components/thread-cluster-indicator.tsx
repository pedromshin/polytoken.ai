"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04 / email-thread-node.tsx's
// identical fix).
import * as React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";

import { api } from "~/trpc/react";
import { hrefFor } from "~/components/provenance-link";

/**
 * thread-cluster-indicator.tsx — ThreadClusterIndicator (CLUS-02 linked
 * thread + CLUS-06 cluster context, 54-UI-SPEC.md Component 3 — binding
 * contract, verbatim recipe).
 *
 * Renders ONLY when the conversation is thread-linked
 * (`api.chat.getConversationThreadId`, 54-01) — a null/pending threadId
 * renders nothing, so an unlinked conversation (the overwhelming majority)
 * gets zero new header chrome (additive-only, matches migration 0036's own
 * additive-only posture).
 *
 * One component serves BOTH CLUS-02's "linked thread" surface and CLUS-06's
 * "cluster context" surface as two sections of ONE popover (54-UI-SPEC.md
 * Judgment Call #6) — Trigger mirrors CostMeter's exact compact-text-button
 * recipe; subject/latestMessageId come from `api.emails.threadCard` (54-01)
 * keyed by threadId; sibling/source counts come from `api.chat.clusterSummary`
 * (this plan).
 */

export interface ThreadClusterIndicatorProps {
  readonly conversationId: string;
}

const NO_CONTEXT_COPY = "No other chats or sources on this thread yet.";
const UNTITLED_THREAD = "Untitled thread";

/**
 * clusterContextCopy — pure formatter for the "Cluster context" popover
 * section body (54-UI-SPEC.md Component 3 + Copywriting Contract). The
 * "(s)" suffix is LITERAL — part of the final, shipped copy string, not
 * dynamic pluralization grammar. Exported for DB-free testing.
 */
export function clusterContextCopy(
  siblingChatCount: number,
  capturedSourceCount: number,
): string {
  if (siblingChatCount === 0 && capturedSourceCount === 0) {
    return NO_CONTEXT_COPY;
  }
  return `This chat can see context from ${siblingChatCount} other chat(s) and ${capturedSourceCount} captured source(s) on this thread.`;
}

export function ThreadClusterIndicator({
  conversationId,
}: ThreadClusterIndicatorProps): React.ReactElement | null {
  const threadQuery = api.chat.getConversationThreadId.useQuery({ conversationId });
  const threadId = threadQuery.data?.threadId ?? null;

  const threadCardQuery = api.emails.threadCard.useQuery(
    { threadId: threadId ?? "" },
    { enabled: threadId !== null },
  );
  const clusterSummaryQuery = api.chat.clusterSummary.useQuery(
    { conversationId },
    { enabled: threadId !== null },
  );

  if (threadId === null) {
    return null;
  }

  const subject = threadCardQuery.data?.subject ?? UNTITLED_THREAD;
  const copy = clusterContextCopy(
    clusterSummaryQuery.data?.siblingChatCount ?? 0,
    clusterSummaryQuery.data?.capturedSourceCount ?? 0,
  );
  // Mirrors `EmailThreadNode`'s `canOpenThread` guard (email-thread-node.tsx:102)
  // byte-for-byte — the popover's "Open thread →" link must not navigate to
  // "#" while `threadCardQuery.data` is still pending (54-UI-REVIEW.md fix #2).
  const canOpenThread = threadCardQuery.data !== undefined && threadCardQuery.data !== null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Linked thread: ${subject}`}
          className="flex max-w-[160px] items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <Mail className="size-3 shrink-0 text-graph-email" aria-hidden />
          <span className="min-w-0 truncate max-w-[72px] sm:max-w-[140px]">{subject}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">Linked thread</p>
          <p className="truncate text-sm text-foreground">{subject}</p>
          <Link
            href={
              threadCardQuery.data
                ? hrefFor("email", threadCardQuery.data.latestMessageId)
                : "#"
            }
            aria-disabled={!canOpenThread}
            onClick={(event) => {
              if (!canOpenThread) event.preventDefault();
            }}
            className={`flex h-7 w-fit items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11 ${canOpenThread ? "" : "pointer-events-none opacity-50"}`}
          >
            Open thread →
          </Link>
        </div>
        <div className="space-y-1 border-t border-border/60 pt-3">
          <p className="text-xs font-semibold text-foreground">Cluster context</p>
          <p className="text-xs text-muted-foreground">{copy}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
