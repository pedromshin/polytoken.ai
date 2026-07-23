/**
 * graph-hidden-types.test.ts — retired/inactive entity types must not leak
 * into the knowledge graph payload.
 *
 * The SQL half (is_active + retired-slug exclusion in the WHERE clause) is
 * not evaluable through the queue-based fake db; what IS provable here is
 * the JS half: rows referencing a type that did not make it into the graph
 * (fields of hidden types, instances of hidden types) are dropped instead of
 * rendering as orphan nodes with dangling edges.
 *
 * Harness mirrors knowledge-user-scoping.test.ts (queue-based fake db,
 * ownership mocked at the module boundary).
 *
 * Test plan:
 *   Test 1: RETIRED_SYSTEM_TYPE_SLUGS pins the six 0049/0050 maritime slugs.
 *   Test 2: a field row whose parent type is hidden emits no
 *           entity_type_field node and no has_field edge.
 *   Test 3: with includeInstances, an instance of a hidden type emits no
 *           entity_instance node and no instance_of edge.
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

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { appRouter } from "../../root";
import { RETIRED_SYSTEM_TYPE_SLUGS } from "../retired-entity-types";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const VISIBLE_TYPE_ID = "70000000-0000-0000-0000-000000000001";
const HIDDEN_TYPE_ID = "70000000-0000-0000-0000-00000000dead";
const VISIBLE_FIELD_ID = "70000000-0000-0000-0000-00000000f001";
const ORPHAN_FIELD_ID = "70000000-0000-0000-0000-00000000f0dd";
const VISIBLE_INSTANCE_ID = "90000000-0000-0000-0000-000000000001";
const ORPHAN_INSTANCE_ID = "90000000-0000-0000-0000-00000000dead";

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

function makeCaller(resultQueue: ReadonlyArray<ReadonlyArray<FakeRow>>) {
  const queue = [...resultQueue];
  const db = {
    select() {
      return createFakeChain(queue.shift() ?? []);
    },
  };
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user: USER_A,
  });
}

afterEach(() => {
  vi.mocked(userOwnedImporterIds).mockReset();
});

const VISIBLE_TYPE_ROW = {
  id: VISIBLE_TYPE_ID,
  label: "Invoice",
  slug: "invoice",
};

describe("knowledge.graph — hidden entity types stay hidden", () => {
  it("Test 1: the retired-slug allow-list pins the six 0049/0050 maritime slugs", () => {
    expect([...RETIRED_SYSTEM_TYPE_SLUGS].sort()).toEqual(
      [
        "bill_of_lading",
        "booking",
        "container",
        "maritime_line",
        "shipment",
        "supplier",
      ].sort(),
    );
  });

  it("Test 2: fields of a hidden type emit no orphan node and no has_field edge", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([IMPORTER_A]);
    const caller = makeCaller([
      // (1) entity types — the hidden type is already excluded by SQL.
      [VISIBLE_TYPE_ROW],
      // (2) fields — the db still returns a row pointing at the hidden type.
      [
        {
          id: VISIBLE_FIELD_ID,
          label: "Amount",
          slug: "amount",
          entityTypeId: VISIBLE_TYPE_ID,
          fieldType: "text",
          isRequired: false,
        },
        {
          id: ORPHAN_FIELD_ID,
          label: "Vessel",
          slug: "vessel",
          entityTypeId: HIDDEN_TYPE_ID,
          fieldType: "text",
          isRequired: false,
        },
      ],
      // remaining layers resolve empty
    ]);

    const graph = await caller.knowledge.graph({});

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain(VISIBLE_FIELD_ID);
    expect(nodeIds).not.toContain(ORPHAN_FIELD_ID);
    expect(
      graph.edges.some((e) => e.target === ORPHAN_FIELD_ID),
    ).toBe(false);
  });

  it("Test 3: instances of a hidden type emit no node and no instance_of edge", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([IMPORTER_A]);
    const caller = makeCaller([
      // (1) entity types
      [VISIBLE_TYPE_ROW],
      // (2) fields
      [],
      // (3) instance counts
      [],
      // (4) instances — one belongs to a hidden type
      [
        {
          id: VISIBLE_INSTANCE_ID,
          displayName: "ACME Invoice #1",
          entityTypeId: VISIBLE_TYPE_ID,
        },
        {
          id: ORPHAN_INSTANCE_ID,
          displayName: "MSC OSCAR",
          entityTypeId: HIDDEN_TYPE_ID,
        },
      ],
      // remaining layers resolve empty
    ]);

    const graph = await caller.knowledge.graph({ includeInstances: true });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain(VISIBLE_INSTANCE_ID);
    expect(nodeIds).not.toContain(ORPHAN_INSTANCE_ID);
    expect(
      graph.edges.some(
        (e) => e.source === ORPHAN_INSTANCE_ID || e.id === `instance-type-${ORPHAN_INSTANCE_ID}`,
      ),
    ).toBe(false);
  });
});
