/**
 * canvas-mutations.test.ts — router-level tests for chat.addCanvasNode /
 * chat.connectCanvasNodes / chat.removeCanvasNode (FEATURE-CATALOG AI-01).
 *
 * Strategy (mirrors thread-link.test.ts): `@polytoken/db/ownership` is mocked at the module
 * boundary (its own correctness is covered by packages/db/src/ownership.test.ts); a minimal
 * thenable-chain fake models select().from().where().limit() and
 * insert().values().onConflictDoUpdate() — the exact layout-row machinery saveCanvasLayout uses.
 *
 * Test plan:
 *   Test 1: addCanvasNode on a conversation with NO layout row creates the row with exactly one
 *           node (canonical `email-thread:<threadId>` id), the sentinel nodeRegistryVersion, and
 *           returns { created: true }.
 *   Test 2: addCanvasNode on an EXISTING row is ADDITIVE — every pre-existing node/edge/
 *           viewport/sharedState/nodeRegistryVersion value survives byte-identical, the new node
 *           is appended.
 *   Test 3: an unknown nodeType is rejected (BAD_REQUEST) with NO write — the fail-safe gate.
 *   Test 4: bad per-type data (email-thread without threadId) is rejected with NO write.
 *   Test 5: a non-owned conversationId surfaces as NOT_FOUND with NO read/write.
 *   Test 6: a full canvas (MAX_CANVAS_NODES) refuses the add (PRECONDITION_FAILED), NO write.
 *   Test 7: adding a node whose canonical id already exists is an idempotent no-op —
 *           { created: false }, NO write.
 *   Test 8: a persisted row that fails CanvasSnapshotSchema is REFUSED (PRECONDITION_FAILED),
 *           never clobbered.
 *   Test 9: connectCanvasNodes appends an edge with the sourcePath/targetKey defaults; existing
 *           edges survive.
 *   Test 10: connectCanvasNodes rejects a missing endpoint node (BAD_REQUEST), NO write.
 *   Test 11: connectCanvasNodes is idempotent for an identical edge — { created: false }, NO write.
 *   Test 12: removeCanvasNode removes the node AND its edges, persists the remainder, and returns
 *            the undo payload (node + detachedEdges verbatim).
 *   Test 13: removeCanvasNode on a missing nodeId is an idempotent no-op — removed: false, NO write.
 *   Test 14: session required — all three procedures reject UNAUTHORIZED without a user.
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
import { MAX_CANVAS_NODES } from "../canvas-schema";
import { AGENT_CANVAS_REGISTRY_VERSION } from "../canvas-mutations";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const CONVERSATION_A = "20000000-0000-0000-0000-000000000c01";
const THREAD_ID = "30000000-0000-0000-0000-000000000e01";
const DOCUMENT_ID = "30000000-0000-0000-0000-000000000e02";

type FakeRow = Record<string, unknown>;

/**
 * A minimal thenable Drizzle-chain fake covering exactly what canvas-mutations touches:
 * select().from().where().limit() and insert().values().onConflictDoUpdate().
 */
function createFakeDb(options: { readonly selectRows?: ReadonlyArray<FakeRow> }) {
  let upsertValues: Record<string, unknown> | undefined;
  let upsertSet: Record<string, unknown> | undefined;
  let upsertCallCount = 0;

  const db = {
    select() {
      const chain = {
        from() {
          return chain;
        },
        where() {
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
    insert() {
      const chain = {
        values(v: Record<string, unknown>) {
          upsertValues = v;
          return chain;
        },
        onConflictDoUpdate(cfg: { set: Record<string, unknown> }) {
          upsertSet = cfg.set;
          return chain;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          upsertCallCount += 1;
          return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return {
    db,
    upsertCallCount: () => upsertCallCount,
    getUpsertValues: () => upsertValues,
    getUpsertSet: () => upsertSet,
  };
}

function makeCaller(user: { id: string } | null, db: ReturnType<typeof createFakeDb>["db"]) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

/** A valid persisted layout row (the DB shape getCanvasLayout returns). */
function makeExistingRow(): FakeRow {
  return {
    id: "40000000-0000-0000-0000-000000000001",
    conversationId: CONVERSATION_A,
    nodes: [
      {
        id: `chat:${CONVERSATION_A}`,
        type: "chat",
        position: { x: 10, y: 20 },
        width: 400,
        height: 300,
        data: { conversationId: CONVERSATION_A },
      },
      {
        id: `document:${DOCUMENT_ID}`,
        type: "document",
        position: { x: 500, y: 20 },
        data: { documentId: DOCUMENT_ID, label: "Q3 brief" },
      },
    ],
    edges: [
      {
        id: "edge:existing",
        source: `chat:${CONVERSATION_A}`,
        target: `document:${DOCUMENT_ID}`,
        data: { sourcePath: "data.result", targetKey: "input" },
      },
    ],
    viewport: { x: 1, y: 2, zoom: 1.5 },
    sharedState: { "shared.count": 7 },
    nodeRegistryVersion: "abc123",
  };
}

beforeEach(() => {
  vi.mocked(assertConversationOwnership).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("chat.addCanvasNode", () => {
  it("Test 1: creates the layout row with one canonical node when none exists", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.addCanvasNode({
      conversationId: CONVERSATION_A,
      nodeType: "email-thread",
      data: { threadId: THREAD_ID, label: "Renewal thread" },
    });

    expect(result).toEqual({
      nodeId: `email-thread:${THREAD_ID}`,
      nodeType: "email-thread",
      created: true,
    });
    expect(fake.upsertCallCount()).toBe(1);
    const values = fake.getUpsertValues()!;
    expect(values.conversationId).toBe(CONVERSATION_A);
    expect(values.nodeRegistryVersion).toBe(AGENT_CANVAS_REGISTRY_VERSION);
    const nodes = values.nodes as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: `email-thread:${THREAD_ID}`,
      type: "email-thread",
      data: { threadId: THREAD_ID, label: "Renewal thread" },
    });
    expect(values.edges).toEqual([]);
  });

  it("Test 2: is ADDITIVE on an existing row — everything pre-existing survives byte-identical", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const row = makeExistingRow();
    const fake = createFakeDb({ selectRows: [row] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.addCanvasNode({
      conversationId: CONVERSATION_A,
      nodeType: "email-thread",
      data: { threadId: THREAD_ID },
    });

    expect(result.created).toBe(true);
    const set = fake.getUpsertSet()!;
    const nodes = set.nodes as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(3);
    // the two pre-existing nodes survive exactly (positions, sizes, data untouched)
    expect(nodes[0]).toEqual((row.nodes as unknown[])[0]);
    expect(nodes[1]).toEqual((row.nodes as unknown[])[1]);
    expect(nodes[2]).toMatchObject({ id: `email-thread:${THREAD_ID}`, type: "email-thread" });
    // edges/viewport/sharedState/version carried through verbatim
    expect(set.edges).toEqual(row.edges);
    expect(set.viewport).toEqual(row.viewport);
    expect(set.sharedState).toEqual(row.sharedState);
    expect(set.nodeRegistryVersion).toBe("abc123");
  });

  it("Test 3: rejects an unknown nodeType with NO write (fail-safe gate)", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "totally-made-up",
        data: {},
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 4: rejects data failing the per-type schema with NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "email-thread",
        data: { label: "no threadId ref" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 5: a non-owned conversationId surfaces as NOT_FOUND — nothing written", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValue(
      new OwnershipError("conversation", CONVERSATION_A),
    );
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "email-thread",
        data: { threadId: THREAD_ID },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 6: refuses to add past MAX_CANVAS_NODES (PRECONDITION_FAILED), NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const row = makeExistingRow();
    row.nodes = Array.from({ length: MAX_CANVAS_NODES }, (_, i) => ({
      id: `chat:filler-${i}`,
      type: "chat",
      position: { x: i, y: i },
      data: { conversationId: CONVERSATION_A },
    }));
    row.edges = [];
    const fake = createFakeDb({ selectRows: [row] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "email-thread",
        data: { threadId: THREAD_ID },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 7: an already-materialized canonical id is an idempotent no-op — created: false, NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.addCanvasNode({
      conversationId: CONVERSATION_A,
      nodeType: "document",
      data: { documentId: DOCUMENT_ID },
    });

    expect(result).toEqual({
      nodeId: `document:${DOCUMENT_ID}`,
      nodeType: "document",
      created: false,
    });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 8: a persisted row that fails validation is REFUSED, never clobbered", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const row = makeExistingRow();
    // a tampered row smuggling spec content (D-05 violation) — the read side would degrade,
    // the write side must refuse rather than overwrite.
    row.nodes = [
      { id: "n1", type: "genui-panel", position: { x: 0, y: 0 }, data: { spec: { type: "card" } } },
    ];
    const fake = createFakeDb({ selectRows: [row] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "email-thread",
        data: { threadId: THREAD_ID },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fake.upsertCallCount()).toBe(0);
  });
});

describe("chat.connectCanvasNodes", () => {
  it("Test 9: appends an edge with the sourcePath/targetKey defaults; existing edges survive", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const row = makeExistingRow();
    const fake = createFakeDb({ selectRows: [row] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.connectCanvasNodes({
      conversationId: CONVERSATION_A,
      sourceNodeId: `document:${DOCUMENT_ID}`,
      targetNodeId: `chat:${CONVERSATION_A}`,
    });

    expect(result.created).toBe(true);
    expect(result.edgeId).toMatch(/^edge:/);
    const set = fake.getUpsertSet()!;
    const edges = set.edges as Array<Record<string, unknown>>;
    expect(edges).toHaveLength(2);
    expect(edges[0]).toEqual((row.edges as unknown[])[0]);
    expect(edges[1]).toMatchObject({
      source: `document:${DOCUMENT_ID}`,
      target: `chat:${CONVERSATION_A}`,
      data: { sourcePath: "data", targetKey: "input" },
    });
    expect(set.nodes).toEqual(row.nodes);
  });

  it("Test 10: rejects a missing endpoint node (BAD_REQUEST), NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.connectCanvasNodes({
        conversationId: CONVERSATION_A,
        sourceNodeId: "node-that-does-not-exist",
        targetNodeId: `chat:${CONVERSATION_A}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.upsertCallCount()).toBe(0);
  });

  it("Test 11: an identical edge is an idempotent no-op — created: false, NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.connectCanvasNodes({
      conversationId: CONVERSATION_A,
      sourceNodeId: `chat:${CONVERSATION_A}`,
      targetNodeId: `document:${DOCUMENT_ID}`,
      sourcePath: "data.result",
      targetKey: "input",
    });

    expect(result).toEqual({ edgeId: "edge:existing", created: false });
    expect(fake.upsertCallCount()).toBe(0);
  });
});

describe("chat.removeCanvasNode", () => {
  it("Test 12: removes the node AND its edges, persists the remainder, returns the undo payload", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const row = makeExistingRow();
    const fake = createFakeDb({ selectRows: [row] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.removeCanvasNode({
      conversationId: CONVERSATION_A,
      nodeId: `document:${DOCUMENT_ID}`,
    });

    expect(result.removed).toBe(true);
    // the undo payload: the removed node + detached edges VERBATIM
    expect(result.node).toEqual((row.nodes as unknown[])[1]);
    expect(result.detachedEdges).toEqual(row.edges);

    const set = fake.getUpsertSet()!;
    expect(set.nodes).toEqual([(row.nodes as unknown[])[0]]);
    expect(set.edges).toEqual([]);
    expect(set.sharedState).toEqual(row.sharedState);
    expect(set.nodeRegistryVersion).toBe("abc123");
  });

  it("Test 13: a missing nodeId is an idempotent no-op — removed: false, NO write", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
    const fake = createFakeDb({ selectRows: [makeExistingRow()] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.removeCanvasNode({
      conversationId: CONVERSATION_A,
      nodeId: "nope",
    });

    expect(result).toEqual({ removed: false, node: null, detachedEdges: [] });
    expect(fake.upsertCallCount()).toBe(0);
  });
});

describe("session requirement", () => {
  it("Test 14: all three procedures reject UNAUTHORIZED without a user", async () => {
    const fake = createFakeDb({ selectRows: [] });
    const caller = makeCaller(null, fake.db);

    await expect(
      caller.chat.addCanvasNode({
        conversationId: CONVERSATION_A,
        nodeType: "email-thread",
        data: { threadId: THREAD_ID },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.chat.connectCanvasNodes({
        conversationId: CONVERSATION_A,
        sourceNodeId: "a",
        targetNodeId: "b",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.chat.removeCanvasNode({ conversationId: CONVERSATION_A, nodeId: "a" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fake.upsertCallCount()).toBe(0);
  });
});
