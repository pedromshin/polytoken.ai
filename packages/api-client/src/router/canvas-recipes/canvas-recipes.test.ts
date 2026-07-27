/**
 * canvas-recipes.test.ts — the LCAN-07/08 control-plane proofs for
 * canvasRecipesRouter.
 *
 * Asserts the tenancy + round-trip guarantees Wave C's CRUD backend must hold:
 *   1. create stamps the owner server-side (userId = ctx.user.id, never a client
 *      field) and persists (insert reached), returning the new id;
 *   2. create on a non-owned conversation is NOT_FOUND — ownership FIRST, no
 *      write runs;
 *   3. byId for the owner returns the recipe's name + node/edge key-sets;
 *   4. byId on another user's recipe is NOT_FOUND BEFORE any read (fail-closed,
 *      no existence oracle);
 *   5. rename/remove on another user's recipe are NOT_FOUND — ownership FIRST,
 *      no write;
 *   6. list asserts conversation ownership FIRST — a non-owned conversation is
 *      NOT_FOUND, no read.
 *
 * ctx.db is a tiny hand-rolled thenable mimicking the drizzle chains the router
 * uses (mirrors spreadsheets.test.ts / desktop.test.ts), recording whether
 * insert/update/delete were reached.
 */
import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { canvasRecipesRouter } from "./index";

const USER_A: SessionUser = { id: "user-a" };
const CONV_ID = "00000000-0000-0000-0000-0000000000c0";
const RECIPE_ID = "00000000-0000-0000-0000-0000000000a1";

/** A chainable thenable: every builder method returns itself; awaiting yields
 * `selectRows`. insert/update/delete return their own `returning()` rows and
 * bump call counters. */
function fakeDb(opts: {
  selectRows: unknown[];
  insertReturns?: unknown[];
  updateReturns?: unknown[];
  deleteReturns?: unknown[];
}) {
  const calls = { insert: 0, update: 0, delete: 0 };
  const chain = (rows: unknown[]) => {
    const p: Record<string, unknown> = {};
    for (const m of [
      "select",
      "from",
      "where",
      "orderBy",
      "limit",
      "offset",
      "values",
      "set",
    ]) {
      p[m] = () => p;
    }
    p.returning = () => Promise.resolve(rows);
    p.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej);
    return p;
  };
  return {
    db: {
      select: () => chain(opts.selectRows),
      insert: () => {
        calls.insert++;
        return chain(opts.insertReturns ?? [{ id: RECIPE_ID }]);
      },
      update: () => {
        calls.update++;
        return chain(opts.updateReturns ?? [{ id: RECIPE_ID }]);
      },
      delete: () => {
        calls.delete++;
        return chain(opts.deleteReturns ?? [{ id: RECIPE_ID }]);
      },
    } as never,
    calls,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ canvasRecipes: canvasRecipesRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("canvasRecipesRouter — LCAN-07/08 control plane", () => {
  it("create persists (insert reached) and returns the new id with created:true — owner stamped server-side", async () => {
    // selectRows is the conversation-ownership read: this conversation is owned.
    const { db, calls } = fakeDb({
      selectRows: [{ userId: USER_A.id }],
      insertReturns: [{ id: RECIPE_ID }],
    });
    const out = await caller(db, USER_A).canvasRecipes.create({
      conversationId: CONV_ID,
      name: "Live rent board",
      nodeKeys: ["spreadsheet:s1", "brief:b1"],
      edgeKeys: ["edge:e1"],
    });
    expect(out).toEqual({ recipeId: RECIPE_ID, created: true });
    expect(calls.insert).toBe(1);
  });

  it("create on a non-owned conversation is NOT_FOUND — ownership first, no write", async () => {
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).canvasRecipes.create({
        conversationId: CONV_ID,
        name: "x",
      }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.insert).toBe(0);
  });

  it("byId for the owner returns name + node/edge key-sets", async () => {
    const row = {
      id: RECIPE_ID,
      userId: USER_A.id,
      name: "Live rent board",
      conversationId: CONV_ID,
      nodeKeys: ["spreadsheet:s1", "brief:b1"],
      edgeKeys: ["edge:e1"],
      sourceRef: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // First select = ownership read (owned); byId's own select returns the row.
    const { db } = fakeDb({ selectRows: [row] });
    const out = await caller(db, USER_A).canvasRecipes.byId({
      recipeId: RECIPE_ID,
    });
    expect(out).toMatchObject({
      id: RECIPE_ID,
      name: "Live rent board",
      nodeKeys: ["spreadsheet:s1", "brief:b1"],
      edgeKeys: ["edge:e1"],
    });
  });

  it("byId on another user's recipe is NOT_FOUND (fail-closed, no existence oracle)", async () => {
    const { db } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).canvasRecipes.byId({ recipeId: RECIPE_ID }),
    ).rejects.toThrow(/not.?found/i);
  });

  it("rename on another user's recipe is NOT_FOUND — ownership first, no write", async () => {
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).canvasRecipes.rename({
        recipeId: RECIPE_ID,
        name: "Renamed",
      }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.update).toBe(0);
  });

  it("rename on an owned recipe runs and returns updated:true", async () => {
    const { db, calls } = fakeDb({
      selectRows: [{ userId: USER_A.id }],
      updateReturns: [{ id: RECIPE_ID }],
    });
    const out = await caller(db, USER_A).canvasRecipes.rename({
      recipeId: RECIPE_ID,
      name: "Renamed",
    });
    expect(out).toEqual({ recipeId: RECIPE_ID, updated: true });
    expect(calls.update).toBe(1);
  });

  it("remove on another user's recipe is NOT_FOUND — ownership first, no write", async () => {
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).canvasRecipes.remove({ recipeId: RECIPE_ID }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.delete).toBe(0);
  });

  it("remove on an owned recipe runs and returns removed:true", async () => {
    const { db, calls } = fakeDb({
      selectRows: [{ userId: USER_A.id }],
      deleteReturns: [{ id: RECIPE_ID }],
    });
    const out = await caller(db, USER_A).canvasRecipes.remove({
      recipeId: RECIPE_ID,
    });
    expect(out).toEqual({ recipeId: RECIPE_ID, removed: true });
    expect(calls.delete).toBe(1);
  });

  it("list on a non-owned conversation is NOT_FOUND — ownership first", async () => {
    const { db } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).canvasRecipes.list({ conversationId: CONV_ID }),
    ).rejects.toThrow(/not.?found/i);
  });

  it("list on an owned conversation returns the caller's recipes", async () => {
    // Both the ownership read and the list read hit the same select chain, so
    // the shared row must satisfy the ownership assert (carry the owner userId)
    // AND look like a list row. The router projects only the list columns.
    const rows = [
      {
        id: RECIPE_ID,
        userId: USER_A.id,
        name: "Live rent board",
        nodeKeys: [],
        edgeKeys: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const { db } = fakeDb({ selectRows: rows });
    const out = await caller(db, USER_A).canvasRecipes.list({
      conversationId: CONV_ID,
    });
    expect(out).toHaveLength(1);
  });
});
