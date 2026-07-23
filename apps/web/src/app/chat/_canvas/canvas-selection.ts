/**
 * canvas-selection.ts — PURE, general (all-node-type) multi-select + bulk
 * transforms (CI-05). Generalizes beyond `canon-selection.tsx`'s source-only
 * accumulation: these operate over React Flow's own `selected` flag for EVERY
 * node type, so the same rubber-band / additive-click / select-all mechanism
 * drives one selection substrate (STATE-01/D-10 — never a parallel Set). The
 * source-canon gathering in `canon-selection.tsx` remains a MODE layered on
 * this same `selected` flag, not a separate system.
 *
 * THE CHAT NODE IS A SINGLETON (D-02: "one chat node always present"). It is
 * never duplicated and never deleted here — every transform treats
 * `type === "chat"` as protected, so a select-all + delete can never blank the
 * conversation's own chat surface.
 *
 * All transforms are immutable and return THE SAME array instance when nothing
 * changed (a no-op never forces a React Flow re-render), mirroring
 * canon-selection.tsx's discipline.
 */

import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

export const CHAT_NODE_TYPE = "chat";

/** A node the bulk verbs must never destroy or clone (the D-02 singleton). */
export function isProtectedNode(node: FlowNode): boolean {
  return node.type === CHAT_NODE_TYPE;
}

export function selectedNodes(
  nodes: readonly FlowNode[],
): readonly FlowNode[] {
  return nodes.filter((node) => node.selected === true);
}

/** Selected node ids that are actually removable (protected singleton excluded). */
export function deletableSelectedIds(
  nodes: readonly FlowNode[],
): readonly string[] {
  return nodes
    .filter((node) => node.selected === true && !isProtectedNode(node))
    .map((node) => node.id);
}

/** Select every node (⌘A). Protected nodes are selectable too — they just
 * can't be duplicated/deleted; selecting them is harmless. */
export function selectAllNodes(
  nodes: readonly FlowNode[],
): readonly FlowNode[] {
  if (nodes.every((node) => node.selected === true)) return nodes;
  return nodes.map((node) =>
    node.selected === true ? node : { ...node, selected: true },
  );
}

/** Clear selection across ALL node types (the general form of
 * canon-selection's clear + chat-canvas's handlePaneClick). */
export function deselectAllNodes(
  nodes: readonly FlowNode[],
): readonly FlowNode[] {
  if (!nodes.some((node) => node.selected === true)) return nodes;
  return nodes.map((node) =>
    node.selected === true ? { ...node, selected: false } : node,
  );
}

export interface RemoveResult {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  /** Ids actually removed (protected singleton never appears here). */
  readonly removedIds: readonly string[];
}

/**
 * removeNodesById — drop the given nodes (minus any protected singleton) and
 * every edge touching a removed node. Returns the same arrays when nothing
 * qualifies.
 */
export function removeNodesById(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  ids: readonly string[],
): RemoveResult {
  const requested = new Set(ids);
  const removedIds = nodes
    .filter((node) => requested.has(node.id) && !isProtectedNode(node))
    .map((node) => node.id);
  if (removedIds.length === 0) {
    return { nodes, edges, removedIds };
  }
  const removed = new Set(removedIds);
  return {
    nodes: nodes.filter((node) => !removed.has(node.id)),
    edges: edges.filter(
      (edge) => !removed.has(edge.source) && !removed.has(edge.target),
    ),
    removedIds,
  };
}

export interface DuplicateResult {
  readonly nodes: readonly FlowNode[];
  readonly addedIds: readonly string[];
}

/** Default offset for a duplicated node so the clone is visibly distinct. */
export const DUPLICATE_OFFSET_PX = 40;

/**
 * duplicateSelectedNodes — clone every selected, non-protected node with a
 * fresh id (`idFactory`), nudged by `offset`; the originals are deselected and
 * the clones become the new selection (so a follow-up drag/delete acts on the
 * copies). `idFactory` receives the source node so the caller can mint a
 * type-scoped unique id. Returns the same array when nothing was duplicable.
 */
export function duplicateSelectedNodes(
  nodes: readonly FlowNode[],
  idFactory: (source: FlowNode) => string,
  offset: number = DUPLICATE_OFFSET_PX,
): DuplicateResult {
  const toClone = nodes.filter(
    (node) => node.selected === true && !isProtectedNode(node),
  );
  if (toClone.length === 0) {
    return { nodes, addedIds: [] };
  }
  const clones: FlowNode[] = toClone.map((source) => ({
    ...source,
    id: idFactory(source),
    position: {
      x: source.position.x + offset,
      y: source.position.y + offset,
    },
    selected: true,
    // A clone is a fresh object graph — never share the source's data ref.
    data: { ...(source.data ?? {}) },
  }));
  const deselectedOriginals = nodes.map((node) =>
    node.selected === true ? { ...node, selected: false } : node,
  );
  return {
    nodes: [...deselectedOriginals, ...clones],
    addedIds: clones.map((clone) => clone.id),
  };
}

/**
 * pasteNodes — append copies of `clipboard` nodes to `current` with fresh ids
 * (`idFactory`) and a position offset, deselecting the existing nodes so the
 * pasted copies are the new selection. Protected (chat) nodes in the clipboard
 * are skipped — the singleton is never pasteable. Returns the same array when
 * the clipboard has nothing pasteable.
 */
export function pasteNodes(
  current: readonly FlowNode[],
  clipboard: readonly FlowNode[],
  idFactory: (source: FlowNode) => string,
  offset: number = DUPLICATE_OFFSET_PX,
): DuplicateResult {
  const pasteable = clipboard.filter((node) => !isProtectedNode(node));
  if (pasteable.length === 0) {
    return { nodes: current, addedIds: [] };
  }
  const clones: FlowNode[] = pasteable.map((source) => ({
    ...source,
    id: idFactory(source),
    position: {
      x: source.position.x + offset,
      y: source.position.y + offset,
    },
    selected: true,
    data: { ...(source.data ?? {}) },
  }));
  const deselectedCurrent = current.map((node) =>
    node.selected === true ? { ...node, selected: false } : node,
  );
  return {
    nodes: [...deselectedCurrent, ...clones],
    addedIds: clones.map((clone) => clone.id),
  };
}
