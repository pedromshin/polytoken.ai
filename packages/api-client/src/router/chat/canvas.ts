/**
 * chat/canvas.ts — chat.getCanvasLayout + chat.saveCanvasLayout tRPC
 * procedures over Drizzle, gated by CanvasSnapshotSchema (CANVAS-02, FOUND-6).
 *
 * The schema/guards themselves live in `./canvas-schema` (split out 2026-07-04
 * during plan 23-04 — see that module's own doc comment) so a CLIENT
 * component can import `CanvasSnapshotSchema` for read-side re-validation
 * (T-23-09) WITHOUT transitively pulling in `../../trpc` -> `@nauta/db`'s
 * server-only Postgres client. Re-exported here verbatim so this file's own
 * procedures and the existing `__tests__/canvas.test.ts` need no changes.
 *
 * saveCanvasLayout upserts by conversationId (D-05/D-06 — one row per
 * conversation, last-write-wins, no CRDT).
 */

import { eq } from "drizzle-orm";

import { ChatCanvasLayouts } from "@nauta/db/schema";

import { publicProcedure } from "../../trpc";
import {
  CanvasSnapshotSchema,
  getCanvasLayoutInputSchema,
  hasForbiddenKeyDeep,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODES,
  saveCanvasLayoutInputSchema,
  type CanvasSnapshot,
  type GetCanvasLayoutInput,
  type SaveCanvasLayoutInput,
} from "./canvas-schema";

export {
  CanvasSnapshotSchema,
  getCanvasLayoutInputSchema,
  hasForbiddenKeyDeep,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODES,
  saveCanvasLayoutInputSchema,
};
export type { CanvasSnapshot, GetCanvasLayoutInput, SaveCanvasLayoutInput };

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const chatCanvasProcedures = {
  /**
   * getCanvasLayout — the single chat_canvas_layouts row for conversationId,
   * or null if the conversation has never saved a canvas layout.
   */
  getCanvasLayout: publicProcedure
    .input(getCanvasLayoutInputSchema)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(ChatCanvasLayouts)
        .where(eq(ChatCanvasLayouts.conversationId, input.conversationId))
        .limit(1);

      return row ?? null;
    }),

  /**
   * saveCanvasLayout — upsert by conversationId (D-05/D-06 — one row per
   * conversation, debounced last-write-wins snapshot from the client).
   */
  saveCanvasLayout: publicProcedure
    .input(saveCanvasLayoutInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { conversationId, snapshot } = input;

      await ctx.db
        .insert(ChatCanvasLayouts)
        .values({
          conversationId,
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          viewport: snapshot.viewport ?? null,
          sharedState: snapshot.sharedState,
          nodeRegistryVersion: snapshot.nodeRegistryVersion,
        })
        .onConflictDoUpdate({
          target: ChatCanvasLayouts.conversationId,
          set: {
            nodes: snapshot.nodes,
            edges: snapshot.edges,
            viewport: snapshot.viewport ?? null,
            sharedState: snapshot.sharedState,
            nodeRegistryVersion: snapshot.nodeRegistryVersion,
            updatedAt: new Date(),
          },
        });

      return { saved: true };
    }),
};
