/**
 * chat/canvas.ts — chat.getCanvasLayout + chat.saveCanvasLayout tRPC
 * procedures over Drizzle, gated by CanvasSnapshotSchema (CANVAS-02, FOUND-6).
 *
 * CanvasSnapshotSchema is the interface-first data contract every later
 * canvas plan builds against (shared verbatim with plan 23-02's node-data
 * schemas — see 23-01-PLAN.md <interfaces>). It enforces:
 *   - D-05: NO genui spec content in layout rows — node.data is `.refine()`d
 *     to reject `spec`/`root` keys; specs rehydrate from chat_messages by
 *     provenance ref (messageId/partIndex/runId), never duplicated here.
 *   - T-23-01/FOUND-6: prototype-pollution guard (`hasForbiddenKeyDeep`,
 *     mirrors packages/genui/src/renderer/render-node.tsx's FORBIDDEN_KEYS)
 *     on every edge sourcePath/targetKey dotted-path segment and on
 *     sharedState at any depth.
 *   - T-23-04: bounded payload — MAX_CANVAS_NODES/MAX_CANVAS_EDGES caps plus
 *     a serialized-size guard on sharedState.
 *
 * saveCanvasLayout upserts by conversationId (D-05/D-06 — one row per
 * conversation, last-write-wins, no CRDT).
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { ChatCanvasLayouts } from "@nauta/db/schema";

import { publicProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// Prototype-pollution guard (mirrors render-node.tsx FORBIDDEN_KEYS — D-12/T-23-01)
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively checks whether `value` (or any nested object/array within it)
 * contains an own-enumerable key in FORBIDDEN_KEYS. Pure — never mutates its
 * input. Used to reject prototype-pollution attempts smuggled through JSON
 * payloads (JSON.parse creates `__proto__` as a plain own property, not the
 * real prototype — Object.keys/for-in still see it, which is exactly the
 * attack surface this guard closes).
 */
export function hasForbiddenKeyDeep(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeyDeep(item));
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeyDeep((value as Record<string, unknown>)[key])) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if any dotted-path segment of `path` is a forbidden key.
 * Mirrors resolveDataRef's per-segment guard (render-node.tsx).
 */
function hasForbiddenPathSegment(path: string): boolean {
  return path.split(".").some((segment) => FORBIDDEN_KEYS.has(segment));
}

// ---------------------------------------------------------------------------
// Unbounded-payload guards (T-23-04)
// ---------------------------------------------------------------------------

export const MAX_CANVAS_NODES = 200;
export const MAX_CANVAS_EDGES = 400;
const MAX_SHARED_STATE_SERIALIZED_CHARS = 100_000;

// ---------------------------------------------------------------------------
// CanvasSnapshotSchema — the canonical snapshot shape (CANONICAL SNAPSHOT
// SHAPE, 23-01-PLAN.md <interfaces>; shared verbatim with plan 23-02).
// ---------------------------------------------------------------------------

const positionSchema = z
  .object({ x: z.number(), y: z.number() })
  .strict();

// node.data: type-specific record, NO spec content (D-05), no prototype
// pollution keys at any depth (FOUND-6).
const nodeDataSchema = z
  .record(z.string(), z.unknown())
  .refine((data) => !("spec" in data) && !("root" in data), {
    message:
      "node.data must not contain `spec`/`root` keys — layout rows carry only " +
      "provenance refs; specs rehydrate from chat_messages (D-05)",
  })
  .refine((data) => !hasForbiddenKeyDeep(data), {
    message:
      "node.data must not contain __proto__/constructor/prototype keys at any depth",
  });

const canvasNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    position: positionSchema,
    width: z.number().optional(),
    height: z.number().optional(),
    data: nodeDataSchema,
  })
  .strict();

// edge.data: sourcePath/targetKey are dotted-path references — every segment
// must be clear of FORBIDDEN_KEYS (T-23-01).
const edgeDataSchema = z
  .object({
    sourcePath: z.string().refine((s) => !hasForbiddenPathSegment(s), {
      message:
        "sourcePath must not contain a __proto__/constructor/prototype path segment",
    }),
    targetKey: z.string().refine((s) => !hasForbiddenPathSegment(s), {
      message:
        "targetKey must not contain a __proto__/constructor/prototype path segment",
    }),
  })
  .strict();

const canvasEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    data: edgeDataSchema,
  })
  .strict();

const viewportSchema = z
  .object({ x: z.number(), y: z.number(), zoom: z.number() })
  .strict();

// sharedState: recursively FORBIDDEN_KEYS-guarded JSON record, bounded size
// (T-23-01/T-23-04). Streaming/derived values are never persisted here (D-10).
const sharedStateSchema = z
  .record(z.string(), z.unknown())
  .refine((state) => !hasForbiddenKeyDeep(state), {
    message:
      "sharedState must not contain __proto__/constructor/prototype keys at any depth",
  })
  .refine(
    (state) => JSON.stringify(state).length <= MAX_SHARED_STATE_SERIALIZED_CHARS,
    {
      message: `sharedState serialized size exceeds ${MAX_SHARED_STATE_SERIALIZED_CHARS} chars`,
    },
  );

export const CanvasSnapshotSchema = z
  .object({
    nodes: z.array(canvasNodeSchema).max(MAX_CANVAS_NODES),
    edges: z.array(canvasEdgeSchema).max(MAX_CANVAS_EDGES),
    viewport: viewportSchema.optional(),
    sharedState: sharedStateSchema,
    nodeRegistryVersion: z.string().min(1),
  })
  .strict();

export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;

// ---------------------------------------------------------------------------
// Procedure input schemas — exported for DB-free testing
// ---------------------------------------------------------------------------

export const getCanvasLayoutInputSchema = z
  .object({ conversationId: z.string().uuid() })
  .strict();
export type GetCanvasLayoutInput = z.infer<typeof getCanvasLayoutInputSchema>;

export const saveCanvasLayoutInputSchema = z
  .object({
    conversationId: z.string().uuid(),
    snapshot: CanvasSnapshotSchema,
  })
  .strict();
export type SaveCanvasLayoutInput = z.infer<
  typeof saveCanvasLayoutInputSchema
>;

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
