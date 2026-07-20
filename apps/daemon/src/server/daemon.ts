/**
 * The daemon process: the only door into something that can read, write and execute on this PC.
 *
 * Two structural mitigations live here:
 * - **T-65-12 (the bind):** `HOST` is a LITERAL. The config schema has no `host` field and is
 *   `.strict()`, so a hostile config file cannot expose this daemon to the network. Tunneling is
 *   explicitly out of scope tonight.
 * - **T-65-11 (the gate):** auth happens at the HTTP UPGRADE. A rejected peer never obtains a
 *   WebSocket, so there is no socket for it to send frames on.
 */
import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { PermRequestPayload } from "@polytoken/daemon-protocol";

import type { DaemonConfig } from "../config.js";
import { createAuditLog, type AuditLog } from "../permissions/audit.js";
import { createPermissionBroker, type AskFn, type PermissionBroker } from "../permissions/broker.js";
import { loadAllowlist } from "../permissions/store.js";
import { isAuthorized, tokenFromUpgradeUrl } from "./auth.js";
import { createClient, createClientRegistry, type ClientRegistry } from "./clients.js";
import { createPendingAsks, createWsAsk } from "./ask.js";
import { createRouter, type Router } from "./router.js";
import { registerToolHandler } from "../tools/handler.js";
import { startWatcher, type Watcher } from "../watch/watcher.js";
import { createSessionManager } from "../sessions/manager.js";
import { registerSessionHandlers } from "../sessions/handlers.js";
import path from "node:path";

/**
 * R-07: the bind address is a literal, never config-driven, never 0.0.0.0.
 * Moving this into config, or widening it, is the regression that puts a terminal-executing
 * daemon on the LAN.
 */
const HOST = "127.0.0.1" as const;

/** T-65-15: a hostile frame must not be able to allocate unbounded memory. */
const MAX_PAYLOAD_BYTES = 1_048_576;

export type DaemonHandle = {
  readonly port: number;
  readonly address: string;
  readonly close: () => Promise<void>;
  readonly registry: ClientRegistry;
  readonly router: Router;
  readonly broker: PermissionBroker;
  readonly audit: AuditLog;
  /** Exposed for the smoke script + tests to drive the permission loop directly. */
  readonly ask: AskFn;
};

export const startDaemon = async (opts: {
  config: DaemonConfig;
  token: string;
  /** Set false in tests that do not need real file events. */
  watch?: boolean;
}): Promise<DaemonHandle> => {
  const { config, token } = opts;

  // Construction order matters: the permission core exists before anything can be dispatched.
  const audit = createAuditLog(path.join(config.stateDir, "audit.jsonl"));
  const store = await loadAllowlist(path.join(config.stateDir, "allowlist.json"));
  const pending = createPendingAsks();
  const registry = createClientRegistry();
  const ask = createWsAsk(registry, pending);
  const broker = createPermissionBroker({ config, store, ask, audit });
  const router = createRouter({ broker, config, audit });

  // The session manager (v2.0 / E4): persistent streamed shell sessions, every start exec-gated
  // through the same broker as terminal.exec. Registers session.list/start/attach/input/resize.
  const sessions = createSessionManager(config);
  registerSessionHandlers(router, sessions);

  // The client half of the ONE permission model.
  router.register("perm.decision", async (payload) => {
    const decision = payload as { requestId: string; allow: boolean; remember: boolean };
    pending.resolve(decision.requestId, { allow: decision.allow, remember: decision.remember });
  });

  // fs/terminal/git — resolved by registry id, every one routed through the broker (DMON-03).
  registerToolHandler(router);

  const httpServer = http.createServer((_req, res) => {
    // This is a WebSocket door, not an HTTP API. Say so without leaking anything.
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("Upgrade required\n");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on("upgrade", (request, socket: Duplex, head: Buffer) => {
    // T-65-11: THE GATE. Auth runs here, at the upgrade — NOT in a connection handler. Moving
    // this check after handleUpgrade would hand an unauthorized peer a live socket first.
    // Node lowercases incoming header names.
    const presented = request.headers["x-daemon-token"];
    const headerValue = Array.isArray(presented) ? undefined : presented;

    // Browser WebSockets cannot send headers, so /sessions presents `?token=` instead.
    // The header keeps precedence: when a header is presented, IT is the credential —
    // a wrong header is a rejection even if the query string carries the right token.
    // Both paths land in the same constant-time `isAuthorized`.
    const credential = headerValue ?? tokenFromUpgradeUrl(request.url);

    if (!isAuthorized(credential, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket: WebSocket) => {
    const client = createClient(socket);
    registry.add(client);

    socket.on("message", (data: unknown) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch (error) {
        // Not JSON at all — still answered, still non-fatal (R-02).
        console.error(`[daemon] dropped a non-JSON frame: ${(error as Error).message}`);
        client.send("tool.result", cryptoRandomId(), {
          requestId: "unknown",
          ok: false,
          output: { kind: "error", code: "protocol_error", message: "frame is not valid JSON" },
        });
        return;
      }
      void router.dispatch(client, raw);
    });

    socket.on("close", () => registry.remove(client.id));
    socket.on("error", (error: Error) => {
      console.error(`[daemon] socket error on ${client.id}: ${error.message}`);
      registry.remove(client.id);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, HOST, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("[daemon] could not determine the bound address");
  }

  const watcher: Watcher | null =
    opts.watch === false
      ? null
      : startWatcher({
          root: config.watch.root,
          registry,
          onError: (error) => console.error(`[daemon:watch] ${String(error)}`),
        });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return; // idempotent
    closed = true;

    pending.cancelAll(); // nothing hangs waiting for an answer that will never come
    sessions.closeAll(); // SIGKILL every live child so no shell outlives the daemon
    await watcher?.close();

    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return Object.freeze({
    port: address.port,
    address: address.address,
    close,
    registry,
    router,
    broker,
    audit,
    ask,
  });
};

const cryptoRandomId = (): string => globalThis.crypto.randomUUID();
