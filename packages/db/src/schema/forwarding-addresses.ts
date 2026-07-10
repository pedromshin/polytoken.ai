/**
 * Phase 45 — Email Threads: forwarding_addresses table (THRD-04, seam only).
 *
 * Per-user secret-token forwarding address. The routable address is
 * `u-{token}@{FORWARDING_EMAIL_DOMAIN}` — the `u-` local-part prefix + token
 * is the seam contract shared with the FastAPI inbound resolver (Plan 45-05,
 * token -> user_id lookup at ingest) and the web surfacing of the user's own
 * address (Plan 45-06). `token` itself is an opaque high-entropy secret —
 * treat it like a credential, never log it, never expose another user's.
 *
 * Direct user_id table (no importer join), same idiom as chat_conversations
 * (VISION guardrail #1: every new table is tenant-scoped). UNIQUE on both
 * `token` (the resolution key — must be globally unique across all users)
 * and `userId` (seam scope: exactly one forwarding address per user, so
 * get-or-create on first use is deterministic).
 */

import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// forwarding_addresses — one row per user's secret-token forwarding address
// ---------------------------------------------------------------------------
export const ForwardingAddresses = pgTable(
  "forwarding_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // Opaque high-entropy secret; the resolvable half of
    // u-{token}@{FORWARDING_EMAIL_DOMAIN}.
    token: text("token").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    forwardingAddressesTokenUnique: uniqueIndex(
      "idx_forwarding_addresses_token_unique",
    ).on(t.token),
    // Seam scope: exactly one forwarding address per user.
    forwardingAddressesUserIdUnique: uniqueIndex(
      "idx_forwarding_addresses_user_id_unique",
    ).on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ForwardingAddressRow = typeof ForwardingAddresses.$inferSelect;
export type InsertForwardingAddress = typeof ForwardingAddresses.$inferInsert;
