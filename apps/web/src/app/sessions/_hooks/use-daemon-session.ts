"use client";

/**
 * useDaemonSession — the client-side WS hook for ONE attached session.
 *
 * Owns the socket lifecycle only; every state decision lives in the pure reducer
 * (`_lib/terminal-store.ts`). All traffic is validated both directions through the frozen
 * protocol package: outbound via `encodeClientFrame` (typed to client-legal frames),
 * inbound via `decodeDaemonFrame` → `parseDaemonFrame`. A frame that fails validation is
 * recorded as a protocol error and the stream continues (R-02 posture, client side).
 *
 * No automatic retry loop: reconnect is a user action with an honest disconnected state,
 * not a silent spinner. Scrollback survives reconnects — attach resumes with
 * `sinceSeq = sinceSeqForResume(state)` and the reducer drops replayed duplicates.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  buildDaemonUrl,
  decodeDaemonFrame,
  encodeClientFrame,
} from "../_lib/daemon-client";
import {
  initialTerminalState,
  sinceSeqForResume,
  terminalReducer,
  type TerminalState,
} from "../_lib/terminal-store";
import { useDaemonConfig, type DaemonConfigState } from "./use-daemon-config";

import type {
  SessionAttachResponsePayload,
  SessionExitEventPayload,
  SessionListResponsePayload,
  SessionOutputEventPayload,
} from "@polytoken/daemon-protocol";

export type DaemonSessionHandle = {
  readonly state: TerminalState;
  readonly config: DaemonConfigState;
  /** Send raw bytes to the pty (append "\n" yourself for a line). No-op when not live. */
  readonly sendInput: (data: string) => void;
  /** User-initiated reconnect from the disconnected state. */
  readonly reconnect: () => void;
};

export function useDaemonSession(sessionId: string): DaemonSessionHandle {
  const config = useDaemonConfig();
  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);

  const socketRef = useRef<WebSocket | null>(null);
  // The reducer's latest state, readable from socket callbacks without re-subscribing.
  const stateRef = useRef<TerminalState>(state);
  stateRef.current = state;

  // Key the socket lifecycle on PRIMITIVES: `config` is a fresh object every render, and
  // an object dep here would tear down and redial the socket per render.
  const { token, port } = config;

  const connect = useCallback(() => {
    if (token === null) return;
    // Drop any previous socket silently — this connect supersedes it.
    if (socketRef.current !== null) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
      socketRef.current = null;
    }

    dispatch({ kind: "connect" });

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildDaemonUrl({ token, port }));
    } catch (error) {
      dispatch({ kind: "socket-closed", detail: (error as Error).message });
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      dispatch({ kind: "socket-open" });
      const attach = encodeClientFrame("session.attach", {
        sessionId,
        ...(sinceSeqForResume(stateRef.current) !== undefined
          ? { sinceSeq: sinceSeqForResume(stateRef.current) }
          : {}),
      });
      socket.send(attach.text);
      // The attach ack carries no meta — ask the same socket for the registry row.
      socket.send(encodeClientFrame("session.list", {}).text);
    };

    socket.onmessage = (message: MessageEvent) => {
      const frame = decodeDaemonFrame(String(message.data));
      if (!frame.ok) {
        dispatch({ kind: "protocol-error", message: frame.error });
        return;
      }
      switch (frame.type) {
        case "session.attach": {
          const payload = frame.payload as SessionAttachResponsePayload;
          if (payload.sessionId === sessionId) {
            dispatch({ kind: "attach-ack", lastSeq: payload.lastSeq });
          }
          return;
        }
        case "session.output": {
          const payload = frame.payload as SessionOutputEventPayload;
          if (payload.sessionId === sessionId) {
            dispatch({ kind: "output", seq: payload.seq, data: payload.data });
          }
          return;
        }
        case "session.exit": {
          const payload = frame.payload as SessionExitEventPayload;
          if (payload.sessionId === sessionId) {
            dispatch({ kind: "exit", code: payload.code });
          }
          return;
        }
        case "session.list": {
          const payload = frame.payload as SessionListResponsePayload;
          const meta = payload.sessions.find((s) => s.sessionId === sessionId);
          if (meta !== undefined) dispatch({ kind: "meta", meta });
          return;
        }
        default:
          // Other daemon→client types (fs.watch.event, tool.result, perm.request) are
          // legal on the socket but not this surface's concern.
          return;
      }
    };

    socket.onclose = (event: CloseEvent) => {
      if (socketRef.current === socket) socketRef.current = null;
      dispatch({
        kind: "socket-closed",
        detail: event.reason.length > 0 ? event.reason : null,
      });
    };
    // onerror always precedes onclose in browsers; onclose carries the state change.
    socket.onerror = () => undefined;
  }, [token, port, sessionId]);

  useEffect(() => {
    if (!config.loaded || config.token === null) return;
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
    // Reconnect only when the target or the credentials change — not on every render.
  }, [config.loaded, config.token, config.port, sessionId, connect]);

  const sendInput = useCallback(
    (data: string) => {
      const socket = socketRef.current;
      if (socket === null || socket.readyState !== WebSocket.OPEN) return;
      socket.send(encodeClientFrame("session.input", { sessionId, data }).text);
    },
    [sessionId],
  );

  return { state, config, sendInput, reconnect: connect };
}
