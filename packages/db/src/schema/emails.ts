/**
 * Phase 4 — Email Intelligence: emails table (append-only raw email storage).
 *
 * Append-only: nothing here is ever mutated after insert (D-03).
 * Unique constraint on (importer_id, message_id) for idempotent ingestion.
 *
 * Phase 45 (Email Threads): thread_id is nullable + ON DELETE SET NULL (not
 * cascade) — emails must survive thread deletion/merge since they are
 * append-only (D-03). Populated by the ThreadResolver at ingest time and by
 * the backfill for pre-existing rows.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { Importers } from "./importers";
import { Threads } from "./threads";

// ---------------------------------------------------------------------------
// emails — one row per inbound email
// ---------------------------------------------------------------------------
export const Emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    importerId: uuid("importer_id")
      .notNull()
      .references(() => Importers.id, { onDelete: "cascade" }),

    // Phase 45 (Email Threads): nullable — populated by ThreadResolver at
    // ingest time / by the backfill. SET NULL on thread delete (append-only
    // emails, D-03, must survive thread deletion/merge).
    threadId: uuid("thread_id").references(() => Threads.id, {
      onDelete: "set null",
    }),

    // -- Envelope --
    // RFC 5322 Message-ID; idempotency key
    messageId: text("message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    referencesIds: text("references_ids").array(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    senderAddress: text("sender_address").notNull(),
    senderName: text("sender_name"),
    toAddresses: text("to_addresses").array().notNull(),
    ccAddresses: text("cc_addresses").array(),
    subject: text("subject"),

    // -- Body --
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    // Note: body_text_tsv generated always as tsvector is expressed in custom SQL migration
    // (drizzle-kit cannot emit GENERATED ALWAYS AS STORED tsvector columns)

    // Raw bytes location in Supabase Storage / S3
    rawStorageKey: text("raw_storage_key"),

    // -- Pipeline state --
    parseStatus: text("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Idempotency constraint: same email cannot be inserted twice for same importer
    importerMessageUnique: uniqueIndex(
      "emails_importer_id_message_id_unique",
    ).on(t.importerId, t.messageId),

    importerReceivedIdx: index("idx_emails_importer_id_received_at").on(
      t.importerId,
      t.receivedAt,
    ),

    // Phase 45 (Email Threads): lookups/joins by thread.
    emailsThreadIdIdx: index("idx_emails_thread_id").on(t.threadId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type EmailRow = typeof Emails.$inferSelect;
export type InsertEmail = typeof Emails.$inferInsert;
