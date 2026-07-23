/**
 * knowledge/search.ts — the `knowledge.search` tRPC procedure (KG-8 closure,
 * web reachability half).
 *
 * Before this file existed, knowledge-node search was UNREACHABLE from the
 * web app entirely: the only caller of the Phase-37 BlendedRAG read side was
 * the chat tool executor (`search_knowledge`) inside the listener. The
 * /knowledge surface had list/graph/detail/expand procedures but no way to
 * search — the "semantic search" arm of the product was dead from the UI.
 *
 * This procedure runs the LEXICAL arm of the same BlendedRAG RPC pair the
 * listener uses — `match_knowledge_nodes_by_trgm` (migration 0029) — which
 * reads through the belt-1 `knowledge_nodes_extracted_only` view and carries
 * an explicit tier = 'EXTRACTED' filter (belt 3), so non-confirmed text can
 * never surface here, exactly like the chat tool path.
 *
 * INTEGRATION POINT (KG-8 vector arm): the dense/vector arm
 * (`match_knowledge_nodes_by_embedding`) needs a QUERY embedding, which is
 * computed listener-side via Bedrock (`EmbeddingProtocol`). The listener-lane
 * KG-8 fix makes `knowledge_nodes.embedding` actually get written; once a
 * listener HTTP endpoint exposes query-embedding (or a search endpoint), this
 * procedure should fuse that arm in (RRF, mirroring
 * `KnowledgeGraphRepository.search_nodes`). Until then this is honestly
 * trgm-only — which is ALSO all the listener path effectively was while
 * embeddings were never written (report KG-8).
 *
 * Security:
 *   TENA-03: scope derives from ctx.user's owned importers via
 *     `userOwnedImporterIds` + `resolveListScope`; a non-owned importerId
 *     yields an empty result, never a query against an unverified id.
 *   T-37-05 posture: the RPC is invoked as a parameterized SQL function via
 *     drizzle's `sql` tag — never string concatenation.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { resolveListScope } from "../_scope";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

/** Mirrors the listener tool schema's maxLength: 200 bound on model/user text. */
export const searchKnowledgeInputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  importerId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeInputSchema>;

// ---------------------------------------------------------------------------
// Row + item shapes
// ---------------------------------------------------------------------------

/** Raw row shape returned by match_knowledge_nodes_by_trgm (snake_case SQL). */
export interface KnowledgeSearchRow {
  readonly id: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly scope: string | null;
  readonly scope_ref_id: string | null;
  readonly tier: string | null;
  readonly confidence: number | null;
  readonly sim: number | null;
}

export interface KnowledgeSearchItem {
  readonly id: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly scope: string | null;
  readonly scopeRefId: string | null;
  readonly tier: string | null;
  readonly confidence: number | null;
  readonly sim: number;
}

// ---------------------------------------------------------------------------
// Pure merge/rank helper — exported for DB-free testing
// ---------------------------------------------------------------------------

/**
 * mergeKnowledgeSearchRows — flattens per-importer RPC result pages, maps to
 * camelCase items, de-duplicates by node id (first occurrence wins), sorts by
 * similarity descending (stable for ties via original order), and truncates
 * to `limit`. Never mutates its inputs.
 */
export function mergeKnowledgeSearchRows(
  pages: ReadonlyArray<ReadonlyArray<KnowledgeSearchRow>>,
  limit: number,
): KnowledgeSearchItem[] {
  const seen = new Set<string>();
  const items: KnowledgeSearchItem[] = [];

  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push({
        id: row.id,
        title: row.title,
        content: row.content,
        scope: row.scope,
        scopeRefId: row.scope_ref_id,
        tier: row.tier,
        confidence: row.confidence,
        sim: typeof row.sim === "number" ? row.sim : 0,
      });
    }
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.sim - a.item.sim || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// Search procedure
// ---------------------------------------------------------------------------

export const knowledgeSearchProcedures = {
  /**
   * search — free-text search over ACTIVE, EXTRACTED-tier knowledge nodes,
   * bounded to the caller's owned importers. Read-only (D-09 posture).
   */
  search: protectedProcedure
    .input(searchKnowledgeInputSchema)
    .query(async ({ ctx, input }) => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);

      if (!scope.ok) {
        return { items: [] as KnowledgeSearchItem[] };
      }

      // One RPC call per owned importer (the SQL function is per-importer by
      // design — same shape as the listener repository's call). Owned sets
      // are small (one per sender domain); parallelize and merge.
      const pages = await Promise.all(
        scope.importerIds.map(async (importerId) => {
          const rows = await ctx.db.execute(
            sql`SELECT id, title, content, scope, scope_ref_id, tier, confidence, sim
                FROM match_knowledge_nodes_by_trgm(${input.query}, ${importerId}::uuid, ${input.limit})`,
          );
          return rows as unknown as KnowledgeSearchRow[];
        }),
      );

      return { items: mergeKnowledgeSearchRows(pages, input.limit) };
    }),
};
