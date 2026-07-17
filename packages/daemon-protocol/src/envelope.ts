/**
 * The daemon wire protocol — FROZEN 2026-07-16 (LANE-CONTRACTS.md) — additive changes only;
 * renames/removals break Lane E.
 *
 * The frozen contract text, verbatim:
 *
 *   // transport: WebSocket ws://127.0.0.1:8787, header "x-daemon-token: <env DAEMON_TOKEN>"
 *   type Envelope = { id: string; type: MsgType; payload: unknown };
 *   type MsgType =
 *     | "session.list"      // -> { sessions: SessionMeta[] }
 *     | "session.start"     // { cwd, cmd? }            -> SessionMeta
 *     | "session.attach"    // { sessionId }            -> stream of session.output
 *     | "session.output"    // { sessionId, seq, data } // server->client, ordered
 *     | "session.input"     // { sessionId, data }
 *     | "session.resize"    // { sessionId, cols, rows }
 *     | "session.exit"      // { sessionId, code }
 *     | "fs.watch.event"    // { root, path, kind }
 *     | "tool.request"      // { tool, args }           // fs/terminal/git via ToolExecutor
 *     | "tool.result"       // { requestId, ok, output }
 *     | "perm.request"      // { tool, args, risk }     // ONE permission model
 *     | "perm.decision";    // { requestId, allow, remember }
 *   type SessionMeta = { sessionId: string; cwd: string; cmd: string; startedAt: string; alive: boolean };
 *
 * Correlation conventions (65-CONTEXT.md resolutions):
 * - R-01: a response envelope echoes the request's `id` AND `type` (session.list request →
 *   envelope `{ id: <same>, type: "session.list", payload: { sessions } }`). The exception the
 *   contract itself makes: `tool.request` is answered by a `tool.result` envelope (fresh id)
 *   whose payload `requestId` equals the request envelope's `id`.
 * - R-02: a frame failing JSON.parse or zod is dropped + logged; where an `id` is recoverable the
 *   daemon replies `tool.result { requestId: <id>, ok: false, output: { kind: "error",
 *   code: "protocol_error", message } }`. The socket STAYS OPEN. No error MsgType is invented.
 */
import { z } from "zod";

/** The 12 frozen MsgTypes, in contract order. A 13th type cannot parse. */
export const MSG_TYPES = [
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
] as const;

export const msgTypeSchema = z.enum(MSG_TYPES);
export type MsgType = z.infer<typeof msgTypeSchema>;

/**
 * The envelope every frame rides in. `.strict()`: an unknown top-level key is REJECTED, so a
 * frame cannot smuggle directives past validation (T-65-01).
 */
export const envelopeSchema = z
  .object({
    id: z.string().min(1),
    type: msgTypeSchema,
    payload: z.unknown(),
  })
  .strict();

export type Envelope = z.infer<typeof envelopeSchema>;
