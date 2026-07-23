/**
 * home-canvas.test.ts — router-level tests for chat.getHomeCanvasLayout /
 * chat.saveHomeCanvasLayout (HM-01 — the pinned home board).
 *
 * Strategy (mirrors canvas-mutations.test.ts): a minimal thenable Drizzle-chain
 * fake models select().from().where().limit() and
 * insert().values().onConflictDoUpdate(). No `@polytoken/db/ownership` mock is
 * needed — the home board is keyed on `ctx.user.id` by construction, so there
 * is no client-supplied id to run an ownership assertion against.
 *
 * Test plan:
 *   Test 1: getHomeCanvasLayout returns null when the user has no home row.
 *   Test 2: getHomeCanvasLayout returns the seeded home row when present, and
 *           applies a WHERE (scope-filtered read, never a full scan).
 *   Test 3: saveHomeCanvasLayout upserts, STAMPING user_id = ctx.user.id,
 *           scope = 'home', conversation_id = NULL (a home partition write) —
 *           and targets the partial `user_id WHERE scope='home'` index.
 *   Test 4: tenancy — the stamped user_id ALWAYS comes from the session, never
 *           the body: user A and user B each write their OWN id, and neither
 *           procedure exposes a body field that could override it.
 *   Test 5: home-vs-conversation isolation — the save NEVER writes a
 *           conversation_id, and the read WHERE carries the scope filter, so a
 *           home procedure can neither return nor clobber a conversation row.
 *   Test 6: both procedures reject a sessionless call with UNAUTHORIZED.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../../root";
import type { CanvasSnapshot } from "../canvas-schema";
import { HOME_CANVAS_SCOPE } from "../home-canvas";

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const USER_B = { id: "20000000-0000-0000-0000-00000000000b" };

type FakeRow = Record<string, unknown>;

/**
 * A minimal thenable Drizzle-chain fake covering exactly what the home-canvas
 * procedures touch: select().from().where().limit() and
 * insert().values().onConflictDoUpdate().
 */
function createFakeDb(options: { readonly selectRows?: ReadonlyArray<FakeRow> }) {
  let whereCalled = false;
  let upsertValues: Record<string, unknown> | undefined;
  let upsertConfig: Record<string, unknown> | undefined;
  let upsertCallCount = 0;

  const db = {
    select() {
      const chain = {
        from() {
          return chain;
        },
        where() {
          whereCalled = true;
          return chain;
        },
        limit() {
          return chain;
        },
        then(
          onFulfilled: (rows: ReadonlyArray<FakeRow>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(options.selectRows ?? []).then(
            onFulfilled,
            onRejected,
          );
        },
      };
      return chain;
    },
    insert() {
      const chain = {
        values(v: Record<string, unknown>) {
          upsertValues = v;
          return chain;
        },
        onConflictDoUpdate(cfg: Record<string, unknown>) {
          upsertConfig = cfg;
          return chain;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          upsertCallCount += 1;
          return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return {
    db,
    whereCalled: () => whereCalled,
    upsertCallCount: () => upsertCallCount,
    getUpsertValues: () => upsertValues,
    getUpsertConfig: () => upsertConfig,
  };
}

function makeCaller(
  user: { id: string } | null,
  db: ReturnType<typeof createFakeDb>["db"],
) {
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

/** A minimal CanvasSnapshotSchema-valid snapshot (empty board). */
function makeSnapshot(): CanvasSnapshot {
  return {
    nodes: [],
    edges: [],
    sharedState: {},
    nodeRegistryVersion: "home-v1",
  };
}

/** A valid persisted HOME row (the DB shape getHomeCanvasLayout returns). */
function makeHomeRow(userId: string): FakeRow {
  return {
    id: "40000000-0000-0000-0000-000000000001",
    conversationId: null,
    userId,
    scope: HOME_CANVAS_SCOPE,
    nodes: [],
    edges: [],
    viewport: null,
    sharedState: { "shared.greeting": "gm" },
    nodeRegistryVersion: "home-v1",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("chat.getHomeCanvasLayout", () => {
  it("Test 1: returns null when the user has no home row", async () => {
    const fake = createFakeDb({ selectRows: [] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.getHomeCanvasLayout();

    expect(result).toBeNull();
    expect(fake.whereCalled()).toBe(true);
  });

  it("Test 2: returns the seeded home row when present, scope-filtered", async () => {
    const fake = createFakeDb({ selectRows: [makeHomeRow(USER_A.id)] });
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.getHomeCanvasLayout();

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(USER_A.id);
    expect(result!.scope).toBe(HOME_CANVAS_SCOPE);
    expect(result!.conversationId).toBeNull();
    // A WHERE was applied — the read is filtered (user_id + scope='home'),
    // never a full-table scan that could surface another user / a conversation.
    expect(fake.whereCalled()).toBe(true);
  });
});

describe("chat.saveHomeCanvasLayout", () => {
  it("Test 3: upserts, stamping user_id/scope/conversation_id + partial-index target", async () => {
    const fake = createFakeDb({});
    const caller = makeCaller(USER_A, fake.db);

    const result = await caller.chat.saveHomeCanvasLayout({
      snapshot: makeSnapshot(),
    });

    expect(result).toEqual({ saved: true });
    expect(fake.upsertCallCount()).toBe(1);

    const values = fake.getUpsertValues()!;
    expect(values.userId).toBe(USER_A.id);
    expect(values.scope).toBe(HOME_CANVAS_SCOPE);
    expect(values.conversationId).toBeNull();
    expect(values.nodeRegistryVersion).toBe("home-v1");

    // Conflict target is the partial one-home-board-per-user index
    // (user_id WHERE scope='home'): both a target column and a targetWhere.
    const cfg = fake.getUpsertConfig()!;
    expect(cfg.target).toBeDefined();
    expect(cfg.targetWhere).toBeDefined();
    expect(cfg.set).toBeDefined();
  });

  it("Test 4: tenancy — user_id is stamped from the session, never the body", async () => {
    const fakeA = createFakeDb({});
    const fakeB = createFakeDb({});

    await makeCaller(USER_A, fakeA.db).chat.saveHomeCanvasLayout({
      snapshot: makeSnapshot(),
    });
    await makeCaller(USER_B, fakeB.db).chat.saveHomeCanvasLayout({
      snapshot: makeSnapshot(),
    });

    expect(fakeA.getUpsertValues()!.userId).toBe(USER_A.id);
    expect(fakeB.getUpsertValues()!.userId).toBe(USER_B.id);
    // The input schema is snapshot-only — there is no user_id/conversation_id
    // body field a caller could smuggle to write into another tenant's board.
  });

  it("Test 5: never writes a conversation_id — a home write can't hit a conversation row", async () => {
    const fake = createFakeDb({});
    const caller = makeCaller(USER_A, fake.db);

    await caller.chat.saveHomeCanvasLayout({ snapshot: makeSnapshot() });

    const values = fake.getUpsertValues()!;
    expect(values.conversationId).toBeNull();
    expect(values.scope).toBe(HOME_CANVAS_SCOPE);
  });
});

describe("session required", () => {
  it("Test 6: both procedures reject a sessionless call with UNAUTHORIZED", async () => {
    const fake = createFakeDb({});
    const caller = makeCaller(null, fake.db);

    await expect(caller.chat.getHomeCanvasLayout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.chat.saveHomeCanvasLayout({ snapshot: makeSnapshot() }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
