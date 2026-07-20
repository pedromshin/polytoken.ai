import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_CAPABILITIES,
  buildGitArgs,
  fsListCapability,
  fsReadCapability,
  fsWriteCapability,
  gitRiskFor,
  terminalExecCapability,
} from "../tools/capabilities.js";
import { createCapabilityRegistry } from "../tools/registry.js";
import { builtinRegistry, executeToolRequest } from "../tools/handler.js";
import { safeSpawn, scrubEnv } from "../tools/spawn.js";
import { createPermissionBroker, type AskFn } from "../permissions/broker.js";
import { loadAllowlist } from "../permissions/store.js";
import { createAuditLog } from "../permissions/audit.js";
import { canonicalizePath, type CanonicalPath } from "../permissions/paths.js";
import type { DaemonConfig } from "../config.js";
import type { Client } from "../server/clients.js";
import type { MsgType } from "@polytoken/daemon-protocol";

let tmp: string;
let rootDir: string;
let outsideDir: string;
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

const ctxWith = async (ask: AskFn) => {
  const store = await loadAllowlist(path.join(tmp, "allowlist.json"));
  const audit = createAuditLog(path.join(tmp, "audit.jsonl"));
  const broker = createPermissionBroker({ config, store, ask, audit });
  return { client, envelopeId: "env-1", broker, config, audit };
};

const allowAll: AskFn = async () => ({ allow: true, remember: false });
const denyAll: AskFn = async () => ({ allow: false, remember: false });

const lastResult = () => sent.filter((s) => s.type === "tool.result").at(-1)?.payload as {
  ok: boolean;
  output: Record<string, unknown>;
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-tools-")));
  rootDir = path.join(tmp, "root");
  outsideDir = path.join(tmp, "outside");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "secret.txt"), "TOP SECRET");
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

/**
 * INV-1/INV-2/INV-3: the descriptor shape is the Phase 68 contract. These are not style tests —
 * a missing field means Phase 68 adapts instead of imports.
 */
describe("the capability registry — the D2 seam (INV-1/2/3)", () => {
  it("every builtin declares the exact frozen descriptor field names", () => {
    for (const capability of BUILTIN_CAPABILITIES) {
      expect(capability).toHaveProperty("id");
      expect(capability).toHaveProperty("input");
      expect(capability).toHaveProperty("output");
      expect(capability).toHaveProperty("risk");
      expect(capability).toHaveProperty("cost");
      expect(capability).toHaveProperty("describe");
      expect(capability).toHaveProperty("source");
      expect(capability).toHaveProperty("trust");
    }
  });

  it("declares source/trust constants (INV-3: v2.3 populates, does not re-architect)", () => {
    for (const capability of BUILTIN_CAPABILITIES) {
      expect(capability.source).toBe("builtin");
      expect(capability.trust).toBe("first-party");
    }
  });

  it("every capability has a non-trivial describe (an LLM reads this to decide to call it)", () => {
    for (const capability of BUILTIN_CAPABILITIES) {
      expect(capability.describe.length).toBeGreaterThan(20);
    }
  });

  it("resolves by id — the registry is a lookup, not a switch", () => {
    expect(builtinRegistry.get("fs.read")?.id).toBe("fs.read");
    expect(builtinRegistry.get("terminal.exec")?.id).toBe("terminal.exec");
    expect(builtinRegistry.get("nope")).toBeUndefined();
    expect([...builtinRegistry.ids].sort()).toEqual(
      [
        "fs.list",
        "fs.read",
        "fs.write",
        "git",
        "terminal.exec",
        // v2.0: the browser capabilities are registry entries like everything else (INV-2)
        "browser.open",
        "browser.navigate",
        "browser.screenshot",
        "browser.click",
        "browser.type",
        "browser.close",
      ].sort(),
    );
  });

  it("list() is a describable projection that CANNOT execute (the outward-facing view)", () => {
    for (const entry of builtinRegistry.list()) {
      expect(entry).not.toHaveProperty("execute");
      expect(entry).toHaveProperty("describe");
      expect(entry).toHaveProperty("risk");
      expect(entry).toHaveProperty("cost");
    }
  });

  it("rejects duplicate ids (ambiguous resolution = a permission bug)", () => {
    expect(() => createCapabilityRegistry([fsReadCapability, fsReadCapability] as never)).toThrow(
      /duplicate/i,
    );
  });

  it("INV-4: risk is a DATA field on every descriptor", () => {
    expect(fsReadCapability.risk).toBe("read");
    expect(fsListCapability.risk).toBe("read");
    expect(fsWriteCapability.risk).toBe("write");
    expect(terminalExecCapability.risk).toBe("exec");
  });

  it("git risk derives from the input, purely (status reads, commit writes)", () => {
    expect(gitRiskFor("status")).toBe("read");
    expect(gitRiskFor("log")).toBe("read");
    expect(gitRiskFor("diff")).toBe("read");
    expect(gitRiskFor("add")).toBe("write");
    expect(gitRiskFor("commit")).toBe("write");
  });
});

describe("NO BYPASS: nothing executes without an allow verdict", () => {
  it("a DENIED fs.read does not read the file", async () => {
    const target = path.join(rootDir, "denied.txt");
    fs.writeFileSync(target, "you must not see this");
    const ctx = await ctxWith(denyAll);

    await executeToolRequest({ tool: "fs.read", args: { path: target } }, ctx);

    const result = lastResult();
    expect(result.ok).toBe(false);
    expect(result.output.code).toBe("permission_denied");
    expect(JSON.stringify(result)).not.toContain("you must not see this");
  });

  it("a DENIED fs.write does NOT create the file (the side effect never happens)", async () => {
    const target = path.join(rootDir, "never-created.txt");
    const ctx = await ctxWith(denyAll);

    await executeToolRequest({ tool: "fs.write", args: { path: target, content: "x" } }, ctx);

    expect(lastResult().ok).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("an OUTSIDE-ROOTS fs.read is denied outside_roots and never asks", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const ctx = await ctxWith(ask);

    await executeToolRequest(
      { tool: "fs.read", args: { path: path.join(outsideDir, "secret.txt") } },
      ctx,
    );

    const result = lastResult();
    expect(result.ok).toBe(false);
    expect(result.output.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("TOP SECRET");
  });

  it("a traversal escape (..\\) out of a root is denied", async () => {
    const ask = vi.fn<AskFn>(async () => ({ allow: true, remember: true }));
    const ctx = await ctxWith(ask);

    await executeToolRequest(
      { tool: "fs.read", args: { path: path.join(rootDir, "..", "outside", "secret.txt") } },
      ctx,
    );

    expect(lastResult().output.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
  });

  it("a timed-out permission ask denies and does not execute", async () => {
    const target = path.join(rootDir, "timeout.txt");
    const ctx = await ctxWith(async () => null);

    await executeToolRequest({ tool: "fs.write", args: { path: target, content: "x" } }, ctx);

    expect(lastResult().output.code).toBe("permission_timeout");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("an unknown capability id is not_implemented (no crash, no execution)", async () => {
    const ctx = await ctxWith(allowAll);
    await executeToolRequest({ tool: "fs.delete", args: { path: "x" } }, ctx);
    expect(lastResult().output.code).toBe("not_implemented");
  });

  it("args failing the capability's OWN schema are rejected before the broker", async () => {
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask);
    await executeToolRequest({ tool: "fs.read", args: { wrong: "shape" } }, ctx);
    expect(lastResult().output.code).toBe("invalid_args");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("fs capabilities — the happy paths actually work", () => {
  it("fs.read returns the content", async () => {
    const target = path.join(rootDir, "hello.txt");
    fs.writeFileSync(target, "hello daemon");
    const ctx = await ctxWith(allowAll);

    await executeToolRequest({ tool: "fs.read", args: { path: target } }, ctx);

    const result = lastResult();
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ kind: "fs.read", content: "hello daemon", truncated: false });
  });

  it("fs.write creates the file and reports bytes", async () => {
    const target = path.join(rootDir, "sub", "written.txt");
    const ctx = await ctxWith(allowAll);

    await executeToolRequest({ tool: "fs.write", args: { path: target, content: "abc" } }, ctx);

    expect(lastResult().ok).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("abc");
  });

  it("fs.list reports entries with kinds", async () => {
    fs.writeFileSync(path.join(rootDir, "a.txt"), "a");
    fs.mkdirSync(path.join(rootDir, "dir"));
    const ctx = await ctxWith(allowAll);

    await executeToolRequest({ tool: "fs.list", args: { path: rootDir } }, ctx);

    const entries = lastResult().output.entries as Array<{ name: string; kind: string }>;
    expect(entries.find((e) => e.name === "a.txt")?.kind).toBe("file");
    expect(entries.find((e) => e.name === "dir")?.kind).toBe("dir");
  });

  it("fs.read of a missing file is io_failure, not a crash", async () => {
    const ctx = await ctxWith(allowAll);
    await executeToolRequest({ tool: "fs.read", args: { path: path.join(rootDir, "ghost.txt") } }, ctx);
    expect(lastResult().output.code).toBe("io_failure");
  });

  it("fs.read truncates at maxOutputBytes and says so", async () => {
    const target = path.join(rootDir, "big.txt");
    fs.writeFileSync(target, "x".repeat(5_000));
    const small = { ...config, exec: { ...config.exec, maxOutputBytes: 1_024 } } as DaemonConfig;
    const ctx = { ...(await ctxWith(allowAll)), config: small };

    await executeToolRequest({ tool: "fs.read", args: { path: target } }, ctx);

    const result = lastResult();
    expect(result.output.truncated).toBe(true);
    expect(String(result.output.content)).toHaveLength(1_024);
    expect(result.output.bytes).toBe(5_000);
  });
});

/**
 * THE INJECTION PROOFS. The claim is not "we escape metacharacters" — it is "there is no shell,
 * so metacharacters are DATA". These tests prove the side effect never happens.
 */
describe("terminal.exec — args arrays, no shell, no injection (the sharpest edge)", () => {
  it("a shell metacharacter payload is INERT — it appears as a literal argv entry", async () => {
    const canary = path.join(rootDir, "pwned.txt");
    const injection = `hello & echo pwned > "${canary}"`;
    const ctx = await ctxWith(allowAll);

    await executeToolRequest(
      {
        tool: "terminal.exec",
        args: {
          cwd: rootDir,
          command: process.execPath, // node
          args: ["-e", "console.log(process.argv[1])", injection],
        },
      },
      ctx,
    );

    const result = lastResult();
    expect(result.ok).toBe(true);
    // The injection string came back as DATA...
    expect(String(result.output.stdout)).toContain("echo pwned");
    // ...and its side effect never happened.
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("a command with `&& calc` in its NAME does not execute a shell (spawn fails cleanly)", async () => {
    const ctx = await ctxWith(allowAll);
    await executeToolRequest(
      { tool: "terminal.exec", args: { cwd: rootDir, command: "definitely-not-a-real-cmd && calc", args: [] } },
      ctx,
    );
    // No shell = ENOENT on a nonsense binary, not a shell parsing it into two commands.
    const result = lastResult();
    expect(result.ok).toBe(true);
    expect(result.output.exitCode).toBeNull();
    expect(String(result.output.stderr)).toMatch(/ENOENT|not recognized|spawn/i);
  });

  it("a runaway process is KILLED at the timeout (T-65-09/DMON-03)", async () => {
    const ctx = await ctxWith(allowAll);

    const started = Date.now();
    await executeToolRequest(
      {
        tool: "terminal.exec",
        args: {
          cwd: rootDir,
          command: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"], // never exits on its own
          timeoutMs: 1_500,
        },
      },
      ctx,
    );
    const elapsed = Date.now() - started;

    const result = lastResult();
    expect(result.output.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });

  it("output is capped — a chatty child cannot exhaust memory", async () => {
    const small = { ...config, exec: { ...config.exec, maxOutputBytes: 2_048 } } as DaemonConfig;
    const ctx = { ...(await ctxWith(allowAll)), config: small };

    await executeToolRequest(
      {
        tool: "terminal.exec",
        args: {
          cwd: rootDir,
          command: process.execPath,
          args: ["-e", "for (let i = 0; i < 20000; i++) console.log('flooding the pipe');"],
        },
      },
      ctx,
    );

    const result = lastResult();
    expect(result.output.truncated).toBe(true);
    expect(String(result.output.stdout).length).toBeLessThanOrEqual(2_048);
  });

  it("the child NEVER inherits DAEMON_TOKEN (T-65-16)", async () => {
    process.env.DAEMON_TOKEN = "secret-token-must-not-leak-01";
    try {
      const ctx = await ctxWith(allowAll);
      await executeToolRequest(
        {
          tool: "terminal.exec",
          args: {
            cwd: rootDir,
            command: process.execPath,
            args: ["-e", "console.log(JSON.stringify(process.env.DAEMON_TOKEN ?? 'ABSENT'))"],
          },
        },
        ctx,
      );

      const result = lastResult();
      expect(String(result.output.stdout)).toContain("ABSENT");
      expect(String(result.output.stdout)).not.toContain("secret-token-must-not-leak-01");
    } finally {
      delete process.env.DAEMON_TOKEN;
    }
  });

  it("scrubEnv removes DAEMON_TOKEN and keeps everything else", () => {
    const scrubbed = scrubEnv({ DAEMON_TOKEN: "x", PATH: "/usr/bin", FOO: "bar" });
    expect(scrubbed.DAEMON_TOKEN).toBeUndefined();
    expect(scrubbed.PATH).toBe("/usr/bin");
    expect(scrubbed.FOO).toBe("bar");
  });

  it("safeSpawn never uses a shell (a metacharacter cannot spawn a second process)", async () => {
    const canary = path.join(rootDir, "spawned.txt");
    const result = await safeSpawn({
      command: process.execPath,
      args: ["-e", "console.log('ok')", `& echo x > ${canary}`],
      cwd: rootDir,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    expect(result.stdout).toContain("ok");
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("a cwd OUTSIDE roots is denied (roots bound the working directory)", async () => {
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask);

    await executeToolRequest(
      { tool: "terminal.exec", args: { cwd: outsideDir, command: process.execPath, args: ["-v"] } },
      ctx,
    );

    expect(lastResult().output.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
  });

  it("R-13: the executable itself may live outside roots (permitted by NAME, not by path)", async () => {
    // process.execPath is C:\Program Files\nodejs\node.exe — outside every root, by design.
    expect(canonicalizePath(process.execPath).ok).toBe(true);
    const ctx = await ctxWith(allowAll);

    await executeToolRequest(
      { tool: "terminal.exec", args: { cwd: rootDir, command: process.execPath, args: ["-e", "console.log(1)"] } },
      ctx,
    );

    expect(lastResult().ok).toBe(true);
  });

  it("the permission scope for terminal.exec is the executable NAME, not the cwd", () => {
    const scope = terminalExecCapability.scope({
      cwd: "C:\\r",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [],
    });
    expect(scope.scope).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(scope.pathsToCheck).toEqual(["C:\\r"]); // only the cwd is boundary-checked
  });
});

describe("git — safe argv construction", () => {
  it("puts `--` before pathspecs (a file named --foo is not an option)", () => {
    const args = buildGitArgs({ cwd: "C:\\r", subcommand: "diff", paths: ["--foo", "a.ts"] });
    expect(args).toContain("--");
    expect(args.indexOf("--")).toBeLessThan(args.indexOf("--foo"));
  });

  it("passes a commit message as its own argv entry (metacharacters are literal)", () => {
    const args = buildGitArgs({ cwd: "C:\\r", subcommand: "commit", message: "fix && rm -rf /" });
    expect(args).toEqual(["commit", "-m", "fix && rm -rf /"]);
  });

  it("refuses `git add` with no explicit paths (never a blanket stage)", () => {
    expect(() => buildGitArgs({ cwd: "C:\\r", subcommand: "add" })).toThrow(/explicit list/i);
  });

  it("refuses a commit with no message", () => {
    expect(() => buildGitArgs({ cwd: "C:\\r", subcommand: "commit" })).toThrow(/message/i);
  });

  it("git add pathspecs are boundary-checked — `..` cannot stage outside the roots", async () => {
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask);

    await executeToolRequest(
      { tool: "git", args: { cwd: rootDir, subcommand: "add", paths: ["..\\outside\\secret.txt"] } },
      ctx,
    );

    expect(lastResult().output.code).toBe("outside_roots");
    expect(ask).not.toHaveBeenCalled();
  });

  it("git status runs against a REAL repo and reports porcelain output", async () => {
    // A real git repo, so this proves the argv actually works — not that a mock was called.
    const init = await safeSpawn({
      command: "git",
      args: ["init"],
      cwd: rootDir,
      timeoutMs: 15_000,
      maxOutputBytes: 65_536,
    });
    expect(init.exitCode).toBe(0);
    fs.writeFileSync(path.join(rootDir, "tracked.txt"), "hi");

    const ctx = await ctxWith(allowAll);
    await executeToolRequest({ tool: "git", args: { cwd: rootDir, subcommand: "status" } }, ctx);

    const result = lastResult();
    expect(result.ok).toBe(true);
    expect(result.output.exitCode).toBe(0);
    expect(String(result.output.stdout)).toContain("tracked.txt");
  });

  it("git status is risk 'read' and so does not ask for write permission", async () => {
    const ask = vi.fn<AskFn>(allowAll);
    const ctx = await ctxWith(ask);
    await safeSpawn({ command: "git", args: ["init"], cwd: rootDir, timeoutMs: 15_000, maxOutputBytes: 4_096 });

    await executeToolRequest({ tool: "git", args: { cwd: rootDir, subcommand: "status" } }, ctx);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ risk: "read" });
  });

  it("git commit is risk 'write' (INV-4: derived from data, not a call-site branch)", async () => {
    const ask = vi.fn<AskFn>(denyAll);
    const ctx = await ctxWith(ask);

    await executeToolRequest(
      { tool: "git", args: { cwd: rootDir, subcommand: "commit", message: "x" } },
      ctx,
    );

    expect(ask.mock.calls[0]?.[0]).toMatchObject({ risk: "write" });
  });
});

describe("audit — executions are recorded without contents", () => {
  it("records an execution line carrying no file content", async () => {
    const target = path.join(rootDir, "audited.txt");
    fs.writeFileSync(target, "SENSITIVE CONTENT HERE");
    const ctx = await ctxWith(allowAll);

    await executeToolRequest({ tool: "fs.read", args: { path: target } }, ctx);

    const audit = fs.readFileSync(path.join(tmp, "audit.jsonl"), "utf8");
    expect(audit).toContain("execution");
    expect(audit).toContain("fs.read");
    expect(audit).not.toContain("SENSITIVE CONTENT HERE");
  });
});
