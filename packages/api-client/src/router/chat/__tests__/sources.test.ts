/**
 * sources.test.ts — the `chat.listSources` read seam (RCNV-02/RSRCH-03).
 *
 * Two concerns proven, matching the two things this query must guarantee:
 *
 *  (A) Input schema — DB-free: listSourcesInputSchema requires a uuid
 *      conversationId (the FOUND-6 boundary validation), mirrors
 *      history.test.ts.
 *
 *  (B) Router wiring — `@polytoken/db/ownership`'s assertConversationOwnership
 *      is mocked at the module boundary (same idiom as context-edges.test.ts /
 *      thread-link.test.ts; its own correctness is proven by
 *      packages/db/src/ownership.test.ts). These prove: a session is required
 *      (UNAUTHORIZED), ownership is asserted BEFORE any read, a foreign
 *      conversation maps to NOT_FOUND with NO select issued, and an owned
 *      conversation returns exactly the `SourceLedgerRow` shape the canvas
 *      reconcile pass consumes (id/url/title/snippet/knowledgeNodeId).
 *
 * Test plan:
 *   Test 1: listSourcesInputSchema requires a uuid conversationId.
 *   Test 2: listSourcesInputSchema rejects a non-uuid conversationId.
 *   Test 3: sessionless call -> UNAUTHORIZED.
 *   Test 4: foreign conversation -> NOT_FOUND, no select issued (ownership
 *           asserted before any read).
 *   Test 5: owned conversation with no sources -> [] (byte-identical inert).
 *   Test 6: owned conversation -> rows in the exact SourceLedgerRow shape,
 *           null snippet/knowledgeNodeId preserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { appRouter } from "../../../root";
import { listSourcesInputSchema } from "../sources";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const CONVERSATION_A = "30000000-0000-0000-0000-000000000c01";

type FakeRow = Record<string, unknown>;

/**
 * createFakeSourcesDb — a fake Drizzle read chain returning `selectRows`,
 * tracking whether `.select()` was ever reached (so a NOT_FOUND-before-read
 * can be asserted). Mirrors context-edges.test.ts's fake-chain idiom.
 */
function createFakeSourcesDb(options: { selectRows?: ReadonlyArray<FakeRow> }) {
  let selectCallCount = 0;

  const db = {
    select() {
      selectCallCount += 1;
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
          return chain;
        },
        then(
          onFulfilled: (rows: ReadonlyArray<FakeRow>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(options.selectRows ?? []).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return { db, selectCallCount: () => selectCallCount };
}

function makeCaller(
  user: { id: string } | null,
  db: ReturnType<typeof createFakeSourcesDb>["db"] = createFakeSourcesDb({}).db,
) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

beforeEach(() => {
  vi.mocked(assertConversationOwnership).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (A) Input schema
// ---------------------------------------------------------------------------

describe("listSourcesInputSchema", () => {
  it("Test 1: requires a uuid conversationId", () => {
    const parsed = listSourcesInputSchema.parse({ conversationId: CONVERSATION_A });
    expect(parsed.conversationId).toBe(CONVERSATION_A);
  });

  it("Test 2: rejects a non-uuid conversationId", () => {
    expect(() => listSourcesInputSchema.parse({ conversationId: "not-a-uuid" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// (B) Router wiring
// ---------------------------------------------------------------------------

describe("chat.listSources", () => {
  it("Test 3: rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.listSources({ conversationId: CONVERSATION_A }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 4: foreign conversation -> NOT_FOUND, no select issued", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", CONVERSATION_A),
    );
    const fake = createFakeSourcesDb({ selectRows: [{ id: "x" }] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.listSources({ conversationId: CONVERSATION_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Ownership asserted BEFORE any read — the ledger is never touched.
    expect(fake.selectCallCount()).toBe(0);
  });

  it("Test 5: owned conversation with no sources -> []", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeSourcesDb({ selectRows: [] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.listSources({ conversationId: CONVERSATION_A });
    expect(result).toEqual([]);
    expect(fake.selectCallCount()).toBe(1);
  });

  it("Test 6: owned conversation -> exact SourceLedgerRow shape (null snippet/knowledgeNodeId preserved)", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const rows: ReadonlyArray<FakeRow> = [
      {
        id: "50000000-0000-0000-0000-000000000001",
        url: "https://example.com/a",
        title: "Source A",
        snippet: "an excerpt",
        knowledgeNodeId: "60000000-0000-0000-0000-000000000001",
      },
      {
        id: "50000000-0000-0000-0000-000000000002",
        url: "https://example.com/b",
        title: "Source B",
        snippet: null,
        knowledgeNodeId: null,
      },
    ];
    const fake = createFakeSourcesDb({ selectRows: rows });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.listSources({ conversationId: CONVERSATION_A });

    expect(result).toEqual(rows);
    // The row shape is exactly what the canvas reconcile pass consumes — no
    // extra columns leak (e.g. importerId / toolUseId / capturedAt).
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual(
        ["id", "knowledgeNodeId", "snippet", "title", "url"].sort(),
      );
    }
  });
});
