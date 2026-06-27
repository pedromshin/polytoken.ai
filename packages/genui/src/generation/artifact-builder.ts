/**
 * generation/artifact-builder.ts — Pure functions for building Bedrock artifacts (D-03 / D-22).
 *
 * This module is the single source of truth for the artifact payload structures.
 * Both the emit script (scripts/emit-bedrock-artifacts.ts) and the CI freshness
 * test (src/generation/__tests__/artifacts.test.ts) call buildGenuiPromptPayload()
 * directly to avoid duplication.
 *
 * Why separate from the emit script?
 *   - The emit script has Node.js fs side effects; tests must not touch the filesystem.
 *   - Importing a pure function allows the test to compare in-memory vs. committed.
 *
 * Bedrock compatibility constraints (CURRENCY-2026 §2 / D-22):
 *   - additionalProperties: false on every schema object (Bedrock constraint)
 *   - No external $ref (Bedrock forbids cross-schema references)
 *   - $refStrategy: "none" tells zod-to-json-schema to inline all sub-schemas
 *   - Stable enums (component types + allowed procedures) for 24h grammar cache
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

import { SpecRootSchema } from "../schema/spec-schema";
import { NAUTA_CATALOG, toCompactCatalog } from "../catalog/manifest";
import { REGISTRY_VERSION } from "../registry/registry-version";
import { ALLOWED_PROCEDURES } from "./allowed-procedures";

// ---------------------------------------------------------------------------
// Artifact path constants — absolute paths resolved from this module's location.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the genui package root. */
export const PACKAGE_ROOT: string = path.resolve(__dirname, "..", "..");

/** Directory where Bedrock artifacts are written. */
export const ARTIFACT_DIR: string = path.join(PACKAGE_ROOT, "artifacts");

/** Path to the JSON Schema artifact consumed by the Python generator. */
export const SPEC_SCHEMA_PATH: string = path.join(ARTIFACT_DIR, "spec.schema.json");

/** Path to the prompt payload artifact consumed by the Python system prompt. */
export const GENUI_PROMPT_PATH: string = path.join(ARTIFACT_DIR, "genui-prompt.json");

// ---------------------------------------------------------------------------
// ensureAdditionalPropertiesFalse — post-processor (D-22 / Bedrock requirement)
// ---------------------------------------------------------------------------

/**
 * Recursively walks a JSON Schema object and sets `additionalProperties: false`
 * on every `object` type node that does not already have it.
 *
 * Bedrock structured output REQUIRES additionalProperties:false on every object
 * (CURRENCY-2026 §2). zod-to-json-schema with .strict() already emits it for
 * Zod schemas built with .strict(), but this post-processor is a defense-in-depth
 * guard in case any inlined sub-schema slips through.
 *
 * This function is immutable: it returns a new object rather than mutating input.
 */
export function ensureAdditionalPropertiesFalse(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(ensureAdditionalPropertiesFalse);
  }

  const obj = schema as Record<string, unknown>;
  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    processed[key] = ensureAdditionalPropertiesFalse(value);
  }

  // Apply additionalProperties:false to object-type schemas
  if (processed["type"] === "object" && processed["additionalProperties"] === undefined) {
    return { ...processed, additionalProperties: false };
  }

  return processed;
}

// ---------------------------------------------------------------------------
// addHrefAbsoluteSchemeGuard — post-processor (CR-03 / SAFE-04)
// ---------------------------------------------------------------------------

/**
 * Recursively walks a JSON Schema and strengthens any href field that only has
 * `"pattern": "^\\/"` (startsWith guard) to also reject protocol-relative URLs
 * (//) and absolute schemes (javascript:, data:, https:, etc.).
 *
 * Why needed: zod-to-json-schema translates `.startsWith("/")` into the
 * JSON Schema pattern `^\/`, but it cannot translate the `.refine(noAbsoluteScheme)`
 * predicate — Zod refinements are not JSON Schema constructs. Without the guard,
 * `//evil.com` satisfies `^\/` and passes Bedrock constrained-decoding validation.
 *
 * The guard added: `"not": { "pattern": "^(//|[a-zA-Z][a-zA-Z0-9+\\-.]*:)" }`
 * This rejects any string starting with `//` (protocol-relative) or matching
 * `scheme:` (any letter-based URI scheme), mirroring the ABSOLUTE_OR_SCHEME_PATTERN
 * regex used by the Zod refinement in action-schema.ts.
 *
 * This function is immutable: it returns a new object rather than mutating input.
 */
export function addHrefAbsoluteSchemeGuard(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(addHrefAbsoluteSchemeGuard);
  }

  const obj = schema as Record<string, unknown>;

  // Detect the href field: string type with only startsWith pattern guard
  // Pattern: { "type": "string", "pattern": "^\\/" } (no existing `not` key)
  if (
    obj["type"] === "string" &&
    obj["pattern"] === "^\\/" &&
    !("not" in obj)
  ) {
    // This is the navigate-action href field (the only string field with this exact pattern).
    // Add the absolute-scheme rejection guard.
    return {
      ...obj,
      not: {
        pattern: "^(//|[a-zA-Z][a-zA-Z0-9+\\-.]*:)",
      },
    };
  }

  // Recursively process child nodes (returns new objects — immutable)
  const processed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    processed[key] = addHrefAbsoluteSchemeGuard(value);
  }
  return processed;
}

// ---------------------------------------------------------------------------
// buildSpecSchema — derive JSON Schema from Zod SpecRootSchema (D-03)
// ---------------------------------------------------------------------------

/**
 * Converts SpecRootSchema to a Bedrock-compatible JSON Schema.
 *
 * Configuration:
 *   - name: "SpecRoot" — top-level schema name (for $schema/$id clarity)
 *   - $refStrategy: "none" — inline all sub-schemas; Bedrock forbids external $ref
 *   - target: "jsonSchema7" — safe baseline; Bedrock accepts JSON Schema draft 7
 *
 * Root-shape normalization (BUG-B):
 *   zod-to-json-schema with `name` emits a wrapper root of the form
 *   `{ "$ref": "#/definitions/SpecRoot", "definitions": { "SpecRoot": {...} } }`.
 *   That root has NO top-level `"type"`. Anthropic/Bedrock REQUIRES the forced-tool
 *   `input_schema` root to carry `"type"` (otherwise every generation fails with
 *   `tools.0.custom.input_schema.type: Field required`). We therefore inline the
 *   SpecRoot definition up to the root (spreading its type/properties/required/
 *   additionalProperties) while KEEPING `definitions` so any internal `$ref`s still
 *   resolve, and retaining `$schema`. Key order is kept stable for the drift gate.
 *
 * Post-processing steps (applied in order):
 *   1. ensureAdditionalPropertiesFalse — Bedrock requires additionalProperties:false
 *      on every object (D-22 / CURRENCY-2026 §2).
 *   2. addHrefAbsoluteSchemeGuard — adds `not: { pattern }` to the navigate-action
 *      href field to reject protocol-relative URLs (//) and absolute schemes
 *      (javascript:, https:, etc.) — CR-03 / SAFE-04.
 *
 * Returns the processed schema as a plain object (not a string).
 */
export function buildSpecSchema(): Record<string, unknown> {
  const rawSchema = zodToJsonSchema(SpecRootSchema, {
    name: "SpecRoot",
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;

  const rootSchema = inlineNamedRoot(rawSchema, "SpecRoot");

  const withAdditionalProps = ensureAdditionalPropertiesFalse(rootSchema);
  return addHrefAbsoluteSchemeGuard(withAdditionalProps) as Record<string, unknown>;
}

/**
 * Normalizes a zod-to-json-schema `{ $ref, definitions, $schema }` wrapper into a
 * self-contained root object schema (BUG-B).
 *
 * Input:  `{ "$ref": "#/definitions/<name>", "definitions": {...}, "$schema": "..." }`
 * Output: `{ ...definitions[name], "definitions": {...}, "$schema": "..." }`
 *
 * The named definition's own fields (type/properties/required/additionalProperties)
 * are spread to the root so the schema has a top-level `"type"`. `definitions` is
 * retained so any internal `$ref` (e.g. recursive SpecNode references) still resolve;
 * `$schema` is preserved last. If the wrapper shape is absent (no root `$ref`), the
 * schema is returned unchanged. Pure/immutable: returns a new object.
 */
export function inlineNamedRoot(
  schema: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const ref = schema["$ref"];
  const definitions = schema["definitions"];
  if (ref !== `#/definitions/${name}` || definitions === null || typeof definitions !== "object") {
    return schema;
  }

  const defs = definitions as Record<string, unknown>;
  const named = defs[name];
  if (named === null || typeof named !== "object" || Array.isArray(named)) {
    return schema;
  }

  // Spread the named definition to the root, then re-attach definitions + $schema
  // (stable key order: definition fields first, then definitions, then $schema).
  const inlined: Record<string, unknown> = {
    ...(named as Record<string, unknown>),
    definitions: defs,
  };
  if ("$schema" in schema) {
    inlined["$schema"] = schema["$schema"];
  }
  return inlined;
}

// ---------------------------------------------------------------------------
// GenuiPromptPayload — shape of genui-prompt.json
// ---------------------------------------------------------------------------

/**
 * The action-rules summary embedded in genui-prompt.json.
 * This describes the constraints that the model must follow at generation time.
 */
export type ActionRules = {
  readonly navigateHref: string;
  readonly mutateSeam: string;
  readonly note: string;
};

/**
 * The full genui-prompt.json payload shape (D-22 / COST-01 / COST-03).
 *
 * Consumed by the Python generator to build the system prompt:
 *   - registryVersion: cache invalidation key (Phase 14 CACHE-04 seam)
 *   - components: compact catalog for the component vocabulary section
 *   - allowedProcedures: list for the data-binding section
 *   - actionRules: short prose rules for the action section
 */
export type GenuiPromptPayload = {
  readonly registryVersion: { readonly catalogId: string; readonly version: string };
  readonly components: ReadonlyArray<{
    readonly type: string;
    readonly description: string;
    readonly acceptsChildren: boolean;
    readonly slots: ReadonlyArray<string>;
    readonly lockedProps: ReadonlyArray<string>;
  }>;
  readonly allowedProcedures: ReadonlyArray<string>;
  readonly actionRules: ActionRules;
};

// Frozen static action-rules summary (immutable object, CLAUDE.md)
const ACTION_RULES: ActionRules = Object.freeze({
  navigateHref: "href MUST start with '/' and MUST NOT contain a scheme (e.g. https://) or protocol-relative URL (//). Use relative paths only.",
  mutateSeam: "ALLOWED_MUTATIONS is empty in v1.1 (SEAM-02). Do not emit mutate actions.",
  note: "All actions are validated by ActionSchema before render. Invalid actions cause render to fall back to SAFE_FALLBACK_SPEC.",
});

/**
 * Builds the genui-prompt.json payload as a plain serializable object.
 *
 * Pure function — no filesystem access, safe to call in tests.
 * The emit script calls this and writes the result; the freshness test
 * calls this and compares against the committed file.
 */
export function buildGenuiPromptPayload(): GenuiPromptPayload {
  return {
    registryVersion: { ...REGISTRY_VERSION },
    components: toCompactCatalog(NAUTA_CATALOG),
    allowedProcedures: [...ALLOWED_PROCEDURES],
    actionRules: ACTION_RULES,
  };
}
