/**
 * knowledge/expand.ts — the `knowledge.expandNode` read-only tRPC procedure.
 *
 * GRAPH-02: clicking a knowledge-graph node fetches its neighbours via a
 * bounded server-side query and merges them onto the canvas.
 *
 * Security (see 32-CONTEXT.md / 32-01-PLAN.md threat_model):
 *   T-32-01: the BFS is depth-clamped to <=2 hops (`clampDepth`) and
 *            hard-capped at a node/edge budget (`capBudget`) — a client can
 *            never request an unbounded walk.
 *   T-32-02: traversal is tenant-scoped — every edge is joined against the
 *            SEED node's `importerId` (never a client-supplied importer
 *            claim), and every resolved node is re-checked against that same
 *            importerId before being returned.
 *   T-32-03: `expandInputSchema` validates `nodeId` as a uuid at the
 *            boundary; an unknown or inactive seed returns an EMPTY
 *            GraphResponse (fail-closed — never throws in a way that leaks
 *            existence of another tenant's node).
 *   T-44-06-03 (Phase 44, TENA-03): protectedProcedure + the SEED node's
 *            importer is asserted owned by ctx.user BEFORE any expansion —
 *            previously any authenticated caller could expand any node id
 *            and walk another tenant's subgraph. A foreign seed surfaces as
 *            TRPCError NOT_FOUND (OwnershipError mapped via
 *            assertOwnedOrNotFound). The seed-derived neighbour scoping
 *            (T-32-02) is unchanged.
 *
 * D-09: read-only — zero writes, mirrors graph.ts's posture.
 *
 * The BFS (`walkKnowledgeGraph`) is written to take an "edges-for-node" fetch
 * callback so the graph-walk shape is reusable server-side later (32-CONTEXT
 * "one implementation serves both") — it does NOT import or reference any
 * prompt/autofill module, and nothing here is wired near one.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { KnowledgeNodeEdges, KnowledgeNodes } from "@polytoken/db/schema";
import { assertImporterOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import {
  shapeExplicitEdgeRow,
  type ExplicitEdgeRow,
  type GraphEdge,
  type GraphNode,
  type GraphResponse,
  type NodeType,
} from "./graph";

// ---------------------------------------------------------------------------
// Bounds (T-32-01)
// ---------------------------------------------------------------------------

const MIN_DEPTH = 1;
const MAX_DEPTH = 2;

/** Hard node/edge budget cap for a single expandNode response (T-32-01). */
export const EXPAND_BUDGET_CAP = 50;

// ---------------------------------------------------------------------------
// clampDepth — pure, exported for DB-free tests
// ---------------------------------------------------------------------------

/**
 * clampDepth — clamps a client-supplied depth to the closed range [1, 2].
 * `undefined` defaults to 1 (one hop). Never returns a value outside the
 * range regardless of input (T-32-01 — no unbounded walk depth).
 */
export function clampDepth(depth: number | undefined): number {
  if (depth === undefined) return MIN_DEPTH;
  const truncated = Math.trunc(depth);
  if (truncated < MIN_DEPTH) return MIN_DEPTH;
  if (truncated > MAX_DEPTH) return MAX_DEPTH;
  return truncated;
}

// ---------------------------------------------------------------------------
// capBudget — pure, exported for DB-free tests
// ---------------------------------------------------------------------------

export interface CapBudgetResult {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly truncated: boolean;
}

/**
 * capBudget — truncates `nodes` to at most `cap` entries (default
 * `EXPAND_BUDGET_CAP`) and drops any edge whose source or target fell
 * outside the kept node set. Returns NEW arrays; never mutates inputs.
 * `truncated` is true iff the input node count exceeded `cap`.
 */
export function capBudget(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  cap: number = EXPAND_BUDGET_CAP,
): CapBudgetResult {
  if (nodes.length <= cap) {
    return { nodes: [...nodes], edges: [...edges], truncated: false };
  }

  const cappedNodes = nodes.slice(0, cap);
  const keptIds = new Set(cappedNodes.map((n) => n.id));
  const cappedEdges = edges.filter(
    (e) => keptIds.has(e.source) && keptIds.has(e.target),
  );

  return { nodes: cappedNodes, edges: cappedEdges, truncated: true };
}

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const expandInputSchema = z.object({
  nodeId: z.string().uuid(),
  depth: z.number().int().optional(),
});

export type ExpandInput = z.infer<typeof expandInputSchema>;

// ---------------------------------------------------------------------------
// Reusable BFS traversal
// ---------------------------------------------------------------------------

export interface WalkResult {
  readonly nodeIds: ReadonlySet<string>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

/**
 * walkKnowledgeGraph — breadth-first traversal from a seed node id.
 *
 * `fetchEdgesForNode(nodeId)` resolves the active, tenant-scoped edge rows
 * touching `nodeId` (as either `sourceNodeId` or `targetRefId`) — the caller
 * owns tenant scoping (see `expandNode`'s importer-joined callback below).
 * This function has no DB dependency of its own (all I/O lives behind the
 * callback), so it is reusable server-side by a future stage-3 retrieval
 * path without any change to this file.
 */
export async function walkKnowledgeGraph(
  seedId: string,
  maxDepth: number,
  fetchEdgesForNode: (
    nodeId: string,
  ) => Promise<ReadonlyArray<ExplicitEdgeRow>>,
): Promise<WalkResult> {
  const nodeIds = new Set<string>([seedId]);
  const edgesById = new Map<string, GraphEdge>();
  let frontier = new Set<string>([seedId]);

  for (let hop = 0; hop < maxDepth && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();

    for (const currentId of frontier) {
      const rows = await fetchEdgesForNode(currentId);

      for (const row of rows) {
        const shaped = shapeExplicitEdgeRow(row);
        if (shaped === null) continue;

        edgesById.set(shaped.id, shaped);

        for (const candidate of [shaped.source, shaped.target]) {
          if (!nodeIds.has(candidate)) {
            nodeIds.add(candidate);
            nextFrontier.add(candidate);
          }
        }
      }
    }

    frontier = nextFrontier;
  }

  return { nodeIds, edges: [...edgesById.values()] };
}

// ---------------------------------------------------------------------------
// expandNode procedure
// ---------------------------------------------------------------------------

export interface ExpandResponse extends GraphResponse {
  readonly truncated: boolean;
}

export const knowledgeExpandProcedures = {
  /**
   * expandNode — bounded (<=2-hop) neighbour walk from a seed knowledge node.
   *
   * Read-only (D-09). Fail-closed on an unknown/inactive seed (T-32-03).
   * The seed's importer must be OWNED by ctx.user before any expansion
   * (T-44-06-03 — foreign seed -> NOT_FOUND). Tenant-scoped to the seed's
   * importer for every traversed edge and every returned node (T-32-02).
   * Depth-clamped and budget-capped (T-32-01).
   */
  expandNode: protectedProcedure
    .input(expandInputSchema)
    .query(async ({ ctx, input }): Promise<ExpandResponse> => {
      const depth = clampDepth(input.depth);

      const seedRows = await ctx.db
        .select({
          id: KnowledgeNodes.id,
          importerId: KnowledgeNodes.importerId,
          isActive: KnowledgeNodes.isActive,
        })
        .from(KnowledgeNodes)
        .where(eq(KnowledgeNodes.id, input.nodeId))
        .limit(1);

      const seed = seedRows[0];
      if (seed === undefined || seed.isActive !== true) {
        // Fail-closed (T-32-03) — never leaks whether nodeId exists.
        return { nodes: [], edges: [], truncated: false };
      }

      // T-44-06-03: the caller must OWN the seed node's importer before any
      // expansion — closes the "expand any node id" gap.
      await assertOwnedOrNotFound(() =>
        assertImporterOwnership(ctx.db, seed.importerId, ctx.user.id),
      );

      const importerId = seed.importerId;

      const fetchEdgesForNode = async (
        nodeId: string,
      ): Promise<ExplicitEdgeRow[]> => {
        return ctx.db
          .select({
            id: KnowledgeNodeEdges.id,
            sourceNodeId: KnowledgeNodeEdges.sourceNodeId,
            targetRefId: KnowledgeNodeEdges.targetRefId,
            relationType: KnowledgeNodeEdges.relationType,
            tier: KnowledgeNodeEdges.tier,
            isActive: KnowledgeNodeEdges.isActive,
          })
          .from(KnowledgeNodeEdges)
          .innerJoin(
            KnowledgeNodes,
            eq(KnowledgeNodes.id, KnowledgeNodeEdges.sourceNodeId),
          )
          .where(
            and(
              or(
                eq(KnowledgeNodeEdges.sourceNodeId, nodeId),
                eq(KnowledgeNodeEdges.targetRefId, nodeId),
              ),
              eq(KnowledgeNodeEdges.isActive, true),
              // T-32-02: tenant scope via the edge's SOURCE knowledge node's
              // importer — never a client-supplied importer claim.
              eq(KnowledgeNodes.importerId, importerId),
            ),
          );
      };

      const walk = await walkKnowledgeGraph(
        input.nodeId,
        depth,
        fetchEdgesForNode,
      );

      // Resolve labels for every node id the walk touched. Only rows that
      // belong to the SEED's importer are shaped into GraphNodes (T-32-02) —
      // a target id that does not resolve to a same-importer, active
      // knowledge node is dropped (and any edge touching it) rather than
      // surfaced with an unverified label.
      const knowledgeNodeRows =
        walk.nodeIds.size === 0
          ? []
          : await ctx.db
              .select({
                id: KnowledgeNodes.id,
                title: KnowledgeNodes.title,
                scope: KnowledgeNodes.scope,
                source: KnowledgeNodes.source,
                confidence: KnowledgeNodes.confidence,
              })
              .from(KnowledgeNodes)
              .where(
                and(
                  inArray(KnowledgeNodes.id, [...walk.nodeIds]),
                  eq(KnowledgeNodes.importerId, importerId),
                  eq(KnowledgeNodes.isActive, true),
                ),
              );

      const nodes: GraphNode[] = knowledgeNodeRows.map((row) => ({
        id: row.id,
        type: "knowledge_node" satisfies NodeType,
        label: row.title,
        scope: row.scope,
        source: row.source,
        confidence: row.confidence,
      }));

      const resolvedIds = new Set(nodes.map((n) => n.id));
      const scopedEdges = walk.edges.filter(
        (e) => resolvedIds.has(e.source) && resolvedIds.has(e.target),
      );

      const capped = capBudget(nodes, scopedEdges, EXPAND_BUDGET_CAP);

      return {
        nodes: capped.nodes,
        edges: capped.edges,
        truncated: capped.truncated,
      };
    }),
};
