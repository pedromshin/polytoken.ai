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

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  ChatContextEdges,
  ChatConversations,
  ChatMessages,
} from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { tableColumnExists } from "../_column-detect";
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
  // Phase 54 (CLUS-02): optional linkage at creation time — e.g. the
  // canvas's "Attach chat" action creating a NEW conversation already
  // scoped to a thread. Persisted only when migration 0036's thread_id
  // column exists (feature-detected below) — silently dropped otherwise,
  // never a validation error, since "no linkage yet" is a valid state.
  threadId: z.string().uuid().optional(),
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

export const duplicateConversationInputSchema = z.object({
  id: z.string().uuid(),
});
export type DuplicateConversationInput = z.infer<
  typeof duplicateConversationInputSchema
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
// Pure helpers for duplicateConversation — exported for DB-free testing
// (mirrors resolveDefaultModelId above).
// ---------------------------------------------------------------------------

/**
 * duplicateTitleFor — "Copy of <source title>", hard-capped at the same 200
 * chars renameConversationInputSchema enforces (the prefix can push an
 * already-long title over the column's soft contract otherwise).
 */
export function duplicateTitleFor(sourceTitle: string): string {
  return `Copy of ${sourceTitle}`.slice(0, 200);
}

/**
 * remapSiblingGroupIds — D-16 sibling groups are conversation-scoped
 * identities: copying messages into a NEW conversation must mint a FRESH
 * uuid per source group (one new id shared by all rows of that group, so
 * the < N/M > navigator still works in the copy) rather than reusing the
 * source's group ids across two conversations. Null stays null (a turn that
 * was never regenerated). Never mutates its input. `mintUuid` is injectable
 * for deterministic tests only.
 */
export function remapSiblingGroupIds<
  T extends { readonly siblingGroupId: string | null },
>(rows: readonly T[], mintUuid: () => string = () => crypto.randomUUID()): T[] {
  const freshIdBySourceGroup = new Map<string, string>();
  return rows.map((row) => {
    if (row.siblingGroupId === null) {
      return { ...row };
    }
    let fresh = freshIdBySourceGroup.get(row.siblingGroupId);
    if (fresh === undefined) {
      fresh = mintUuid();
      freshIdBySourceGroup.set(row.siblingGroupId, fresh);
    }
    return { ...row, siblingGroupId: fresh };
  });
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

      // Phase 54 (CLUS-02): only attempt to persist threadId when both (a)
      // the caller supplied one and (b) migration 0036's column exists —
      // conditionally spread so the INSERT never references a column that
      // might not physically exist yet (mirrors thread-link.ts's gate).
      let threadIdToInsert: string | undefined;
      if (input.threadId !== undefined) {
        const columnExists = await tableColumnExists(
          ctx.db,
          "chat_conversations",
          "thread_id",
        );
        threadIdToInsert = columnExists ? input.threadId : undefined;
      }

      const [row] = await ctx.db
        .insert(ChatConversations)
        .values({
          userId: ctx.user.id,
          modelId,
          importerId: input.importerId ?? null,
          ...(threadIdToInsert !== undefined
            ? { threadId: threadIdToInsert }
            : {}),
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
   * duplicateConversation — copy an owned conversation into a fresh one:
   * conversation row (userId/modelId/importerId copied; threadId copied only
   * behind the SAME tableColumnExists gate createConversation uses; title
   * "Copy of <source>", capped 200), every chat_messages row (role/parts/
   * turnIndex/version/isActive/status/createdAt preserved — createdAt
   * verbatim so copies of old turns never re-enter the current
   * monthlyChatTurns window (countMonthlyChatTurnsUsed); runId=null — the
   * copy has no run provenance; siblingGroupId remapped to fresh per-group
   * uuids),
   * and every chat_context_edges row (keeps attached context). Deliberately
   * NOT copied: cost ledger, runs, run events, canvas layouts — those are
   * per-run/per-surface provenance of the ORIGINAL, not conversation
   * content. Ownership asserted exactly like rename/delete (fail-closed
   * NOT_FOUND); all writes in ONE Drizzle transaction (mirrors
   * browser-turn.ts's recordBrowserTurn).
   */
  duplicateConversation: protectedProcedure
    .input(duplicateConversationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.id, ctx.user.id),
      );

      const [source] = await ctx.db
        .select({
          title: ChatConversations.title,
          modelId: ChatConversations.modelId,
          importerId: ChatConversations.importerId,
        })
        .from(ChatConversations)
        .where(eq(ChatConversations.id, input.id))
        .limit(1);
      if (!source) {
        throw new Error("Failed to read conversation to duplicate");
      }

      // Phase 54 gate (mirrors createConversation above): only touch
      // thread_id when migration 0036's column physically exists.
      const threadColumnExists = await tableColumnExists(
        ctx.db,
        "chat_conversations",
        "thread_id",
      );
      let sourceThreadId: string | null = null;
      if (threadColumnExists) {
        const [threadRow] = await ctx.db
          .select({ threadId: ChatConversations.threadId })
          .from(ChatConversations)
          .where(eq(ChatConversations.id, input.id))
          .limit(1);
        sourceThreadId = threadRow?.threadId ?? null;
      }

      return ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(ChatConversations)
          .values({
            userId: ctx.user.id,
            modelId: source.modelId,
            importerId: source.importerId,
            title: duplicateTitleFor(source.title),
            ...(threadColumnExists && sourceThreadId !== null
              ? { threadId: sourceThreadId }
              : {}),
          })
          .returning({ id: ChatConversations.id });
        if (!created) {
          throw new Error("Failed to duplicate conversation");
        }

        const messages = await tx
          .select({
            role: ChatMessages.role,
            parts: ChatMessages.parts,
            turnIndex: ChatMessages.turnIndex,
            siblingGroupId: ChatMessages.siblingGroupId,
            version: ChatMessages.version,
            isActive: ChatMessages.isActive,
            status: ChatMessages.status,
            createdAt: ChatMessages.createdAt,
          })
          .from(ChatMessages)
          .where(eq(ChatMessages.conversationId, input.id))
          .orderBy(asc(ChatMessages.turnIndex), asc(ChatMessages.version));

        const remapped = remapSiblingGroupIds(messages);
        if (remapped.length > 0) {
          await tx.insert(ChatMessages).values(
            remapped.map((message) => ({
              conversationId: created.id,
              runId: null,
              role: message.role,
              parts: message.parts,
              turnIndex: message.turnIndex,
              siblingGroupId: message.siblingGroupId,
              version: message.version,
              isActive: message.isActive,
              status: message.status,
              // Carried VERBATIM from the source row — omitting this would let
              // the column's defaultNow() re-stamp every copy into the current
              // month, so duplicating an old conversation would spuriously
              // consume monthlyChatTurns allowance (countMonthlyChatTurnsUsed
              // windows on created_at; the meter AND the enforcement gate).
              // Safe to carry: getHistory orders by turnIndex/version, never
              // created_at, so a duplicate renders identically to its source.
              createdAt: message.createdAt,
            })),
          );
        }

        // Context edges (RCNV-04) — copied verbatim (sourceRefKey is derived
        // from sourceRef, which is unchanged; the partial unique index is
        // per-conversation so the copy can't collide with the source's rows).
        const edges = await tx
          .select({
            sourceRef: ChatContextEdges.sourceRef,
            sourceRefKey: ChatContextEdges.sourceRefKey,
            isActive: ChatContextEdges.isActive,
          })
          .from(ChatContextEdges)
          .where(eq(ChatContextEdges.targetConversationId, input.id));
        if (edges.length > 0) {
          await tx.insert(ChatContextEdges).values(
            edges.map((edge) => ({
              targetConversationId: created.id,
              sourceRef: edge.sourceRef,
              sourceRefKey: edge.sourceRefKey,
              isActive: edge.isActive,
            })),
          );
        }

        return { id: created.id };
      });
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
