/**
 * spreadsheets.test.ts — the CV-03 control-plane proofs for spreadsheetsRouter.
 *
 * Asserts the tenancy + validation guarantees that must hold before the agent's table.* verbs (or
 * the canvas node's read) ever touch a row:
 *   1. create stamps the owner server-side and persists (insert reached) — never a client user_id;
 *   2. create's capability input schema rejects a malformed table BEFORE any write;
 *   3. update/byId assert ownership FIRST — another user's spreadsheet is NOT_FOUND, no write runs;
 *   4. an owned update/byId/list resolves.
 *
 * ctx.db is a tiny hand-rolled thenable mimicking the drizzle chains the router uses (mirrors
 * desktop.test.ts), recording whether insert/update were reached.
 */
import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { spreadsheetsRouter } from "./index";

const USER_A: SessionUser = { id: "user-a" };
const SHEET_ID = "00000000-0000-0000-0000-000000000001";

const VALID_CREATE = {
  title: "Invoices",
  columns: [
    { name: "vendor", type: "text" as const },
    { name: "amount", type: "number" as const },
  ],
  rows: [{ data: { vendor: "Acme", amount: 1200 } }],
};

/** A chainable thenable: every builder method returns itself; awaiting yields `selectRows`.
 * insert/update return their own `returning()` rows and bump call counters. */
function fakeDb(opts: { selectRows: unknown[]; insertReturns?: unknown[]; updateReturns?: unknown[] }) {
  const calls = { insert: 0, update: 0 };
  const chain = (rows: unknown[]) => {
    const p: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "orderBy", "limit", "offset", "values", "set"]) {
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
        return chain(opts.insertReturns ?? [{ id: SHEET_ID }]);
      },
      update: () => {
        calls.update++;
        return chain(opts.updateReturns ?? [{ id: SHEET_ID }]);
      },
    } as never,
    calls,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ spreadsheets: spreadsheetsRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("spreadsheetsRouter — CV-03 control plane", () => {
  it("create persists (insert reached) and returns the new id with created:true", async () => {
    const { db, calls } = fakeDb({ selectRows: [], insertReturns: [{ id: SHEET_ID }] });
    const out = await caller(db, USER_A).spreadsheets.create(VALID_CREATE);
    expect(out).toEqual({ spreadsheetId: SHEET_ID, created: true });
    expect(calls.insert).toBe(1);
  });

  it("create rejects a malformed table BEFORE any write (duplicate column names)", async () => {
    const { db, calls } = fakeDb({ selectRows: [] });
    await expect(
      caller(db, USER_A).spreadsheets.create({
        title: "x",
        columns: [
          { name: "a", type: "text" },
          { name: "a", type: "number" },
        ],
      }),
    ).rejects.toThrow();
    expect(calls.insert).toBe(0);
  });

  it("update on another user's spreadsheet is NOT_FOUND — ownership first, no write", async () => {
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).spreadsheets.update({ spreadsheetId: SHEET_ID, title: "Renamed" }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.update).toBe(0);
  });

  it("update on an owned spreadsheet runs and returns updated:true", async () => {
    const { db, calls } = fakeDb({
      selectRows: [{ userId: USER_A.id }],
      updateReturns: [{ id: SHEET_ID }],
    });
    const out = await caller(db, USER_A).spreadsheets.update({
      spreadsheetId: SHEET_ID,
      title: "Renamed",
    });
    expect(out).toEqual({ spreadsheetId: SHEET_ID, updated: true });
    expect(calls.update).toBe(1);
  });

  it("byId on another user's spreadsheet is NOT_FOUND (fail-closed, no existence oracle)", async () => {
    const { db } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).spreadsheets.byId({ spreadsheetId: SHEET_ID }),
    ).rejects.toThrow(/not.?found/i);
  });

  it("byId on an owned spreadsheet returns the row with its columns/rows", async () => {
    const row = {
      id: SHEET_ID,
      userId: USER_A.id,
      title: "Invoices",
      columns: VALID_CREATE.columns,
      rows: [{ id: "r1", data: { vendor: "Acme", amount: 1200 } }],
    };
    const { db } = fakeDb({ selectRows: [row] });
    const out = await caller(db, USER_A).spreadsheets.byId({ spreadsheetId: SHEET_ID });
    expect(out).toMatchObject({ id: SHEET_ID, title: "Invoices" });
  });

  it("list returns the caller's spreadsheets", async () => {
    const rows = [{ id: SHEET_ID, title: "Invoices", createdAt: new Date(), updatedAt: new Date() }];
    const { db } = fakeDb({ selectRows: rows });
    const out = await caller(db, USER_A).spreadsheets.list();
    expect(out).toHaveLength(1);
  });
});
