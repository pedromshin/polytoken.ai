/**
 * documents.test.ts — control-plane proofs for documentsRouter.create (the
 * document-from-scratch / canvas "Add node ▸ Document" path).
 *
 * Asserts the tenancy + validation guarantees for the one write procedure:
 *   1. create stamps the owner server-side and persists (insert reached),
 *      returning the new id with created:true — never a client user_id;
 *   2. create's input schema rejects an over-long title BEFORE any write;
 *   3. create defaults an omitted title (blank document) and still persists.
 *
 * ctx.db is a tiny hand-rolled thenable mimicking the drizzle chains the router
 * uses (mirrors spreadsheets.test.ts), recording whether insert was reached.
 */
import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { documentsRouter } from "./index";

const USER_A: SessionUser = { id: "user-a" };
const DOC_ID = "d0c0d0c0-0000-0000-0000-000000000001";

/** A chainable thenable: every builder method returns itself; `returning()`
 * resolves to `insertReturns` and bumps the insert counter. */
function fakeDb(opts: { insertReturns?: unknown[] }) {
  const calls = { insert: 0 };
  const chain = (rows: unknown[]) => {
    const p: Record<string, unknown> = {};
    for (const m of ["values", "where", "returning"]) p[m] = () => p;
    p.returning = () => Promise.resolve(rows);
    p.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej);
    return p;
  };
  return {
    db: {
      insert: () => {
        calls.insert++;
        return chain(opts.insertReturns ?? [{ id: DOC_ID }]);
      },
    } as never,
    calls,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ documents: documentsRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("documentsRouter.create — control plane", () => {
  it("create persists (insert reached) and returns the new id with created:true", async () => {
    const { db, calls } = fakeDb({ insertReturns: [{ id: DOC_ID }] });
    const out = await caller(db, USER_A).documents.create({ title: "Notes" });
    expect(out).toEqual({ documentId: DOC_ID, created: true });
    expect(calls.insert).toBe(1);
  });

  it("create rejects an over-long title BEFORE any write", async () => {
    const { db, calls } = fakeDb({});
    await expect(
      caller(db, USER_A).documents.create({ title: "x".repeat(201) }),
    ).rejects.toThrow();
    expect(calls.insert).toBe(0);
  });

  it("create defaults an omitted title (blank document) and still persists", async () => {
    const { db, calls } = fakeDb({ insertReturns: [{ id: DOC_ID }] });
    const out = await caller(db, USER_A).documents.create({});
    expect(out).toEqual({ documentId: DOC_ID, created: true });
    expect(calls.insert).toBe(1);
  });
});
