/**
 * Phase 56 — Research Canvas: chat_context_edges table (RCNV-04, D-54, 999.19).
 *
 * The durable semantic linkage store for "this canvas node's content is
 * context for this chat" — connecting a source-ledger row, a knowledge node,
 * a genui panel, or an email thread to a chat conversation so that content is
 * injected as real context on the conversation's next turn. This is NOT
 * canvas `sharedState`, and it is NOT `chat_canvas_layouts.edges`.
 *
 * D-54 (packages/db/src/schema/chat-conversations.ts:17-25,
 * .planning/phases/54-email-cluster-workflow-e3/54-CONTEXT.md:33-37)
 * explicitly ruled out `sharedState`/canvas snapshots as a linkage store for
 * exactly this kind of relationship ("this needs its own design"; "linkage
 * must survive canvas changes and be readable at turn time server-side").
 * `chat_canvas_layouts.edges` cannot express this relationship either: that
 * column's shape is `.strict()`-typed to exactly `{ sourcePath, targetKey }`
 * — a declared-state binding grammar for panel-to-panel field wiring. A chat
 * node has no declared-state fields to bind a `targetKey` into, and
 * `chat_canvas_layouts` is itself purely a one-row-per-conversation visual
 * restore snapshot, not an independently addressable/removable edge store.
 * `chat_context_edges` is this phase's repeat of the same D-54 principle
 * applied to a second, structurally distinct relationship: source/table/
 * panel <-> chat, durable, independently created/removed, read server-side
 * at chat-turn time (RunChatTurn._execute_turn, as a second, independent
 * fail-open injection pipeline alongside the existing thread/cluster one —
 * NOT nested inside its thread-linkage gate).
 *
 * sourceRef is a small, versioned, jsonb discriminated union (kept jsonb, not
 * four nullable typed columns, so a future 5th source kind needs no
 * migration — mirrors apps/web's node-data-schemas.ts per-type convention).
 * It holds exactly these four shapes (the authoritative form every
 * downstream Phase 56 plan — the tRPC Zod boundary, the Python per-type
 * resolver — must read from this one place):
 *
 *   { type: "source_ledger", ledgerId: <uuid> }
 *     -> sourceRefKey `source_ledger:<ledgerId>`
 *   { type: "knowledge_node", nodeId: <uuid> }
 *     -> sourceRefKey `knowledge_node:<nodeId>`
 *   { type: "genui_panel", messageId: <uuid>, partIndex: <int >= 0> }
 *     -> sourceRefKey `genui_panel:<messageId>:<partIndex>`
 *   { type: "email_thread", threadId: <uuid> }
 *     -> sourceRefKey `email_thread:<threadId>`
 *
 * sourceRefKey is the derived, stable string form of sourceRef, used solely
 * as the identity column for the partial unique index below — it must be
 * computed by every writer (the tRPC createContextEdge procedure) from
 * sourceRef, never trusted as independent input.
 *
 * isActive: supersede-never-delete (mirrors knowledge_node_edges.isActive) —
 * removing a canvas edge deactivates the row, preserving the "this chat WAS
 * informed by X" audit trail rather than losing history to a hard delete.
 *
 * Tenancy anchor: targetConversationId -> chat_conversations, ON DELETE
 * CASCADE — the same conversation-anchored tenancy as chat_source_ledger
 * (Pitfall 2 / Landmine 2). The genuinely new risk surface this table
 * introduces is cross-reference ownership: does the caller also own the
 * THING a sourceRef points at, not just the target conversation. That check
 * belongs at tRPC write time (createContextEdge), not deferred to the
 * Python read path, since RunChatTurn has no live per-request user identity
 * to re-verify against.
 *
 * The partial UNIQUE (target_conversation_id, source_ref_key) WHERE is_active
 * index mirrors knowledge_node_edges.idx_knowledge_node_edges_active_identity
 * exactly: at most one active edge per (conversation, exact source) pair,
 * which is what makes an upsert-or-reactivate write safe.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ChatConversations } from "./chat-conversations";

// ---------------------------------------------------------------------------
// chat_context_edges
// ---------------------------------------------------------------------------
export const ChatContextEdges = pgTable(
  "chat_context_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Ownership anchor (Pitfall 2 / Landmine 2): tenancy resolves through the
    // conversation, never through importer.
    targetConversationId: uuid("target_conversation_id")
      .notNull()
      .references(() => ChatConversations.id, { onDelete: "cascade" }),

    // Discriminated union — see module doc-comment for the exact 4 shapes.
    // Kept jsonb (not typed columns) so a future 5th source kind needs no
    // migration.
    sourceRef: jsonb("source_ref").notNull(),

    // Derived, stable string form of sourceRef — identity-index key only,
    // must be computed by the writer, never trusted as independent input.
    sourceRefKey: text("source_ref_key").notNull(),

    // Supersede-never-delete (mirrors knowledge_node_edges.isActive).
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chatContextEdgesTargetConversationIdx: index(
      "idx_chat_context_edges_target_conversation_id",
    ).on(t.targetConversationId),
    // At most one active edge per (conversation, exact source) pair — makes
    // upsert-or-reactivate safe.
    chatContextEdgesActiveIdentityIdx: uniqueIndex(
      "idx_chat_context_edges_active_identity",
    )
      .on(t.targetConversationId, t.sourceRefKey)
      .where(sql`is_active`),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatContextEdgeRow = typeof ChatContextEdges.$inferSelect;
export type InsertChatContextEdge = typeof ChatContextEdges.$inferInsert;
