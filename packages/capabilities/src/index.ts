/**
 * @polytoken/capabilities — the capability registry, the D2 spine (INV-1..5).
 *
 * One declaration read by four consumers (LLM, genui, daemon, canvas). Named exports only —
 * a wildcard barrel would let a rename slip through silently, and every consumer bets on these names.
 */
export {
  createCapabilityRegistry,
  defineCapability,
} from "./capability.js";

export { vetCandidate, registerExternal } from "./vetting.js";

export {
  desktopShapeSchema,
  failClosedDesktopProvider,
  desktopSpawnCapability,
  desktopAttachCapability,
  desktopHibernateCapability,
  desktopDestroyCapability,
  DESKTOP_CAPABILITIES,
} from "./desktop.js";

export type {
  DesktopStatus,
  DesktopShape,
  DesktopProvider,
  DesktopExecCtx,
  DesktopScope,
} from "./desktop.js";

export {
  CANVAS_CONNECT_DEFAULT_SOURCE_PATH,
  CANVAS_CONNECT_DEFAULT_TARGET_KEY,
  CANVAS_NODE_DATA_SCHEMAS,
  CANVAS_NODE_TYPE_IDS,
  canvasAddNodeInputSchema,
  canvasConnectInputSchema,
  canvasRemoveNodeInputSchema,
  canvasNodeSnapshotSchema,
  canvasEdgeSnapshotSchema,
  failClosedCanvasMutationStore,
  canvasAddNodeCapability,
  canvasConnectCapability,
  canvasRemoveNodeCapability,
  CANVAS_CAPABILITIES,
} from "./canvas.js";

export type {
  CanvasAddNodeInput,
  CanvasConnectInput,
  CanvasRemoveNodeInput,
  CanvasAddNodeOutput,
  CanvasConnectOutput,
  CanvasRemoveNodeOutput,
  CanvasNodeSnapshot,
  CanvasEdgeSnapshot,
  CanvasMutationStore,
  CanvasExecCtx,
  CanvasScope,
} from "./canvas.js";

export {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  SPREADSHEET_FIELD_TYPES,
  tableCreateInputSchema,
  tableUpdateInputSchema,
  failClosedSpreadsheetStore,
  tableCreateCapability,
  tableUpdateCapability,
  TABLE_CAPABILITIES,
} from "./table.js";

export type {
  TableColumn,
  TableRow,
  TableCreateInput,
  TableCreateOutput,
  TableUpdateInput,
  TableUpdateOutput,
  SpreadsheetStore,
  TableExecCtx,
  TableScope,
} from "./table.js";

export type {
  ExternalTrust,
  ExternalCapabilityCandidate,
  ExternalCapability,
  PromotionRecord,
  VetResult,
} from "./vetting.js";

export type {
  Risk,
  CapabilityCost,
  CapabilitySource,
  CapabilityTrust,
  CapabilityReversibility,
  CapabilityMeta,
  Capability,
  CapabilityManifestEntry,
  CapabilityRegistry,
} from "./capability.js";
