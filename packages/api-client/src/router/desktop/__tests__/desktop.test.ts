/**
 * desktop.test.ts — the safety-critical proofs for the E5 Cloud Desktop router (CD-1).
 *
 * The provider is the REAL fails-closed default (provider.ts returns failClosedDesktopProvider), so
 * these assert the control-plane guarantees that must hold BEFORE any machine is ever spawned:
 *   1. spawn fails closed with a clean error AND writes NO row (no orphan billed VM record);
 *   2. the concurrent-desktop cap refuses BEFORE touching the provider;
 *   3. attach/destroy assert ownership FIRST — another user's session is NOT_FOUND, provider untouched.
 *
 * ctx.db is a tiny hand-rolled thenable that mimics the drizzle chains the router uses; each test
 * pins the one select result its path reads, and RECORDS whether insert/update were reached.
 */
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "../../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../../trpc";
import { desktopRouter } from "../index";

const USER_A: SessionUser = { id: "user-a" };

/** A chainable thenable: every builder method returns itself; awaiting yields `selectRows`. */
function fakeDb(opts: { selectRows: unknown[]; onInsert?: () => void; onUpdate?: () => void }) {
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
        opts.onInsert?.();
        return chain([{ id: "row-1", userId: USER_A.id, status: "provisioning" }]);
      },
      update: () => {
        calls.update++;
        opts.onUpdate?.();
        return chain([{ id: "row-1", userId: USER_A.id, status: "hibernated" }]);
      },
    } as never,
    calls,
  };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ desktop: desktopRouter }))({ db, user, headers: new Headers() });

describe("desktopRouter — fails-closed control plane (CD-1)", () => {
  it("spawn fails closed with a clean error and writes NO row", async () => {
    // 0 live desktops (cap passes), so the ONLY thing that stops it is the fails-closed provider.
    const { db, calls } = fakeDb({ selectRows: [] });
    await expect(
      caller(db, USER_A).desktop.spawn({ region: "eu-central-1", shape: "m7i.2xlarge" }),
    ).rejects.toThrow(/not enabled/i);
    expect(calls.insert).toBe(0); // no orphan desktop_sessions row for a VM that never spawned
  });

  it("the concurrent-desktop cap refuses BEFORE the provider (no spend past the cap)", async () => {
    // One live desktop already → cap (default 1) is hit; must refuse before provisioning.
    const { db, calls } = fakeDb({ selectRows: [{ id: "existing" }] });
    await expect(
      caller(db, USER_A).desktop.spawn({ region: "eu-central-1", shape: "m7i.2xlarge" }),
    ).rejects.toThrow(/limit 1/i);
    expect(calls.insert).toBe(0);
  });

  it("attach on another user's session is NOT_FOUND — ownership asserted first, provider untouched", async () => {
    // The ownership select returns a row owned by SOMEONE ELSE → assert throws → NOT_FOUND.
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).desktop.attach({ id: "00000000-0000-0000-0000-000000000001" }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.update).toBe(0);
  });

  it("destroy on another user's session is NOT_FOUND — the irreversible verb is gated by ownership", async () => {
    const { db, calls } = fakeDb({ selectRows: [{ userId: "someone-else" }] });
    await expect(
      caller(db, USER_A).desktop.destroy({ id: "00000000-0000-0000-0000-000000000002" }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.update).toBe(0);
  });

  it("rejects an unauthenticated caller (protectedProcedure, INV-8)", async () => {
    const { db } = fakeDb({ selectRows: [] });
    await expect(
      caller(db, null).desktop.list(),
    ).rejects.toThrow(/unauthorized/i);
  });
});

// Keep vi imported-and-used even if a future stub needs it (silences no-unused under strict lint).
void vi;
