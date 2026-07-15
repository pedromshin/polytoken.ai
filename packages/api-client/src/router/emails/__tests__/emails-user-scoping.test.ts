/**
 * emails-user-scoping.test.ts — cross-tenant regression tests for the emails
 * tRPC router (Phase 44 Plan 05, TENA-03).
 *
 * Strategy: `@polytoken/db/ownership` is mocked at the module boundary — its
 * own allow/deny-matrix correctness is exhaustively covered by
 * packages/db/src/ownership.test.ts (44-02). These tests instead prove the
 * WIRING at the router boundary: every emails-router procedure (a) requires a
 * session (protectedProcedure -> UNAUTHORIZED for a sessionless call), (b)
 * derives its ownership check from ctx.user.id — never a client-supplied
 * field, and (c) maps a rejected ownership check to TRPCError NOT_FOUND
 * BEFORE any data query executes.
 *
 * A minimal fake Drizzle chain stub (same idiom as
 * packages/db/src/ownership.test.ts) stands in for ctx.db's own data queries
 * (list/byId/detail's post-ownership SELECT calls) — it always resolves the
 * same seeded rows regardless of the where/order/limit arguments passed to
 * it, which is exactly what makes Test 9 below a meaningful proof: if the
 * procedure ever regressed to skip the ownership-derived scope check, the
 * seeded "leaked" row would appear in the result.
 *
 * Test plan:
 *   Test 1-4:  every read procedure (list/byId/detail/entitySummary) rejects
 *              a sessionless call with UNAUTHORIZED.
 *   Test 5-6:  byId — NOT_FOUND for another user's email; resolves for the owner.
 *   Test 7:    detail — NOT_FOUND for another user's email.
 *   Test 8:    detail — does not throw once ownership resolves.
 *   Test 9:    entitySummary — an owner-less caller gets empty entities for
 *              every id AND the components table is never queried (proves
 *              the short-circuit, not just an empty final result).
 *   Test 10:   list — an owner-less caller gets an empty page.
 *   Test 11:   list — a non-owned importerId filter is rejected (empty page)
 *              even though the fake db is seeded with a "leaked" row for it.
 *   Test 12:   list — an owned importerId filter is honored.
 *   Test 13-17: resolveListScope (pure helper) — DB-free allow/deny matrix.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    userOwnedImporterIds: vi.fn(),
    assertEmailOwnership: vi.fn(),
    assertComponentOwnership: vi.fn(),
  };
});

import {
  assertComponentOwnership,
  assertEmailOwnership,
  OwnershipError,
  userOwnedImporterIds,
} from "@polytoken/db/ownership";

import { appRouter } from "../../../root";
import { resolveListScope } from "../index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const IMPORTER_B = "30000000-0000-0000-0000-000000000b02";
const EMAIL_A_ID = "40000000-0000-0000-0000-000000000a01";

type FakeRow = Record<string, unknown>;

/**
 * A minimal thenable chain mimicking the subset of Drizzle's query-builder
 * surface the emails router calls (select/from/leftJoin/where/orderBy/
 * limit/offset). Every chain method returns the same object; the terminal
 * `.then()` resolves to the seeded `rows` array regardless of what was
 * passed to from/where/limit — a fixture for testing the ROUTER's
 * interpretation of a query result, not a real query engine (same idiom as
 * packages/db/src/ownership.test.ts).
 */
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

function createFakeDb(selectCalls: { count: number }, rows: ReadonlyArray<FakeRow>) {
  return {
    select() {
      selectCalls.count += 1;
      return createFakeChain(rows);
    },
  };
}

function makeCaller(
  user: { id: string } | null,
  rows: ReadonlyArray<FakeRow> = [],
  selectCalls: { count: number } = { count: 0 },
) {
  return appRouter.createCaller({
    db: createFakeDb(selectCalls, rows) as never,
    headers: new Headers(),
    user,
  });
}

// ---------------------------------------------------------------------------
// Session requirement (T-44-05-04)
// ---------------------------------------------------------------------------

describe("emailsRouter — session requirement (T-44-05-04)", () => {
  it("Test 1: emails.list rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.emails.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 2: emails.byId rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.emails.byId({ id: EMAIL_A_ID })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 3: emails.detail rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.emails.detail({ id: EMAIL_A_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("Test 4: emails.entitySummary rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.emails.entitySummary({ emailIds: [EMAIL_A_ID] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// byId / detail cross-tenant isolation (T-44-05-02)
// ---------------------------------------------------------------------------

describe("emailsRouter — byId / detail cross-tenant isolation (T-44-05-02)", () => {
  afterEach(() => {
    vi.mocked(assertEmailOwnership).mockReset();
  });

  it("Test 5: byId throws NOT_FOUND when the target email belongs to another user", async () => {
    vi.mocked(assertEmailOwnership).mockRejectedValueOnce(
      new OwnershipError("email", EMAIL_A_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(caller.emails.byId({ id: EMAIL_A_ID })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(assertEmailOwnership).toHaveBeenCalledWith(
      expect.anything(),
      EMAIL_A_ID,
      USER_A.id,
    );
  });

  it("Test 6: byId returns the row once ownership resolves", async () => {
    vi.mocked(assertEmailOwnership).mockResolvedValueOnce(undefined);
    const caller = makeCaller(USER_A, [{ id: EMAIL_A_ID, subject: "hi" }]);

    const result = await caller.emails.byId({ id: EMAIL_A_ID });
    expect(result).toMatchObject({ id: EMAIL_A_ID });
  });

  it("Test 7: detail throws NOT_FOUND when the target email belongs to another user", async () => {
    vi.mocked(assertEmailOwnership).mockRejectedValueOnce(
      new OwnershipError("email", EMAIL_A_ID),
    );
    const caller = makeCaller(USER_A);

    await expect(
      caller.emails.detail({ id: EMAIL_A_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 8: detail does not throw once ownership resolves", async () => {
    vi.mocked(assertEmailOwnership).mockResolvedValueOnce(undefined);
    const caller = makeCaller(USER_A, []);

    await expect(
      caller.emails.detail({ id: EMAIL_A_ID }),
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// entitySummary — owner-less caller short-circuits (T-44-05-01)
// ---------------------------------------------------------------------------

describe("emailsRouter — entitySummary scoping (T-44-05-01)", () => {
  afterEach(() => {
    vi.mocked(userOwnedImporterIds).mockReset();
  });

  it("Test 9: an owner-less caller gets empty entities for every id, and no query is issued", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const selectCalls = { count: 0 };
    const caller = makeCaller(
      USER_A,
      [{ emailId: EMAIL_A_ID, entityTypeId: "et-1", label: "Invoice" }],
      selectCalls,
    );

    const result = await caller.emails.entitySummary({
      emailIds: [EMAIL_A_ID],
    });

    // 60-01 Task 2: EmailEntitySummary gained `totalCount` (T-60-03) — the
    // owner-less short-circuit's shape was updated in lockstep.
    expect(result).toEqual([{ emailId: EMAIL_A_ID, entities: [], totalCount: 0 }]);
    expect(selectCalls.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// list scoping (T-44-05-01)
// ---------------------------------------------------------------------------

describe("emailsRouter — list scoping (T-44-05-01)", () => {
  afterEach(() => {
    vi.mocked(userOwnedImporterIds).mockReset();
  });

  it("Test 10: list returns an empty page when the caller owns no importers", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const caller = makeCaller(USER_A, [{ id: "should-not-appear" }]);

    const result = await caller.emails.list({});
    expect(result.items).toEqual([]);
  });

  it("Test 11: a non-owned importerId filter is rejected — user A cannot read via user B's importerId", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    // Seeded with a row the fake db would happily return if the procedure
    // ever queried without the ownership-derived scope.
    const caller = makeCaller(USER_A, [
      { id: "leaked-row", importerId: IMPORTER_B },
    ]);

    const result = await caller.emails.list({ importerId: IMPORTER_B });
    expect(result.items).toEqual([]);
  });

  it("Test 12: an owned importerId filter is honored", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      { id: "row-1", importerId: IMPORTER_A },
    ]);

    const result = await caller.emails.list({ importerId: IMPORTER_A });
    expect(result.items).toEqual([{ id: "row-1", importerId: IMPORTER_A }]);
  });
});

// ---------------------------------------------------------------------------
// resolveListScope — pure helper, DB-free allow/deny matrix
// ---------------------------------------------------------------------------

describe("resolveListScope", () => {
  it("Test 13: no requested importerId scopes to the full owned set", () => {
    expect(resolveListScope([IMPORTER_A, IMPORTER_B], undefined)).toEqual({
      ok: true,
      importerIds: [IMPORTER_A, IMPORTER_B],
    });
  });

  it("Test 14: a requested importerId in the owned set narrows to just that id", () => {
    expect(resolveListScope([IMPORTER_A, IMPORTER_B], IMPORTER_A)).toEqual({
      ok: true,
      importerIds: [IMPORTER_A],
    });
  });

  it("Test 15: a requested importerId NOT in the owned set is rejected", () => {
    expect(resolveListScope([IMPORTER_A], IMPORTER_B)).toEqual({ ok: false });
  });

  it("Test 16: an owner-less caller is rejected regardless of the requested importerId", () => {
    expect(resolveListScope([], undefined)).toEqual({ ok: false });
    expect(resolveListScope([], IMPORTER_A)).toEqual({ ok: false });
  });

  it("Test 17: never returns an importerId outside the owned set", () => {
    const result = resolveListScope([IMPORTER_A], IMPORTER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.importerIds).not.toContain(IMPORTER_B);
    }
  });
});

// ---------------------------------------------------------------------------
// Write-side matrix — component mutations cross-tenant rejection (T-44-05-03)
//
// Task 2: at least one representative componentId-keyed mutation (accept) and
// one representative emailId-keyed mutation (reprocessEmail) must reject a
// cross-tenant write; merge (multi-id) must assert ownership for EVERY id.
// ---------------------------------------------------------------------------

const COMPONENT_ID = "50000000-0000-0000-0000-000000000c01";
const COMPONENT_ID_2 = "50000000-0000-0000-0000-000000000c02";
const OTHER_EMAIL_ID = "40000000-0000-0000-0000-000000000b02";

describe("componentMutationProcedures — cross-tenant write rejection (T-44-05-03)", () => {
  afterEach(() => {
    vi.mocked(assertComponentOwnership).mockReset();
    vi.mocked(assertEmailOwnership).mockReset();
    vi.unstubAllGlobals();
  });

  it("Test 18: accept (componentId-keyed) rejects a component owned by another user, never reaching fetch", async () => {
    vi.mocked(assertComponentOwnership).mockRejectedValueOnce(
      new OwnershipError("component", COMPONENT_ID),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = makeCaller(USER_A);

    await expect(
      caller.emails.accept({ componentId: COMPONENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertComponentOwnership).toHaveBeenCalledWith(
      expect.anything(),
      COMPONENT_ID,
      USER_A.id,
    );
  });

  it("Test 19: reprocessEmail (emailId-keyed) rejects an email owned by another user, never reaching fetch", async () => {
    vi.mocked(assertEmailOwnership).mockRejectedValueOnce(
      new OwnershipError("email", OTHER_EMAIL_ID),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = makeCaller(USER_A);

    await expect(
      caller.emails.reprocessEmail({ emailId: OTHER_EMAIL_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 20: merge (multi-id) rejects when ANY referenced componentId is owned by another user", async () => {
    vi.mocked(assertComponentOwnership)
      .mockResolvedValueOnce(undefined) // COMPONENT_ID: owned
      .mockRejectedValueOnce(new OwnershipError("component", COMPONENT_ID_2)); // COMPONENT_ID_2: foreign
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = makeCaller(USER_A);

    await expect(
      caller.emails.merge({ componentIds: [COMPONENT_ID, COMPONENT_ID_2] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertComponentOwnership).toHaveBeenCalledWith(
      expect.anything(),
      COMPONENT_ID,
      USER_A.id,
    );
    expect(assertComponentOwnership).toHaveBeenCalledWith(
      expect.anything(),
      COMPONENT_ID_2,
      USER_A.id,
    );
  });

  it("Test 21: nest asserts ownership of parentComponentId too when provided (splice-prevention)", async () => {
    vi.mocked(assertComponentOwnership)
      .mockResolvedValueOnce(undefined) // target componentId: owned
      .mockRejectedValueOnce(new OwnershipError("component", COMPONENT_ID_2)); // parentComponentId: foreign
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = makeCaller(USER_A);

    await expect(
      caller.emails.nest({
        componentId: COMPONENT_ID,
        parentComponentId: COMPONENT_ID_2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
