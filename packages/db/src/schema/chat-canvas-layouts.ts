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
 *
 * ## Scope discriminator (HM-01 — the pinned home board, migration 0046)
 *
 * A layout row is EITHER conversation-scoped (the original /chat canvas — one
 * row per `conversation_id`) OR home-scoped (the pinned, conversation-
 * independent home board at `/` — one row per `user_id`). ONE discriminator,
 * not a new table:
 *   - conversation row: `conversation_id` NOT NULL, `scope` NULL, `user_id` NULL.
 *   - home row:         `conversation_id` NULL, `scope` = 'home', `user_id` NOT NULL.
 * The `chat_canvas_layouts_scope_discriminator` CHECK constraint enforces
 * exactly one of those two shapes, so a malformed hybrid row can never exist.
 * A partial unique index on `user_id` WHERE `scope = 'home'` guarantees one
 * home board per user (the upsert target for saveHomeCanvasLayout), mirroring
 * the conversation_id unique index's one-row-per-conversation guarantee.
 * `conversation_id` becomes NULLABLE so a home row can omit it; Postgres unique
 * indexes treat NULLs as distinct, so the existing conversation_id unique index
 * is unaffected by the many home rows carrying NULL there.
 *
 * Tenancy (HM-01, INV-8/9): a home row carries a DIRECT `user_id` referencing
 * auth.users(id) — mirroring documents / forwarding_addresses — scoped through
 * the SAME central helper family. Owner-scoping RLS ships in 0046 (defense-in-
 * depth; the app connects as the superuser and enforces at the app boundary).
 */

import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { ChatConversations } from "./chat-conversations";

// ---------------------------------------------------------------------------
// chat_canvas_layouts
// ---------------------------------------------------------------------------
export const ChatCanvasLayouts = pgTable(
  "chat_canvas_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // NULLABLE since 0046 (HM-01): a home-scoped row has no conversation.
    // A conversation-scoped row still carries it NOT-NULL-in-practice, enforced
    // by the scope discriminator CHECK below (not a column-level NOT NULL, so a
    // home row may leave it NULL).
    conversationId: uuid("conversation_id").references(
      () => ChatConversations.id,
      { onDelete: "cascade" },
    ),

    // HM-01 scope discriminator + home-row ownership anchor (0046). `user_id`
    // is set ONLY on a home row (direct auth.users FK, mirrors documents);
    // `scope` is 'home' on a home row and NULL on a conversation row.
    userId: uuid("user_id").references(() => AuthUsers.id, {
      onDelete: "cascade",
    }),
    scope: text("scope"),

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
    // (Postgres treats NULLs as distinct, so home rows' NULL conversation_id
    // never collide here.)
    chatCanvasLayoutsConversationIdx: uniqueIndex(
      "idx_chat_canvas_layouts_conversation_id",
    ).on(t.conversationId),

    // HM-01 (0046): one home board per user — the upsert target for
    // saveHomeCanvasLayout. Partial: only home rows participate.
    chatCanvasLayoutsHomeUserIdx: uniqueIndex(
      "idx_chat_canvas_layouts_home_user",
    )
      .on(t.userId)
      .where(sql`${t.scope} = 'home'`),

    // HM-01 (0046): a row is EITHER conversation-scoped OR home-scoped — never
    // a hybrid. Existing rows (conversation_id NOT NULL, scope/user_id NULL)
    // satisfy the first branch, so no backfill is required.
    // Total boolean formulation (every term is an IS-test → never evaluates to
    // NULL, which Postgres would treat as a satisfied CHECK). The prior
    // OR-of-ANDs form let a hybrid junk row (conversation_id NULL, scope NULL,
    // user_id set) slip through on three-valued logic (skeptic finding). Here:
    // (1) exactly one anchor is present; (2) scope is present iff the row is
    // home-anchored (conversation_id NULL); (3) the only scope value is 'home'.
    chatCanvasLayoutsScopeDiscriminator: check(
      "chat_canvas_layouts_scope_discriminator",
      sql`((${t.conversationId} IS NOT NULL)::int + (${t.userId} IS NOT NULL)::int = 1) AND ((${t.scope} IS NULL) = (${t.conversationId} IS NOT NULL)) AND (${t.scope} IS NULL OR ${t.scope} = 'home')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatCanvasLayoutRow = typeof ChatCanvasLayouts.$inferSelect;
export type InsertChatCanvasLayout = typeof ChatCanvasLayouts.$inferInsert;
