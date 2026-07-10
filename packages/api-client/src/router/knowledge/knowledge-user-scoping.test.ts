/**
 * knowledge-user-scoping.test.ts — cross-tenant regression tests for the
 * knowledge tRPC router (Phase 44 Plan 06, TENA-03).
 *
 * Strategy (mirrors entities-user-scoping.test.ts / 44-05's emails suite):
 * `@polytoken/db/ownership` is mocked at the module boundary — its own
 * allow/deny correctness is covered by packages/db/src/ownership.test.ts
 * (44-02). These tests prove the WIRING: session required, scope derived
 * from ctx.user.id, ownership rejection maps to NOT_FOUND, and — specific
 * to this router — the system-default entity-type taxonomy stays visible
 * while every tenant-owned layer is bounded to owned importers.
 *
 * The fake ctx.db is QUEUE-based (each select() consumes the next seeded
 * result) because knowledge.graph issues several sequential SELECTs whose
 * order is deterministic: entityTypes -> fields -> [instanceCounts ->
 * knowledgeNodes -> (knLinks) -> explicitEdges, all skipped for an
 * owner-less caller].
 *
 * Test plan:
 *   Test 1-4:  list / graph / byId / expandNode reject a sessionless call
 *              with UNAUTHORIZED.
 *   Test 5:    list — an owner-less caller gets an empty page (no query).
 *   Test 6:    list — a non-owned importerId filter is rejected (empty page)
 *              even though the fake db is seeded with a "leaked" row.
 *   Test 7:    list — an owned importerId filter is honored.
 *   Test 8:    graph — a non-owned importerId filter fails closed to an
 *              EMPTY graph with zero queries issued.
 *   Test 9:    graph — an owner-less caller still sees the system-default
 *              (NULL importer) taxonomy, and ONLY the two taxonomy queries
 *              run (instances/knowledge/explicit-edge layers skipped).
 *   Test 10:   byId — NOT_FOUND when the node's importer belongs to another
 *              user.
 *   Test 11:   byId — null for a missing node (pre-existing contract);
 *              resolves for the owner.
 *   Test 12:   expandNode — NOT_FOUND when the SEED node's importer belongs
 *              to another user (T-44-06-03, the "expand any node id" gap).
 *   Test 13:   expandNode — missing seed still returns an EMPTY response
 *              (T-32-03 fail-closed, unchanged).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    userOwnedImporterIds: vi.fn(),
    assertImporterOwnership: vi.fn(),
  };
});

import {
  assertImporterOwnership,
  OwnershipError,
  userOwnedImporterIds,
} from "@polytoken/db/ownership";

import { appRouter } from "../../root";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const IMPORTER_B = "30000000-0000-0000-0000-000000000b02";
const NODE_ID = "80000000-0000-0000-0000-000000000001";
const TYPE_ID = "70000000-0000-0000-0000-000000000001";
const FIELD_ID = "70000000-0000-0000-0000-00000000f001";

type FakeRow = Record<string, unknown>;

function createFakeChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    groupBy() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
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

/**
 * Queue-based fake: each select() consumes the next seeded result set; an
 * exhausted queue resolves []. `selectCalls.count` proves which layers were
 * (not) queried.
 */
function makeCaller(
  user: { id: string } | null,
  resultQueue: ReadonlyArray<ReadonlyArray<FakeRow>> = [],
  selectCalls: { count: number } = { count: 0 },
) {
  const queue = [...resultQueue];
  const db = {
    select() {
      selectCalls.count += 1;
      return createFakeChain(queue.shift() ?? []);
    },
  };
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

afterEach(() => {
  vi.mocked(userOwnedImporterIds).mockReset();
  vi.mocked(assertImporterOwnership).mockReset();
});

// ---------------------------------------------------------------------------
// Session requirement
// ---------------------------------------------------------------------------

describe("knowledgeRouter — session requirement (TENA-03)", () => {
  it("Test 1: knowledge.list rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.knowledge.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 2: knowledge.graph rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.knowledge.graph({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 3: knowledge.byId rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.knowledge.byId({ id: NODE_ID })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
  });

  it("Test 4: knowledge.expandNode rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.knowledge.expandNode({ nodeId: NODE_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// list scoping (T-44-06-01)
// ---------------------------------------------------------------------------

describe("knowledgeRouter — list scoping (T-44-06-01)", () => {
  it("Test 5: list returns an empty page (and issues no query) when the caller owns no importers", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const selectCalls = { count: 0 };
    const caller = makeCaller(
      USER_A,
      [[{ id: NODE_ID, importerId: IMPORTER_B }]],
      selectCalls,
    );

    const result = await caller.knowledge.list({});
    expect(result.items).toEqual([]);
    expect(selectCalls.count).toBe(0);
  });

  it("Test 6: a non-owned importerId filter is rejected — user A cannot read via user B's importerId", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      [{ id: "leaked-node", importerId: IMPORTER_B }],
    ]);

    const result = await caller.knowledge.list({ importerId: IMPORTER_B });
    expect(result.items).toEqual([]);
  });

  it("Test 7: an owned importerId filter is honored", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      [{ id: NODE_ID, title: "Rule", importerId: IMPORTER_A }],
    ]);

    const result = await caller.knowledge.list({ importerId: IMPORTER_A });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: NODE_ID });
    expect(userOwnedImporterIds).toHaveBeenCalledWith(
      expect.anything(),
      USER_A.id,
    );
  });
});

// ---------------------------------------------------------------------------
// graph scoping (T-44-06-01) — system defaults preserved
// ---------------------------------------------------------------------------

describe("knowledgeRouter — graph scoping (T-44-06-01)", () => {
  it("Test 8: a non-owned importerId filter fails closed to an empty graph, zero queries", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const selectCalls = { count: 0 };
    const caller = makeCaller(
      USER_A,
      [[{ id: TYPE_ID, label: "Leak", slug: "leak" }]],
      selectCalls,
    );

    const result = await caller.knowledge.graph({ importerId: IMPORTER_B });
    expect(result).toEqual({ nodes: [], edges: [] });
    expect(selectCalls.count).toBe(0);
  });

  it("Test 9: an owner-less caller still sees the system-default taxonomy — and ONLY the taxonomy queries run", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const selectCalls = { count: 0 };
    const caller = makeCaller(
      USER_A,
      [
        // (1) entity_type rows — the seeded NULL-importer taxonomy
        [{ id: TYPE_ID, label: "Bill of Lading", slug: "bill_of_lading" }],
        // (2) entity_type_field rows
        [
          {
            id: FIELD_ID,
            label: "Shipper",
            slug: "shipper_name",
            entityTypeId: TYPE_ID,
            fieldType: "string",
            isRequired: false,
          },
        ],
      ],
      selectCalls,
    );

    const result = await caller.knowledge.graph({});

    // System-default taxonomy visible (D-02 never-blank preserved).
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: TYPE_ID, type: "entity_type" }),
        expect.objectContaining({ id: FIELD_ID, type: "entity_type_field" }),
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationType: "has_field" }),
      ]),
    );
    // ONLY the two taxonomy queries ran: instanceCounts, knowledgeNodes,
    // knLinks, and the explicit-edge union were all skipped for an
    // owner-less caller — those layers are owned-importer bounded.
    expect(selectCalls.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// byId cross-tenant isolation (T-44-06-02)
// ---------------------------------------------------------------------------

describe("knowledgeRouter — byId cross-tenant isolation (T-44-06-02)", () => {
  it("Test 10: byId throws NOT_FOUND when the node's importer belongs to another user", async () => {
    vi.mocked(assertImporterOwnership).mockRejectedValueOnce(
      new OwnershipError("importer", IMPORTER_B),
    );
    const caller = makeCaller(USER_A, [
      [{ id: NODE_ID, title: "Foreign rule", importerId: IMPORTER_B }],
    ]);

    await expect(caller.knowledge.byId({ id: NODE_ID })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(assertImporterOwnership).toHaveBeenCalledWith(
      expect.anything(),
      IMPORTER_B,
      USER_A.id,
    );
  });

  it("Test 11: byId returns null for a missing node; resolves for the owner", async () => {
    const missing = makeCaller(USER_A, [[]]);
    await expect(missing.knowledge.byId({ id: NODE_ID })).resolves.toBeNull();
    expect(assertImporterOwnership).not.toHaveBeenCalled();

    vi.mocked(assertImporterOwnership).mockResolvedValueOnce(undefined);
    const owner = makeCaller(USER_A, [
      [{ id: NODE_ID, title: "My rule", importerId: IMPORTER_A }],
      [], // edges
    ]);
    const result = await owner.knowledge.byId({ id: NODE_ID });
    expect(result?.node).toMatchObject({ id: NODE_ID });
  });
});

// ---------------------------------------------------------------------------
// expandNode seed-ownership gate (T-44-06-03)
// ---------------------------------------------------------------------------

describe("knowledgeRouter — expandNode seed-ownership gate (T-44-06-03)", () => {
  it("Test 12: expandNode throws NOT_FOUND when the SEED node belongs to another user", async () => {
    vi.mocked(assertImporterOwnership).mockRejectedValueOnce(
      new OwnershipError("importer", IMPORTER_B),
    );
    const caller = makeCaller(USER_A, [
      [{ id: NODE_ID, importerId: IMPORTER_B, isActive: true }],
    ]);

    await expect(
      caller.knowledge.expandNode({ nodeId: NODE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertImporterOwnership).toHaveBeenCalledWith(
      expect.anything(),
      IMPORTER_B,
      USER_A.id,
    );
  });

  it("Test 13: expandNode still returns an EMPTY response for a missing seed (T-32-03, unchanged)", async () => {
    const caller = makeCaller(USER_A, [[]]);

    await expect(
      caller.knowledge.expandNode({ nodeId: NODE_ID }),
    ).resolves.toEqual({ nodes: [], edges: [], truncated: false });
    expect(assertImporterOwnership).not.toHaveBeenCalled();
  });
});
