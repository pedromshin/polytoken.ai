/**
 * thread-grouping.test.ts — tests for `emails.listThreads` (THRD-03, Phase 45
 * Plan 04).
 *
 * Two layers, mirroring the emails-user-scoping.test.ts idiom:
 *   1. Pure `groupEmailsIntoThreads` (DB-free) — collapse/count/latest-snippet,
 *      null-thread singleton, member cap, deterministic ordering.
 *   2. Router-level (`appRouter.createCaller`, `@polytoken/db/ownership`
 *      mocked at the module boundary) — proves the WIRING: session required,
 *      scope derives from `userOwnedImporterIds` + `resolveListScope` (never a
 *      client-supplied importerId trusted raw), and a non-owned/owner-less
 *      caller can never see another user's threads (T-45-04-01).
 *
 * Test plan:
 *   Test 1: same threadId rows collapse into one entry — correct count,
 *           latest snippet/date/subject sourced from the newest member.
 *   Test 2: a null-threadId row lists as its own singleton entry (count 1).
 *   Test 3: entries are ordered by latestReceivedAt desc.
 *   Test 4: memberEmailIds is most-recent-first and capped at memberCap.
 *   Test 5: listThreads rejects a sessionless call with UNAUTHORIZED.
 *   Test 6: an owner-less caller gets an empty page, no query issued.
 *   Test 7: a non-owned importerId filter is rejected — user A cannot read
 *           via user B's importerId (cross-tenant isolation).
 *   Test 8: an owned importerId filter groups only that importer's emails.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    userOwnedImporterIds: vi.fn(),
  };
});

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { appRouter } from "../../../root";
import { groupEmailsIntoThreads, type ThreadEmailRow } from "../list-threads";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const IMPORTER_B = "30000000-0000-0000-0000-000000000b02";
const THREAD_1 = "20000000-0000-0000-0000-000000000t01";

function row(overrides: Partial<ThreadEmailRow>): ThreadEmailRow {
  return {
    emailId: "40000000-0000-0000-0000-000000000e01",
    threadId: null,
    importerId: IMPORTER_A,
    subject: "Hello",
    receivedAt: new Date("2026-07-01T00:00:00Z"),
    bodyText: "snippet",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupEmailsIntoThreads — pure, DB-free
// ---------------------------------------------------------------------------

describe("groupEmailsIntoThreads", () => {
  it("Test 1: a reply-chain (same threadId) collapses into one entry with correct count + latest snippet/date/subject", () => {
    const rows: ThreadEmailRow[] = [
      row({
        emailId: "e1",
        threadId: THREAD_1,
        subject: "Original subject",
        receivedAt: new Date("2026-07-01T00:00:00Z"),
        bodyText: "first message",
      }),
      row({
        emailId: "e2",
        threadId: THREAD_1,
        subject: "Re: Original subject",
        receivedAt: new Date("2026-07-03T00:00:00Z"),
        bodyText: "latest reply",
      }),
      row({
        emailId: "e3",
        threadId: THREAD_1,
        subject: "Re: Original subject",
        receivedAt: new Date("2026-07-02T00:00:00Z"),
        bodyText: "middle reply",
      }),
    ];

    const entries = groupEmailsIntoThreads(rows);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: THREAD_1,
      threadId: THREAD_1,
      messageCount: 3,
      subject: "Re: Original subject",
      latestSnippet: "latest reply",
      latestReceivedAt: new Date("2026-07-03T00:00:00Z"),
    });
    // Most-recent-first membership.
    expect(entries[0]!.memberEmailIds).toEqual(["e2", "e3", "e1"]);
  });

  it("Test 2: a null-threadId email lists as its own singleton entry (count 1)", () => {
    const rows: ThreadEmailRow[] = [
      row({ emailId: "orphan-1", threadId: null }),
      row({ emailId: "orphan-2", threadId: null }),
    ];

    const entries = groupEmailsIntoThreads(rows);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.messageCount).toBe(1);
      expect(entry.threadId).toBeNull();
    }
    expect(entries.map((e) => e.key).sort()).toEqual([
      "email:orphan-1",
      "email:orphan-2",
    ]);
  });

  it("Test 3: entries are ordered by latestReceivedAt desc regardless of input order", () => {
    const rows: ThreadEmailRow[] = [
      row({ emailId: "old", threadId: null, receivedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ emailId: "newest", threadId: null, receivedAt: new Date("2026-07-05T00:00:00Z") }),
      row({ emailId: "middle", threadId: null, receivedAt: new Date("2026-03-01T00:00:00Z") }),
    ];

    const entries = groupEmailsIntoThreads(rows);

    expect(entries.map((e) => e.key)).toEqual([
      "email:newest",
      "email:middle",
      "email:old",
    ]);
  });

  it("Test 4: memberEmailIds is most-recent-first and capped at memberCap", () => {
    const rows: ThreadEmailRow[] = Array.from({ length: 5 }, (_, i) =>
      row({
        emailId: `e${i}`,
        threadId: THREAD_1,
        receivedAt: new Date(2026, 0, i + 1),
      }),
    );

    const entries = groupEmailsIntoThreads(rows, { memberCap: 2 });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.messageCount).toBe(5); // count reflects ALL members
    expect(entries[0]!.memberEmailIds).toEqual(["e4", "e3"]); // capped to 2, newest first
  });
});

// ---------------------------------------------------------------------------
// listThreads — router wiring / tenancy (T-45-04-01)
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

function createFakeChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from() {
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
    offset() {
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

function createFakeDb(selectCalls: { count: number }, rows: ReadonlyArray<FakeRow>) {
  return {
    select() {
      selectCalls.count += 1;
      return createFakeChain(rows);
    },
  };
}

function makeCaller(
  user: { id: string } | null,
  rows: ReadonlyArray<FakeRow> = [],
  selectCalls: { count: number } = { count: 0 },
) {
  return appRouter.createCaller({
    db: createFakeDb(selectCalls, rows) as never,
    headers: new Headers(),
    user,
  });
}

describe("emails.listThreads — session + tenancy wiring", () => {
  afterEach(() => {
    vi.mocked(userOwnedImporterIds).mockReset();
  });

  it("Test 5: rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.emails.listThreads({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test 6: an owner-less caller gets an empty page and no query is issued", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const selectCalls = { count: 0 };
    const caller = makeCaller(USER_A, [{ emailId: "should-not-appear" }], selectCalls);

    const result = await caller.emails.listThreads({});
    expect(result.items).toEqual([]);
    expect(selectCalls.count).toBe(0);
  });

  it("Test 7: a non-owned importerId filter is rejected — user A cannot read user B's threads", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      { emailId: "leaked", threadId: null, importerId: IMPORTER_B, subject: "s", receivedAt: new Date(), bodyText: null },
    ]);

    const result = await caller.emails.listThreads({ importerId: IMPORTER_B });
    expect(result.items).toEqual([]);
  });

  it("Test 8: an owned importerId filter groups only that importer's rows", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      {
        emailId: "e1",
        threadId: THREAD_1,
        importerId: IMPORTER_A,
        subject: "Hi",
        receivedAt: new Date("2026-07-01T00:00:00Z"),
        bodyText: "hello",
      },
      {
        emailId: "e2",
        threadId: THREAD_1,
        importerId: IMPORTER_A,
        subject: "Re: Hi",
        receivedAt: new Date("2026-07-02T00:00:00Z"),
        bodyText: "reply",
      },
    ]);

    const result = await caller.emails.listThreads({ importerId: IMPORTER_A });
    expect(result.items).toEqual([
      expect.objectContaining({
        threadId: THREAD_1,
        messageCount: 2,
        subject: "Re: Hi",
      }),
    ]);
  });
});
