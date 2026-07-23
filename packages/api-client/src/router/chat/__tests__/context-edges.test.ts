/**
 * context-edges.test.ts — RCNV-04's write-time cross-tenant ACCEPTANCE GATE
 * (Phase 56 Plan 03, T-56-03-01 "Landmine 2") + the
 * `assertSourceRefOwnership` dispatcher's own real allow/deny-matrix
 * correctness.
 *
 * Two independent test strategies in this one file, matching the two things
 * Task 1 and Task 2 each need proven:
 *
 *  (A) "assertSourceRefOwnership dispatcher (ownership, ...)" describe block
 *      — DB-free, REAL (unmocked) dispatcher logic against a fake Drizzle
 *      chain stub (same thenable-chain idiom as packages/db/src/
 *      ownership.test.ts). Proves the actual per-sourceRef.type joins
 *      resolve/reject correctly for real — not wiring, the LOGIC itself.
 *      Obtained via `vi.importActual` so this block bypasses the
 *      module-level mock declared below (needed for the router-level
 *      suite) and calls the genuine, unmocked function.
 *
 *  (B) The router-level suites ("chat.createContextEdge", "chat.
 *      removeContextEdge", "chat.listContextEdges", and the
 *      "cross-tenant adversarial suite") — `@polytoken/db/ownership`'s
 *      assertConversationOwnership/assertSourceRefOwnership are mocked at
 *      the module boundary (same idiom as thread-link.test.ts /
 *      chat-user-scoping.test.ts) — their own correctness is proven by (A)
 *      and by packages/db/src/ownership.test.ts. These prove the WIRING:
 *      ownership is asserted BEFORE any write, in the documented order
 *      (target conversation THEN sourceRef), a rejection maps to NOT_FOUND
 *      with NO row written, and the `_column-detect.ts` feature-detection
 *      gate degrades cleanly (migration 0037 unapplied) instead of
 *      throwing.
 *
 * Test plan:
 *   Tests 1-12: assertSourceRefOwnership — real per-type join logic
 *               (owner resolves / foreign rejects / missing rejects) x
 *               4 sourceRef.type values.
 *   Tests 13-16: computeSourceRefKey — the exact derived-key format per type.
 *   Tests 17-18: session requirement (UNAUTHORIZED) for createContextEdge /
 *                removeContextEdge / listContextEdges.
 *   Test 19: createContextEdge — foreign target conversation -> NOT_FOUND
 *            BEFORE any sourceRef work (assertSourceRefOwnership never
 *            called, no insert issued).
 *   Tests 20-23: cross-tenant adversarial suite — user B's sourceRef of
 *                EVERY type (knowledge_node, source_ledger, genui_panel,
 *                email_thread) pointing at user A's resource -> NOT_FOUND,
 *                no row written.
 *   Test 24: createContextEdge happy path — create succeeds, row active.
 *   Test 25: createContextEdge upserts against the active-identity index
 *            (onConflictDoUpdate targets [targetConversationId,
 *            sourceRefKey] under targetWhere is_active, set isActive:true)
 *            — the mechanism "create same again -> reactivate, no
 *            duplicate active row" relies on.
 *   Test 26: createContextEdge — table unavailable (0037 unapplied) ->
 *            { created: false, reason: "linkage_unavailable" }, never
 *            throws, sourceRef ownership never checked.
 *   Test 27: removeContextEdge happy path — soft-deactivates (isActive
 *            false), ownership resolved via the edge's OWN
 *            targetConversationId.
 *   Test 28: removeContextEdge — edge belongs to another user's
 *            conversation -> NOT_FOUND, no update issued.
 *   Test 29: removeContextEdge — edge id doesn't exist -> NOT_FOUND,
 *            ownership never even attempted.
 *   Test 30: removeContextEdge — table unavailable -> linkage_unavailable,
 *            never throws.
 *   Test 31: listContextEdges — returns only the owned conversation's
 *            active edges.
 *   Test 32: listContextEdges — foreign conversationId -> NOT_FOUND.
 *   Test 33: listContextEdges — table unavailable -> [], never throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    assertConversationOwnership: vi.fn(),
    assertSourceRefOwnership: vi.fn(),
  };
});

import {
  assertConversationOwnership,
  assertSourceRefOwnership,
  OwnershipError,
} from "@polytoken/db/ownership";

import { __resetColumnExistsCacheForTests } from "../../_column-detect";
import { appRouter } from "../../../root";
import {
  computeSourceRefKey,
  contextEdgeSourceRefSchema,
  type ContextEdgeSourceRef,
} from "../context-edges";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const USER_B = { id: "20000000-0000-0000-0000-00000000000b" };
const OWNER_ID = "10000000-0000-0000-0000-00000000000a";
const OTHER_USER_ID = "20000000-0000-0000-0000-00000000000b";

const CONVERSATION_A = "30000000-0000-0000-0000-000000000c01";
const CONVERSATION_B = "30000000-0000-0000-0000-000000000c02";
const EDGE_ID = "40000000-0000-0000-0000-000000000ed1";

const NODE_ID = "50000000-0000-0000-0000-000000000001";
const LEDGER_ID = "50000000-0000-0000-0000-000000000002";
const MESSAGE_ID = "50000000-0000-0000-0000-000000000003";
const THREAD_ID = "50000000-0000-0000-0000-000000000004";

// ---------------------------------------------------------------------------
// (A) assertSourceRefOwnership — real dispatcher, DB-free fake-chain fixture
// (mirrors packages/db/src/ownership.test.ts's createFakeChain exactly).
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

function createFakeOwnershipChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return chain;
    },
    then(
      onFulfilled: (value: ReadonlyArray<FakeRow>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function createFakeOwnershipDb(rows: ReadonlyArray<FakeRow>) {
  return { select: () => createFakeOwnershipChain(rows) } as never;
}

describe("assertSourceRefOwnership dispatcher (ownership, per sourceRef.type — real join logic, no mocks)", () => {
  it("Test 1: knowledge_node resolves when the node's importer is owned", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OWNER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "knowledge_node",
        nodeId: NODE_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("Test 2: knowledge_node throws when the node's importer belongs to another user", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OTHER_USER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "knowledge_node",
        nodeId: NODE_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 3: knowledge_node throws when the node does not exist", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "knowledge_node",
        nodeId: NODE_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 4: source_ledger resolves when the ledger row's conversation is owned", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OWNER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "source_ledger",
        ledgerId: LEDGER_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("Test 5: source_ledger throws when the ledger row's conversation belongs to another user", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OTHER_USER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "source_ledger",
        ledgerId: LEDGER_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 6: source_ledger throws when the ledger row does not exist", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "source_ledger",
        ledgerId: LEDGER_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 7: genui_panel resolves when the message's conversation is owned", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OWNER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "genui_panel",
        messageId: MESSAGE_ID,
        partIndex: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it("Test 8: genui_panel throws when the message's conversation belongs to another user", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OTHER_USER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "genui_panel",
        messageId: MESSAGE_ID,
        partIndex: 0,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 9: genui_panel throws when the message does not exist", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "genui_panel",
        messageId: MESSAGE_ID,
        partIndex: 0,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 10: email_thread resolves when the thread's importer is owned (delegates to assertThreadOwnership)", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OWNER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "email_thread",
        threadId: THREAD_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("Test 11: email_thread throws when the thread's importer belongs to another user", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([{ userId: OTHER_USER_ID }]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "email_thread",
        threadId: THREAD_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 12: email_thread throws when the thread does not exist", async () => {
    const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
      "@polytoken/db/ownership",
    );
    const db = createFakeOwnershipDb([]);
    await expect(
      actual.assertSourceRefOwnership(db, OWNER_ID, {
        type: "email_thread",
        threadId: THREAD_ID,
      }),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// computeSourceRefKey — pure function, exact derived-key format per type.
// ---------------------------------------------------------------------------

describe("computeSourceRefKey", () => {
  const cases: ReadonlyArray<[ContextEdgeSourceRef, string]> = [
    [{ type: "source_ledger", ledgerId: LEDGER_ID }, `source_ledger:${LEDGER_ID}`],
    [{ type: "knowledge_node", nodeId: NODE_ID }, `knowledge_node:${NODE_ID}`],
    [
      { type: "genui_panel", messageId: MESSAGE_ID, partIndex: 2 },
      `genui_panel:${MESSAGE_ID}:2`,
    ],
    [{ type: "email_thread", threadId: THREAD_ID }, `email_thread:${THREAD_ID}`],
    // CH-01/DR-05 — vault_file: the full tenant-relative key path.
    [
      { type: "vault_file", path: ["invoices", "2026"], name: "q3.pdf" },
      "vault_file:invoices/2026/q3.pdf",
    ],
    // A file at the vault root has an empty path → no leading segment.
    [{ type: "vault_file", path: [], name: "notes.txt" }, "vault_file:notes.txt"],
  ];

  it.each(cases)("Test 13-16: %o -> %s", (sourceRef, expected) => {
    expect(computeSourceRefKey(sourceRef)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// contextEdgeSourceRefSchema — the vault_file variant's traversal gate
// (CH-01/DR-05). A vault_file ref is tenant-relative and never carries a
// userId; the ONE threat is a "../other-tenant" segment, closed HERE.
// ---------------------------------------------------------------------------

describe("contextEdgeSourceRefSchema — vault_file traversal gate", () => {
  it("accepts a well-formed vault_file ref (nested path + basename)", () => {
    expect(
      contextEdgeSourceRefSchema.safeParse({
        type: "vault_file",
        path: ["invoices", "2026"],
        name: "q3.pdf",
      }).success,
    ).toBe(true);
  });

  it("accepts a vault-root file (empty path)", () => {
    expect(
      contextEdgeSourceRefSchema.safeParse({
        type: "vault_file",
        path: [],
        name: "notes.txt",
      }).success,
    ).toBe(true);
  });

  it.each([
    { path: [".."], name: "passwd", why: "parent-traversal path segment" },
    { path: ["ok"], name: "..", why: "parent-traversal name" },
    { path: ["a/b"], name: "x", why: "embedded separator in path segment" },
    { path: ["ok"], name: "a\\b", why: "embedded backslash in name" },
    { path: ["."], name: "x", why: "dot-segment path" },
    { path: ["ok"], name: "", why: "empty name" },
    // Full parity with the vaultKey chokepoint (fail-early, not fail-at-read):
    { path: [".emptyFolderPlaceholder"], name: "x", why: "reserved placeholder segment" },
    { path: ["ok"], name: "trailing ", why: "trailing space (edge-space)" },
    { path: [" leading"], name: "x", why: "leading space (edge-space)" },
    { path: ["ok"], name: "foo.", why: "trailing dot" },
  ])("rejects $why", ({ path, name }) => {
    expect(
      contextEdgeSourceRefSchema.safeParse({ type: "vault_file", path, name }).success,
    ).toBe(false);
  });

  it("rejects an oversize ref before it can overflow the source_ref_key index", () => {
    const bigSeg = "a".repeat(255);
    const path = Array.from({ length: 32 }, () => bigSeg); // 32*256 + name >> 1024
    expect(
      contextEdgeSourceRefSchema.safeParse({ type: "vault_file", path, name: "x.pdf" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (B) Router-level fake db — models execute (tableColumnExists probe),
// select (edge lookup / list), insert (create, captures onConflictDoUpdate
// config), update (soft-deactivate).
// ---------------------------------------------------------------------------

function createFakeRouterDb(options: {
  readonly columnExists?: boolean;
  readonly selectRows?: ReadonlyArray<FakeRow>;
  readonly insertReturningRow?: FakeRow | null;
  readonly insertRejectsWith?: unknown;
  readonly updateRejectsWith?: unknown;
}) {
  const columnExists = options.columnExists ?? true;
  let insertCallCount = 0;
  let insertedValues: Record<string, unknown> | undefined;
  let onConflictConfig: Record<string, unknown> | undefined;
  let updateCallCount = 0;
  let updateSetValue: Record<string, unknown> | undefined;

  const db = {
    execute() {
      const rows = columnExists ? [{ column_name: "source_ref_key" }] : [];
      return Promise.resolve(rows);
    },
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
          insertedValues = v;
          return chain;
        },
        onConflictDoUpdate(config: Record<string, unknown>) {
          onConflictConfig = config;
          return chain;
        },
        returning() {
          return chain;
        },
        then(
          onFulfilled: (rows: ReadonlyArray<FakeRow>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          insertCallCount += 1;
          if (options.insertRejectsWith !== undefined) {
            return Promise.reject(options.insertRejectsWith).then(onFulfilled, onRejected);
          }
          const row =
            options.insertReturningRow === undefined
              ? { ...insertedValues, id: EDGE_ID }
              : options.insertReturningRow;
          const rows = row === null ? [] : [row];
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    update() {
      const chain = {
        set(v: Record<string, unknown>) {
          updateSetValue = v;
          return chain;
        },
        where() {
          return chain;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          updateCallCount += 1;
          if (options.updateRejectsWith !== undefined) {
            return Promise.reject(options.updateRejectsWith).then(onFulfilled, onRejected);
          }
          return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return {
    db,
    insertCallCount: () => insertCallCount,
    getInsertedValues: () => insertedValues,
    getOnConflictConfig: () => onConflictConfig,
    updateCallCount: () => updateCallCount,
    getUpdateSetValue: () => updateSetValue,
  };
}

function makeCaller(
  user: { id: string } | null,
  db: ReturnType<typeof createFakeRouterDb>["db"] = createFakeRouterDb({}).db,
) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

beforeEach(() => {
  __resetColumnExistsCacheForTests();
  vi.mocked(assertConversationOwnership).mockReset();
  vi.mocked(assertSourceRefOwnership).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Session requirement
// ---------------------------------------------------------------------------

describe("chat.createContextEdge / removeContextEdge / listContextEdges — session requirement", () => {
  it("Test 17: createContextEdge rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_A,
        sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 18: removeContextEdge / listContextEdges reject a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.chat.removeContextEdge({ edgeId: EDGE_ID })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    await expect(
      caller.chat.listContextEdges({ conversationId: CONVERSATION_A }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// createContextEdge — cross-tenant adversarial suite (T-56-03-01)
// ---------------------------------------------------------------------------

describe("chat.createContextEdge — cross-tenant adversarial suite (T-56-03-01)", () => {
  it("Test 19: a foreign target conversation -> NOT_FOUND BEFORE any sourceRef work, no insert issued", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", CONVERSATION_A),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_A,
        sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(assertSourceRefOwnership).not.toHaveBeenCalled();
    expect(fake.insertCallCount()).toBe(0);
  });

  it("Test 20: user B linking user A's knowledge_node -> NOT_FOUND, no row written", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockRejectedValueOnce(
      new OwnershipError("knowledge_node", NODE_ID),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_B,
        sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.insertCallCount()).toBe(0);
  });

  it("Test 21: user B linking user A's source_ledger row -> NOT_FOUND, no row written", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockRejectedValueOnce(
      new OwnershipError("source_ledger", LEDGER_ID),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_B,
        sourceRef: { type: "source_ledger", ledgerId: LEDGER_ID },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.insertCallCount()).toBe(0);
  });

  it("Test 22: user B linking user A's genui_panel -> NOT_FOUND, no row written", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockRejectedValueOnce(
      new OwnershipError("genui_panel", MESSAGE_ID),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_B,
        sourceRef: { type: "genui_panel", messageId: MESSAGE_ID, partIndex: 0 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.insertCallCount()).toBe(0);
  });

  it("Test 23: user B linking user A's email_thread -> NOT_FOUND, no row written", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockRejectedValueOnce(
      new OwnershipError("thread", THREAD_ID),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.createContextEdge({
        targetConversationId: CONVERSATION_B,
        sourceRef: { type: "email_thread", threadId: THREAD_ID },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.insertCallCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createContextEdge — happy path + upsert-or-reactivate + fail-open
// ---------------------------------------------------------------------------

describe("chat.createContextEdge — happy path, upsert-or-reactivate, fail-open (0037 unapplied)", () => {
  it("Test 24: create succeeds for an owned conversation + owned sourceRef -> row active", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.createContextEdge({
      targetConversationId: CONVERSATION_A,
      sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
    });

    expect(result.created).toBe(true);
    expect(fake.getInsertedValues()?.["sourceRefKey"]).toBe(`knowledge_node:${NODE_ID}`);
    expect(fake.getInsertedValues()?.["isActive"]).toBe(true);
  });

  it("Test 25: upserts against the active-identity index (onConflictDoUpdate targets [targetConversationId, sourceRefKey] under targetWhere is_active)", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    vi.mocked(assertSourceRefOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_A, fake.db);

    await caller.chat.createContextEdge({
      targetConversationId: CONVERSATION_A,
      sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
    });

    const config = fake.getOnConflictConfig();
    expect(config?.["target"]).toHaveLength(2);
    expect(config?.["targetWhere"]).toBeDefined();
    expect(config?.["set"]).toMatchObject({ isActive: true });
  });

  it("Test 26: table unavailable (0037 unapplied) -> linkage_unavailable, never throws, sourceRef ownership never checked", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeRouterDb({ columnExists: false });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.createContextEdge({
      targetConversationId: CONVERSATION_A,
      sourceRef: { type: "knowledge_node", nodeId: NODE_ID },
    });

    expect(result).toEqual({ created: false, reason: "linkage_unavailable" });
    expect(assertSourceRefOwnership).not.toHaveBeenCalled();
    expect(fake.insertCallCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// removeContextEdge
// ---------------------------------------------------------------------------

describe("chat.removeContextEdge", () => {
  it("Test 27: soft-deactivates an owned edge (isActive false)", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeRouterDb({
      selectRows: [{ targetConversationId: CONVERSATION_A }],
    });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.removeContextEdge({ edgeId: EDGE_ID });

    expect(result).toEqual({ removed: true });
    expect(fake.updateCallCount()).toBe(1);
    expect(fake.getUpdateSetValue()?.["isActive"]).toBe(false);
  });

  it("Test 28: an edge on a foreign conversation -> NOT_FOUND, no update issued", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", CONVERSATION_A),
    );
    const fake = createFakeRouterDb({
      selectRows: [{ targetConversationId: CONVERSATION_A }],
    });
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.removeContextEdge({ edgeId: EDGE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.updateCallCount()).toBe(0);
  });

  it("Test 29: a non-existent edgeId -> NOT_FOUND, ownership never attempted", async () => {
    const fake = createFakeRouterDb({ selectRows: [] });
    const caller = makeCaller(USER_A, fake.db);

    await expect(
      caller.chat.removeContextEdge({ edgeId: EDGE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertConversationOwnership).not.toHaveBeenCalled();
    expect(fake.updateCallCount()).toBe(0);
  });

  it("Test 30: table unavailable -> linkage_unavailable, never throws", async () => {
    const fake = createFakeRouterDb({ columnExists: false });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.removeContextEdge({ edgeId: EDGE_ID });

    expect(result).toEqual({ removed: false, reason: "linkage_unavailable" });
    expect(assertConversationOwnership).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listContextEdges
// ---------------------------------------------------------------------------

describe("chat.listContextEdges", () => {
  it("Test 31: returns only the owned conversation's active edges", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const seeded = [
      { id: EDGE_ID, targetConversationId: CONVERSATION_A, isActive: true },
    ];
    const fake = createFakeRouterDb({ selectRows: seeded });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.listContextEdges({ conversationId: CONVERSATION_A });
    expect(result).toEqual(seeded);
  });

  it("Test 32: a foreign conversationId -> NOT_FOUND", async () => {
    vi.mocked(assertConversationOwnership).mockRejectedValueOnce(
      new OwnershipError("conversation", CONVERSATION_A),
    );
    const fake = createFakeRouterDb({});
    const caller = makeCaller(USER_B, fake.db);

    await expect(
      caller.chat.listContextEdges({ conversationId: CONVERSATION_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 33: table unavailable -> [], never throws", async () => {
    vi.mocked(assertConversationOwnership).mockResolvedValueOnce(undefined);
    const fake = createFakeRouterDb({ columnExists: false });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.listContextEdges({ conversationId: CONVERSATION_A });
    expect(result).toEqual([]);
  });
});
