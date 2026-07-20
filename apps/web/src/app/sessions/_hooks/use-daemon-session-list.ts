"use client";

/**
 * useDaemonSessionList — the client-side WS hook for the /sessions registry.
 *
 * One socket: `session.list` on open, `session.exit` events flip rows to ended live,
 * `session.start` responses are correlated by envelope id (R-01) and handed to the caller
 * (who navigates). Same honesty rules as the terminal hook: no silent retry loop, an
 * unreachable daemon is a first-class state the surface teaches from.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { buildDaemonUrl, decodeDaemonFrame, encodeClientFrame } from "../_lib/daemon-client";
import { useDaemonConfig, type DaemonConfigState } from "./use-daemon-config";

import type {
  SessionExitEventPayload,
  SessionListResponsePayload,
  SessionMeta,
} from "@polytoken/daemon-protocol";

export type SessionListPhase =
  /** Config not loaded yet, or no token saved. */
  | "idle"
  | "connecting"
  | "connected"
  /** Dial failed or the socket dropped — daemon not running, or the token was rejected. */
  | "unreachable";

export type DaemonSessionListHandle = {
  readonly phase: SessionListPhase;
  readonly sessions: readonly SessionMeta[];
  readonly config: DaemonConfigState;
  /** Ask the daemon to spawn a session; `onStarted` receives the new meta. */
  readonly startSession: (cwd: string, cmd?: string) => void;
  readonly reconnect: () => void;
};

export function useDaemonSessionList(
  onStarted?: (meta: SessionMeta) => void,
): DaemonSessionListHandle {
  const config = useDaemonConfig();
  const [phase, setPhase] = useState<SessionListPhase>("idle");
  const [sessions, setSessions] = useState<readonly SessionMeta[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingStartIdsRef = useRef<Set<string>>(new Set());
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;

  // Key the socket lifecycle on PRIMITIVES: `config` is a fresh object every render, and
  // an object dep here would tear down and redial the socket per render.
  const { token, port } = config;

  const connect = useCallback(() => {
    if (token === null) return;
    if (socketRef.current !== null) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
      socketRef.current = null;
    }

    setPhase("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildDaemonUrl({ token, port }));
    } catch {
      setPhase("unreachable");
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(encodeClientFrame("session.list", {}).text);
    };

    socket.onmessage = (message: MessageEvent) => {
      const frame = decodeDaemonFrame(String(message.data));
      if (!frame.ok) return; // R-02 posture: drop, keep the socket.
      switch (frame.type) {
        case "session.list": {
          const payload = frame.payload as SessionListResponsePayload;
          setSessions(payload.sessions);
          setPhase("connected");
          return;
        }
        case "session.start": {
          // R-01: the response echoes the request envelope id.
          if (pendingStartIdsRef.current.delete(frame.envelope.id)) {
            const meta = frame.payload as SessionMeta;
            setSessions((prev) => [meta, ...prev.filter((s) => s.sessionId !== meta.sessionId)]);
            onStartedRef.current?.(meta);
          }
          return;
        }
        case "session.exit": {
          const payload = frame.payload as SessionExitEventPayload;
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === payload.sessionId ? { ...s, alive: false } : s,
            ),
          );
          return;
        }
        default:
          return;
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      setPhase("unreachable");
    };
    socket.onerror = () => undefined;
  }, [token, port]);

  useEffect(() => {
    if (!config.loaded) return;
    if (config.token === null) {
      setPhase("idle");
      return;
    }
    connect();
    return () => {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket !== null) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [config.loaded, config.token, config.port, connect]);

  const startSession = useCallback((cwd: string, cmd?: string) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    const frame = encodeClientFrame("session.start", {
      cwd,
      ...(cmd !== undefined && cmd.length > 0 ? { cmd } : {}),
    });
    pendingStartIdsRef.current.add(frame.id);
    socket.send(frame.text);
  }, []);

  return { phase, sessions, config, startSession, reconnect: connect };
}
