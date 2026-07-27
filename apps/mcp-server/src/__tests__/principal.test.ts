/**
 * principal.test.ts — fail-closed single-principal resolution (MCPX-05).
 */
import { describe, expect, it } from "vitest";

import { resolveServerPrincipal } from "../principal";

const UUID = "10000000-0000-0000-0000-00000000000a";

describe("resolveServerPrincipal — MCPX-05 (fail-closed)", () => {
  it("resolves the principal when both secrets are present", () => {
    expect(
      resolveServerPrincipal({
        POLYTOKEN_MCP_USER_ID: UUID,
        POLYTOKEN_MCP_TOKEN: "local-secret",
      }),
    ).toEqual({ id: UUID });
  });

  it("throws when POLYTOKEN_MCP_USER_ID is missing", () => {
    expect(() =>
      resolveServerPrincipal({ POLYTOKEN_MCP_TOKEN: "local-secret" }),
    ).toThrow(/POLYTOKEN_MCP_USER_ID is required/);
  });

  it("throws when POLYTOKEN_MCP_TOKEN is missing", () => {
    expect(() =>
      resolveServerPrincipal({ POLYTOKEN_MCP_USER_ID: UUID }),
    ).toThrow(/POLYTOKEN_MCP_TOKEN is required/);
  });

  it("treats a blank/whitespace secret as missing (never boots with a null user)", () => {
    expect(() =>
      resolveServerPrincipal({ POLYTOKEN_MCP_USER_ID: "   ", POLYTOKEN_MCP_TOKEN: "x" }),
    ).toThrow(/POLYTOKEN_MCP_USER_ID is required/);
    expect(() =>
      resolveServerPrincipal({ POLYTOKEN_MCP_USER_ID: UUID, POLYTOKEN_MCP_TOKEN: "  " }),
    ).toThrow(/POLYTOKEN_MCP_TOKEN is required/);
  });

  it("never derives identity from anything but the two env secrets", () => {
    // A stray env field cannot become the principal — only POLYTOKEN_MCP_USER_ID is read.
    expect(
      resolveServerPrincipal({
        POLYTOKEN_MCP_USER_ID: UUID,
        POLYTOKEN_MCP_TOKEN: "local-secret",
        userId: "attacker",
      } as NodeJS.ProcessEnv),
    ).toEqual({ id: UUID });
  });
});
