/**
 * canvas-recipes/index.ts — canvasRecipesRouter (Phase 73 Wave C, LCAN-07/08).
 *
 * The owner-gated CRUD control plane for the `canvas_recipes` table: a named,
 * persisted dataflow recipe (name + the node/edge key-set + a stored-but-not-
 * yet-consumed `sourceRef` re-poll descriptor) that groups a wired graph on a
 * conversation's canvas.
 *
 * ## Tenancy (LCAN-08 / TENA-03) — ownership asserted FIRST, always
 *   - Every procedure is `protectedProcedure`; the acting identity is ALWAYS
 *     `ctx.user.id`, NEVER a client field. `create` stamps `userId` server-side.
 *   - Conversation-scoped procedures (`create`, `list`) assert
 *     `assertConversationOwnership` at the TOP — a non-owned conversationId
 *     surfaces NOT_FOUND before any read/write (mirrors
 *     canvas-mutations.ts:281 + spreadsheets/index.ts:150).
 *   - Recipe-addressed procedures (`byId`, `rename`, `remove`) assert
 *     `assertCanvasRecipeOwnership` at the TOP — a non-owner surfaces NOT_FOUND
 *     BEFORE any read or write (fail-closed, no existence oracle). The ownership
 *     read is the gate, not a data leak.
 *
 * ## Scope
 * This module is the CRUD backend half of Plan 73-04 (LCAN-07 db + CRUD). The
 * on-canvas recipe badge (web) is a separate stream, and LCAN-09 (the durable
 * after-close recompute — the graphile-worker re-polling `sourceRef`) is a
 * NAMED live-only followup: `sourceRef` is persisted here but nothing consumes
 * it yet.
 *
 * ## Additive — never clobbers the layout
 * These procedures only touch `canvas_recipes` rows; they never read or write
 * `chat_canvas_layouts`, `canvas_nodes`, or `canvas_edges`.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { CanvasRecipes } from "@polytoken/db/schema";
import {
  assertCanvasRecipeOwnership,
  assertConversationOwnership,
} from "@polytoken/db/ownership";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

/** Bound on a recipe name — a label, never a document. */
const recipeNameSchema = z.string().trim().min(1).max(200);

/** Bound on a member key-set — a canonical `type:ref` node key / edge key list.
 * Capped so a recipe row stays a grouping, never an unbounded blob. */
const keyListSchema = z.array(z.string().min(1).max(512)).max(500);

/** The durable re-poll descriptor (LCAN-09). Stored verbatim, NOT consumed this
 * phase — accepted as an opaque object so the worker seam can define its own
 * shape later without a schema migration here. */
const sourceRefSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const canvasRecipesRouter = createTRPCRouter({
  /**
   * create — persist a new named recipe on a conversation's canvas. Conversation
   * ownership asserted FIRST (NOT_FOUND on missing-or-not-yours); `userId` is
   * stamped server-side from `ctx.user.id`, never a client field.
   */
  create: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        name: recipeNameSchema,
        nodeKeys: keyListSchema.default([]),
        edgeKeys: keyListSchema.default([]),
        sourceRef: sourceRefSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const inserted = await ctx.db
        .insert(CanvasRecipes)
        .values({
          userId: ctx.user.id,
          conversationId: input.conversationId,
          name: input.name,
          nodeKeys: input.nodeKeys,
          edgeKeys: input.edgeKeys,
          sourceRef: input.sourceRef ?? null,
        })
        .returning({ id: CanvasRecipes.id });

      const id = inserted[0]?.id;
      if (id === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "canvas_recipes insert returned no id",
        });
      }
      return { recipeId: id, created: true };
    }),

  /**
   * list — the recipes on a conversation's canvas, newest first. Conversation
   * ownership asserted FIRST; omits `sourceRef` (the picker never needs the
   * re-poll descriptor).
   */
  list: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );
      return ctx.db
        .select({
          id: CanvasRecipes.id,
          name: CanvasRecipes.name,
          nodeKeys: CanvasRecipes.nodeKeys,
          edgeKeys: CanvasRecipes.edgeKeys,
          createdAt: CanvasRecipes.createdAt,
          updatedAt: CanvasRecipes.updatedAt,
        })
        .from(CanvasRecipes)
        .where(eq(CanvasRecipes.conversationId, input.conversationId))
        .orderBy(desc(CanvasRecipes.updatedAt))
        .limit(200);
    }),

  /**
   * byId — a single recipe with its name + key-sets + sourceRef. Ownership
   * asserted FIRST (NOT_FOUND on missing-or-not-yours); the read that follows is
   * defensive narrowing, not an existence oracle.
   */
  byId: protectedProcedure
    .input(z.object({ recipeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertCanvasRecipeOwnership(ctx.db, input.recipeId, ctx.user.id),
      );
      const rows = await ctx.db
        .select({
          id: CanvasRecipes.id,
          name: CanvasRecipes.name,
          conversationId: CanvasRecipes.conversationId,
          nodeKeys: CanvasRecipes.nodeKeys,
          edgeKeys: CanvasRecipes.edgeKeys,
          sourceRef: CanvasRecipes.sourceRef,
          createdAt: CanvasRecipes.createdAt,
          updatedAt: CanvasRecipes.updatedAt,
        })
        .from(CanvasRecipes)
        .where(eq(CanvasRecipes.id, input.recipeId))
        .limit(1);
      return rows[0] ?? null;
    }),

  /**
   * rename — change a recipe's name. Ownership asserted FIRST; the UPDATE is ALSO
   * scoped on `user_id` (defense in depth) so a bound handle can never touch a
   * row the caller does not own even if the assert were bypassed.
   */
  rename: protectedProcedure
    .input(z.object({ recipeId: z.string().uuid(), name: recipeNameSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertCanvasRecipeOwnership(ctx.db, input.recipeId, ctx.user.id),
      );
      const updated = await ctx.db
        .update(CanvasRecipes)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(CanvasRecipes.id, input.recipeId),
            eq(CanvasRecipes.userId, ctx.user.id),
          ),
        )
        .returning({ id: CanvasRecipes.id });
      return { recipeId: input.recipeId, updated: updated.length > 0 };
    }),

  /**
   * remove — delete a recipe. Ownership asserted FIRST; the DELETE is ALSO scoped
   * on `user_id` (defense in depth). Removing the recipe NEVER touches its member
   * nodes/edges — a recipe is a name over keys, not their owner.
   */
  remove: protectedProcedure
    .input(z.object({ recipeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertCanvasRecipeOwnership(ctx.db, input.recipeId, ctx.user.id),
      );
      const removed = await ctx.db
        .delete(CanvasRecipes)
        .where(
          and(
            eq(CanvasRecipes.id, input.recipeId),
            eq(CanvasRecipes.userId, ctx.user.id),
          ),
        )
        .returning({ id: CanvasRecipes.id });
      return { recipeId: input.recipeId, removed: removed.length > 0 };
    }),
});
