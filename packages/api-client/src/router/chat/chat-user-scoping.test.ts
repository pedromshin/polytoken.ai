/**
 * chat-user-scoping.test.ts — cross-tenant regression tests for the chat
 * tRPC router (Phase 44 Plan 07, TENA-03).
 *
 * Strategy (mirrors emails-user-scoping.test.ts / knowledge-user-scoping.test.ts):
 * `@polytoken/db/ownership`'s `assertConversationOwnership` is mocked at the
 * module boundary — its own allow/deny correctness is covered by
 * packages/db/src/ownership.test.ts (44-02). These tests prove the WIRING:
 * every chat procedure requires a session (protectedProcedure ->
 * UNAUTHORIZED for a sessionless call), and every conversationId-keyed
 * procedure asserts ownership BEFORE touching ctx.db further — a rejected
 * assertion maps to TRPCError NOT_FOUND and no read/write is ever attempted
 * (proven via a minimal `db: {}` fixture that would throw a non-NOT_FOUND
 * error if the resolver reached past the ownership gate).
 *
 * listConversations and createConversation are NOT conversationId-keyed (no
 * existing conversation to assert ownership of yet) — their scoping is a
 * direct `chat_conversations.user_id` filter/write instead. Those two are
 * proven by CAPTURING what the procedure passes to `ctx.db.where()` /
 * `ctx.db.insert().values()` and asserting it reflects `ctx.user.id`.
 *
 * Test plan:
 *   Test 1-11:  every chat procedure rejects a sessionless call with
 *               UNAUTHORIZED.
 *   Test 12:    listConversations filters on the caller's own user_id (and
 *               a second user produces a different filter — proves A's
 *               list can never include B's rows).
 *   Test 13:    createConversation writes user_id = ctx.user.id (never
 *               client-supplied).
 *   Test 14-22: rename/delete/setModel/getHistory/sessionCost/
 *               recordBrowserTurn/getCanvasLayout/saveCanvasLayout/
 *               getWidgetInteractions all reject a non-owned conversationId
 *               with NOT_FOUND, and never reach ctx.db beyond the ownership
 *               check.
 *   Test 23-24: renameConversation / getHistory resolve once ownership
 *               passes (the gate does not over-block the owner).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    assertConversationOwnership: vi.fn(),
  };
});

import { assertConversationOwnership, OwnershipError } from "@polytoken/db/ownership";
import { ChatConversations } from "@polytoken/db/schema";

import { appRouter } from "../../root";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const USER_B = { id: "10000000-0000-0000-0000-00000000000b" };
const CONVERSATION_ID = "60000000-0000-0000-0000-000000000001";
const OTHER_CONVERSATION_ID = "60000000-0000-0000-0000-000000000002";

const VALID_SNAPSHOT = {
  nodes: [],
  edges: [],
  sharedState: {},
  nodeRegistryVersion: "v1",
};

function makeCaller(user: { id: string } | null, db: unknown = {}) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

afterEach(() => {
  vi.mocked(assertConversationOwnership).mockReset();
});

// ---------------------------------------------------------------------------
// Session requirement (T-44-07-04) — every chat procedure
// ---------------------------------------------------------------------------

describe("chatRouter — session requirement (T-44-07-04)", () => {
  it("Test 1: createConversation rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.chat.createConversation({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 2: listConversations rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.chat.listConversations({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 3: renameConversation rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.renameConversation({ id: CONVERSATION_ID, title: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 4: deleteConversation rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.deleteConversation({ id: CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 5: setModel rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.setModel({ conversationId: CONVERSATION_ID, modelId: "m" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 6: getHistory rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.getHistory({ conversationId: CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 7: sessionCost rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.sessionCost({ conversationId: CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 8: recordBrowserTurn rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.recordBrowserTurn({
        conversationId: CONVERSATION_ID,
        modelId: "webllm-qwen3-4b",
        userText: "hi",
        assistantText: "hello",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 9: getCanvasLayout rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.getCanvasLayout({ conversationId: CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 10: saveCanvasLayout rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.saveCanvasLayout({
        conversationId: CONVERSATION_ID,
        snapshot: VALID_SNAPSHOT,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 11: getWidgetInteractions rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.getWidgetInteractions({ conversationId: CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// listConversations / createConversation — direct user_id scoping (T-44-07-01)
// ---------------------------------------------------------------------------

describe("chatRouter — listConversations / createConversation direct user_id scoping (T-44-07-01)", () => {
  it("Test 12: listConversations filters on the caller's user_id — two different users produce different filters", async () => {
    function makeListCaller(user: { id: string }) {
      const captured: { where?: unknown } = {};
      const chain = {
        from() {
          return chain;
        },
        where(cond: unknown) {
          captured.where = cond;
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit() {
          return Promise.resolve([]);
        },
      };
      const db = { select: () => chain };
      return { caller: makeCaller(user, db), captured };
    }

    const { caller: callerA, captured: capturedA } = makeListCaller(USER_A);
    await callerA.chat.listConversations({});
    expect(capturedA.where).toEqual(
      and(eq(ChatConversations.userId, USER_A.id), undefined),
    );

    const { caller: callerB, captured: capturedB } = makeListCaller(USER_B);
    await callerB.chat.listConversations({});
    expect(capturedB.where).toEqual(
      and(eq(ChatConversations.userId, USER_B.id), undefined),
    );

    expect(capturedA.where).not.toEqual(capturedB.where);
  });

  it("Test 13: createConversation writes user_id = ctx.user.id (never client-supplied)", async () => {
    const captured: { values?: unknown } = {};
    const insertChain = {
      values(v: unknown) {
        captured.values = v;
        return insertChain;
      },
      returning() {
        return Promise.resolve([{ id: CONVERSATION_ID }]);
      },
    };
    const db = { insert: () => insertChain };

    const caller = makeCaller(USER_A, db);
    await caller.chat.createConversation({ modelId: "some-model" });

    expect(captured.values).toMatchObject({ userId: USER_A.id });
  });
});

// ---------------------------------------------------------------------------
// conversationId-keyed procedures — ownership gate (T-44-07-01)
// ---------------------------------------------------------------------------

describe("chatRouter — conversationId-keyed procedures reject a non-owned conversation (T-44-07-01)", () => {
  it("Test 14: renameConversation throws NOT_FOUND for a non-owned conversation, never writes", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.renameConversation({ id: OTHER_CONVERSATION_ID, title: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertConversationOwnership).toHaveBeenCalledWith(
      expect.anything(),
      OTHER_CONVERSATION_ID,
      USER_A.id,
    );
  });

  it("Test 15: deleteConversation throws NOT_FOUND for a non-owned conversation, never deletes", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.deleteConversation({ id: OTHER_CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 16: setModel throws NOT_FOUND for a non-owned conversation, never writes", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.setModel({ conversationId: OTHER_CONVERSATION_ID, modelId: "m" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 17: getHistory throws NOT_FOUND for a non-owned conversation, never reads", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.getHistory({ conversationId: OTHER_CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 18: sessionCost throws NOT_FOUND for a non-owned conversation, never reads", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.sessionCost({ conversationId: OTHER_CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 19: recordBrowserTurn throws NOT_FOUND for a non-owned conversation, never enters the transaction", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.recordBrowserTurn({
        conversationId: OTHER_CONVERSATION_ID,
        modelId: "webllm-qwen3-4b",
        userText: "hi",
        assistantText: "hello",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 20: getCanvasLayout throws NOT_FOUND for a non-owned conversation, never reads", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.getCanvasLayout({ conversationId: OTHER_CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 21: saveCanvasLayout throws NOT_FOUND for a non-owned conversation, never writes", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.saveCanvasLayout({
        conversationId: OTHER_CONVERSATION_ID,
        snapshot: VALID_SNAPSHOT,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 22: getWidgetInteractions throws NOT_FOUND for a non-owned conversation, never reads", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", OTHER_CONVERSATION_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.chat.getWidgetInteractions({ conversationId: OTHER_CONVERSATION_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// The gate does not over-block the owner
// ---------------------------------------------------------------------------

describe("chatRouter — the ownership gate resolves for the owner", () => {
  it("Test 23: renameConversation succeeds once ownership resolves", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const updateChain = {
      set() {
        return updateChain;
      },
      where() {
        return Promise.resolve(undefined);
      },
    };
    const db = { update: () => updateChain };

    const caller = makeCaller(USER_A, db);
    await expect(
      caller.chat.renameConversation({ id: CONVERSATION_ID, title: "New title" }),
    ).resolves.toEqual({ renamed: true });
  });

  it("Test 24: getHistory returns rows once ownership resolves", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const chain = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve([{ id: "msg-1", role: "user" }]);
      },
    };
    const db = { select: () => chain };

    const caller = makeCaller(USER_A, db);
    const result = await caller.chat.getHistory({ conversationId: CONVERSATION_ID });
    expect(result).toEqual([{ id: "msg-1", role: "user" }]);
  });
});
