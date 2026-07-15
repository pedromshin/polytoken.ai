/**
 * Phase 56 — Research Canvas: chat_source_ledger table (RCNV-01, 999.19).
 *
 * A per-conversation, zero-knowledge-graph-write candidate pool of tool
 * sources the agent used (starting with `web_search`, generalizing to other
 * tool outputs later). This is explicitly NOT the knowledge graph — 999.19's
 * own framing draws this line deliberately: a source landing here has had NO
 * capture-confirm ceremony (no `emit_confirm_action` call, no widget, no user
 * click) and writes NOTHING to `knowledge_nodes`/`knowledge_node_edges`. It
 * is populated automatically, synchronously, inside the existing tool-round
 * loop the instant a result passes the FOUND-6 envelope-quarantine gate —
 * contrast with `SourceCaptureHandler` (Phase 54, CLUS-04), whose entire
 * design point is "the model proposes, the user confirms." That machinery
 * stays live and unchanged; this table is a second, independent, zero-
 * ceremony way sources enter the system (the requirement's own explicit
 * anti-goal is treating this like CLUS-04's widget flow).
 *
 * Tenancy anchor: conversationId -> chat_conversations, ON DELETE CASCADE.
 * `chat_conversations` is NOT an importer-descendant (its own importer_id has
 * no FK) — it is scoped DIRECTLY by user_id (Phase 44). Both new Phase 56
 * tables therefore resolve ownership via conversationId ->
 * assertConversationOwnership, exactly like chat_messages/chat_runs/
 * chat_canvas_layouts/chat_widget_interactions already do (ownership.ts's own
 * documented taxonomy) — never via a direct or transitive importer_id/user_id
 * check invented ad hoc.
 *
 * importerId is a plain uuid with NO FK — mirrors chat_cost_ledger's
 * run_id/importer_id idiom: a denormalized query/audit convenience column
 * only, never an ownership authority.
 *
 * knowledgeNodeId is nullable, ON DELETE SET NULL, set later by the Phase
 * 63 promotion-gate reuse seam (PromoteSourceLedgerEntryUseCase) once a
 * ledger row has been promoted into the knowledge graph via the UNCHANGED
 * SourceCaptureHandler/PromoteEdgeUseCase — so a future read can show
 * "already captured" state. SET NULL (not RESTRICT) so promoting a source and
 * later deleting that knowledge node never orphans or blocks-delete the
 * ledger row.
 *
 * The UNIQUE (conversation_id, tool_use_id, result_index) index is the
 * dedupe key that makes the fail-open write hook in the Python tool-round
 * loop safe to retry idempotently — re-processing the same tool round (e.g.
 * after a fail-open error elsewhere) never double-inserts.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ChatConversations } from "./chat-conversations";
import { KnowledgeNodes } from "./knowledge-nodes";

// ---------------------------------------------------------------------------
// chat_source_ledger
// ---------------------------------------------------------------------------
export const ChatSourceLedger = pgTable(
  "chat_source_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Ownership anchor (Pitfall 2 / Landmine 2): tenancy resolves through the
    // conversation, never through importer.
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ChatConversations.id, { onDelete: "cascade" }),

    // Denormalized query/audit convenience ONLY — no FK, never an ownership
    // authority (mirrors chat_cost_ledger.importerId).
    importerId: uuid("importer_id"),

    toolName: text("tool_name").notNull(),
    toolUseId: text("tool_use_id").notNull(),
    resultIndex: integer("result_index").notNull(),

    url: text("url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),

    // Set by the Phase 63 promotion-gate reuse seam once this row has been
    // promoted into the knowledge graph. SET NULL preserves the ledger row
    // if the promoted node is later deleted.
    knowledgeNodeId: uuid("knowledge_node_id").references(
      () => KnowledgeNodes.id,
      { onDelete: "set null" },
    ),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Idempotent-retry dedupe key — one row per (conversation, tool round,
    // result within that round).
    chatSourceLedgerDedupeIdx: uniqueIndex("idx_chat_source_ledger_dedupe").on(
      t.conversationId,
      t.toolUseId,
      t.resultIndex,
    ),
    chatSourceLedgerConversationIdx: index(
      "idx_chat_source_ledger_conversation_id",
    ).on(t.conversationId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ChatSourceLedgerRow = typeof ChatSourceLedger.$inferSelect;
export type InsertChatSourceLedger = typeof ChatSourceLedger.$inferInsert;
