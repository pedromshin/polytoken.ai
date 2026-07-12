/**
 * chat/cluster-summary.ts — chat.clusterSummary: real sibling-chat +
 * captured-source counts for a thread-linked conversation's cluster
 * (CLUS-02/CLUS-06, Phase 54 Plan 06, 54-UI-SPEC.md Component 3's
 * "Cluster context" section — metadata-first, per 54-CONTEXT.md's own
 * framing).
 *
 * A "cluster" (54-CONTEXT.md) is thread + this caller's own conversations
 * linked to it + any web_search_capture knowledge nodes attached (via
 * knowledge_node_edges) to any of those conversations. This resolver:
 *   1. asserts conversation ownership (fail-closed NOT_FOUND — same idiom as
 *      thread-link.ts / conversations.ts);
 *   2. feature-detects migration 0036's thread_id column via
 *      `tableColumnExists` (T-54-01-05) — degrades to
 *      { hasThread:false, 0, 0 } rather than a raw 42703, and additionally
 *      wraps the actual thread_id read in a try/catch for defense in depth
 *      against a live UndefinedColumn (mirrors thread-link.ts exactly);
 *   3. when linked, counts OTHER of the caller's own conversations sharing
 *      the same thread_id (siblingChatCount — never another tenant's rows,
 *      T-54-06-01);
 *   4. counts DISTINCT active knowledge_nodes with the exact literal
 *      contract `source="web_search_capture"` / `scope_ref_type="web_source"`
 *      (SHARED CONTRACT with 54-03's SourceCaptureHandler — keep identical)
 *      that have an active `knowledge_node_edges` row targeting ANY
 *      conversation in this cluster (this conversation + its siblings),
 *      scoped to the caller's OWNED importers (userOwnedImporterIds) —
 *      never a client-supplied importer, never another tenant's nodes.
 *
 * Two-step select (edges, then nodes) rather than a single JOIN — keeps this
 * resolver's DB surface identical in shape to thread-link.ts's plain
 * select/update chains, and lets the edge->node dedupe happen explicitly in
 * JS (a node can be attached to more than one sibling conversation via
 * separate edges; it must only ever count once).
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import {
  assertConversationOwnership,
  userOwnedImporterIds,
} from "@polytoken/db/ownership";
import { ChatConversations, KnowledgeNodeEdges, KnowledgeNodes } from "@polytoken/db/schema";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { tableColumnExists } from "../_column-detect";

const CHAT_CONVERSATIONS_TABLE = "chat_conversations";
const THREAD_ID_COLUMN = "thread_id";

/** Postgres error code for "column does not exist" (0036 unapplied). */
const UNDEFINED_COLUMN_ERROR_CODE = "42703";

// Captured-source literal contract — SHARED with 54-03's
// SourceCaptureHandler (apps/email-listener's confirm_action_dispatch.py /
// knowledge_graph_repository.py). Keep these three literals identical.
const CAPTURED_SOURCE_SOURCE = "web_search_capture";
const CAPTURED_SOURCE_SCOPE_REF_TYPE = "web_source";
const CAPTURED_SOURCE_TARGET_REF_TYPE = "chat_conversation";

function isUndefinedColumnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNDEFINED_COLUMN_ERROR_CODE
  );
}

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const clusterSummaryInputSchema = z.object({
  conversationId: z.string().uuid(),
});
export type ClusterSummaryInput = z.infer<typeof clusterSummaryInputSchema>;

export interface ClusterSummary {
  readonly hasThread: boolean;
  readonly siblingChatCount: number;
  readonly capturedSourceCount: number;
}

const NO_CLUSTER: ClusterSummary = {
  hasThread: false,
  siblingChatCount: 0,
  capturedSourceCount: 0,
};

// ---------------------------------------------------------------------------
// Procedures — spread into chatRouter
// ---------------------------------------------------------------------------

export const chatClusterSummaryProcedures = {
  /**
   * clusterSummary — real sibling-chat + captured-source counts for the
   * caller's own thread cluster. Never throws for "no linkage yet" /
   * "migration unapplied" states — both degrade to NO_CLUSTER. A non-owned
   * conversationId is NOT_FOUND (fail-closed, asserted before any read).
   */
  clusterSummary: protectedProcedure
    .input(clusterSummaryInputSchema)
    .query(async ({ ctx, input }): Promise<ClusterSummary> => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const columnExists = await tableColumnExists(
        ctx.db,
        CHAT_CONVERSATIONS_TABLE,
        THREAD_ID_COLUMN,
      );
      if (!columnExists) {
        return NO_CLUSTER;
      }

      let threadId: string | null;
      try {
        const rows = await ctx.db
          .select({ threadId: ChatConversations.threadId })
          .from(ChatConversations)
          .where(eq(ChatConversations.id, input.conversationId))
          .limit(1);
        threadId = rows[0]?.threadId ?? null;
      } catch (error) {
        if (isUndefinedColumnError(error)) {
          return NO_CLUSTER;
        }
        throw error;
      }

      if (threadId === null) {
        return NO_CLUSTER;
      }

      // Sibling chats: the caller's OWN other conversations sharing this
      // thread_id (T-54-06-01 — never another tenant's rows).
      const siblingRows = await ctx.db
        .select({ id: ChatConversations.id })
        .from(ChatConversations)
        .where(
          and(
            eq(ChatConversations.threadId, threadId),
            eq(ChatConversations.userId, ctx.user.id),
            ne(ChatConversations.id, input.conversationId),
          ),
        );
      const siblingChatCount = siblingRows.length;

      const clusterConversationIds = [
        input.conversationId,
        ...siblingRows.map((row) => row.id),
      ];

      // Captured sources: distinct active web_search_capture/web_source
      // knowledge nodes attached (via an active edge) to ANY conversation in
      // this cluster, scoped to the caller's OWNED importers.
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      let capturedSourceCount = 0;
      if (owned.length > 0) {
        const edgeRows = await ctx.db
          .select({ sourceNodeId: KnowledgeNodeEdges.sourceNodeId })
          .from(KnowledgeNodeEdges)
          .where(
            and(
              eq(KnowledgeNodeEdges.isActive, true),
              eq(KnowledgeNodeEdges.targetRefType, CAPTURED_SOURCE_TARGET_REF_TYPE),
              inArray(KnowledgeNodeEdges.targetRefId, clusterConversationIds),
            ),
          );
        const candidateNodeIds = [
          ...new Set(edgeRows.map((row) => row.sourceNodeId)),
        ];

        if (candidateNodeIds.length > 0) {
          const nodeRows = await ctx.db
            .select({ id: KnowledgeNodes.id })
            .from(KnowledgeNodes)
            .where(
              and(
                inArray(KnowledgeNodes.id, candidateNodeIds),
                eq(KnowledgeNodes.isActive, true),
                eq(KnowledgeNodes.source, CAPTURED_SOURCE_SOURCE),
                eq(KnowledgeNodes.scopeRefType, CAPTURED_SOURCE_SCOPE_REF_TYPE),
                inArray(KnowledgeNodes.importerId, owned),
              ),
            );
          capturedSourceCount = new Set(nodeRows.map((row) => row.id)).size;
        }
      }

      return { hasThread: true, siblingChatCount, capturedSourceCount };
    }),
};
