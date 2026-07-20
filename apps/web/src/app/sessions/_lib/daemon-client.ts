/**
 * Browser-side client seam for the daemon WS protocol (@polytoken/daemon-protocol).
 *
 * The daemon is a LOCAL companion process — ws://127.0.0.1:<port> (default 8787). Every
 * connection from this surface is client-side: the terminal stream never touches our servers.
 *
 * ## The auth seam, stated honestly
 *
 * The frozen contract authenticates with an `x-daemon-token` header checked at the HTTP
 * upgrade (apps/daemon/src/server/daemon.ts, T-65-11). A browser `WebSocket` cannot set
 * custom headers — that is a platform limitation, not a choice. This client therefore
 * presents the token as a `?token=` query parameter on the upgrade URL, which the daemon
 * does NOT accept yet. Until the daemon grows an additive browser-auth path (reading the
 * token from the query string at the same upgrade gate), a browser connection will be
 * rejected with 401 and surface here as "can't reach the daemon". The UI copy stays honest
 * about that ambiguity (not running vs. token rejected — the browser cannot tell them
 * apart; it sees only a failed connection).
 *
 * Frame validation is NOT hand-rolled: `decodeDaemonFrame` delegates to the protocol
 * package's `parseDaemonFrame` (the both-directions rule as a callable), and outbound
 * frames are only built for types legal client→daemon.
 */
import {
  parseDaemonFrame,
  type Envelope,
  type FrameResult,
  type DaemonToClientType,
  type ClientToDaemonType,
  type SessionAttachRequestPayload,
  type SessionInputPayload,
  type SessionListRequestPayload,
  type SessionResizePayload,
  type SessionStartRequestPayload,
} from "@polytoken/daemon-protocol";

export const DAEMON_DEFAULT_PORT = 8787;
export const DAEMON_HOST = "127.0.0.1";

/** localStorage keys — the token stays in this browser and is only ever sent to 127.0.0.1. */
export const DAEMON_TOKEN_STORAGE_KEY = "polytoken.daemon.token";
export const DAEMON_PORT_STORAGE_KEY = "polytoken.daemon.port";

export type DaemonConfig = {
  readonly token: string | null;
  readonly port: number;
};

/** Safe on the server (returns the unconfigured shape) — localStorage is feature-detected. */
export function readDaemonConfig(): DaemonConfig {
  if (typeof window === "undefined") return { token: null, port: DAEMON_DEFAULT_PORT };
  let token: string | null = null;
  let port = DAEMON_DEFAULT_PORT;
  try {
    token = window.localStorage.getItem(DAEMON_TOKEN_STORAGE_KEY);
    const rawPort = window.localStorage.getItem(DAEMON_PORT_STORAGE_KEY);
    if (rawPort !== null) {
      const parsed = Number.parseInt(rawPort, 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) port = parsed;
    }
  } catch {
    // Storage disabled (private mode etc.) — behave as unconfigured.
  }
  if (token !== null && token.trim().length === 0) token = null;
  return { token, port };
}

export function writeDaemonToken(token: string): void {
  try {
    window.localStorage.setItem(DAEMON_TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // Storage disabled — the caller's in-memory copy still works for this page-load.
  }
}

/** ws://127.0.0.1:<port>/?token=… — see the auth-seam note in the module header. */
export function buildDaemonUrl(config: DaemonConfig): string {
  const token = config.token ?? "";
  return `ws://${DAEMON_HOST}:${config.port}/?token=${encodeURIComponent(token)}`;
}

/** Envelope ids are opaque strings; uuid when available, a time-random fallback otherwise. */
export function newEnvelopeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The client→daemon payload map, typed so a frame for the wrong direction cannot compile. */
export type ClientPayloadByType = {
  "session.list": SessionListRequestPayload;
  "session.start": SessionStartRequestPayload;
  "session.attach": SessionAttachRequestPayload;
  "session.input": SessionInputPayload;
  "session.resize": SessionResizePayload;
};

export type EncodedFrame = {
  readonly id: string;
  readonly text: string;
};

/**
 * Build + serialize a client→daemon envelope. Returns the id so callers can correlate the
 * response (R-01: the daemon echoes id AND type).
 */
export function encodeClientFrame<T extends keyof ClientPayloadByType & ClientToDaemonType>(
  type: T,
  payload: ClientPayloadByType[T],
  id: string = newEnvelopeId(),
): EncodedFrame {
  const envelope: Envelope = { id, type, payload };
  return { id, text: JSON.stringify(envelope) };
}

/**
 * Parse a raw wire string a client received. Never throws — JSON failures and
 * direction/schema violations both come back Result-shaped (R-02).
 */
export function decodeDaemonFrame(rawText: string): FrameResult<DaemonToClientType> {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    return { ok: false, error: `frame is not valid JSON: ${(error as Error).message}` };
  }
  return parseDaemonFrame(raw);
}
