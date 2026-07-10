/**
 * Phase 44 — Tenancy: minimal reference to Supabase's managed `auth.users` table.
 *
 * Supabase provisions and owns the entire `auth` schema (migrations, columns,
 * triggers). Drizzle must NEVER generate migrations against it. This module
 * declares only the sliver Drizzle needs to model a cross-schema foreign key
 * from app tables to `auth.users(id)` — a single `id uuid` primary key column,
 * not the full Supabase auth.users shape.
 *
 * Usage: `userId: uuid("user_id").references(() => AuthUsers.id)`
 */

import { pgSchema, uuid } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// auth.users — reference-only declaration (Supabase-managed, not migrated here)
// ---------------------------------------------------------------------------
const authSchema = pgSchema("auth");

export const AuthUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});
