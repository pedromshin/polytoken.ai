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
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// chat_conversations
// ---------------------------------------------------------------------------
export const ChatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Tenant scope — nullable, no FK (mirrors genui_generation_events.importer_id).
    importerId: uuid("importer_id"),

    // Phase 44 (tenancy): direct ownership anchor. Nullable during the expand
    // migration step; contracted to NOT NULL once backfill completes.
    userId: uuid("user_id").references(() => AuthUsers.id, {
      onDelete: "cascade",
    }),

    // D-12: first-user-message snippet, deterministic truncation, no LLM call.
    // Inline manual rename (CHAT-02) overwrites this value directly.
    title: text("title").notNull().default("Untitled conversation"),

    // D-10: remembered model — the default for the NEXT new conversation is
    // read from the most recently updated row's model_id.
    modelId: text("model_id").notNull(),

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
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatConversationRow = typeof ChatConversations.$inferSelect;
export type InsertChatConversation = typeof ChatConversations.$inferInsert;
