/**
 * The both-directions validation surface.
 *
 * The maps are PARTIAL BY DESIGN (T-65-03): a MsgType absent from a map is NOT legal in that
 * direction. `perm.request` is absent from `clientToDaemon`, so a client cannot inject a fake
 * permission prompt; `perm.decision` is absent from `daemonToClient`; `session.output` /
 * `session.exit` / `fs.watch.event` / `tool.result` are daemon→client only.
 *
 * `parseClientFrame` and `parseDaemonFrame` ARE the "zod-validated both directions" rule as a
 * callable — the daemon and Lane E's client both call these instead of hand-rolling parse
 * sequences. They are Result-shaped and NEVER throw (R-02: a typo in a dev client must not kill
 * Lane E's session stream).
 */
import type { ZodTypeAny } from "zod";
import { envelopeSchema, type Envelope, type MsgType } from "./envelope.js";
import {
  sessionAttachRequestSchema,
  sessionAttachResponseSchema,
  sessionExitEventSchema,
  sessionInputSchema,
  sessionListRequestSchema,
  sessionListResponseSchema,
  sessionMetaSchema,
  sessionOutputEventSchema,
  sessionResizeSchema,
  sessionStartRequestSchema,
} from "./sessions.js";
import { fsWatchEventSchema } from "./watch.js";
// v2.0: the EXTENDED unions are strict supersets of the frozen `toolRequestSchema` /
// `toolResultSchema` — every frame legal before this import change is legal after it, and the
// frozen 5 are tried FIRST inside the extended request union, so their parse behavior is
// byte-for-byte unchanged. The browser tools ride the same `tool.request` MsgType.
import { extendedToolRequestSchema, extendedToolResultSchema } from "./browser.js";
import { permDecisionSchema, permRequestSchema } from "./perms.js";

/** Client → daemon. Note the absences: perm.request, tool.result, session.output/exit, fs.watch.event. */
export const clientToDaemon = {
  "session.list": sessionListRequestSchema,
  "session.start": sessionStartRequestSchema,
  "session.attach": sessionAttachRequestSchema,
  "session.input": sessionInputSchema,
  "session.resize": sessionResizeSchema,
  "tool.request": extendedToolRequestSchema,
  "perm.decision": permDecisionSchema,
} as const satisfies Partial<Record<MsgType, ZodTypeAny>>;

/**
 * Daemon → client. R-01: responses echo the request's type, so `session.list` here is the
 * RESPONSE shape and `session.start` is `SessionMeta`. Note the absences: perm.decision,
 * tool.request.
 */
export const daemonToClient = {
  "session.list": sessionListResponseSchema,
  "session.start": sessionMetaSchema,
  "session.attach": sessionAttachResponseSchema,
  "session.output": sessionOutputEventSchema,
  "session.exit": sessionExitEventSchema,
  "fs.watch.event": fsWatchEventSchema,
  "tool.result": extendedToolResultSchema,
  "perm.request": permRequestSchema,
} as const satisfies Partial<Record<MsgType, ZodTypeAny>>;

export type ClientToDaemonType = keyof typeof clientToDaemon;
export type DaemonToClientType = keyof typeof daemonToClient;

export type ParsedFrame<TType extends MsgType = MsgType> = {
  readonly ok: true;
  readonly envelope: Envelope;
  readonly type: TType;
  readonly payload: unknown;
};

export type FrameFailure = {
  readonly ok: false;
  /** Recoverable envelope id, when the envelope itself parsed far enough to expose one (R-02). */
  readonly id?: string;
  readonly error: string;
};

export type FrameResult<TType extends MsgType = MsgType> = ParsedFrame<TType> | FrameFailure;

const recoverId = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

const parseFrame = (
  raw: unknown,
  map: Partial<Record<MsgType, ZodTypeAny>>,
  direction: string,
): FrameResult => {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      id: recoverId(raw),
      error: `invalid envelope: ${envelope.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
    };
  }

  const schema = map[envelope.data.type];
  if (schema === undefined) {
    return {
      ok: false,
      id: envelope.data.id,
      error: `message type "${envelope.data.type}" is not legal ${direction}`,
    };
  }

  const payload = schema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      id: envelope.data.id,
      error: `invalid ${envelope.data.type} payload: ${payload.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
    };
  }

  return {
    ok: true,
    envelope: envelope.data,
    type: envelope.data.type,
    payload: payload.data,
  };
};

/** Parse a frame the DAEMON received. Never throws. */
export const parseClientFrame = (raw: unknown): FrameResult<ClientToDaemonType> =>
  parseFrame(raw, clientToDaemon, "client→daemon") as FrameResult<ClientToDaemonType>;

/** Parse a frame a CLIENT received. Never throws. Lane E's inbound guard. */
export const parseDaemonFrame = (raw: unknown): FrameResult<DaemonToClientType> =>
  parseFrame(raw, daemonToClient, "daemon→client") as FrameResult<DaemonToClientType>;
