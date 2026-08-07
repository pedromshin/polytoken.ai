/**
 * fake-drizzle.ts — shared fake-Drizzle test doubles (vLAUNCH W7-2
 * test-double consolidation).
 *
 * The thenable builder chain, queue-driven fake db, throwing db, and
 * createCaller helper previously copy-pasted across turn-cap.test.ts,
 * conversations.test.ts, chat-turn-usage.test.ts, learning-summary.test.ts,
 * and billing-usage.test.ts now live here once. The chain carries the UNION
 * of the builder subsets those suites exercised (from/innerJoin/where/
 * orderBy/groupBy/limit) and accepts either a fixed rows array or a
 * resolveRows callback (learning-summary's tenant-keyed db resolves rows at
 * await time). Suites keep only their scenario-specific doubles.
 *
 * Not collected by vitest (include: src/**\/*.test.ts).
 */

import { appRouter } from "../../../root";

export type FakeRow = Record<string, unknown>;

export interface FakeThenableChain {
  from(): FakeThenableChain;
  innerJoin(): FakeThenableChain;
  where(): FakeThenableChain;
  orderBy(): FakeThenableChain;
  groupBy(): FakeThenableChain;
  limit(): FakeThenableChain;
  then(
    onFulfilled: (value: ReadonlyArray<FakeRow>) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Thenable chain mimicking the builder subset the suites' queries use. Every
 * chain method returns the same object; the terminal `.then()` resolves to
 * the given rows (or to whatever `resolveRows` returns at await time).
 */
export function createThenableChain(
  rows: ReadonlyArray<FakeRow> | (() => ReadonlyArray<FakeRow>),
): FakeThenableChain {
  const resolveRows = typeof rows === "function" ? rows : () => rows;
  const chain: FakeThenableChain = {
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
      return Promise.resolve(resolveRows()).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

/** Queue-driven fake db: each select() consumes the next seeded result. */
export function createFakeDb(resultsQueue: Array<ReadonlyArray<FakeRow>>) {
  return {
    select() {
      const rows = resultsQueue.shift() ?? [];
      return createThenableChain(rows);
    },
  };
}

/** A db whose every SELECT throws — models a table absent pre-migration. */
export function createThrowingDb() {
  return {
    select() {
      throw new Error("relation does not exist");
    },
  };
}

/** appRouter caller over a fake db (headers empty; user null = sessionless). */
export function makeCaller(
  user: { id: string } | null,
  db: unknown,
): ReturnType<typeof appRouter.createCaller> {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}
