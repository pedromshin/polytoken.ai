/**
 * The daemon-tool bridge transport: a fake WebSocket drives the full loop — tool.request →
 * (optional perm.request → perm.decision) → tool.result — and the no-daemon / timeout paths.
 * These exercise the module singleton's connection logic directly (the hook is a thin wrapper).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── a controllable fake WebSocket ──
class FakeWS {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static last: FakeWS | null = null;
  readyState = FakeWS.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  private listeners: Record<string, Array<() => void>> = {};
  constructor(public url: string) {
    FakeWS.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  // test helpers
  open() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
    for (const fn of this.listeners.open ?? []) fn();
  }
  deliver(envelope: unknown) {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }
  lastEnvelope() {
    return JSON.parse(this.sent[this.sent.length - 1]!) as { id: string; type: string; payload: Record<string, unknown> };
  }
}

let useDaemonToolMod: typeof import("../use-daemon-tool");

beforeEach(async () => {
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
  window.localStorage.setItem("polytoken.daemon.token", "a-real-token-16chars");
  window.localStorage.setItem("polytoken.daemon.port", "8787");
  vi.resetModules();
  useDaemonToolMod = await import("../use-daemon-tool");
  useDaemonToolMod.__resetDaemonConnectionForTests();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const conn = () => {
  // Access the singleton via a call (the hook wraps the same instance).
  return useDaemonToolMod;
};

describe("no daemon configured", () => {
  it("with no token, a call resolves ok:false without opening a socket", async () => {
    window.localStorage.removeItem("polytoken.daemon.token");
    useDaemonToolMod.__resetDaemonConnectionForTests();
    // Drive one call through the module's connection by importing the hook's call path.
    // We use a throwaway React-free path: the hook returns call bound to the singleton.
    const { call } = harness();
    const r = await call("fs.read", { path: "C:\\x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no daemon/i);
    expect(FakeWS.last).toBeNull();
  });
});

describe("tool.request → tool.result correlation", () => {
  it("resolves a call with the output of the matching tool.result", async () => {
    const { call } = harness();
    const p = call("dir.list_tree", { path: "C:\\root" });
    FakeWS.last!.open();
    const env = FakeWS.last!.lastEnvelope();
    expect(env.type).toBe("tool.request");
    expect(env.payload).toEqual({ tool: "dir.list_tree", args: { path: "C:\\root" } });
    // Daemon answers, echoing the request id.
    FakeWS.last!.deliver({
      id: "srv-1",
      type: "tool.result",
      payload: { requestId: env.id, ok: true, output: { kind: "dir.list_tree", root: "C:\\root", entries: [], truncated: false } },
    });
    const r = await p;
    expect(r).toEqual({ ok: true, output: { kind: "dir.list_tree", root: "C:\\root", entries: [], truncated: false } });
  });

  it("a tool.result error resolves ok:false with the code", async () => {
    const { call } = harness();
    const p = call("fs.read", { path: "C:\\x" });
    FakeWS.last!.open();
    const env = FakeWS.last!.lastEnvelope();
    FakeWS.last!.deliver({
      id: "srv-2",
      type: "tool.result",
      payload: { requestId: env.id, ok: false, output: { kind: "error", code: "permission_denied", message: "denied" } },
    });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("permission_denied");
      expect(r.error).toBe("denied");
    }
  });
});

describe("permission loop", () => {
  it("surfaces perm.request and answers with a correlated perm.decision", async () => {
    const h = harness();
    const p = h.call("browser.navigate", { url: "https://example.com" });
    FakeWS.last!.open();
    const reqEnv = FakeWS.last!.lastEnvelope();

    // Daemon asks for permission (its own envelope id is the correlation key, R-03).
    h.deliver(() => FakeWS.last!.deliver({ id: "perm-env-1", type: "perm.request", payload: { tool: "browser.navigate", args: {}, risk: "write" } }));
    expect(h.pendingPermissions().map((x) => x.id)).toContain("perm-env-1");

    // Approve → a perm.decision correlated to the perm.request envelope id.
    h.resolvePermission("perm-env-1", true);
    const decision = FakeWS.last!.lastEnvelope();
    expect(decision.type).toBe("perm.decision");
    expect(decision.payload).toMatchObject({ requestId: "perm-env-1", allow: true });
    expect(h.pendingPermissions()).toHaveLength(0);

    // Then the tool.result arrives and resolves the original call.
    FakeWS.last!.deliver({ id: "srv-3", type: "tool.result", payload: { requestId: reqEnv.id, ok: true, output: { kind: "browser.navigate", url: "https://example.com", title: "Example" } } });
    const r = await p;
    expect(r.ok).toBe(true);
  });
});

/**
 * A tiny non-React harness around the singleton: mirrors what the hook exposes (status/call/
 * pendingPermissions/resolvePermission) by reading the module's connection through a dummy call.
 * We drive `call` directly and read pendingPermissions by re-subscribing.
 */
function harness() {
  return mountHook(useDaemonToolMod);
}

// Minimal React hook runner (renderHook-lite) using react's test act.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

function mountHook(mod: typeof import("../use-daemon-tool")) {
  let latest: import("../use-daemon-tool").UseDaemonTool;
  function Probe() {
    latest = mod.useDaemonTool();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    call: (t: string, a: unknown) => latest!.call(t, a),
    resolvePermission: (id: string, allow: boolean) => act(() => latest!.resolvePermission(id, allow)),
    pendingPermissions: () => latest!.pendingPermissions,
    tick: () => act(() => {}),
    // Run a frame-delivery inside act so the subscription-driven re-render commits synchronously.
    deliver: (fn: () => void) => act(() => fn()),
  };
}
