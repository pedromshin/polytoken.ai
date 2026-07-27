/**
 * dispatch.test.ts — tools/call → appRouter bridge (MCPX-03, MCPX-04, MCPX-06, MCPX-07).
 *
 * Strategy mirrors `search.test.ts` / `knowledge-user-scoping.test.ts`: `@polytoken/db/ownership`
 * is mocked at the module boundary (its allow/deny correctness lives in `ownership.test.ts`), and
 * the caller is built via the REAL `createCaller` from `@polytoken/api-client` over a queue-based
 * fake `ctx.db`. No `@modelcontextprotocol/sdk` is imported anywhere — dispatch is pure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return { ...actual, userOwnedImporterIds: vi.fn() };
});

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { createCaller } from "@polytoken/api-client";

import { getExposedTool } from "../catalogue";
import { dispatchTool } from "../dispatch";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER = "30000000-0000-0000-0000-000000000a01";
const KNOWLEDGE_ID = "80000000-0000-0000-0000-000000000001";

function knowledgeRow() {
  return {
    id: KNOWLEDGE_ID,
    title: "Landlord: Maria Silva",
    content: "Rent due on the 5th; deposit R$4000",
    scope: "sender",
    scope_ref_id: null,
    tier: "EXTRACTED",
    confidence: 0.9,
    sim: 0.7,
  };
}

type Rows = ReadonlyArray<Record<string, unknown>>;

/** Queue-based fake db: `execute` (knowledge RPC) has its own queue + call counter. */
function makeExecuteDb(executeQueue: Rows[]) {
  const executeCalls = { count: 0 };
  const queue = [...executeQueue];
  const db = {
    execute() {
      executeCalls.count += 1;
      return Promise.resolve(queue.shift() ?? []);
    },
  };
  return { db, executeCalls };
}

function makeCaller(db: unknown, user: { id: string } | null = USER) {
  return createCaller({ db: db as never, headers: new Headers(), user });
}

afterEach(() => {
  vi.mocked(userOwnedImporterIds).mockReset();
  vi.restoreAllMocks();
});

const KNOWLEDGE_TOOL = getExposedTool("polytoken.searchMyKnowledge")!;

// ---------------------------------------------------------------------------
// MCPX-03 — dispatch returns the SAME items as a direct createCaller call
// ---------------------------------------------------------------------------

describe("dispatchTool — MCPX-03 (parity with a direct createCaller call)", () => {
  it("polytoken.searchMyKnowledge returns the SAME items as caller.knowledge.search", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([IMPORTER]);

    // Two identically-seeded callers: one driven through dispatch, one called directly.
    const viaDispatch = makeExecuteDb([[knowledgeRow()]]);
    const direct = makeExecuteDb([[knowledgeRow()]]);

    const dispatched = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "landlord" },
      caller: makeCaller(viaDispatch.db),
    });

    const directResult = await makeCaller(direct.db).knowledge.search({
      query: "landlord",
      limit: 10,
    });

    expect(dispatched.isError).toBeUndefined();
    expect(dispatched.data).toEqual(directResult);
    // Result is surfaced as cited text carrying the node id.
    expect(dispatched.content[0]?.type).toBe("text");
    expect(dispatched.content[0]?.text).toContain(KNOWLEDGE_ID);
    expect(dispatched.content[0]?.text).toContain("Landlord: Maria Silva");
  });
});

// ---------------------------------------------------------------------------
// MCPX-04 — tenancy: identity from the server principal, empty + zero-query
// ---------------------------------------------------------------------------

describe("dispatchTool — MCPX-04 (tenancy fail-closed; identity never from input)", () => {
  it("an owner of no importers gets an empty result with ZERO unscoped queries", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([]);
    const { db, executeCalls } = makeExecuteDb([]);

    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "landlord" },
      caller: makeCaller(db),
    });

    expect(res.isError).toBeUndefined();
    expect(res.data).toEqual({ items: [] });
    // resolveListScope short-circuits: not a single knowledge RPC ran.
    expect(executeCalls.count).toBe(0);
  });

  it("identity comes from ctx.user, never from tool input (rogue fields are stripped)", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([]);
    const { db, executeCalls } = makeExecuteDb([]);

    // The agent tries to smuggle a different identity / a non-owned importer through args.
    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: {
        query: "landlord",
        userId: "attacker-id",
        importerId: "99999999-9999-9999-9999-999999999999",
      },
      caller: makeCaller(db),
    });

    // Scope was resolved for the SERVER PRINCIPAL's id — not the smuggled value.
    expect(userOwnedImporterIds).toHaveBeenCalledWith(expect.anything(), USER.id);
    expect(userOwnedImporterIds).not.toHaveBeenCalledWith(
      expect.anything(),
      "attacker-id",
    );
    // The stripped importerId never reached the procedure → still the empty owned path.
    expect(res.data).toEqual({ items: [] });
    expect(executeCalls.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MCPX-06 — a thrown TRPCError maps to a structured MCP error, never a crash
// ---------------------------------------------------------------------------

describe("dispatchTool — MCPX-06 (TRPCError → MCP error, never crash)", () => {
  it("UNAUTHORIZED (null principal) becomes isError content, not a rejection", async () => {
    // No db access happens — protectedProcedure throws before the resolver runs.
    const caller = makeCaller({}, null);

    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "landlord" },
      caller,
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("UNAUTHORIZED");
  });

  it("a resolver throw is caught and surfaced as an MCP error", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([IMPORTER]);
    const db = {
      execute() {
        throw new Error("trgm RPC missing on this DB");
      },
    };

    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "landlord" },
      caller: makeCaller(db),
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("trgm RPC missing");
  });
});

// ---------------------------------------------------------------------------
// MCPX-07 — args re-parsed before the caller runs
// ---------------------------------------------------------------------------

describe("dispatchTool — MCPX-07 (re-parse at the dispatch boundary)", () => {
  it("a malformed limit is rejected as an MCP error and never reaches the caller", async () => {
    const { db, executeCalls } = makeExecuteDb([[knowledgeRow()]]);
    const spy = vi.spyOn(db, "execute");

    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "landlord", limit: 999 }, // procedure/thin cap is 50
      caller: makeCaller(db),
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/limit/i);
    // Rejected BEFORE the caller ran — zero queries, ownership never consulted.
    expect(spy).not.toHaveBeenCalled();
    expect(executeCalls.count).toBe(0);
    expect(userOwnedImporterIds).not.toHaveBeenCalled();
  });

  it("a too-short query is rejected at the boundary", async () => {
    const { db } = makeExecuteDb([]);
    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: { query: "a" },
      caller: makeCaller(db),
    });
    expect(res.isError).toBe(true);
    expect(userOwnedImporterIds).not.toHaveBeenCalled();
  });

  it("missing args object is rejected, not passed through as undefined", async () => {
    const { db } = makeExecuteDb([]);
    const res = await dispatchTool({
      tool: KNOWLEDGE_TOOL,
      args: undefined,
      caller: makeCaller(db),
    });
    expect(res.isError).toBe(true);
  });
});
