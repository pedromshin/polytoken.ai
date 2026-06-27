/**
 * generation/__tests__/artifacts.test.ts — CI freshness drift-gate (D-03 / T-13-06).
 *
 * Verifies that the committed artifacts (spec.schema.json + genui-prompt.json) exactly
 * match the freshly generated payloads derived from the Zod source.
 *
 * If any Zod schema change causes the emitted JSON to differ from the committed files,
 * these tests fail — prompting the developer to re-run `pnpm gen:artifacts` and commit
 * the updated artifacts. This prevents the Python generator from targeting a stale schema.
 *
 * Test suite:
 *   1. spec.schema.json exists and is valid JSON
 *   2. spec.schema.json deep-equals freshly generated spec schema (drift gate)
 *   3. spec.schema.json root has additionalProperties:false (Bedrock requirement, D-22)
 *   4. spec.schema.json contains the component-type enum (D-12 — constrained decoding)
 *   5. spec.schema.json contains no external $ref (Bedrock forbids cross-schema $ref)
 *   6. genui-prompt.json exists and is valid JSON
 *   7. genui-prompt.json deep-equals freshly generated prompt payload (drift gate)
 *   8. genui-prompt.json.allowedProcedures deep-equals ALLOWED_PROCEDURES constant
 *   9. spec.schema.json has additionalProperties:false on >= 2 object nodes (root + nested)
 */

import fs from "node:fs";
import { describe, it, expect } from "vitest";

import {
  SPEC_SCHEMA_PATH,
  GENUI_PROMPT_PATH,
  buildSpecSchema,
  buildGenuiPromptPayload,
} from "../artifact-builder";
import { ALLOWED_PROCEDURES } from "../allowed-procedures";
import { REGISTERED_TYPES } from "../../registry/component-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCommittedJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

/**
 * Counts how many times `additionalProperties: false` appears in a serialized
 * JSON Schema string (covers root + all nested object nodes).
 */
function countAdditionalPropertiesFalse(schema: unknown): number {
  return (JSON.stringify(schema).match(/"additionalProperties":false/g) ?? []).length;
}

/**
 * Checks whether the schema string contains any external $ref (http/https URLs).
 * Internal $defs references like "#/$defs/..." are acceptable if present,
 * but with $refStrategy:"none" there should be none at all.
 */
function hasExternalRef(schema: unknown): boolean {
  const str = JSON.stringify(schema);
  return /"\$ref"\s*:\s*"https?:/.test(str);
}

// ---------------------------------------------------------------------------
// spec.schema.json suite
// ---------------------------------------------------------------------------

describe("spec.schema.json (Bedrock JSON Schema artifact)", () => {
  it("file exists and is valid JSON", () => {
    expect(() => readCommittedJson(SPEC_SCHEMA_PATH)).not.toThrow();
  });

  it("matches freshly generated spec schema (drift gate)", () => {
    const committed = readCommittedJson(SPEC_SCHEMA_PATH);
    const fresh = buildSpecSchema();
    // Canonical comparison: stringify both sorted to ignore key-order differences
    expect(JSON.parse(JSON.stringify(committed))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("root has additionalProperties:false (Bedrock requirement, D-22)", () => {
    const schema = readCommittedJson(SPEC_SCHEMA_PATH) as Record<string, unknown>;
    expect(schema["additionalProperties"]).toBe(false);
  });

  it("contains additionalProperties:false on at least 2 objects (root + nested, D-22)", () => {
    const schema = readCommittedJson(SPEC_SCHEMA_PATH);
    const count = countAdditionalPropertiesFalse(schema);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("contains the component-type enum derived from registry keys (D-12)", () => {
    const schema = readCommittedJson(SPEC_SCHEMA_PATH);
    const schemaStr = JSON.stringify(schema);
    // Every registered type must appear somewhere in the schema
    for (const type of REGISTERED_TYPES) {
      expect(schemaStr).toContain(JSON.stringify(type));
    }
  });

  it("contains no external $ref (Bedrock forbids cross-schema references)", () => {
    const schema = readCommittedJson(SPEC_SCHEMA_PATH);
    expect(hasExternalRef(schema)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// genui-prompt.json suite
// ---------------------------------------------------------------------------

describe("genui-prompt.json (Python prompt payload)", () => {
  it("file exists and is valid JSON", () => {
    expect(() => readCommittedJson(GENUI_PROMPT_PATH)).not.toThrow();
  });

  it("matches freshly generated prompt payload (drift gate)", () => {
    const committed = readCommittedJson(GENUI_PROMPT_PATH);
    const fresh = buildGenuiPromptPayload();
    expect(JSON.parse(JSON.stringify(committed))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("allowedProcedures deep-equals ALLOWED_PROCEDURES constant (D-13)", () => {
    const committed = readCommittedJson(GENUI_PROMPT_PATH) as {
      allowedProcedures: ReadonlyArray<string>;
    };
    expect(committed.allowedProcedures).toEqual([...ALLOWED_PROCEDURES]);
  });

  it("registryVersion has catalogId and version fields", () => {
    const committed = readCommittedJson(GENUI_PROMPT_PATH) as {
      registryVersion: { catalogId: string; version: string };
    };
    expect(committed.registryVersion.catalogId).toBe("global");
    expect(typeof committed.registryVersion.version).toBe("string");
    expect(committed.registryVersion.version.length).toBe(64); // SHA-256 hex
  });

  it("components array has an entry for each registered type", () => {
    const committed = readCommittedJson(GENUI_PROMPT_PATH) as {
      components: ReadonlyArray<{ type: string }>;
    };
    const committedTypes = committed.components.map((c) => c.type).sort();
    expect(committedTypes).toEqual([...REGISTERED_TYPES].sort());
  });

  it("actionRules contains navigateHref constraint", () => {
    const committed = readCommittedJson(GENUI_PROMPT_PATH) as {
      actionRules: { navigateHref: string };
    };
    expect(committed.actionRules.navigateHref).toContain("/");
  });
});
