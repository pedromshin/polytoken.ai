/**
 * Phase 22 — Chat Spine: chat_cost_ledger table (FOUND-3, D-09, D-14, D-20, D-22).
 *
 * The general budget ledger drawn on by the cost circuit breaker (per-turn /
 * per-session / per-day caps, D-20/D-21) — a domain concept, not a chat-shaped
 * guard bolted beside the existing AWS budget alert (FOUND-3). Every adapter
 * (server model, browser model) writes a usage row here (D-22), including
 * browser-executed models which meter tokens at $0 cost but still record
 * usage events for observability.
 *
 * D-14: conversation_id is nullable with ON DELETE SET NULL — ledger rows are
 * aggregate accounting data that carries no conversation content, so they
 * MUST survive a hard conversation delete (T-22-04 mitigation).
 *
 * run_id and importer_id are plain uuid columns with NO FK — mirrors the
 * genui_generation_events / ui_spec_templates idiom for optional cross-cutting
 * references (avoids coupling ledger retention to the runs/importers
 * lifecycle, since run rows themselves cascade-delete with their conversation
 * while the ledger row for that run must persist).
 *
 * Phase 44 (tenancy): chat_cost_ledger is NOT an importer-descendant (its
 * importer_id has no FK), so it gets a DIRECT user_id referencing
 * auth.users(id) rather than being scoped transitively through importers.
 */

import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { ChatConversations } from "./chat-conversations";

// ---------------------------------------------------------------------------
// chat_cost_ledger
// ---------------------------------------------------------------------------
export const ChatCostLedger = pgTable(
  "chat_cost_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // D-14: SET NULL (not cascade) — this is the load-bearing survives-delete FK.
    conversationId: uuid("conversation_id").references(
      () => ChatConversations.id,
      { onDelete: "set null" },
    ),

    // Provenance — plain uuid, no FK (see module doc: must outlive chat_runs'
    // own cascade-delete lifecycle).
    runId: uuid("run_id"),

    importerId: uuid("importer_id").notNull(),

    // Phase 44 (tenancy): direct ownership anchor. Contracted to NOT NULL
    // after the expand→backfill migration sequence.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    modelId: text("model_id").notNull(),

    // server | browser (D-09 — remote-peer reserved for a future sovereign/
    // distributed-inference play; CHECK constraint added in migration 0023)
    executionLocus: text("execution_locus").notNull(),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),

    // D-22: browser-executed models meter tokens at $0 cost but still record
    // a usage row here.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Per-day / per-session sums (D-20/D-23 ledger queries).
    chatCostLedgerImporterCreatedIdx: index(
      "idx_chat_cost_ledger_importer_created_at",
    ).on(t.importerId, t.createdAt),
    chatCostLedgerConversationIdx: index(
      "idx_chat_cost_ledger_conversation_id",
    ).on(t.conversationId),
    // Phase 44 (tenancy): ownership lookups by user.
    chatCostLedgerUserIdIdx: index(
      "idx_chat_cost_ledger_user_id",
    ).on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatCostLedgerRow = typeof ChatCostLedger.$inferSelect;
export type InsertChatCostLedger = typeof ChatCostLedger.$inferInsert;
