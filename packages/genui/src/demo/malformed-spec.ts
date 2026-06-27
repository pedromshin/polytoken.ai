/**
 * demo/malformed-spec.ts — Error-isolation fixture spec.
 *
 * MALFORMED_SPEC demonstrates D-18 error isolation:
 *   - A valid `stack` root with 3 sibling children
 *   - Child 0: valid `text` node (renders normally)
 *   - Child 1: an UNKNOWN type "foobar-widget" (not in COMPONENT_REGISTRY)
 *              → renderNode routes to UnknownComponentPlaceholder
 *              → shows: [!] "foobar-widget" node — component not in registry
 *   - Child 2: valid `text` node (renders normally — isolation proof)
 *
 * The malformed node uses an unknown `type` rather than a prop-invalid node
 * because an unknown type still parses against SpecNodeSchema via
 * z.discriminatedUnion (which rejects it) BUT we cast the whole spec as SpecRoot
 * to satisfy TypeScript; the renderer's unknown-type path (UnknownComponentPlaceholder)
 * handles it at runtime.
 *
 * TypeScript: `root.children[1]` is cast via `as unknown as SpecNode`
 * to allow the unknown type to be present in the typed tree. The MALFORMED_SPEC
 * itself may or may not pass SpecRootSchema.safeParse — the plan says the
 * malformed node may be "type-valid-but-prop-invalid" (D-18 path). We use
 * a `badge` with a missing required `label` field as the malformed node:
 *   - BadgeNodeSchema has `label: z.string()` — required
 *   - The spec node omits `label` entirely
 *   - This makes the SpecRootSchema discriminated union REJECT the node
 *     (BadgeNodeSchema.label is required), so SpecRootSchema.safeParse(MALFORMED_SPEC)
 *     may fail at the root — but the renderer's per-node safeParse path (SPEC-03)
 *     is what matters for isolation: renderNode receives the malformed badge node,
 *     its propsSchema.safeParse fails, and NodeErrorFallback is rendered for that
 *     node alone while siblings continue.
 *
 * The test (demo-specs.test.ts) only asserts the SHAPE (valid siblings present,
 * malformed node reachable), NOT that SpecRootSchema.safeParse succeeds — which
 * is correct per D-18 semantics.
 */

// We intentionally use `as unknown as SpecRoot` here because the malformed
// node is structurally present but type-invalid. This is by design — the spec
// is exercising the RENDERER's error isolation path, not the schema validator.
// The schema validator would catch this at the API layer (Phase 13+).

import type { SpecRoot } from "../schema/spec-schema";

/**
 * MALFORMED_SPEC — a valid stack root with one deliberately broken badge node.
 *
 * D-18: Sibling nodes must still render when one node fails.
 * The badge node omits its required `label` field → propsSchema.safeParse fails
 * → NodeErrorFallback renders for that node alone.
 *
 * Structure:
 *   stack (root)
 *     ├── [0] text "Before the broken node" (valid — renders normally)
 *     ├── [1] badge (missing required label) (MALFORMED — NodeErrorFallback)
 *     └── [2] text "After the broken node" (valid — renders normally)
 */
export const MALFORMED_SPEC: SpecRoot = {
  v: 1,
  root: {
    type: "stack",
    direction: "vertical",
    gap: "md",
    children: [
      // Sibling 0: valid text node — renders normally
      {
        type: "text",
        content: "Before the broken node",
        variant: "body",
      },
      // Sibling 1: badge missing required `label` — propsSchema.safeParse fails
      // Using `as unknown as SpecNode` because the spec intentionally violates
      // the schema to exercise D-18 error isolation.
      {
        type: "badge",
        // label is intentionally omitted — required by BadgeNodeSchema
        variant: "default",
      } as unknown as { type: "badge"; label: string },
      // Sibling 2: valid text node — renders normally (isolation proof)
      {
        type: "text",
        content: "After the broken node — isolation confirmed",
        variant: "body",
      },
    ],
  },
} as unknown as SpecRoot;
