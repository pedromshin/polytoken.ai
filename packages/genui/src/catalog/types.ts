/**
 * catalog/types.ts — Vocabulary contract for the @polytoken/genui catalog.
 *
 * These types are the foundation that Plans 02 (registry), 03 (renderer),
 * and 04 (demo/studio) all depend on. No implementation logic here —
 * only the typed contract (SPEC-01, SEAM-01).
 */

import type { ComponentType } from "react";
import type { ZodType } from "zod";

// ---------------------------------------------------------------------------
// SpecNodeType — the 12 node kinds registered in the component catalog (D-08)
// ---------------------------------------------------------------------------

/**
 * All spec node types registered in the component catalog (D-08).
 *
 * Leaf components (8): text, badge, button, card, key-value-list, separator, alert, table.
 * Layout primitives (3): stack, grid, section (house-built containers, not @polytoken/ui exports).
 * Iteration + conditional (2): list, conditional (SPEC-01 requirement).
 * Phase 18 additions (5): avatar, input, nav, feed-item, tabs.
 * 999.13 vendored-motion additions (5): number-ticker, spinner, avatar-stack,
 * animated-list, marquee (@polytoken/ui vendored components).
 *
 * This exact set is the discriminant for the Zod discriminated-union in
 * packages/genui/src/schema/spec-schema.ts — every literal here MUST have a
 * matching z.object({ type: z.literal("<key>") }) in that file.
 */
export type SpecNodeType =
  | "text"
  | "badge"
  | "button"
  | "card"
  | "key-value-list"
  | "separator"
  | "alert"
  | "table"
  | "stack"
  | "grid"
  | "list"
  | "conditional"
  | "avatar"
  | "input"
  | "nav"
  | "feed-item"
  | "tabs"
  | "section"
  | "form"
  | "number-ticker"
  | "spinner"
  | "avatar-stack"
  | "animated-list"
  | "marquee";

// ---------------------------------------------------------------------------
// ManifestEntry<TProps> — per-component catalog entry shape (D-03, SPEC-RENDERER §4.1)
// ---------------------------------------------------------------------------

/**
 * A single component catalog entry.
 *
 * Every field is readonly (house style: immutable, per CLAUDE.md + D-03).
 * The field names and order match SPEC-RENDERER.md §4.1 exactly so downstream
 * plans can import and satisfy the shape without derivation.
 *
 * TProps must be a plain record so props can be spread onto the component
 * and schema-validated at render time by the trusted interpreter.
 */
export interface ManifestEntry<TProps extends Record<string, unknown>> {
  /** The spec node type key — must match one of the 12 SpecNodeType literals. */
  readonly type: SpecNodeType;

  /** Human-readable description of the component (used for LLM catalog prompts, D-23). */
  readonly description: string;

  /**
   * A valid, complete example props object.
   * CI gate (CTLG-04 / D-05): this example must pass propsSchema.safeParse in tests.
   */
  readonly example: Record<string, unknown>;

  /**
   * Zod schema that validates the props the renderer passes to the component.
   * Must be .strict() so Bedrock structured-output grammar has no additionalProperties
   * surface (D-22 / COST-02).
   */
  readonly propsSchema: ZodType<TProps>;

  /**
   * Props that the LLM generator MUST NOT set (locked to catalog values).
   * Renderer enforces: props in this list are stripped from LLM-emitted spec.
   * (CTLG-05 / D-03)
   */
  readonly lockedProps?: ReadonlyArray<keyof TProps>;

  /**
   * Named slot keys this component accepts (e.g. ["header", "footer"] for card).
   * Renderer passes resolved child nodes under these keys, not as positional children.
   * (SPEC-RENDERER.md §3.2 / D-16)
   */
  readonly slots?: ReadonlyArray<string>;

  /**
   * True if this component accepts positional children[] (e.g. stack, grid, card).
   * Controls whether the renderer recurses into node.children.
   * (SPEC-RENDERER.md §4.1)
   */
  readonly acceptsChildren?: boolean;

  /**
   * The React component to render.
   * The renderer calls: <component {...propsResult.data}>{positionalChildren}</component>
   * ComponentType<TProps> from "react" — requires matching propsSchema output shape.
   */
  readonly component: ComponentType<TProps>;
}

// ---------------------------------------------------------------------------
// AnyManifestEntry / ComponentRegistry — erasure types for the keyed registry
// ---------------------------------------------------------------------------

/**
 * Type-erased ManifestEntry for use in the ComponentRegistry map.
 * Props typed as Record<string, unknown> since the registry holds heterogeneous entries.
 * Plan 02 casts specific entries to this type when building COMPONENT_REGISTRY.
 */
export type AnyManifestEntry = ManifestEntry<Record<string, unknown>>;

/**
 * The component registry map: spec node type key → catalog manifest entry.
 * Readonly at the top level AND at the value level (AnyManifestEntry fields are readonly).
 *
 * Plan 02 exports `COMPONENT_REGISTRY: ComponentRegistry`.
 * The renderer does: `const entry = registry[node.type]` — O(1) keyed lookup.
 */
export type ComponentRegistry = Readonly<Record<string, AnyManifestEntry>>;
