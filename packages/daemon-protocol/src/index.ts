/**
 * @polytoken/daemon-protocol — the frozen daemon WS protocol (LANE-CONTRACTS.md, 2026-07-16).
 *
 * Named exports exclusively, enumerated explicitly: a wildcard barrel would let a rename slip
 * through silently, and three lanes bet on these names.
 *
 * Transport: `ws://127.0.0.1:<port>` (default 8787), header `x-daemon-token: <env DAEMON_TOKEN>`.
 */

// envelope
export { MSG_TYPES, msgTypeSchema, envelopeSchema } from "./envelope.js";
export type { MsgType, Envelope } from "./envelope.js";

// sessions
export {
  sessionMetaSchema,
  sessionListRequestSchema,
  sessionListResponseSchema,
  sessionStartRequestSchema,
  sessionAttachRequestSchema,
  sessionAttachResponseSchema,
  sessionOutputEventSchema,
  sessionInputSchema,
  sessionResizeSchema,
  sessionExitEventSchema,
} from "./sessions.js";
export type {
  SessionMeta,
  SessionListRequestPayload,
  SessionListResponsePayload,
  SessionStartRequestPayload,
  SessionAttachRequestPayload,
  SessionAttachResponsePayload,
  SessionOutputEventPayload,
  SessionInputPayload,
  SessionResizePayload,
  SessionExitEventPayload,
} from "./sessions.js";

// watch
export { fsWatchKindSchema, fsWatchEventSchema } from "./watch.js";
export type { FsWatchKind, FsWatchEventPayload } from "./watch.js";

// tools
export {
  riskSchema,
  gitSubcommandSchema,
  toolNameSchema,
  toolRequestSchema,
  toolErrorCodeSchema,
  fsListEntrySchema,
  toolOutputSchema,
  toolResultSchema,
} from "./tools.js";
export type {
  Risk,
  GitSubcommand,
  ToolName,
  ToolRequestPayload,
  ToolErrorCode,
  FsListEntry,
  ToolOutput,
  ToolResultPayload,
} from "./tools.js";

// browser (v2.0 additive module — the frozen 5 above are untouched)
export {
  browserToolNameSchema,
  browserToolRequestSchema,
  browserToolOutputSchema,
  extendedToolRequestSchema,
  extendedToolOutputSchema,
  extendedToolResultSchema,
} from "./browser.js";
export type {
  BrowserToolName,
  BrowserToolRequestPayload,
  BrowserToolOutput,
  ExtendedToolRequestPayload,
  ExtendedToolOutput,
  ExtendedToolResultPayload,
} from "./browser.js";

// dir (v2.0 additive module — filesystem-read tools, folded into the extended unions above)
export {
  dirToolNameSchema,
  dirToolRequestSchema,
  dirToolOutputSchema,
  dirTreeEntrySchema,
  dirManifestFileSchema,
  DIR_TOOL_BOUNDS,
} from "./dir.js";
export type { DirToolName, DirToolRequestPayload, DirToolOutput } from "./dir.js";

// perms
export { permRequestSchema, permDecisionSchema } from "./perms.js";
export type { PermRequestPayload, PermDecisionPayload } from "./perms.js";

// direction — the both-directions validation surface
export { clientToDaemon, daemonToClient, parseClientFrame, parseDaemonFrame } from "./direction.js";
export type {
  ClientToDaemonType,
  DaemonToClientType,
  ParsedFrame,
  FrameFailure,
  FrameResult,
} from "./direction.js";
