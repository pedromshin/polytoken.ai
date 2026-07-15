/**
 * registry/component-registry.ts — Static component registry.
 *
 * COMPONENT_REGISTRY is the POLYTOKEN_CATALOG map used by the renderer for O(1) keyed
 * lookup. The registry IS the catalog (D-06) — no additional transformation needed.
 *
 * Exports:
 *   - COMPONENT_REGISTRY: ComponentRegistry
 *   - REGISTERED_TYPES: string[]  (derived from registry keys)
 *   - RegisteredTypeSchema: z.ZodEnum  (allowlist from keys, D-06)
 *   - UnknownComponentPlaceholder: React component (safe fallback — never throws, D-06)
 *
 * Trust boundary (T-12-05 / D-06):
 *   Unknown/hallucinated spec `type` keys are rejected by RegisteredTypeSchema at
 *   validation time (Phase 13). If a node somehow reaches the renderer with an
 *   unregistered type, UnknownComponentPlaceholder handles it without throwing.
 */

import * as React from "react";
import { z } from "zod";

import { POLYTOKEN_CATALOG } from "../catalog/manifest";
import type { ComponentRegistry } from "../catalog/types";

// ---------------------------------------------------------------------------
// COMPONENT_REGISTRY
// The registry IS the catalog keyed on type — wrap in a const for the registry
// identity so downstream code can import from registry/ without knowing catalog/.
// ---------------------------------------------------------------------------

/** The static component registry: spec type key → ManifestEntry. O(1) lookup. */
export const COMPONENT_REGISTRY: ComponentRegistry = POLYTOKEN_CATALOG;

// ---------------------------------------------------------------------------
// Allowlist derived from registry keys (D-06)
// RegisteredTypeSchema is the Zod enum that validates spec node type strings.
// It is derived from Object.keys(COMPONENT_REGISTRY) so it auto-updates if
// the catalog changes — no manual sync required.
// ---------------------------------------------------------------------------

/** All registered spec type keys (derived from COMPONENT_REGISTRY at module load). */
export const REGISTERED_TYPES: ReadonlyArray<string> = Object.keys(
  COMPONENT_REGISTRY,
);

/**
 * Zod schema that accepts only registered type keys (D-06).
 * Rejects unknown/hallucinated types at the validation boundary.
 *
 * Usage: RegisteredTypeSchema.safeParse(node.type) — success means the type
 * is in the catalog; failure means UnknownComponentPlaceholder path activates.
 */
export const RegisteredTypeSchema = z.enum(
  REGISTERED_TYPES as [string, ...string[]],
);

// ---------------------------------------------------------------------------
// UnknownComponentPlaceholder — safe fallback for unregistered types (D-06)
//
// Renders an accessible error card. NEVER throws. Used in Phase 13's
// renderNode when a spec node type is not in COMPONENT_REGISTRY.
//
// UI-SPEC §9 copy: `[!] "{nodeType}" node — component not in registry`
// ---------------------------------------------------------------------------

/** Props for UnknownComponentPlaceholder. */
export interface UnknownComponentPlaceholderProps {
  readonly nodeType: string;
}

/**
 * Safe fallback component for unregistered spec node types.
 *
 * Renders a visible error indicator. Never throws — ensures one rogue
 * node in a spec tree does not break the surrounding render (Pitfall 2).
 *
 * @param nodeType — the unrecognized spec type key
 */
export function UnknownComponentPlaceholder({
  nodeType,
}: UnknownComponentPlaceholderProps): React.ReactElement {
  return React.createElement(
    "div",
    {
      role: "alert",
      className:
        "border border-destructive/50 bg-destructive/10 rounded-md px-3 py-2 text-xs text-destructive",
    },
    `[!] "${nodeType}" node — component not in registry`,
  );
}
