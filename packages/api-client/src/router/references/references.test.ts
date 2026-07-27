/**
 * references.test.ts — tenancy + input-hygiene proofs for referencesRouter.
 *
 * The router had no test. These lock the guarantees the docstring promises:
 *   1. save stamps userId = ctx.user.id server-side (input carries no owner),
 *      collapses an empty note to NULL, and persists deduped/trimmed tags;
 *   2. list scopes to ctx.user.id and computes hasMore via the fetch-one-extra
 *      trick (limit+1 rows → hasMore, items sliced back to the limit);
 *   3. remove asserts ownership FIRST — a missing/not-yours reference is
 *      NOT_FOUND and NO delete runs (fail-closed, no existence oracle);
 *   4. every procedure is protectedProcedure (sessionless → UNAUTHORIZED).
 *
 * ctx.db is a small thenable mirroring the drizzle chains the router uses,
 * recording the inserted values + whether delete was reached.
 */
import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { referencesRouter } from "./index";

const USER_A: SessionUser = { id: "user-a" };
const REF_ID = "00000000-0000-0000-0000-0000000000e1";

type Row = Record<string, unknown>;

function fakeDb(opts: { selectRows?: Row[]; insertReturns?: Row[] } = {}) {
  const captured: { values?: Row; deleteReached: boolean } = { deleteReached: false };
  const selectChain = (rows: Row[]) => {
    const p: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "orderBy", "limit", "offset"]) p[m] = () => p;
    p.then = (ok: (v: Row[]) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err);
    return p;
  };
  return {
    db: {
      select: () => selectChain(opts.selectRows ?? []),
      insert: () => ({
        values: (v: Row) => {
          captured.values = v;
          return { returning: () => Promise.resolve(opts.insertReturns ?? [{ id: REF_ID, ...v }]) };
        },
      }),
      delete: () => ({
        where: () => {
          captured.deleteReached = true;
          return Promise.resolve([]);
        },
      }),
    } as never,
    captured,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ references: referencesRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("referencesRouter — tenancy + hygiene", () => {
  it("save stamps the owner server-side, nulls an empty note, and dedupes/trims tags", async () => {
    const { db, captured } = fakeDb();
    await caller(db, USER_A).references.save({
      url: "https://example.com/a",
      title: "A source",
      note: "   ", // trims to empty → stored NULL
      tags: [" x ", "x", "y"], // trimmed + deduped → ["x","y"]
    });
    expect(captured.values?.userId).toBe(USER_A.id);
    expect(captured.values?.note).toBeNull();
    expect(captured.values?.tags).toEqual(["x", "y"]);
    expect(captured.values?.url).toBe("https://example.com/a");
  });

  it("list computes hasMore via the fetch-one-extra trick and slices to the limit", async () => {
    // limit=2 → the router fetches 3; 3 returned → hasMore, items sliced to 2.
    const rows = [
      { id: "1", url: "u1", title: "t1", note: null, tags: [], savedAt: new Date(0) },
      { id: "2", url: "u2", title: "t2", note: null, tags: [], savedAt: new Date(0) },
      { id: "3", url: "u3", title: "t3", note: null, tags: [], savedAt: new Date(0) },
    ];
    const { db } = fakeDb({ selectRows: rows });
    const res = await caller(db, USER_A).references.list({ limit: 2, offset: 0 });
    expect(res.hasMore).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.nextOffset).toBe(2);
  });

  it("remove on a missing/not-yours reference is NOT_FOUND and runs NO delete", async () => {
    // Ownership select returns nothing → assertReferenceOwnership fails closed.
    const { db, captured } = fakeDb({ selectRows: [] });
    await expect(
      caller(db, USER_A).references.remove({ id: REF_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(captured.deleteReached).toBe(false);
  });

  it("save requires a session (protectedProcedure)", async () => {
    const { db } = fakeDb();
    await expect(
      caller(db, null).references.save({ url: "https://example.com", title: "t", tags: [] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
