/**
 * schema/spec-schema.ts — Full Zod discriminated-union spec tree.
 *
 * Bedrock-structured-output-compatible from day one:
 *   - Every z.object ends in .strict() (additionalProperties:false, D-22 / COST-02)
 *   - No external $ref — all schemas are inline
 *   - Stable module-level schemas (not built per-request)
 *   - Leading _plan field reserved for reasoning, stripped before render (D-22)
 *
 * Key constraints:
 *   - Zod v3 ONLY — v4 is incompatible with Bedrock structured output (D-09)
 *   - Recursion via z.lazy() with explicit z.ZodType<SpecNode[]> annotation (§9 Pitfall 1)
 *   - v: z.literal(1) at root (SEAM-01 / D-10)
 *   - State primitives + dataRefs are typed strings, no executable code (SPEC-04/05)
 *
 * File ordering:
 *   1. Bound constants
 *   2. Forward-reference proxy for z.lazy recursion
 *   3. Leaf schemas (no recursion needed)
 *   4. Container schemas (use z.lazy via proxy)
 *   5. SpecNodeSchema discriminated union + wire proxy
 *   6. SpecNode type alias + ChildrenSchema explicit annotation
 *   7. StateDeclarationSchema + SpecRootSchema
 *   8. Walker utilities
 */

import { z } from "zod";

// ===========================================================================
// SECTION 1: Bound constants (D-24 / SAFE-06 seam)
// ===========================================================================

/** Maximum total nodes in a spec tree. Enforced via root .refine(). */
export const MAX_SPEC_NODES = 200;

/** Maximum nesting depth of a spec tree. Enforced via root .refine(). */
export const MAX_SPEC_DEPTH = 8;

// ===========================================================================
// SECTION 2: Forward-reference proxy for recursive fields
//
// z.discriminatedUnion requires ZodObject options — we cannot annotate container
// schemas as z.ZodType<SpecNode> (that would make them ZodType, not ZodObject).
// Instead, container schemas use z.lazy(lazySpecNode) on individual FIELDS,
// cast to z.ZodTypeAny at the field level only. The schema variable itself
// remains a ZodObject so discriminatedUnion accepts it.
//
// _specNodeSchemaRef starts as z.any() (a safe no-op schema) and is replaced
// with the real SpecNodeSchema immediately after its construction in SECTION 5.
// z.lazy defers evaluation until first parse — by then the ref is wired.
// ===========================================================================

let _specNodeSchemaRef: z.ZodTypeAny = z.any();
const lazySpecNode = (): z.ZodTypeAny => _specNodeSchemaRef;

// ===========================================================================
// SECTION 3: Leaf node schemas — no recursion
// Each object ends in .strict() per D-22.
// ===========================================================================

const TextNodeSchema = z
  .object({
    type: z.literal("text"),
    content: z.string(),
    variant: z.enum(["body", "label", "caption", "heading"]).optional(),
    muted: z.boolean().optional(),
  })
  .strict();

const BadgeNodeSchema = z
  .object({
    type: z.literal("badge"),
    label: z.string(),
    variant: z
      .enum(["default", "secondary", "destructive", "outline"])
      .optional(),
  })
  .strict();

/** button — `action` is a declared string ID — never executable code. (SPEC-04/05) */
const ButtonNodeSchema = z
  .object({
    type: z.literal("button"),
    label: z.string(),
    "aria-label": z.string(), // a11y-required (D-04 / UI-SPEC §11) — matches manifest propsSchema
    variant: z
      .enum(["default", "outline", "ghost", "destructive"])
      .optional(),
    size: z.enum(["sm", "md", "lg"]).optional(),
    action: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const SeparatorNodeSchema = z
  .object({
    type: z.literal("separator"),
    "aria-hidden": z.literal(true), // locked + a11y-required (D-04 / UI-SPEC §11) — matches manifest propsSchema
    orientation: z.enum(["horizontal", "vertical"]).optional(),
  })
  .strict();

/** alert — title is REQUIRED (a11y, D-04). NOT optional. */
const AlertNodeSchema = z
  .object({
    type: z.literal("alert"),
    title: z.string(),
    description: z.string().optional(),
    variant: z.enum(["default", "destructive"]).optional(),
  })
  .strict();

/** key-value-list — static key-value pairs rendered as <dl> (a11y label required, D-04). */
const KeyValueListNodeSchema = z
  .object({
    type: z.literal("key-value-list"),
    label: z.string(), // a11y-required list aria-label (D-04 / UI-SPEC §11) — matches manifest propsSchema
    items: z
      .array(
        z
          .object({
            key: z.string(),
            value: z.string(), // static string value — matches manifest propsSchema
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** table — caption is REQUIRED (a11y, D-04). NOT optional. */
const TableNodeSchema = z
  .object({
    type: z.literal("table"),
    caption: z.string(),
    columns: z
      .array(
        z
          .object({
            key: z.string(),
            header: z.string(),
          })
          .strict(),
      )
      .min(1),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

// ===========================================================================
// SECTION 4: Container / recursive node schemas
//
// These schemas reference _specNodeSchemaRef via z.lazy(lazySpecNode).
// The z.lazy() result is cast to z.ZodTypeAny at the FIELD level only.
// The schema VARIABLE itself remains a ZodObject — required by discriminatedUnion.
// ===========================================================================

/** card — optional title, description, positional children, and named header/footer slots. */
const CardNodeSchema = z
  .object({
    type: z.literal("card"),
    title: z.string().optional(),
    description: z.string().optional(),
    children: z.lazy(lazySpecNode).array().optional() as z.ZodTypeAny,
    header: z.lazy(lazySpecNode).optional() as z.ZodTypeAny,
    footer: z.lazy(lazySpecNode).optional() as z.ZodTypeAny,
  })
  .strict();

/** stack — flex column/row container. children[] is required. */
const StackNodeSchema = z
  .object({
    type: z.literal("stack"),
    direction: z.enum(["vertical", "horizontal"]).optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
  })
  .strict();

/** grid — CSS grid container. cols clamped 1-12. */
const GridNodeSchema = z
  .object({
    type: z.literal("grid"),
    cols: z.number().int().min(1).max(12).optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
  })
  .strict();

/**
 * list — Iterates over dataRef array (no eval, SPEC-05).
 * itemKey names the field used as React key (D-15).
 */
const ListNodeSchema = z
  .object({
    type: z.literal("list"),
    dataRef: z.string(),
    itemKey: z.string(),
    itemTemplate: z.lazy(lazySpecNode) as z.ZodTypeAny,
    emptyState: z.lazy(lazySpecNode).optional() as z.ZodTypeAny,
  })
  .strict();

/** conditional — Safe boolean branch. All refs are dotted-path strings — no eval (SPEC-05). */
const ConditionalNodeSchema = z
  .object({
    type: z.literal("conditional"),
    condition: z
      .object({
        dataRef: z.string(),
        operator: z.enum(["eq", "neq", "truthy", "falsy", "gt", "lt"]),
        value: z
          .union([z.string(), z.number(), z.boolean(), z.null()])
          .optional(),
      })
      .strict(),
    then: z.lazy(lazySpecNode) as z.ZodTypeAny,
    else: z.lazy(lazySpecNode).optional() as z.ZodTypeAny,
  })
  .strict();

// ===========================================================================
// SECTION 5: SpecNodeSchema — discriminated union
//
// All 12 options are ZodObject instances (leaf schemas are plain ZodObject;
// container schemas have z.ZodTypeAny casts on individual FIELDS only, not
// on the schema variable itself). This satisfies ZodDiscriminatedUnionOption.
//
// After assignment, wire _specNodeSchemaRef immediately so z.lazy() callbacks
// resolve to the real schema at first parse.
// ===========================================================================

const SpecNodeSchema = z.discriminatedUnion("type", [
  TextNodeSchema,
  BadgeNodeSchema,
  ButtonNodeSchema,
  SeparatorNodeSchema,
  AlertNodeSchema,
  KeyValueListNodeSchema,
  TableNodeSchema,
  CardNodeSchema,
  StackNodeSchema,
  GridNodeSchema,
  ListNodeSchema,
  ConditionalNodeSchema,
]);

// Wire the lazy reference immediately after construction.
_specNodeSchemaRef = SpecNodeSchema;

/** Inferred type for any spec node (from the discriminated union). */
export type SpecNode = z.infer<typeof SpecNodeSchema>;

/**
 * ChildrenSchema — explicit z.ZodType<SpecNode[]> annotation is the critical
 * fix for Zod v3 + z.discriminatedUnion recursion (SPEC-RENDERER.md §9 Pitfall 1).
 * Without this annotation TypeScript infers ZodLazy<...> which does not satisfy
 * the ZodType constraint when used in discriminated union option fields.
 *
 * Defined AFTER SpecNodeSchema and SpecNode to avoid circular references.
 */
export const ChildrenSchema: z.ZodType<SpecNode[]> = z.lazy(() =>
  z.array(SpecNodeSchema),
);

/** Export SpecNodeSchema for downstream use (renderer, tests). */
export { SpecNodeSchema };

// ===========================================================================
// SECTION 6: State declarations (SPEC-04 / D-11)
// ===========================================================================

/**
 * StateDeclarationSchema — declared state primitive.
 *
 * State is materialised by the interpreter (useDeclaredState) into a
 * useReducer store. The spec contains NO executable code — only typed
 * declarations and a restricted mutation enum (SPEC-04 / D-11).
 *
 * Mutations: toggle (bool flip), set (assign value), reset (to initial),
 * increment / decrement (numeric ±1).
 */
export const StateDeclarationSchema = z
  .object({
    name: z.string(),
    type: z.enum(["boolean", "string", "number", "null"]),
    initial: z.union([z.boolean(), z.string(), z.number(), z.null()]),
    actions: z
      .array(
        z
          .object({
            name: z.string(),
            mutation: z.enum([
              "toggle",
              "set",
              "reset",
              "increment",
              "decrement",
            ]),
            value: z
              .union([z.boolean(), z.string(), z.number(), z.null()])
              .optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type StateDeclaration = z.infer<typeof StateDeclarationSchema>;

// ===========================================================================
// SECTION 7: Spec root schema (SEAM-01 / D-10 / D-22)
// ===========================================================================

/**
 * SpecRootSchema — the top-level spec envelope.
 *
 * Fields:
 *   _plan  — reserved reasoning field, stripped before renderNode in Phase 13 (D-22)
 *   v      — schema version literal 1 (SEAM-01 / D-10)
 *   data   — named data bindings injected at render time
 *   state  — declared state primitives materialised by useDeclaredState
 *   root   — the component tree (SpecNode, recursive via z.lazy)
 *
 * Bound refinements (D-24 / SAFE-06): countNodes <= MAX_SPEC_NODES,
 * specDepth <= MAX_SPEC_DEPTH.
 */
export const SpecRootSchema = z
  .object({
    _plan: z.string().optional(),
    v: z.literal(1),
    data: z.record(z.string(), z.unknown()).optional(),
    state: z.array(StateDeclarationSchema).optional(),
    root: z.lazy(lazySpecNode) as z.ZodTypeAny,
  })
  .strict()
  .refine(
    (spec) => countNodes(spec.root as SpecNode) <= MAX_SPEC_NODES,
    {
      message: `Spec exceeds MAX_SPEC_NODES (${MAX_SPEC_NODES})`,
      path: ["root"],
    },
  )
  .refine(
    (spec) => specDepth(spec.root as SpecNode) <= MAX_SPEC_DEPTH,
    {
      message: `Spec exceeds MAX_SPEC_DEPTH (${MAX_SPEC_DEPTH})`,
      path: ["root"],
    },
  );

export type SpecRoot = z.infer<typeof SpecRootSchema>;

// ===========================================================================
// SECTION 8: Bound walker utilities (D-24 / SAFE-06 seam)
// ===========================================================================

/**
 * countNodes — counts total nodes in a spec tree (root inclusive).
 * Pure recursive function; used by SpecRootSchema .refine() guard.
 *
 * budget parameter provides a stack-depth guard (IN-01): if remaining budget
 * hits zero the function returns an over-budget value immediately, preventing
 * a RangeError from propagating out of safeParse as an unhandled exception.
 */
export function countNodes(node: SpecNode, budget: number = MAX_SPEC_NODES + 1): number {
  if (budget <= 0) return MAX_SPEC_NODES + 1; // early-exit: over budget
  let count = 1;
  const n = node as Record<string, unknown>;

  if (Array.isArray(n["children"])) {
    for (const child of n["children"] as SpecNode[]) {
      count += countNodes(child, budget - count);
    }
  }
  if (n["header"] != null) count += countNodes(n["header"] as SpecNode, budget - count);
  if (n["footer"] != null) count += countNodes(n["footer"] as SpecNode, budget - count);
  if (n["itemTemplate"] != null) count += countNodes(n["itemTemplate"] as SpecNode, budget - count);
  if (n["emptyState"] != null) count += countNodes(n["emptyState"] as SpecNode, budget - count);
  if (n["then"] != null) count += countNodes(n["then"] as SpecNode, budget - count);
  if (n["else"] != null) count += countNodes(n["else"] as SpecNode, budget - count);

  return count;
}

/**
 * specDepth — returns the maximum nesting depth of a spec tree (root = 1).
 * Pure recursive function; used by SpecRootSchema .refine() guard.
 *
 * limit parameter provides a stack-depth guard (IN-01): if the remaining limit
 * hits zero the function returns an over-limit value immediately, preventing
 * a RangeError from propagating out of safeParse as an unhandled exception.
 */
export function specDepth(node: SpecNode, limit: number = MAX_SPEC_DEPTH + 5): number {
  if (limit <= 0) return MAX_SPEC_DEPTH + 1; // early-exit: over limit
  const n = node as Record<string, unknown>;
  const children: SpecNode[] = [];

  if (Array.isArray(n["children"])) children.push(...(n["children"] as SpecNode[]));
  if (n["header"] != null) children.push(n["header"] as SpecNode);
  if (n["footer"] != null) children.push(n["footer"] as SpecNode);
  if (n["itemTemplate"] != null) children.push(n["itemTemplate"] as SpecNode);
  if (n["emptyState"] != null) children.push(n["emptyState"] as SpecNode);
  if (n["then"] != null) children.push(n["then"] as SpecNode);
  if (n["else"] != null) children.push(n["else"] as SpecNode);

  let maxChildDepth = 0;
  for (const child of children) {
    const d = specDepth(child, limit - 1);
    if (d > maxChildDepth) maxChildDepth = d;
  }

  return 1 + maxChildDepth;
}
