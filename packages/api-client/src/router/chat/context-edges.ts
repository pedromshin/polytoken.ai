/**
 * chat/context-edges.ts — the durable semantic linkage store's write/read
 * seam (RCNV-04, Phase 56 Plan 03, migration 0037). Mirrors `thread-link.ts`
 * exactly: ownership BEFORE any write, `tableColumnExists` + a live 42703/
 * 42P01 try/catch fail-open (migration 0037 is AUTHORED but APPLIED TO NO
 * ENVIRONMENT — 56-01-SUMMARY.md), a discriminated result rather than a
 * throw for "linkage unavailable."
 *
 * **The write-time cross-tenant check is this file's reason to exist**
 * (RESEARCH Landmine 2, T-56-03-01). `createContextEdge` asserts, IN ORDER:
 *   1. the caller owns `targetConversationId` (assertConversationOwnership) —
 *      BEFORE any sourceRef work, so a foreign conversation never leaks
 *      whether a sourceRef would otherwise resolve;
 *   2. `chat_context_edges` exists yet (tableColumnExists) — checked before
 *      touching `chat_source_ledger` too, since both tables land in the SAME
 *      migration 0037 (56-01-SUMMARY.md) — table-existence of one implies
 *      the other, so this single gate is sufficient for every sourceRef.type;
 *   3. the caller owns the THING sourceRef points at
 *      (assertSourceRefOwnership, `@polytoken/db/ownership`) — per
 *      sourceRef.type: knowledge_node, source_ledger, genui_panel,
 *      email_thread. A foreign resource of ANY type -> NOT_FOUND, no row
 *      written.
 *
 * sourceRefKey is ALWAYS computed server-side from the validated sourceRef —
 * never accepted as client input (T-56-03-02). The upsert-or-reactivate
 * write targets the partial UNIQUE(target_conversation_id, source_ref_key)
 * WHERE is_active index (`chat-context-edges.ts`'s
 * idx_chat_context_edges_active_identity) via `onConflictDoUpdate` +
 * `targetWhere` — calling createContextEdge twice for the same identity
 * never produces two active rows.
 *
 * Decision D-56-A (56-03-PLAN.md): `assertSourceRefOwnership` performs
 * OWNERSHIP resolution ONLY for `knowledge_node` — no trust-tier check. An
 * explicit user-drawn edge injects regardless of tier; only the (unrelated)
 * `list_injectable_edges` automatic-injection gate cares about tier.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  assertConversationOwnership,
  assertSourceRefOwnership,
} from "@polytoken/db/ownership";
import { ChatContextEdges, type ChatContextEdgeRow } from "@polytoken/db/schema";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { tableColumnExists } from "../_column-detect";

const CHAT_CONTEXT_EDGES_TABLE = "chat_context_edges";
const SOURCE_REF_KEY_COLUMN = "source_ref_key";

/** Postgres error codes for "table/column does not exist" (0037 unapplied). */
const UNDEFINED_COLUMN_ERROR_CODE = "42703";
const UNDEFINED_TABLE_ERROR_CODE = "42P01";

function isTableUnavailableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === UNDEFINED_COLUMN_ERROR_CODE || code === UNDEFINED_TABLE_ERROR_CODE;
}

// ---------------------------------------------------------------------------
// sourceRef discriminated union — the SHARED CONTRACT with
// `chat-context-edges.ts`'s doc comment and the (future, 56-04) Python
// resolver. Validated at this tRPC boundary (FOUND-6).
// ---------------------------------------------------------------------------

export const contextEdgeSourceRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("source_ledger"), ledgerId: z.string().uuid() }),
  z.object({ type: z.literal("knowledge_node"), nodeId: z.string().uuid() }),
  z.object({
    type: z.literal("genui_panel"),
    messageId: z.string().uuid(),
    partIndex: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("email_thread"), threadId: z.string().uuid() }),
]);
export type ContextEdgeSourceRef = z.infer<typeof contextEdgeSourceRefSchema>;

/**
 * computeSourceRefKey — the derived, stable string identity of a sourceRef.
 * ALWAYS computed server-side (never client-supplied) — this is the value
 * written to `chat_context_edges.source_ref_key`, the identity column the
 * partial unique active-identity index enforces uniqueness over.
 */
export function computeSourceRefKey(sourceRef: ContextEdgeSourceRef): string {
  switch (sourceRef.type) {
    case "source_ledger":
      return `source_ledger:${sourceRef.ledgerId}`;
    case "knowledge_node":
      return `knowledge_node:${sourceRef.nodeId}`;
    case "genui_panel":
      return `genui_panel:${sourceRef.messageId}:${sourceRef.partIndex}`;
    case "email_thread":
      return `email_thread:${sourceRef.threadId}`;
  }
}

// ---------------------------------------------------------------------------
// Input schemas — exported for DB-free testing
// ---------------------------------------------------------------------------

export const createContextEdgeInputSchema = z.object({
  targetConversationId: z.string().uuid(),
  sourceRef: contextEdgeSourceRefSchema,
});
export type CreateContextEdgeInput = z.infer<typeof createContextEdgeInputSchema>;

export const removeContextEdgeInputSchema = z.object({
  edgeId: z.string().uuid(),
});
export type RemoveContextEdgeInput = z.infer<typeof removeContextEdgeInputSchema>;

export const listContextEdgesInputSchema = z.object({
  conversationId: z.string().uuid(),
});
export type ListContextEdgesInput = z.infer<typeof listContextEdgesInputSchema>;

// ---------------------------------------------------------------------------
// Discriminated results — "linkage unavailable" (0037 unapplied) is an
// expected, non-exceptional state, mirrors thread-link.ts exactly.
// ---------------------------------------------------------------------------

export type CreateContextEdgeResult =
  | { readonly created: true; readonly edge: ChatContextEdgeRow }
  | { readonly created: false; readonly reason: "linkage_unavailable" };

export type RemoveContextEdgeResult =
  | { readonly removed: true }
  | { readonly removed: false; readonly reason: "linkage_unavailable" };

const LINKAGE_UNAVAILABLE_CREATE: CreateContextEdgeResult = {
  created: false,
  reason: "linkage_unavailable",
};

const LINKAGE_UNAVAILABLE_REMOVE: RemoveContextEdgeResult = {
  removed: false,
  reason: "linkage_unavailable",
};

// ---------------------------------------------------------------------------
// Procedures — spread into chatRouter
// ---------------------------------------------------------------------------

export const chatContextEdgeProcedures = {
  /**
   * createContextEdge — the write half of RCNV-04. Ownership-gated (target
   * conversation THEN sourceRef, see module doc comment for the exact
   * order), upserts-or-reactivates on the (targetConversationId,
   * sourceRefKey) active identity. Returns `{ created: false, reason:
   * "linkage_unavailable" }` (never throws) when migration 0037 hasn't
   * landed yet in this environment.
   */
  createContextEdge: protectedProcedure
    .input(createContextEdgeInputSchema)
    .mutation(async ({ ctx, input }): Promise<CreateContextEdgeResult> => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.targetConversationId, ctx.user.id),
      );

      const columnExists = await tableColumnExists(
        ctx.db,
        CHAT_CONTEXT_EDGES_TABLE,
        SOURCE_REF_KEY_COLUMN,
      );
      if (!columnExists) {
        return LINKAGE_UNAVAILABLE_CREATE;
      }

      // Safe now: chat_context_edges and chat_source_ledger land in the same
      // migration 0037 (56-01-SUMMARY.md) — confirming the former exists
      // confirms the latter does too, so a source_ledger-typed sourceRef's
      // join below cannot hit an undefined-table error.
      await assertOwnedOrNotFound(() =>
        assertSourceRefOwnership(ctx.db, ctx.user.id, input.sourceRef),
      );

      const sourceRefKey = computeSourceRefKey(input.sourceRef);

      try {
        const rows = await ctx.db
          .insert(ChatContextEdges)
          .values({
            targetConversationId: input.targetConversationId,
            sourceRef: input.sourceRef,
            sourceRefKey,
            isActive: true,
          })
          .onConflictDoUpdate({
            target: [ChatContextEdges.targetConversationId, ChatContextEdges.sourceRefKey],
            targetWhere: sql`is_active`,
            set: { isActive: true },
          })
          .returning();

        const edge = rows[0];
        if (!edge) {
          return LINKAGE_UNAVAILABLE_CREATE;
        }
        return { created: true, edge };
      } catch (error) {
        if (isTableUnavailableError(error)) {
          return LINKAGE_UNAVAILABLE_CREATE;
        }
        throw error;
      }
    }),

  /**
   * removeContextEdge — soft-deactivates (isActive=false), preserving the
   * "this chat WAS informed by X" audit trail (T-56-03-05). Ownership is
   * resolved via the edge's OWN targetConversationId (a caller cannot
   * remove an edge on a conversation they don't own, even if they somehow
   * knew the edgeId) — reuses assertConversationOwnership, never a bespoke
   * check.
   */
  removeContextEdge: protectedProcedure
    .input(removeContextEdgeInputSchema)
    .mutation(async ({ ctx, input }): Promise<RemoveContextEdgeResult> => {
      const columnExists = await tableColumnExists(
        ctx.db,
        CHAT_CONTEXT_EDGES_TABLE,
        SOURCE_REF_KEY_COLUMN,
      );
      if (!columnExists) {
        return LINKAGE_UNAVAILABLE_REMOVE;
      }

      let targetConversationId: string;
      try {
        const rows = await ctx.db
          .select({ targetConversationId: ChatContextEdges.targetConversationId })
          .from(ChatContextEdges)
          .where(eq(ChatContextEdges.id, input.edgeId))
          .limit(1);

        const row = rows[0];
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        targetConversationId = row.targetConversationId;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        if (isTableUnavailableError(error)) {
          return LINKAGE_UNAVAILABLE_REMOVE;
        }
        throw error;
      }

      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, targetConversationId, ctx.user.id),
      );

      try {
        await ctx.db
          .update(ChatContextEdges)
          .set({ isActive: false })
          .where(eq(ChatContextEdges.id, input.edgeId));
        return { removed: true };
      } catch (error) {
        if (isTableUnavailableError(error)) {
          return LINKAGE_UNAVAILABLE_REMOVE;
        }
        throw error;
      }
    }),

  /**
   * listContextEdges — a caller's active edges for an owned conversation.
   * Returns `[]` (never throws) both when no edges exist AND when migration
   * 0037 hasn't landed yet.
   */
  listContextEdges: protectedProcedure
    .input(listContextEdgesInputSchema)
    .query(async ({ ctx, input }): Promise<ReadonlyArray<ChatContextEdgeRow>> => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const columnExists = await tableColumnExists(
        ctx.db,
        CHAT_CONTEXT_EDGES_TABLE,
        SOURCE_REF_KEY_COLUMN,
      );
      if (!columnExists) {
        return [];
      }

      try {
        const rows = await ctx.db
          .select()
          .from(ChatContextEdges)
          .where(
            and(
              eq(ChatContextEdges.targetConversationId, input.conversationId),
              eq(ChatContextEdges.isActive, true),
            ),
          );
        return rows;
      } catch (error) {
        if (isTableUnavailableError(error)) {
          return [];
        }
        throw error;
      }
    }),
};
