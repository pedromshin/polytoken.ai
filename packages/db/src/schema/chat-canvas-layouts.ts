/**
 * Phase 23 — 2D Canvas: chat_canvas_layouts table (CANVAS-02, D-05, D-06, D-10).
 *
 * One row per conversation — the exact-restore snapshot of that conversation's
 * canvas: node positions/sizes/type/data-refs, edges, viewport, and the
 * shared-state store contents. `nodes`/`edges` carry NO genui spec content
 * (D-05) — genui-panel nodes hold only provenance refs (message id, part
 * index, run id) so specs rehydrate from `chat_messages` on read. This keeps
 * the layout row small, avoids duplicating the canonical typed-parts store
 * (FOUND-1), and means a stale/tampered layout row can never smuggle in spec
 * content that bypasses the chat_messages persistence path.
 *
 * `conversation_id` carries a UNIQUE index — enforced one-row-per-conversation
 * (D-05/D-06) — and the tRPC layer upserts via `onConflictDoUpdate` on that
 * column (last-write-wins debounced save, single-user local, no CRDT).
 *
 * `node_registry_version` records the NODE_TYPE_REGISTRY content-hash (D-04)
 * active when the layout was saved, so a future registry change can detect +
 * gracefully degrade legacy rows (unknown node types render an inert
 * placeholder, never crash the canvas).
 */

import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ChatConversations } from "./chat-conversations";

// ---------------------------------------------------------------------------
// chat_canvas_layouts
// ---------------------------------------------------------------------------
export const ChatCanvasLayouts = pgTable(
  "chat_canvas_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ChatConversations.id, { onDelete: "cascade" }),

    // D-05: node positions/sizes/type/data-refs — NEVER spec content.
    nodes: jsonb("nodes").notNull().default([]),

    // D-09: data-carrying edges { id, source, target, data: { sourcePath, targetKey } }.
    edges: jsonb("edges").notNull().default([]),

    // { x, y, zoom } — nullable until the user's first pan/zoom is persisted.
    viewport: jsonb("viewport"),

    // D-08/D-10: shared per-conversation store contents (panels.*/shared.*
    // namespaces) — streaming/derived values are recomputed, not persisted.
    sharedState: jsonb("shared_state").notNull().default({}),

    // D-04: NODE_TYPE_REGISTRY content-hash active at save time.
    nodeRegistryVersion: text("node_registry_version").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // D-05/D-06: one row per conversation — the upsert target for saveCanvasLayout.
    chatCanvasLayoutsConversationIdx: uniqueIndex(
      "idx_chat_canvas_layouts_conversation_id",
    ).on(t.conversationId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatCanvasLayoutRow = typeof ChatCanvasLayouts.$inferSelect;
export type InsertChatCanvasLayout = typeof ChatCanvasLayouts.$inferInsert;
