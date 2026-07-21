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
