/**
 * renderer/action-handlers.ts — ActionRegistry binding layer (Phase 13 / Plan 13-04).
 *
 * buildActionRegistry wires three live handler types:
 *   navigate     — D-15 runtime relative-href re-check before calling router.push
 *   setState     — calls dispatch(key, value) from DeclaredStateResult
 *   query-refresh — calls trpcUtils.invalidate() to refresh all cached queries
 *
 * SEAM-02: mutate is INTENTIONALLY absent from the returned registry.
 *   ALLOWED_MUTATIONS is [] (empty) in v1.1. No mutate handler is registered,
 *   so any mutate action from the spec is a silent noop — the renderer's
 *   useActionRegistry returns the default noop when key is absent.
 *   Phase v1.2+ will populate ALLOWED_MUTATIONS and register the handler here.
 *
 * D-15 defense-in-depth: the navigate handler re-checks that href starts with "/"
 *   and is not an absolute/protocol-relative URL before calling router.push.
 *   This is a second layer of defence after the Zod schema validation at the API
 *   boundary (ActionSchema / NavigateActionSchema in action-schema.ts).
 *
 * D-24 no-eval gate: no eval, no Function, no dangerouslySetInnerHTML on this path.
 *
 * Security: Immutable — returns a new registry object each call (CLAUDE.md).
 */

import type { DeclaredStateResult } from "./use-declared-state";
import type { ActionRegistry } from "./spec-renderer";

// ---------------------------------------------------------------------------
// Types for collaborator stubs (injected to enable unit testing)
// ---------------------------------------------------------------------------

/** Minimal router interface — only push is required for navigate. */
export interface RouterLike {
  readonly push: (href: string) => void;
}

/** Minimal tRPC utils interface — only invalidate is required for query-refresh. */
export interface TrpcUtilsLike {
  readonly invalidate: () => Promise<void>;
}

/** Input shape for action payload (discriminated union subset used at runtime). */
interface NavigateActionPayload {
  readonly type: "navigate";
  readonly href: string;
}

interface SetStateActionPayload {
  readonly type: "setState";
  readonly key: string;
  readonly value: string | number | boolean | null;
}

// ---------------------------------------------------------------------------
// D-15: Runtime relative-href guard
//
// Mirrors the same validation in ActionSchema / NavigateActionSchema
// (action-schema.ts) as a second, independent defence layer.
// Rejects:
//   - absolute schemes: http:// https:// javascript: data: ftp: etc.
//   - protocol-relative: //evil.com
//   - anything that does NOT start with "/"
// Allows:
//   - /emails, /threads/123, /settings — pure relative paths
// ---------------------------------------------------------------------------

/** Pattern: matches an absolute scheme (letter+colon) or protocol-relative (//). */
const ABSOLUTE_OR_SCHEME_RE = /^([a-z][a-z0-9+\-.]*:|\/\/)/i;

/**
 * Returns true when href is a safe relative path (starts with "/" and has no
 * absolute scheme or protocol-relative prefix).
 *
 * D-15: Called at handler registration time, not at schema parse time.
 */
function isSafeRelativeHref(href: string): boolean {
  if (!href.startsWith("/")) return false;
  return !ABSOLUTE_OR_SCHEME_RE.test(href);
}

// ---------------------------------------------------------------------------
// buildActionRegistry
// ---------------------------------------------------------------------------

export interface ActionRegistryDeps {
  /** Next.js router (or minimal stub for tests). */
  readonly router: RouterLike;
  /** tRPC utils providing query invalidation. */
  readonly trpcUtils: TrpcUtilsLike;
  /** Declared state result providing the dispatch function. */
  readonly declaredState: DeclaredStateResult;
}

/**
 * Builds the ActionRegistry for Phase 13.
 *
 * The returned registry is a new immutable object (CLAUDE.md spread semantics).
 * Each property is a handler closure over the provided dependencies.
 *
 * Registered types: navigate, setState, query-refresh.
 * Intentionally absent: mutate (SEAM-02 — see file header).
 *
 * @param deps - Injected collaborators (router, trpcUtils, declaredState)
 * @returns A new ActionRegistry object with the three live handler types.
 */
export function buildActionRegistry(deps: ActionRegistryDeps): ActionRegistry {
  const { router, trpcUtils, declaredState } = deps;

  // navigate handler — D-15 runtime re-check of href safety
  const navigate = (action: unknown): void => {
    if (!action || typeof action !== "object") return;
    const { href } = action as NavigateActionPayload;
    if (typeof href !== "string") return;

    // D-15: Re-validate href is relative-only before calling router.push.
    // This is intentionally separate from the Zod schema check at the API layer.
    if (!isSafeRelativeHref(href)) {
      // Log server-side only — noop to the caller (D-15 defense-in-depth)
      console.error(
        `[genui/action-handlers] navigate blocked: href is not relative-only (D-15): "${href}"`,
      );
      return;
    }

    router.push(href);
  };

  // setState handler — calls dispatch(key, value) from DeclaredStateResult
  const setState = (action: unknown): void => {
    if (!action || typeof action !== "object") return;
    const { key, value } = action as SetStateActionPayload;
    if (typeof key !== "string" || key.length === 0) return;
    declaredState.dispatch(key, value);
  };

  // query-refresh handler — invalidates all tRPC query cache
  const queryRefresh = (): void => {
    void trpcUtils.invalidate();
  };

  // Return a new immutable ActionRegistry object (CLAUDE.md — spread/new object)
  return Object.freeze({
    navigate,
    setState,
    "query-refresh": queryRefresh,
    // NOTE: "mutate" is intentionally absent (SEAM-02 / D-14).
    // ALLOWED_MUTATIONS = [] in v1.1 — no mutation is reachable.
    // Phase v1.2+ will populate ALLOWED_MUTATIONS and register the handler.
  } satisfies ActionRegistry);
}
