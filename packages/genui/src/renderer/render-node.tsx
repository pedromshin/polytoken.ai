/**
 * renderer/render-node.tsx — Trusted interpreter: recursive spec-node renderer.
 *
 * renderNode dispatches each SpecNode through COMPONENT_REGISTRY to
 * React.createElement — ZERO eval, ZERO new Function, ZERO dangerouslySetInnerHTML.
 * (GR-01 / SPEC-02)
 *
 * Interpreter primitives handled BEFORE registry dispatch:
 *   - conditional — boolean branch gate (SPEC-05)
 *   - list        — array iteration with emptyState fallback (SPEC-05)
 *
 * Slots:
 *   - Named slots (card.header/footer) passed via `slotChildren` prop (D-16)
 *   - Positional children[] iterated with structural-position keys (D-15)
 *
 * Error handling:
 *   - Unknown type → <UnknownComponentPlaceholder> (never throws)
 *   - Failed propsSchema.safeParse → <NodeErrorFallback reason="prop validation failed">
 *   - Render throws → <NodeErrorBoundary> catches → <NodeErrorFallback reason="render error">
 *
 * Security: no eval, no Function, no dangerouslySetInnerHTML (GR-01).
 * Keys: structural-position only — never read node.id / node.key from spec (D-15).
 */

import * as React from "react";

import {
  NodeErrorBoundary,
  NodeErrorFallback,
} from "./error-boundary";
import { UnknownComponentPlaceholder } from "../registry/component-registry";
import type { ComponentRegistry } from "../catalog/types";
import type { SpecNode } from "../schema/spec-schema";

// ---------------------------------------------------------------------------
// RenderContext — immutable bag passed through the entire render call tree
// ---------------------------------------------------------------------------

/**
 * Context passed to every renderNode call.
 *
 * - data     — named data bindings (injected by SpecRenderer via props)
 * - state    — materialised declared state from useDeclaredState
 * - dispatch — stable dispatch from useDeclaredState (SEAM-02)
 * - registry — component registry (defaults to COMPONENT_REGISTRY)
 */
export interface RenderContext {
  readonly data: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly dispatch: (actionName: string, value?: unknown) => void;
  readonly registry: ComponentRegistry;
}

// ---------------------------------------------------------------------------
// Prototype-pollution guard keys (D-12)
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ---------------------------------------------------------------------------
// resolveDataRef — pure dotted-path walk (NO eval — GR-01 / D-12 / SPEC-05)
// ---------------------------------------------------------------------------

/**
 * Resolves a dotted-path data reference string against the render context.
 *
 * Examples:
 *   "data.user.name"     → ctx.data.user.name
 *   "state.isExpanded"   → ctx.state.isExpanded
 *   "data.missing.key"   → undefined (never throws)
 *
 * Prototype pollution guard (D-12):
 *   Any path segment equal to `__proto__`, `constructor`, or `prototype`
 *   causes the walk to return `undefined` immediately.
 *
 * @param ref — dotted-path reference string from spec
 * @param ctx — current render context
 * @returns resolved value, or `undefined` if path is invalid/missing
 */
export function resolveDataRef(ref: string, ctx: RenderContext): unknown {
  if (!ref) return undefined;

  const parts = ref.split(".");
  if (parts.length === 0) return undefined;

  // Root segment determines which context bucket to walk
  const root = parts[0];
  let current: unknown;

  if (root === "data") {
    current = ctx.data;
  } else if (root === "state") {
    current = ctx.state;
  } else {
    return undefined;
  }

  // Walk remaining path segments (skip the root segment we already resolved)
  for (let i = 1; i < parts.length; i++) {
    const key = parts[i];

    // Prototype pollution guard — immediately bail on forbidden keys (D-12)
    if (key === undefined || FORBIDDEN_KEYS.has(key)) return undefined;

    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

// ---------------------------------------------------------------------------
// evaluateCondition — safe boolean evaluation (NO eval — GR-01 / SPEC-05)
// ---------------------------------------------------------------------------

type ConditionOperator = "eq" | "neq" | "truthy" | "falsy" | "gt" | "lt";

/**
 * Evaluates a conditional node's condition expression.
 *
 * All comparisons are pure value comparisons — no eval, no Function.
 * Unknown operators default to false (fail-safe).
 */
function evaluateCondition(
  resolved: unknown,
  operator: ConditionOperator,
  value?: unknown,
): boolean {
  switch (operator) {
    case "truthy":
      return Boolean(resolved);
    case "falsy":
      return !resolved;
    case "eq":
      // eslint-disable-next-line eqeqeq
      return resolved === value;
    case "neq":
      // eslint-disable-next-line eqeqeq
      return resolved !== value;
    case "gt":
      return typeof resolved === "number" && typeof value === "number"
        ? resolved > value
        : false;
    case "lt":
      return typeof resolved === "number" && typeof value === "number"
        ? resolved < value
        : false;
    default: {
      // Exhaustiveness — unknown operator is a fail-safe false
      const _exhaustive: never = operator;
      void _exhaustive;
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// renderSlotChildren — recurse into named slot nodes (D-16)
// ---------------------------------------------------------------------------

function renderSlotChildren(
  slots: ReadonlyArray<string>,
  node: Record<string, unknown>,
  ctx: RenderContext,
  keyPrefix: string,
): Record<string, React.ReactNode> {
  const result: Record<string, React.ReactNode> = {};

  for (const slotName of slots) {
    const slotNode = node[slotName] as SpecNode | undefined;
    if (slotNode !== undefined) {
      result[slotName] = renderNode(
        slotNode,
        ctx,
        `${keyPrefix}-slot-${slotName}`,
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// renderPositionalChildren — recurse into node.children[] (D-16)
// ---------------------------------------------------------------------------

function renderPositionalChildren(
  children: unknown,
  ctx: RenderContext,
  keyPrefix: string,
): React.ReactNode {
  if (!Array.isArray(children)) return null;

  return children.map((child: unknown, i: number) =>
    renderNode(child as SpecNode, ctx, `${keyPrefix}-${i}`),
  );
}

// ---------------------------------------------------------------------------
// renderNode — the interpreter core
// ---------------------------------------------------------------------------

/**
 * Recursively renders a SpecNode into a React element.
 *
 * Dispatch order:
 *   1. Interpreter primitives: conditional → list (control-flow, not in registry)
 *   2. Registry lookup: unknown type → UnknownComponentPlaceholder
 *   3. Props validation: propsSchema.safeParse → fallback on failure (SPEC-03)
 *   4. Slot + children recursion (D-16)
 *   5. NodeErrorBoundary wraps the final component call (SPEC-03)
 *
 * @param node      — spec node to render
 * @param ctx       — render context (data, state, dispatch, registry)
 * @param keyPrefix — structural key for React reconciliation (D-15)
 * @returns React element or null (never throws)
 */
export function renderNode(
  node: SpecNode,
  ctx: RenderContext,
  keyPrefix: string = "root",
): React.ReactElement {
  // -------------------------------------------------------------------------
  // Interpreter primitive: conditional
  // -------------------------------------------------------------------------
  if (node.type === "conditional") {
    const resolved = resolveDataRef(node.condition.dataRef, ctx);
    const satisfied = evaluateCondition(
      resolved,
      node.condition.operator as ConditionOperator,
      node.condition.value,
    );

    if (satisfied) {
      return renderNode(node.then as SpecNode, ctx, `${keyPrefix}-then`);
    }

    if (node.else !== undefined) {
      return renderNode(node.else as SpecNode, ctx, `${keyPrefix}-else`);
    }

    // No else branch + condition false → empty fragment
    return React.createElement(React.Fragment, { key: keyPrefix });
  }

  // -------------------------------------------------------------------------
  // Interpreter primitive: list
  // -------------------------------------------------------------------------
  if (node.type === "list") {
    const items = resolveDataRef(node.dataRef, ctx);

    // Empty or non-array → emptyState or fragment
    if (!Array.isArray(items) || items.length === 0) {
      if (node.emptyState !== undefined) {
        return renderNode(
          node.emptyState as SpecNode,
          ctx,
          `${keyPrefix}-empty`,
        );
      }
      return React.createElement(React.Fragment, { key: keyPrefix });
    }

    // Render each item with its own context (item data available via state? No — items
    // are injected via individual render calls. The itemTemplate is rendered per-item.)
    const children = items.map((item: unknown, i: number) => {
      // Derive item key from itemKey field — structural-position fallback (D-15)
      const itemKeyValue =
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>)[node.itemKey] === "string"
          ? String((item as Record<string, unknown>)[node.itemKey])
          : String(i);

      const itemCtx: RenderContext = {
        ...ctx,
        data: {
          ...ctx.data,
          item,
        },
      };

      return renderNode(
        node.itemTemplate as SpecNode,
        itemCtx,
        `${keyPrefix}-item-${itemKeyValue}`,
      );
    });

    return React.createElement(React.Fragment, { key: keyPrefix }, ...children);
  }

  // -------------------------------------------------------------------------
  // Registry dispatch — O(1) lookup (D-06)
  // -------------------------------------------------------------------------
  const entry = ctx.registry[node.type];

  if (entry === undefined) {
    return React.createElement(UnknownComponentPlaceholder, {
      key: keyPrefix,
      nodeType: node.type,
    });
  }

  // -------------------------------------------------------------------------
  // Props extraction — strip structural keys before validation (D-22)
  //
  // The spec node has: type, children, and any named slot keys.
  // propsSchema is .strict() — extra keys cause safeParse to fail.
  // We must pass ONLY the props that propsSchema expects:
  //   - Exclude "type" (discriminant)
  //   - Exclude "children" (passed as React children, not props)
  //   - Exclude named slot keys (passed as slotChildren, not props)
  // -------------------------------------------------------------------------
  const slotKeys = new Set(entry.slots ?? []);
  const rawNode = node as Record<string, unknown>;
  const props: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(rawNode)) {
    if (k === "type" || k === "children" || slotKeys.has(k)) continue;
    props[k] = v;
  }

  // -------------------------------------------------------------------------
  // Props validation via propsSchema.safeParse (SPEC-03 / D-22)
  // Never call .parse() on the render path — safeParse only.
  // -------------------------------------------------------------------------
  const propsResult = entry.propsSchema.safeParse(props);

  if (!propsResult.success) {
    return React.createElement(NodeErrorFallback, {
      key: keyPrefix,
      nodeType: node.type,
      reason: "prop validation failed",
    });
  }

  // -------------------------------------------------------------------------
  // Slot children recursion (D-16)
  // -------------------------------------------------------------------------
  const slotChildren =
    entry.slots !== undefined && entry.slots.length > 0
      ? renderSlotChildren(entry.slots, rawNode, ctx, keyPrefix)
      : {};

  // -------------------------------------------------------------------------
  // Positional children recursion (D-16)
  // -------------------------------------------------------------------------
  const positionalChildren = entry.acceptsChildren
    ? renderPositionalChildren(rawNode["children"], ctx, keyPrefix)
    : null;

  // -------------------------------------------------------------------------
  // Component render — wrapped in NodeErrorBoundary for error isolation (SPEC-03)
  // -------------------------------------------------------------------------
  const componentElement = React.createElement(
    entry.component,
    { ...propsResult.data, ...slotChildren, key: keyPrefix },
    positionalChildren,
  );

  return React.createElement(
    NodeErrorBoundary,
    { key: `${keyPrefix}-boundary`, nodeType: node.type },
    componentElement,
  );
}
