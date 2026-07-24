/**
 * chat/home-canvas.ts — chat.getHomeCanvasLayout + chat.saveHomeCanvasLayout
 * (HM-01 — the pinned, conversation-independent home board at `/`).
 *
 * The home board REUSES the `chat_canvas_layouts` persistence wholesale — same
 * table, same `CanvasSnapshotSchema` (canvas-schema.ts), same node/edge/
 * sharedState shape as the /chat canvas. The ONLY difference is the scope
 * discriminator added in migration 0046: a home row is keyed on
 * (`user_id`, `scope = 'home'`) with a NULL `conversation_id`, whereas a
 * conversation row is keyed on `conversation_id` with a NULL user_id/scope. The
 * CHECK constraint (`chat_canvas_layouts_scope_discriminator`) makes the two
 * shapes mutually exclusive; a partial unique index on `user_id WHERE scope =
 * 'home'` guarantees one home board per user — the upsert target below.
 *
 * Tenancy (HM-01, TENA-03/INV-8-9): both procedures are `protectedProcedure`
 * and key STRICTLY on `ctx.user.id` — the home board is owned by construction,
 * so there is NO client-supplied id to check ownership on (unlike the
 * conversation-scoped procedures, which assert ownership of a client-passed
 * `conversationId`). User B's read filters `user_id = B` and therefore can
 * NEVER see user A's home row; a save always STAMPS `ctx.user.id` (never a body
 * field), so cross-tenant writes are structurally impossible. The `scope =
 * 'home'` filter on every read/write also guarantees a home procedure can never
 * return or clobber a conversation row.
 */

import { z } from "zod";

import { protectedProcedure } from "../../trpc";
import { CanvasSnapshotSchema } from "./canvas-schema";
import {
  readHomeCanvasLayout,
  writeHomeCanvasLayout,
} from "./canvas-store-backend";

/** The single `scope` value a home-board layout row carries (migration 0046). */
export const HOME_CANVAS_SCOPE = "home" as const;

/**
 * saveHomeCanvasLayout input — a bare snapshot, NO conversationId (the home
 * board is keyed on the session user, not a conversation). Mirrors
 * saveCanvasLayoutInputSchema minus the conversationId field.
 */
export const saveHomeCanvasLayoutInputSchema = z
  .object({ snapshot: CanvasSnapshotSchema })
  .strict();
export type SaveHomeCanvasLayoutInput = z.infer<
  typeof saveHomeCanvasLayoutInputSchema
>;

export const chatHomeCanvasProcedures = {
  /**
   * getHomeCanvasLayout — the caller's single home-scoped board (blob or rows,
   * per CANVAS_ROW_MODEL — same shape either way), or null if they have never
   * saved a home board. Keyed strictly on ctx.user.id (the home board is owned by
   * construction — no client id to check).
   */
  getHomeCanvasLayout: protectedProcedure.query(async ({ ctx }) => {
    return readHomeCanvasLayout(ctx.db, ctx.user.id);
  }),

  /**
   * saveHomeCanvasLayout — upsert the caller's home board (debounced last-
   * write-wins snapshot from the client, exactly like saveCanvasLayout). The blob
   * stays authoritative (its partial-unique-index upsert preserved verbatim in
   * canvas-store-backend.ts); under dual_write/read_rows a best-effort row write
   * mirrors it. `user_id`/`scope` are stamped from the session — never the body.
   */
  saveHomeCanvasLayout: protectedProcedure
    .input(saveHomeCanvasLayoutInputSchema)
    .mutation(async ({ ctx, input }) => {
      await writeHomeCanvasLayout(ctx.db, ctx.user.id, input.snapshot);

      return { saved: true };
    }),
};
