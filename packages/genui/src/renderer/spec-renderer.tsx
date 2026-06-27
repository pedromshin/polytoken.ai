"use client";
/**
 * renderer/spec-renderer.tsx — SpecRenderer entry component.
 *
 * "use client" on line 1 — this component is the client island boundary (D-20).
 * All declarative state, dispatch, and React context live in this file or below it.
 *
 * ActionRegistryContext is the seam for Phase 13 (SEAM-02):
 *   - Defined here as an empty-default context
 *   - button onClick will call useActionRegistry(action) → noop in Phase 13
 *   - Real handlers are registered in Phase 14 via <ActionRegistryContext.Provider>
 *
 * Security: no eval, no Function, no dangerouslySetInnerHTML (GR-01).
 * Immutability: all props are readonly; RenderContext is a new object each render (CLAUDE.md).
 */

import * as React from "react";

import { COMPONENT_REGISTRY } from "../registry/component-registry";
import { useDeclaredState } from "./use-declared-state";
import { renderNode } from "./render-node";
import type { ComponentRegistry } from "../catalog/types";
import type { SpecRoot } from "../schema/spec-schema";
import type { RenderContext } from "./render-node";

// ---------------------------------------------------------------------------
// ActionRegistry seam — EMPTY this phase, real handlers arrive in Phase 14 (SEAM-02)
// ---------------------------------------------------------------------------

/**
 * A single action handler function signature.
 * Phase 14 will populate the registry with real handlers per action ID.
 */
export type ActionHandler = (value?: unknown) => void;

/**
 * Map from action ID string to its handler function.
 * Intentionally empty in Phase 12 — Phase 14 fills it via context provider.
 */
export type ActionRegistry = Readonly<Record<string, ActionHandler>>;

/**
 * React context carrying the action registry.
 *
 * Default value is `{}` — all button.action IDs resolve to `undefined` (noop),
 * which is safe: the renderer checks for handler existence before calling.
 *
 * To wire real handlers: wrap with:
 *   <ActionRegistryContext.Provider value={myHandlers}>
 *     <SpecRenderer ... />
 *   </ActionRegistryContext.Provider>
 */
export const ActionRegistryContext = React.createContext<ActionRegistry>({});

ActionRegistryContext.displayName = "ActionRegistryContext";

/**
 * Hook to retrieve a handler for a given action ID.
 *
 * @param actionId — the `action` field from a button spec node (optional)
 * @returns the registered handler, or a no-op if not found (SEAM-02)
 */
export function useActionRegistry(
  actionId: string | undefined,
): ActionHandler {
  const registry = React.useContext(ActionRegistryContext);

  if (actionId === undefined) return _noop;

  return registry[actionId] ?? _noop;
}

function _noop(): void {
  // Intentional no-op — Phase 12 action seam (SEAM-02)
}

// ---------------------------------------------------------------------------
// SpecRenderer — entry component
// ---------------------------------------------------------------------------

export interface SpecRendererProps {
  /** The validated SpecRoot (v: 1) to render. */
  readonly spec: SpecRoot;

  /**
   * The component registry to use for node dispatch.
   * Defaults to the global COMPONENT_REGISTRY (NAUTA_CATALOG).
   * Injected by tests to override with a smaller registry.
   */
  readonly registry?: ComponentRegistry;

  /**
   * Named data bindings injected into the render context.
   * Accessible in spec via `dataRef: "data.user.name"` (SPEC-05).
   * Defaults to `{}`.
   */
  readonly data?: Record<string, unknown>;

  /**
   * Optional action handlers to wire into the ActionRegistryContext.
   *
   * When provided, SpecRenderer wraps its output in an
   * <ActionRegistryContext.Provider value={actions}> so that all
   * button onClick handlers can resolve live handlers from the registry.
   *
   * Build with buildActionRegistry() from renderer/action-handlers.ts (Phase 13).
   * When omitted, the default empty-context {} is used — all action IDs
   * resolve to the no-op handler (Phase 12 seam / SEAM-02).
   */
  readonly actions?: ActionRegistry;
}

/**
 * SpecRenderer — entry component for the trusted interpreter.
 *
 * Responsibilities:
 *   1. Materialise declared state via useDeclaredState (SPEC-04)
 *   2. Build a RenderContext (immutable — new object each render)
 *   3. Call renderNode(spec.root, ctx, "root") to produce the React tree
 *
 * Does NOT validate spec.root against SpecRootSchema here — that is the
 * responsibility of the API layer (Phase 13). Render accepts pre-validated specs.
 *
 * "use client" directive ensures this component runs as a client island (D-20).
 *
 * @param props.spec     — the parsed SpecRoot
 * @param props.registry — optional component registry override (defaults to COMPONENT_REGISTRY)
 * @param props.data     — optional named data bindings (defaults to {})
 */
export function SpecRenderer({
  spec,
  registry = COMPONENT_REGISTRY,
  data = {},
  actions,
}: SpecRendererProps): React.ReactElement {
  const declarations = spec.state ?? [];

  const { state, dispatch } = useDeclaredState(declarations);

  // Build immutable render context — new object each render (CLAUDE.md)
  const ctx: RenderContext = {
    data,
    state,
    dispatch,
    registry,
  };

  const tree = renderNode(spec.root as Parameters<typeof renderNode>[0], ctx, "root");

  // Wrap with ActionRegistryContext.Provider when callers supply live handlers.
  // When `actions` is undefined, fall through to the default empty-context `{}`.
  if (actions !== undefined) {
    return (
      <ActionRegistryContext.Provider value={actions}>
        {tree}
      </ActionRegistryContext.Provider>
    );
  }

  return tree;
}
