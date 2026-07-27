/**
 * dispatch.ts — the `tools/call` → appRouter bridge (Plan 77-03).
 *
 * Flow for one MCP tool call:
 *   1. parse raw args against the tool's THIN presented schema;
 *   2. map onto full procedure args (server-defaults importerId/offset/sort);
 *   3. RE-PARSE against the procedure's OWN Zod schema — defense in depth (MCPX-07);
 *   4. invoke `caller[router][proc](args)` — the SAME owner-scoped procedure the web runs;
 *   5. map the typed result to MCP text content (cited items).
 *
 * Every failure mode is turned into a STRUCTURED MCP tool error (`isError: true`) — a thrown
 * `TRPCError` (UNAUTHORIZED / BAD_REQUEST), a Zod rejection, or any other throw is caught and
 * returned as content. `dispatchTool` NEVER rejects, so a bad call can never crash the stdio
 * server process (MCPX-06).
 *
 * PURITY: no `@modelcontextprotocol/sdk` import (MCPX-08). The `caller` is injected, and the
 * caller type is imported type-only, so this module carries no runtime dependency on the SDK
 * and its tests run with the SDK absent. `DispatchResult` is shaped to match the SDK's
 * `CallToolResult` ({ content, isError }) so `src/index.ts` can return it verbatim.
 */
import { TRPCError } from "@trpc/server";
import type { ZodError } from "zod";

import type { createCaller } from "@polytoken/api-client";

import type { ExposedTool } from "./catalogue";

/** The server-side caller object — `createCaller(ctx)`. */
export type AppCaller = ReturnType<typeof createCaller>;

export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

/** Shaped to match the MCP SDK `CallToolResult`. `data` carries the raw typed result. */
export interface DispatchResult {
  readonly content: McpTextContent[];
  readonly isError?: boolean;
  /** The raw caller result (used as MCP `structuredContent` + asserted by tests, MCPX-03). */
  readonly data?: unknown;
}

/** A dynamically-indexed view of the caller — procedures are `(input) => Promise<result>`. */
type CallerIndex = Record<string, Record<string, (input: unknown) => Promise<unknown>>>;

function textError(message: string): DispatchResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Compact a ZodError into a single human line for the MCP error payload. */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/** Map a thrown caller error to an MCP error message — TRPCError codes surface explicitly. */
function formatCallError(toolName: string, err: unknown): string {
  if (err instanceof TRPCError) {
    return `Tool ${toolName} failed: ${err.code}${err.message ? ` — ${err.message}` : ""}`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Tool ${toolName} failed: ${message}`;
}

/**
 * Render a typed procedure result as cited MCP text. The read procedures return either
 * `{ items: [...] }` (knowledge.search / entities.list) or `{ results: [...] }`
 * (search.omnibox); each item is cited by its `id` so the external agent can ground on it.
 */
export function formatCitedResult(toolName: string, result: unknown): string {
  const record = (result ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.items)
    ? (record.items as Array<Record<string, unknown>>)
    : Array.isArray(record.results)
      ? (record.results as Array<Record<string, unknown>>)
      : [];

  if (rows.length === 0) {
    return `${toolName}: no matching results in your workspace.`;
  }

  const lines = rows.map((row, index) => {
    const id = row.id !== undefined ? String(row.id) : "(no id)";
    const title =
      typeof row.title === "string" && row.title.length > 0
        ? row.title
        : typeof row.displayName === "string" && row.displayName.length > 0
          ? row.displayName
          : "(untitled)";
    const snippetSource =
      typeof row.content === "string"
        ? row.content
        : typeof row.subtitle === "string"
          ? row.subtitle
          : "";
    const snippet =
      snippetSource.length > 0
        ? ` — ${snippetSource.slice(0, 200)}${snippetSource.length > 200 ? "…" : ""}`
        : "";
    const kind = typeof row.kind === "string" ? `${row.kind} ` : "";
    return `${index + 1}. ${kind}${title} [id: ${id}]${snippet}`;
  });

  return `${toolName}: ${rows.length} result(s).\n${lines.join("\n")}`;
}

/**
 * dispatchTool — run one `tools/call`. Never throws; every failure is a structured MCP error.
 */
export async function dispatchTool(opts: {
  tool: ExposedTool;
  args: unknown;
  caller: AppCaller;
}): Promise<DispatchResult> {
  const { tool, args, caller } = opts;

  // 1. thin gate — the schema the agent was handed.
  const thin = tool.toolInputSchema.safeParse(args ?? {});
  if (!thin.success) {
    return textError(
      `Invalid arguments for ${tool.toolName}: ${formatZodError(thin.error)}`,
    );
  }

  // 2. map thin → full procedure args (server defaults importerId/offset/sort).
  const procArgs = tool.toProcedureArgs(thin.data as Record<string, unknown>);

  // 3. RE-PARSE against the procedure's own schema before the caller runs (MCPX-07).
  const parsed = tool.procedureInputSchema.safeParse(procArgs);
  if (!parsed.success) {
    return textError(
      `Invalid arguments for ${tool.toolName}: ${formatZodError(parsed.error)}`,
    );
  }

  // 4. invoke the SAME owner-scoped procedure the web app runs.
  try {
    const routerCaller = (caller as unknown as CallerIndex)[tool.dispatch.router];
    const proc = routerCaller?.[tool.dispatch.proc];
    if (typeof proc !== "function") {
      return textError(
        `Tool ${tool.toolName} is mis-wired: no procedure ${tool.dispatch.router}.${tool.dispatch.proc}.`,
      );
    }
    const result = await proc(parsed.data);
    // 5. cited text content + the raw result as structured data.
    return {
      content: [{ type: "text", text: formatCitedResult(tool.toolName, result) }],
      data: result,
    };
  } catch (err) {
    // MCPX-06: a thrown TRPCError (or anything else) becomes a structured MCP error.
    return textError(formatCallError(tool.toolName, err));
  }
}
