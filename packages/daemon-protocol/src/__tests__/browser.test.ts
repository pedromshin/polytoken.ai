/**
 * Browser tool schemas (v2.0, additive module) — the frozen 5 stay byte-for-byte intact, the six
 * browser tools ride the SAME `tool.request` MsgType through the extended unions.
 */
import { describe, expect, it } from "vitest";

import {
  browserToolNameSchema,
  browserToolRequestSchema,
  browserToolOutputSchema,
  extendedToolRequestSchema,
  extendedToolOutputSchema,
  extendedToolResultSchema,
  parseClientFrame,
  parseDaemonFrame,
  toolRequestSchema,
  toolResultSchema,
} from "../index.js";

const BROWSER_NAMES = [
  "browser.open",
  "browser.navigate",
  "browser.screenshot",
  "browser.click",
  "browser.type",
  "browser.close",
] as const;

describe("the additive browser vocabulary", () => {
  it("names exactly the six browser tools", () => {
    expect(browserToolNameSchema.options).toEqual([...BROWSER_NAMES]);
  });

  it("every browser request parses through browserToolRequestSchema AND the extended union", () => {
    const requests = [
      { tool: "browser.open", args: { profileDir: "C:\\repo\\profile", headless: true } },
      { tool: "browser.open", args: { profileDir: "C:\\repo\\profile", cdpUrl: "http://127.0.0.1:9222" } },
      { tool: "browser.navigate", args: { url: "https://example.com" } },
      { tool: "browser.screenshot", args: { fullPage: true } },
      { tool: "browser.screenshot", args: {} },
      { tool: "browser.click", args: { selector: "#go" } },
      { tool: "browser.type", args: { selector: "input", text: "hi" } },
      { tool: "browser.close", args: {} },
    ];
    for (const request of requests) {
      expect(browserToolRequestSchema.safeParse(request).success).toBe(true);
      expect(extendedToolRequestSchema.safeParse(request).success).toBe(true);
    }
  });

  it("browser.navigate REJECTS file:// and other non-web schemes (no roots escape via URL)", () => {
    for (const url of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "ftp://x"]) {
      expect(
        browserToolRequestSchema.safeParse({ tool: "browser.navigate", args: { url } }).success,
      ).toBe(false);
    }
  });

  it("args are .strict() — a rider key cannot ride along (T-65-01)", () => {
    expect(
      browserToolRequestSchema.safeParse({
        tool: "browser.click",
        args: { selector: "#go", shell: true },
      }).success,
    ).toBe(false);
    expect(
      browserToolRequestSchema.safeParse({ tool: "browser.close", args: { force: true } }).success,
    ).toBe(false);
  });

  it("bounds hold: an oversized selector/text/url is rejected at the parser (T-65-02)", () => {
    expect(
      browserToolRequestSchema.safeParse({
        tool: "browser.click",
        args: { selector: "x".repeat(2_000) },
      }).success,
    ).toBe(false);
    expect(
      browserToolRequestSchema.safeParse({
        tool: "browser.type",
        args: { selector: "i", text: "x".repeat(20_000) },
      }).success,
    ).toBe(false);
    expect(
      browserToolRequestSchema.safeParse({
        tool: "browser.navigate",
        args: { url: `https://x.com/${"a".repeat(5_000)}` },
      }).success,
    ).toBe(false);
  });

  it("every browser output kind parses through the extended output union", () => {
    const outputs = [
      { kind: "browser.open", profileDir: "C:\\repo\\profile", attached: false },
      { kind: "browser.navigate", url: "https://example.com", title: "Example" },
      { kind: "browser.screenshot", base64: "aGk=", bytes: 2, truncated: false },
      { kind: "browser.click", selector: "#go" },
      { kind: "browser.type", selector: "input", chars: 2 },
      { kind: "browser.close", closed: true },
    ];
    for (const output of outputs) {
      expect(browserToolOutputSchema.safeParse(output).success).toBe(true);
      expect(extendedToolOutputSchema.safeParse(output).success).toBe(true);
    }
  });
});

describe("the frozen 5 are untouched", () => {
  const frozenRequests = [
    { tool: "fs.read", args: { path: "C:\\repo\\a.txt" } },
    { tool: "fs.write", args: { path: "C:\\repo\\a.txt", content: "x" } },
    { tool: "fs.list", args: { path: "C:\\repo" } },
    { tool: "terminal.exec", args: { cwd: "C:\\repo", command: "node", args: ["-v"] } },
    { tool: "git", args: { cwd: "C:\\repo", subcommand: "status" } },
  ];

  it("every frozen request still parses via the FROZEN schema and the extended union", () => {
    for (const request of frozenRequests) {
      expect(toolRequestSchema.safeParse(request).success).toBe(true);
      expect(extendedToolRequestSchema.safeParse(request).success).toBe(true);
    }
  });

  it("the frozen toolRequestSchema does NOT accept browser tools (the frozen enum is closed)", () => {
    expect(
      toolRequestSchema.safeParse({ tool: "browser.navigate", args: { url: "https://x.com" } })
        .success,
    ).toBe(false);
  });

  it("a frozen tool.result still parses via the FROZEN result schema and the extended one", () => {
    const result = {
      requestId: "r1",
      ok: true,
      output: { kind: "fs.read", content: "hi", bytes: 2, truncated: false },
    };
    expect(toolResultSchema.safeParse(result).success).toBe(true);
    expect(extendedToolResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("the wire — browser tools ride tool.request / tool.result", () => {
  it("a browser.navigate tool.request frame parses client→daemon", () => {
    const frame = parseClientFrame({
      id: "e1",
      type: "tool.request",
      payload: { tool: "browser.navigate", args: { url: "https://example.com" } },
    });
    expect(frame.ok).toBe(true);
  });

  it("a frozen fs.read tool.request frame STILL parses client→daemon (no regression)", () => {
    const frame = parseClientFrame({
      id: "e2",
      type: "tool.request",
      payload: { tool: "fs.read", args: { path: "C:\\repo\\a.txt" } },
    });
    expect(frame.ok).toBe(true);
  });

  it("a browser.screenshot tool.result frame parses daemon→client", () => {
    const frame = parseDaemonFrame({
      id: "e3",
      type: "tool.result",
      payload: {
        requestId: "e1",
        ok: true,
        output: { kind: "browser.screenshot", base64: "aGk=", bytes: 2, truncated: false },
      },
    });
    expect(frame.ok).toBe(true);
  });

  it("extendedToolResultSchema keeps the ok-iff-not-error refinement", () => {
    expect(
      extendedToolResultSchema.safeParse({
        requestId: "r1",
        ok: true,
        output: { kind: "error", code: "exec_failure", message: "boom" },
      }).success,
    ).toBe(false);
    expect(
      extendedToolResultSchema.safeParse({
        requestId: "r1",
        ok: false,
        output: { kind: "browser.close", closed: true },
      }).success,
    ).toBe(false);
  });

  it("a browser tool with frozen-tool args does not cross-parse (unions stay disjoint)", () => {
    expect(
      extendedToolRequestSchema.safeParse({
        tool: "browser.open",
        args: { path: "C:\\repo\\a.txt" },
      }).success,
    ).toBe(false);
  });
});
