/**
 * chat/sources.ts — the `listSources` tRPC procedure (RCNV-02/RSRCH-03, the
 * dark RCNV-02 read seam).
 *
 * Returns a conversation's `chat_source_ledger` rows — the per-conversation,
 * zero-ceremony candidate pool of tool sources the agent auto-collected
 * (`chat-source-ledger.ts`) — as the exact `SourceLedgerRow` shape the /chat
 * canvas's reconcile Pass 2c expects (`use-canvas-persistence.ts`). This is
 * the FEED half of the wiring: the canvas already knows how to materialize a
 * `source` node from each row, it just needed the rows.
 *
 * Security (mirrors history.ts / context-edges.ts exactly): a session is
 * required (protectedProcedure), conversationId is validated as a uuid before
 * any query runs, and ownership is asserted via
 * `@polytoken/db/ownership`'s assertConversationOwnership BEFORE reading —
 * `chat_source_ledger` is tenancy-scoped THROUGH the conversation, never via
 * its (FK-less, denormalized) importerId (the schema's own Landmine 2). A
 * non-owned conversationId surfaces as NOT_FOUND (assertOwnedOrNotFound).
 *
 * Additive: the read only SELECTs; with no ledger rows it returns `[]`, and
 * the canvas's `sourceRows` reconcile is inert on an empty array (byte-
 * identical, no source nodes).
 */

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatSourceLedger } from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const listSourcesInputSchema = z.object({
  conversationId: z.string().uuid(),
});
export type ListSourcesInput = z.infer<typeof listSourcesInputSchema>;

/**
 * SourceLedgerRow — the exact shape the /chat canvas reconcile pass consumes
 * (mirrors `use-canvas-persistence.ts`'s own `SourceLedgerRow`): the row id +
 * the immutable display payload + the promotion anchor. `knowledgeNodeId !==
 * null` is precisely "promoted into the knowledge graph" (drives the node's
 * tier). Kept here as the read's return contract; the client maps 1:1.
 */
export interface SourceLedgerRow {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly knowledgeNodeId: string | null;
}

// D-26/T-22-19-adjacent — unbounded-payload guard, mirrors history.ts's
// MAX_HISTORY_ROWS cap. A conversation's auto-collected source pool is small
// in practice; this is the row-count safety ceiling.
const MAX_SOURCE_ROWS = 500;

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const chatSourcesProcedures = {
  /**
   * listSources — a caller's `chat_source_ledger` rows for an owned
   * conversation, oldest-first (capturedAt asc) so the canvas materializes
   * sources in arrival order. Returns `[]` when the conversation has
   * collected no sources; ownership is asserted before any read.
   */
  listSources: protectedProcedure
    .input(listSourcesInputSchema)
    .query(async ({ ctx, input }): Promise<ReadonlyArray<SourceLedgerRow>> => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const rows = await ctx.db
        .select({
          id: ChatSourceLedger.id,
          url: ChatSourceLedger.url,
          title: ChatSourceLedger.title,
          snippet: ChatSourceLedger.snippet,
          knowledgeNodeId: ChatSourceLedger.knowledgeNodeId,
        })
        .from(ChatSourceLedger)
        .where(eq(ChatSourceLedger.conversationId, input.conversationId))
        .orderBy(asc(ChatSourceLedger.capturedAt))
        .limit(MAX_SOURCE_ROWS);

      return rows;
    }),
};
