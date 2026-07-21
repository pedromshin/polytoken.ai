import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPermissionBroker, type AskFn } from "../permissions/broker.js";
import { loadAllowlist } from "../permissions/store.js";
import { createAuditLog } from "../permissions/audit.js";
import { canonicalizePath, type CanonicalPath } from "../permissions/paths.js";
import type { DaemonConfig } from "../config.js";

/**
 * The broker is the ONE decision point. These tests pin the ORDER of its four steps with a spy —
 * the ordering IS the mitigation (T-65-06): an outside-roots path must never reach a prompt,
 * because a prompt normalizes an escape into something approvable.
 */

let tmp: string;
let rootDir: string;
let outsideDir: string;
let config: DaemonConfig;

const canon = (p: string): CanonicalPath => {
  const r = canonicalizePath(p);
  if (!r.ok) throw new Error(r.reason);
  return r.path;
};

const makeConfig = (over: Partial<DaemonConfig> = {}): DaemonConfig =>
  Object.freeze({
    version: 1,
    roots: [canon(rootDir)],
    watch: { root: canon(rootDir) },
    port: 0,
    permTimeoutMs: 30_000,
    exec: { defaultTimeoutMs: 30_000, maxOutputBytes: 1_048_576 },
    stateDir: tmp,
    ...over,
  }) as DaemonConfig;

const build = async (opts: { ask: AskFn; config?: DaemonConfig; file?: string }) => {
  const store = await loadAllowlist(opts.file ?? path.join(tmp, "allowlist.json"));
  const audit = createAuditLog(path.join(tmp, "audit.jsonl"));
  const cfg = opts.config ?? config;
  return { broker: createPermissionBroker({ config: cfg, store, ask: opts.ask, audit }), audit };
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-broker-")));
  rootDir = path.join(tmp, "root");
  outsideDir = path.join(tmp, "outside");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  config = makeConfig();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("decide() step order is LAW (T-65-06)", () => {
  it("OUTSIDE ROOTS -> deny(outside_roots) AND ask is NEVER invoked", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const { broker } = await build({ ask });

    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: path.join(outsideDir, "secret.txt"),
      pathsToCheck: [path.join(outsideDir, "secret.txt")],
    });

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("outside_roots");
    // The hard boundary is NOT promptable. If this spy ever fires, an escape became approvable.
    expect(ask).not.toHaveBeenCalled();
  });

  it("an outside-roots path is denied even when a remembered ALLOW rule would match it", async () => {
    // No allowlist rule, however broad, may grant a path outside roots.
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const file = path.join(tmp, "allowlist.json");
    const store = await loadAllowlist(file);
    await store.append({
      id: "broad",
      capabilityId: "fs.read",
      risk: "read",
      scope: outsideDir,
      decision: "allow",
      createdAt: new Date().toISOString(),
      origin: "seed",
    });

    const { broker } = await build({ ask, file });
    const target = path.join(outsideDir, "secret.txt");
    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
  });

  it("an unresolvable/hostile path -> deny WITHOUT asking", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const { broker } = await build({ ask });

    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: "C:\\roots\\a\\file.txt:hidden",
      pathsToCheck: ["C:\\roots\\a\\file.txt:hidden"],
    });

    expect(verdict.kind).toBe("deny");
    expect(ask).not.toHaveBeenCalled();
  });

  it("ANY outside path in a multi-path request denies the whole request", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const { broker } = await build({ ask });

    const verdict = await broker.decide({
      capabilityId: "git",
      risk: "write",
      scope: rootDir,
      pathsToCheck: [path.join(rootDir, "ok.txt"), path.join(outsideDir, "bad.txt")],
    });

    expect(verdict.kind).toBe("deny");
    expect(ask).not.toHaveBeenCalled();
  });

  it("matched ALLOW -> allow with NO ask", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: false, remember: false }));
    const file = path.join(tmp, "allowlist.json");
    const seed = await loadAllowlist(file);
    await seed.append({
      id: "a1",
      capabilityId: "fs.read",
      risk: "read",
      scope: canon(rootDir),
      decision: "allow",
      createdAt: new Date().toISOString(),
      origin: "seed",
    });

    const { broker } = await build({ ask, file });
    const target = path.join(rootDir, "x.txt");
    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });

    expect(verdict.kind).toBe("allow");
    expect(ask).not.toHaveBeenCalled();
  });

  it("matched DENY -> deny(permission_denied) with NO ask (an explicit no is not re-litigated)", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: false }));
    const file = path.join(tmp, "allowlist.json");
    const seed = await loadAllowlist(file);
    await seed.append({
      id: "d1",
      capabilityId: "fs.read",
      risk: "read",
      scope: canon(rootDir),
      decision: "deny",
      createdAt: new Date().toISOString(),
      origin: "seed",
    });

    const { broker } = await build({ ask, file });
    const target = path.join(rootDir, "x.txt");
    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("permission_denied");
    expect(ask).not.toHaveBeenCalled();
  });

  it("no rule -> ask invoked exactly once, carrying the descriptor's risk (INV-4)", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: false }));
    const { broker } = await build({ ask });
    const target = path.join(rootDir, "x.txt");

    await broker.decide({
      capabilityId: "fs.write",
      risk: "write",
      scope: target,
      pathsToCheck: [target],
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ tool: "fs.write", risk: "write" });
  });
});

describe("silence is never consent (T-65-09)", () => {
  it("ask resolving null -> deny(permission_timeout)", async () => {
    const { broker } = await build({ ask: async () => null });
    const target = path.join(rootDir, "x.txt");

    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("permission_timeout");
  });

  it("an ask that NEVER settles times out to deny, and leaves no open handle", async () => {
    vi.useFakeTimers();
    const { broker } = await build({
      ask: () => new Promise(() => {}), // never resolves — the hung-UI case
      config: makeConfig({ permTimeoutMs: 1_000 }),
    });
    const target = path.join(rootDir, "x.txt");

    const pending = broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });
    await vi.advanceTimersByTimeAsync(1_001);
    const verdict = await pending;

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("permission_timeout");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("a prompt answered in time does NOT leave its timer running", async () => {
    vi.useFakeTimers();
    const { broker } = await build({
      ask: async () => ({ allow: true, remember: false }),
      config: makeConfig({ permTimeoutMs: 30_000 }),
    });
    const target = path.join(rootDir, "x.txt");

    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: target,
      pathsToCheck: [target],
    });

    expect(verdict.kind).toBe("allow");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("remember — a click tonight is a standing grant tomorrow", () => {
  it("allow+remember: the rule is ON DISK before decide() returns, and a 2nd decide does not ask", async () => {
    const file = path.join(tmp, "allowlist.json");
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const { broker } = await build({ ask, file });
    const target = path.join(rootDir, "x.txt");
    const q = { capabilityId: "fs.read" as const, risk: "read" as const, scope: target, pathsToCheck: [target] };

    const verdict = await broker.decide(q);
    expect(verdict.kind).toBe("allow");

    // Persisted BEFORE the verdict returned — not on some later tick.
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as { rules: unknown[] };
    expect(onDisk.rules).toHaveLength(1);

    await broker.decide(q);
    expect(ask).toHaveBeenCalledTimes(1);

    // ...and a fresh daemon honors it (restart persistence, proven through the real file).
    const restarted = await build({ ask: vi.fn<AskFn>(async () => null), file });
    expect((await restarted.broker.decide(q)).kind).toBe("allow");
  });

  it("deny+remember persists a DENY rule that a later ask cannot override", async () => {
    const file = path.join(tmp, "allowlist.json");
    const ask = vi.fn<AskFn>(async () => ({ allow: false, remember: true }));
    const { broker } = await build({ ask, file });
    const target = path.join(rootDir, "x.txt");
    const q = { capabilityId: "fs.read" as const, risk: "read" as const, scope: target, pathsToCheck: [target] };

    expect((await broker.decide(q)).kind).toBe("deny");
    const second = await broker.decide(q);
    expect(second.kind).toBe("deny");
    if (second.kind === "deny") expect(second.code).toBe("permission_denied");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("allow WITHOUT remember: allowed now, but a second identical decide ASKS AGAIN", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: false }));
    const { broker } = await build({ ask });
    const target = path.join(rootDir, "x.txt");
    const q = { capabilityId: "fs.read" as const, risk: "read" as const, scope: target, pathsToCheck: [target] };

    expect((await broker.decide(q)).kind).toBe("allow");
    expect((await broker.decide(q)).kind).toBe("allow");
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("deny WITHOUT remember does not persist anything", async () => {
    const file = path.join(tmp, "allowlist.json");
    const { broker } = await build({ ask: async () => ({ allow: false, remember: false }), file });
    const target = path.join(rootDir, "x.txt");

    await broker.decide({ capabilityId: "fs.read", risk: "read", scope: target, pathsToCheck: [target] });
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("audit (T-65-08) — every verdict is recorded, nothing sensitive is", () => {
  it("writes exactly one parseable JSONL line per decide()", async () => {
    const { broker } = await build({ ask: async () => ({ allow: true, remember: false }) });
    const target = path.join(rootDir, "x.txt");

    await broker.decide({ capabilityId: "fs.read", risk: "read", scope: target, pathsToCheck: [target] });
    await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: path.join(outsideDir, "s.txt"),
      pathsToCheck: [path.join(outsideDir, "s.txt")],
    });

    const lines = fs
      .readFileSync(path.join(tmp, "audit.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const denial = JSON.parse(lines[1] as string) as Record<string, unknown>;
    expect(denial.verdict).toBe("deny");
    expect(denial.code).toBe("outside_roots");
  });

  it("no audit line contains the DAEMON_TOKEN (T-65-16)", async () => {
    const token = "super-secret-token-value-1234567890";
    process.env.DAEMON_TOKEN = token;
    try {
      const { broker } = await build({ ask: async () => ({ allow: true, remember: false }) });
      const target = path.join(rootDir, "x.txt");
      await broker.decide({ capabilityId: "fs.read", risk: "read", scope: target, pathsToCheck: [target] });

      const contents = fs.readFileSync(path.join(tmp, "audit.jsonl"), "utf8");
      expect(contents).not.toContain(token);
    } finally {
      delete process.env.DAEMON_TOKEN;
    }
  });

  it("records denials too — a repudiation-proof trail is mostly the refusals", async () => {
    const { broker } = await build({ ask: async () => null });
    const target = path.join(rootDir, "x.txt");
    await broker.decide({ capabilityId: "fs.read", risk: "read", scope: target, pathsToCheck: [target] });

    const line = JSON.parse(
      fs.readFileSync(path.join(tmp, "audit.jsonl"), "utf8").trim(),
    ) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "decision", verdict: "deny", code: "permission_timeout" });
    expect(typeof line.ts).toBe("string");
  });
});

describe("the /capabilities allowlist kill-switch (STEP 2.5) — enforcement", () => {
  it("a DISABLED capability is denied WITHOUT prompting (never even asks)", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: false }));
    const file = path.join(tmp, "allowlist.json");
    let store = await loadAllowlist(file);
    store = await store.setCapabilityEnabled("fs.read", false); // user flipped it off in the panel

    const { broker } = await build({ ask, file });
    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: path.join(rootDir, "ok.txt"), // INSIDE roots — so only the kill-switch can deny it
      pathsToCheck: [path.join(rootDir, "ok.txt")],
    });

    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") expect(verdict.code).toBe("permission_denied");
    // The crux: a disabled capability short-circuits before the prompt. If this fires, the toggle is cosmetic.
    expect(ask).not.toHaveBeenCalled();
  });

  it("an ENABLED (default) capability still flows to the normal ask path", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: false }));
    const { broker } = await build({ ask });
    const verdict = await broker.decide({
      capabilityId: "fs.read",
      risk: "read",
      scope: path.join(rootDir, "ok.txt"),
      pathsToCheck: [path.join(rootDir, "ok.txt")],
    });
    expect(verdict.kind).toBe("allow");
    expect(ask).toHaveBeenCalledTimes(1); // not short-circuited — enabled is the default
  });
})
