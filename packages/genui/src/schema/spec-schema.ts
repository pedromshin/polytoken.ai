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

import { DataBindingSchema } from "./data-binding-schema";
import { ActionSchema } from "./action-schema";
import { StylePackIdSchema } from "./token-props-schema";

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
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

const BadgeNodeSchema = z
  .object({
    type: z.literal("badge"),
    label: z.string(),
    variant: z
      .enum(["default", "secondary", "destructive", "outline"])
      .optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * button — `action` is a declared string ID for the Phase-12 ActionRegistry (SPEC-04/05).
 * `onClick` is the Phase-13 ActionSchema union (D-14/D-23):
 *   - Uses a NEW field name to avoid breaking existing renderer code that reads `action`
 *     as an ActionRegistry key string.
 *   - onClick: ActionSchema (navigate/setState/mutate) — validated at the Zod layer (D-15)
 */
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
    // Phase-13 action binding (D-14/D-23): validated ActionSchema union, NOT the Phase-12
    // string ActionRegistry key. New field to preserve backward compat with existing renderer.
    onClick: ActionSchema.optional(),
    disabled: z.boolean().optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

const SeparatorNodeSchema = z
  .object({
    type: z.literal("separator"),
    "aria-hidden": z.literal(true), // locked + a11y-required (D-04 / UI-SPEC §11) — matches manifest propsSchema
    orientation: z.enum(["horizontal", "vertical"]).optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/** alert — title is REQUIRED (a11y, D-04). NOT optional. */
const AlertNodeSchema = z
  .object({
    type: z.literal("alert"),
    title: z.string(),
    description: z.string().optional(),
    variant: z.enum(["default", "destructive"]).optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
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
    colSpan: z.number().int().min(1).max(12).optional(),
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
    colSpan: z.number().int().min(1).max(12).optional(),
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
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/** stack — flex column/row container. children[] is required. */
const StackNodeSchema = z
  .object({
    type: z.literal("stack"),
    direction: z.enum(["vertical", "horizontal"]).optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/** grid — CSS grid container. cols clamped 1-12. */
const GridNodeSchema = z
  .object({
    type: z.literal("grid"),
    cols: z.number().int().min(1).max(12).optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
    colSpan: z.number().int().min(1).max(12).optional(),
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
// SECTION 4b: Phase 18 — new node schemas (avatar, input, nav, feed-item, tabs, section)
//
// Wire schema rules (18-01 Task 1):
//   - Every schema ends in .strict() (D-22 / COST-02 / Bedrock requirement)
//   - a11y-required fields are z.string() NOT optional (D-04 / UI-SPEC §11)
//   - nav href: reuses relative-href guard from action-schema.ts (SAFE-04)
//   - input uses `inputType` (NOT `type`) to avoid discriminant collision (GOTCHA-1)
//   - FeedItemNodeSchema: plain .object().strict() — NO .refine() (GOTCHA-2, ZodEffects
//     breaks discriminatedUnion)
//   - SectionNodeSchema uses z.lazy(lazySpecNode).array() for children (GOTCHA-3)
//   - colSpan: bounded integer 1-12 — added to all leaf + container schemas (Phase 18)
// ===========================================================================

/**
 * Relative-href guard for nav items.
 * Inlined from action-schema.ts pattern (SAFE-04) to avoid circular import.
 * Regex: matches absolute scheme (letter+ colon) or protocol-relative (//).
 */
const NAV_ABSOLUTE_OR_SCHEME = /^([a-z][a-z0-9+\-.]*:|\/\/)/i;
function navHrefIsSafe(href: string): boolean {
  return !NAV_ABSOLUTE_OR_SCHEME.test(href);
}

/** avatar — circular image with required alt text (a11y, D-04). */
const AvatarNodeSchema = z
  .object({
    type: z.literal("avatar"),
    src: z.string().optional(),
    alt: z.string(), // a11y-required (D-04 / UI-SPEC §11)
    size: z.enum(["sm", "md", "lg"]).optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * input — controlled text/email/number input.
 * Uses `inputType` (NOT `type`) to avoid collision with the discriminant field (GOTCHA-1).
 * label is REQUIRED (a11y, D-04).
 */
const InputNodeSchema = z
  .object({
    type: z.literal("input"),
    label: z.string(), // a11y-required (D-04 / UI-SPEC §11)
    name: z.string(),
    inputType: z.enum(["text", "email", "number", "password", "search", "tel", "url"]).optional(),
    placeholder: z.string().optional(),
    value: z.string().optional(),
    disabled: z.boolean().optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * nav — navigation link list.
 * aria-label is REQUIRED (a11y, D-04).
 * href fields are relative-only (SAFE-04 guard inlined from action-schema.ts).
 */
const NavNodeSchema = z
  .object({
    type: z.literal("nav"),
    "aria-label": z.string(), // a11y-required (D-04 / UI-SPEC §11)
    items: z
      .array(
        z
          .object({
            label: z.string(),
            href: z
              .string()
              .startsWith("/", { message: "nav href must start with / (relative paths only)" })
              .refine(navHrefIsSafe, {
                message:
                  "nav href must not use an absolute scheme or protocol-relative URL (SAFE-04)",
              }),
            icon: z.string().optional(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * feed-item — single card-like item in a news/email feed.
 * title is REQUIRED (a11y, D-04).
 * NO .refine() here — ZodEffects breaks discriminatedUnion (GOTCHA-2).
 * The avatarAlt-required-when-avatarSrc constraint lives only in manifest propsSchema.
 */
const FeedItemNodeSchema = z
  .object({
    type: z.literal("feed-item"),
    title: z.string(), // a11y-required (D-04 / UI-SPEC §11)
    subtitle: z.string().optional(),
    body: z.string().optional(),
    timestamp: z.string().optional(),
    avatarSrc: z.string().optional(),
    avatarAlt: z.string().optional(),
    badge: z.string().optional(),
    unread: z.boolean().optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * tabs — tabbed panel widget.
 * aria-label is REQUIRED (a11y, D-04).
 */
const TabsNodeSchema = z
  .object({
    type: z.literal("tabs"),
    "aria-label": z.string(), // a11y-required (D-04 / UI-SPEC §11)
    tabs: z
      .array(
        z
          .object({
            value: z.string(),
            label: z.string(),
            content: z.lazy(lazySpecNode) as z.ZodTypeAny,
          })
          .strict(),
      )
      .min(1),
    defaultValue: z.string().optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * section — semantic page section with optional heading, layout gap, and children.
 * Children use z.lazy for recursion (GOTCHA-3).
 * The schema variable is ZodObject (not ZodEffects) — discriminatedUnion compatible.
 */
const SectionNodeSchema = z
  .object({
    type: z.literal("section"),
    heading: z.string().optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
    colSpan: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * form field-spec shared schemas (Phase 19). Exported so the manifest propsSchema imports the
 * SAME definitions — the wire ↔ render contract cannot drift by construction.
 */
export const FieldConditionSchema = z
  .object({
    field: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

export const FormFieldTypeSchema = z.enum([
  "text",
  "email",
  "number",
  "tel",
  "url",
  "password",
  "textarea",
  "select",
  "checkbox",
  "radio",
]);

export const FormFieldSchema = z
  .object({
    name: z.string(),
    label: z.string(), // a11y-required (D-04 / UI-SPEC §11)
    fieldType: FormFieldTypeSchema.optional(), // NOT `type` — avoids discriminant collision (GOTCHA-1)
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    options: z
      .array(z.object({ label: z.string(), value: z.string() }).strict())
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    pattern: z.string().optional(),
    helpText: z.string().optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
    visibleWhen: FieldConditionSchema.optional(),
    requiredWhen: FieldConditionSchema.optional(),
  })
  .strict();

/**
 * form — declarative, zero-eval form (Phase 19). Fields + conditional logic + validation as DATA.
 * onSubmit binds to the allowlisted ActionSchema seam (SEAM-02 / FORM-04) — no arbitrary endpoint.
 */
const FormNodeSchema = z
  .object({
    type: z.literal("form"),
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(FormFieldSchema).min(1),
    submitLabel: z.string().optional(),
    onSubmit: ActionSchema.optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
    // 24-05 fix pass (24-UI-REVIEW.md Top Fix #1): opt-in flag a host chrome (e.g.
    // InteractiveWidgetBoundary) sets to suppress FormComponent's own internal
    // "Submitted ✓" affordance when that host already owns the submitted/submitting
    // signal. Defaults to unset/false — every existing (Phase-19 studio) spec keeps
    // rendering "Submitted ✓" exactly as before.
    hideOwnSubmittedAffordance: z.boolean().optional(),
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
  AvatarNodeSchema,
  InputNodeSchema,
  NavNodeSchema,
  FeedItemNodeSchema,
  TabsNodeSchema,
  SectionNodeSchema,
  FormNodeSchema,
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
 *   _plan    — reserved reasoning field, stripped before renderNode in Phase 13 (D-22)
 *   v        — schema version literal 1 (SEAM-01 / D-10)
 *   data     — static data injected at render time (existing Phase-12 field)
 *   bindings — named DataBinding queries resolved at render time via allowlisted tRPC
 *              procedures (D-13/D-23). Each key is a binding name; each value is a
 *              DataBindingSchema { procedure, params? }. Live IDs are NOT embedded here
 *              (GR-15 / D-13a) — they resolve from session/route context at render time.
 *   state    — declared state primitives materialised by useDeclaredState
 *   root     — the component tree (SpecNode, recursive via z.lazy)
 *
 * Bound refinements (D-24 / SAFE-06): countNodes <= MAX_SPEC_NODES,
 * specDepth <= MAX_SPEC_DEPTH.
 */
export const SpecRootSchema = z
  .object({
    _plan: z.string().optional(),
    v: z.literal(1),
    // Style pack selection (D-08/STYLE-04): optional — defaults to "nauta-teal" at render time.
    // Only known StylePackId strings are accepted (enforced by StylePackIdSchema).
    style_pack_id: StylePackIdSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    bindings: z.record(z.string(), DataBindingSchema).optional(),
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
