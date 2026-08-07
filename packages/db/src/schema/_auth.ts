/**
 * Phase 44 — Tenancy: minimal reference to Supabase's managed `auth.users` table.
 *
 * Supabase provisions and owns the entire `auth` schema (migrations, columns,
 * triggers). Drizzle must NEVER generate migrations against it — the drizzle
 * config's `schemaFilter: ["public"]` guarantees nothing here reaches
 * `drizzle-kit generate`. This module declares only the sliver Drizzle needs:
 *   - `id` — the cross-schema FK anchor for app tables (`auth.users(id)`);
 *   - `email` / `rawUserMetaData` — READ-ONLY projections for the workspace
 *     user-search endpoint (vLAUNCH W65, PEDRO-CHECKLIST §5). Never written.
 * It is deliberately NOT the full Supabase auth.users shape.
 *
 * Usage: `userId: uuid("user_id").references(() => AuthUsers.id)`
 */

import { jsonb, pgSchema, uuid, varchar } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// auth.users — reference-only declaration (Supabase-managed, not migrated here)
// ---------------------------------------------------------------------------
const authSchema = pgSchema("auth");

export const AuthUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }),
  rawUserMetaData: jsonb("raw_user_meta_data"),
});
