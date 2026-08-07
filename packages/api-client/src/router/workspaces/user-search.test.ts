/**
 * user-search.test.ts — enumeration + minimal-disclosure proofs for
 * `workspaces.searchUsers` (vLAUNCH W65).
 *
 * Asserts the posture documented in ./user-search.ts:
 *   - signed-out callers are UNAUTHORIZED (no read reached);
 *   - a sub-3-char query (post-trim) is rejected by Zod, no read reached;
 *   - CROSS-TENANT + MINIMAL COLUMNS: a caller with NO workspace relationship
 *     to anyone still gets exactly the projected sliver — the SELECT sent to
 *     the db asks for ONLY {id, email, name} from auth.users (never phone,
 *     timestamps, or the metadata blob), reads NO membership table, and is
 *     hard-capped at 10 rows;
 *   - ILIKE metacharacters in the term are escaped (escapeLikePattern).
 *
 * The fake db here CAPTURES what the procedure requests (projection keys,
 * source table, limit) rather than just replaying rows — the minimal-columns
 * assertion is about the query we emit, not about what a fake echoes back.
 */
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import type { SessionUser } from "../../trpc";
import { createCallerFactory, createTRPCRouter } from "../../trpc";
import { workspacesRouter } from "./index";
import {
  escapeLikePattern,
  USER_SEARCH_MAX_RESULTS,
  USER_SEARCH_MIN_QUERY,
} from "./user-search";

const CALLER: SessionUser = { id: "30000000-0000-0000-0000-000000000003" };

type Rows = ReadonlyArray<Record<string, unknown>>;

interface Captured {
  selects: number;
  projections: string[][];
  tables: string[];
  limits: number[];
}

/** A capturing fake: records projection keys, source tables, and limits. */
function capturingDb(rows: Rows): { db: never; captured: Captured } {
  const captured: Captured = {
    selects: 0,
    projections: [],
    tables: [],
    limits: [],
  };
  const chain: Record<string, unknown> = {
    from(t: unknown) {
      captured.tables.push(getTableName(t as never));
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit(n: number) {
      captured.limits.push(n);
      return chain;
    },
    then(res: (v: Rows) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(rows).then(res, rej);
    },
  };
  const db = {
    select(fields: Record<string, unknown>) {
      captured.selects++;
      captured.projections.push(Object.keys(fields).sort());
      return chain;
    },
  } as never;
  return { db, captured };
}

const caller = (db: never, user: SessionUser | null) =>
  createCallerFactory(createTRPCRouter({ workspaces: workspacesRouter }))({
    db,
    user,
    headers: new Headers(),
  });

describe("workspaces.searchUsers — enumeration bounds", () => {
  it("a signed-out caller is UNAUTHORIZED and no read runs", async () => {
    const { db, captured } = capturingDb([]);
    await expect(
      caller(db, null).workspaces.searchUsers({ query: "alice" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(captured.selects).toBe(0);
  });

  it("a sub-3-char query is rejected (Zod) and no read runs", async () => {
    const { db, captured } = capturingDb([]);
    await expect(
      caller(db, CALLER).workspaces.searchUsers({ query: "al" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(captured.selects).toBe(0);
  });

  it("whitespace padding does not defeat the minimum-length gate", async () => {
    const { db, captured } = capturingDb([]);
    await expect(
      caller(db, CALLER).workspaces.searchUsers({ query: "  al   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(captured.selects).toBe(0);
  });

  it("an over-long query (>100 chars) is rejected", async () => {
    const { db, captured } = capturingDb([]);
    await expect(
      caller(db, CALLER).workspaces.searchUsers({ query: "a".repeat(101) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(captured.selects).toBe(0);
  });
});

describe("workspaces.searchUsers — cross-tenant minimal disclosure", () => {
  it("a caller with NO workspace relationship gets ONLY {id,email,name} from auth.users, capped at 10", async () => {
    const rows = [
      {
        id: "70000000-0000-0000-0000-000000000007",
        email: "alice@example.com",
        name: "Alice Doe",
      },
    ];
    const { db, captured } = capturingDb(rows);

    // CALLER shares no workspace with anyone — search is directory-wide by
    // design; the privileged act (addMember) stays behind admin+ RBAC.
    const out = await caller(db, CALLER).workspaces.searchUsers({
      query: "ali",
    });

    // Exactly one read, from auth.users only — NO membership/tenant table is
    // consulted, and none is leaked.
    expect(captured.selects).toBe(1);
    expect(captured.tables).toEqual(["users"]);

    // MINIMAL COLUMNS: the projection sent to the db is exactly id+email+name.
    expect(captured.projections).toEqual([["email", "id", "name"]]);

    // Hard cap at 10 rows per call.
    expect(captured.limits).toEqual([USER_SEARCH_MAX_RESULTS]);
    expect(USER_SEARCH_MAX_RESULTS).toBe(10);

    expect(out).toEqual(rows);
  });

  it("exposes the minimum-length constant the UI mirrors", () => {
    expect(USER_SEARCH_MIN_QUERY).toBe(3);
  });
});

describe("escapeLikePattern — ILIKE metacharacters cannot widen a match", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLikePattern("50%_off")).toBe("50\\%\\_off");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("%%%")).toBe("\\%\\%\\%");
  });

  it("leaves ordinary terms untouched", () => {
    expect(escapeLikePattern("alice@example.com")).toBe("alice@example.com");
  });
});
