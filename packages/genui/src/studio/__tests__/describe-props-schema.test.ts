/**
 * describe-props-schema.test.ts — unit tests for the describePropsSchema helper.
 *
 * Covers §12 Prop Schema Introspection Rules from 15-UI-SPEC:
 *   ZodString  → typeLabel:"string",  required:true  (non-optional)
 *   ZodOptional(ZodString) → typeLabel:"string", required:false
 *   ZodOptional(ZodEnum)   → typeLabel: values joined with " | ", required:false
 *   ZodOptional(ZodBoolean)→ typeLabel:"boolean", required:false
 *   ZodLiteral(true)       → typeLabel:"true"
 *   ZodArray               → typeLabel:"array"
 *   ZodObject              → typeLabel:"object"
 *   ZodRecord              → typeLabel:"record"
 *   lockedProps            → locked:true for matching prop name
 *   unknown/error          → returns [] (never throws)
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { describePropsSchema } from "../describe-props-schema";

// ---------------------------------------------------------------------------
// Helpers: minimal ManifestEntry-shaped objects (inline — avoids importing
// the real manifest, keeping this unit test self-contained).
// ---------------------------------------------------------------------------

const makeEntry = <TShape extends z.ZodRawShape>(
  shape: TShape,
  lockedProps: ReadonlyArray<string> = [],
) => ({
  propsSchema: z.object(shape).strict(),
  lockedProps,
});

// ---------------------------------------------------------------------------
// §12 type label mapping
// ---------------------------------------------------------------------------

describe("describePropsSchema — type label mapping (§12)", () => {
  it("ZodString (non-optional) → typeLabel:'string', required:true", () => {
    const entry = makeEntry({ content: z.string() });
    const rows = describePropsSchema(entry);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.name).toBe("content");
    expect(row.typeLabel).toBe("string");
    expect(row.required).toBe(true);
    expect(row.locked).toBe(false);
  });

  it("ZodNumber → typeLabel:'number', required:true", () => {
    const entry = makeEntry({ cols: z.number() });
    const rows = describePropsSchema(entry);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.typeLabel).toBe("number");
    expect(row.required).toBe(true);
  });

  it("ZodBoolean (non-optional) → typeLabel:'boolean', required:true", () => {
    const entry = makeEntry({ disabled: z.boolean() });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("boolean");
    expect(row.required).toBe(true);
  });

  it("ZodLiteral(true) → typeLabel:'true', required:true", () => {
    const entry = makeEntry({ "aria-hidden": z.literal(true) });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("true");
    expect(row.required).toBe(true);
  });

  it("ZodEnum → typeLabel: values joined with ' | ', required:true", () => {
    const entry = makeEntry({
      variant: z.enum(["default", "secondary", "destructive", "outline"]),
    });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("default | secondary | destructive | outline");
    expect(row.required).toBe(true);
  });

  it("ZodArray → typeLabel:'array'", () => {
    const entry = makeEntry({ items: z.array(z.string()) });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("array");
  });

  it("ZodObject (nested) → typeLabel:'object'", () => {
    const entry = makeEntry({ meta: z.object({ key: z.string() }) });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("object");
  });

  it("ZodRecord → typeLabel:'record'", () => {
    const entry = makeEntry({ data: z.record(z.string(), z.unknown()) });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("record");
  });

  it("unknown Zod type → typeLabel:'unknown'", () => {
    // ZodAny is not in the explicit mapping — should fall through to "unknown"
    const entry = makeEntry({ misc: z.any() });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Optional unwrapping
// ---------------------------------------------------------------------------

describe("describePropsSchema — ZodOptional unwrapping (§12)", () => {
  it("ZodOptional(ZodString) → required:false, typeLabel:'string'", () => {
    const entry = makeEntry({ content: z.string().optional() });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("string");
    expect(row.required).toBe(false);
  });

  it("ZodOptional(ZodEnum) → required:false, typeLabel: enum values joined", () => {
    const entry = makeEntry({
      variant: z.enum(["body", "label", "caption", "heading"]).optional(),
    });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("body | label | caption | heading");
    expect(row.required).toBe(false);
  });

  it("ZodOptional(ZodBoolean) → required:false, typeLabel:'boolean'", () => {
    const entry = makeEntry({ muted: z.boolean().optional() });
    const rows = describePropsSchema(entry);
    const [row] = rows;
    expect(row.typeLabel).toBe("boolean");
    expect(row.required).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockedProps
// ---------------------------------------------------------------------------

describe("describePropsSchema — lockedProps (§12)", () => {
  it("prop listed in lockedProps → locked:true", () => {
    const entry = makeEntry(
      { "aria-hidden": z.literal(true), orientation: z.string().optional() },
      ["aria-hidden"],
    );
    const rows = describePropsSchema(entry);
    const ariaRow = rows.find((r) => r.name === "aria-hidden");
    const orientationRow = rows.find((r) => r.name === "orientation");
    expect(ariaRow?.locked).toBe(true);
    expect(orientationRow?.locked).toBe(false);
  });

  it("no lockedProps → all locked:false", () => {
    const entry = makeEntry({ label: z.string() }, []);
    const rows = describePropsSchema(entry);
    expect(rows.every((r) => r.locked === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-prop schema (like the real button entry)
// ---------------------------------------------------------------------------

describe("describePropsSchema — multi-prop catalog entry", () => {
  it("button-like schema: all props returned with correct metadata", () => {
    const entry = makeEntry(
      {
        label: z.string(),
        "aria-label": z.string(),
        variant: z
          .enum(["default", "outline", "ghost", "destructive"])
          .optional(),
        size: z.enum(["sm", "md", "lg"]).optional(),
        disabled: z.boolean().optional(),
      },
      [],
    );
    const rows = describePropsSchema(entry);
    expect(rows).toHaveLength(5);

    const labelRow = rows.find((r) => r.name === "label");
    expect(labelRow?.required).toBe(true);
    expect(labelRow?.typeLabel).toBe("string");

    const ariaRow = rows.find((r) => r.name === "aria-label");
    expect(ariaRow?.required).toBe(true);

    const variantRow = rows.find((r) => r.name === "variant");
    expect(variantRow?.required).toBe(false);
    expect(variantRow?.typeLabel).toBe("default | outline | ghost | destructive");
  });
});

// ---------------------------------------------------------------------------
// Robustness (§12: on any failure → [], never throws)
// ---------------------------------------------------------------------------

describe("describePropsSchema — robustness (§12)", () => {
  it("schema with no _def.shape → returns [] (never throws)", () => {
    // ZodString is not a ZodObject — shape() will not exist
    const entry = {
      propsSchema: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
      lockedProps: [] as ReadonlyArray<string>,
    };
    let result: unknown;
    expect(() => {
      result = describePropsSchema(entry);
    }).not.toThrow();
    expect(result).toEqual([]);
  });

  it("null propsSchema → returns [] (never throws)", () => {
    const entry = {
      propsSchema: null as unknown as z.ZodObject<z.ZodRawShape>,
      lockedProps: [] as ReadonlyArray<string>,
    };
    let result: unknown;
    expect(() => {
      result = describePropsSchema(entry);
    }).not.toThrow();
    expect(result).toEqual([]);
  });

  it("returns new array on each call (immutability — CLAUDE.md)", () => {
    const entry = makeEntry({ label: z.string() });
    const a = describePropsSchema(entry);
    const b = describePropsSchema(entry);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
