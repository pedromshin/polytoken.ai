/**
 * sandbox/index.ts — public surface for the @nauta/genui/sandbox subpath (Phase 20 spike).
 *
 * The jailed-eval code-island: run arbitrary generated code inside a sandboxed opaque-origin
 * iframe, gated by a host-side AST allowlist + repaired by a v0-style validate→autofix→run→
 * heal→fallback loop. Framework-free core (no React/Next imports here).
 *
 * NOTE: `axe-source` is deliberately NOT re-exported here (it pulls the full axe-core module).
 * Import it from "@nauta/genui/sandbox/axe-source" only inside the dynamically-loaded frame.
 */

export {
  validateIslandCode,
  type ValidateIslandResult,
  type IslandViolation,
  type IslandViolationRule,
} from "./validate-island-code";

export {
  buildIslandSrcdoc,
  ISLAND_SANDBOX,
  ISLAND_CSP_POLICY,
  type BuildIslandSrcdocOptions,
} from "./build-island-srcdoc";

export {
  IslandMessageSchema,
  IslandReadyMessageSchema,
  IslandRuntimeErrorMessageSchema,
  IslandA11yMessageSchema,
  IslandA11yViolationSchema,
  parseIslandMessage,
  isTrustedIslandMessage,
  type IslandMessage,
  type IslandA11yViolation,
  type IncomingMessageEvent,
} from "./island-message";

export { autofixIslandCode, type AutofixResult } from "./autofix-island-code";

export {
  startIsland,
  onRunSuccess,
  onRuntimeError,
  onHealed,
  isTerminal,
  type IslandState,
  type IslandPhase,
  type StartIslandOptions,
} from "./repair-loop";

export { SAFE_PLACEHOLDER_SRCDOC, buildSafePlaceholderSrcdoc } from "./safe-placeholder";

export * from "./fixtures";
