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

export type {
  Risk,
  CapabilityCost,
  CapabilitySource,
  CapabilityTrust,
  CapabilityMeta,
  Capability,
  CapabilityManifestEntry,
  CapabilityRegistry,
} from "./capability.js";
