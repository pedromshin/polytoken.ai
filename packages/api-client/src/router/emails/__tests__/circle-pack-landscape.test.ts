/**
 * circle-pack-landscape.test.ts — TM-02 aggregate: the pure sender→thread→email
 * grouping (`buildSenderLandscape`) and the tenancy wiring of the
 * `emails.circlePackLandscape` procedure.
 *
 * Scoping strategy mirrors emails-user-scoping.test.ts: `@polytoken/db/ownership`
 * is mocked at the boundary and a minimal fake Drizzle chain stands in for the
 * data query, so a regression that dropped the ownership-derived scope would let
 * a seeded "leaked" row surface in the hierarchy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return { ...actual, userOwnedImporterIds: vi.fn() };
});

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { appRouter } from "../../../root";
import {
  buildSenderLandscape,
  type LandscapeEmailRow,
  type LandscapeNode,
} from "../circle-pack";

// ---------------------------------------------------------------------------
// Pure helper — buildSenderLandscape
// ---------------------------------------------------------------------------

function row(over: Partial<LandscapeEmailRow>): LandscapeEmailRow {
  return {
    emailId: "e0",
    threadId: null,
    senderAddress: "alice@example.com",
    senderName: "Alice",
    subject: "Hello",
    receivedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
}

function leafCount(node: LandscapeNode): number {
  if (node.kind === "email") return 1;
  return (node.children ?? []).reduce((n, c) => n + leafCount(c), 0);
}

describe("buildSenderLandscape — hierarchy shape", () => {
  it("groups root → sender → thread → email with one email leaf per message", () => {
    const rows: LandscapeEmailRow[] = [
      row({ emailId: "e1", senderAddress: "a@x.com", threadId: "t1", receivedAt: new Date("2026-07-01") }),
      row({ emailId: "e2", senderAddress: "a@x.com", threadId: "t1", receivedAt: new Date("2026-07-02") }),
      row({ emailId: "e3", senderAddress: "b@x.com", threadId: "t2", receivedAt: new Date("2026-07-03") }),
    ];
    const tree = buildSenderLandscape(rows);
    expect(tree.kind).toBe("root");
    expect(tree.children).toHaveLength(2); // two senders
    expect(leafCount(tree)).toBe(3); // three email leaves
    const senderA = tree.children!.find((s) => s.senderAddress === "a@x.com")!;
    expect(senderA.children).toHaveLength(1); // one thread (t1)
    expect(senderA.children![0]!.children).toHaveLength(2); // two emails in t1
    for (const leaf of senderA.children![0]!.children!) {
      expect(leaf.kind).toBe("email");
      expect(leaf.value).toBe(1);
      expect(leaf.leaf?.emailId).toMatch(/^e[12]$/);
    }
  });

  it("falls back to per-email singleton threads for null thread_id", () => {
    const rows = [
      row({ emailId: "e1", senderAddress: "a@x.com", threadId: null }),
      row({ emailId: "e2", senderAddress: "a@x.com", threadId: null }),
    ];
    const tree = buildSenderLandscape(rows);
    const sender = tree.children![0]!;
    expect(sender.children).toHaveLength(2); // two singleton threads
  });

  it("normalizes recency into a [0,1] tint (newest → 1, oldest → 0)", () => {
    const rows = [
      row({ emailId: "old", threadId: "t", receivedAt: new Date("2026-01-01") }),
      row({ emailId: "new", threadId: "t", receivedAt: new Date("2026-12-31") }),
    ];
    const tree = buildSenderLandscape(rows);
    const leaves = tree.children![0]!.children![0]!.children!;
    const byId = new Map(leaves.map((l) => [l.leaf!.emailId, l.tint!]));
    expect(byId.get("old")).toBeCloseTo(0, 5);
    expect(byId.get("new")).toBeCloseTo(1, 5);
  });

  it("uses the sender address as the display name when senderName is blank", () => {
    const tree = buildSenderLandscape([
      row({ senderName: "  ", senderAddress: "noname@x.com", threadId: "t" }),
    ]);
    expect(tree.children![0]!.name).toBe("noname@x.com");
  });

  it("returns an empty root for an empty scan", () => {
    expect(buildSenderLandscape([])).toEqual({ name: "Mailbox", kind: "root", children: [] });
  });
});

// ---------------------------------------------------------------------------
// Procedure scoping (tenancy)
// ---------------------------------------------------------------------------

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const IMPORTER_B = "30000000-0000-0000-0000-000000000b02";

function createFakeChain(rows: ReadonlyArray<Record<string, unknown>>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then(onFulfilled: (v: ReadonlyArray<Record<string, unknown>>) => unknown, onRejected?: (r: unknown) => unknown) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function makeCaller(user: { id: string } | null, rows: ReadonlyArray<Record<string, unknown>> = []) {
  return appRouter.createCaller({
    db: { select: () => createFakeChain(rows) } as never,
    headers: new Headers(),
    user,
  });
}

describe("emails.circlePackLandscape — tenancy (TENA-03)", () => {
  afterEach(() => vi.mocked(userOwnedImporterIds).mockReset());

  it("rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.emails.circlePackLandscape({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns an empty root when the caller owns no importers", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const caller = makeCaller(USER_A, [
      { emailId: "leaked", senderAddress: "x@x.com", senderName: null, threadId: null, subject: "s", receivedAt: new Date() },
    ]);
    const tree = await caller.emails.circlePackLandscape({});
    expect(tree).toEqual({ name: "Mailbox", kind: "root", children: [] });
  });

  it("rejects a non-owned importerId filter — the seeded leaked row never surfaces", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      { emailId: "leaked", senderAddress: "x@x.com", senderName: null, threadId: null, subject: "s", receivedAt: new Date() },
    ]);
    const tree = await caller.emails.circlePackLandscape({ importerId: IMPORTER_B });
    expect(tree.children).toEqual([]);
  });

  it("builds the hierarchy for an owned importer", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A]);
    const caller = makeCaller(USER_A, [
      { emailId: "e1", senderAddress: "a@x.com", senderName: "Alice", threadId: "t1", subject: "Hi", receivedAt: new Date("2026-07-01") },
      { emailId: "e2", senderAddress: "a@x.com", senderName: "Alice", threadId: "t1", subject: "Re: Hi", receivedAt: new Date("2026-07-02") },
    ]);
    const tree = await caller.emails.circlePackLandscape({ importerId: IMPORTER_A });
    expect(tree.children).toHaveLength(1);
    expect(tree.children![0]!.senderAddress).toBe("a@x.com");
    expect(leafCount(tree)).toBe(2);
  });
});
