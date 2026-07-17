import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadAllowlist, type PermissionRule } from "../permissions/store.js";

/**
 * The allowlist is state that GRANTS POWER. Corruption or tolerance here is privilege, so the
 * suite is dominated by proofs of what it refuses and what it forgets (T-65-07).
 */

let tmp: string;
let file: string;

const rule = (over: Partial<PermissionRule> = {}): PermissionRule => ({
  id: "r1",
  capabilityId: "fs.read",
  risk: "read",
  scope: "C:\\roots\\a",
  decision: "allow",
  createdAt: "2026-07-17T00:00:00.000Z",
  origin: "perm.decision",
  ...over,
});

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-store-")));
  file = path.join(tmp, "allowlist.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("loadAllowlist — first run and round-trip", () => {
  it("starts EMPTY when the file does not exist (first run is not an error)", async () => {
    const store = await loadAllowlist(file);
    expect(store.rules).toEqual([]);
  });

  it("append persists, and a FRESH load sees the rule (survives restart)", async () => {
    const store = await loadAllowlist(file);
    await store.append(rule());

    const reloaded = await loadAllowlist(file);
    expect(reloaded.rules).toHaveLength(1);
    expect(reloaded.rules[0]?.capabilityId).toBe("fs.read");
    expect(reloaded.match({ capabilityId: "fs.read", scope: "C:\\roots\\a\\x.txt" })).toBe("allow");
  });

  it("append returns a NEW store and does not mutate the old one (immutability)", async () => {
    const store = await loadAllowlist(file);
    const next = await store.append(rule());
    expect(store.rules).toHaveLength(0);
    expect(next.rules).toHaveLength(1);
    expect(next).not.toBe(store);
  });

  it("writes atomically via tmp+rename, leaving no .tmp behind", async () => {
    const store = await loadAllowlist(file);
    await store.append(rule());
    const leftovers = fs.readdirSync(tmp).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("an orphaned .tmp from a crashed write is NOT loaded as state", async () => {
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ version: 1, rules: [rule({ decision: "allow" })] }),
    );
    const store = await loadAllowlist(file);
    expect(store.rules).toEqual([]);
  });
});

describe("fail CLOSED (T-65-07) — a corrupt store yields ZERO remembered allows", () => {
  it("corrupt JSON -> empty rules + a .corrupt-* backup, loudly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync(file, "{ this is not json");

    const store = await loadAllowlist(file);
    expect(store.rules).toEqual([]);

    const backups = fs.readdirSync(tmp).filter((f) => f.includes(".corrupt-"));
    expect(backups).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("schema-invalid contents -> empty rules + backup (not a partial salvage)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // One good rule, one garbage rule. A tolerant loader would keep the good one; that is the bug.
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, rules: [rule(), { capabilityId: "fs.read", decision: "yes" }] }),
    );

    const store = await loadAllowlist(file);
    expect(store.rules).toEqual([]);
    expect(fs.readdirSync(tmp).some((f) => f.includes(".corrupt-"))).toBe(true);
  });

  it("an unknown decision value cannot parse (closed enum)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync(file, JSON.stringify({ version: 1, rules: [rule({ decision: "maybe" as never })] }));
    expect((await loadAllowlist(file)).rules).toEqual([]);
  });

  it("a wrong file version cannot parse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync(file, JSON.stringify({ version: 2, rules: [] }));
    expect((await loadAllowlist(file)).rules).toEqual([]);
  });
});

describe("match — deny beats allow, and scope boundaries hold", () => {
  it("returns 'none' when no rule matches", async () => {
    const store = await loadAllowlist(file);
    expect(store.match({ capabilityId: "fs.read", scope: "C:\\roots\\a\\x" })).toBe("none");
  });

  it("DENY beats ALLOW for the same capability+scope, regardless of order", async () => {
    const store = await loadAllowlist(file);
    const withBoth = await (
      await store.append(rule({ id: "allow1", decision: "allow" }))
    ).append(rule({ id: "deny1", decision: "deny" }));
    expect(withBoth.match({ capabilityId: "fs.read", scope: "C:\\roots\\a\\x.txt" })).toBe("deny");

    // ...and with the append order reversed.
    const reversed = await (
      await (await loadAllowlist(path.join(tmp, "b.json"))).append(rule({ id: "deny1", decision: "deny" }))
    ).append(rule({ id: "allow1", decision: "allow" }));
    expect(reversed.match({ capabilityId: "fs.read", scope: "C:\\roots\\a\\x.txt" })).toBe("deny");
  });

  it("a rule for a DIFFERENT capability does not match", async () => {
    const store = await (await loadAllowlist(file)).append(rule({ capabilityId: "fs.read" }));
    expect(store.match({ capabilityId: "fs.write", scope: "C:\\roots\\a\\x.txt" })).toBe("none");
  });

  it("PREFIX COLLISION: a rule scoped C:\\roots\\a does NOT match C:\\roots\\abc\\x", async () => {
    const store = await (await loadAllowlist(file)).append(rule({ scope: "C:\\roots\\a" }));
    expect(store.match({ capabilityId: "fs.read", scope: "C:\\roots\\abc\\x.txt" })).toBe("none");
  });

  it("path scope matches the scope itself and anything beneath it", async () => {
    const store = await (await loadAllowlist(file)).append(rule({ scope: "C:\\roots\\a" }));
    expect(store.match({ capabilityId: "fs.read", scope: "C:\\roots\\a" })).toBe("allow");
    expect(store.match({ capabilityId: "fs.read", scope: "C:\\roots\\a\\deep\\x.txt" })).toBe("allow");
  });

  it("path scope is case-insensitive (win32)", async () => {
    const store = await (await loadAllowlist(file)).append(rule({ scope: "C:\\roots\\a" }));
    expect(store.match({ capabilityId: "fs.read", scope: "C:\\ROOTS\\A\\X.TXT" })).toBe("allow");
  });

  it("terminal.exec scope is a case-folded EXACT basename: 'node' matches 'NODE.EXE'", async () => {
    const store = await (await loadAllowlist(file)).append(
      rule({ capabilityId: "terminal.exec", risk: "exec", scope: "node" }),
    );
    expect(store.match({ capabilityId: "terminal.exec", scope: "NODE.EXE" })).toBe("allow");
    expect(store.match({ capabilityId: "terminal.exec", scope: "node" })).toBe("allow");
  });

  it("terminal.exec scope does NOT prefix-match: 'node' must not grant 'nodemon'", async () => {
    const store = await (await loadAllowlist(file)).append(
      rule({ capabilityId: "terminal.exec", risk: "exec", scope: "node" }),
    );
    expect(store.match({ capabilityId: "terminal.exec", scope: "nodemon" })).toBe("none");
    expect(store.match({ capabilityId: "terminal.exec", scope: "nodemon.exe" })).toBe("none");
  });
});
