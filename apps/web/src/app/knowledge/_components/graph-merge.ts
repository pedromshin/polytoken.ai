/**
 * graph-merge.ts — pure dedupe-by-id merge of expandNode results onto the
 * current canvas node/edge sets (GRAPH-02).
 *
 * Never mutates its inputs; always returns NEW arrays (CLAUDE.md
 * immutability). Merging the same expansion result twice is idempotent —
 * a node/edge whose id is already present is never duplicated or
 * repositioned/re-ordered.
 */

interface Identified {
  readonly id: string;
}

/**
 * mergeGraph — dedupe-by-id union of `newItems` onto `existingItems`.
 *
 * Generic over any `{ id }`-shaped item so it merges both React Flow's
 * `Node`/`Edge` shapes and the raw `GraphNode`/`GraphEdge` API shapes with
 * one implementation.
 */
function mergeById<T extends Identified>(
  existingItems: ReadonlyArray<T>,
  newItems: ReadonlyArray<T>,
): T[] {
  const existingIds = new Set(existingItems.map((item) => item.id));
  const additions = newItems.filter((item) => !existingIds.has(item.id));
  return [...existingItems, ...additions];
}

export interface MergeGraphResult<
  NodeType extends Identified,
  EdgeType extends Identified,
> {
  readonly nodes: NodeType[];
  readonly edges: EdgeType[];
}

/**
 * mergeGraph — dedupes new nodes/edges by `id` onto the existing canvas
 * sets. Returns NEW arrays; the original `existingNodes`/`existingEdges`
 * (and `newNodes`/`newEdges`) array references are never mutated.
 */
export function mergeGraph<
  NodeType extends Identified,
  EdgeType extends Identified,
>(
  existingNodes: ReadonlyArray<NodeType>,
  existingEdges: ReadonlyArray<EdgeType>,
  newNodes: ReadonlyArray<NodeType>,
  newEdges: ReadonlyArray<EdgeType>,
): MergeGraphResult<NodeType, EdgeType> {
  return {
    nodes: mergeById(existingNodes, newNodes),
    edges: mergeById(existingEdges, newEdges),
  };
}
