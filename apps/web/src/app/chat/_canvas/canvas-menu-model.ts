/**
 * canvas-menu-model.ts — PURE generation of the canvas context-menu items
 * (CI-01). The pane menu's "Add node ▸" submenu is GENERATED from
 * `NODE_TYPE_REGISTRY` ids, never hand-listed — a new registered node type
 * appears in the menu with zero menu edits (the CI-01 contract). Kept
 * framework-free so the generation is unit-testable against the registry.
 *
 * INV-4 ("menus read DATA, not code"): a node verb's `confirm` copy is a data
 * field on the verb descriptor, not a branch buried in the click handler — a
 * risky/irreversible verb declares its confirmation here and the renderer
 * reads it. The generic canvas verbs (duplicate/remove/connect) are all
 * reversible via the CI-06 undo stack, so none carries `confirm`; the field
 * exists so a capability-backed irreversible verb (e.g. a desktop-destroy
 * surfaced later) inherits its confirm from `reversibility` metadata by
 * populating this same field, never new control flow.
 */

import { NODE_TYPE_REGISTRY } from "./node-type-registry";

/** "genui-panel" -> "Genui panel", "email-thread" -> "Email thread". */
export function humanizeNodeType(id: string): string {
  const spaced = id.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface AddNodeMenuItem {
  readonly nodeType: string;
  readonly label: string;
  /** Whether the pane can actually materialize this type today — a type whose
   * data requires a dedicated picker (a thread id, a focus node id, …) is
   * listed but disabled until its picker is wired, so the menu still mirrors
   * the whole registry. */
  readonly addable: boolean;
}

/**
 * addNodeMenuItems — one item per `NODE_TYPE_REGISTRY` id (sorted for a stable
 * menu), flagged `addable` for the types `supportedTypes` can create. The
 * `unknown-node-type` placeholder is never a user-addable type and is never a
 * registry entry, so nothing filters it here.
 */
export function addNodeMenuItems(
  supportedTypes: ReadonlySet<string>,
): readonly AddNodeMenuItem[] {
  return Object.keys(NODE_TYPE_REGISTRY)
    .sort((a, b) => a.localeCompare(b))
    .map((nodeType) => ({
      nodeType,
      label: humanizeNodeType(nodeType),
      addable: supportedTypes.has(nodeType),
    }));
}

/** A verb shown on the node context menu. `confirm`, when present, is the
 * confirmation prompt the renderer must clear before running `id` — the INV-4
 * data seam for irreversible verbs. */
export interface NodeVerb {
  readonly id: string;
  readonly label: string;
  readonly confirm?: string;
}

/** The generic per-node verbs, in menu order. All reversible (CI-06 undo), so
 * none declares `confirm`. `sendToChat` is gated by the host at render time to
 * the node kinds that actually map to a sendable object ref. */
export const GENERIC_NODE_VERBS: readonly NodeVerb[] = [
  { id: "duplicate", label: "Duplicate" },
  { id: "connect", label: "Connect to…" },
  { id: "sendToChat", label: "Send to chat" },
  { id: "remove", label: "Remove" },
];

/** Edge verbs, in menu order (CI-01: Edit label / Reverse / Delete). */
export const EDGE_VERBS: readonly NodeVerb[] = [
  { id: "editLabel", label: "Edit label" },
  { id: "reverse", label: "Reverse" },
  { id: "delete", label: "Delete" },
];
