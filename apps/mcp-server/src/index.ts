/**
 * index.ts — the expose-only MCP server stdio entrypoint (Plan 77-02).
 *
 * The SEVENTH consumer of the capability registry (MASTER-PLAN Track 7): it projects the
 * READ side (`knowledge.search` / `entities.list` / `search.omnibox`) as MCP tools over
 * stdio, scoped to a single fixed server principal. Pedro adds one `mcpServers` entry to his
 * OWN Claude Code / desktop config and calls `polytoken.searchMyKnowledge` / `.listEntities`
 * / `.searchEverything`, getting grounded cited answers from his own owner-scoped graph — the
 * SAME reads the web app runs, through the SAME appRouter + createCaller factory.
 *
 * ## The single SDK seam
 *
 * This is the ONLY file in the package that imports `@modelcontextprotocol/sdk` — and it
 * imports ONLY the SERVER side (`server/index.js` + `server/stdio.js`). There is NO client /
 * external-server transport anywhere: this server EXPOSES, it never CONSUMES an external MCP
 * (MCPX-08, the Track-7 quarantine mandate — no untrusted external tool description ever
 * enters polytoken's own model). `catalogue.ts` / `dispatch.ts` / `principal.ts` stay
 * SDK-free so their tests run without the SDK installed.
 *
 * ## main() discipline (copied from apps/worker/src/index.ts)
 *
 *   - resolve required env (server principal) or THROW — fail closed, never boot null (MCPX-05);
 *   - build the tRPC context from the SERVER PRINCIPAL, never from tool input (MCPX-04);
 *   - wire Server + StdioServerTransport, then await the transport;
 *   - a fatal error logs loudly and `process.exit(1)`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import {
  buildCallToolResult,
  buildListToolsResult,
  callerForPrincipal,
} from "./handlers";
import { resolveServerPrincipal } from "./principal";

const SERVER_NAME = "polytoken";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  // Fail closed BEFORE any transport is wired — a missing secret must stop boot (MCPX-05).
  const principal = resolveServerPrincipal();

  // The acting identity is the SERVER PRINCIPAL — never a tool-input field (MCPX-04).
  // Context/caller construction lives in the pure `handlers` module so the identity
  // wiring is unit-tested; tenancy is enforced by the SAME `userOwnedImporterIds` +
  // `resolveListScope` the web procedures run through.
  const caller = callerForPrincipal(principal);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // tools/list — the registry projection (MCPX-01/02). Logic is SDK-free + tested;
  // the cast adapts the plain result to the SDK's ServerResult union (whose newer
  // task-augmented members the pure shape needn't know about) at this SDK boundary.
  server.setRequestHandler(
    ListToolsRequestSchema,
    () => buildListToolsResult() as ListToolsResult,
  );

  // tools/call — re-parse + dispatch to the owner-scoped procedure; never crash (MCPX-06/07).
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await buildCallToolResult({
      name: request.params.name,
      args: request.params.arguments,
      caller,
    });
    return result as CallToolResult;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("mcp_server_fatal", err);
  process.exit(1);
});
