/**
 * code-islands-router.test.ts — Phase 76 (BTAP-04/09/10) tenancy + wiring for
 * codeIslandsRouter, driven through the REAL appRouter.createCaller over a fake
 * Drizzle chain (the same idiom as cross-tenant-adversarial.test.ts). Ownership
 * correctness itself lives in packages/db/ownership.test.ts; here the ownership
 * assert is mocked at the module boundary so we prove the ROUTER wires it:
 *
 *   - every proc is protected (sessionless → UNAUTHORIZED);
 *   - byId/remove assert ownership FIRST → NOT_FOUND for a non-owner (fail-closed);
 *   - byId returns the owned row after the assert passes;
 *   - create stamps ctx.user.id server-side (never a client field) and returns
 *     the new island id;
 *   - remove deletes and reports removal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return { ...actual, assertCodeIslandOwnership: vi.fn() };
});

import { assertCodeIslandOwnership, OwnershipError } from "@polytoken/db/ownership";

import { appRouter } from "../../../root";

const USER_A = { id: "a1000000-0000-0000-0000-00000000000a" };
const ISLAND_A = "c1000000-0000-0000-0000-0000000000c1";

type FakeRow = Record<string, unknown>;

/** select().from().where().limit() thenable resolving the seeded rows. */
function createSelectChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (ok: (v: ReadonlyArray<FakeRow>) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err),
  };
  return chain;
}

/** insert().values().returning() resolving the seeded returning-rows, and
 * capturing the inserted values so the test can assert owner-stamping. */
function makeDb(opts: {
  selectRows?: ReadonlyArray<FakeRow>;
  insertReturning?: ReadonlyArray<FakeRow>;
  deleteReturning?: ReadonlyArray<FakeRow>;
  captured?: { values?: FakeRow };
}) {
  return {
    select: () => createSelectChain(opts.selectRows ?? []),
    insert: () => ({
      values: (v: FakeRow) => {
        if (opts.captured) opts.captured.values = v;
        return { returning: () => Promise.resolve(opts.insertReturning ?? []) };
      },
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve(opts.deleteReturning ?? []) }),
    }),
  };
}

function caller(user: { id: string } | null, db: unknown = {}) {
  return appRouter.createCaller({ db: db as never, headers: new Headers(), user });
}

beforeEach(() => {
  vi.mocked(assertCodeIslandOwnership).mockReset();
});

afterEach(() => {
  vi.mocked(assertCodeIslandOwnership).mockReset();
});

describe("codeIslandsRouter tenancy (Phase 76 / BTAP-09)", () => {
  it("byId is protected — sessionless is UNAUTHORIZED", async () => {
    await expect(caller(null).codeIslands.byId({ islandId: ISLAND_A })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("create/remove/list are protected too", async () => {
    await expect(
      caller(null).codeIslands.create({ intent: "x", code: "1;" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller(null).codeIslands.remove({ islandId: ISLAND_A }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).codeIslands.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("byId surfaces NOT_FOUND for a non-owner (ownership asserted before the read)", async () => {
    vi.mocked(assertCodeIslandOwnership).mockRejectedValueOnce(
      new OwnershipError("code_island", ISLAND_A),
    );
    await expect(
      caller(USER_A, makeDb({})).codeIslands.byId({ islandId: ISLAND_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertCodeIslandOwnership).toHaveBeenCalledWith(
      expect.anything(),
      ISLAND_A,
      USER_A.id,
    );
  });

  it("byId returns the owned row after the ownership assert passes", async () => {
    vi.mocked(assertCodeIslandOwnership).mockResolvedValueOnce(undefined);
    const row = {
      id: ISLAND_A,
      intent: "reconcile invoices",
      code: "const x=1;",
      inputBindings: { invoices: { sourceNodeKey: "s1", sourcePath: "published.s1" } },
    };
    const result = await caller(USER_A, makeDb({ selectRows: [row] })).codeIslands.byId({
      islandId: ISLAND_A,
    });
    expect(result).toMatchObject({ id: ISLAND_A, intent: "reconcile invoices", code: "const x=1;" });
  });

  it("create stamps ctx.user.id server-side (never a client field)", async () => {
    const captured: { values?: FakeRow } = {};
    const result = await caller(
      USER_A,
      makeDb({ insertReturning: [{ id: ISLAND_A }], captured }),
    ).codeIslands.create({
      intent: "reconcile these",
      code: "const x=1;",
      inputBindings: { bank: { sourceNodeKey: "s2", sourcePath: "published.s2" } },
    });
    expect(result).toEqual({ islandId: ISLAND_A, created: true });
    expect(captured.values?.userId).toBe(USER_A.id);
    expect(captured.values?.intent).toBe("reconcile these");
  });

  it("remove asserts ownership first, then reports removal (BTAP-10)", async () => {
    vi.mocked(assertCodeIslandOwnership).mockResolvedValueOnce(undefined);
    const result = await caller(
      USER_A,
      makeDb({ deleteReturning: [{ id: ISLAND_A }] }),
    ).codeIslands.remove({ islandId: ISLAND_A });
    expect(result).toEqual({ islandId: ISLAND_A, removed: true });
    expect(assertCodeIslandOwnership).toHaveBeenCalledWith(
      expect.anything(),
      ISLAND_A,
      USER_A.id,
    );
  });

  it("create rejects a prototype-pollution binding key (a genuine own key)", async () => {
    // `constructor` written in a literal IS an own enumerable key (unlike
    // `__proto__`, which sets the prototype), so this exercises the router's
    // FORBIDDEN_KEYS refine directly — a BAD_REQUEST from input validation,
    // before any db call.
    await expect(
      caller(USER_A, makeDb({ insertReturning: [{ id: ISLAND_A }] })).codeIslands.create({
        intent: "x",
        code: "1;",
        inputBindings: { constructor: { sourceNodeKey: "s", sourcePath: "p" } } as never,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
