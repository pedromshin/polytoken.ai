/**
 * Registers the `session.*` handlers on the router (the R-06 seam Lane E left open). Every payload
 * has already crossed `parseClientFrame` (the direction map validates each `session.*` request), so
 * these handlers receive typed, trusted shapes and only orchestrate the manager + the wire replies.
 *
 * Response discipline (R-01): a request's success reply echoes the SAME envelope id AND type
 * (`session.start` → `SessionMeta`, `session.attach` → attach response, `session.list` → list). A
 * failure is a `tool.result { ok:false }` via `sendToolError`, exactly like every other handler —
 * the socket stays open (R-02). `session.input` / `session.resize` are fire-and-forget on success
 * (no reply type exists for them in the frozen contract); only failures answer.
 */
import type {
  SessionAttachRequestPayload,
  SessionInputPayload,
  SessionResizePayload,
  SessionStartRequestPayload,
} from "@polytoken/daemon-protocol";
import { randomUUID } from "node:crypto";

import type { AuditLog } from "../permissions/audit.js";
import type { PermissionBroker } from "../permissions/broker.js";
import type { Client } from "../server/clients.js";
import { sendToolError, type Router } from "../server/router.js";
import type { SessionManager } from "./manager.js";

const emitOutput = (client: Client, chunk: { seq: number; data: string }, sessionId: string): void => {
  client.send("session.output", randomUUID(), { sessionId, seq: chunk.seq, data: chunk.data });
};

export const registerSessionHandlers = (router: Router, manager: SessionManager): void => {
  // session.list — always answers (the honest empty-list stub is replaced by the real inventory).
  router.register("session.list", async (_payload, ctx) => {
    ctx.client.send("session.list", ctx.envelopeId, { sessions: manager.list() });
  });

  // session.start — the exec-gated spawn. broker.decide (inside manager.start) is the ONE gate.
  router.register("session.start", async (payload, ctx) => {
    const p = payload as SessionStartRequestPayload;
    const result = await manager.start(
      { cwd: p.cwd, cmd: p.cmd },
      { broker: ctx.broker as PermissionBroker, audit: ctx.audit as AuditLog },
    );
    if (!result.ok) {
      sendToolError(ctx.client, ctx.envelopeId, result.code, result.message);
      return;
    }
    ctx.client.send("session.start", ctx.envelopeId, result.meta);
  });

  // session.attach — replay buffered output to THIS client, then live-stream (R-11 sinceSeq resume).
  router.register("session.attach", async (payload, ctx) => {
    const p = payload as SessionAttachRequestPayload;
    const result = manager.attach(
      { sessionId: p.sessionId, sinceSeq: p.sinceSeq },
      ctx.client,
      (client, chunk) => emitOutput(client, chunk, p.sessionId),
      (client, code) => client.send("session.exit", randomUUID(), { sessionId: p.sessionId, code }),
    );
    if (!result.ok) {
      sendToolError(ctx.client, ctx.envelopeId, "invalid_args", result.message);
      return;
    }
    ctx.client.send("session.attach", ctx.envelopeId, { sessionId: p.sessionId, lastSeq: result.lastSeq });
  });

  // session.input — write to the child's stdin. Success is silent; only a dead/absent session answers.
  router.register("session.input", async (payload, ctx) => {
    const p = payload as SessionInputPayload;
    const result = manager.input({ sessionId: p.sessionId, data: p.data });
    if (!result.ok) sendToolError(ctx.client, ctx.envelopeId, "invalid_args", result.message);
  });

  // session.resize — recorded; pipe mode cannot resize (node-pty seam). Only failures answer.
  router.register("session.resize", async (payload, ctx) => {
    const p = payload as SessionResizePayload;
    const result = manager.resize({ sessionId: p.sessionId, cols: p.cols, rows: p.rows });
    if (!result.ok) sendToolError(ctx.client, ctx.envelopeId, "invalid_args", result.message);
  });
};
