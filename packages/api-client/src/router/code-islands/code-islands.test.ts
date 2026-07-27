/**
 * code-islands.test.ts — control-plane proofs for codeIslandsRouter.create.
 *
 * Focus: the provenance-UPSERT wiring added for the agent code-island path
 * (Phase 76-05 / round-3 G-LOW). The router had no test; these lock:
 *   1. create with NO provenance stamps the owner server-side, threads a NULL
 *      provenance, reaches insert, and returns the new id (back-compat with the
 *      user-summon "Build a tool" flow);
 *   2. create WITH provenance threads it into the insert values (so the
 *      onConflictDoUpdate on (user_id, provenance) makes an agent re-run
 *      idempotent — same row, not an orphan);
 *   3. an insert that returns no id surfaces INTERNAL_SERVER_ERROR (no silent
 *      null island id).
 *
 * ctx.db is a tiny thenable mirroring the drizzle chain the router uses
 * (insert().values().onConflictDoUpdate().returning()), recording the values.
 */
import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { codeIslandsRouter } from "./index";

const USER_A: SessionUser = { id: "user-a" };
const ISLAND_ID = "00000000-0000-0000-0000-0000000000f1";

function fakeDb(opts: { insertReturns?: unknown[] } = {}) {
  const captured: { values?: Record<string, unknown>; conflict?: unknown; insertReached: boolean } =
    { insertReached: false };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "set"]) {
    chain[m] = () => chain;
  }
  chain.values = (v: Record<string, unknown>) => {
    captured.values = v;
    return chain;
  };
  chain.onConflictDoUpdate = (o: unknown) => {
    captured.conflict = o;
    return chain;
  };
  chain.returning = () => Promise.resolve(opts.insertReturns ?? [{ id: ISLAND_ID }]);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve([]).then(res, rej);
  return {
    db: {
      select: () => chain,
      insert: () => {
        captured.insertReached = true;
        return chain;
      },
    } as never,
    captured,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ codeIslands: codeIslandsRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("codeIslandsRouter.create — provenance upsert", () => {
  it("with NO provenance: owner stamped, provenance NULL, insert reached, returns id", async () => {
    const { db, captured } = fakeDb();
    const res = await caller(db, USER_A).codeIslands.create({
      intent: "reconcile invoices",
      code: "root.textContent = 'x'",
    });

    expect(res).toEqual({ islandId: ISLAND_ID, created: true });
    expect(captured.insertReached).toBe(true);
    // Owner is server-stamped, never a client field; provenance defaults to NULL
    // (user-summon rows are distinct — NULL never conflicts in the unique index).
    expect(captured.values?.userId).toBe(USER_A.id);
    expect(captured.values?.provenance).toBeNull();
    // The upsert arbiter is still declared so a set-provenance call can dedupe.
    expect(captured.conflict).toBeDefined();
  });

  it("WITH provenance: threads it into the insert values (agent-path idempotency key)", async () => {
    const { db, captured } = fakeDb();
    await caller(db, USER_A).codeIslands.create({
      intent: "reconcile invoices",
      code: "root.textContent = 'x'",
      provenance: "msg-123:0",
    });
    expect(captured.values?.provenance).toBe("msg-123:0");
    expect(captured.values?.userId).toBe(USER_A.id);
  });

  it("an insert returning no id surfaces INTERNAL_SERVER_ERROR (no null island id)", async () => {
    const { db } = fakeDb({ insertReturns: [] });
    await expect(
      caller(db, USER_A).codeIslands.create({
        intent: "x",
        code: "root.textContent = 'x'",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("a sessionless call is UNAUTHORIZED (protectedProcedure)", async () => {
    const { db } = fakeDb();
    await expect(
      caller(db, null).codeIslands.create({ intent: "x", code: "y" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
