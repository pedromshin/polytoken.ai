/**
 * use-conversation-controller-invalidate.test.ts — RSKN-07 regression test
 * (todo 2026-07-09-knowledge-cache-invalidation-gap).
 *
 * Exercises the standalone `invalidateOnChatTerminal` helper exported from
 * use-conversation-controller.ts (the same invalidation logic
 * `handleTerminal` calls on every terminal turn) directly, with a mocked
 * utils object — mirrors the knowledge-graph-invalidate.test.tsx precedent
 * of testing the extracted orchestration function without mounting the full
 * hook (which needs a live tRPC/QueryClient context this package doesn't
 * provide in tests).
 *
 * Before this plan: handleTerminal invalidated only chat.getHistory /
 * chat.sessionCost / chat.getWidgetInteractions — a chat-driven promotion
 * via the confirm_action widget (Phase 40) never invalidated knowledge.*,
 * so bound genui panels / knowledge-preview nodes showed stale tier data for
 * up to ~10s (staleTime) after promoting.
 */

import { describe, expect, it, vi } from "vitest";

import {
  invalidateOnChatTerminal,
  type ChatTerminalUtils,
} from "../use-conversation-controller";

const CONVERSATION_ID = "conv-123";

function makeUtils(): ChatTerminalUtils {
  return {
    chat: {
      getHistory: { invalidate: vi.fn() },
      sessionCost: { invalidate: vi.fn() },
      getWidgetInteractions: { invalidate: vi.fn() },
    },
    knowledge: {
      byId: { invalidate: vi.fn() },
      graph: { invalidate: vi.fn() },
      expandNode: { invalidate: vi.fn() },
    },
  };
}

describe("invalidateOnChatTerminal (RSKN-07 — chat-driven promotion cache invalidation)", () => {
  it("invalidates all three chat.* keys with the conversationId AND all three knowledge.* keys", () => {
    const utils = makeUtils();

    invalidateOnChatTerminal(CONVERSATION_ID, utils);

    expect(utils.chat.getHistory.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.chat.getHistory.invalidate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
    });
    expect(utils.chat.sessionCost.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.chat.sessionCost.invalidate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
    });
    expect(utils.chat.getWidgetInteractions.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.chat.getWidgetInteractions.invalidate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
    });

    // RSKN-07: the gap this plan closes — the widget-submit continuation
    // terminal must also invalidate the knowledge.* keys the /knowledge
    // page's promoteEdge already invalidates (knowledge-graph.tsx), so a
    // bound genui panel / knowledge-preview node refreshes immediately
    // instead of waiting out staleTime.
    expect(utils.knowledge.byId.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.knowledge.graph.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.knowledge.expandNode.invalidate).toHaveBeenCalledTimes(1);
  });
});
