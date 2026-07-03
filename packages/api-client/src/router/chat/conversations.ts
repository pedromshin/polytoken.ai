/**
 * chat/conversations.ts — create / list / rename / delete chat_conversations
 * directly over Drizzle (mirrors entities/gallery.ts + entities/mutations.ts:
 * ctx.db reads/writes, Zod-at-the-boundary, importer-scoped where applicable).
 *
 * Security (T-22-16, T-22-18, T-22-19):
 *   - ids are validated as z.string().uuid(); title is length-capped at 200 chars.
 *   - all queries use Drizzle parameterized builders — no raw string interpolation.
 *   - deleteConversation performs a real Drizzle `delete` (hard delete, D-14). The
 *     UI gates this behind an explicit AlertDialog confirm; there is no undo path.
 *   - listConversations caps the row count (T-22-19 — unbounded payload guard).
 */

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatConversations } from "@nauta/db/schema";

import { publicProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// D-04/D-10 — fallback default model for a brand-new conversation with no
// prior history. Mirrors `us.anthropic.claude-sonnet-4-6`, the Bedrock model
// id used by CHAT_MODEL_REGISTRY's first entry
// (apps/email-listener/app/domain/services/chat_model_registry.py) — keep
// these two literal ids in sync by hand if that registry's default moves.
// ---------------------------------------------------------------------------
export const DEFAULT_CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Input schemas — exported for DB-free testing (mirrors entities/gallery.ts)
// ---------------------------------------------------------------------------

export const createConversationInputSchema = z.object({
  modelId: z.string().min(1).max(200).optional(),
  importerId: z.string().uuid().optional(),
});
export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>;

export const listConversationsInputSchema = z.object({
  importerId: z.string().uuid().optional(),
});
export type ListConversationsInput = z.infer<
  typeof listConversationsInputSchema
>;

export const renameConversationInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
});
export type RenameConversationInput = z.infer<
  typeof renameConversationInputSchema
>;

export const deleteConversationInputSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteConversationInput = z.infer<
  typeof deleteConversationInputSchema
>;

// ---------------------------------------------------------------------------
// D-19 — unbounded list payload guard (T-22-19).
// ---------------------------------------------------------------------------
const MAX_LIST_ROWS = 200;

// ---------------------------------------------------------------------------
// Pure helper — exported for DB-free testing (D-10 remember-last-used).
//
// Resolves the model id for a new conversation: an explicit request wins;
// otherwise fall back to the most-recently-updated conversation's model id;
// otherwise the hardcoded default. Never mutates its inputs.
// ---------------------------------------------------------------------------
export function resolveDefaultModelId(
  requestedModelId: string | undefined,
  lastUsedModelId: string | null | undefined,
): string {
  if (requestedModelId !== undefined) {
    return requestedModelId;
  }
  return lastUsedModelId ?? DEFAULT_CHAT_MODEL_ID;
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const chatConversationsProcedures = {
  /**
   * createConversation — insert a new chat_conversations row. modelId defaults
   * to the most-recently-updated conversation's modelId (D-10), else
   * DEFAULT_CHAT_MODEL_ID. Returns the new row's id.
   */
  createConversation: publicProcedure
    .input(createConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      let lastUsedModelId: string | null = null;
      if (input.modelId === undefined) {
        const [lastUsed] = await ctx.db
          .select({ modelId: ChatConversations.modelId })
          .from(ChatConversations)
          .orderBy(desc(ChatConversations.updatedAt))
          .limit(1);
        lastUsedModelId = lastUsed?.modelId ?? null;
      }

      const modelId = resolveDefaultModelId(input.modelId, lastUsedModelId);

      const [row] = await ctx.db
        .insert(ChatConversations)
        .values({
          modelId,
          importerId: input.importerId ?? null,
        })
        .returning({ id: ChatConversations.id });

      if (!row) {
        throw new Error("Failed to create conversation");
      }

      return { id: row.id };
    }),

  /**
   * listConversations — id, title, modelId, updatedAt ordered by updatedAt
   * desc, importer-scoped when importerId is provided (D-11 rail recency list).
   */
  listConversations: publicProcedure
    .input(listConversationsInputSchema)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: ChatConversations.id,
          title: ChatConversations.title,
          modelId: ChatConversations.modelId,
          updatedAt: ChatConversations.updatedAt,
        })
        .from(ChatConversations)
        .where(
          input.importerId !== undefined
            ? eq(ChatConversations.importerId, input.importerId)
            : undefined,
        )
        .orderBy(desc(ChatConversations.updatedAt))
        .limit(MAX_LIST_ROWS);

      return rows;
    }),

  /**
   * renameConversation — manual inline rename (D-12), title length-capped.
   */
  renameConversation: publicProcedure
    .input(renameConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(ChatConversations)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(ChatConversations.id, input.id));
      return { renamed: true };
    }),

  /**
   * deleteConversation — hard delete (D-14). FK cascade removes
   * messages/runs/events; chat_cost_ledger rows survive via ON DELETE SET
   * NULL. No soft-delete/undo path exists — the UI gates this behind an
   * AlertDialog confirm (T-22-18).
   */
  deleteConversation: publicProcedure
    .input(deleteConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(ChatConversations)
        .where(eq(ChatConversations.id, input.id));
      return { deleted: true };
    }),
};
