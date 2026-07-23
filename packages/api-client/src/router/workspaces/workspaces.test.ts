/**
 * workspaces.test.ts — W5 control-plane proofs for workspacesRouter + the
 * representative shared-document read path through documentsRouter.byId.
 *
 * Asserts the tenancy + RBAC guarantees:
 *   - create seeds the caller as an `owner` member (two inserts reached);
 *   - a non-admin (member/viewer) CANNOT add members or change roles (FORBIDDEN,
 *     no write);
 *   - an admin CANNOT escalate a role above their own (cannot mint an owner);
 *   - the owner's role/membership is immutable (change/remove/leave denied);
 *   - shareResource requires EDIT on the resource; revoke honours grantor/owner;
 *   - REPRESENTATIVE: a document shared to a workspace the caller belongs to is
 *     readable via documents.byId; an unshared one is NOT_FOUND.
 *
 * ctx.db is a queue-based fake: each select resolves the next result-array off
 * a `"<table>:<joined>"` FIFO (so two same-shape reads in one procedure — e.g.
 * actor-role then target-role — are seeded in order); insert/update/delete bump
 * counters and (for insert) return per-table `returning()` rows.
 */
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { documentsRouter } from "../documents";
import { workspacesRouter } from "./index";

const USER: SessionUser = { id: "30000000-0000-0000-0000-000000000003" };
const OTHER = "20000000-0000-0000-0000-000000000002";
const WS = "50000000-0000-0000-0000-000000000005";
const DOC = "40000000-0000-0000-0000-000000000004";
const SHARE = "60000000-0000-0000-0000-000000000006";
const TARGET = "70000000-0000-0000-0000-000000000007";

type Rows = ReadonlyArray<Record<string, unknown>>;

// FORBIDDEN/NOT_FOUND assertions match the TRPCError `code` (codes carry custom
// messages, so we assert the code, not the message string).

function fakeDb(opts: {
  queues?: Record<string, Rows[]>;
  insertReturns?: Record<string, Rows>;
}) {
  const calls = { insert: 0, update: 0, delete: 0 };
  const queues = opts.queues ?? {};
  const shift = (key: string): Rows => {
    const q = queues[key];
    return q && q.length > 0 ? (q.shift() as Rows) : [];
  };
  const selectChain = () => {
    let table = "";
    let joined = false;
    const c: Record<string, unknown> = {
      from(t: unknown) {
        table = getTableName(t as never);
        return c;
      },
      innerJoin() {
        joined = true;
        return c;
      },
      where() {
        return c;
      },
      limit() {
        return c;
      },
      orderBy() {
        return c;
      },
      then(res: (v: Rows) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(shift(`${table}:${joined}`)).then(res, rej);
      },
    };
    return c;
  };
  const writeChain = (returning: Rows) => {
    const c: Record<string, unknown> = {
      values() {
        return c;
      },
      set() {
        return c;
      },
      where() {
        return c;
      },
      returning() {
        return Promise.resolve(returning);
      },
      then(res: (v: Rows) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(returning).then(res, rej);
      },
    };
    return c;
  };
  const db = {
    select: () => selectChain(),
    insert: (t: unknown) => {
      calls.insert++;
      return writeChain(opts.insertReturns?.[getTableName(t as never)] ?? []);
    },
    update: () => {
      calls.update++;
      return writeChain([]);
    },
    delete: () => {
      calls.delete++;
      return writeChain([]);
    },
  } as never;
  return { db, calls };
}

const wsCaller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ workspaces: workspacesRouter }))({
    db,
    user,
    headers: new Headers(),
  });

const docCaller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ documents: documentsRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("workspacesRouter — create + membership RBAC", () => {
  it("create inserts the workspace AND seeds the caller as an owner member", async () => {
    const { db, calls } = fakeDb({ insertReturns: { workspaces: [{ id: WS }] } });
    const out = await wsCaller(db, USER).workspaces.create({ name: "Team" });
    expect(out).toEqual({ workspaceId: WS });
    expect(calls.insert).toBe(2); // workspace + owner member row
  });

  it("addMember: a non-admin (member) is FORBIDDEN and no write runs", async () => {
    const { db, calls } = fakeDb({
      queues: { "workspace_members:false": [[{ role: "member" }]] },
    });
    await expect(
      wsCaller(db, USER).workspaces.addMember({
        workspaceId: WS,
        userId: TARGET,
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.insert).toBe(0);
  });

  it("addMember: an admin CANNOT mint an owner (no escalation past own rank)", async () => {
    const { db, calls } = fakeDb({
      queues: { "workspace_members:false": [[{ role: "admin" }]] },
    });
    await expect(
      wsCaller(db, USER).workspaces.addMember({
        workspaceId: WS,
        userId: TARGET,
        role: "owner",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.insert).toBe(0);
  });

  it("addMember: an admin CAN add a member (write runs)", async () => {
    const { db, calls } = fakeDb({
      queues: { "workspace_members:false": [[{ role: "admin" }]] },
    });
    const out = await wsCaller(db, USER).workspaces.addMember({
      workspaceId: WS,
      userId: TARGET,
      role: "member",
    });
    expect(out).toEqual({ added: true });
    expect(calls.insert).toBe(1);
  });

  it("changeRole: the workspace owner's role is immutable", async () => {
    // actor role (admin) then target role (owner) — same table, in order.
    const { db, calls } = fakeDb({
      queues: {
        "workspace_members:false": [[{ role: "admin" }], [{ role: "owner" }]],
      },
    });
    await expect(
      wsCaller(db, USER).workspaces.changeRole({
        workspaceId: WS,
        userId: OTHER,
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.update).toBe(0);
  });

  it("removeMember: the owner cannot be removed", async () => {
    const { db, calls } = fakeDb({
      queues: {
        "workspace_members:false": [[{ role: "admin" }], [{ role: "owner" }]],
      },
    });
    await expect(
      wsCaller(db, USER).workspaces.removeMember({ workspaceId: WS, userId: OTHER }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.delete).toBe(0);
  });

  it("leave: a member may leave; the owner may NOT", async () => {
    const member = fakeDb({
      queues: { "workspace_members:false": [[{ role: "member" }]] },
    });
    await expect(
      wsCaller(member.db, USER).workspaces.leave({ workspaceId: WS }),
    ).resolves.toEqual({ left: true });
    expect(member.calls.delete).toBe(1);

    const owner = fakeDb({
      queues: { "workspace_members:false": [[{ role: "owner" }]] },
    });
    await expect(
      wsCaller(owner.db, USER).workspaces.leave({ workspaceId: WS }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(owner.calls.delete).toBe(0);
  });
});

describe("workspacesRouter — sharing surface", () => {
  it("shareResource: requires EDIT on the resource — non-editor is NOT_FOUND", async () => {
    // owner is someone else, no share -> assertCanAccess(edit) denies.
    const { db, calls } = fakeDb({
      queues: {
        "documents:false": [[{ userId: OTHER }]],
        "resource_shares:false": [[]],
        "resource_shares:true": [[]],
      },
    });
    await expect(
      wsCaller(db, USER).workspaces.shareResource({
        resourceType: "document",
        resourceId: DOC,
        permission: "view",
        target: { targetUserId: TARGET },
      }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.insert).toBe(0);
  });

  it("shareResource: the resource OWNER can share to a user (grant row inserted)", async () => {
    const { db, calls } = fakeDb({
      queues: { "documents:false": [[{ userId: USER.id }]] },
      insertReturns: { resource_shares: [{ id: SHARE }] },
    });
    const out = await wsCaller(db, USER).workspaces.shareResource({
      resourceType: "document",
      resourceId: DOC,
      permission: "edit",
      target: { targetUserId: TARGET },
    });
    expect(out).toEqual({ shareId: SHARE });
    expect(calls.insert).toBe(1);
  });

  it("shareResource: rejects a target that is neither a workspace nor a user (Zod XOR)", async () => {
    const { db } = fakeDb({});
    await expect(
      wsCaller(db, USER).workspaces.shareResource({
        resourceType: "document",
        resourceId: DOC,
        permission: "view",
        target: {},
      }),
    ).rejects.toThrow();
  });

  it("revokeShare: the grantor may revoke (row deleted)", async () => {
    const { db, calls } = fakeDb({
      queues: {
        "resource_shares:false": [
          [{ resourceType: "document", resourceId: DOC, grantedBy: USER.id }],
        ],
      },
    });
    const out = await wsCaller(db, USER).workspaces.revokeShare({ shareId: SHARE });
    expect(out).toEqual({ revoked: true });
    expect(calls.delete).toBe(1);
  });

  it("revokeShare: a stranger (not grantor, not owner) is NOT_FOUND, no delete", async () => {
    const { db, calls } = fakeDb({
      queues: {
        "resource_shares:false": [
          [{ resourceType: "document", resourceId: DOC, grantedBy: OTHER }],
        ],
        "documents:false": [[{ userId: OTHER }]],
      },
    });
    await expect(
      wsCaller(db, USER).workspaces.revokeShare({ shareId: SHARE }),
    ).rejects.toThrow(/not.?found/i);
    expect(calls.delete).toBe(0);
  });
});

describe("documents.byId — representative shared-resource read (W5)", () => {
  it("a member READS a document shared with their workspace", async () => {
    const row = {
      userId: OTHER,
      id: DOC,
      title: "Shared report",
      spec: { blocks: [] },
      sourceLedgerId: null,
      createdAt: new Date(),
    };
    const { db } = fakeDb({
      queues: {
        // assertCanAccess: owner=OTHER, no direct share, workspace share (member)…
        "documents:false": [[row], [row]], // owner-resolve, then byId read
        "resource_shares:false": [[]],
        "resource_shares:true": [[{ permission: "view", role: "member" }]],
      },
    });
    const out = await docCaller(db, USER).documents.byId({ id: DOC });
    expect(out).toMatchObject({ id: DOC, title: "Shared report" });
  });

  it("an UNSHARED document owned by someone else is NOT_FOUND", async () => {
    const { db } = fakeDb({
      queues: {
        "documents:false": [[{ userId: OTHER, id: DOC }]],
        "resource_shares:false": [[]],
        "resource_shares:true": [[]],
      },
    });
    await expect(
      docCaller(db, USER).documents.byId({ id: DOC }),
    ).rejects.toThrow(/not.?found/i);
  });

  it("the OWNER still reads their own document (owner path unchanged, no regression)", async () => {
    const row = {
      userId: USER.id,
      id: DOC,
      title: "Mine",
      spec: {},
      sourceLedgerId: null,
      createdAt: new Date(),
    };
    const { db } = fakeDb({
      queues: { "documents:false": [[row], [row]] },
    });
    const out = await docCaller(db, USER).documents.byId({ id: DOC });
    expect(out).toMatchObject({ id: DOC, title: "Mine" });
  });
});
