/**
 * principal.ts — fixed single-principal resolution (Plan 77-02).
 *
 * A self-hosted stdio MCP server has no request cookie to derive identity from, so the
 * acting user is a FIXED server principal read from local secrets:
 *
 *   POLYTOKEN_MCP_USER_ID  — the owner's `auth.users` id (becomes ctx.user.id)
 *   POLYTOKEN_MCP_TOKEN    — a required local bearer secret (its mere presence is the gate;
 *                            single-principal by construction — there is nothing to compare
 *                            it against, but its ABSENCE must stop the server booting)
 *
 * Fail-closed (MCPX-05): if EITHER is missing/blank, resolution throws — mirroring
 * `apps/worker`'s "required env or throw" posture — so the server can never boot with a
 * null user and can never fall through to an unauthenticated context.
 *
 * The id is NEVER derived from tool input (MCPX-04 / the `trpc.ts` invariant "never reads
 * identity from procedure input"): tool calls carry only `{ query, limit }`. This module is
 * PURE (no `@modelcontextprotocol/sdk` import) so it is unit-testable with the SDK absent.
 */

/** The resolved server principal — the single identity every tool call acts as. */
export interface ServerPrincipal {
  readonly id: string;
}

const USER_ID_ENV = "POLYTOKEN_MCP_USER_ID";
const TOKEN_ENV = "POLYTOKEN_MCP_TOKEN";

/**
 * Resolve the server principal from env, failing closed on any missing secret.
 * @throws Error when POLYTOKEN_MCP_USER_ID or POLYTOKEN_MCP_TOKEN is absent/blank.
 */
export function resolveServerPrincipal(
  env: NodeJS.ProcessEnv = process.env,
): ServerPrincipal {
  const id = (env[USER_ID_ENV] ?? "").trim();
  const token = (env[TOKEN_ENV] ?? "").trim();

  if (id === "") {
    throw new Error(
      `${USER_ID_ENV} is required — the expose-only MCP server refuses to start without a ` +
        `fixed server principal (fail-closed, MCPX-05). Set it to the owner's user id.`,
    );
  }
  if (token === "") {
    throw new Error(
      `${TOKEN_ENV} is required — the expose-only MCP server refuses to start without its ` +
        `local bearer secret (fail-closed, MCPX-05).`,
    );
  }

  return { id };
}
