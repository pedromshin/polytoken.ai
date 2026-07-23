/**
 * access-control.test.ts — the W5 authorization truth table (FEATURE-CATALOG W5).
 *
 * DB-free: a queue-based fake Drizzle handle. Each `select()` records the table
 * passed to `.from()` and whether `.innerJoin()` was called, forming a key
 * `"<table>:<joined>"`; the terminal await SHIFTS the next seeded result-array
 * off that key's FIFO queue (so two same-shape queries in one call — e.g.
 * resolveResourceOwner then the two share lookups — are seeded independently and
 * in order). This mirrors ownership.test.ts's chain-stub strategy, extended for
 * assertCanAccess's multi-query flow.
 *
 * Truth table (the whole point of W5): owner yes; shared-to-user view/edit;
 * shared-to-member-workspace; NOT-shared no; revoked no; role-insufficient no.
 */

import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  AccessError,
  assertCanAccess,
  assertWorkspaceRole,
  capPermission,
  effectiveSharedPermission,
  getWorkspaceRole,
  permissionSatisfies,
  resolveResourceOwner,
  roleRank,
  WorkspaceRoleError,
  type AccessDb,
} from "./access-control";

const OWNER = "10000000-0000-0000-0000-000000000001";
const OTHER = "20000000-0000-0000-0000-000000000002";
const CALLER = "30000000-0000-0000-0000-000000000003";
const DOC = "40000000-0000-0000-0000-000000000004";
const WS = "50000000-0000-0000-0000-000000000005";

type Rows = ReadonlyArray<Record<string, unknown>>;

/**
 * fakeDb — queue-based. `queues[key]` is a FIFO of result-arrays; each matching
 * select shifts the next. Missing/empty queue yields [].
 */
function fakeDb(queues: Record<string, Rows[]>): AccessDb {
  const next = (key: string): Rows => {
    const q = queues[key];
    if (q && q.length > 0) return q.shift() as Rows;
    return [];
  };
  const makeChain = () => {
    let table = "";
    let joined = false;
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = getTableName(t as never);
        return chain;
      },
      innerJoin() {
        joined = true;
        return chain;
      },
      where() {
        return chain;
      },
      limit() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      then(res: (v: Rows) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(next(`${table}:${joined}`)).then(res, rej);
      },
    };
    return chain;
  };
  return { select: () => makeChain() } as unknown as AccessDb;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("permission + role algebra", () => {
  it("permissionSatisfies: edit implies view; view only view", () => {
    expect(permissionSatisfies("edit", "view")).toBe(true);
    expect(permissionSatisfies("edit", "edit")).toBe(true);
    expect(permissionSatisfies("view", "view")).toBe(true);
    expect(permissionSatisfies("view", "edit")).toBe(false);
  });

  it("roleRank: viewer < member < admin < owner", () => {
    expect(roleRank("viewer")).toBeLessThan(roleRank("member"));
    expect(roleRank("member")).toBeLessThan(roleRank("admin"));
    expect(roleRank("admin")).toBeLessThan(roleRank("owner"));
  });

  it("capPermission: viewer capped at view; others unchanged", () => {
    expect(capPermission("edit", "viewer")).toBe("view");
    expect(capPermission("edit", "member")).toBe("edit");
    expect(capPermission("edit", "admin")).toBe("edit");
    expect(capPermission("view", "member")).toBe("view");
  });
});

// ---------------------------------------------------------------------------
// resolveResourceOwner
// ---------------------------------------------------------------------------

describe("resolveResourceOwner", () => {
  it("resolves a document's direct owner", async () => {
    const db = fakeDb({ "documents:false": [[{ userId: OWNER }]] });
    expect(await resolveResourceOwner(db, "document", DOC)).toBe(OWNER);
  });

  it("returns null for a missing document (no existence oracle)", async () => {
    const db = fakeDb({ "documents:false": [[]] });
    expect(await resolveResourceOwner(db, "document", DOC)).toBeNull();
  });

  it("resolves an entity owner via the importer join", async () => {
    const db = fakeDb({ "entity_instances:true": [[{ userId: OWNER }]] });
    expect(await resolveResourceOwner(db, "entity", DOC)).toBe(OWNER);
  });

  it("returns null for a file (path-addressed, no DB owner row)", async () => {
    const db = fakeDb({});
    expect(await resolveResourceOwner(db, "file", DOC)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// effectiveSharedPermission
// ---------------------------------------------------------------------------

describe("effectiveSharedPermission", () => {
  it("null when no share grants anything", async () => {
    const db = fakeDb({ "resource_shares:false": [[]], "resource_shares:true": [[]] });
    expect(await effectiveSharedPermission(db, CALLER, "document", DOC)).toBeNull();
  });

  it("takes a direct-to-user share's permission as-is", async () => {
    const db = fakeDb({
      "resource_shares:false": [[{ permission: "edit" }]],
      "resource_shares:true": [[]],
    });
    expect(await effectiveSharedPermission(db, CALLER, "document", DOC)).toBe("edit");
  });

  it("caps a workspace share by the member's role (viewer -> view)", async () => {
    const db = fakeDb({
      "resource_shares:false": [[]],
      "resource_shares:true": [[{ permission: "edit", role: "viewer" }]],
    });
    expect(await effectiveSharedPermission(db, CALLER, "document", DOC)).toBe("view");
  });

  it("takes the STRONGEST across direct + workspace grants", async () => {
    const db = fakeDb({
      "resource_shares:false": [[{ permission: "view" }]],
      "resource_shares:true": [[{ permission: "edit", role: "member" }]],
    });
    expect(await effectiveSharedPermission(db, CALLER, "document", DOC)).toBe("edit");
  });
});

// ---------------------------------------------------------------------------
// assertCanAccess — the truth table
// ---------------------------------------------------------------------------

describe("assertCanAccess truth table", () => {
  it("OWNER: allowed for view AND edit (owner path short-circuits shares)", async () => {
    const view = fakeDb({ "documents:false": [[{ userId: CALLER }]] });
    await expect(
      assertCanAccess(view, CALLER, "document", DOC, "view"),
    ).resolves.toBeUndefined();

    const edit = fakeDb({ "documents:false": [[{ userId: CALLER }]] });
    await expect(
      assertCanAccess(edit, CALLER, "document", DOC, "edit"),
    ).resolves.toBeUndefined();
  });

  it("NOT-shared: denied (owner is someone else, no grants)", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[]],
    });
    await expect(
      assertCanAccess(db, CALLER, "document", DOC, "view"),
    ).rejects.toThrow(AccessError);
  });

  it("shared-to-user view: view allowed, edit denied", async () => {
    const ok = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[{ permission: "view" }]],
      "resource_shares:true": [[]],
    });
    await expect(
      assertCanAccess(ok, CALLER, "document", DOC, "view"),
    ).resolves.toBeUndefined();

    const denied = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[{ permission: "view" }]],
      "resource_shares:true": [[]],
    });
    await expect(
      assertCanAccess(denied, CALLER, "document", DOC, "edit"),
    ).rejects.toThrow(AccessError);
  });

  it("shared-to-user edit: edit allowed", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[{ permission: "edit" }]],
      "resource_shares:true": [[]],
    });
    await expect(
      assertCanAccess(db, CALLER, "document", DOC, "edit"),
    ).resolves.toBeUndefined();
  });

  it("shared-to-member-workspace: a member reads a workspace-shared doc", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[{ permission: "view", role: "member" }]],
    });
    await expect(
      assertCanAccess(db, CALLER, "document", DOC, "view"),
    ).resolves.toBeUndefined();
  });

  it("role-insufficient: a VIEWER cannot edit even on an edit-share", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[{ permission: "edit", role: "viewer" }]],
    });
    await expect(
      assertCanAccess(db, CALLER, "document", DOC, "edit"),
    ).rejects.toThrow(AccessError);
    // …but the same viewer CAN view.
    const view = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[{ permission: "edit", role: "viewer" }]],
    });
    await expect(
      assertCanAccess(view, CALLER, "document", DOC, "view"),
    ).resolves.toBeUndefined();
  });

  it("revoked: identical to not-shared (revoke = row delete -> no matching row)", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[]],
    });
    await expect(
      assertCanAccess(db, CALLER, "document", DOC, "view"),
    ).rejects.toThrow(AccessError);
  });

  it("AccessError carries { resourceType, resourceId, need }", async () => {
    const db = fakeDb({
      "documents:false": [[{ userId: OTHER }]],
      "resource_shares:false": [[]],
      "resource_shares:true": [[]],
    });
    try {
      await assertCanAccess(db, CALLER, "document", DOC, "edit");
      throw new Error("expected AccessError");
    } catch (e) {
      expect(e).toBeInstanceOf(AccessError);
      const err = e as AccessError;
      expect(err.resourceType).toBe("document");
      expect(err.resourceId).toBe(DOC);
      expect(err.need).toBe("edit");
    }
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceRole / assertWorkspaceRole
// ---------------------------------------------------------------------------

describe("workspace role helpers", () => {
  it("getWorkspaceRole returns the member's role, or null for a non-member", async () => {
    const member = fakeDb({ "workspace_members:false": [[{ role: "admin" }]] });
    expect(await getWorkspaceRole(member, WS, CALLER)).toBe("admin");

    const nonMember = fakeDb({ "workspace_members:false": [[]] });
    expect(await getWorkspaceRole(nonMember, WS, CALLER)).toBeNull();
  });

  it("assertWorkspaceRole resolves when rank >= min and returns the actual role", async () => {
    const db = fakeDb({ "workspace_members:false": [[{ role: "owner" }]] });
    expect(await assertWorkspaceRole(db, WS, CALLER, "admin")).toBe("owner");
  });

  it("assertWorkspaceRole throws for an under-ranked member (member < admin)", async () => {
    const db = fakeDb({ "workspace_members:false": [[{ role: "member" }]] });
    await expect(
      assertWorkspaceRole(db, WS, CALLER, "admin"),
    ).rejects.toThrow(WorkspaceRoleError);
  });

  it("assertWorkspaceRole throws for a non-member", async () => {
    const db = fakeDb({ "workspace_members:false": [[]] });
    await expect(
      assertWorkspaceRole(db, WS, CALLER, "viewer"),
    ).rejects.toThrow(WorkspaceRoleError);
  });
});
