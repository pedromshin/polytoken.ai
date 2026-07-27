/**
 * handlers.test.ts — the PURE request-handling layer index.ts delegates to.
 *
 * This closes the gap the adversarial verify flagged: index.ts's tools/list shaping,
 * tools/call mapping, and — most importantly — the principal→context→caller identity
 * wiring were SDK-only and therefore untested. Those are now pure functions in
 * `handlers.ts`; index.ts is just `new Server` + transport. No SDK import here, so the
 * suite runs with the SDK absent. `@polytoken/db/ownership` is mocked at the boundary
 * (mirrors dispatch.test.ts) so the identity assertion needs no live DB — an owner of
 * no importers short-circuits before any query.
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

import { EXPOSED_TOOLS } from "../catalogue";
import {
  buildCallToolResult,
  buildListToolsResult,
  callerForPrincipal,
} from "../handlers";

const USER = { id: "10000000-0000-0000-0000-00000000000a" };

function makeCaller(db: unknown, user: { id: string } | null = USER) {
  return createCaller({ db: db as never, headers: new Headers(), user });
}

afterEach(() => {
  vi.mocked(userOwnedImporterIds).mockReset();
  vi.restoreAllMocks();
});

describe("buildListToolsResult — tools/list shaping (MCPX-01/02)", () => {
  it("projects every exposed tool as { name, description, inputSchema }", () => {
    const result = buildListToolsResult();
    expect(result.tools).toHaveLength(EXPOSED_TOOLS.length);
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      "polytoken.listEntities",
      "polytoken.searchEverything",
      "polytoken.searchMyKnowledge",
    ]);
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });
});

describe("buildCallToolResult — tools/call shaping (MCPX-06)", () => {
  it("an unknown tool name fails closed to a structured error (never throws)", async () => {
    const res = await buildCallToolResult({
      name: "polytoken.notARealTool",
      args: { query: "x" },
      caller: makeCaller({}),
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Unknown tool");
  });

  it("maps a successful dispatch to content + structuredContent", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([]);
    const res = await buildCallToolResult({
      name: "polytoken.searchMyKnowledge",
      args: { query: "landlord" },
      caller: makeCaller({ execute: () => Promise.resolve([]) }),
    });
    // Owner of no importers → empty items, surfaced as text + structuredContent, no error.
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ items: [] });
    expect(res.content[0]?.type).toBe("text");
  });

  it("a thrown TRPCError (UNAUTHORIZED) becomes isError content, never a rejection", async () => {
    const res = await buildCallToolResult({
      name: "polytoken.searchMyKnowledge",
      args: { query: "landlord" },
      caller: makeCaller({}, null), // null principal → protectedProcedure throws
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("UNAUTHORIZED");
  });
});

describe("callerForPrincipal — principal→context→caller identity wiring (MCPX-04)", () => {
  it("threads ONLY the server principal's id into ctx.user (never a tool field)", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValue([]);

    // Build the caller exactly the way index.ts does — from the fixed principal.
    const caller = callerForPrincipal({ id: USER.id });
    expect(typeof caller.knowledge.search).toBe("function");

    // Drive a real read through it; owner-of-no-importers short-circuits before any DB query.
    const res = await buildCallToolResult({
      name: "polytoken.searchMyKnowledge",
      args: { query: "landlord", userId: "attacker-id" }, // smuggled identity is ignored
      caller,
    });

    // Scope was resolved for the PRINCIPAL's id — proving createTRPCContext({ user: { id } })
    // threaded the principal, not a default/null and not the smuggled field. Assert on the
    // recorded call args (the 2nd arg is ctx.user.id) rather than a full toHaveBeenCalledWith,
    // since the injected ctx.db (1st arg) is env-dependent.
    const calls = vi.mocked(userOwnedImporterIds).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).toBe(USER.id);
      expect(call[1]).not.toBe("attacker-id");
    }
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ items: [] });
  });
});
