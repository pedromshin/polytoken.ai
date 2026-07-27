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
 * resolves to `insertReturns` and bumps the insert counter. `values()` records
 * its argument so a test can assert what `spec` was persisted. */
function fakeDb(opts: { insertReturns?: unknown[] }) {
  const calls = { insert: 0 };
  const captured: { values?: Record<string, unknown> } = {};
  const chain = (rows: unknown[]) => {
    const p: Record<string, unknown> = {};
    for (const m of ["values", "where", "returning"]) p[m] = () => p;
    p.values = (v: Record<string, unknown>) => {
      captured.values = v;
      return p;
    };
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
    captured,
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

  it("blank path stays byte-identical: spec is exactly { id, title, generatedAt, blocks: [] }", async () => {
    const { db, captured } = fakeDb({ insertReturns: [{ id: DOC_ID }] });
    await caller(db, USER_A).documents.create({});
    const spec = captured.values?.spec as Record<string, unknown>;
    // No subtitle/source keys leaked in, and key order is unchanged.
    expect(Object.keys(spec)).toEqual(["id", "title", "generatedAt", "blocks"]);
    expect(spec.blocks).toEqual([]);
    expect(spec.id).toBe(captured.values?.id);
    // stamped server-side from ctx.user.id, never a client field (INV-8/9).
    expect(captured.values?.userId).toBe(USER_A.id);
  });

  it("create persists REAL initial blocks (DOCS-01 save-as-document path)", async () => {
    const { db, calls, captured } = fakeDb({ insertReturns: [{ id: DOC_ID }] });
    const blocks = [
      { kind: "heading", level: 1, text: "Report" },
      { kind: "paragraph", runs: ["Body ", { text: "figure", tier: "confirmed" }] },
      { kind: "list", ordered: false, items: [["a"], ["b"]] },
      { kind: "evidence", runs: ["quote"], cite: "src" },
    ];
    const out = await caller(db, USER_A).documents.create({
      title: "Report",
      subtitle: "sub",
      source: "Research run",
      // Literal widens tier/level to string/number; the runtime shape is a valid
      // ReportBlock[] (asserted below), so cast past the inferred-literal gap.
      blocks: blocks as never,
    });
    expect(out).toEqual({ documentId: DOC_ID, created: true });
    expect(calls.insert).toBe(1);
    const spec = captured.values?.spec as Record<string, unknown>;
    expect(spec.blocks).toEqual(blocks);
    expect(spec.subtitle).toBe("sub");
    expect(spec.source).toBe("Research run");
    expect(captured.values?.title).toBe("Report");
  });

  it("create rejects a malformed block BEFORE any write", async () => {
    const { db, calls } = fakeDb({});
    await expect(
      caller(db, USER_A).documents.create({
        // heading level 4 is outside the model's 1–3 range.
        blocks: [{ kind: "heading", level: 4, text: "x" }] as never,
      }),
    ).rejects.toThrow();
    expect(calls.insert).toBe(0);
  });
});
