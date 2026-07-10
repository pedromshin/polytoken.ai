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
 *
 * Phase 44 (TENA-03, T-44-07-01/04): chat_conversations carries a DIRECT
 * user_id (not importer-anchored, Plan 01/02). Every procedure here requires
 * a session (protectedProcedure). createConversation writes
 * user_id = ctx.user.id; listConversations filters on it (never the
 * importerId alone); rename/delete/setModel assert conversation ownership
 * via @polytoken/db/ownership BEFORE the write (fail-closed NOT_FOUND).
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatConversations } from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

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
// D-10 — selection persists: setModel updates a conversation's remembered
// model. Combined with createConversation's last-used default (above), this
// is what makes the picker's choice "sticky" across conversations.
// ---------------------------------------------------------------------------
export const setModelInputSchema = z.object({
  conversationId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
});
export type SetModelInput = z.infer<typeof setModelInputSchema>;

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
   * DEFAULT_CHAT_MODEL_ID. user_id is always the session-derived ctx.user.id
   * (T-44-07-04 — never client-supplied). Returns the new row's id.
   */
  createConversation: protectedProcedure
    .input(createConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      let lastUsedModelId: string | null = null;
      if (input.modelId === undefined) {
        const [lastUsed] = await ctx.db
          .select({ modelId: ChatConversations.modelId })
          .from(ChatConversations)
          .where(eq(ChatConversations.userId, ctx.user.id))
          .orderBy(desc(ChatConversations.updatedAt))
          .limit(1);
        lastUsedModelId = lastUsed?.modelId ?? null;
      }

      const modelId = resolveDefaultModelId(input.modelId, lastUsedModelId);

      const [row] = await ctx.db
        .insert(ChatConversations)
        .values({
          userId: ctx.user.id,
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
   * desc, scoped to the caller's own conversations (T-44-07-01 — replaces
   * the old importerId-only scoping). importerId, when provided, narrows
   * further within the caller's own rows (D-11 rail recency list) — it is
   * NEVER trusted for tenant scoping on its own.
   */
  listConversations: protectedProcedure
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
          and(
            eq(ChatConversations.userId, ctx.user.id),
            input.importerId !== undefined
              ? eq(ChatConversations.importerId, input.importerId)
              : undefined,
          ),
        )
        .orderBy(desc(ChatConversations.updatedAt))
        .limit(MAX_LIST_ROWS);

      return rows;
    }),

  /**
   * renameConversation — manual inline rename (D-12), title length-capped.
   * Asserts conversation ownership BEFORE the write (T-44-07-01) — a
   * non-owned conversationId surfaces as NOT_FOUND, fail-closed.
   */
  renameConversation: protectedProcedure
    .input(renameConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.id, ctx.user.id),
      );

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
   * AlertDialog confirm (T-22-18). Asserts conversation ownership BEFORE the
   * delete (T-44-07-01) — a non-owned conversationId surfaces as NOT_FOUND.
   */
  deleteConversation: protectedProcedure
    .input(deleteConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.id, ctx.user.id),
      );

      await ctx.db
        .delete(ChatConversations)
        .where(eq(ChatConversations.id, input.id));
      return { deleted: true };
    }),

  /**
   * setModel — persists the picker's selection onto the conversation (D-10).
   * Enforcement of which models are selectable (curated registry membership)
   * is the client's job (the picker only ever offers registry entries);
   * this mutation itself just writes the id through, matching the same
   * trust posture as renameConversation's title write. Asserts conversation
   * ownership BEFORE the write (T-44-07-01).
   */
  setModel: protectedProcedure
    .input(setModelInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      await ctx.db
        .update(ChatConversations)
        .set({ modelId: input.modelId, updatedAt: new Date() })
        .where(eq(ChatConversations.id, input.conversationId));
      return { updated: true };
    }),
};
