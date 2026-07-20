/**
 * The session manager — persistent, streamed shell sessions (v2.0 / VISION E4, the "Claude-Code-class
 * session scoped to a folder"). This is the runtime Lane E's frozen `session.*` protocol was shaped
 * for; it registers behind the router's `register()` seam and touches no router internals.
 *
 * ## Why this is safe (the same model that already gates terminal.exec — DMON-01/03, INV-4)
 *
 * A session is an interactive child process. Unlike `terminal.exec` (a single argv, `shell:false`,
 * no injection surface), a session's WHOLE PURPOSE is an interactive shell the user drives — so the
 * daemon does not try to sanitize what the user types into their own shell. The safety is at the
 * BOUNDARY, structural and non-negotiable:
 *
 * 1. **Localhost + token.** The WS is `127.0.0.1`-only and every connection passed the token gate
 *    at upgrade (T-65-11). Nothing off-box can open a session.
 * 2. **Roots-bounded cwd.** `session.start`'s `cwd` is canonicalized and run through the SAME
 *    permission broker as every tool — an `outside_roots` cwd dies before any spawn (R-13).
 * 3. **Explicit permission, no bypass.** `broker.decide({ risk: "exec" })` must return `allow`
 *    before a child is spawned; the prompt shows the user the cwd + program. A session is the
 *    highest-trust thing the daemon does, so it is gated exactly like `terminal.exec`, never below.
 * 4. **Secrets scrubbed.** The child never inherits `DAEMON_TOKEN` (`scrubEnv`) — a shell must not
 *    be handed the key to the gate.
 * 5. **Bounded.** `MAX_SESSIONS` caps concurrency and `SCROLLBACK_BYTES` caps each session's replay
 *    buffer, so a chatty or forked child cannot exhaust the daemon's memory.
 *
 * ## Pipe mode, honestly (the node-pty seam)
 *
 * `node-pty` needs native compilation and is deliberately NOT a dependency. So a session is a
 * `child_process` shell over stdio PIPES, not a true PTY: output streams and input is delivered,
 * but there is no terminal device — `session.resize` is accepted and recorded but cannot resize a
 * pipe, interactive full-screen programs (vim, top) will misbehave, and there is no job-control
 * signal path. The frozen protocol is unchanged; swapping `spawn` for `pty.spawn` here is the only
 * edit a future node-pty upgrade needs. The `/sessions` web surface already strips ANSI and renders
 * a scrollback `pre`, so it consumes this faithfully.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { SessionMeta } from "@polytoken/daemon-protocol";

import type { DaemonConfig } from "../config.js";
import type { AuditLog } from "../permissions/audit.js";
import type { PermissionBroker } from "../permissions/broker.js";
import { canonicalizePath, isInsideRoots, type CanonicalPath } from "../permissions/paths.js";
import { scrubEnv } from "../tools/spawn.js";
import type { Client } from "../server/clients.js";

/** At most this many live sessions at once — a forked shell farm cannot be spun up unbounded. */
const MAX_SESSIONS = 8;
/** Per-session replay buffer cap. Oldest output is dropped once this is exceeded (scrollback, not history). */
const SCROLLBACK_BYTES = 256_000;
/** A dead session's metadata lingers this long so a late `session.list` / `attach` sees it exit, then is reaped. */
const REAP_AFTER_EXIT_MS = 30_000;

/** The daemon's default interactive shell. `cmd` (a bare program name) overrides it. */
const defaultShell = (): string =>
  process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : (process.env.SHELL ?? "/bin/bash");

type OutputChunk = { readonly seq: number; readonly data: string };

type Session = {
  meta: { -readonly [K in keyof SessionMeta]: SessionMeta[K] };
  readonly child: ChildProcess;
  /** Monotonic, starts at 0 for the first chunk; -1 means nothing emitted yet. */
  seq: number;
  /** Recent output for reconnect replay, trimmed to SCROLLBACK_BYTES. */
  readonly buffer: OutputChunk[];
  bufferedBytes: number;
  readonly attached: Set<Client>;
  reapTimer: NodeJS.Timeout | null;
};

export type SessionStartResult =
  | { readonly ok: true; readonly meta: SessionMeta }
  | { readonly ok: false; readonly code: "outside_roots" | "permission_denied" | "permission_timeout" | "io_failure"; readonly message: string };

export type SessionManager = {
  start(
    payload: { cwd: string; cmd?: string },
    deps: { broker: PermissionBroker; audit: AuditLog },
  ): Promise<SessionStartResult>;
  /** Replay buffered output (seq > sinceSeq) to `client`, then live-stream. Returns lastSeq, or null if unknown. */
  attach(
    payload: { sessionId: string; sinceSeq?: number },
    client: Client,
    emit: (client: Client, chunk: OutputChunk) => void,
    exitEmit: (client: Client, code: number) => void,
  ): { ok: true; lastSeq: number } | { ok: false; message: string };
  input(payload: { sessionId: string; data: string }): { ok: true } | { ok: false; message: string };
  resize(payload: { sessionId: string; cols: number; rows: number }): { ok: true } | { ok: false; message: string };
  list(): SessionMeta[];
  /** Kill every child — daemon shutdown. */
  closeAll(): void;
};

export const createSessionManager = (config: DaemonConfig): SessionManager => {
  const sessions = new Map<string, Session>();

  /** Broadcast one output chunk to every attached client; drop clients whose socket has died. */
  const broadcast = (session: Session, chunk: OutputChunk): void => {
    for (const client of session.attached) {
      try {
        client.send("session.output", randomUUID(), {
          sessionId: session.meta.sessionId,
          seq: chunk.seq,
          data: chunk.data,
        });
      } catch {
        session.attached.delete(client); // socket closed — stop streaming to it
      }
    }
  };

  const pushOutput = (session: Session, data: string): void => {
    session.seq += 1;
    const chunk: OutputChunk = { seq: session.seq, data };
    session.buffer.push(chunk);
    session.bufferedBytes += data.length;
    while (session.bufferedBytes > SCROLLBACK_BYTES && session.buffer.length > 1) {
      const dropped = session.buffer.shift();
      if (dropped) session.bufferedBytes -= dropped.data.length;
    }
    broadcast(session, chunk);
  };

  const emitExit = (session: Session, code: number): void => {
    for (const client of session.attached) {
      try {
        client.send("session.exit", randomUUID(), { sessionId: session.meta.sessionId, code });
      } catch {
        session.attached.delete(client);
      }
    }
  };

  return Object.freeze({
    async start(payload, deps): Promise<SessionStartResult> {
      if (sessions.size >= MAX_SESSIONS) {
        return { ok: false, code: "io_failure", message: `session limit reached (${MAX_SESSIONS} live)` };
      }

      // 1. Canonicalize the cwd — a hostile shape (NUL/UNC/ADS/traversal) dies before any syscall.
      const canon = canonicalizePath(payload.cwd);
      if (!canon.ok) {
        return { ok: false, code: "outside_roots", message: `invalid cwd: ${canon.reason}` };
      }
      // 2. Roots check up front (the broker also enforces it, but a fast, honest deny here too).
      if (!isInsideRoots(canon.path, config.roots)) {
        return { ok: false, code: "outside_roots", message: "cwd is outside the daemon's roots" };
      }

      const program = payload.cmd && payload.cmd.trim().length > 0 ? payload.cmd.trim() : defaultShell();

      // 3. THE GATE. No child is spawned before an `allow` verdict — session.start is exec-risk,
      //    gated exactly like terminal.exec. The broker records the decision to the audit log.
      const verdict = await deps.broker.decide({
        capabilityId: "session.start",
        risk: "exec",
        scope: canon.path,
        pathsToCheck: [canon.path],
        args: { cwd: canon.path, cmd: program },
      });
      if (verdict.kind === "deny") {
        return { ok: false, code: verdict.code, message: verdict.message };
      }

      // 4. Spawn. Token scrubbed; cwd is the canonical, roots-checked path; windowsHide so no console
      //    flashes. `shell:false`: `program` is launched directly as the child — the user drives IT.
      let child: ChildProcess;
      try {
        child = spawn(program, [], {
          cwd: canon.path,
          shell: false,
          windowsHide: true,
          env: scrubEnv(process.env),
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        return { ok: false, code: "io_failure", message: `could not start session: ${(error as Error).message}` };
      }

      const sessionId = randomUUID();
      const startedAt = new Date().toISOString();
      const session: Session = {
        meta: { sessionId, cwd: canon.path, cmd: program, startedAt, alive: true },
        child,
        seq: -1,
        buffer: [],
        bufferedBytes: 0,
        attached: new Set<Client>(),
        reapTimer: null,
      };
      sessions.set(sessionId, session);

      child.stdout?.on("data", (c: Buffer) => pushOutput(session, c.toString("utf8")));
      child.stderr?.on("data", (c: Buffer) => pushOutput(session, c.toString("utf8")));
      child.on("error", (error: Error) => pushOutput(session, `\n[session error] ${error.message}\n`));
      child.on("close", (code) => {
        session.meta.alive = false;
        // R-12: a signal-killed child reports null; the frozen exit schema demands a number → -1.
        emitExit(session, code ?? -1);
        void deps.audit.record({
          event: "execution",
          capabilityId: "session.start",
          scope: session.meta.cwd,
          verdict: "allow",
          meta: { sessionExit: true, exitCode: code ?? -1 },
        });
        session.reapTimer = setTimeout(() => sessions.delete(sessionId), REAP_AFTER_EXIT_MS);
      });

      await deps.audit.record({
        event: "execution",
        capabilityId: "session.start",
        scope: canon.path,
        verdict: "allow",
        meta: { sessionStart: true },
      });
      return { ok: true, meta: { ...session.meta } };
    },

    attach(payload, client, emit, exitEmit) {
      const session = sessions.get(payload.sessionId);
      if (!session) return { ok: false, message: `no such session ${payload.sessionId}` };

      const since = payload.sinceSeq ?? -1;
      for (const chunk of session.buffer) {
        if (chunk.seq > since) emit(client, chunk);
      }
      session.attached.add(client);
      if (!session.meta.alive) exitEmit(client, -1); // already exited: tell the late attacher at once
      return { ok: true, lastSeq: session.seq };
    },

    input(payload) {
      const session = sessions.get(payload.sessionId);
      if (!session) return { ok: false, message: `no such session ${payload.sessionId}` };
      if (!session.meta.alive || !session.child.stdin || session.child.stdin.destroyed) {
        return { ok: false, message: "session is not accepting input" };
      }
      try {
        session.child.stdin.write(payload.data);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `write failed: ${(error as Error).message}` };
      }
    },

    resize(payload) {
      const session = sessions.get(payload.sessionId);
      if (!session) return { ok: false, message: `no such session ${payload.sessionId}` };
      // Pipe mode: nothing to resize. Recorded honestly; a node-pty child would call child.resize here.
      return { ok: true };
    },

    list(): SessionMeta[] {
      return [...sessions.values()].map((s) => ({ ...s.meta }));
    },

    closeAll(): void {
      for (const session of sessions.values()) {
        if (session.reapTimer) clearTimeout(session.reapTimer);
        try {
          session.child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }
      sessions.clear();
    },
  });
};

/** Exported for the config seam / tests. */
export const SESSION_LIMITS = { MAX_SESSIONS, SCROLLBACK_BYTES, REAP_AFTER_EXIT_MS } as const;
export type { CanonicalPath };
