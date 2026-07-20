import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

import { startDaemon, type DaemonHandle } from "../server/daemon.js";
import { canonicalizePath, type CanonicalPath } from "../permissions/paths.js";
import type { DaemonConfig } from "../config.js";
import type { Envelope } from "@polytoken/daemon-protocol";

/**
 * These tests drive a REAL in-process daemon (`startDaemon`, port 0) over a REAL `ws` client.
 * The central claim — "an unauthorized peer never gets a socket to send frames on" — cannot be
 * proven against a mocked socket: only an actual HTTP upgrade can demonstrate it.
 */

const TOKEN = "test-token-0123456789abcdef";
let tmp: string;
let config: DaemonConfig;
const openSockets: WebSocket[] = [];

const canon = (p: string): CanonicalPath => {
  const r = canonicalizePath(p);
  if (!r.ok) throw new Error(r.reason);
  return r.path;
};

/** Dial the daemon. Resolves on open, REJECTS on error — so a refused upgrade is a rejection. */
const dial = (port: number, headers: Record<string, string>): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    openSockets.push(socket);
    socket.on("open", () => resolve(socket));
    socket.on("error", (error: Error) => reject(error));
    socket.on("unexpected-response", (_req: unknown, res: { statusCode?: number }) =>
      reject(new Error(`unexpected-response ${res.statusCode}`)),
    );
  });

const send = (socket: WebSocket, envelope: Envelope): void => {
  socket.send(JSON.stringify(envelope));
};

/** Wait for the next frame matching a predicate, with a real timeout so a hang fails loudly. */
const nextFrame = (
  socket: WebSocket,
  match: (e: Envelope) => boolean,
  timeoutMs = 2_000,
): Promise<Envelope> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("timed out waiting for a matching frame"));
    }, timeoutMs);

    const onMessage = (data: unknown): void => {
      const envelope = JSON.parse(String(data)) as Envelope;
      if (!match(envelope)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(envelope);
    };
    socket.on("message", onMessage);
  });

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-router-")));
  fs.mkdirSync(path.join(tmp, "root"), { recursive: true });
  config = Object.freeze({
    version: 1,
    roots: [canon(path.join(tmp, "root"))],
    watch: { root: canon(path.join(tmp, "root")) },
    port: 0,
    permTimeoutMs: 30_000,
    exec: { defaultTimeoutMs: 30_000, maxOutputBytes: 1_048_576 },
    stateDir: tmp,
  }) as DaemonConfig;
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.terminate();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const withDaemon = async (fn: (handle: DaemonHandle) => Promise<void>): Promise<void> => {
  const handle = await startDaemon({ config, token: TOKEN });
  try {
    await fn(handle);
  } finally {
    await handle.close();
  }
};

describe("the bind (T-65-12) — the door does not exist on the network", () => {
  it("binds to 127.0.0.1 on an ephemeral port", async () => {
    await withDaemon(async (handle) => {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.address).toBe("127.0.0.1");
    });
  });

  it("is NOT reachable on the machine's LAN address", async () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (lan === undefined) return; // no LAN interface on this box; the loopback bind still holds

    await withDaemon(async (handle) => {
      await expect(
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`ws://${lan}:${handle.port}`, {
            headers: { "x-daemon-token": TOKEN },
          });
          openSockets.push(socket);
          socket.on("open", () => resolve("CONNECTED — the daemon is exposed to the network"));
          socket.on("error", reject);
        }),
      ).rejects.toThrow();
    });
  });
});

describe("upgrade-time auth (T-65-11) — the socket never opens", () => {
  it("REJECTS a connection with no token header", async () => {
    await withDaemon(async (handle) => {
      await expect(dial(handle.port, {})).rejects.toThrow();
    });
  });

  it("REJECTS a wrong token", async () => {
    await withDaemon(async (handle) => {
      await expect(dial(handle.port, { "x-daemon-token": "wrong-token-value-here-01" })).rejects.toThrow();
    });
  });

  it("REJECTS a near-miss token (last char flipped)", async () => {
    await withDaemon(async (handle) => {
      const near = `${TOKEN.slice(0, -1)}X`;
      await expect(dial(handle.port, { "x-daemon-token": near })).rejects.toThrow();
    });
  });

  it("a rejected peer is never registered as a client", async () => {
    await withDaemon(async (handle) => {
      await expect(dial(handle.port, {})).rejects.toThrow();
      expect(handle.registry.size).toBe(0);
    });
  });

  it("ACCEPTS the correct token and reaches open", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    });
  });
});

describe("upgrade-time auth via ?token= — the browser seam, same gate (T-65-11)", () => {
  /** Dial with a query string instead of headers — what a browser WebSocket can actually do. */
  const dialUrl = (port: number, query: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/${query}`);
      openSockets.push(socket);
      socket.on("open", () => resolve(socket));
      socket.on("error", (error: Error) => reject(error));
      socket.on("unexpected-response", (_req: unknown, res: { statusCode?: number }) =>
        reject(new Error(`unexpected-response ${res.statusCode}`)),
      );
    });

  it("ACCEPTS the correct token presented as ?token= (headerless, like a browser)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dialUrl(handle.port, `?token=${encodeURIComponent(TOKEN)}`);
      expect(socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  it("REJECTS a wrong ?token=", async () => {
    await withDaemon(async (handle) => {
      await expect(dialUrl(handle.port, "?token=wrong-token-value-here-01")).rejects.toThrow();
    });
  });

  it("REJECTS an empty ?token=", async () => {
    await withDaemon(async (handle) => {
      await expect(dialUrl(handle.port, "?token=")).rejects.toThrow();
    });
  });

  it("header keeps precedence — a WRONG header is rejected even with the right ?token=", async () => {
    await withDaemon(async (handle) => {
      await expect(
        new Promise((resolve, reject) => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${handle.port}/?token=${encodeURIComponent(TOKEN)}`,
            { headers: { "x-daemon-token": "wrong-token-value-here-01" } },
          );
          openSockets.push(socket);
          socket.on("open", resolve);
          socket.on("error", reject);
        }),
      ).rejects.toThrow();
    });
  });

  it("a rejected ?token= peer is never registered as a client", async () => {
    await withDaemon(async (handle) => {
      await expect(dialUrl(handle.port, "?token=nope-still-not-the-token")).rejects.toThrow();
      expect(handle.registry.size).toBe(0);
    });
  });
});

describe("dispatch — both-directions validation, socket survives garbage (R-02/T-65-13)", () => {
  it("round-trips session.list -> { sessions: [] } (honest empty, R-06)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      send(socket, { id: "e1", type: "session.list", payload: {} });

      const reply = await nextFrame(socket, (e) => e.id === "e1");
      expect(reply.type).toBe("session.list");
      expect(reply.payload).toEqual({ sessions: [] });
    });
  });

  it("a junk frame replies protocol_error and the socket STAYS OPEN", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      socket.send(JSON.stringify({ nope: 1 }));

      const reply = await nextFrame(socket, (e) => e.type === "tool.result");
      expect(reply.payload).toMatchObject({ ok: false, output: { code: "protocol_error" } });
      expect(socket.readyState).toBe(WebSocket.OPEN);

      // The proof that the socket is still usable: a valid request still answers.
      send(socket, { id: "e2", type: "session.list", payload: {} });
      const after = await nextFrame(socket, (e) => e.id === "e2");
      expect(after.payload).toEqual({ sessions: [] });
    });
  });

  it("non-JSON bytes do not kill the connection", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      socket.send("this is not json at all");

      const reply = await nextFrame(socket, (e) => e.type === "tool.result");
      expect(reply.payload).toMatchObject({ ok: false, output: { code: "protocol_error" } });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  it("recovers the envelope id so the error correlates (R-02)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      send(socket, { id: "e42", type: "session.list", payload: { bogus: true } });

      const reply = await nextFrame(socket, (e) => e.type === "tool.result");
      expect(reply.payload).toMatchObject({ requestId: "e42", ok: false });
    });
  });

  it("a client CANNOT forge a perm.request (direction enforcement, T-65-14)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      send(socket, {
        id: "e5",
        type: "perm.request",
        payload: { tool: "fs.read", args: {}, risk: "read" },
      });

      const reply = await nextFrame(socket, (e) => e.type === "tool.result");
      expect(reply.payload).toMatchObject({ ok: false, output: { code: "protocol_error" } });
    });
  });

  it("session.start is implemented and GATES an out-of-roots cwd (outside_roots, no spawn)", async () => {
    // The session manager (v2.0/E4) replaced the R-06 stub. A cwd outside the daemon's roots is
    // denied BEFORE the broker even prompts — the same boundary that guards every tool.
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      send(socket, { id: "e6", type: "session.start", payload: { cwd: "C:\\definitely\\outside\\roots" } });

      const reply = await nextFrame(socket, (e) => e.type === "tool.result");
      expect(reply.payload).toMatchObject({
        requestId: "e6",
        ok: false,
        output: { code: "outside_roots" },
      });
    });
  });

  it("an unknown perm.decision requestId is ignored (no throw, no crash)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      send(socket, {
        id: "e7",
        type: "perm.decision",
        payload: { requestId: "never-heard-of-it", allow: true, remember: true },
      });

      // The daemon must still be alive and answering.
      send(socket, { id: "e8", type: "session.list", payload: {} });
      const after = await nextFrame(socket, (e) => e.id === "e8");
      expect(after.payload).toEqual({ sessions: [] });
    });
  });
});

describe("Client.send — an unvalidatable outbound frame is a daemon bug, caught HERE (T-65-13)", () => {
  it("throws instead of transmitting a payload that fails daemonToClient", async () => {
    await withDaemon(async (handle) => {
      await dial(handle.port, { "x-daemon-token": TOKEN });
      await new Promise((r) => setTimeout(r, 50));

      const client = handle.registry.list()[0];
      expect(client).toBeDefined();
      // `sessions` must be an array — this is the shape Lane E's parser would choke on.
      expect(() => client?.send("session.list", "x1", { sessions: "not-an-array" })).toThrow();
    });
  });

  it("accepts a valid payload", async () => {
    await withDaemon(async (handle) => {
      await dial(handle.port, { "x-daemon-token": TOKEN });
      await new Promise((r) => setTimeout(r, 50));

      const client = handle.registry.list()[0];
      expect(() => client?.send("session.list", "x2", { sessions: [] })).not.toThrow();
    });
  });
});

describe("the ask loop — nobody to ask is an instant deny, not a hang (T-65-15)", () => {
  it("with ZERO clients, ask resolves null IMMEDIATELY (not after permTimeoutMs)", async () => {
    await withDaemon(async (handle) => {
      expect(handle.registry.size).toBe(0);

      const started = Date.now();
      const answer = await handle.ask({ tool: "fs.read", args: {}, risk: "read" });
      const elapsed = Date.now() - started;

      expect(answer).toBeNull();
      // The 30s permTimeoutMs must not be waited out for a decision that cannot come.
      expect(elapsed).toBeLessThan(100);
    });
  });

  it("a connected client receives perm.request and its decision resolves the ask", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      await new Promise((r) => setTimeout(r, 50));

      const pending = handle.ask({ tool: "fs.write", args: { path: "x" }, risk: "write" });
      const prompt = await nextFrame(socket, (e) => e.type === "perm.request");
      expect(prompt.payload).toMatchObject({ tool: "fs.write", risk: "write" });

      // R-03: the decision correlates to the perm.request ENVELOPE's id.
      send(socket, {
        id: "d1",
        type: "perm.decision",
        payload: { requestId: prompt.id, allow: true, remember: false },
      });

      expect(await pending).toEqual({ allow: true, remember: false });
    });
  });

  it("FIRST decision wins — a duplicate cannot flip an answered ask (T-65-14)", async () => {
    await withDaemon(async (handle) => {
      const socket = await dial(handle.port, { "x-daemon-token": TOKEN });
      await new Promise((r) => setTimeout(r, 50));

      const pending = handle.ask({ tool: "fs.write", args: {}, risk: "write" });
      const prompt = await nextFrame(socket, (e) => e.type === "perm.request");

      send(socket, {
        id: "d1",
        type: "perm.decision",
        payload: { requestId: prompt.id, allow: false, remember: false },
      });
      send(socket, {
        id: "d2",
        type: "perm.decision",
        payload: { requestId: prompt.id, allow: true, remember: true },
      });

      expect(await pending).toEqual({ allow: false, remember: false });
    });
  });
});

describe("close() — idempotent, no leaks", () => {
  it("can be called twice without throwing", async () => {
    const handle = await startDaemon({ config, token: TOKEN });
    await handle.close();
    await expect(handle.close()).resolves.not.toThrow();
  });

  it("refuses new connections after close", async () => {
    const handle = await startDaemon({ config, token: TOKEN });
    const port = handle.port;
    await handle.close();
    await expect(dial(port, { "x-daemon-token": TOKEN })).rejects.toThrow();
  });
});
