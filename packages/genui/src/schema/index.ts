/**
 * schema/index.ts — Public re-exports for @nauta/genui/schema
 *
 * Exports all schemas, inferred types, bound constants, and walker utilities
 * from spec-schema.ts. Downstream plans (renderer, demo) import from here.
 */

export {
  // Schemas
  StateDeclarationSchema,
  SpecNodeSchema,
  SpecRootSchema,
  ChildrenSchema,
  // Bound constants (D-24)
  MAX_SPEC_NODES,
  MAX_SPEC_DEPTH,
  // Bound walkers
  countNodes,
  specDepth,
} from "./spec-schema";

export type {
  // Inferred types
  SpecNode,
  SpecRoot,
  StateDeclaration,
} from "./spec-schema";
