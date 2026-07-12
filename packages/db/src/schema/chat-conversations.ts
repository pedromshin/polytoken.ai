/**
 * Phase 22 — Chat Spine: chat_conversations table (CHAT-01, D-10, D-12).
 *
 * One row per conversation thread in `/chat`. Owns the rail's recency list
 * (importer_id, updated_at) and remembers the last model used for a new
 * conversation's default (D-10). Title defaults to a deterministic
 * first-message snippet (D-12) with inline manual rename support.
 *
 * importer_id is a plain uuid with NO FK — mirrors the genui_generation_events
 * / ui_spec_templates idiom for optional tenant-scope columns (no coupling to
 * the importers lifecycle for this v1.3 spine).
 *
 * Phase 44 (tenancy): chat_conversations is NOT an importer-descendant (its
 * importer_id has no FK), so it gets a DIRECT user_id referencing
 * auth.users(id) rather than being scoped transitively through importers.
 *
 * Phase 54 (CLUS-02, migration 0036): thread_id is nullable + ON DELETE SET
 * NULL — mirrors emails.thread_id (Phase 45) exactly. This is the durable
 * server-side thread<->conversation linkage (canvas sharedState is NOT the
 * linkage store — it must survive canvas changes and be readable at turn
 * time). AUTHORED TONIGHT, APPLIED TO NO ENVIRONMENT — Docker/WSL is down;
 * the morning §H flow applies 0036 local->staging->prod. Every reader/writer
 * of this column MUST feature-detect via
 * packages/api-client/src/router/_column-detect.ts's tableColumnExists
 * before querying it, so an unapplied migration never 500s.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { Threads } from "./threads";

// ---------------------------------------------------------------------------
// chat_conversations
// ---------------------------------------------------------------------------
export const ChatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Tenant scope — nullable, no FK (mirrors genui_generation_events.importer_id).
    importerId: uuid("importer_id"),

    // Phase 44 (tenancy): direct ownership anchor. Contracted to NOT NULL
    // after the expand→backfill migration sequence.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // D-12: first-user-message snippet, deterministic truncation, no LLM call.
    // Inline manual rename (CHAT-02) overwrites this value directly.
    title: text("title").notNull().default("Untitled conversation"),

    // D-10: remembered model — the default for the NEXT new conversation is
    // read from the most recently updated row's model_id.
    modelId: text("model_id").notNull(),

    // Phase 54 (CLUS-02): durable thread<->conversation linkage. Nullable —
    // most conversations are never attached to a thread. SET NULL on thread
    // delete (mirrors emails.threadId's D-03-flavored survive-deletion
    // posture — a conversation must survive its linked thread disappearing).
    threadId: uuid("thread_id").references(() => Threads.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // D-11: the rail's recency list — per-importer, most-recently-updated first.
    chatConversationsImporterUpdatedIdx: index(
      "idx_chat_conversations_importer_updated_at",
    ).on(t.importerId, t.updatedAt),

    // Phase 44 (tenancy): ownership lookups by user.
    chatConversationsUserIdIdx: index(
      "idx_chat_conversations_user_id",
    ).on(t.userId),

    // Phase 54 (CLUS-02): lookups/joins by linked thread.
    chatConversationsThreadIdIdx: index(
      "idx_chat_conversations_thread_id",
    ).on(t.threadId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatConversationRow = typeof ChatConversations.$inferSelect;
export type InsertChatConversation = typeof ChatConversations.$inferInsert;
