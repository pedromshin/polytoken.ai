/**
 * chat-terminal-invalidation.ts — ChatTerminalUtils + invalidateOnChatTerminal,
 * the fetch-independent BIND-02 event-driven cache-invalidation orchestration
 * for the controller's `handleTerminal` (RSKN-07, todo
 * 2026-07-09-knowledge-cache-invalidation-gap). A standalone pure function
 * (mirrors `knowledge-graph.tsx`'s own `promoteEdge` extraction) so it is
 * unit-testable without mounting the full controller/tRPC context — moved out
 * of use-conversation-controller.ts verbatim under the 800-line law
 * (Wave 0.6; the turn-cap-notices extraction is its sibling).
 *
 * Before this: `handleTerminal` invalidated only `chat.*` — a chat-driven
 * promotion via the confirm_action widget's widget-submit continuation
 * (Phase 40) never touched `knowledge.*`, so a bound genui panel or
 * knowledge-preview node showed stale tier data for up to ~10s (staleTime)
 * after promoting.
 *
 * Fired unconditionally on every terminal turn (not gated to a widget-submit
 * continuation) — Claude's Discretion per the plan: the three knowledge.*
 * queries are the SAME cheap, staleTime-guarded tRPC queries already loaded
 * elsewhere (T-51-07-B), so a bounded refetch on every turn settle is simpler
 * than threading a "was this a promotion?" flag through the stream-terminal
 * callback, and never produces unbounded fan-out.
 *
 * CLUS-02/CLUS-06 (54-06): also invalidates `chat.clusterSummary` — a
 * widget-submit continuation turn that just confirmed a source_capture
 * (Phase 54-03) wrote a fresh knowledge_node_edges row targeting this
 * conversation; without this, `ThreadClusterIndicator`'s captured-source
 * count would show stale data for up to its own staleTime after capture.
 */

export interface ChatTerminalUtils {
  readonly chat: {
    readonly getHistory: {
      readonly invalidate: (input: { conversationId: string }) => void;
    };
    readonly sessionCost: {
      readonly invalidate: (input: { conversationId: string }) => void;
    };
    readonly getWidgetInteractions: {
      readonly invalidate: (input: { conversationId: string }) => void;
    };
    readonly clusterSummary: {
      readonly invalidate: (input: { conversationId: string }) => void;
    };
  };
  readonly knowledge: {
    readonly byId: { readonly invalidate: () => void };
    readonly graph: { readonly invalidate: () => void };
    readonly expandNode: { readonly invalidate: () => void };
  };
}

export function invalidateOnChatTerminal(
  conversationId: string,
  utils: ChatTerminalUtils,
): void {
  // Every terminal branch persists whatever streamed so far (D-15) — the
  // persisted row is now authoritative, so replace the transient turns.
  void utils.chat.getHistory.invalidate({ conversationId });
  // A completed turn writes a new chat_cost_ledger row (22-06/22-07) — keep
  // the session cost meter live (D-23) without a manual refresh.
  void utils.chat.sessionCost.invalidate({ conversationId });
  // A widget-submit continuation turn just settled — the pending widget is
  // now `submitted` server-side (D-16); refetch so its locked state lands.
  void utils.chat.getWidgetInteractions.invalidate({ conversationId });
  // CLUS-02/CLUS-06 (54-06): a just-confirmed source_capture (or a new
  // sibling chat attach) may have changed this conversation's cluster
  // counts — refresh ThreadClusterIndicator's popover data on every
  // terminal turn (same "cheap staleTime-guarded query" posture as the
  // knowledge.* invalidations below).
  void utils.chat.clusterSummary.invalidate({ conversationId });
  // RSKN-07: extend the SAME BIND-02 invalidation contract knowledge-graph.tsx's
  // promoteEdge already applies to the /knowledge page's promote button —
  // a bound chat-canvas panel or knowledge-preview node shares the SAME
  // browser-side QueryClient singleton, so invalidating here refetches it
  // without navigating away from /chat first.
  utils.knowledge.byId.invalidate();
  utils.knowledge.graph.invalidate();
  utils.knowledge.expandNode.invalidate();
}
