/**
 * expose-only.test.ts — the machine-checked "never consume external MCP" mandate (MCPX-08).
 *
 * Track 7 is EXPOSE-ONLY: this package projects polytoken's own read capabilities outward and
 * must NEVER contain an MCP *client* or connect to any external MCP server (30–82% of public
 * MCP servers are exploitable; external tool descriptions must never enter polytoken's model).
 * This suite reads the package source from disk and fails if that invariant is ever violated —
 * so a future "let polytoken use external MCP tools" idea cannot silently land HERE.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_JSON = join(SRC_DIR, "..", "package.json");

/** All package source files except tests. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(SRC_DIR);

/**
 * Strip block + line comments so the guardrail checks real CODE, not prose. The doc comments
 * in this package deliberately DISCUSS `mcpServers` / the client transports they must never
 * use; scanning raw text would false-positive on that documentation.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Substrings that would betray an MCP client / external transport. */
const FORBIDDEN = [
  "@modelcontextprotocol/sdk/client",
  "StdioClientTransport",
  "SSEClientTransport",
  "StreamableHTTPClientTransport",
  "WebSocketClientTransport",
  "mcpServers",
] as const;

describe("expose-only guardrail — MCPX-08", () => {
  it("collects the package source (sanity: the scan is not empty)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
  });

  it("no source file imports an MCP client / external transport or declares mcpServers", () => {
    for (const file of SOURCE_FILES) {
      const text = stripComments(readFileSync(file, "utf8"));
      for (const needle of FORBIDDEN) {
        expect(
          text.includes(needle),
          `${file} contains forbidden expose-only violation "${needle}"`,
        ).toBe(false);
      }
    }
  });

  it("the SDK is imported ONLY in the stdio entrypoint (index.ts), and only its server side", () => {
    for (const file of SOURCE_FILES) {
      const text = stripComments(readFileSync(file, "utf8"));
      const importsSdk = text.includes("@modelcontextprotocol/sdk");
      // Normalize win32 backslash separators so the entrypoint check matches on Windows too.
      if (file.split(sep).join("/").endsWith("/index.ts")) {
        expect(importsSdk, "index.ts is the SDK entrypoint").toBe(true);
        // Only the SERVER surface — never a client subpath.
        expect(text).toContain("@modelcontextprotocol/sdk/server/");
        expect(text.includes("@modelcontextprotocol/sdk/client")).toBe(false);
      } else {
        // catalogue.ts / dispatch.ts / principal.ts stay SDK-free (tests run without the SDK).
        expect(importsSdk, `${file} must not import the MCP SDK`).toBe(false);
      }
    }
  });

  it("package.json declares no mcpServers and no MCP client dependency", () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, "utf8")) as {
      mcpServers?: unknown;
      dependencies?: Record<string, string>;
    };
    expect(pkg.mcpServers).toBeUndefined();
    // The SDK itself is a legitimate (server) dependency; assert no client-only package.
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toContain("@modelcontextprotocol/sdk");
    for (const dep of deps) {
      expect(dep.includes("mcp-client")).toBe(false);
    }
  });
});
