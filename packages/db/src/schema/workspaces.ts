/**
 * FEATURE-CATALOG W5 (multiuser/teams/workspaces) — the `workspaces` table.
 *
 * A workspace is the greenfield tenancy container that lets a resource be shared
 * across a set of members. It is ADDITIVE to the single-user model: today every
 * scoped table anchors on `user_id`; workspaces do NOT rip that out. A workspace
 * simply groups members, and a `resource_shares` row (resource-shares.ts) grants
 * a workspace access to an individually-owned resource. The owner's `user_id`
 * path stays sacred and unchanged — sharing only widens access, never narrows it.
 *
 * ## Shape
 *   - `owner_user_id` — the creating/owning user (auth.users). The owner is ALSO
 *     seeded as a `workspace_members` row with role `owner` at create time, so
 *     membership queries never need to special-case the owner. This column is the
 *     durable record of who owns the container (used for delete authority).
 *   - `name` — human label.
 *
 * ## Tenancy (INV-8/INV-9, mirrors 0040_documents.sql)
 *
 * Owner-scoped via a DIRECT `owner_user_id` (no importer join). The RLS policies
 * (RESTRICTIVE deny-anon + PERMISSIVE owner-authenticated) ship in the SAME
 * migration as the table (0047). Note the app-boundary wall is the primary
 * enforcement: membership/role checks in `access-control.ts` + the workspaces
 * router — RLS is defense-in-depth (Drizzle/service_role bypass it), same caveat
 * as 0034/0040.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// workspaces — the sharing container (W5)
// ---------------------------------------------------------------------------
export const Workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (INV-8/9). Cascade so a deleted user's workspaces
    // go with them (their members/shares cascade in turn).
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    name: text("name").notNull().default("Untitled workspace"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "workspaces I own" lookups.
    workspacesOwnerUserIdIdx: index("idx_workspaces_owner_user_id").on(
      t.ownerUserId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type WorkspaceRow = typeof Workspaces.$inferSelect;
export type InsertWorkspace = typeof Workspaces.$inferInsert;
