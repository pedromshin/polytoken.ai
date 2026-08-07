/**
 * billing-usage.test.ts — the `billing.usage` procedure (Stream #3).
 *
 * `usage` reports the caller's LIVE consumption against the two metered
 * entitlement caps so /billing can render "X / Y used". These tests prove the
 * WIRING at the router boundary, not a real query engine:
 *
 *   1. protectedProcedure — a sessionless call is UNAUTHORIZED.
 *   2. STRICT caller scoping — every count filters on ctx.user.id (never a
 *      client field). Proven by recording the values threaded into drizzle's
 *      `eq(...)`: the caller's id must be the scope value for BOTH the
 *      emails→importers.user_id join and the chat_messages→conversations.user_id
 *      join. A regression that dropped the user filter would not pass the id.
 *   3. The count rows are threaded through to the returned shape.
 *   4. Graceful — a throwing db (e.g. a table absent before its migration)
 *      degrades each counter to 0 rather than 500ing.
 *
 * `drizzle-orm` is mocked at the boundary so `eq` records its (column, value)
 * pairs while delegating to the real implementation — the store-drizzle billing
 * code (not exercised by `usage`) keeps its real behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eqCalls: Array<[unknown, unknown]> = [];

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      eqCalls.push([col, val]);
      return (actual.eq as (a: unknown, b: unknown) => unknown)(col, val);
    },
  };
});

import {
  createFakeDb,
  createThrowingDb,
  makeCaller,
} from "../../__tests__/support/fake-drizzle";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };

// The thenable chain / fake dbs / makeCaller live in
// ../../__tests__/support/fake-drizzle.ts (shared, W7-2). `usage` runs two
// SELECTs in order (emails-today, then chat-turns-this-month) — the
// queue-driven fake db hands each successive select() its own seeded rows.

beforeEach(() => {
  eqCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("billing.usage — session requirement", () => {
  it("rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null, createFakeDb([]));
    await expect(caller.billing.usage()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("billing.usage — caller scoping + result threading", () => {
  it("scopes BOTH counts to ctx.user.id and threads the counts through", async () => {
    const caller = makeCaller(USER_A, createFakeDb([[{ value: 7 }], [{ value: 3 }]]));

    const result = await caller.billing.usage();

    expect(result).toEqual({ dailyIngestUsed: 7, monthlyChatTurnsUsed: 3 });

    // Strict scoping: the caller's id is the scope value on the user-owned
    // tenant columns for BOTH queries. Exactly two eq() calls carry the user
    // id (importers.user_id and chat_conversations.user_id) — the chat
    // role="user" filter is a different value and must not be conflated.
    const scopedByUser = eqCalls.filter(([, val]) => val === USER_A.id);
    expect(scopedByUser.length).toBe(2);

    // And no eq() ever scoped to a foreign user id.
    const foreign = eqCalls.filter(
      ([, val]) => typeof val === "string" && /^1{1}/.test(val as string) && val !== USER_A.id,
    );
    expect(foreign.length).toBe(0);
  });

  it("reports the BUSIEST importer, not the cross-importer sum (per-importer cap)", async () => {
    // The daily-ingest cap is per-importer, so with two importers the meter must
    // show the larger of the two per-importer counts (5), not their sum (8) —
    // otherwise a multi-importer user reads >100% against a single-importer cap.
    const caller = makeCaller(
      USER_A,
      createFakeDb([
        [
          { importerId: "imp-1", value: 3 },
          { importerId: "imp-2", value: 5 },
        ],
        [{ value: 2 }],
      ]),
    );
    const result = await caller.billing.usage();
    expect(result).toEqual({ dailyIngestUsed: 5, monthlyChatTurnsUsed: 2 });
  });

  it("reads 0 for a caller with no rows (empty count result)", async () => {
    const caller = makeCaller(USER_A, createFakeDb([[], []]));
    const result = await caller.billing.usage();
    expect(result).toEqual({ dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 });
  });
});

describe("billing.usage — graceful degradation", () => {
  it("degrades each counter to 0 when the db throws (missing table / unapplied migration)", async () => {
    const caller = makeCaller(USER_A, createThrowingDb());
    const result = await caller.billing.usage();
    expect(result).toEqual({ dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 });
  });
});
