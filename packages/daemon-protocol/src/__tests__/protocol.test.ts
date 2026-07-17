import { describe, expect, it } from "vitest";

import {
  MSG_TYPES,
  clientToDaemon,
  daemonToClient,
  envelopeSchema,
  fsWatchEventSchema,
  parseClientFrame,
  parseDaemonFrame,
  permDecisionSchema,
  sessionMetaSchema,
  sessionOutputEventSchema,
  toolRequestSchema,
  toolResultSchema,
  type ToolRequestPayload,
} from "../index.js";

/**
 * CONTRACT FIDELITY (T-65-04).
 *
 * The literals below are transcribed from LANE-CONTRACTS.md §"The daemon protocol contract" —
 * the frozen text — NOT from the source under test. That is the whole point: if a future edit
 * renames a MsgType or drops a SessionMeta field, this test goes red before the drift reaches
 * Lane E.
 */
describe("contract fidelity — frozen 2026-07-16", () => {
  it("MSG_TYPES is exactly the 12 frozen literals, in contract order", () => {
    expect([...MSG_TYPES]).toEqual([
      "session.list",
      "session.start",
      "session.attach",
      "session.output",
      "session.input",
      "session.resize",
      "session.exit",
      "fs.watch.event",
      "tool.request",
      "tool.result",
      "perm.request",
      "perm.decision",
    ]);
  });

  it("a 13th message type cannot parse", () => {
    expect(
      envelopeSchema.safeParse({ id: "a", type: "session.kill", payload: {} }).success,
    ).toBe(false);
  });

  const frozenSessionMeta = {
    sessionId: "s1",
    cwd: "C:\\repo",
    cmd: "claude",
    startedAt: "2026-07-17T00:00:00.000Z",
    alive: true,
  };

  it("SessionMeta parses the frozen five-field shape", () => {
    expect(sessionMetaSchema.safeParse(frozenSessionMeta).success).toBe(true);
  });

  it.each(Object.keys(frozenSessionMeta))(
    "SessionMeta REJECTS the shape with %s removed",
    (key) => {
      const partial: Record<string, unknown> = { ...frozenSessionMeta };
      delete partial[key];
      expect(sessionMetaSchema.safeParse(partial).success).toBe(false);
    },
  );

  it("SessionMeta REJECTS an extra key (strict — no smuggled fields)", () => {
    expect(
      sessionMetaSchema.safeParse({ ...frozenSessionMeta, pid: 1234 }).success,
    ).toBe(false);
  });
});

describe("envelope — negative parse proofs", () => {
  it("rejects a missing id", () => {
    expect(envelopeSchema.safeParse({ type: "session.list", payload: {} }).success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(
      envelopeSchema.safeParse({ id: "", type: "session.list", payload: {} }).success,
    ).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(
      envelopeSchema.safeParse({ id: "a", type: "session.kill", payload: {} }).success,
    ).toBe(false);
  });

  it("rejects an extra top-level key", () => {
    expect(
      envelopeSchema.safeParse({ id: "a", type: "session.list", payload: {}, ts: 1 }).success,
    ).toBe(false);
  });

  it("accepts the canonical frame", () => {
    expect(
      envelopeSchema.safeParse({ id: "a", type: "tool.request", payload: { any: "thing" } })
        .success,
    ).toBe(true);
  });
});

describe("tool.request — closed unions and strict args", () => {
  it("T-65-01: terminal.exec args carrying `shell: true` are REJECTED (strict)", () => {
    const result = toolRequestSchema.safeParse({
      tool: "terminal.exec",
      args: { cwd: "C:\\repo", command: "node", args: ["-v"], shell: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown tool (closed discriminated union)", () => {
    expect(toolRequestSchema.safeParse({ tool: "fs.delete", args: { path: "C:\\x" } }).success).toBe(
      false,
    );
  });

  it("rejects git subcommand `push` — not in tonight's slice (closed enum)", () => {
    expect(
      toolRequestSchema.safeParse({ tool: "git", args: { cwd: "C:\\repo", subcommand: "push" } })
        .success,
    ).toBe(false);
  });

  it("T-65-02: rejects a terminal args array of 65 strings (bounded at 64)", () => {
    expect(
      toolRequestSchema.safeParse({
        tool: "terminal.exec",
        args: { cwd: "C:\\repo", command: "node", args: Array.from({ length: 65 }, () => "x") },
      }).success,
    ).toBe(false);
  });

  it("T-65-02: rejects git paths of 257 entries (bounded at 256)", () => {
    expect(
      toolRequestSchema.safeParse({
        tool: "git",
        args: {
          cwd: "C:\\repo",
          subcommand: "add",
          paths: Array.from({ length: 257 }, () => "f.ts"),
        },
      }).success,
    ).toBe(false);
  });

  it("narrows on `tool` and defaults terminal args to []", () => {
    const parsed = toolRequestSchema.parse({
      tool: "terminal.exec",
      args: { cwd: "C:\\repo", command: "node" },
    });
    expect(parsed.tool).toBe("terminal.exec");
    if (parsed.tool === "terminal.exec") expect(parsed.args.args).toEqual([]);
  });
});

describe("tool.result — ok and output.kind cannot disagree", () => {
  it("rejects ok:true carrying an error output", () => {
    expect(
      toolResultSchema.safeParse({
        requestId: "r1",
        ok: true,
        output: { kind: "error", code: "io_failure", message: "nope" },
      }).success,
    ).toBe(false);
  });

  it("rejects ok:false carrying a success output", () => {
    expect(
      toolResultSchema.safeParse({
        requestId: "r1",
        ok: false,
        output: { kind: "fs.read", content: "hi", bytes: 2, truncated: false },
      }).success,
    ).toBe(false);
  });

  it("accepts the two coherent combinations", () => {
    expect(
      toolResultSchema.safeParse({
        requestId: "r1",
        ok: true,
        output: { kind: "fs.read", content: "hi", bytes: 2, truncated: false },
      }).success,
    ).toBe(true);
    expect(
      toolResultSchema.safeParse({
        requestId: "r1",
        ok: false,
        output: { kind: "error", code: "permission_denied", message: "denied" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown error code (closed enum)", () => {
    expect(
      toolResultSchema.safeParse({
        requestId: "r1",
        ok: false,
        output: { kind: "error", code: "kaboom", message: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("fs.watch.event / perm.decision / session.output — negative proofs", () => {
  it("rejects watch kind `rename` (closed enum)", () => {
    expect(
      fsWatchEventSchema.safeParse({ root: "C:\\r", path: "a/b.txt", kind: "rename" }).success,
    ).toBe(false);
  });

  it("accepts a root-relative forward-slash path (R-08)", () => {
    expect(
      fsWatchEventSchema.safeParse({ root: "C:\\r", path: "a/b.txt", kind: "add" }).success,
    ).toBe(true);
  });

  it("rejects perm.decision missing `remember`", () => {
    expect(permDecisionSchema.safeParse({ requestId: "r1", allow: true }).success).toBe(false);
  });

  it("rejects session.output with seq -1", () => {
    expect(
      sessionOutputEventSchema.safeParse({ sessionId: "s1", seq: -1, data: "x" }).success,
    ).toBe(false);
  });

  it("rejects session.output with a fractional seq", () => {
    expect(
      sessionOutputEventSchema.safeParse({ sessionId: "s1", seq: 1.5, data: "x" }).success,
    ).toBe(false);
  });
});

/**
 * DIRECTION PROOFS (T-65-03). The maps are partial by design: a client cannot forge a permission
 * prompt, and the daemon cannot emit a decision.
 */
describe("direction maps — spoofable types are structurally absent", () => {
  it("clientToDaemon has no perm.request / tool.result / session.output key", () => {
    expect("perm.request" in clientToDaemon).toBe(false);
    expect("tool.result" in clientToDaemon).toBe(false);
    expect("session.output" in clientToDaemon).toBe(false);
  });

  it("daemonToClient has no perm.decision / tool.request key", () => {
    expect("perm.decision" in daemonToClient).toBe(false);
    expect("tool.request" in daemonToClient).toBe(false);
  });

  it("parseClientFrame REJECTS a well-formed perm.request (client cannot fake a prompt)", () => {
    const result = parseClientFrame({
      id: "e1",
      type: "perm.request",
      payload: { tool: "fs.read", args: { path: "C:\\x" }, risk: "read" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not legal client→daemon");
  });

  it("parseDaemonFrame REJECTS a well-formed perm.decision", () => {
    const result = parseDaemonFrame({
      id: "e1",
      type: "perm.decision",
      payload: { requestId: "r1", allow: true, remember: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not legal daemon→client");
  });

  it("a valid tool.request round-trips through parseClientFrame, typed", () => {
    const result = parseClientFrame({
      id: "e1",
      type: "tool.request",
      payload: { tool: "fs.read", args: { path: "C:\\repo\\a.txt" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as ToolRequestPayload;
      expect(payload.tool).toBe("fs.read");
      expect(result.envelope.id).toBe("e1");
      expect(result.type).toBe("tool.request");
    }
  });
});

describe("helper contract — Result-shaped, never throws (R-02)", () => {
  it("a non-object returns { ok: false } without throwing", () => {
    expect(() => parseClientFrame("not json at all")).not.toThrow();
    const result = parseClientFrame("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid envelope");
  });

  it("a valid envelope with a junk payload returns { ok: false } with a recoverable id", () => {
    expect(() =>
      parseClientFrame({ id: "e9", type: "tool.request", payload: { tool: "nope" } }),
    ).not.toThrow();
    const result = parseClientFrame({ id: "e9", type: "tool.request", payload: { tool: "nope" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe("e9");
      expect(result.error).toContain("invalid tool.request payload");
    }
  });

  it("recovers the id from an otherwise-invalid envelope so the daemon can reply (R-02)", () => {
    const result = parseClientFrame({ id: "e7", type: "bogus", payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.id).toBe("e7");
  });

  it("null / undefined / arrays do not throw", () => {
    expect(() => parseDaemonFrame(null)).not.toThrow();
    expect(() => parseDaemonFrame(undefined)).not.toThrow();
    expect(() => parseDaemonFrame([1, 2, 3])).not.toThrow();
    expect(parseDaemonFrame(null).ok).toBe(false);
  });
});
