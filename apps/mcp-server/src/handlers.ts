/**
 * handlers.ts — the PURE (SDK-free) request-handling logic for the MCP server.
 *
 * The stdio entrypoint (`index.ts`) is the ONLY file that may import
 * `@modelcontextprotocol/sdk`; keeping the actual handler logic here — the
 * tools/list projection, the tools/call dispatch mapping, and the
 * principal→context construction — means the security-critical wiring is
 * unit-testable WITHOUT the SDK installed (MCPX-04/06/07 coverage), and `index.ts`
 * shrinks to nothing but `new Server(...)` + `setRequestHandler` + transport.
 */
import { createCaller, createTRPCContext } from "@polytoken/api-client";

import { EXPOSED_TOOLS, getExposedTool, type ExposedTool } from "./catalogue";
import { dispatchTool } from "./dispatch";
import type { ServerPrincipal } from "./principal";

/**
 * The MCP `content` block shape the handlers return (SDK-free structural type).
 * Kept as MUTABLE arrays/fields so the shapes are structurally assignable to the
 * SDK's `ServerResult` members (`ListToolsResult` / `CallToolResult`) at the
 * index.ts boundary — a `ReadonlyArray` would fail to match and fall through the
 * result union.
 */
export interface McpContentBlock {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpListToolsResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

/**
 * Build the tRPC context + caller for the FIXED server principal. The acting
 * identity is ALWAYS `principal.id` — never a tool-input field (MCPX-04). Kept
 * here (not inlined in index.ts) so a regression that dropped `user` or threaded
 * the wrong field is caught by a test, not shipped.
 */
export function callerForPrincipal(
  principal: ServerPrincipal,
): ReturnType<typeof createCaller> {
  const ctx = createTRPCContext({
    headers: new Headers(),
    user: { id: principal.id },
  });
  return createCaller(ctx);
}

/** tools/list — the registry projection (MCPX-01/02). */
export function buildListToolsResult(
  tools: readonly ExposedTool[] = EXPOSED_TOOLS,
): McpListToolsResult {
  return {
    tools: tools.map((tool) => ({
      name: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    })),
  };
}

/**
 * tools/call — re-parse + dispatch to the owner-scoped procedure; never throw
 * (MCPX-06/07). An unknown tool name fails closed to a structured error result
 * rather than crashing the process.
 */
export async function buildCallToolResult(params: {
  name: string;
  args: unknown;
  caller: ReturnType<typeof createCaller>;
}): Promise<McpToolResult> {
  const tool = getExposedTool(params.name);
  if (tool === undefined) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
      isError: true,
    };
  }
  const result = await dispatchTool({
    tool,
    args: params.args,
    caller: params.caller,
  });
  return {
    content: result.content,
    ...(result.isError ? { isError: true } : {}),
    ...(result.data !== undefined ? { structuredContent: result.data } : {}),
  };
}
