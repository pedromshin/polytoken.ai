/**
 * Browser capabilities (v2.0) — descriptor shape, registry resolution, arg validation, and the
 * full request→broker→execute flow with a FAKE playwright injected. No live browser anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  chromiumExecutablePath,
  createBrowserCapabilities,
  createBrowserSession,
  DEFAULT_CHROMIUM_EXECUTABLE,
  type Pw,
  type PwPage,
} from "../tools/browser.js";
import { createCapabilityRegistry } from "../tools/registry.js";
import { BUILTIN_CAPABILITIES } from "../tools/capabilities.js";
import { builtinRegistry, executeToolRequest } from "../tools/handler.js";
import { createPermissionBroker, type AskFn } from "../permissions/broker.js";
import { loadAllowlist } from "../permissions/store.js";
import { createAuditLog } from "../permissions/audit.js";
import { canonicalizePath, type CanonicalPath } from "../permissions/paths.js";
import type { DaemonConfig } from "../config.js";
import type { Client } from "../server/clients.js";
import type { MsgType } from "@polytoken/daemon-protocol";

const BROWSER_IDS = [
  "browser.open",
  "browser.navigate",
  "browser.screenshot",
  "browser.click",
  "browser.type",
  "browser.close",
] as const;

let tmp: string;
let rootDir: string;
let profileDir: string;
let outsideProfileDir: string;
let config: DaemonConfig;
let sent: Array<{ type: MsgType; payload: unknown }>;

const canon = (p: string): CanonicalPath => {
  const r = canonicalizePath(p);
  if (!r.ok) throw new Error(r.reason);
  return r.path;
};

const client: Client = {
  id: "test-client",
  send: (type, _id, payload) => sent.push({ type, payload }),
};

/** A fake playwright: records every call, drives no browser. */
const makeFakePw = (opts?: { screenshotBytes?: number; noContexts?: boolean }) => {
  const calls: string[] = [];
  const png = Buffer.alloc(opts?.screenshotBytes ?? 256, 0x50); // 'P', deterministic
  const page: PwPage = {
    goto: async (url) => {
      calls.push(`goto:${url}`);
    },
    url: () => "https://example.com/after",
    title: async () => "Example Title",
    click: async (selector) => {
      calls.push(`click:${selector}`);
    },
    fill: async (selector, value) => {
      calls.push(`fill:${selector}:${value}`);
    },
    screenshot: async () => {
      calls.push("screenshot");
      return new Uint8Array(png);
    },
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {
      calls.push("context.close");
    },
  };
  const browser = {
    contexts: () => (opts?.noContexts === true ? [] : [context]),
    close: async () => {
      calls.push("browser.close");
    },
  };
  const pw: Pw = {
    chromium: {
      launchPersistentContext: async (dir, launchOpts) => {
        calls.push(`launch:${dir}:headless=${launchOpts.headless}:exe=${launchOpts.executablePath}`);
        return context;
      },
      connectOverCDP: async (endpoint) => {
        calls.push(`cdp:${endpoint}`);
        return browser;
      },
    },
  };
  return { pw, calls, page };
};

const allowAll: AskFn = async () => ({ allow: true, remember: false });

const ctxWith = async (ask: AskFn, registry: ReturnType<typeof createCapabilityRegistry>) => {
  const store = await loadAllowlist(path.join(tmp, "allowlist.json"));
  const audit = createAuditLog(path.join(tmp, "audit.jsonl"));
  const broker = createPermissionBroker({ config, store, ask, audit });
  return { client, envelopeId: "env-1", broker, config, audit, registry };
};

const lastResult = () =>
  sent.filter((s) => s.type === "tool.result").at(-1)?.payload as {
    ok: boolean;
    output: Record<string, unknown>;
  };

/** A registry backed by a FRESH session + fake pw, plus the set's session for direct assertions. */
const makeSet = (opts?: Parameters<typeof makeFakePw>[0]) => {
  const fake = makeFakePw(opts);
  const session = createBrowserSession();
  const set = createBrowserCapabilities({
    session,
    loadPw: async () => fake.pw,
    env: {}, // no POLYTOKEN_CHROMIUM_PATH → the default executable path
  });
  const registry = createCapabilityRegistry([...BUILTIN_CAPABILITIES, ...set.capabilities]);
  return { ...fake, session, set, registry };
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-browser-")));
  rootDir = path.join(tmp, "root");
  profileDir = path.join(rootDir, "browser-profile");
  outsideProfileDir = path.join(tmp, "outside-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outsideProfileDir, { recursive: true });
  sent = [];
  config = Object.freeze({
    version: 1,
    roots: [canon(rootDir)],
    watch: { root: canon(rootDir) },
    port: 0,
    permTimeoutMs: 5_000,
    exec: { defaultTimeoutMs: 10_000, maxOutputBytes: 1_048_576 },
    stateDir: tmp,
  }) as DaemonConfig;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("descriptor shape — the Phase 68 contract holds for every browser capability", () => {
  const { set } = makeSet();

  it("every browser capability declares the exact frozen descriptor field names", () => {
    for (const capability of set.capabilities) {
      expect(capability).toHaveProperty("id");
      expect(capability).toHaveProperty("input");
      expect(capability).toHaveProperty("output");
      expect(capability).toHaveProperty("risk");
      expect(capability).toHaveProperty("cost");
      expect(capability).toHaveProperty("describe");
      expect(capability).toHaveProperty("source");
      expect(capability).toHaveProperty("trust");
      expect(capability.source).toBe("builtin");
      expect(capability.trust).toBe("first-party");
      expect(capability.describe.length).toBeGreaterThan(20);
    }
  });

  it("INV-4: risk is DATA — exec for open/close, write for navigate/click/type, read for screenshot", () => {
    const riskOf = (id: string) => set.capabilities.find((c) => c.id === id)?.risk;
    expect(riskOf("browser.open")).toBe("exec");
    expect(riskOf("browser.close")).toBe("exec");
    expect(riskOf("browser.navigate")).toBe("write");
    expect(riskOf("browser.click")).toBe("write");
    expect(riskOf("browser.type")).toBe("write");
    expect(riskOf("browser.screenshot")).toBe("read");
  });
});

describe("registry resolution — a lookup, never a switch (INV-2)", () => {
  it("the production builtinRegistry resolves all six browser ids", () => {
    for (const id of BROWSER_IDS) {
      expect(builtinRegistry.get(id)?.id).toBe(id);
    }
  });

  it("list() exposes the browser capabilities as a non-executable projection", () => {
    const entries = builtinRegistry.list().filter((e) => e.id.startsWith("browser."));
    expect(entries).toHaveLength(6);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("execute");
      expect(entry).toHaveProperty("risk");
    }
  });

  it("a fresh registry with builtin + browser capabilities has no duplicate-id collisions", () => {
    const { registry } = makeSet();
    expect([...registry.ids].filter((id) => id.startsWith("browser."))).toHaveLength(6);
  });
});

describe("arg validation — rejected against the capability's OWN schema, before the broker", () => {
  it("browser.open without profileDir is invalid_args and never asks", async () => {
    const { registry } = makeSet();
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask, registry);

    await executeToolRequest({ tool: "browser.open", args: { headless: true } }, ctx);

    expect(lastResult().output.code).toBe("invalid_args");
    expect(ask).not.toHaveBeenCalled();
  });

  it("browser.navigate rejects a file:// URL at the schema (no roots escape via URL bar)", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);

    await executeToolRequest(
      { tool: "browser.navigate", args: { url: "file:///etc/passwd" } },
      ctx,
    );

    expect(lastResult().output.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("browser.click rejects rider keys (.strict() everywhere, T-65-01)", async () => {
    const { registry } = makeSet();
    const ctx = await ctxWith(allowAll, registry);

    await executeToolRequest(
      { tool: "browser.click", args: { selector: "#go", shell: true } },
      ctx,
    );

    expect(lastResult().output.code).toBe("invalid_args");
  });

  it("browser.navigate with NO session open fails before the broker (scope() refuses)", async () => {
    const { registry } = makeSet();
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask, registry);

    await executeToolRequest(
      { tool: "browser.navigate", args: { url: "https://example.com" } },
      ctx,
    );

    const result = lastResult();
    expect(result.ok).toBe(false);
    expect(result.output.code).toBe("invalid_args");
    expect(String(result.output.message)).toMatch(/browser\.open/);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("broker integration — scope is the profile dir, and roots still bound it", () => {
  it("browser.open with a profileDir OUTSIDE roots is denied outside_roots, never asks, never launches", async () => {
    const { registry, calls } = makeSet();
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask, registry);

    await executeToolRequest(
      { tool: "browser.open", args: { profileDir: outsideProfileDir } },
      ctx,
    );

    expect(lastResult().output.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("browser.open surfaces risk 'exec' to the permission prompt", async () => {
    const { registry } = makeSet();
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask, registry);

    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ tool: "browser.open", risk: "exec" });
  });

  it("after open, every capability's scope() is the session's canonical profile dir", async () => {
    const { registry, set } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    const screenshot = set.capabilities.find((c) => c.id === "browser.screenshot");
    const scope = screenshot?.scope({} as never) as { scope: string; pathsToCheck: string[] };
    expect(scope.scope).toBe(canon(profileDir));
    expect(scope.pathsToCheck).toEqual([canon(profileDir)]);
  });

  it("screenshot asks at risk 'read' (INV-4 read straight off the descriptor)", async () => {
    const { registry } = makeSet();
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.screenshot", args: {} }, ctx);

    expect(ask.mock.calls.at(-1)?.[0]).toMatchObject({ tool: "browser.screenshot", risk: "read" });
  });
});

describe("the flow against a FAKE pw — open, navigate, screenshot, click, type, close", () => {
  it("open launches a persistent context with the default executable and reports attached=false", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);

    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    const result = lastResult();
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ kind: "browser.open", attached: false });
    expect(calls[0]).toContain("launch:");
    expect(calls[0]).toContain(`exe=${DEFAULT_CHROMIUM_EXECUTABLE}`);
    expect(calls[0]).toContain("headless=true");
  });

  it("open with cdpUrl ATTACHES instead of launching", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);

    await executeToolRequest(
      { tool: "browser.open", args: { profileDir, cdpUrl: "http://127.0.0.1:9222" } },
      ctx,
    );

    expect(lastResult().output).toMatchObject({ kind: "browser.open", attached: true });
    expect(calls[0]).toBe("cdp:http://127.0.0.1:9222");
    expect(calls.some((c) => c.startsWith("launch:"))).toBe(false);
  });

  it("a second open without close is refused (one session per daemon)", async () => {
    const { registry } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    const result = lastResult();
    expect(result.ok).toBe(false);
    expect(String(result.output.message)).toMatch(/already open/i);
  });

  it("navigate drives page.goto and reports url + title", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest(
      { tool: "browser.navigate", args: { url: "https://example.com/start" } },
      ctx,
    );

    expect(calls).toContain("goto:https://example.com/start");
    expect(lastResult().output).toMatchObject({
      kind: "browser.navigate",
      url: "https://example.com/after",
      title: "Example Title",
    });
  });

  it("screenshot returns base64 of the PNG bytes with truncated=false under the cap", async () => {
    const { registry } = makeSet({ screenshotBytes: 256 });
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.screenshot", args: {} }, ctx);

    const output = lastResult().output;
    expect(output.kind).toBe("browser.screenshot");
    expect(output.bytes).toBe(256);
    expect(output.truncated).toBe(false);
    expect(Buffer.from(String(output.base64), "base64")).toHaveLength(256);
  });

  it("screenshot bytes are CAPPED at maxOutputBytes and flagged truncated", async () => {
    const { registry } = makeSet({ screenshotBytes: 4_096 });
    const small = { ...config, exec: { ...config.exec, maxOutputBytes: 1_024 } } as DaemonConfig;
    const ctx = { ...(await ctxWith(allowAll, registry)), config: small };
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.screenshot", args: {} }, ctx);

    const output = lastResult().output;
    expect(output.truncated).toBe(true);
    expect(output.bytes).toBe(4_096);
    expect(Buffer.from(String(output.base64), "base64")).toHaveLength(1_024);
  });

  it("click and type reach the page with the literal selector/text (no interpolation anywhere)", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.click", args: { selector: "#submit" } }, ctx);
    await executeToolRequest(
      { tool: "browser.type", args: { selector: "input[name=q]", text: "hello & <world>" } },
      ctx,
    );

    expect(calls).toContain("click:#submit");
    expect(calls).toContain("fill:input[name=q]:hello & <world>");
    expect(lastResult().output).toMatchObject({ kind: "browser.type", chars: 15 });
  });

  it("close shuts the launched context, frees the slot, and a new open works", async () => {
    const { registry, calls, session } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);

    await executeToolRequest({ tool: "browser.close", args: {} }, ctx);

    expect(lastResult().output).toMatchObject({ kind: "browser.close", closed: true });
    expect(calls).toContain("context.close");
    expect(session.profileDir).toBeNull();
    expect(session.page).toBeNull();

    await executeToolRequest({ tool: "browser.open", args: { profileDir } }, ctx);
    expect(lastResult().ok).toBe(true);
  });

  it("close after a CDP attach disconnects the BROWSER, not a context it does not own", async () => {
    const { registry, calls } = makeSet();
    const ctx = await ctxWith(allowAll, registry);
    await executeToolRequest(
      { tool: "browser.open", args: { profileDir, cdpUrl: "http://127.0.0.1:9222" } },
      ctx,
    );

    await executeToolRequest({ tool: "browser.close", args: {} }, ctx);

    expect(calls).toContain("browser.close");
    expect(calls).not.toContain("context.close");
  });

  it("a CDP endpoint with no contexts fails cleanly and leaves the slot free", async () => {
    const { registry, session } = makeSet({ noContexts: true });
    const ctx = await ctxWith(allowAll, registry);

    await executeToolRequest(
      { tool: "browser.open", args: { profileDir, cdpUrl: "http://127.0.0.1:9222" } },
      ctx,
    );

    const result = lastResult();
    expect(result.ok).toBe(false);
    expect(String(result.output.message)).toMatch(/no browser context/i);
    expect(session.profileDir).toBeNull();
  });
});

describe("chromium executable resolution", () => {
  it("defaults to /opt/pw-browsers/chromium", () => {
    expect(chromiumExecutablePath({})).toBe("/opt/pw-browsers/chromium");
  });

  it("POLYTOKEN_CHROMIUM_PATH overrides the default", () => {
    expect(chromiumExecutablePath({ POLYTOKEN_CHROMIUM_PATH: "/usr/bin/chromium" })).toBe(
      "/usr/bin/chromium",
    );
  });

  it("an empty override falls back to the default", () => {
    expect(chromiumExecutablePath({ POLYTOKEN_CHROMIUM_PATH: "" })).toBe(
      DEFAULT_CHROMIUM_EXECUTABLE,
    );
  });
});
