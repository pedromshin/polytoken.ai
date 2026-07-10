/**
 * knowledge/list.ts — the `knowledge.list` tRPC procedure.
 *
 * Paginated feed of active knowledge_nodes, optionally filtered by importerId.
 * Uses limit+1 pagination (D-06 / entities/gallery.ts analog).
 *
 * D-09: Read-only — zero writes to knowledge_node_edges or any table.
 *
 * Tenancy (Phase 44, TENA-03 / T-44-06-01): protectedProcedure; the feed is
 * scoped to the caller's owned importers via `userOwnedImporterIds` +
 * `resolveListScope` — a client-supplied `importerId` is only honored when
 * it is in the owned set, never trusted on its own (supersedes the old D-12
 * "optional data filter" posture).
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { KnowledgeNodes } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { resolveListScope } from "../_scope";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const listKnowledgeInputSchema = z.object({
  importerId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export type ListKnowledgeInput = z.infer<typeof listKnowledgeInputSchema>;

// ---------------------------------------------------------------------------
// List procedure
// ---------------------------------------------------------------------------

export const knowledgeListProcedures = {
  /**
   * list — paginated knowledge_nodes feed (active nodes only).
   *
   * Returns { items, hasMore, nextOffset } with limit+1 detection.
   * Ordered by createdAt desc (most-recently-added first).
   *
   * TENA-03: scope derives from ctx.user's owned importers; a non-owned
   * importerId filter (or an owner-less caller) yields an empty page — no
   * query is built from an unverified id.
   */
  list: protectedProcedure
    .input(listKnowledgeInputSchema)
    .query(async ({ ctx, input }) => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);

      if (!scope.ok) {
        return {
          items: [],
          hasMore: false,
          nextOffset: input.offset,
        };
      }

      const whereClauses = [
        eq(KnowledgeNodes.isActive, true),
        // TENA-03: owned-importer scope (never the raw client-supplied id).
        inArray(KnowledgeNodes.importerId, scope.importerIds),
      ];

      // limit+1 pattern to detect hasMore
      const rawRows = await ctx.db
        .select({
          id: KnowledgeNodes.id,
          title: KnowledgeNodes.title,
          content: KnowledgeNodes.content,
          scope: KnowledgeNodes.scope,
          scopeRefId: KnowledgeNodes.scopeRefId,
          scopeRefType: KnowledgeNodes.scopeRefType,
          source: KnowledgeNodes.source,
          confidence: KnowledgeNodes.confidence,
          importerId: KnowledgeNodes.importerId,
          createdAt: KnowledgeNodes.createdAt,
        })
        .from(KnowledgeNodes)
        .where(and(...whereClauses))
        .orderBy(desc(KnowledgeNodes.createdAt))
        .limit(input.limit + 1)
        .offset(input.offset);

      const hasMore = rawRows.length > input.limit;
      const sliced = hasMore ? rawRows.slice(0, input.limit) : rawRows;

      const items = sliced.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        scope: row.scope,
        scopeRefId: row.scopeRefId,
        scopeRefType: row.scopeRefType,
        source: row.source,
        confidence: row.confidence,
        importerId: row.importerId,
        createdAt: row.createdAt,
      }));

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
      };
    }),
};
