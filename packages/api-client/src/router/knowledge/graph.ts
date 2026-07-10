/**
 * knowledge/graph.ts — the `knowledge.graph` tRPC procedure.
 *
 * Returns an importer-wide knowledge + entity graph as { nodes, edges }.
 *
 * D-01: Ship simple, seam real — returns derived-FK edges today.
 * D-03: Importer-wide scope (not per-email subgraph).
 * D-04: 8 derived-edge types from existing FKs.
 * D-09: Read-only — zero writes to knowledge_node_edges.
 * D-11: Edge-provider seam — knowledge_node_edges rows are UNIONED into the
 *        same GraphEdge shape as derived edges (empty table → 0 extra edges today,
 *        proving the seam without a UI change when 4e populates it).
 *
 * Security:
 *   T-44-06-01 (supersedes T-11-01/D-12's client-importerId trust): the
 *            graph is protectedProcedure and every sub-query is bounded to
 *            the caller's OWNED importers (derived from ctx.user via
 *            userOwnedImporterIds) OR NULL-importer system defaults (the
 *            seeded entity-type taxonomy stays visible — D-02 never-blank).
 *            A client-supplied importerId is only honored when owned; a
 *            foreign one fails closed to an empty graph.
 *   T-11-02: all inputs validated by Zod (uuid, enum allow-lists, bool).
 *   T-11-03: instances/components/emails are off by default; capped at 100 in list.
 *
 * IMPORTANT — Schema Discrepancy (11-PATTERNS.md):
 *   email_components has NO entity_instance_id column.
 *   The component↔entity_instance edge derives from ComponentEntityCandidateLinks,
 *   NOT a direct FK on EmailComponents (UI-SPEC Note #3 is incorrect).
 */

import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import {
  ComponentEntityCandidateLinks,
  ComponentKnowledgeNodeLinks,
  EmailComponents,
  Emails,
  EntityInstances,
  EntityTypeFields,
  EntityTypes,
  KnowledgeNodeEdges,
  KnowledgeNodes,
} from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// Node type allow-list (6 types — T-11-02)
// ---------------------------------------------------------------------------

const NODE_TYPES = [
  "entity_type",
  "entity_type_field",
  "entity_instance",
  "email_component",
  "email",
  "knowledge_node",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const graphInputSchema = z.object({
  importerId: z.string().uuid().optional(),
  includeInstances: z.boolean().default(false),
  includeEmails: z.boolean().default(false),
  nodeTypes: z.array(z.enum(NODE_TYPES)).optional(),
});

export type GraphInput = z.infer<typeof graphInputSchema>;

// ---------------------------------------------------------------------------
// Graph node and edge shapes
// ---------------------------------------------------------------------------

export interface GraphNode {
  readonly id: string;
  readonly type: NodeType;
  readonly label: string;
  readonly [key: string]: unknown;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relationType: string;
  readonly tier?: string;
  readonly confidence?: number;
  readonly provenanceSummary?: string;
}

export interface GraphResponse {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

// ---------------------------------------------------------------------------
// Pure shaping helper — exported for DB-free testing (D-11 provider seam)
// ---------------------------------------------------------------------------

/**
 * shapeGraphResponse — wraps nodes and edges into the GraphResponse shape.
 *
 * Returns a new immutable object with spread copies of the input arrays.
 * Never mutates the input arrays.
 */
export function shapeGraphResponse(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): GraphResponse {
  return {
    nodes: [...nodes],
    edges: [...edges],
  };
}

/**
 * ExplicitEdgeRow — the shape selected off knowledge_node_edges for the D-11
 * provider-seam UNION (D-11/Phase 30 SC1). Plain data, no DB types leak out.
 */
export interface ExplicitEdgeRow {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetRefId: string | null | undefined;
  readonly relationType: string;
  readonly tier: string | null | undefined;
  readonly isActive: boolean | null | undefined;
  readonly confidence?: number | null | undefined;
  readonly provenance?: unknown;
  readonly source?: string | null | undefined;
}

/**
 * SOURCE_PROVENANCE_SUMMARIES — plain, reviewer-facing descriptors keyed by
 * `knowledge_node_edges.source` ("manual" | "synthesis" |
 * "learned_from_correction"). Deliberately NEVER surfaces the raw `provenance`
 * jsonb (OCR token/polygon blob, Phase 29 SYNTH-02) — only a short human string
 * (32-UI-SPEC popover row 5 / T-11-05 plain-text discipline).
 */
const SOURCE_PROVENANCE_SUMMARIES: Readonly<Record<string, string>> = {
  synthesis: "Synthesized from region confirmation",
  learned_from_correction: "Learned from a correction",
  manual: "Added manually",
};

/**
 * buildProvenanceSummary — derives the popover's "Source" row text. Returns
 * `undefined` (never the literal "undefined" or a JSON blob) whenever
 * `provenance` is null/undefined or `source` maps to no known descriptor.
 * Exported for DB-free testing.
 */
export function buildProvenanceSummary(
  source: string | null | undefined,
  provenance: unknown,
): string | undefined {
  if (provenance === null || provenance === undefined) return undefined;
  if (source == null) return undefined;
  return SOURCE_PROVENANCE_SUMMARIES[source];
}

/**
 * shapeExplicitEdgeRow — pure row -> GraphEdge shaper for knowledge_node_edges
 * (Phase 30 SC1/SC2 data-layer note). Excludes inactive (dismissed/superseded)
 * edges and rows with no targetRefId; carries `tier` so suggestion tiers
 * (INFERRED/AMBIGUOUS) are visibly distinguished from EXTRACTED wherever the
 * graph payload is consumed. Also carries `confidence` + a safe
 * `provenanceSummary` string (Phase 32 popover data-layer prerequisite,
 * 32-UI-SPEC) — never the raw jsonb. Returns a NEW object; never mutates the
 * row. Exported for DB-free testing (mirrors the shapeGraphResponse idiom).
 */
export function shapeExplicitEdgeRow(row: ExplicitEdgeRow): GraphEdge | null {
  if (row.isActive !== true) return null;
  if (row.targetRefId === null || row.targetRefId === undefined) return null;

  return {
    id: `kne-${row.id}`,
    source: row.sourceNodeId,
    target: row.targetRefId,
    relationType: row.relationType,
    tier: row.tier ?? undefined,
    confidence: row.confidence ?? undefined,
    provenanceSummary: buildProvenanceSummary(row.source, row.provenance),
  };
}

// ---------------------------------------------------------------------------
// Graph procedure
// ---------------------------------------------------------------------------

export const knowledgeGraphProcedures = {
  /**
   * graph — fetch the importer-wide knowledge + entity network.
   *
   * ALWAYS returns entity_type + entity_type_field nodes and the field→type edge.
   * Instances/components/emails/knowledge nodes are added based on input flags.
   *
   * The D-11 provider seam unions KnowledgeNodeEdges rows into the same GraphEdge
   * shape as derived-FK edges. Today the table is empty → 0 extra edges.
   *
   * TENA-03 (T-44-06-01): the effective importer scope derives from
   * ctx.user's owned importers — a client-supplied importerId only narrows
   * WITHIN the owned set; a foreign one fails closed to an empty graph.
   * NULL-importer system-default entity types/fields stay visible (the
   * seeded taxonomy, D-02 never-blank) even for an owner-less caller.
   * D-09: zero writes to any table.
   */
  graph: protectedProcedure
    .input(graphInputSchema)
    .query(async ({ ctx, input }) => {
      // ---------------------------------------------------------------------
      // TENA-03: derive the owned-importer scope from the session user.
      // ---------------------------------------------------------------------
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);

      if (input.importerId !== undefined && !owned.includes(input.importerId)) {
        // Fail-closed: a non-owned importer filter yields an empty graph —
        // never a query built from an unverified id, and no system-default
        // taxonomy either (an attacker probing a foreign id learns nothing).
        return shapeGraphResponse([], []);
      }

      const scope: ReadonlyArray<string> =
        input.importerId !== undefined ? [input.importerId] : owned;

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Track which node ids we have emitted to avoid duplicates
      const emittedNodeIds = new Set<string>();

      const addNode = (node: GraphNode): void => {
        if (!emittedNodeIds.has(node.id)) {
          emittedNodeIds.add(node.id);
          nodes.push(node);
        }
      };

      // -----------------------------------------------------------------------
      // (1) ALWAYS: entity_type nodes + entity_type_field nodes
      //     Edge: entity_type_field → entity_type (has_field)
      //     D-04 items 1 — taxonomy layer, present even with zero instances
      // -----------------------------------------------------------------------

      // System defaults are stored with importer_id IS NULL; importer-specific
      // overrides carry a uuid. A bare importer filter would silently drop the
      // entire seeded taxonomy — breaking the D-02 "never blank" guarantee.
      // Always union system defaults with the caller's OWNED rows (TENA-03:
      // the scope is owned-derived, never the raw client importerId).
      const entityTypeWhere =
        scope.length > 0
          ? or(
              isNull(EntityTypes.importerId),
              inArray(EntityTypes.importerId, scope),
            )
          : isNull(EntityTypes.importerId);

      const entityTypeRows = await ctx.db
        .select({
          id: EntityTypes.id,
          label: EntityTypes.label,
          slug: EntityTypes.slug,
        })
        .from(EntityTypes)
        .where(entityTypeWhere);

      const typeLabelById = new Map<string, string>(
        entityTypeRows.map((r) => [r.id, r.label]),
      );

      // entity_type_field nodes — same system-default inclusion as entity types.
      const entityTypeFieldWhere =
        scope.length > 0
          ? or(
              isNull(EntityTypeFields.importerId),
              inArray(EntityTypeFields.importerId, scope),
            )
          : isNull(EntityTypeFields.importerId);

      const fieldRows = await ctx.db
        .select({
          id: EntityTypeFields.id,
          label: EntityTypeFields.label,
          slug: EntityTypeFields.slug,
          entityTypeId: EntityTypeFields.entityTypeId,
          fieldType: EntityTypeFields.fieldType,
          isRequired: EntityTypeFields.isRequired,
        })
        .from(EntityTypeFields)
        .where(entityTypeFieldWhere);

      // Group fields by parent type so entity_type nodes can carry their field
      // chips (NodeDetailPane "Fields" section).
      const fieldsByType = new Map<
        string,
        Array<{ id: string; label: string }>
      >();
      for (const row of fieldRows) {
        const list = fieldsByType.get(row.entityTypeId) ?? [];
        list.push({ id: row.id, label: row.label });
        fieldsByType.set(row.entityTypeId, list);
      }

      // Instance counts per type — computed whenever the caller owns any
      // importers (powers the detail pane's "View N instances →" even when
      // instance nodes are not rendered). entity_instances.importer_id is
      // NOT NULL, so an owner-less caller can have no instances at all —
      // skip the query entirely (TENA-03).
      const instanceCountRows =
        scope.length > 0
          ? await ctx.db
              .select({
                entityTypeId: EntityInstances.entityTypeId,
                count: count(),
              })
              .from(EntityInstances)
              .where(
                and(
                  inArray(EntityInstances.importerId, scope),
                  eq(EntityInstances.isActive, true),
                ),
              )
              .groupBy(EntityInstances.entityTypeId)
          : [];
      const instanceCountByType = new Map<string, number>(
        instanceCountRows.map((r) => [r.entityTypeId, Number(r.count)]),
      );

      for (const row of entityTypeRows) {
        addNode({
          id: row.id,
          type: "entity_type",
          label: row.label,
          slug: row.slug,
          fields: fieldsByType.get(row.id) ?? [],
          instanceCount: instanceCountByType.get(row.id) ?? 0,
        });
      }

      for (const row of fieldRows) {
        addNode({
          id: row.id,
          type: "entity_type_field",
          label: row.label,
          slug: row.slug,
          fieldType: row.fieldType,
          isRequired: row.isRequired,
          entityTypeId: row.entityTypeId,
          entityTypeName: typeLabelById.get(row.entityTypeId) ?? null,
        });
        // Edge: entity_type → entity_type_field (has_field)
        edges.push({
          id: `field-${row.id}`,
          source: row.entityTypeId,
          target: row.id,
          relationType: "has_field",
        });
      }

      // -----------------------------------------------------------------------
      // (2) CONDITIONAL: entity_instance nodes (when includeInstances)
      //     Edges: entity_instance → entity_type (instance_of)
      //     Edges: component ↔ entity_instance (via ComponentEntityCandidateLinks)
      //     Edges: component → entity_type (via ComponentEntityCandidateLinks.entityTypeId)
      //     D-04 items 2, 3, 4
      //     CRITICAL: uses ComponentEntityCandidateLinks JOIN PATH (not a direct FK
      //     on email_components — see Schema Discrepancy in 11-PATTERNS.md)
      // -----------------------------------------------------------------------

      if (input.includeInstances && scope.length > 0) {
        const instanceWhere = and(
          inArray(EntityInstances.importerId, scope),
          eq(EntityInstances.isActive, true),
        );

        const instanceRows = await ctx.db
          .select({
            id: EntityInstances.id,
            displayName: EntityInstances.displayName,
            entityTypeId: EntityInstances.entityTypeId,
          })
          .from(EntityInstances)
          .where(instanceWhere);

        for (const row of instanceRows) {
          addNode({
            id: row.id,
            type: "entity_instance",
            label: row.displayName,
            entityTypeId: row.entityTypeId,
            entityTypeName: typeLabelById.get(row.entityTypeId) ?? null,
          });
          // Edge: entity_instance → entity_type (instance_of)
          edges.push({
            id: `instance-type-${row.id}`,
            source: row.id,
            target: row.entityTypeId,
            relationType: "instance_of",
          });
        }

        // Component↔entity_instance edges via the JOIN TABLE (D-04 item 3)
        // NEVER a direct FK on email_components
        const candidateLinkWhere = and(
          eq(ComponentEntityCandidateLinks.wasSelected, true),
          // TENA-03: bound to the caller's owned importers via the joined
          // entity instance.
          inArray(EntityInstances.importerId, scope),
        );

        const candidateLinkRows = await ctx.db
          .select({
            componentId: ComponentEntityCandidateLinks.componentId,
            entityInstanceId: ComponentEntityCandidateLinks.entityInstanceId,
            entityTypeId: ComponentEntityCandidateLinks.entityTypeId,
            matchType: ComponentEntityCandidateLinks.matchType,
          })
          .from(ComponentEntityCandidateLinks)
          .innerJoin(
            EntityInstances,
            eq(EntityInstances.id, ComponentEntityCandidateLinks.entityInstanceId),
          )
          .where(candidateLinkWhere);

        for (const row of candidateLinkRows) {
          // Edge: component → entity_instance (component_linked_to)
          edges.push({
            id: `comp-inst-${row.componentId}-${row.entityInstanceId}`,
            source: row.componentId,
            target: row.entityInstanceId,
            relationType: row.matchType ?? "component_linked_to",
          });
          // Edge: component → entity_type (component_type_of).
          // Include entityInstanceId in the id: a component can select two
          // instances of the SAME type, which would otherwise collide on
          // `comp-type-${componentId}-${entityTypeId}` and React Flow would
          // silently drop the duplicate edge.
          edges.push({
            id: `comp-type-${row.componentId}-${row.entityTypeId}-${row.entityInstanceId}`,
            source: row.componentId,
            target: row.entityTypeId,
            relationType: "component_type_of",
          });
        }
      }

      // -----------------------------------------------------------------------
      // (3) CONDITIONAL: email_component + email nodes (when includeEmails)
      //     Edges: component → email (belongs_to_email)
      //     Edges: component → component (parent_of, nesting via parentComponentId)
      //     D-04 items 5, 6
      // -----------------------------------------------------------------------

      if (input.includeEmails && scope.length > 0) {
        // TENA-03: bound to the caller's owned importers via the joined email.
        const componentWhere = inArray(Emails.importerId, scope);

        const componentRows = await ctx.db
          .select({
            id: EmailComponents.id,
            role: EmailComponents.role,
            location: EmailComponents.location,
            emailId: EmailComponents.emailId,
            parentComponentId: EmailComponents.parentComponentId,
            emailSubject: Emails.subject,
            emailSenderName: Emails.senderName,
            emailSenderAddress: Emails.senderAddress,
            emailReceivedAt: Emails.receivedAt,
          })
          .from(EmailComponents)
          .innerJoin(Emails, eq(Emails.id, EmailComponents.emailId))
          .where(componentWhere);

        for (const row of componentRows) {
          const emailSender = row.emailSenderName ?? row.emailSenderAddress ?? null;
          // `location` is jsonb (an object) — NOT a usable label; use the role
          // (or a generic fallback) so the label never renders "[object Object]".
          addNode({
            id: row.id,
            type: "email_component",
            label: row.role ?? "component",
            role: row.role,
            location: row.location,
            emailId: row.emailId,
            emailSubject: row.emailSubject,
            emailSender,
          });
          // Edge: component → email (belongs_to_email)
          edges.push({
            id: `comp-email-${row.id}`,
            source: row.id,
            target: row.emailId,
            relationType: "belongs_to_email",
          });
          // Edge: component → parent component (nested_in)
          if (row.parentComponentId !== null && row.parentComponentId !== undefined) {
            edges.push({
              id: `comp-parent-${row.id}`,
              source: row.id,
              target: row.parentComponentId,
              relationType: "nested_in",
            });
          }

          // Emit email node (de-duplicated by addNode)
          addNode({
            id: row.emailId,
            type: "email",
            label: row.emailSubject ?? "(no subject)",
            sender: emailSender,
            receivedAt: row.emailReceivedAt?.toISOString() ?? null,
          });
        }
      }

      // -----------------------------------------------------------------------
      // (4) knowledge_node nodes (when any are active for this importer)
      //     Edges: component ↔ knowledge_node (via ComponentKnowledgeNodeLinks)
      //     Edges: knowledge_node → scope (scope_of, via scopeRefId/scopeRefType)
      //     D-04 items 7, 8
      // -----------------------------------------------------------------------

      // knowledge_nodes.importer_id is NOT NULL — an owner-less caller can
      // have no knowledge nodes; skip the query entirely (TENA-03).
      const knowledgeNodeRows =
        scope.length > 0
          ? await ctx.db
              .select({
                id: KnowledgeNodes.id,
                title: KnowledgeNodes.title,
                scope: KnowledgeNodes.scope,
                scopeRefId: KnowledgeNodes.scopeRefId,
                scopeRefType: KnowledgeNodes.scopeRefType,
                source: KnowledgeNodes.source,
                confidence: KnowledgeNodes.confidence,
              })
              .from(KnowledgeNodes)
              .where(
                and(
                  eq(KnowledgeNodes.isActive, true),
                  inArray(KnowledgeNodes.importerId, scope),
                ),
              )
          : [];

      if (knowledgeNodeRows.length > 0) {
        for (const row of knowledgeNodeRows) {
          addNode({
            id: row.id,
            type: "knowledge_node",
            label: row.title,
            scope: row.scope,
            source: row.source,
            confidence: row.confidence,
          });

          // Edge: knowledge_node → scope entity (scope_of)
          if (row.scopeRefId !== null && row.scopeRefId !== undefined) {
            edges.push({
              id: `kn-scope-${row.id}`,
              source: row.id,
              target: row.scopeRefId,
              relationType: `scope_of_${row.scopeRefType ?? "unknown"}`,
            });
          }
        }

        // Component↔knowledge_node edges (D-04 item 7)
        // TENA-03: bound via the joined knowledge node's importer.
        const knComponentLinkWhere = and(
          inArray(KnowledgeNodes.importerId, scope),
          eq(KnowledgeNodes.isActive, true),
        );

        const knLinkRows = await ctx.db
          .select({
            componentId: ComponentKnowledgeNodeLinks.componentId,
            knowledgeNodeId: ComponentKnowledgeNodeLinks.knowledgeNodeId,
          })
          .from(ComponentKnowledgeNodeLinks)
          .innerJoin(
            KnowledgeNodes,
            eq(KnowledgeNodes.id, ComponentKnowledgeNodeLinks.knowledgeNodeId),
          )
          .where(knComponentLinkWhere);

        for (const row of knLinkRows) {
          edges.push({
            id: `comp-kn-${row.componentId}-${row.knowledgeNodeId}`,
            source: row.componentId,
            target: row.knowledgeNodeId,
            relationType: "retrieval_context",
          });
        }
      }

      // -----------------------------------------------------------------------
      // (5) D-11 provider seam: UNION knowledge_node_edges rows into the edge list
      //     Today the table is empty → contributes 0 edges.
      //     When 4e populates it, no code change needed here — the seam is live.
      //     D-09: this is a SELECT-only operation; zero writes anywhere.
      // -----------------------------------------------------------------------

      // Suggestion tiers (INFERRED/AMBIGUOUS) are visibly distinguished via `tier`
      // (ROADMAP SC1); inactive (dismissed/superseded) edges are excluded from the
      // payload entirely — never surfaced, even as a distinguished suggestion.
      //
      // TENA-03: the union is bounded to the caller's owned importers via an
      // innerJoin on the edge's SOURCE knowledge node (the same anchor
      // expand.ts's T-32-02 scoping uses) — previously this SELECT was
      // completely unscoped, unioning every tenant's explicit edges into the
      // payload. Skipped entirely for an owner-less caller.
      const explicitEdgeRows =
        scope.length > 0
          ? await ctx.db
              .select({
                id: KnowledgeNodeEdges.id,
                sourceNodeId: KnowledgeNodeEdges.sourceNodeId,
                targetRefId: KnowledgeNodeEdges.targetRefId,
                relationType: KnowledgeNodeEdges.relationType,
                tier: KnowledgeNodeEdges.tier,
                isActive: KnowledgeNodeEdges.isActive,
                confidence: KnowledgeNodeEdges.confidence,
                provenance: KnowledgeNodeEdges.provenance,
                source: KnowledgeNodeEdges.source,
              })
              .from(KnowledgeNodeEdges)
              .innerJoin(
                KnowledgeNodes,
                eq(KnowledgeNodes.id, KnowledgeNodeEdges.sourceNodeId),
              )
              .where(
                and(
                  eq(KnowledgeNodeEdges.isActive, true),
                  inArray(KnowledgeNodes.importerId, scope),
                ),
              )
          : [];

      for (const row of explicitEdgeRows) {
        const shaped = shapeExplicitEdgeRow(row);
        if (shaped !== null) edges.push(shaped);
      }

      // Return via the pure shaping helper (spread copies — immutable)
      return shapeGraphResponse(nodes, edges);
    }),
};
