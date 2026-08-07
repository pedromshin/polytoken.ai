/**
 * learning-summary.test.ts — the `learning.summary` procedure (WEDG-03).
 *
 * Modeled on billing-usage.test.ts: these tests prove the WIRING at the router
 * boundary plus the pure metric derivation, not a real query engine:
 *
 *   1. protectedProcedure — a sessionless call is UNAUTHORIZED.
 *   2. STRICT caller scoping — both ledger reads filter on ctx.user.id (never
 *      a client field), proven by recording the values threaded into drizzle's
 *      `eq(...)`.
 *   3. CROSS-TENANT — user A's summary is derived from A's rows ONLY and user
 *      B's from B's ONLY, proven behaviorally with a tenant-keyed fake db that
 *      resolves rows for whichever user id the query actually bound.
 *   4. Metric derivation — supersession stick logic, propagation leverage,
 *      and the all-zeros pre-flip state (WEDG-03 reads zero until WEDG-01).
 *   5. Graceful — a throwing db degrades to the all-zeros summary, never a 500.
 *
 * `drizzle-orm` is mocked at the boundary so `eq` records its (column, value)
 * pairs while delegating to the real implementation.
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

import { appRouter } from "../../../root";
import { deriveLearningSummary } from "../index";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const USER_B = { id: "10000000-0000-0000-0000-00000000000b" };

type FakeRow = Record<string, unknown>;

interface TenantFixture {
  readonly typeCorrections: ReadonlyArray<FakeRow>;
  readonly propagations: ReadonlyArray<FakeRow>;
}

/**
 * A thenable chain mimicking the subset of drizzle's builder that `summary`
 * calls: select().from().innerJoin().where(), awaited.
 */
function createThenableChain(resolveRows: () => ReadonlyArray<FakeRow>) {
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
    then(
      onFulfilled: (value: ReadonlyArray<FakeRow>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(resolveRows()).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

/**
 * TENANT-KEYED fake db: each select resolves the fixture rows belonging to
 * whichever user id the query ACTUALLY bound through `eq(...)` (recorded by
 * the drizzle mock above). A summary that dropped the user filter — or bound
 * the wrong user — would read the wrong tenant's rows and fail the
 * cross-tenant assertions below. `summary` runs two SELECTs in order
 * (entity_type_corrections, then correction_propagations).
 */
function createTenantDb(fixtures: Record<string, TenantFixture>) {
  let selectCount = 0;
  return {
    select() {
      const queryIndex = selectCount++;
      return createThenableChain(() => {
        const bound = [...eqCalls]
          .reverse()
          .find(([, val]) => typeof val === "string" && val in fixtures);
        if (!bound) return [];
        const fixture = fixtures[bound[1] as string]!;
        return queryIndex % 2 === 0 ? fixture.typeCorrections : fixture.propagations;
      });
    },
  };
}

/** A db whose every SELECT throws — models a table absent pre-migration. */
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

const at = (iso: string): Date => new Date(iso);

beforeEach(() => {
  eqCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("learning.summary — session requirement", () => {
  it("rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null, createTenantDb({}));
    await expect(caller.learning.summary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("learning.summary — caller scoping", () => {
  it("scopes BOTH ledger reads to ctx.user.id (importers.user_id filter)", async () => {
    const caller = makeCaller(
      USER_A,
      createTenantDb({ [USER_A.id]: { typeCorrections: [], propagations: [] } }),
    );

    await caller.learning.summary();

    // Exactly two eq() calls carry the caller's id — one per ledger read
    // (the join eq()s bind columns, not the user id).
    const scopedByUser = eqCalls.filter(([, val]) => val === USER_A.id);
    expect(scopedByUser.length).toBe(2);

    // And no eq() ever bound a foreign user id.
    const foreign = eqCalls.filter(
      ([, val]) => typeof val === "string" && val.startsWith("1") && val !== USER_A.id,
    );
    expect(foreign.length).toBe(0);
  });

  it("CROSS-TENANT: user A's summary reflects A's rows only; user B reads zero from the same store", async () => {
    const fixtures: Record<string, TenantFixture> = {
      [USER_A.id]: {
        typeCorrections: [
          { componentId: "comp-1", createdAt: at("2026-08-01T10:00:00Z") },
          { componentId: "comp-2", createdAt: at("2026-08-02T10:00:00Z") },
        ],
        propagations: [
          {
            survivorEntityInstanceId: "ent-s",
            absorbedEntityInstanceId: "ent-t",
            affectedEmailIds: ["e1", "e2", "e3", "e4", "e5", "e6"],
            createdAt: at("2026-08-03T10:00:00Z"),
          },
        ],
      },
      [USER_B.id]: { typeCorrections: [], propagations: [] },
    };

    const resultA = await makeCaller(USER_A, createTenantDb(fixtures)).learning.summary();
    expect(resultA).toEqual({
      correctionsMade: 3,
      typeCorrections: 2,
      mergeCascades: 1,
      emailsRelabeled: 6,
      relabelsPerCorrection: 6,
      stickRate: 1,
    });

    // Fresh db + recorder, same fixtures: B must never see A's rows.
    eqCalls.length = 0;
    const resultB = await makeCaller(USER_B, createTenantDb(fixtures)).learning.summary();
    expect(resultB).toEqual({
      correctionsMade: 0,
      typeCorrections: 0,
      mergeCascades: 0,
      emailsRelabeled: 0,
      relabelsPerCorrection: null,
      stickRate: null,
    });
    expect(eqCalls.some(([, val]) => val === USER_A.id)).toBe(false);
  });
});

describe("learning.summary — all-zeros pre-flip state + graceful degradation", () => {
  it("reads the honest all-zeros summary for a caller with no rows (pre-WEDG-01)", async () => {
    const caller = makeCaller(
      USER_A,
      createTenantDb({ [USER_A.id]: { typeCorrections: [], propagations: [] } }),
    );
    const result = await caller.learning.summary();
    expect(result).toEqual({
      correctionsMade: 0,
      typeCorrections: 0,
      mergeCascades: 0,
      emailsRelabeled: 0,
      relabelsPerCorrection: null,
      stickRate: null,
    });
  });

  it("degrades to the all-zeros summary when the db throws (missing table / unapplied migration)", async () => {
    const caller = makeCaller(USER_A, createThrowingDb());
    const result = await caller.learning.summary();
    expect(result).toEqual({
      correctionsMade: 0,
      typeCorrections: 0,
      mergeCascades: 0,
      emailsRelabeled: 0,
      relabelsPerCorrection: null,
      stickRate: null,
    });
  });
});

describe("deriveLearningSummary — supersession stick logic (pure)", () => {
  it("a later correction on the SAME component supersedes the earlier one", () => {
    const summary = deriveLearningSummary(
      [
        { componentId: "comp-1", createdAt: at("2026-08-01T00:00:00Z") }, // superseded
        { componentId: "comp-1", createdAt: at("2026-08-02T00:00:00Z") }, // sticks
        { componentId: "comp-2", createdAt: at("2026-08-01T00:00:00Z") }, // sticks
      ],
      [],
    );
    expect(summary.correctionsMade).toBe(3);
    expect(summary.stickRate).toBeCloseTo(2 / 3);
  });

  it("a cascade whose survivor is LATER absorbed is superseded; the absorber sticks", () => {
    const summary = deriveLearningSummary(
      [],
      [
        {
          // ent-b absorbed ent-c ... but ent-b itself is absorbed later — superseded.
          survivorEntityInstanceId: "ent-b",
          absorbedEntityInstanceId: "ent-c",
          affectedEmailIds: ["e1", "e2"],
          createdAt: at("2026-08-01T00:00:00Z"),
        },
        {
          // ent-a absorbed ent-b and was never absorbed itself — sticks.
          survivorEntityInstanceId: "ent-a",
          absorbedEntityInstanceId: "ent-b",
          affectedEmailIds: ["e3", "e4", "e5"],
          createdAt: at("2026-08-02T00:00:00Z"),
        },
      ],
    );
    expect(summary.mergeCascades).toBe(2);
    expect(summary.emailsRelabeled).toBe(5);
    expect(summary.relabelsPerCorrection).toBeCloseTo(2.5);
    expect(summary.stickRate).toBeCloseTo(1 / 2);
  });

  it("an EARLIER absorption of the survivor does not supersede a later cascade (strictly-later rule)", () => {
    const summary = deriveLearningSummary(
      [],
      [
        {
          // ent-a absorbed ent-b BEFORE ent-b won a merge of its own... order matters:
          survivorEntityInstanceId: "ent-a",
          absorbedEntityInstanceId: "ent-b",
          affectedEmailIds: [],
          createdAt: at("2026-08-01T00:00:00Z"),
        },
        {
          // ent-b's own earlier win predates its absorption — that absorption
          // (2026-08-01) is NOT later than this row? It IS earlier than 08-02,
          // so this row sticks only if ent-b was not absorbed AFTER it.
          survivorEntityInstanceId: "ent-b",
          absorbedEntityInstanceId: "ent-c",
          affectedEmailIds: [],
          createdAt: at("2026-08-02T00:00:00Z"),
        },
      ],
    );
    // Row 1 sticks (ent-a never absorbed). Row 2 sticks too: ent-b's only
    // absorption happened BEFORE row 2, so nothing strictly later supersedes it.
    expect(summary.stickRate).toBe(1);
  });

  it("guards the jsonb boundary: a null/absent affected_email_ids counts 0 re-labels", () => {
    const summary = deriveLearningSummary(
      [],
      [
        {
          survivorEntityInstanceId: "ent-a",
          absorbedEntityInstanceId: "ent-b",
          affectedEmailIds: null,
          createdAt: at("2026-08-01T00:00:00Z"),
        },
      ],
    );
    expect(summary.emailsRelabeled).toBe(0);
    expect(summary.relabelsPerCorrection).toBe(0);
  });

  it("never mutates its inputs (immutability)", () => {
    const typeRows = [
      { componentId: "comp-1", createdAt: at("2026-08-01T00:00:00Z") },
    ];
    const propRows = [
      {
        survivorEntityInstanceId: "ent-a",
        absorbedEntityInstanceId: "ent-b",
        affectedEmailIds: ["e1"],
        createdAt: at("2026-08-02T00:00:00Z"),
      },
    ];
    const typeSnapshot = JSON.stringify(typeRows);
    const propSnapshot = JSON.stringify(propRows);
    deriveLearningSummary(typeRows, propRows);
    expect(JSON.stringify(typeRows)).toBe(typeSnapshot);
    expect(JSON.stringify(propRows)).toBe(propSnapshot);
  });
});
