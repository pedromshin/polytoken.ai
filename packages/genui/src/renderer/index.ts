/**
 * renderer/index.ts — Public barrel for the @nauta/genui renderer export.
 *
 * Re-exports everything that downstream consumers (app, tests, Phase 14) need
 * from the trusted interpreter and its collaborators.
 *
 * Entry point: packages/genui/src/renderer/ (via package.json exports["./renderer"])
 */

export {
  SpecRenderer,
  ActionRegistryContext,
  useActionRegistry,
} from "./spec-renderer";

export type {
  SpecRendererProps,
  ActionHandler,
  ActionRegistry,
} from "./spec-renderer";

export { renderNode, resolveDataRef } from "./render-node";

export type { RenderContext } from "./render-node";

export { NodeErrorBoundary, NodeErrorFallback } from "./error-boundary";

export type {
  ErrorBoundaryProps,
  ErrorBoundaryState,
  NodeErrorFallbackProps,
} from "./error-boundary";

export { useDeclaredState } from "./use-declared-state";

export type { DeclaredStateResult } from "./use-declared-state";
