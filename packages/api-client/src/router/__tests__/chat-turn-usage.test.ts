/**
 * chat-turn-usage.test.ts — the SHARED monthly chat-turn counting helper
 * (_chat-turn-usage.ts) + its meter/enforcement parity guarantee.
 *
 * Follows billing-usage.test.ts's established convention: `drizzle-orm`'s
 * `eq`/`gte` are wrapped to RECORD their (column, value) pairs while
 * delegating to the real implementation, and a thenable fake chain stands in
 * for the query engine — the tests prove query CONSTRUCTION (which columns,
 * which values, which window), the level at which meter/enforcement drift
 * would appear.
 *
 * Test plan:
 *   1. PARITY (the drift-proof): billing.usage's monthly count and the shared
 *      helper run against the SAME fixture produce IDENTICAL counts AND
 *      byte-identical filter conditions (same column objects by reference,
 *      same values, same month-start instant). billingRouter.usage calls this
 *      exact helper, so this pins the equivalence forever.
 *   2. Exact counting semantics: role='user' (assistant/system rows never
 *      count), is_active=true (inactive/regenerated siblings never count),
 *      owner join on chat_conversations.user_id = caller, created_at >= UTC
 *      month start — and NOTHING else.
 *   3. Month-boundary reset: the gte window value is 00:00:00.000 UTC on the
 *      1st of the current month, for end-of-month, exact-boundary, and
 *      start-of-month instants (a July turn is outside an August window).
 *   4. Result threading: seeded count value → number; empty → 0; string
 *      count (pg bigint) → coerced number.
 *   5. Failure policy: the helper THROWS on db failure — callers own
 *      degradation (billing.usage → 0; the enforcement gate → fail-open).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eqCalls: Array<[unknown, unknown]> = [];
const gteCalls: Array<[unknown, unknown]> = [];

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      eqCalls.push([col, val]);
      return (actual.eq as (a: unknown, b: unknown) => unknown)(col, val);
    },
    gte: (col: unknown, val: unknown) => {
      gteCalls.push([col, val]);
      return (actual.gte as (a: unknown, b: unknown) => unknown)(col, val);
    },
  };
});

import { ChatConversations, ChatMessages } from "@polytoken/db/schema";

import { appRouter } from "../../root";
import {
  countMonthlyChatTurnsUsed,
  startOfCurrentUtcMonth,
} from "../_chat-turn-usage";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const FROZEN_NOW = new Date("2026-08-15T12:34:56.000Z");

type FakeRow = Record<string, unknown>;

/** Thenable chain covering the builder subset both call paths use. */
function createThenableChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    groupBy() {
      return chain;
    },
    limit() {
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

/** Queue-driven fake db: each select() consumes the next seeded result. */
function createFakeDb(resultsQueue: Array<ReadonlyArray<FakeRow>>) {
  return {
    select() {
      const rows = resultsQueue.shift() ?? [];
      return createThenableChain(rows);
    },
  };
}

function createThrowingDb() {
  return {
    select() {
      throw new Error("relation does not exist");
    },
  };
}

function makeCaller(user: { id: string } | null, db: unknown) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

// The columns the chat-turn count may touch — used to isolate its recorded
// conditions from billing.usage's other (emails) query.
const CHAT_COLUMNS: ReadonlySet<unknown> = new Set<unknown>([
  ChatMessages.conversationId,
  ChatConversations.id,
  ChatConversations.userId,
  ChatMessages.role,
  ChatMessages.isActive,
  ChatMessages.createdAt,
]);

function chatCalls(
  calls: ReadonlyArray<[unknown, unknown]>,
): Array<[unknown, unknown]> {
  return calls.filter(([col]) => CHAT_COLUMNS.has(col));
}

/** Byte-equal condition comparison: same column REFERENCES, same values
 * (Date compared by instant), in the same order. */
function expectIdenticalConditions(
  a: ReadonlyArray<[unknown, unknown]>,
  b: ReadonlyArray<[unknown, unknown]>,
): void {
  expect(a.length).toBe(b.length);
  a.forEach(([colA, valA], i) => {
    const [colB, valB] = b[i]!;
    expect(colA).toBe(colB);
    if (valA instanceof Date || valB instanceof Date) {
      expect((valA as Date).getTime()).toBe((valB as Date).getTime());
    } else {
      expect(valA).toBe(valB);
    }
  });
}

beforeEach(() => {
  eqCalls.length = 0;
  gteCalls.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("meter/enforcement parity (the drift-proof)", () => {
  it("Test 1: billing.usage and the shared helper produce identical counts AND identical conditions for the same fixture", async () => {
    const CHAT_COUNT_FIXTURE: ReadonlyArray<FakeRow> = [{ value: 3 }];

    // Path A — the METER: billing.usage (emails query first, chat count second).
    const meterCaller = makeCaller(
      USER_A,
      createFakeDb([[{ importerId: "imp-1", value: 4 }], [...CHAT_COUNT_FIXTURE]]),
    );
    const meterResult = await meterCaller.billing.usage();
    const meterEq = chatCalls(eqCalls);
    const meterGte = chatCalls(gteCalls);

    // Path B — the ENFORCEMENT count: the shared helper, same fixture.
    eqCalls.length = 0;
    gteCalls.length = 0;
    const enforcementCount = await countMonthlyChatTurnsUsed(
      createFakeDb([[...CHAT_COUNT_FIXTURE]]) as never,
      USER_A.id,
    );
    const enforcementEq = chatCalls(eqCalls);
    const enforcementGte = chatCalls(gteCalls);

    // Identical counts…
    expect(meterResult.monthlyChatTurnsUsed).toBe(3);
    expect(enforcementCount).toBe(3);
    expect(meterResult.monthlyChatTurnsUsed).toBe(enforcementCount);

    // …and byte-identical query conditions (columns by reference, values,
    // and the same UTC month-start instant).
    expectIdenticalConditions(meterEq, enforcementEq);
    expectIdenticalConditions(meterGte, enforcementGte);
    expect(meterGte.length).toBe(1);
  });
});

describe("countMonthlyChatTurnsUsed — exact counting semantics", () => {
  it("Test 2: filters to role='user' AND is_active=true AND owner join AND UTC month window — nothing else", async () => {
    await countMonthlyChatTurnsUsed(
      createFakeDb([[{ value: 1 }]]) as never,
      USER_A.id,
    );

    // Assistant/system rows can never count: the role filter is pinned to 'user'.
    expect(eqCalls).toContainEqual([ChatMessages.role, "user"]);
    // Inactive (regenerated/edited-away) siblings can never count.
    expect(eqCalls).toContainEqual([ChatMessages.isActive, true]);
    // Strict caller scoping via the conversation owner join.
    expect(eqCalls).toContainEqual([ChatConversations.userId, USER_A.id]);
    expect(eqCalls).toContainEqual([
      ChatMessages.conversationId,
      ChatConversations.id,
    ]);
    // Exactly these four eq conditions — no extra, no missing.
    expect(eqCalls.length).toBe(4);

    // The ONLY range condition is created_at >= UTC month start.
    expect(gteCalls.length).toBe(1);
    const [gteCol, gteVal] = gteCalls[0]!;
    expect(gteCol).toBe(ChatMessages.createdAt);
    expect((gteVal as Date).getTime()).toBe(Date.UTC(2026, 7, 1));
  });

  it("Test 3: month-boundary reset — the window opens at 00:00:00.000 UTC on the 1st", async () => {
    // Pure boundary math.
    expect(
      startOfCurrentUtcMonth(new Date("2026-08-31T23:59:59.999Z")).toISOString(),
    ).toBe("2026-08-01T00:00:00.000Z");
    expect(
      startOfCurrentUtcMonth(new Date("2026-09-01T00:00:00.000Z")).toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");

    // At the very first instant of September, the window excludes ALL of
    // August — a user at their August cap is reset.
    gteCalls.length = 0;
    await countMonthlyChatTurnsUsed(
      createFakeDb([[{ value: 0 }]]) as never,
      USER_A.id,
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect((gteCalls[0]![1] as Date).getTime()).toBe(Date.UTC(2026, 8, 1));
  });

  it("Test 4: threads the seeded count through; empty reads 0; string counts coerce", async () => {
    await expect(
      countMonthlyChatTurnsUsed(createFakeDb([[{ value: 42 }]]) as never, USER_A.id),
    ).resolves.toBe(42);
    await expect(
      countMonthlyChatTurnsUsed(createFakeDb([[]]) as never, USER_A.id),
    ).resolves.toBe(0);
    // pg bigint counts arrive as strings through some drivers.
    await expect(
      countMonthlyChatTurnsUsed(createFakeDb([[{ value: "7" }]]) as never, USER_A.id),
    ).resolves.toBe(7);
  });

  it("Test 5: THROWS on db failure — callers own the degradation policy", async () => {
    await expect(
      countMonthlyChatTurnsUsed(createThrowingDb() as never, USER_A.id),
    ).rejects.toThrow("relation does not exist");

    // …and billing.usage's own policy (degrade to 0) still holds through the
    // shared helper.
    const caller = makeCaller(USER_A, createThrowingDb());
    await expect(caller.billing.usage()).resolves.toEqual({
      dailyIngestUsed: 0,
      monthlyChatTurnsUsed: 0,
    });
  });
});
