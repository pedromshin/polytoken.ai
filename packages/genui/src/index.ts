/**
 * src/index.ts — Package root barrel for @nauta/genui.
 *
 * Re-exports all sub-modules so consumers can import from the package root.
 * Sub-path exports (catalog, schema, registry, renderer) are also available
 * via package.json exports for tree-shaking.
 */

export * from "./catalog/index";
export * from "./schema/index";
export * from "./registry/index";
export * from "./renderer/index";
