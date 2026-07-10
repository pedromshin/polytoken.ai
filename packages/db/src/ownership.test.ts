/**
 * ownership.test.ts — allow/deny matrix for the central ownership helper (TENA-03).
 *
 * DB-free: a fake Drizzle chain stub (select/from/innerJoin/where/limit, all
 * returning `this`, terminal `.then()` resolving to a seeded rows array)
 * stands in for the real Drizzle handle. This repo has no prior precedent
 * for mocking ctx.db chains (see packages/api-client/src/router/chat/__tests__/cost.test.ts's
 * doc comment) — ownership.ts IS the query, so a pure-helper-only test
 * strategy cannot cover it; the chain stub is introduced here as this
 * plan's own fixture, not a re-use of an existing pattern.
 *
 * Test plan:
 *   Test 1-2:  userOwnedImporterIds — exact owned set, [] for owner-less user.
 *   Test 3-5:  assertImporterOwnership — owner allowed, other-user rejected, missing rejected.
 *   Test 6-8:  assertEmailOwnership — owner allowed, other-user rejected, missing rejected.
 *   Test 9-11: assertComponentOwnership — owner allowed, other-user rejected, missing rejected.
 *   Test 12-14: assertConversationOwnership — owner allowed, other-user rejected, missing rejected.
 *   Test 15:   OwnershipError carries { resource, id }.
 */

import { describe, expect, it } from "vitest";

import {
  assertComponentOwnership,
  assertConversationOwnership,
  assertEmailOwnership,
  assertForwardingAddressOwnership,
  assertImporterOwnership,
  assertThreadOwnership,
  OwnershipError,
  userOwnedImporterIds,
  type OwnershipDb,
} from "./ownership";

// ---------------------------------------------------------------------------
// Fake Drizzle chain stub
// ---------------------------------------------------------------------------

const OWNER_ID = "10000000-0000-0000-0000-000000000001";
const OTHER_USER_ID = "20000000-0000-0000-0000-000000000002";
const TARGET_ID = "30000000-0000-0000-0000-000000000003";

/**
 * A minimal thenable chain mimicking the subset of Drizzle's query-builder
 * surface ownership.ts calls (select/from/innerJoin/where/limit). Every
 * chain method returns the same object; the terminal `.then()` resolves to
 * the seeded `rows` array regardless of what was passed to from/where/limit
 * — this is a fixture for testing ownership.ts's interpretation of a query
 * RESULT, not a real query engine.
 */
function createFakeChain(rows: ReadonlyArray<Record<string, unknown>>) {
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
      onFulfilled: (value: ReadonlyArray<Record<string, unknown>>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function createFakeDb(rows: ReadonlyArray<Record<string, unknown>>): OwnershipDb {
  const fakeDb = {
    select() {
      return createFakeChain(rows);
    },
  };
  return fakeDb as unknown as OwnershipDb;
}

// ---------------------------------------------------------------------------
// userOwnedImporterIds
// ---------------------------------------------------------------------------

describe("userOwnedImporterIds", () => {
  it("Test 1: returns the exact owned importer id set", async () => {
    const db = createFakeDb([{ id: "imp-1" }, { id: "imp-2" }]);

    const result = await userOwnedImporterIds(db, OWNER_ID);

    expect(result).toEqual(["imp-1", "imp-2"]);
  });

  it("Test 2: returns [] for an owner-less user", async () => {
    const db = createFakeDb([]);

    const result = await userOwnedImporterIds(db, OWNER_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assertImporterOwnership
// ---------------------------------------------------------------------------

describe("assertImporterOwnership", () => {
  it("Test 3: resolves when importers.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertImporterOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("Test 4: throws OwnershipError when the importer belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertImporterOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 5: throws OwnershipError when the importer does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertImporterOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// assertEmailOwnership
// ---------------------------------------------------------------------------

describe("assertEmailOwnership", () => {
  it("Test 6: resolves when emails.importer_id -> importers.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertEmailOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("Test 7: throws OwnershipError when the email's importer belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertEmailOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 8: throws OwnershipError when the email does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertEmailOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// assertComponentOwnership
// ---------------------------------------------------------------------------

describe("assertComponentOwnership", () => {
  it("Test 9: resolves when email_components -> importers.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertComponentOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("Test 10: throws OwnershipError when the component's importer belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertComponentOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 11: throws OwnershipError when the component does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertComponentOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// assertThreadOwnership
// ---------------------------------------------------------------------------

describe("assertThreadOwnership", () => {
  it("resolves when threads.importer_id -> importers.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertThreadOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("throws OwnershipError when the thread's importer belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertThreadOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("throws OwnershipError when the thread does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertThreadOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// assertConversationOwnership
// ---------------------------------------------------------------------------

describe("assertConversationOwnership", () => {
  it("Test 12: resolves when chat_conversations.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertConversationOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("Test 13: throws OwnershipError when the conversation belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertConversationOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("Test 14: throws OwnershipError when the conversation does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertConversationOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// assertForwardingAddressOwnership
// ---------------------------------------------------------------------------

describe("assertForwardingAddressOwnership", () => {
  it("resolves when forwarding_addresses.user_id = userId", async () => {
    const db = createFakeDb([{ userId: OWNER_ID }]);

    await expect(
      assertForwardingAddressOwnership(db, TARGET_ID, OWNER_ID),
    ).resolves.toBeUndefined();
  });

  it("throws OwnershipError when the address belongs to another user", async () => {
    const db = createFakeDb([{ userId: OTHER_USER_ID }]);

    await expect(
      assertForwardingAddressOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });

  it("throws OwnershipError when the address does not exist", async () => {
    const db = createFakeDb([]);

    await expect(
      assertForwardingAddressOwnership(db, TARGET_ID, OWNER_ID),
    ).rejects.toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// OwnershipError
// ---------------------------------------------------------------------------

describe("OwnershipError", () => {
  it("Test 15: carries { resource, id } for the caller to map to a transport code", async () => {
    const db = createFakeDb([]);

    try {
      await assertConversationOwnership(db, TARGET_ID, OWNER_ID);
      throw new Error("expected assertConversationOwnership to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OwnershipError);
      const ownershipError = error as OwnershipError;
      expect(ownershipError.resource).toBe("conversation");
      expect(ownershipError.id).toBe(TARGET_ID);
    }
  });
});
