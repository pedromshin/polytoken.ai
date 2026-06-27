/**
 * studio/describe-props-schema.ts
 *
 * Pure helper that introspects a Zod ZodObject propsSchema and returns a flat
 * array of PropDescriptor rows — one per top-level key.
 *
 * §12 Prop Schema Introspection Rules (15-UI-SPEC):
 *
 *   ZodString        → typeLabel:"string"
 *   ZodNumber        → typeLabel:"number"
 *   ZodBoolean       → typeLabel:"boolean"
 *   ZodLiteral       → typeLabel:String(value)
 *   ZodEnum          → typeLabel: values.join(" | ")
 *   ZodArray         → typeLabel:"array"
 *   ZodObject        → typeLabel:"object"
 *   ZodRecord        → typeLabel:"record"
 *   ZodOptional      → unwrap inner type + required:false
 *   ZodDefault       → unwrap inner type + required:false
 *   Any other        → typeLabel:"unknown"
 *   On any failure   → [] (never throws)
 *
 * Design constraints:
 *   - D-05 ADDITIVE ONLY — no generation/cache/renderer logic here.
 *   - Pure function: no side effects, no I/O, no React/Next imports.
 *   - CLAUDE.md: immutable — always returns a NEW array.
 *   - Named exports exclusively.
 *   - No eval / Function / dangerouslySetInnerHTML.
 */

import type { ZodTypeAny } from "zod";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export type PropDescriptor = {
  /** The prop key name (e.g. "aria-label"). */
  readonly name: string;
  /**
   * Human-readable type label per §12 mapping.
   * "unknown" for any Zod type not explicitly mapped.
   */
  readonly typeLabel: string;
  /** True when the prop is not wrapped in ZodOptional or ZodDefault. */
  readonly required: boolean;
  /** True when the prop name appears in the entry's lockedProps list. */
  readonly locked: boolean;
};

// ---------------------------------------------------------------------------
// Input type (structural — matches ManifestEntry shape without importing it)
// ---------------------------------------------------------------------------

type PropsEntry = {
  readonly propsSchema: ZodTypeAny;
  readonly lockedProps: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Unwrap ZodOptional / ZodDefault layers, returning { inner, required }. */
const unwrapOptional = (
  schema: ZodTypeAny,
): { inner: ZodTypeAny; required: boolean } => {
  const typeName = (schema as { _def?: { typeName?: string } })._def
    ?.typeName;

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    const inner = (
      schema as { _def: { innerType: ZodTypeAny } }
    )._def.innerType;
    return { inner, required: false };
  }

  return { inner: schema, required: true };
};

/** Resolve a (possibly-unwrapped) Zod type to a human-readable label. */
const resolveTypeLabel = (schema: ZodTypeAny): string => {
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (!def) return "unknown";

  const typeName = def["typeName"] as string | undefined;

  switch (typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodLiteral": {
      const value = def["value"];
      return String(value);
    }
    case "ZodEnum": {
      const values = def["values"] as ReadonlyArray<string> | undefined;
      return Array.isArray(values) ? values.join(" | ") : "unknown";
    }
    case "ZodArray":
      return "array";
    case "ZodObject":
      return "object";
    case "ZodRecord":
      return "record";
    default:
      return "unknown";
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Introspects the given entry's propsSchema and returns an immutable array
 * of PropDescriptor rows — one per top-level key.
 *
 * Returns [] on any failure (never throws) per §12.
 * Returns a NEW array on every call (CLAUDE.md: immutable).
 */
export const describePropsSchema = (entry: PropsEntry): ReadonlyArray<PropDescriptor> => {
  try {
    const schema = entry.propsSchema;
    if (schema == null) return [];

    const def = (schema as { _def?: Record<string, unknown> })._def;
    if (!def) return [];

    // Must be a ZodObject to have a shape
    const typeName = def["typeName"] as string | undefined;
    if (typeName !== "ZodObject") return [];

    // ZodObjectDef.shape is a function that returns the shape record
    const shapeAccessor = def["shape"];
    if (typeof shapeAccessor !== "function") return [];

    const shape: Record<string, ZodTypeAny> = shapeAccessor();
    if (!shape || typeof shape !== "object") return [];

    const lockedSet = new Set(entry.lockedProps);

    return Object.entries(shape).map(([name, fieldSchema]) => {
      const { inner, required } = unwrapOptional(fieldSchema);
      const typeLabel = resolveTypeLabel(inner);
      return {
        name,
        typeLabel,
        required,
        locked: lockedSet.has(name),
      };
    });
  } catch {
    // §12: on any failure → [] (never throws)
    return [];
  }
};
