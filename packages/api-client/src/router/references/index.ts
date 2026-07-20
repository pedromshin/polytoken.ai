/**
 * references/index.ts — referencesRouter (999.35 — saving references INSIDE
 * polytoken; the first real dogfood of D4+D2).
 *
 * A reference is a source-ledger-SHAPED record (url, title, note, tags,
 * saved_at, owner) stored in its own `references` table — NOT a
 * chat_source_ledger row, because that table's tenancy anchor is a NOT NULL
 * conversation_id (CASCADE into chat_conversations) and a user-saved
 * reference has no conversation and must outlive any chat (decision recorded
 * on packages/db/src/schema/references.ts).
 *
 * Tenancy (TENA-03, mirroring documentsRouter exactly): every procedure is
 * `protectedProcedure` — the acting identity is ALWAYS `ctx.user.id`, never a
 * client-supplied field.
 *   - `save` inserts with userId = ctx.user.id (the ownership anchor is set
 *     server-side; input carries no owner field).
 *   - `list` filters directly on ctx.user.id (references carries a DIRECT
 *     user_id anchor — no importer join; the same direct-user_id scoping
 *     documentsRouter.list uses).
 *   - `remove` calls `assertReferenceOwnership` at the TOP of the resolver
 *     BEFORE the delete; a missing reference and one owned by another user
 *     both surface as NOT_FOUND (fail-closed, no existence oracle).
 *
 * Seam (recorded, NOT built): references-as-canvas-nodes — a saved reference
 * is shaped to appear later as a research-canvas node (the sourceRef union in
 * chat_context_edges would grow a `{ type: "reference", referenceId }` arm,
 * with ownership resolved via assertReferenceOwnership). This router adds no
 * canvas coupling.
 */

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { assertReferenceOwnership } from "@polytoken/db/ownership";
import { References } from "@polytoken/db/schema";

import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

/**
 * Tag hygiene at the boundary: trimmed, non-empty, deduped, bounded. Bounds
 * are generous-but-finite so a runaway client can never persist megabyte tag
 * arrays.
 */
const tagsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(20)
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const referencesRouter = createTRPCRouter({
  /**
   * save — persist a reference for the caller. The owner is ctx.user.id,
   * period; the input has no user field to spoof. Returns the full inserted
   * row so the client can reconcile its optimistic cache (and so Undo after a
   * delete can round-trip the exact record).
   */
  save: protectedProcedure
    .input(
      z.object({
        url: z.string().trim().url().max(2048),
        title: z.string().trim().min(1).max(512),
        note: z.string().trim().max(4000).optional(),
        tags: tagsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(References)
        .values({
          userId: ctx.user.id,
          url: input.url,
          title: input.title,
          // Empty note collapses to NULL — the column is "no annotation",
          // never an empty string.
          note: input.note && input.note.length > 0 ? input.note : null,
          tags: input.tags,
        })
        .returning({
          id: References.id,
          url: References.url,
          title: References.title,
          note: References.note,
          tags: References.tags,
          savedAt: References.savedAt,
        });

      return rows[0]!;
    }),

  /**
   * list — the caller's references, newest first. Scoped directly to
   * ctx.user.id (the ownership anchor). limit/offset paging with a `hasMore`
   * hint (mirrors documentsRouter.list). note/tags are small and the list IS
   * the primary surface, so the projection includes them.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: References.id,
          url: References.url,
          title: References.title,
          note: References.note,
          tags: References.tags,
          savedAt: References.savedAt,
        })
        .from(References)
        .where(eq(References.userId, ctx.user.id))
        .orderBy(desc(References.savedAt))
        // Fetch one extra row to compute hasMore without a COUNT.
        .limit(input.limit + 1)
        .offset(input.offset);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
      };
    }),

  /**
   * remove — delete one reference. Ownership is asserted BEFORE the delete;
   * NOT_FOUND on missing-or-not-yours (fail-closed). Named `remove` because
   * `delete` is a reserved word in JS object position ergonomics; the client
   * pairs it with an Undo toast that re-`save`s the captured row (taste
   * checklist item 2 — reversible actions never confirm).
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertReferenceOwnership(ctx.db, input.id, ctx.user.id),
      );

      await ctx.db.delete(References).where(eq(References.id, input.id));

      return { id: input.id };
    }),
});
