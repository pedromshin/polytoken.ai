/**
 * turn-cap.test.ts — the monthlyChatTurns enforcement gate (turn-cap.ts) and
 * its wiring into chat.recordBrowserTurn.
 *
 * Policy under test (see turn-cap.ts — the ONE place the decision lives):
 *   - FREE tier at/over cap → BLOCKED (typed FORBIDDEN, friendly message,
 *     detail logged server-side only, nothing persisted).
 *   - PRO/POWER → never hard-blocked; at/over a finite cap the turn proceeds
 *     with an additive `overLimit: true` response marker (power's cap is
 *     null = unlimited).
 *   - ANY db/lookup failure → FAIL-OPEN for everyone (logged, turn allowed).
 *
 * Caps are read from @polytoken/billing's ENTITLEMENTS (never redefined
 * here) — the tests reference those numbers so a legitimate future
 * entitlement change cannot silently invalidate the policy tests.
 *
 * Test plan:
 *   decideChatTurnCap (pure):
 *     1. free under cap allowed; at cap blocked; over cap blocked.
 *     2. pro under/at cap always allowed; at cap carries overLimit.
 *     3. power unlimited — huge usage still allowed, never overLimit.
 *   asKnownTier: 4. narrows unknown/absent to 'free'.
 *   enforceChatTurnCap (fake db):
 *     5. free at cap → FORBIDDEN + friendly message (server detail logged).
 *     6. free under cap → resolves overLimit:false.
 *     7. absent subscription row → treated as free (blocked at cap).
 *     8. pro at cap → resolves overLimit:true; power huge → overLimit:false.
 *     9. tier-lookup db error → fail-open; count db error → fail-open.
 *   recordBrowserTurn wiring (fake db + mocked ownership):
 *     10. free at cap → FORBIDDEN, the write transaction is NEVER entered.
 *     11. free under cap → persists, returns overLimit:false.
 *     12. pro at cap → persists, returns overLimit:true.
 *     13. cap-check outage → persists anyway (fail-open), overLimit:false.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    assertConversationOwnership: vi.fn(),
  };
});

import { ENTITLEMENTS } from "@polytoken/billing";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { appRouter } from "../../../root";
import {
  asKnownTier,
  CHAT_TURN_CAP_MESSAGE,
  decideChatTurnCap,
  enforceChatTurnCap,
} from "../turn-cap";

const FREE_CAP = ENTITLEMENTS.free.monthlyChatTurns as number;
const PRO_CAP = ENTITLEMENTS.pro.monthlyChatTurns as number;

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const CONVERSATION_ID = "60000000-0000-0000-0000-000000000001";
const RUN_ID = "70000000-0000-0000-0000-000000000001";

const TURN_INPUT = {
  conversationId: CONVERSATION_ID,
  modelId: "webllm-qwen3-4b",
  userText: "hi",
  assistantText: "hello",
  inputTokens: 1,
  outputTokens: 1,
} as const;

type FakeRow = Record<string, unknown>;

/** Thenable chain covering the builder subset the gate + mutation use. */
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
    orderBy() {
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

/** Queue-driven fake db for the gate's two selects (tier, then count). */
function createFakeGateDb(resultsQueue: Array<ReadonlyArray<FakeRow>>) {
  return {
    select() {
      const rows = resultsQueue.shift() ?? [];
      return createThenableChain(rows);
    },
  };
}

/** A db whose Nth select() throws (0-based); earlier selects use the queue. */
function createThrowingAtDb(
  throwAt: number,
  resultsQueue: Array<ReadonlyArray<FakeRow>>,
) {
  let call = 0;
  return {
    select() {
      const current = call;
      call += 1;
      if (current === throwAt) {
        throw new Error("db unavailable");
      }
      const rows = resultsQueue.shift() ?? [];
      return createThenableChain(rows);
    },
  };
}

/**
 * Full fake db for recordBrowserTurn: gate selects on the root handle, then
 * a transaction whose tx supports select/insert/update. Records whether the
 * write transaction was ever entered (Test 10's "nothing persisted" proof).
 */
function createFakeMutationDb(opts: {
  readonly selectResults: Array<ReadonlyArray<FakeRow>>;
  readonly txSelectResults: Array<ReadonlyArray<FakeRow>>;
  readonly failRootSelects?: boolean;
}) {
  let transactionEntered = false;

  const tx = {
    select() {
      const rows = opts.txSelectResults.shift() ?? [];
      return createThenableChain(rows);
    },
    insert() {
      return {
        values() {
          return {
            returning: () => Promise.resolve([{ id: RUN_ID }]),
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve(undefined).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where: () => Promise.resolve(),
          };
        },
      };
    },
  };

  const db = {
    select() {
      if (opts.failRootSelects) {
        throw new Error("db unavailable");
      }
      const rows = opts.selectResults.shift() ?? [];
      return createThenableChain(rows);
    },
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
      transactionEntered = true;
      return cb(tx);
    },
  };

  return { db, wasTransactionEntered: () => transactionEntered };
}

function makeCaller(user: { id: string } | null, db: unknown) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.mocked(assertConversationOwnership).mockReset();
});

// ---------------------------------------------------------------------------
// decideChatTurnCap — pure policy matrix
// ---------------------------------------------------------------------------

describe("decideChatTurnCap — pure policy", () => {
  it("Test 1: free — under cap allowed; at cap blocked; over cap blocked", () => {
    expect(decideChatTurnCap("free", FREE_CAP - 1)).toEqual({
      allowed: true,
      overLimit: false,
    });
    expect(decideChatTurnCap("free", FREE_CAP)).toEqual({
      allowed: false,
      overLimit: true,
    });
    expect(decideChatTurnCap("free", FREE_CAP + 50)).toEqual({
      allowed: false,
      overLimit: true,
    });
    expect(decideChatTurnCap("free", 0)).toEqual({
      allowed: true,
      overLimit: false,
    });
  });

  it("Test 2: pro — never blocked; at/over cap carries the overLimit marker", () => {
    expect(decideChatTurnCap("pro", PRO_CAP - 1)).toEqual({
      allowed: true,
      overLimit: false,
    });
    expect(decideChatTurnCap("pro", PRO_CAP)).toEqual({
      allowed: true,
      overLimit: true,
    });
    expect(decideChatTurnCap("pro", PRO_CAP * 10)).toEqual({
      allowed: true,
      overLimit: true,
    });
  });

  it("Test 3: power — unlimited (null cap): never blocked, never overLimit", () => {
    expect(ENTITLEMENTS.power.monthlyChatTurns).toBeNull();
    expect(decideChatTurnCap("power", 1_000_000)).toEqual({
      allowed: true,
      overLimit: false,
    });
  });
});

describe("asKnownTier", () => {
  it("Test 4: narrows unknown/absent tiers to 'free' (policy fail-closed default)", () => {
    expect(asKnownTier("pro")).toBe("pro");
    expect(asKnownTier("power")).toBe("power");
    expect(asKnownTier("free")).toBe("free");
    expect(asKnownTier("enterprise-gibberish")).toBe("free");
    expect(asKnownTier(null)).toBe("free");
    expect(asKnownTier(undefined)).toBe("free");
  });
});

// ---------------------------------------------------------------------------
// enforceChatTurnCap — gate behavior over a fake db
// ---------------------------------------------------------------------------

describe("enforceChatTurnCap — gate", () => {
  it("Test 5: free at cap → FORBIDDEN with the friendly message; detail logged server-side", async () => {
    const db = createFakeGateDb([[{ tier: "free" }], [{ value: FREE_CAP }]]);

    await expect(
      enforceChatTurnCap(db as never, USER_A.id),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: CHAT_TURN_CAP_MESSAGE,
    });

    // Server-side detail (user id, tier, used) is logged — the client only
    // ever sees the friendly message above.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(USER_A.id),
    );
  });

  it("Test 6: free under cap → resolves overLimit:false", async () => {
    const db = createFakeGateDb([[{ tier: "free" }], [{ value: FREE_CAP - 1 }]]);
    await expect(enforceChatTurnCap(db as never, USER_A.id)).resolves.toEqual({
      overLimit: false,
    });
  });

  it("Test 7: absent subscription row reads as free → blocked at the free cap", async () => {
    const db = createFakeGateDb([[], [{ value: FREE_CAP }]]);
    await expect(
      enforceChatTurnCap(db as never, USER_A.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Test 8: pro at cap → allowed with overLimit:true; power huge usage → overLimit:false", async () => {
    const proDb = createFakeGateDb([[{ tier: "pro" }], [{ value: PRO_CAP }]]);
    await expect(
      enforceChatTurnCap(proDb as never, USER_A.id),
    ).resolves.toEqual({ overLimit: true });

    const powerDb = createFakeGateDb([
      [{ tier: "power" }],
      [{ value: 1_000_000 }],
    ]);
    await expect(
      enforceChatTurnCap(powerDb as never, USER_A.id),
    ).resolves.toEqual({ overLimit: false });
  });

  it("Test 9: db failure fails OPEN — tier lookup error and count error both allow the turn (logged)", async () => {
    // Tier lookup (first select) throws.
    const tierFail = createThrowingAtDb(0, []);
    await expect(
      enforceChatTurnCap(tierFail as never, USER_A.id),
    ).resolves.toEqual({ overLimit: false });

    // Count (second select) throws — even for a user who WOULD be at cap.
    const countFail = createThrowingAtDb(1, [[{ tier: "free" }]]);
    await expect(
      enforceChatTurnCap(countFail as never, USER_A.id),
    ).resolves.toEqual({ overLimit: false });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[chat.turnCap] cap check failed — failing open:",
      expect.any(Error),
    );
  });
});

// ---------------------------------------------------------------------------
// recordBrowserTurn wiring — the gate actually guards the turn write
// ---------------------------------------------------------------------------

describe("chat.recordBrowserTurn — cap enforcement wiring", () => {
  beforeEach(() => {
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
  });

  it("Test 10: free at cap → FORBIDDEN and the write transaction is NEVER entered", async () => {
    const { db, wasTransactionEntered } = createFakeMutationDb({
      selectResults: [[{ tier: "free" }], [{ value: FREE_CAP }]],
      txSelectResults: [],
    });
    const caller = makeCaller(USER_A, db);

    await expect(caller.chat.recordBrowserTurn(TURN_INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: CHAT_TURN_CAP_MESSAGE,
    });
    expect(wasTransactionEntered()).toBe(false);
  });

  it("Test 11: free under cap → the turn persists and returns overLimit:false", async () => {
    const { db, wasTransactionEntered } = createFakeMutationDb({
      selectResults: [[{ tier: "free" }], [{ value: 0 }]],
      txSelectResults: [[]], // no prior turns → turnIndex 0
    });
    const caller = makeCaller(USER_A, db);

    await expect(caller.chat.recordBrowserTurn(TURN_INPUT)).resolves.toEqual({
      runId: RUN_ID,
      turnIndex: 0,
      overLimit: false,
    });
    expect(wasTransactionEntered()).toBe(true);
  });

  it("Test 12: pro at cap → the turn persists and carries the overLimit marker", async () => {
    const { db } = createFakeMutationDb({
      selectResults: [[{ tier: "pro" }], [{ value: PRO_CAP }]],
      txSelectResults: [[{ turnIndex: 4 }]], // prior turns → next index 5
    });
    const caller = makeCaller(USER_A, db);

    await expect(caller.chat.recordBrowserTurn(TURN_INPUT)).resolves.toEqual({
      runId: RUN_ID,
      turnIndex: 5,
      overLimit: true,
    });
  });

  it("Test 13: cap-check outage → the turn persists anyway (fail-open), overLimit:false", async () => {
    const { db, wasTransactionEntered } = createFakeMutationDb({
      selectResults: [],
      txSelectResults: [[]],
      failRootSelects: true,
    });
    const caller = makeCaller(USER_A, db);

    await expect(caller.chat.recordBrowserTurn(TURN_INPUT)).resolves.toEqual({
      runId: RUN_ID,
      turnIndex: 0,
      overLimit: false,
    });
    expect(wasTransactionEntered()).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[chat.turnCap] cap check failed — failing open:",
      expect.any(Error),
    );
  });
});
