/**
 * session.* payload schemas — FROZEN 2026-07-16 (LANE-CONTRACTS.md).
 *
 * Lane E (phase 67) owns the runtime behind these shapes; C ships the vocabulary and the router
 * seam. Tonight `session.list` answers `{ sessions: [] }` honestly and every other `session.*`
 * answers `tool.result { ok: false, code: "not_implemented" }` (R-06) until E registers handlers.
 */
import { z } from "zod";

/** The frozen five fields, verbatim from the contract. Drift breaks Lane E. */
export const sessionMetaSchema = z
  .object({
    sessionId: z.string().min(1),
    cwd: z.string().min(1),
    cmd: z.string(),
    startedAt: z.string(),
    alive: z.boolean(),
  })
  .strict();

export type SessionMeta = z.infer<typeof sessionMetaSchema>;

/** `session.list` request carries no arguments. Response: `{ sessions: SessionMeta[] }`. */
export const sessionListRequestSchema = z.object({}).strict();
export type SessionListRequestPayload = z.infer<typeof sessionListRequestSchema>;

export const sessionListResponseSchema = z
  .object({ sessions: z.array(sessionMetaSchema) })
  .strict();
export type SessionListResponsePayload = z.infer<typeof sessionListResponseSchema>;

/** `session.start` → responds with `sessionMetaSchema` (R-01: same envelope id + type). */
export const sessionStartRequestSchema = z
  .object({ cwd: z.string().min(1), cmd: z.string().optional() })
  .strict();
export type SessionStartRequestPayload = z.infer<typeof sessionStartRequestSchema>;

/**
 * `session.attach` → stream of `session.output`.
 *
 * R-11 (additive): `sinceSeq` is OPTIONAL and the response shape
 * (`sessionAttachResponseSchema`) is new — the frozen contract gave attach no response shape, and
 * Lane E's slice requires "reconnect resumes from last seq". The frozen field (`sessionId`) is
 * untouched.
 */
export const sessionAttachRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    sinceSeq: z.number().int().min(0).optional(),
  })
  .strict();
export type SessionAttachRequestPayload = z.infer<typeof sessionAttachRequestSchema>;

/** R-11. `lastSeq` of -1 means the session has produced no output yet. */
export const sessionAttachResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    lastSeq: z.number().int().min(-1),
  })
  .strict();
export type SessionAttachResponsePayload = z.infer<typeof sessionAttachResponseSchema>;

/** Daemon→client only. Ordered by `seq`; the client reassembles. */
export const sessionOutputEventSchema = z
  .object({
    sessionId: z.string().min(1),
    seq: z.number().int().min(0),
    data: z.string(),
  })
  .strict();
export type SessionOutputEventPayload = z.infer<typeof sessionOutputEventSchema>;

export const sessionInputSchema = z
  .object({ sessionId: z.string().min(1), data: z.string() })
  .strict();
export type SessionInputPayload = z.infer<typeof sessionInputSchema>;

export const sessionResizeSchema = z
  .object({
    sessionId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .strict();
export type SessionResizePayload = z.infer<typeof sessionResizeSchema>;

/**
 * Daemon→client only.
 *
 * R-12: `code` is `number` (frozen, non-nullable). A signal-killed child reports `null` at the
 * Node layer; the daemon coerces that to `-1` rather than widening the frozen schema.
 */
export const sessionExitEventSchema = z
  .object({ sessionId: z.string().min(1), code: z.number().int() })
  .strict();
export type SessionExitEventPayload = z.infer<typeof sessionExitEventSchema>;
